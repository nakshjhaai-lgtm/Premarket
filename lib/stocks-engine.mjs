// Per stock adaptive engine: predict -> record -> resolve against what really
// happened -> re-learn per stock parameters (bias, band, blend weight).
//
// The point forecast model is a gradient boosted tree model trained offline on
// a decade of daily data for ~50 symbols plus market context (SPY, QQQ, VIX,
// sector ETFs). See methodology.html. The model is FROZEN; what adapts daily,
// per stock, automatically:
//   bias    : rolling mean of the model's recent errors, subtracted (the
//             per stock analogue of the NIFTY LSTM bias correction)
//   band80  : 80th percentile of recent |errors|, recalibrated from live
//             residuals, so the stated band keeps its promised coverage
//   w       : per stock blend weight between the tree model and the offline
//             TimesFM artifact, re-learned from live evidence like the NIFTY
//             ensemble weight
// Everything is keyed by session date, so holidays and re-runs are safe.
import { featureRow, gbmPredict } from "./stock-features.mjs";
import SEED from "../assets/stock-history-seed.json" with { type: "json" };
import TFART from "../assets/stock-forecasts.json" with { type: "json" };

// predicted symbols: the 50 on the site (SPY, QQQ, DIA included; the model was
// trained on them too). The 11 sector ETFs are context inputs only.
export const STOCKS = Object.keys(SEED.symbols).filter((s) => !SEED.symbols[s].etf || s === "SPY" || s === "QQQ" || s === "DIA");
export const SYMBOLS = Object.keys(SEED.symbols);

const BLOB = "stocks-adaptive";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "application/json" };

async function jget(url, timeout = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { headers: UA, signal: ac.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

function mdToIso(md) { // "10/16/2026" -> "2026-10-16"
  const [m, d, y] = md.split("/");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// incremental Nasdaq history: only sessions NEWER than the last stored one
async function fetchNewRows(sym, lastDate) {
  const apiSym = sym.replace("BRK-B", "BRK.B");
  const url = `https://api.nasdaq.com/api/quote/${apiSym}/historical?assetclass=${SEED.symbols[sym].etf ? "etf" : "stocks"}&fromdate=${lastDate}&todate=${new Date().toISOString().slice(0, 10)}&limit=50`;
  const d = await jget(url);
  const rows = ((d.data || {}).tradesTable || {}).rows || [];
  const out = [];
  for (const r of rows) {
    try {
      const iso = mdToIso(r.date);
      if (iso <= lastDate) continue;
      const close = parseFloat(String(r.close).replace("$", "").replace(",", ""));
      let v = String(r.volume || "0").replace(",", "");
      v = v && v !== "N/A" ? Math.round(parseFloat(v)) : 0;
      if (close > 0) out.push([iso, close, v]);
    } catch { /* skip malformed */ }
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}

async function fetchVixRows(lastDate) {
  const txt = await (await fetch("https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv")).text();
  const out = [];
  for (const ln of txt.split("\n").slice(1)) {
    if (!ln.includes(",")) continue;
    const p = ln.split(",");
    const iso = mdToIso(p[0]);
    if (iso <= lastDate) continue;
    const v = parseFloat(p[4]);
    if (v > 0) out.push([iso, v]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}

// ---------------- adaptive state ----------------
function newState() {
  const hist = {};
  for (const [sym, h] of Object.entries(SEED.symbols)) hist[sym] = { d: [...h.d], c: [...h.c], v: [...h.v] };
  // single shared object: st.vix IS hist.VIX, so VIX appends are seen by featureRow
  hist.VIX = { d: [...SEED.vix.d], v: [...SEED.vix.v] };
  return { hist, vix: hist.VIX, sc: {}, updated_at: null };
}

function percentile(sortedVals, p) {
  if (!sortedVals.length) return null;
  const i = Math.min(sortedVals.length - 1, Math.max(0, Math.ceil((p / 100) * sortedVals.length) - 1));
  return sortedVals[i];
}

function perStockState(sc, sym) {
  // entries: [{made_on, gbm, adj, tf, final, actual, err, dir_hit, band_hit}]
  const es = (sc[sym] || []).filter((e) => e.actual != null);
  const bias = es.length >= 10 ? +(es.slice(-20).reduce((s, e) => s + e.err, 0) / Math.min(20, es.length)).toFixed(4) : null;
  const absErrs = es.slice(-40).map((e) => Math.abs(e.err)).sort((a, b) => a - b);
  const band80 = es.length >= 30 ? +percentile(absErrs, 80).toFixed(3) : null;
  // per stock blend with the TimesFM artifact, learned like the NIFTY weight
  let w = null;
  const both = es.filter((e) => e.tf != null).slice(-30);
  if (both.length >= 5) {
    let best = null;
    for (let wi = 0; wi <= 20; wi++) {
      const ww = wi / 20;
      let se = 0;
      for (const e of both) {
        const p = ww * e.tf + (1 - ww) * e.gbm;
        se += (p - e.actual) ** 2;
      }
      const rmse = Math.sqrt(se / both.length);
      if (!best || rmse < best.rmse) best = { w: +ww.toFixed(2), rmse: +rmse.toFixed(3) };
    }
    w = best.w;
  }
  const recent = es.slice(-20);
  return {
    n: es.length,
    bias, band80: band80 || 2.4, w,
    dir_hit_20: recent.length ? +(100 * recent.filter((e) => e.dir_hit).length / recent.length).toFixed(1) : null,
    band_hit_20: recent.length ? +(100 * recent.filter((e) => e.band_hit).length / recent.length).toFixed(1) : null,
  };
}

function tfFreshness() {
  // artifact freshness measured in stored history sessions past its as_of
  const spy = SEED.symbols.SPY.d;
  let lag = 0;
  for (const d of spy) if (d > (TFART.as_of || "")) lag++;
  return { as_of: TFART.as_of, lag, fresh: lag <= 5 };
}

// ---------------- main cycle ----------------
export async function runAdaptiveCycle(store) {
  let st = null;
  try { st = JSON.parse((await store.get(BLOB)) || "null"); } catch { /* rebuild */ }
  if (!st || !st.hist) st = newState();

  const sources = { quotes: { label: "Stock closes (Nasdaq API)", state: "live", n_new: 0 }, vix: { label: "VIX (CBOE)", state: "live", n_new: 0 } };
  const failures = [];

  // 1) incremental history update
  const histDates = {}; // sym -> newest date appended this run
  for (const sym of SYMBOLS) {
    const h = st.hist[sym];
    const last = h.d[h.d.length - 1];
    try {
      const rows = await fetchNewRows(sym, last);
      for (const [d, c, v] of rows) { h.d.push(d); h.c.push(c); h.v.push(v); }
      if (rows.length) { sources.quotes.n_new += rows.length; histDates[sym] = rows[rows.length - 1][0]; }
      // keep the window bounded
      if (h.d.length > 400) { h.d = h.d.slice(-400); h.c = h.c.slice(-400); h.v = h.v.slice(-400); }
      await sleep(1100);
    } catch (e) {
      failures.push(sym);
    }
  }
  if (failures.length === SYMBOLS.length) sources.quotes.state = "degraded";
  else if (failures.length > 5) { sources.quotes.state = "cached"; sources.quotes.note = `${failures.length} symbols kept at last known close`; }

  try {
    const vrows = await fetchVixRows(st.vix.d[st.vix.d.length - 1]);
    for (const [d, v] of vrows) { st.vix.d.push(d); st.vix.v.push(v); }
    if (vrows.length) sources.vix.n_new = vrows.length;
    if (st.vix.d.length > 500) { st.vix.d = st.vix.d.slice(-500); st.vix.v = st.vix.v.slice(-500); }
  } catch {
    sources.vix.state = "cached";
    sources.vix.note = "last known VIX series";
  }

  // 2) resolve pending predictions: an entry made_on D resolves at the first
  //    stored session strictly after D
  let nResolved = 0;
  for (const sym of STOCKS) {
    const h = st.hist[sym];
    const es = st.sc[sym] || [];
    for (const e of es) {
      if (e.actual != null) continue;
      let k = -1;
      for (let i = 0; i < h.d.length; i++) if (h.d[i] > e.made_on) { k = i; break; }
      if (k < 0) continue;
      const prevI = k - 1;
      if (prevI < 0 || h.d[prevI] !== e.made_on) continue;   // history changed shape; skip safely
      e.actual = +(100 * (h.c[k] - h.c[prevI]) / h.c[prevI]).toFixed(4);
      e.err = +(e.final - e.actual).toFixed(4);
      e.dir_hit = (e.final > 0) === (e.actual > 0);
      e.band_hit = Math.abs(e.err) <= (e.band || 2.4);
      nResolved++;
    }
    st.sc[sym] = es.slice(-60);
  }

  // 3) predict the next session per stock with per stock adaptive parameters
  const tf = tfFreshness();
  const predictions = [];
  const newEntries = {};
  for (const sym of STOCKS) {
    const h = st.hist[sym];
    const madeOn = h.d[h.d.length - 1];
    const lastClose = h.c[h.c.length - 1];
    const f = featureRow(sym, madeOn, st.hist);
    if (!f) { predictions.push({ sym, error: "not enough history" }); continue; }
    const ps = perStockState(st.sc, sym);
    const raw = gbmPredict(f);                      // model return forecast, %
    const adj = raw - (ps.bias || 0);               // per stock bias correction
    // TimesFM artifact second opinion (offline, only when fresh)
    const tfRow = tf.fresh ? (TFART.stocks.find((s) => s.sym === sym) || null) : null;
    const tfPct = tfRow && tfRow.as_of === TFART.as_of ? tfRow.next_pct : null;
    let final = adj, blend = "tree";
    if (tfPct != null && ps.w != null) {
      final = ps.w * tfPct + (1 - ps.w) * adj;
      blend = `tree ${Math.round((1 - ps.w) * 100)}% / TimesFM ${Math.round(ps.w * 100)}%`;
    } else if (tfPct != null) {
      final = 0.5 * tfPct + 0.5 * adj;              // no live evidence yet: equal blend
      blend = "tree 50% / TimesFM 50%";
    }
    const band = ps.band80 || 2.4;
    const nextClose = +(lastClose * (1 + final / 100)).toFixed(2);
    predictions.push({
      sym, name: SEED.symbols[sym].name, last_close: lastClose, last_date: madeOn,
      pred_pct: +final.toFixed(3), raw_pct: +raw.toFixed(3), bias: ps.bias,
      next_close: nextClose,
      band_lo: +(lastClose * (1 + (final - band) / 100)).toFixed(2),
      band_hi: +(lastClose * (1 + (final + band) / 100)).toFixed(2),
      band_pct: +band.toFixed(2),
      direction: final > 0.05 ? "up" : final < -0.05 ? "down" : "flat",
      blend, tf_pct: tfPct,
      dir_hit_20: ps.dir_hit_20, band_hit_20: ps.band_hit_20, n_resolved: ps.n,
    });
    newEntries[sym] = { made_on: madeOn, gbm: +adj.toFixed(4), tf: tfPct != null ? +tfPct.toFixed(4) : null,
                        final: +final.toFixed(4), band: +band.toFixed(3), actual: null };
  }

  // 4) record today's predictions (upsert by made_on)
  for (const sym of STOCKS) {
    if (!newEntries[sym]) continue;
    const es = st.sc[sym] || [];
    const exist = es.find((e) => e.made_on === newEntries[sym].made_on);
    if (exist && exist.actual == null) Object.assign(exist, newEntries[sym]);
    else if (!exist) es.push(newEntries[sym]);
    st.sc[sym] = es.slice(-60);
  }

  st.updated_at = new Date().toISOString();
  await store.set(BLOB, JSON.stringify(st));

  // 5) view for the API / page
  const resolved = STOCKS.map((s) => perStockState(st.sc, s));
  return {
    as_of: STOCKS.map((s) => st.hist[s].d[st.hist[s].d.length - 1]).reduce((a, b) => (a > b ? a : b), ""),
    generated_at: st.updated_at,
    model: "gradient boosted trees (decade trained) + per stock online adaptation",
    tf_artifact: { as_of: tf.as_of, fresh: tf.fresh, lag_sessions: tf.lag },
    sources, n_resolved_this_run: nResolved, failed_symbols: failures.slice(0, 10),
    predictions,
    aggregate: {
      n_resolved: resolved.reduce((s, r) => s + r.n, 0),
      median_dir_hit_20: median(resolved.map((r) => r.dir_hit_20).filter((x) => x != null)),
      median_band_hit_20: median(resolved.map((r) => r.band_hit_20).filter((x) => x != null)),
    },
  };
}

function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function loadLiveView(store) {
  try { return JSON.parse((await store.get(BLOB)) || "null"); } catch { return null; }
}
