# India Pre-market Intelligence: Netlify edition

**LIVE: https://premarket-india-report.netlify.app**

Daily, fully automatic, zero-sandbox-dependency pre-market intelligence for the
NSE open: now with the LSTM stock-prediction model built from the DataCamp
article, market-context coverage (oil, gold, FX, rates, Asia), charts, and a
hardened, audited front end (see `COMPLIANCE.md`).

## v5.4 (30 October 2026): UI integrity pass

Every page re-audited against the anti vibe coded signals document and fixed: contrast (90 violations to 0 in both themes), 44px tap targets, strict heading ladders, one radius and spacing system, typographic quotes, favicon.ico/apple-touch-icon, unified footers with copyright, breadcrumbs, reading times, a whole site search page (/search.html), a sortable live stocks table, and a fixed theme toggle on the dashboard. Security: Cross-Origin-Opener-Policy header plus rate guards on the two publicly triggerable background workers. Zero overflow at 320 to 1366px, zero console errors, 18/18 interaction tests.

## What runs every trading day

Two scheduled runs (both registered with Netlify and verified via the API):

- **09:00 IST** (`30 3 * * 1-5` UTC): the pre-market report, built by the
  decision framework (v2):
  1. **Opening bias** from GIFT Nifty's implied gap vs the previous NIFTY close,
     classified by SIZE: neutral < 0.15% ≤ modest < 0.5% ≤ strong.
  2. **Global cues** as context: previous US close, LIVE US index futures
     (ES/NQ/YM), and the Asian session are separate inputs; they never override
     domestic price discovery.
  3. **NSE pre-open session** (09:00–09:15) cross-confirmation; disagreement →
     "conflicting signals, no directional conclusion" (never a forced call).
     Best-effort fetch; nseindia.com usually blocks datacenter IPs, and the
     report says so plainly when it does.
  4. **India VIX** as a risk gauge against its own 1-year percentile
     (low/moderate/elevated/high): volatility expectation, never direction.
     The old fixed "15" line is retired.
  5. Market context (crude, gold, USD/INR, US 10Y, Asia, futures) with
     documented interpretation thresholds; LSTM + TimesFM forecasts; rolling
     backtests. Breadth is explicitly labelled a post-open trend-confirmation
     input, not an opening predictor.
- **09:20 IST** (`50 3 * * 1-5` UTC): post-open confirmation: actual open,
  price vs open, live breadth, live VIX, appended to the same day's report.

The old ±1 equal-vote score is computed only for archive continuity; the
headline is the framework classification ("opening bias"), which keeps
Question A (will it open up/down?) separate from Question B (does it sustain?).

The dashboard (`/`) renders it with SVG charts (no chart libraries), a light /
dark theme, deep links (`/?date=YYYY-MM-DD`), and a rate-limited
"Run scan now" button. Pages: `/model.html`, `/methodology.html`,
`/privacy.html`, custom `/404.html`. SEO: sitemap, robots, llms.txt, OG image,
JSON-LD. Security: CSP + full header set, no client-side secrets, input
validation, rate limiting. Audit: `COMPLIANCE.md`.

## The LSTM model

- Architecture and training are the DataCamp tutorial's, verbatim: 3-layer
  `tf.contrib.rnn.LSTMCell` stack (200·200·150) + FC head, truncated BPTT
  (50 unrollings), batch 500, Adam with staircase decay, dropout, 30 epochs,
  EMA-smoothed MinMax scaling. Trained on **TensorFlow 1.6 / Python 3.6**
  (the exact stack the article requires, compiled from source in this repo's
  sandbox: see `/home/user/lstm-stock/`).
- Two models were trained from the same script:
  - `hpq-article`: the article's own HPQ dataset (12,076 rows, split 11,000).
    Test MSE 0.00243 at epoch 30, best 0.00233: inside the article's reported
    range. Its final-epoch predictions power the dashboard's validation exhibit.
  - `nifty-live`: NIFTY 50 daily bars 2007-09-17 → 2026-10-16 (4,682 rows,
    split 4,382). Best test MSE 0.00110. This is the live forecaster.
- Inference runs in the cloud function via a pure-JS port of the TF 1.6 LSTM
  cell semantics (`lib/lstm.mjs`), validated two ways before shipping:
  1. `tools/validate-lstm.mjs` reproduces TensorFlow's own 10-step sampling
     output (exported with each model) to within 6×10⁻⁷ scaled units (float32
     rounding), and
  2. an independent numpy reference implementation on a synthetic model
     (agreement ~1e-17, and 6e-9 through the float32 packing round-trip).
- The packed model (`lib/model-nifty.mjs`, ~3.6 MB base64 float32) ships inside
  the background function bundle; the browser never downloads it.

## TimesFM (offline) & the adaptive ensemble (primary forecast)

`tools/timesfm_run.py` runs Google's `timesfm-2.5-200m-pytorch` (via the
`timesfm` PyPI package, v3.x) zero-shot on NIFTY closes: a 5-session path plus
a **250-session (~1 year) one-step-ahead walk-forward**. `tools/build-model-analysis.mjs`
merges that with the LSTM's own 250-session walk-forward and **learns the ensemble**:

```
ensemble(t+1) = w · TimesFM(t+1) + (1−w) · (LSTM(t+1) − bias)
```

`w` and `bias` are grid-searched to minimise walk-forward RMSE (no leakage:
every prediction uses only prior data). The learned parameters are shipped in
`assets/model-analysis.json` and `lib/ensemble.mjs` blends them with the live
LSTM prediction in every 09:00 IST scan. **After deployment the model keeps
learning**: each scan records its prediction in the `model-scorecard` blob;
once the session prints, the entry is resolved against the actual close, and
after ≥5 resolved sessions `w`/`bias` are re-learned live from the most recent
30 and used for the next morning's blend. The dashboard shows the weight's
provenance and the recent scorecard. If the TimesFM artifact goes stale
(>5 sessions), the report falls back to the bias-corrected LSTM and says so.

```bash
python3 -m venv /home/user/.venv
/home/user/.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
/home/user/.venv/bin/pip install timesfm==3.0.2
/home/user/.venv/bin/python tools/timesfm_run.py            # -> /tmp/timesfm-raw.json (walk 250)
node tools/build-model-analysis.mjs                          # -> assets/model-analysis.json (learns w, bias)
```

Current head-to-head (250-session window, as of 2026-10-16): TimesFM RMSE
209.2 pts / 66.4% direction; LSTM 583.0 / 48.0%; **learned ensemble (w=0.98)
208.95 / 66.8%**. The zero-shot foundation model dominates, so the blend is
TimesFM-primary with a small corrected-LSTM tilt; the weight is re-learned
offline each refresh and live each morning by the scorecard.

## Per-stock forecasts (/stocks.html)

`tools/stock_forecasts.py` applies the same TimesFM checkpoint, zero-shot, to
~50 major symbols (US mega-caps & sector leaders, SPY/QQQ/DIA ETFs, global
ADRs, Indian ADRs: all NYSE/Nasdaq-listed, USD): a batched 5-session forward
pass for every symbol plus a batched 10-session one-step-ahead backtest per
symbol. Output: `assets/stock-forecasts.json` → `/stocks.html` (searchable,
sortable, sparklines, per-row as-of stamps).

```bash
/home/user/.venv/bin/python tools/stock_forecasts.py   # -> assets/stock-forecasts.json
```

Data sources, in order: **Nasdaq public quote API** (~5y daily per symbol, one
call, no key: reliable), Yahoo chart v8 (throttles bursts hard), Alpha Vantage
(the project's free key, 25 requests/day, last resort). Yahoo's rate limiter is
per-IP and brutal in bursts: if everything 429s, wait ~30–60 min or lean on
the Nasdaq source, which the script does automatically. There is also an
optional `/tmp/eod.json` payload path (the temporary AWS egress helper):
ignore it unless Yahoo+AV are both down.


## Glossary and ELI5 pages

`/glossary.html` defines every term used anywhere on the site (search, A to Z
index, category filters, cross links). The term database lives in
`assets/glossary-terms.mjs` and is shared with the dashboard: `app.js` links
the first mention of each known term in the rendered report panels straight to
its glossary entry. `/eli5.html` explains the whole site in the simplest
possible words and works fully without JavaScript. When adding any new term to
the site, add it to `assets/glossary-terms.mjs` in the same change.

## Source fallbacks (automatic)

No single source is trusted alone. In the live scan (`lib/scan.mjs`):
every check runs primary source, then an alternate where one exists, then a
last good cached copy in blobs with a per source freshness limit:

| Check | Primary | Alternate | Cache TTL |
| --- | --- | --- | --- |
| US indices | investing.com (fast 403 probe) | CNBC quote API, then Yahoo chart | 6 h |
| India VIX | nseindia.com (fast 403 probe) | Yahoo chart (1y percentile) | 6 h |
| GIFT Nifty | investing.com (fast 403 probe) | TradingView crawl, in.tradingview.com then www | 30 min |
| Market context | Yahoo chart (batched) | per symbol nulls | 6 h |
| NIFTY series (model input) | Yahoo chart | last good cache | 24 h |
| Post open chart | Yahoo chart 5m | last good cache | 20 min |

Switching is automatic. The report carries a `sources` map (live, cached with
age, degraded) that the markdown, HTML and dashboard renderers display, and
cached model input is labelled on the prediction. The offline per stock script
cascades Nasdaq quote API, Yahoo chart, then Alpha Vantage (the project key,
25 requests per day, `AV_KEY` env or default).

## Per stock adaptive engine (October 2026)

Every stock on `/stocks.html` is forecast by a gradient boosted tree model
(`lib/stock-features.mjs` + `lib/gbm-model.json`, trees trained offline in
`~/adaptive-stocks`) and then improves on its own live results:

- trained on a decade of daily data (Dec 2016 to Oct 2026, ~123k rows,
  50 symbols) with 26 features: own returns, volatility, moving average
  distances, RSI, volume z score, SPY/QQQ returns, VIX level, change and one
  year percentile, and the stock's sector ETF return
- validated walk forward by year (each year scored by a model trained only on
  earlier years): honest direction hit rates 49 to 53 percent, in line with
  published research on public data; the numbers ship in
  `assets/backtest-decade.json` and are displayed on the stocks page
- daily cycle (`netlify/functions/stocks-adaptive-background.mjs`, scheduled
  09:10 IST Monday to Saturday so the Friday US close is caught on Saturday):
  incremental Nasdaq history pull, resolve pending predictions against actual
  closes, then re-learn per stock a bias correction, a recalibrated 80 percent
  band width, and a per stock blend weight with the offline TimesFM artifact
  (learned like the NIFTY ensemble weight once at least five sessions resolve)
- output blob `stocks-live` is served at `/api/stocks`; the stocks page shows
  the live table first and falls back to the static artifact when no cycle
  has run yet
- tree inference parity is asserted twice: LightGBM versus a manual tree walk
  in Python, then Python versus the JavaScript feature builder and predictor
  on 300 real rows (`~/adaptive-stocks/parity_check.mjs`, max diff 1e-9)

The framework also keeps a track record now: each day's opening bias call is
resolved against the actual open at 09:20 IST and the rolling hit rate is
shown on the dashboard and stored in the `framework-scorecard` blob.

Honesty note: no 90 to 95 percent daily direction accuracy is achievable with
public data. The site reports direction hit rates, calibrated band coverage
and per year walk forward results exactly as measured.

## News, earnings and event flags layer

`netlify/functions/news-scan.mjs` (08:40 IST Mon-Sat) triggers
`news-background.mjs`, which runs `lib/news-engine.mjs`: market headlines
(CNBC top news RSS + Google News RSS for the US and India), per symbol
headlines for all 50 stocks, and the Nasdaq earnings calendar for the next ten
trading days. Headlines are tagged by keyword rules (earnings, merger, lawsuit,
regulator, layoffs, rates, inflation, geopolitics, election, cyber, recall,
accident); per symbol daily headline counts accumulate in the `news-history`
blob and unusual bursts are flagged as heavy news. Output blob `news-latest`
is served at `/api/news`; the dashboard shows a "What else is moving markets"
panel and the stocks page has an events column plus an earnings-this-week
line. The layer is deliberately NOT fed into the forecast models; the site
says so plainly, and the counts accumulate so a future model can be trained on
real paired news history instead of pretending.

## Site writing policy

All user facing copy follows plain language rules modelled on the Wikipedia
"Signs of AI writing" field guide: no dashes as punctuation, no hyphenated
compounds in prose (numbers, tickers, dates, identifiers and URLs excepted),
no filler or promotional words, specific facts over generic praise. The audit
command below greps the rendered pages for stray dashes and flagged phrases:

```bash
node tools/style-audit.mjs   # local; playwright based, checks visible text
```

## Operations runbook

**Sandbox snapshot budget (important):** the workspace snapshot is capped, and
heavy directories get silently dropped between sessions. The Python 3.6/TF 1.6
env (`/home/user/opt`), the TimesFM venv (`/home/user/.venv`), `node_modules`,
and the Netlify CLI install do NOT persist. Keep the persisted workspace small
(source + models + zip ≈ 45 MB: it is now), and rebuild environments on demand:

```bash
# Netlify CLI + blobs (needed for every deploy):
export npm_config_prefix=/home/user/.npm-global
npm install -g netlify-cli@26.2.0
cd /home/user && npm install @netlify/blobs@11.1.4 @netlify/functions@6.0.2
# TF 1.6 training env: bash /home/user/setup_env.sh   (installs from PyPI now)
# TimesFM env: see the TimesFM section above
```

Deploy after any change (from this directory):

```bash
# 1. blobs must be resolvable at deploy time or the API functions 502 in prod:
cd /home/user && npm install @netlify/blobs@11.1.4 @netlify/functions@6.0.2
# 2. deploy (CLI only: the raw zip/API upload ignores functions):
cd /home/user/netlify-premarket && \
  NETLIFY_AUTH_TOKEN=<token> netlify deploy --prod --dir . \
  --site d11ef229-c10a-4030-a70a-d2797720d626
```

Retrain the model (documented, repeatable):

```bash
# refresh data:  python3 (fetch ^NSEI period1=0 period2=<now> interval=1d → Stocks/nsei.us.txt)
cd /home/user/lstm-stock && export LD_LIBRARY_PATH=/home/user/opt/py36/lib:/home/user/opt/openssl11/lib
DATA_FILE=nsei.us.txt SPLIT=<len-300> TEST_END=<len> MODEL_NAME=nifty-live \
  EXPORT_JSON=models/nifty-model.json /home/user/opt/py36/bin/python3.6 train_export.py
node /home/user/netlify-premarket/tools/validate-lstm.mjs models/nifty-model.json   # must PASS
python3 /home/user/netlify-premarket/tools/pack_model.py models/nifty-model.json \
  /home/user/netlify-premarket/lib/model-nifty.mjs
# then redeploy; the dashboard flags "unreliable" if prices leave the scaler range
```

## Hard-won platform notes (do not "fix" these back)

- **`/home/user/node_modules` must exist at deploy time.** Without it esbuild
  externalizes `@netlify/blobs`, the runtime-injected build behaves
  differently, and `/api/latest|history|report` 502 with
  "error decoding lambda response". (This bit us once after a sandbox restore.)
- Functions must use `await import("@netlify/blobs")` **inside the handler**
  and only `store.get`/`store.set` with manual JSON: the runtime-provided
  build lacks `getJSON`/`setJSON`/`list`, and top-level static imports are not
  resolvable from `/var/task`.
- The **schedules live in `netlify.toml`** under `[functions."daily-scan"]`
  and `[functions."post-open-scan"]`. They were silently lost once during a
  config rewrite (and once to a snapshot cap dropping files); always verify
  after deploy: `function_schedules` must show BOTH crons
  (`30 3 * * 1-5` and `50 3 * * 1-5`), and `available_functions` must list
  all 7 functions.
- Raw zip/API deploys do not process functions: always the CLI.
- `method: "background"` is not a valid function config key; background mode
  comes from the `-background` filename suffix.
