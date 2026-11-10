// Background function (15-minute budget, granted by the "-background" filename
// suffix). Two modes:
//   x-trigger: manual | daily-schedule  -> full pre-market scan (framework v2)
//   x-trigger: post-open                -> 09:20 IST confirmation snapshot,
//                                          merged into today's stored report
// Plain get/set only (the runtime-provided blobs build lacks getJSON/setJSON).
import { runScan, toMarkdown, toHtml, istNow, postOpenConfirmation } from "../../lib/scan.mjs";
import { artifactParams, updateScorecard, loadScorecard } from "../../lib/ensemble.mjs";
import { decodePackedModel, LstmForecaster } from "../../lib/lstm.mjs";
import { PACKED } from "../../lib/model-nifty.mjs";

let forecaster = null;
try {
  if (PACKED) forecaster = new LstmForecaster(decodePackedModel(PACKED));
} catch (e) {
  console.error("model load failed:", e?.message || e);
}

async function storeReport(store, report) {
  const md = toMarkdown(report);
  const html = toHtml(report);
  const rj = JSON.stringify(report);
  await Promise.all([
    store.set(`reports/${report.date}`, rj),
    store.set(`reports/${report.date}.md`, md),
    store.set(`reports/${report.date}.html`, html),
    store.set("latest", rj),
    store.set("latest.md", md),
    store.set("latest.html", html),
  ]);
  // maintain the history index (newest first, capped)
  let hist = [];
  try { hist = JSON.parse((await store.get("history")) || "[]"); } catch { hist = []; }
  if (!Array.isArray(hist)) hist = [];
  hist = hist.filter((h) => h && h.date !== report.date);
  hist.unshift({
    date: report.date, weekday: report.weekday, generated_at: report.generated_at,
    classification: report.framework ? report.framework.classification : report.bias,
    score: report.score,
  });
  await store.set("history", JSON.stringify(hist.slice(0, 400)));
}


// ---------------- framework track record (learning loop, task 1+4) ----------------
function callDirection(classification) {
  if (!classification) return 0;
  if (/^Positive/i.test(classification)) return 1;
  if (/^Negative/i.test(classification)) return -1;
  return 0;   // neutral, conflicting or unknown: no directional claim
}

function summaryFrom(sc) {
  if (!sc || !Array.isArray(sc.entries)) return null;
  const done = sc.entries.filter((e) => e.hit !== null && e.hit !== undefined);
  if (!done.length) return { n: 0, hit_rate: null, last: [] };
  return {
    n: done.length,
    hit_rate: +(100 * done.filter((e) => e.hit).length / done.length).toFixed(1),
    hit_rate_20: +(100 * done.slice(-20).filter((e) => e.hit).length / Math.min(20, done.length)).toFixed(1),
    last: done.slice(-5).map((e) => ({ d: e.d, call: e.call, open_dir: e.open_dir, hit: e.hit })),
  };
}

async function frameworkSummary(store) {
  let sc = null;
  try { sc = JSON.parse((await store.get("framework-scorecard")) || "null"); } catch { /* none */ }
  return summaryFrom(sc);
  const done = sc.entries.filter((e) => e.hit !== null && e.hit !== undefined);
  if (!done.length) return { n: 0, hit_rate: null, last: [] };
  return {
    n: done.length,
    hit_rate: +(100 * done.filter((e) => e.hit).length / done.length).toFixed(1),
    hit_rate_20: +(100 * done.slice(-20).filter((e) => e.hit).length / Math.min(20, done.length)).toFixed(1),
    last: done.slice(-5).map((e) => ({ d: e.d, call: e.call, open_dir: e.open_dir, hit: e.hit })),
  };
}

async function updateFrameworkScorecard(store, report, conf) {
  let sc = null;
  try { sc = JSON.parse((await store.get("framework-scorecard")) || "null"); } catch { /* none */ }
  if (!sc || !Array.isArray(sc.entries)) sc = { entries: [] };
  const d = report.date;
  const call = report.framework ? report.framework.classification : (report.bias || null);
  const entry = sc.entries.find((e) => e.d === d) || { d, call, open_dir: null, hit: null };
  entry.call = call;
  // resolution: what actually happened at the open (post open confirmation)
  if (entry.hit == null && conf && conf.open_vs_prev_pct != null) {
    const openDir = conf.open_vs_prev_pct > 0.05 ? 1 : conf.open_vs_prev_pct < -0.05 ? -1 : 0;
    const callDir = callDirection(entry.call);
    entry.open_dir = openDir;
    entry.hit = callDir === 0 ? openDir === 0 : callDir === openDir;
  }
  if (!sc.entries.includes(entry)) sc.entries.push(entry);
  sc.entries = sc.entries.sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-60);
  await store.set("framework-scorecard", JSON.stringify(sc));
  return sc;
}

// blob backed adapter for the source fallback cache (last good fetches)
function cacheAdapter(store) {
  return {
    async get(k) { return store.get(k); },
    async set(k, v) { return store.set(k, v); },
  };
}

// full scan + adaptive-ensemble prediction + scorecard recording/learning
async function scanWithEnsemble(store) {
  const sc = await loadScorecard(store);            // yesterday's evidence
  const params = artifactParams(sc.meta);           // live w if learned, else artifact
  const report = await runScan(new Date(), { forecaster, ensembleParams: params, cache: cacheAdapter(store) });
  // record today's prediction, resolve past ones, re-learn (w, bias)
  const summary = await updateScorecard(store, report.predictions);
  if (report.predictions && !report.predictions.error && report.predictions.ensemble) {
    report.predictions.ensemble.scorecard = summary;
  }
  return report;
}

export default async (req) => {
  const t0 = Date.now();
  // Abuse guard: direct public POSTs without a trigger header are rejected.
  // The only legitimate callers are the scheduled stubs (daily-schedule /
  // post-open) and api-scan's manual button, all of which send the header
  // (api-scan itself is already throttled to one run per 2 minutes).
  const trigger = req?.headers?.get?.("x-trigger") || null;
  if (!trigger) {
    return new Response(JSON.stringify({ status: "rejected", message: "This worker is not directly callable." }),
      { status: 403, headers: { "content-type": "application/json" } });
  }
  const now = istNow();
  const scheduled = trigger === "daily-schedule" || trigger === "post-open";

  if (now.isWeekend && scheduled) {
    console.log(`scan-background: weekend in IST — skipping ${trigger} run`, now.date);
    return new Response(JSON.stringify({ ok: true, skipped: "weekend" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }

  const { getStore } = await import("@netlify/blobs");
  const store = getStore("premarket");

  if (trigger === "post-open") {
    // Step 4 of the framework: what actually happened after the bell
    const conf = await postOpenConfirmation({ cache: cacheAdapter(store) });
    let report = null;
    try { report = JSON.parse((await store.get("latest")) || "null"); } catch { /* none */ }
    if (!report || report.date !== now.date) {
      // no morning report (or stale) — run the full scan first, then attach
      report = await scanWithEnsemble(store);
    }
    report.confirmation = conf;
    const fsc = await updateFrameworkScorecard(store, report, conf);
    report.framework_scorecard = summaryFrom(fsc);   // from the state we just wrote, not a possibly stale re-read
    await storeReport(store, report);
    console.log(`scan-background: post-open confirmation saved for ${report.date} in ${Date.now() - t0}ms`);
    return new Response(JSON.stringify({ ok: true, mode: "post-open", date: report.date, ms: Date.now() - t0 }),
      { status: 200, headers: { "content-type": "application/json" } });
  }

  const report = await scanWithEnsemble(store);
  report.framework_scorecard = await frameworkSummary(store);
  await storeReport(store, report);

  console.log(`scan-background: saved ${report.date} "${report.framework ? report.framework.classification : report.bias}" in ${Date.now() - t0}ms`);
  return new Response(JSON.stringify({
    ok: true, date: report.date,
    classification: report.framework ? report.framework.classification : report.bias,
    unavailable: report.unavailable, ms: Date.now() - t0,
  }), { status: 200, headers: { "content-type": "application/json" } });
};
