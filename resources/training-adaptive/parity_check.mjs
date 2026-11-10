// JS vs Python parity: features AND GBM predictions on 300 real rows
import { featureRow, gbmPredict } from "/home/user/netlify-premarket/lib/stock-features.mjs";
import fs from "fs";

const SYMS = "NVDA MSFT AAPL GOOGL AMZN META AVGO TSLA BRK-B LLY JPM V XOM UNH WMT MA ORCL COST JNJ NFLX AMD BAC KO MCD DIS INTU CRM ADBE CAT BA GE IBM QCOM SPY QQQ DIA TSM ASML SAP BABA TM SONY SHEL RIO NVO INFY WIT HDB IBN GS".split(" ");
const ETFS = "SPY QQQ DIA XLK XLC XLY XLP XLV XLF XLE XLB XLI XLU XLRE".split(" ");
const hist = {};
const conv = (rows) => {
  const c = rows.map(([md, cl, v]) => {
    const [m, dd, y] = md.split("/");
    return [`${y}-${m.padStart(2, "0")}-${dd.padStart(2, "0")}`, cl, v];
  }).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { d: c.map((r) => r[0]), c: c.map((r) => r[1]), v: c.map((r) => r[2]) };
};
for (const s of SYMS) hist[s] = conv(JSON.parse(fs.readFileSync(`data/nasdaq_${s}.json`)).rows);
for (const s of ETFS) hist[s] = conv(JSON.parse(fs.readFileSync(`data/nasdaq_${s}.json`)).rows);
hist.VIX = (() => {
  const lines = fs.readFileSync("data/VIX_History.csv", "utf8").split("\n").slice(1).filter(Boolean);
  const d = [], v = [];
  for (const ln of lines) {
    const p = ln.split(",");
    const [m, dd, y] = p[0].split("/");
    d.push(`${y}-${m.padStart(2, "0")}-${dd.padStart(2, "0")}`); v.push(parseFloat(p[4]));
  }
  return { d, v };
})();

const rows = JSON.parse(fs.readFileSync("test_features.json"));
let maxFeat = 0, maxPred = 0, featNaN = 0, n = 0;
for (const r of rows) {
  const f = featureRow(r.sym, r.d, hist);
  if (!f) { console.log("SKIP (null row)", r.sym, r.d); continue; }
  n++;
  for (let k = 0; k < f.length; k++) {
    const a = f[k], b = r.f[k];
    if (Number.isNaN(a) && b === null) { featNaN++; continue; }
    if (Number.isNaN(a) || b === null) { console.log("MISMATCH NaN", r.sym, r.d, k, a, b); process.exit(1); }
    maxFeat = Math.max(maxFeat, Math.abs(a - b));
  }
  const p = gbmPredict(f);
  maxPred = Math.max(maxPred, Math.abs(p - r.pypred));
}
console.log(`rows checked: ${n} | feature max diff: ${maxFeat.toExponential(2)} | prediction max diff: ${maxPred.toExponential(2)} | NaN-agreements: ${featNaN}`);
console.log((maxFeat < 1e-8 && maxPred < 1e-6) ? "PARITY_OK" : "PARITY_FAILED");
