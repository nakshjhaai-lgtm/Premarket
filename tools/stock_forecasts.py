#!/usr/bin/env python3
"""Per-stock TimesFM forecasts for the /stocks.html dashboard.

Universe: curated major symbols — US mega-caps & sector leaders, benchmark
ETFs, global ADRs, and Indian ADRs (NYSE-listed, USD).

For each symbol: 10y daily closes from Yahoo Finance, a 5-session forward
TimesFM forecast, and a 10-session one-step-ahead backtest (direction hit +
% RMSE). Everything is batched through TimesFM's forecast() inputs list.

Output: assets/stock-forecasts.json (an offline artifact — see README for the
refresh procedure; forecasts carry an explicit as_of stamp).

Run: /home/user/.venv/bin/python tools/stock_forecasts.py
"""
import json, time, datetime as dt
import urllib.request, urllib.error, urllib.parse

OUT = "/home/user/netlify-premarket/assets/stock-forecasts.json"
EOD_FILE = "/tmp/eod.json"   # optional: payload fetched via the temp AWS helper (see README)
HORIZON = 5
BT_N = 10          # backtest sessions per symbol
CONTEXT = 1024
CHUNK = 32
YEARS = 10
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}

# sym -> (display name, sector, region)
UNIVERSE = {
    # US mega-caps
    "NVDA":  ("NVIDIA Corp.",            "Semiconductors",  "US"),
    "MSFT":  ("Microsoft Corp.",         "Software",        "US"),
    "AAPL":  ("Apple Inc.",              "Consumer Tech",   "US"),
    "GOOGL": ("Alphabet Inc. (Class A)", "Internet",        "US"),
    "AMZN":  ("Amazon.com Inc.",         "Ecommerce and Cloud","US"),
    "META":  ("Meta Platforms Inc.",     "Internet",        "US"),
    "AVGO":  ("Broadcom Inc.",           "Semiconductors",  "US"),
    "TSLA":  ("Tesla Inc.",              "Auto/EV",         "US"),
    "BRK-B": ("Berkshire Hathaway B",    "Conglomerate",    "US"),
    "LLY":   ("Eli Lilly & Co.",         "Pharma",          "US"),
    "JPM":   ("JPMorgan Chase & Co.",    "Banks",           "US"),
    "V":     ("Visa Inc.",               "Payments",        "US"),
    "XOM":   ("Exxon Mobil Corp.",       "Oil & Gas",       "US"),
    "UNH":   ("UnitedHealth Group",      "Healthcare",      "US"),
    "WMT":   ("Walmart Inc.",            "Retail",          "US"),
    "MA":    ("Mastercard Inc.",         "Payments",        "US"),
    "ORCL":  ("Oracle Corp.",            "Software",        "US"),
    "COST":  ("Costco Wholesale",        "Retail",          "US"),
    # US sector leaders
    "JNJ":   ("Johnson & Johnson",       "Healthcare",      "US"),
    "NFLX":  ("Netflix Inc.",            "Streaming",       "US"),
    "AMD":   ("Advanced Micro Devices",  "Semiconductors",  "US"),
    "BAC":   ("Bank of America Corp.",   "Banks",           "US"),
    "KO":    ("Coca-Cola Co.",           "Beverages",       "US"),
    "MCD":   ("McDonald's Corp.",        "Restaurants",     "US"),
    "DIS":   ("Walt Disney Co.",         "Media",           "US"),
    "INTU":  ("Intuit Inc.",             "Software",        "US"),
    "CRM":   ("Salesforce Inc.",         "Software",        "US"),
    "ADBE":  ("Adobe Inc.",              "Software",        "US"),
    "CAT":   ("Caterpillar Inc.",        "Industrials",     "US"),
    "BA":    ("Boeing Co.",              "Aerospace",       "US"),
    "GE":    ("GE Aerospace",            "Aerospace",       "US"),
    "IBM":   ("IBM Corp.",               "IT Services",     "US"),
    "QCOM":  ("Qualcomm Inc.",           "Semiconductors",  "US"),
    # Benchmark ETFs
    "SPY":   ("SPDR S&P 500 ETF",        "Index ETF",       "US"),
    "QQQ":   ("Invesco QQQ (Nasdaq 100)","Index ETF",       "US"),
    "DIA":   ("SPDR Dow Jones ETF",      "Index ETF",       "US"),
    # Global ADRs (NYSE/Nasdaq-listed, USD)
    "TSM":   ("TSMC ADR (Taiwan)",       "Semiconductors",  "Taiwan"),
    "ASML":  ("ASML Holding ADR (NL)",   "Semis Equipment", "Netherlands"),
    "SAP":   ("SAP SE ADR (Germany)",    "Software",        "Germany"),
    "BABA":  ("Alibaba ADR (China)",     "Ecommerce",      "China"),
    "TM":    ("Toyota Motor ADR (Japan)","Auto",            "Japan"),
    "SONY":  ("Sony Group ADR (Japan)",  "Consumer Tech",   "Japan"),
    "SHEL":  ("Shell plc ADR (UK)",      "Oil & Gas",       "UK"),
    "RIO":   ("Rio Tinto ADR (UK/AU)",   "Mining",          "UK/Australia"),
    "NVO":   ("Novo Nordisk ADR (DK)",   "Pharma",          "Denmark"),
    # Indian ADRs (NYSE-listed, USD)
    "INFY":  ("Infosys ADR",             "IT Services",     "India"),
    "WIT":   ("Wipro ADR",               "IT Services",     "India"),
    "HDB":   ("HDFC Bank ADR",           "Banks",           "India"),
    "IBN":   ("ICICI Bank ADR",          "Banks",           "India"),
    "GS":    ("Goldman Sachs Group",      "Investment Bank", "US"),
}

import http.cookiejar, random, time, os

_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_jar))

YEARS_BACK = 5  # Nasdaq historical gives ~5y per call; that fully covers
                # TimesFM's 1024-session context (~4.1 trading years)

# Nasdaq API symbol quirks (the API is exchange-agnostic despite the name)
NASDAQ_SYM = {"BRK-B": "BRK.B"}
NASDAQ_ETF = {"SPY", "QQQ", "DIA"}

def _http_json(url, timeout=40):
    req = urllib.request.Request(url, headers={**UA, "Accept": "application/json"})
    with _opener.open(req, timeout=timeout) as r:
        return json.load(r)

def fetch_nasdaq(sym):
    """Nasdaq's public quote API: ~5y of daily OHLC in one call, no key."""
    nsym = NASDAQ_SYM.get(sym, sym)
    ac = "etf" if sym in NASDAQ_ETF else "stocks"
    end = dt.date.today()
    start = end - dt.timedelta(days=int(365.25 * YEARS_BACK) + 30)
    url = (f"https://api.nasdaq.com/api/quote/{urllib.parse.quote(nsym)}/historical"
           f"?assetclass={ac}&fromdate={start.isoformat()}&todate={end.isoformat()}&limit=9999")
    j = _http_json(url)
    rows = (((j.get("data") or {}).get("tradesTable") or {}).get("rows")) or []
    out = []
    for r in rows:  # newest-first; close like "$214.13"
        d = r.get("date", "")
        c = str(r.get("close", "")).replace("$", "").replace(",", "")
        try:
            m, dd, y = d.split("/")
            out.append((f"{y}-{int(m):02d}-{int(dd):02d}", float(c)))
        except Exception:
            continue
    out.reverse()  # ascending
    return out

def fetch_yahoo(sym, host="query1"):
    p1 = int((dt.datetime.now() - dt.timedelta(days=365 * YEARS_BACK)).timestamp())
    url = (f"https://{host}.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}"
           f"?period1={p1}&period2={int(dt.datetime.now().timestamp())}&interval=1d")
    req = urllib.request.Request(url, headers=UA)
    with _opener.open(req, timeout=30) as r:
        j = json.load(r)
    res = j["chart"]["result"][0]
    ts, q = res["timestamp"], res["indicators"]["quote"][0]
    return [(dt.datetime.fromtimestamp(t, dt.timezone.utc).date().isoformat(), q["close"][i])
            for i, t in enumerate(ts) if q["close"][i] is not None]

AV_STATE = {"used": 0, "max": 25}

def fetch_alphavantage(sym):
    """Last resort: the user's Alpha Vantage free key — 25 requests/day.
    The key is read strictly from the AV_KEY environment variable and is never
    stored in this repo (secrets policy: PROJECT_BRAIN.md section 17)."""
    key = os.environ.get("AV_KEY", "")
    if not key:
        raise RuntimeError("AV_KEY environment variable not set (Alpha Vantage key is never committed)")
    if AV_STATE["used"] >= AV_STATE["max"]:
        raise RuntimeError("AV daily quota exhausted")
    AV_STATE["used"] += 1
    j = _http_json(f"https://www.alphavantage.co/query?function=TIME_SERIES_DAILY"
                   f"&symbol={urllib.parse.quote(sym)}&outputsize=full&apikey={key}")
    ts = j.get("Time Series (Daily)") or {}
    return sorted((d, float(v["4. close"])) for d, v in ts.items())

def _from_eod_file():
    if not os.path.exists(EOD_FILE):
        return None
    raw = json.load(open(EOD_FILE))
    out = {}
    for sym, rows in raw.items():
        out[sym] = [((dt.date(1970, 1, 1) + dt.timedelta(days=int(d))).isoformat(), float(c)) for d, c in rows]
    print(f"loaded {len(out)} symbols from {EOD_FILE} (AWS helper payload)", flush=True)
    return out

def load_data_compat():
    """Source order: AWS-helper payload -> Nasdaq -> Yahoo -> Alpha Vantage."""
    got = _from_eod_file()
    if got is not None:
        return got
    data = {}
    for k, sym in enumerate(UNIVERSE, 1):
        rows, src = None, None
        for source, fn in (("nasdaq", fetch_nasdaq), ("yahoo", fetch_yahoo), ("av", fetch_alphavantage)):
            tries = 1 if source == "av" else 2
            for attempt in range(tries):
                try:
                    rows = fn(sym) if source != "yahoo" else fn(sym, host=("query1" if attempt % 2 == 0 else "query2"))
                    if not rows or len(rows) < 320:
                        raise RuntimeError(f"only {len(rows) if rows else 0} rows")
                    src = source
                    break
                except Exception as e:
                    msg = str(getattr(e, "reason", None) or e)
                    if attempt < tries - 1:
                        time.sleep(2 + random.random() * 3)
                    else:
                        print(f"  {sym}: {source} failed ({msg[:60]})", flush=True)
            if rows and len(rows) >= 320:
                break
        if rows and len(rows) >= 320:
            data[sym] = rows
            print(f"[{k}/{len(UNIVERSE)}] {sym}: {len(rows)} sessions via {src} -> {rows[-1]}", flush=True)
        else:
            print(f"[{k}/{len(UNIVERSE)}] {sym}: FAILED (all sources)", flush=True)
        time.sleep(1.0 + random.random() * 0.6)
    return data

def main():
    import numpy as np
    import timesfm

    print(f"universe: {len(UNIVERSE)} symbols", flush=True)
    data = load_data_compat()
    if not data:
        raise SystemExit("no data fetched")

    print("loading timesfm...", flush=True)
    model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
        "google/timesfm-2.5-200m-pytorch", torch_compile=False)
    model.compile(timesfm.ForecastConfig(
        max_context=CONTEXT, max_horizon=HORIZON, normalize_inputs=True,
        use_continuous_quantile_head=False, force_flip_invariance=True,
        infer_is_positive=True, fix_quantile_crossing=False))

    def batch_forecast(contexts, horizon):
        out = []
        for i in range(0, len(contexts), CHUNK):
            point, _ = model.forecast(horizon=horizon, inputs=contexts[i:i + CHUNK])
            out.extend(np.asarray(p, dtype=np.float64) for p in point)
        return out

    syms = list(data)
    # forward forecasts for all symbols — one batched pass
    t0 = dt.datetime.now()
    fwd = batch_forecast([np.asarray([c for _, c in data[s][-CONTEXT:]], dtype=np.float64)
                          for s in syms], HORIZON)
    print(f"forward pass: {len(syms)} symbols in {(dt.datetime.now()-t0).total_seconds():.0f}s", flush=True)

    # per-symbol 10-session backtest — one big batched pass
    t0 = dt.datetime.now()
    bt_ctx, bt_owner = [], []
    for s in syms:
        closes = [c for _, c in data[s]]
        for i in range(len(closes) - BT_N, len(closes)):
            bt_ctx.append(np.asarray(closes[max(0, i - CONTEXT):i], dtype=np.float64))
            bt_owner.append(s)
    bt_preds = batch_forecast(bt_ctx, 1)
    print(f"backtest pass: {len(bt_ctx)} contexts in {(dt.datetime.now()-t0).total_seconds():.0f}s", flush=True)
    bt = {s: [] for s in syms}
    for s, p in zip(bt_owner, bt_preds):
        bt[s].append(float(p[0]))

    def next_days(last, n):
        out, d = [], dt.date.fromisoformat(last)
        while len(out) < n:
            d += dt.timedelta(days=1)
            if d.weekday() < 5:
                out.append(d.isoformat())
        return out

    stocks = []
    for s in syms:
        rows = data[s]
        closes = [c for _, c in rows]
        last, prev = closes[-1], closes[-2]
        as_of = rows[-1][0]
        path = [round(float(v), 4) for v in fwd[syms.index(s)]]
        # backtest stats
        n = BT_N
        acts = closes[-n:]
        preds = bt[s]
        prevs = closes[-n - 1:-1]
        rmse = (sum((p - a) ** 2 for p, a in zip(preds, acts)) / n) ** 0.5
        hit = sum(1 for p, a, pv in zip(preds, acts, prevs) if (p - pv) * (a - pv) > 0)
        stocks.append({
            "sym": s, "name": UNIVERSE[s][0], "sector": UNIVERSE[s][1],
            "region": UNIVERSE[s][2], "currency": "USD",
            "as_of": as_of, "last": round(last, 4),
            "chg_1d_pct": round((last - prev) / prev * 100, 2),
            "path": path,
            "path_dates": next_days(as_of, HORIZON),
            "next_pct": round((path[0] - last) / last * 100, 2),
            "pct_5d": round((path[-1] - last) / last * 100, 2),
            "bt": {"n": n, "rmse_pct": round(rmse / last * 100, 3),
                   "hit": f"{hit}/{n}"},
            "spark": [round(c, 2) for c in closes[-60:]],
        })
        print(f"{s:6s} last {last:>10.2f}  next {path[0]:>10.2f} ({stocks[-1]['next_pct']:+.2f}%)"
              f"  5d {stocks[-1]['pct_5d']:+.2f}%  bt hit {hit}/{n}", flush=True)

    stocks.sort(key=lambda x: x["sym"])
    payload = {
        "as_of": max(s["as_of"] for s in stocks),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "model": "google/timesfm-2.5-200m-pytorch (zero-shot, horizon 5 sessions)",
        "count": len(stocks),
        "failed": [s for s in UNIVERSE if s not in data],
        "stocks": stocks,
    }
    json.dump(payload, open(OUT, "w"), indent=1)
    print(f"wrote {OUT}: {len(stocks)} stocks, as_of {payload['as_of']}, failed={payload['failed']}", flush=True)

if __name__ == "__main__":
    main()
