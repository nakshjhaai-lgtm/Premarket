// Local end-to-end test of the scan pipeline incl. the adaptive ensemble.
// (Not shipped to production; run:  node tools/test-local.mjs)
import { runScan, toMarkdown, toHtml } from "../lib/scan.mjs";
import { decodePackedModel, LstmForecaster } from "../lib/lstm.mjs";
import { PACKED } from "../lib/model-nifty.mjs";
import { artifactParams, ensembleView } from "../lib/ensemble.mjs";

const fc = new LstmForecaster(decodePackedModel(PACKED));
const params = artifactParams(null);
console.log("params:", { w: params.w, bias: params.bias, fallback: params.fallback, tf_as_of: params.tf?.as_of });

const r = await runScan(new Date(), { forecaster: fc, ensembleParams: params });
const p = r.predictions;
if (p?.error) { console.error("PREDICTION FAILED:", p.error); process.exit(1); }
const e = p.ensemble;
if (!e) { console.error("no ensemble view attached"); process.exit(1); }

const checks = [
  ["ensemble next present", e.next?.length === 5],
  ["components present", e.components?.lstm_live?.length === 5 && e.components.timesfm?.length === 5],
  ["freshness flag", typeof e.tf_fresh === "boolean"],
  ["w source provenance", typeof e.w_source === "string" && e.w_source.length > 0],
  ["next value sane", e.next[0].value > 15000 && e.next[0].value < 35000],
  ["blend math", Math.abs((params.w * params.tf.path[0] + (1 - params.w) * (p.next[0].value - params.bias)) - e.next[0].value) < 0.51],
];
let fail = 0;
for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) fail++; }

// simulate the scorecard summary that scan-background attaches in production
e.scorecard = { n_pending: 1, n_resolved: 0, w_live: null, bias_live: null, recent: [], note: null };
const md = toMarkdown(r);
const html = toHtml(r);
const mdChecks = [
  ["md has ensemble heading", md.includes("adaptive ensemble (primary)")],
  ["md has formula line", md.includes("w * TimesFM")],
  ["md has learning loop line", md.includes("Learning loop")],
  ["md has freshness line", md.includes("Data freshness")],
  ["md has no em dash", !md.includes("—")],
  ["html has no em dash or entity", !html.includes("—") && !html.includes("&mdash;")],
  ["html has ensemble heading", html.includes("adaptive ensemble")],
  ["html has component line", html.includes("TimesFM 2.5 (artifact")],
];
for (const [name, ok] of mdChecks) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) fail++; }

console.log(`\nensemble next: ${e.next[0].d} ${e.next[0].value} (${e.next[0].chg_pct_vs_last_close}%) w=${e.w} fresh=${e.tf_fresh}`);
console.log(fail ? `\n${fail} FAILURES` : "\nALL_OK");
process.exit(fail ? 1 : 0);
