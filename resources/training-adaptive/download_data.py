import json, time, urllib.request, pathlib, sys

STOCKS = "NVDA MSFT AAPL GOOGL AMZN META AVGO TSLA BRK-B LLY JPM V XOM UNH WMT MA ORCL COST JNJ NFLX AMD BAC KO MCD DIS INTU CRM ADBE CAT BA GE IBM QCOM TSM ASML SAP BABA TM SONY SHEL RIO NVO INFY WIT HDB IBN GS".split()
ETFS = "SPY QQQ DIA XLK XLC XLY XLP XLV XLF XLE XLB XLI XLU XLRE".split()
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "application/json"}

def fetch(sym, assetclass):
    api_sym = sym.replace("BRK-B", "BRK.B")
    url = f"https://api.nasdaq.com/api/quote/{api_sym}/historical?assetclass={assetclass}&fromdate=2015-01-01&todate=2026-10-18&limit=9999"
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    rows = ((d.get("data") or {}).get("tradesTable") or {}).get("rows") or []
    out = []
    for row in rows:
        try:
            date = row["date"]; close = float(row["close"].replace("$","").replace(",",""))
            vol = row.get("volume","").replace(",","")
            vol = int(float(vol)) if vol and vol != "N/A" else 0
            out.append([date, close, vol])
        except (KeyError, ValueError):
            continue
    return out

ok, fail = 0, []
for sym in STOCKS + ETFS:
    ac = "etf" if sym in ETFS else "stocks"
    p = pathlib.Path(f"data/nasdaq_{sym}.json")
    if p.exists() and p.stat().st_size > 1000:
        ok += 1; continue
    rows = []
    for attempt in range(3):
        try:
            rows = fetch(sym, ac)
            if rows: break
        except Exception as e:
            print(f"  retry {sym}: {e}", flush=True)
        time.sleep(3)
    if rows:
        p.write_text(json.dumps({"symbol": sym, "rows": rows}))
        first, last = rows[-1][0], rows[0][0]
        print(f"{sym:6s} {len(rows):5d} sessions  {first} -> {last}", flush=True)
        ok += 1
    else:
        fail.append(sym); print(f"{sym:6s} FAILED", flush=True)
    time.sleep(1.15)
print(f"\ndone ok={ok} failed={fail}")
