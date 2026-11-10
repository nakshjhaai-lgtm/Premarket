import json, math, pathlib
import numpy as np

STOCKS = "NVDA MSFT AAPL GOOGL AMZN META AVGO TSLA BRK-B LLY JPM V XOM UNH WMT MA ORCL COST JNJ NFLX AMD BAC KO MCD DIS INTU CRM ADBE CAT BA GE IBM QCOM SPY QQQ DIA TSM ASML SAP BABA TM SONY SHEL RIO NVO INFY WIT HDB IBN GS".split()
ETFS = "SPY QQQ DIA XLK XLC XLY XLP XLV XLF XLE XLB XLI XLU XLRE".split()
SECTOR = {  # stock -> sector ETF used as its "other thing that affects it"
 "NVDA":"XLK","MSFT":"XLK","AAPL":"XLK","AVGO":"XLK","ORCL":"XLK","IBM":"XLK","QCOM":"XLK",
 "AMD":"XLK","TSM":"XLK","ASML":"XLK","SAP":"XLK","CRM":"XLK","ADBE":"XLK","INTU":"XLK",
 "INFY":"XLK","WIT":"XLK",
 "META":"XLC","GOOGL":"XLC","NFLX":"XLC","DIS":"XLC",
 "AMZN":"XLY","TSLA":"XLY","MCD":"XLY","BABA":"XLY","TM":"XLY","SONY":"XLY",
 "KO":"XLP","WMT":"XLP","COST":"XLP",
 "LLY":"XLV","UNH":"XLV","JNJ":"XLV","NVO":"XLV",
 "BRK-B":"XLF","JPM":"XLF","V":"XLF","MA":"XLF","BAC":"XLF","GS":"XLF","IBN":"XLF","HDB":"XLF",
 "XOM":"XLE","SHEL":"XLE",
 "RIO":"XLB","CAT":"XLI","GE":"XLI",
 "SPY":"SPY","QQQ":"QQQ","DIA":"DIA",
}
FEATURES = ["r1","r2","r3","r5","r10","r20","vol5","vol20","ma5","ma20","ma50","rsi14",
 "volz20","relspy5","relspy20","spyr1","spyr5","spyr20","qqqr1",
 "vix","vixr1","vixr5","vixpct","secr1","secr5","dow"]

def load(sym):
    d = json.loads(pathlib.Path(f"data/nasdaq_{sym}.json").read_text())
    rows = d["rows"]            # newest first: [m/d/Y, close, volume]
    conv = []
    for md, c, v in rows:
        m, dd, y = md.split("/")
        conv.append((f"{y}-{int(m):02d}-{int(dd):02d}", c, v))
    conv.sort(key=lambda r: r[0])            # oldest first, ISO dates sort correctly
    dates = [r[0] for r in conv]
    assert dates == sorted(dates), "dates not monotonic"
    return dates, np.array([r[1] for r in conv]), np.array([r[2] for r in conv], dtype=float)

def pct(a, n=1):  # a: array oldest-first, value at last index = today
    if len(a) < n + 1: return np.nan
    return 100.0 * (a[-1] - a[-1-n]) / a[-1-n]

def rsi(closes, n=14):
    if len(closes) < n + 1: return np.nan
    d = np.diff(closes[-(n+1):])
    up = d[d > 0].sum() / n; dn = -d[d < 0].sum() / n
    return 100.0 - 100.0 / (1 + (up/dn if dn > 0 else 4.0))

def feat_row(sym, i, ctx):
    """features for session i of sym (>= warmup), using data up to i only"""
    d, c, v = ctx[sym]
    s = slice(0, i+1); cs = c[s]; vs = v[s]
    if len(cs) < 51: return None
    r = {"r1": pct(cs,1), "r2": pct(cs,2), "r3": pct(cs,3), "r5": pct(cs,5),
         "r10": pct(cs,10), "r20": pct(cs,20)}
    rets = np.diff(cs[-21:]) / cs[-21:-1]
    r["vol5"] = float(rets[-5:].std() * 100); r["vol20"] = float(rets.std() * 100)
    r["ma5"] = 100.0*(cs[-1]/cs[-5:].mean()-1); r["ma20"] = 100.0*(cs[-1]/cs[-20:].mean()-1)
    r["ma50"] = 100.0*(cs[-1]/cs[-50:].mean()-1)
    r["rsi14"] = rsi(cs)
    v20 = vs[-20:]
    if len(v20) == 20 and v20.std() > 0: r["volz20"] = float((v20[-1]-v20.mean())/v20.std())
    else: r["volz20"] = np.nan
    sd, sc, _ = ctx["SPY"]; qd, qc, _ = ctx["QQQ"]
    spy_i = bisect_date(sd, d[i]); q_i = bisect_date(qd, d[i])
    if spy_i is None or q_i is None or spy_i < 20: return None
    scs = sc[:spy_i+1]; qcs = qc[:q_i+1]
    r["relspy5"] = r["r5"] - pct(scs,5); r["relspy20"] = r["r20"] - pct(scs,20)
    r["spyr1"] = pct(scs,1); r["spyr5"] = pct(scs,5); r["spyr20"] = pct(scs,20)
    r["qqqr1"] = pct(qcs,1)
    vd, vc = ctx["VIX"]; v_i = bisect_date(vd, d[i])
    if v_i is None or v_i < 5: return None
    vcs = vc[:v_i+1]
    r["vix"] = float(vcs[-1]); r["vixr1"] = float(vcs[-1]-vcs[-2]) if len(vcs)>1 else np.nan
    r["vixr5"] = float(vcs[-1]-vcs[-6]) if len(vcs)>5 else np.nan
    w = vcs[-252:] if len(vcs) >= 252 else vcs
    r["vixpct"] = float(100.0 * (w <= vcs[-1]).sum() / len(w))
    sec = SECTOR.get(sym, "SPY")
    if sec in ctx:
        ed, ec, _ = ctx[sec]; e_i = bisect_date(ed, d[i])
        if e_i is not None and e_i >= 5:
            ecs = ec[:e_i+1]
            r["secr1"] = pct(ecs,1); r["secr5"] = pct(ecs,5)
    r.setdefault("secr1", np.nan); r.setdefault("secr5", np.nan)
    r["dow"] = int(__import__("datetime").date.fromisoformat(d[i]).weekday()) + 1
    return r

def bisect_date(dates, target):
    """index of latest date <= target (dates ascending)"""
    lo, hi = 0, len(dates)-1; ans = None
    while lo <= hi:
        mid = (lo+hi)//2
        if dates[mid] <= target: ans = mid; lo = mid+1
        else: hi = mid-1
    return ans

def build():
    ctx = {}
    for sym in STOCKS + ETFS:
        ctx[sym] = load(sym)
    vd = []; vc = []
    for line in pathlib.Path("data/VIX_History.csv").read_text().splitlines()[1:]:
        m, dd, y = line.split(",")[0].split("/"); v = float(line.split(",")[4])
        vd.append(f"{y}-{int(m):02d}-{int(dd):02d}"); vc.append(v)
    ctx["VIX"] = (vd, np.array(vc))
    X, y, meta = [], [], []
    for sym in STOCKS:
        d, c, v = ctx[sym]
        for i in range(len(c)-1):          # need next close as label
            fr = feat_row(sym, i, ctx)
            if fr is None: continue
            nxt = c[i+1]; cur = c[i]
            if not (nxt > 0 and cur > 0): continue
            X.append([fr[f] for f in FEATURES]); y.append(100.0*(nxt-cur)/cur)
            meta.append({"sym": sym, "d": d[i]})
    return np.array(X, dtype=float), np.array(y), meta, ctx

if __name__ == "__main__":
    X, y, meta, ctx = build()
    dates = [m["d"] for m in meta]
    print("rows:", len(X), "| features:", len(FEATURES))
    print("span:", min(dates), "->", max(dates))
    print("labels: mean %.4f%% std %.3f%% | up days: %.1f%%" % (y.mean(), y.std(), (y>0).mean()*100))
    np.save("X.npy", X); np.save("y.npy", y)
    json.dump(meta, open("meta.json","w"))
    json.dump(FEATURES, open("features.json","w"))
