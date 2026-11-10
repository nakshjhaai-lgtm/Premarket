// Adaptive ensemble: TimesFM (offline artifact) blended with the live LSTM,
// with a daily self-improvement loop.
//
//   ensemble(t+1) = w * TimesFM(t+1) + (1-w) * (LSTM(t+1) - bias)
//
// w and the LSTM bias are LEARNED offline over a 250-session walk-forward
// window (tools/build-model-analysis.mjs) and shipped in
// assets/model-analysis.json. Every scheduled scan additionally records its
// predictions in a "model-scorecard" blob; once the actual prints, the entry
// is resolved and w/bias are re-learned from live evidence, so the weight
// used each morning is the one that has been winning recently.
//
// TimesFM runs offline (the 200M-param checkpoint is too large for a
// serverless bundle), so its live input is the latest artifact, guarded by
// a freshness check. If the artifact is stale (>5 sessions), the ensemble
// honestly falls back to the bias-corrected LSTM and says so.
import MA from "../assets/model-analysis.json" with { type: "json" };

export const ARTIFACT = MA;

// default learned params straight from the shipped artifact
export function artifactParams(scorecardMeta) {
  const e = MA.ensemble || {};
  const meta = scorecardMeta || {};
  // live-relearned weight wins once the scorecard has enough resolved evidence
  const useLive = meta.n_resolved >= 5 && meta.w_live != null;
  return {
    w: useLive ? meta.w_live : e.w,
    bias: useLive && meta.bias_live != null ? meta.bias_live : e.lstm_bias,
    w_source: useLive
      ? `live scorecard (${meta.n_resolved} resolved sessions, re-learned daily)`
      : `offline walk forward (${e.learned_on?.sessions || "?"} sessions ending ${MA.as_of})`,
    tf: MA.timesfm ? {
      as_of: MA.as_of, model: MA.timesfm.model, path: MA.timesfm.forecast,
      dates: MA.timesfm.horizon_dates, backtest: MA.timesfm.backtest,
    } : null,
    fallback: !(e.w != null && MA.timesfm?.forecast?.length),
  };
}

export function nextTradingDays(fromISO, n) {
  const out = [];
  let d = new Date(fromISO + "T00:00:00Z");
  while (out.length < n) {
    d = new Date(d.getTime() + 86400000);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// merge the live LSTM prediction with the artifact + learned params
export function ensembleView(pred, params) {
  if (!pred || pred.error || !pred.next?.length) return null;
  const p = params || {};
  const tf = p.tf;
  // freshness: sessions in the live series newer than the artifact's as_of
  let gap = 0;
  for (const s of pred.series || []) if (s.d > (tf?.as_of || "")) gap++;
  const fresh = !!tf && gap <= 5;
  const horizon = Math.min(pred.next.length, fresh ? tf.path.length : 0) || pred.next.length;
  const w = fresh ? (p.w ?? 0.5) : 0;          // stale artifact -> LSTM only
  const bias = p.bias ?? 0;
  const lastClose = pred.last_close;
  const chg = (v) => +((100 * (v - lastClose) / lastClose).toFixed(2));

  const lstmC = pred.next.map((x) => +(x.value - bias).toFixed(2));
  const next = [];
  for (let i = 0; i < horizon; i++) {
    const lv = lstmC[i] ?? pred.next[i]?.value;
    const tv = fresh ? tf.path[i] : null;
    const v = +(w * (tv ?? 0) + (1 - w) * lv).toFixed(2);
    next.push({ d: pred.next[i]?.d || (tf?.dates?.[i] ?? ""), value: v, chg_pct_vs_last_close: chg(v) });
  }
  return {
    primary: fresh ? "ensemble" : "lstm-corrected",
    formula: "w * TimesFM + (1-w) * (LSTM - bias)",
    w: +w.toFixed(2), lstm_bias: bias,
    w_source: p.w_source || "artifact",
    tf_as_of: tf?.as_of || null, tf_fresh: fresh, artifact_lag_sessions: gap,
    fallback_note: fresh ? null
      : `TimesFM artifact of ${tf?.as_of || "n/a"} is ${gap} sessions stale (more than 5). Showing the bias corrected LSTM only until the offline TimesFM run is refreshed; see the README TimesFM section.`,
    next,
    components: {
      lstm_live: pred.next,
      lstm_corrected: pred.next.map((x, i) => ({ d: x.d, value: lstmC[i], chg_pct_vs_last_close: chg(lstmC[i]) })),
      timesfm: fresh ? tf.path.map((v, i) => ({ d: tf.dates?.[i] || next[i]?.d, value: v, chg_pct_vs_last_close: chg(v) })) : [],
    },
    backtest: MA.ensemble?.components || MA.comparison || null,
  };
}

// ---------------- scorecard (blob-backed learning loop) ----------------
const SC_KEY = "model-scorecard";

export async function loadScorecard(store) {
  try {
    const j = JSON.parse((await store.get(SC_KEY)) || "null");
    if (j && Array.isArray(j.entries)) return j;
  } catch { /* corrupted -> rebuild */ }
  return { entries: [], meta: {} };
}

export async function updateScorecard(store, pred) {
  const sc = await loadScorecard(store);
  const ens = pred?.ensemble;
  if (!pred || pred.error || !pred.next?.length) return sc;

  // 1) resolve pending entries against the actual closes we just fetched
  const closeByDate = {};
  for (const s of pred.series || []) closeByDate[s.d] = s.close;
  let nResolved = 0;
  for (const e of sc.entries) {
    if (e.actual != null || !closeByDate[e.d]) continue;
    e.actual = closeByDate[e.d];
    e.err_lstm = +(e.lstm - e.actual).toFixed(2);
    if (e.tf != null) e.err_tf = +(e.tf - e.actual).toFixed(2);
    if (e.ens != null) e.err_ens = +(e.ens - e.actual).toFixed(2);
    e.resolved_at = new Date().toISOString();
    nResolved++;
  }

  // 2) upsert the entry for the session we are predicting now
  const d0 = pred.next[0].d;
  const entry = sc.entries.find((e) => e.d === d0) || { d: d0, created_at: new Date().toISOString() };
  entry.lstm = pred.next[0].value;
  entry.tf = ens?.tf_fresh && ens.components.timesfm?.[0] ? ens.components.timesfm[0].value : null;
  entry.ens = ens?.next?.[0]?.value ?? null;
  entry.w = ens?.w ?? null;
  if (!sc.entries.includes(entry)) sc.entries.push(entry);
  sc.entries = sc.entries.sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-40);

  // 3) re-learn (w, bias) from resolved live evidence
  const res = sc.entries.filter((e) => e.actual != null && e.err_tf != null).slice(-30);
  let meta = { ...sc.meta, updated_at: new Date().toISOString() };
  if (res.length >= 5) {
    const liveBias = +(res.reduce((s, e) => s + e.err_lstm, 0) / res.length).toFixed(2);
    let best = null;
    for (let wi = 0; wi <= 20; wi++) {
      const w = wi / 20;
      let se = 0;
      for (const e of res) {
        const p = w * e.tf + (1 - w) * (e.lstm - liveBias);
        se += (p - e.actual) ** 2;
      }
      const rmse = Math.sqrt(se / res.length);
      if (!best || rmse < best.rmse) best = { w: +w.toFixed(2), rmse: +rmse.toFixed(2) };
    }
    meta = { ...meta, w_live: best.w, bias_live: liveBias, n_resolved: res.length,
             live_rmse: best.rmse, live_window: `${res[0].d}..${res[res.length - 1].d}` };
  }
  sc.meta = meta;
  await store.set(SC_KEY, JSON.stringify(sc));

  // 4) summary for the report/dashboard
  const recent = sc.entries.filter((e) => e.actual != null).slice(-5).reverse();
  return {
    n_pending: sc.entries.filter((e) => e.actual == null).length,
    n_resolved: sc.meta.n_resolved || sc.entries.filter((e) => e.actual != null).length,
    w_live: sc.meta.w_live ?? null, bias_live: sc.meta.bias_live ?? null,
    live_window: sc.meta.live_window || null,
    recent: recent.map((e) => ({
      d: e.d, actual: e.actual, lstm: e.lstm, tf: e.tf, ens: e.ens,
      err_lstm: e.err_lstm, err_tf: e.err_tf, err_ens: e.err_ens,
    })),
    note: nResolved ? `${nResolved} new entr${nResolved === 1 ? "y" : "ies"} resolved this run` : null,
  };
}
