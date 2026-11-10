// Feature builder for the per stock GBM model. Ported 1:1 from
// adaptive-stocks/build_features.py; parity is asserted by
// adaptive-stocks/parity_check.mjs (max diff < 1e-9 on 300 real rows).
// All series are oldest-first arrays: { d: ["2026-01-02", ...], c: [close...], v: [volume...] }
export const FEATURES = ["r1","r2","r3","r5","r10","r20","vol5","vol20","ma5","ma20","ma50","rsi14",
 "volz20","relspy5","relspy20","spyr1","spyr5","spyr20","qqqr1",
 "vix","vixr1","vixr5","vixpct","secr1","secr5","dow"];

export const SECTOR = {
 NVDA:"XLK",MSFT:"XLK",AAPL:"XLK",AVGO:"XLK",ORCL:"XLK",IBM:"XLK",QCOM:"XLK",
 AMD:"XLK",TSM:"XLK",ASML:"XLK",SAP:"XLK",CRM:"XLK",ADBE:"XLK",INTU:"XLK",
 INFY:"XLK",WIT:"XLK",
 META:"XLC",GOOGL:"XLC",NFLX:"XLC",DIS:"XLC",
 AMZN:"XLY",TSLA:"XLY",MCD:"XLY",BABA:"XLY",TM:"XLY",SONY:"XLY",
 KO:"XLP",WMT:"XLP",COST:"XLP",
 LLY:"XLV",UNH:"XLV",JNJ:"XLV",NVO:"XLV",
 "BRK-B":"XLF",JPM:"XLF",V:"XLF",MA:"XLF",BAC:"XLF",GS:"XLF",IBN:"XLF",HDB:"XLF",
 XOM:"XLE",SHEL:"XLE",
 RIO:"XLB",CAT:"XLI",GE:"XLI",
 SPY:"SPY",QQQ:"QQQ",DIA:"DIA",
};

// latest index in ascending dates with d[idx] <= target; -1 if none
export function bisectDate(dates, target) {
  let lo = 0, hi = dates.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= target) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function pct(a, n) {                       // % change over last n closes
  if (a.length < n + 1) return NaN;
  const last = a[a.length - 1], prev = a[a.length - 1 - n];
  return 100 * (last - prev) / prev;
}
function popStd(arr) {                     // population std (numpy default)
  if (!arr.length) return NaN;
  const m = arr.reduce((s, x) => s + x, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) * (x - m), 0) / arr.length);
}
function rsi14(c) {
  if (c.length < 15) return NaN;
  let up = 0, dn = 0;
  for (let i = c.length - 14; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    if (d > 0) up += d; else dn -= d;
  }
  up /= 14; dn /= 14;
  return 100 - 100 / (1 + (dn > 0 ? up / dn : 4));
}

export function featureRow(sym, date, hist) {
  const h = hist[sym];
  if (!h) return null;
  const i = bisectDate(h.d, date);
  if (i < 50) return null;                        // need >= 51 sessions
  const d = h.d, c = h.c, v = h.v;
  const cs = c.slice(0, i + 1), vs = v.slice(0, i + 1);
  const r = {};
  r.r1 = pct(cs, 1); r.r2 = pct(cs, 2); r.r3 = pct(cs, 3); r.r5 = pct(cs, 5);
  r.r10 = pct(cs, 10); r.r20 = pct(cs, 20);
  const base = cs.slice(-21);
  const rets = [];
  for (let k = 1; k < base.length; k++) rets.push((base[k] - base[k - 1]) / base[k - 1]);
  r.vol5 = popStd(rets.slice(-5)) * 100;
  r.vol20 = popStd(rets) * 100;
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  r.ma5 = 100 * (cs[cs.length - 1] / mean(cs.slice(-5)) - 1);
  r.ma20 = 100 * (cs[cs.length - 1] / mean(cs.slice(-20)) - 1);
  r.ma50 = 100 * (cs[cs.length - 1] / mean(cs.slice(-50)) - 1);
  r.rsi14 = rsi14(cs);
  const v20 = vs.slice(-20);
  const vsd = popStd(v20);
  r.volz20 = v20.length === 20 && vsd > 0 ? (v20[v20.length - 1] - mean(v20)) / vsd : NaN;
  const spy = hist.SPY, qqq = hist.QQQ, vix = hist.VIX;
  const si = spy ? bisectDate(spy.d, date) : -1;
  const qi = qqq ? bisectDate(qqq.d, date) : -1;
  if (si < 20 || qi < 0) return null;
  const scs = spy.c.slice(0, si + 1), qcs = qqq.c.slice(0, qi + 1);
  r.relspy5 = r.r5 - pct(scs, 5); r.relspy20 = r.r20 - pct(scs, 20);
  r.spyr1 = pct(scs, 1); r.spyr5 = pct(scs, 5); r.spyr20 = pct(scs, 20);
  r.qqqr1 = pct(qcs, 1);
  const vi = vix ? bisectDate(vix.d, date) : -1;
  if (vi < 5) return null;
  const vc = vix.v.slice(0, vi + 1);
  r.vix = vc[vc.length - 1];
  r.vixr1 = vc.length > 1 ? vc[vc.length - 1] - vc[vc.length - 2] : NaN;
  r.vixr5 = vc.length > 5 ? vc[vc.length - 1] - vc[vc.length - 6] : NaN;
  const w = vc.length >= 252 ? vc.slice(-252) : vc;
  const cur = vc[vc.length - 1];
  r.vixpct = 100 * w.filter((x) => x <= cur).length / w.length;
  const sec = hist[SECTOR[sym] || "SPY"];
  r.secr1 = NaN; r.secr5 = NaN;
  if (sec) {
    const ei = bisectDate(sec.d, date);
    if (ei >= 5) {
      const ecs = sec.c.slice(0, ei + 1);
      r.secr1 = pct(ecs, 1); r.secr5 = pct(ecs, 5);
    }
  }
  r.dow = new Date(date + "T00:00:00Z").getUTCDay();
  return FEATURES.map((f) => (r[f] === undefined ? NaN : r[f]));
}

// ---------------- GBM inference (trees from lib/gbm-model.json) ----------------
import MODEL from "./gbm-model.json" with { type: "json" };
const FEAT_INDEX = Object.fromEntries(MODEL.features.map((f, i) => [f, i]));

function walk(node, x) {
  if (node.length === 1) return node[0];
  const f = node[0], thr = node[1], dl = node[2], l = node[3], r = node[4];
  const v = x[f];
  if (Number.isNaN(v)) return walk(dl ? l : r, x);
  return walk(v <= thr ? l : r, x);
}

// x: feature array in FEATURES order (may contain NaN)
export function gbmPredict(x) {
  let s = MODEL.init || 0;
  for (const t of MODEL.trees) s += walk(t, x);
  return s;                                       // predicted next session return, %
}
export function gbmFeatureNames() { return MODEL.features; }
export { FEAT_INDEX };
