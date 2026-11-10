# Pre-market Automation (Indian market)

Runs automatically every trading day, ready at **09:00 IST** (market opens 09:15),
performs the four checks in the 09:00–09:15 window and writes the report by itself.

## The four checks

| # | Check | Rule |
|---|-------|------|
| 1 | NASDAQ & Dow Jones (Investing.com) | green → Indian market may open green; red → may open red |
| 2 | India VIX | above 15 → higher volatility possible; below 15 → relatively lower volatility |
| 3 | Advances vs declines (nseindia.com) | advances > declines → bullish; advances < declines → bearish |
| 4 | Singapore Nifty (GIFT Nifty) | green → may open higher; red → may open lower |

Overall score = ±1 per check (VIX counts +1 when **below** 15). Bands:
≥3 strongly positive · ≥1 mildly positive · 0 mixed · ≥−2 mildly negative · else strongly negative.
A check that cannot be fetched is reported **UNAVAILABLE** and excluded from the score — never guessed.

## Sources actually used

The sources you named (investing.com, nseindia.com, NSE IX) are tried **first** in code.
From this sandbox investing.com (Cloudflare) and nseindia.com (Akamai) answer 403, and
GIFT Nifty has no free no-auth JSON feed reachable here, so in practice:

- **Check 1** — CNBC quote API (NASDAQ `.IXIC`, Dow `.DJI`)
- **Check 2** — Yahoo Finance chart API (`^INDIAVIX`)
- **Check 3** — Yahoo spark API over the 50 NIFTY 50 constituents (chunks of 15;
  `M&M.NS` fetched separately via the chart API because its `&` breaks the query string).
  Previous session's change per stock, counted up.
- **Check 4** — UNAVAILABLE (investing.com API + NSE IX `getquotes` with generated
  expiries are attempted as fallbacks; none answer from here)

Every row in the report is labelled with the source that actually served it.

## Files

- `scan.py` — performs the 4 checks and writes `reports/<date>-premarket.{md,json,html}` + `latest.*`
- `scheduler.py` — daemon: sleeps to 08:59:30 IST on weekdays, fires the scan at 09:00:00;
  if the machine wakes inside 09:00–09:14 it catches up immediately; skips weekends.
- `dashboard.py` — web server on `0.0.0.0:8090`: `/` latest report, `/history` list, `/reports/<file>` any saved report
- `start.sh` — (re)starts scheduler + dashboard
- `scheduler.log`, `dashboard.log` — activity logs

## Usage

```bash
./start.sh              # start both daemons (idempotent)
python3 scan.py         # run one scan now, on demand
python3 scheduler.py --once   # behave as if the alarm fired, once
```

## Caveats

- The sandbox may sleep between sessions; `scheduler.py` catches up only if it is awake
  inside the 09:00–09:14 window. If it missed a day, run `python3 scan.py` manually —
  reports are dated, so history is unaffected.
- Check 3 outside market hours reflects the **previous session's** breadth (that is the
  correct pre-market reading anyway).
- Check 4 will start populating automatically if any of its fallback sources becomes
  reachable; no code change needed.
