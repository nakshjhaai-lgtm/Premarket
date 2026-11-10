// Build assets/model-analysis.json v2 — TimesFM vs LSTM vs LEARNED ENSEMBLE.
//
// The ensemble is *learned*, not hand-tuned: on a WALK-session walk-forward
// window (both models scored on identical one-step-ahead predictions) we grid-
// search the blend weight w and the LSTM bias correction that minimize RMSE:
//     ensemble(t+1) = w * TimesFM(t+1) + (1-w) * (LSTM(t+1) - bias)
// We also report each half of the window separately so the dashboard can show
// whether the learned weight is stable over time.
//
//   node tools/build-model-analysis.mjs      (expects /tmp/timesfm-raw.json
//                                             with walk_forward over WALK=250)
import { readFileSync, writeFileSync } from "node:fs";
import { decodePackedModel, LstmForecaster } from "../lib/lstm.mjs";
import { PACKED } from "../lib/model-nifty.mjs";

const raw = JSON.parse(readFileSync("/tmp/timesfm-raw.json", "utf8"));
const fc = new LstmForecaster(decodePackedModel(PACKED));

// rebuild the scaled mid-price series exactly like lib/scan.niftyPrediction
const now = Date.now();
const p1 = Math.floor((now - 500 * 86400000) / 1000);
const p2 = Math.floor(now / 1000);
const d = await (await fetch(
  `https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?period1=${p1}&period2=${p2}&interval=1d`,
  { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
)).json();
const r = d.chart.result[0];
const todayIst = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const mids = [];
for (let i = 0; i < (r.timestamp || []).length; i++) {
  const dt = new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10);
  if (dt === todayIst) continue;
  const h = r.indicators.quote[0].high[i], l = r.indicators.quote[0].low[i];
  if (h == null || l == null) continue;
  mids.push((h + l) / 2);
}
const scaled = mids.map((m) => fc.scale(m));

// ---------- walk-forward window (both models, identical protocol) ----------
const W = raw.walk_forward.dates.length;
const wfDates = raw.walk_forward.dates, wfPredsTf = raw.walk_forward.preds,
      wfActuals = raw.walk_forward.actuals;
const startIdx = mids.length - W;              // mids[startIdx + j] = actual of date j
const lstmWf = fc.backtest(scaled, W).map((x) => fc.unscale(x.pred));
const prevMids = wfDates.map((_, j) => mids[startIdx + j - 1]);

const stats = (preds) => {
  let se = 0, ae = 0, hits = 0;
  for (let j = 0; j < W; j++) {
    const e = preds[j] - wfActuals[j];
    se += e * e; ae += Math.abs(e);
    const pd = preds[j] - prevMids[j], ad = wfActuals[j] - prevMids[j];
    if ((pd > 0 && ad > 0) || (pd < 0 && ad < 0)) hits++;
  }
  return { rmse: +(Math.sqrt(se / W)).toFixed(2), mae: +(ae / W).toFixed(2),
           hit_rate: +(hits / W).toFixed(3), points: W };
};

const lstmStats = stats(lstmWf);
const tfStats = stats(wfPredsTf);

// ---------- LEARN: bias correction + blend weight ----------
const lstmBias = +(lstmWf.reduce((s, p, j) => s + (p - wfActuals[j]), 0) / W).toFixed(2);
const lstmCWf = lstmWf.map((p) => p - lstmBias);
const lstmCStats = stats(lstmCWf);

const learn = (idx) => {
  // idx: array of window indices to learn on
  let best = null;
  for (let wi = 0; wi <= 100; wi++) {
    const w = wi / 100;
    let se = 0;
    for (const j of idx) {
      const e = (w * wfPredsTf[j] + (1 - w) * lstmCWf[j]) - wfActuals[j];
      se += e * e;
    }
    const rmse = Math.sqrt(se / idx.length);
    if (!best || rmse < best.rmse) best = { w: +w.toFixed(2), rmse: +rmse.toFixed(2) };
  }
  return best;
};
const allIdx = wfDates.map((_, j) => j);
const half = Math.floor(W / 2);
const learnAll = learn(allIdx);
const learnFirst = learn(allIdx.slice(0, half));
const learnSecond = learn(allIdx.slice(half));

const ensWf = allIdx.map((j) => learnAll.w * wfPredsTf[j] + (1 - learnAll.w) * lstmCWf[j]);
const ensStats = stats(ensWf);

// ---------- forward paths ----------
const lstmPath = fc.predictFrom(scaled, scaled.length, 5).map((s) => +fc.unscale(s).toFixed(2));
const tfPath = raw.forecast;
const ensPath = tfPath.map((v, i) => +(learnAll.w * v + (1 - learnAll.w) * (lstmPath[i] - lstmBias)).toFixed(2));

// last regular-session CLOSE (same reference the live scan's chg uses)
let lastClose = null;
{
  const q = r.indicators.quote[0];
  for (let i = (r.timestamp || []).length - 1; i >= 0; i--) {
    const dt = new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10);
    if (dt === todayIst) continue;
    if (q.close?.[i] != null) { lastClose = +q.close[i].toFixed(2); break; }
  }
  if (lastClose === null) lastClose = +mids[mids.length - 1].toFixed(2);
}

const out = {
  as_of: raw.as_of,
  generated_at: raw.generated_at,
  last_close: lastClose,
  timesfm: { model: raw.model, forecast: tfPath, horizon_dates: raw.horizon_dates,
    backtest: tfStats, timings_ms: raw.timings_ms },
  lstm_live_next: { value: lstmPath[0], chg: +((100 * (lstmPath[0] - lastClose) / lastClose).toFixed(2)) },
  // the learned adaptive ensemble — PRIMARY model going forward
  ensemble: {
    formula: "w * TimesFM + (1-w) * (LSTM - bias)",
    w: learnAll.w,
    lstm_bias: lstmBias,
    backtest: ensStats,
    forward_path: ensPath,
    learned_on: { sessions: W, window: `${wfDates[0]}..${wfDates[W - 1]}` },
    stability: { first_half: { sessions: half, ...learnFirst },
                 second_half: { sessions: W - half, ...learnSecond } },
    components: {
      lstm_raw: lstmStats, lstm_bias_corrected: lstmCStats, timesfm: tfStats,
    },
  },
  comparison: {
    window: W,
    lstm: { ...lstmStats, path: lstmPath },
    timesfm: tfStats,
    rows: wfDates.slice(-30).map((dte, k) => {
      const j = W - 30 + k;
      return { d: dte, actual: wfActuals[j], lstm_pred: +lstmWf[j].toFixed(2),
               timesfm_pred: wfPredsTf[j], ensemble_pred: +ensWf[j].toFixed(2) };
    }),
  },
};
out.forecast = tfPath; // top-level alias (viewer reads timesfm.forecast first)
writeFileSync("assets/model-analysis.json", JSON.stringify(out));

console.log(`as_of ${out.as_of} | walk window ${W} sessions (${wfDates[0]}..${wfDates[W - 1]})`);
console.log(`LSTM raw:        rmse ${lstmStats.rmse} mae ${lstmStats.mae} hit ${lstmStats.hit_rate}`);
console.log(`LSTM corrected:  rmse ${lstmCStats.rmse} mae ${lstmCStats.mae} hit ${lstmCStats.hit_rate} (bias ${lstmBias})`);
console.log(`TimesFM:         rmse ${tfStats.rmse} mae ${tfStats.mae} hit ${tfStats.hit_rate}`);
console.log(`ENSEMBLE w=${learnAll.w}: rmse ${ensStats.rmse} mae ${ensStats.mae} hit ${ensStats.hit_rate}`);
console.log(`stability: first half w=${learnFirst.w} (rmse ${learnFirst.rmse}), second half w=${learnSecond.w} (rmse ${learnSecond.rmme ?? learnSecond.rmse})`);
console.log(`forward: LSTM ${lstmPath.join(" -> ")}`);
console.log(`forward: TF   ${tfPath.join(" -> ")}`);
console.log(`forward: ENS  ${ensPath.join(" -> ")}`);
