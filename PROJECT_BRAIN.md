# PROJECT_BRAIN.md — The Complete Handover Document

> **Purpose.** This file is the complete brain of this project. It was written so that a brand new chat session (or a brand new engineer) can pick this codebase up with ZERO guessing: what every thing is, why it exists, how it was built, what mistakes were made and how they were handled, and how to operate and extend it. Read it top to bottom once; afterwards use it as a reference.
>
> **Trust rule used throughout this project:** no fabricated metrics. Every accuracy number on the site is measured and reproducible; every limitation is stated plainly to the user.

---

## Table of contents

1. [What this project is](#1-what-this-project-is)
2. [Live URLs, accounts and identifiers](#2-live-urls-accounts-and-identifiers)
3. [How to onboard (read order for a new session)](#3-how-to-onboard-read-order-for-a-new-session)
4. [Architecture map](#4-architecture-map)
5. [The daily report methodology](#5-the-daily-report-methodology)
6. [The LSTM model methodology](#6-the-lstm-model-methodology)
7. [TimesFM methodology](#7-timesfm-methodology)
8. [The adaptive ensemble methodology](#8-the-adaptive-ensemble-methodology)
9. [The per stock GBM ecosystem methodology](#9-the-per-stock-gbm-ecosystem-methodology)
10. [The news and events layer methodology](#10-the-news-and-events-layer-methodology)
11. [Netlify Functions: schedules, stubs, workers and guards](#11-netlify-functions-schedules-stubs-workers-and-guards)
12. [Blob storage: the patterns and the staleness bug](#12-blob-storage-the-patterns-and-the-staleness-bug)
13. [Frontend and design system methodology](#13-frontend-and-design-system-methodology)
14. [The verification stack (how everything was ever proven)](#14-the-verification-stack-how-everything-was-ever-proven)
15. [Honest accuracy numbers and citations](#15-honest-accuracy-numbers-and-citations)
16. [Deployment: exact commands and gotchas](#16-deployment-exact-commands-and-gotchas)
17. [Secrets policy](#17-secrets-policy)
18. [All mistakes and dead ends (do not retry these)](#18-all-mistakes-and-dead-ends-do-not-retry-these)
19. [The Netlify badge story](#19-the-netlify-badge-story)
20. [The Understand-Anything knowledge graph (this documentation task)](#20-the-understand-anything-knowledge-graph-this-documentation-task)
21. [Session history timeline (v1 to today)](#21-session-history-timeline-v1-to-today)
22. [GitHub import steps (for the low internet workflow)](#22-github-import-steps-for-the-low-internet-workflow)
23. [File inventory and integrity](#23-file-inventory-and-integrity)
24. [Standing user constraints (never violate)](#24-standing-user-constraints-never-violiolated)

---

## 1. What this project is

A **zero dependency pre-market report website for Indian stock market mornings**, deployed on the Netlify free tier and running fully automatically every trading day. In one sentence: at 09:00 IST it checks four things (overnight US indices, India VIX, NIFTY 50 breadth, GIFT Nifty implied open), runs them through a role based framework to produce one clear verdict, blends an adaptive TimesFM + LSTM forecast for NIFTY, attaches a display-only news and earnings layer, and publishes a plain language report — plus a 50 symbol self improving forecast ecosystem, a 95 term glossary and an ELI5 page, all styled to a strict anti-"AI slop" design spec.

Key properties:

- **Runtime has zero npm dependencies.** The site is hand written ES modules, SVG charts and one stylesheet. npm packages exist only for development (netlify-cli, playwright).
- **No database.** All state lives in Netlify blob storage (JSON blobs) written by background functions.
- **Everything is automatic and daily.** Four cron schedules do all the work. No human presses anything.
- **Honesty is a feature.** Accuracy numbers are measured, limitations are stated, the news layer is explicitly labeled as not part of the math.

## 2. Live URLs, accounts and identifiers

| Thing | Value |
|---|---|
| Production site | `https://premarket-india-report.netlify.app` |
| Netlify site id | `d11ef229-c10a-4030-a70a-d2797720d626` |
| Netlify account id | `68a07f34e99540adfcc0a631` |
| Functions deployed | 13 |
| Cron schedules | 4 (see section 11) |
| Alpha Vantage key (used by offline tools only) | supplied by the user; NEVER committed (see section 17) |
| Netlify auth token | supplied by the user; NEVER committed (see section 17) |

Current live version: **v5.4 (anti vibe coded UI pass) + the Netlify badge CSS hide**, deployed 2026-10-30 16:59 UTC.

## 3. How to onboard (read order for a new session)

1. This file (PROJECT_BRAIN.md), top to bottom.
2. `README.md` — the user facing manual.
3. `COMPLIANCE.md` — the point by point ledger against the original spec, version by version.
4. `.ua/knowledge-graph.json` — the machine readable map of all 104 nodes, 125 edges, 8 layers and a 14 step guided tour of the codebase (see section 20).
5. `methodology.html` — what we tell end users about how the report is made.
6. `resources/README.md` — the map of the complete tools and resources archive (training environments, datasets, article, verification stack, specs, evidence).
7. Then the code, starting at `lib/scan.mjs` (the heart), then `lib/ensemble.mjs`, `lib/stocks-engine.mjs`, `lib/news-engine.mjs`, then `netlify/functions/scan-background.mjs`.

If you have the Understand-Anything plugin available, run its dashboard to explore the graph interactively (section 20.3).

## 4. Architecture map

Eight layers (identical to the layers in `.ua/knowledge-graph.json`):

```
presentation      9 HTML pages (index, stocks, glossary, eli5, model,
                  methodology, privacy, search, 404)
frontend-logic    app.js, stocks-view.js, glossary-view.js, search-view.js,
                  chrome.js, charts.js, glossary-terms.mjs, styles.css
engines           lib/scan.mjs, lib/ensemble.mjs, lib/lstm.mjs,
                  lib/model-nifty.mjs, lib/stock-features.mjs,
                  lib/stocks-engine.mjs, lib/news-engine.mjs (+ gbm-model.json)
serverless        4 cron stubs + 3 background workers + 6 read APIs
data              backtest-decade.json, hpq-article.json, model-analysis.json,
                  search-index.json, stock-forecasts.json, stock-history-seed.json
build-tooling     tools/ (Python: pack_model, stock_forecasts, timesfm_run,
                  make_exhibit; Node: build-search-index, build-model-analysis,
                  style-audit, validate-lstm, prove-adaptivity, tests)
config-deploy     netlify.toml, package.json, skills-lock.json
docs              README.md, COMPLIANCE.md, llms.txt, robots.txt, sitemap.xml
```

Data flow on a trading morning (all times IST):

```
08:40  news-scan (cron)        -> news-background    -> news blob
09:00  daily-scan (cron)       -> scan-background    -> report blob, scorecard
09:10  stocks-adaptive (cron)  -> ...-background     -> stocks-live blob
09:20  post-open-scan (cron)   -> scan-background    -> report blob (confirmation)
browser: index.html/stocks.html -> /api/latest, /api/stocks, /api/news -> render
```

## 5. The daily report methodology

**WHAT.** `lib/scan.mjs` builds the report. The four checks, with the sources the user explicitly named as primaries:

1. **Overnight US indices** (S&P 500, Nasdaq, Dow) — Yahoo Finance primary, CNBC fallback.
2. **India VIX** — NSE (nseindia.com) primary, with percentile vs its own 10 day history.
3. **NIFTY 50 breadth** (advancers vs decliners) — from the NIFTY50 constituent list.
4. **GIFT Nifty implied open** — scraped from TradingView (web research found this as the reliable free source; there is no official free API).

Plus market context (oil, gold, US 10Y yield, dollar index, USD/INR, Asian markets).

**WHY the role framework.** The user specified a role based framework (v3): each check has a role and a weight, and the verdict combines them into one of: Positive (large/normal), Neutral, Conflicting, Negative (normal/large). `frameworkVerdict()` in `lib/scan.mjs` implements it. The framework scorecard persists each day's outcome so the ensemble layer can learn from it.

**WHY stubs + workers.** Netlify scheduled functions have a ~30 second execution cap; a full scan (many external fetches with pacing) takes minutes. So each schedule is a thin stub that calls the corresponding *background function* (15 minute budget) with a secret trigger header. The 09:20 post-open run merges what actually happened after the bell into the same day's report (confirmation step the user asked for in the role framework).

**Report storage.** Each report is stored as JSON + markdown + HTML blobs under `reports/<date>.*`; the latest view is a separate blob. `/api/latest`, `/api/history`, `/api/report?date=` serve them.

## 6. The LSTM model methodology

**WHAT.** `lib/lstm.mjs` is a faithful JavaScript port of the exact LSTM from the DataCamp article the user supplied ("Build Your First Stock Price Predictor" style tutorial): 3 stacked LSTM layers (200, 200, 150 units), TensorFlow 1.6 `LSTMCell` semantics, trained on NIFTY data with a 49 observation window, predicting the next 5 sessions.

**WHY a JS port instead of TensorFlow in production.** Netlify functions are Node without native TF; shipping 693k float32 weights as a base64 blob (`lib/model-nifty.mjs`, packed by `tools/pack_model.py`) and running the cell math in plain JS is fast, dependency free and cold start friendly.

**Port fidelity.** `tools/validate-lstm.mjs` loads the packed model and compares the JS forecast against the recorded training time outputs — this is the proof the port is faithful (gate: LSTM_PORT_OK).

**Provenance.** `assets/hpq-article.json` + `tools/make_exhibit.py` reproduce the article's own HPQ dataset result, proving we followed the tutorial 100% rather than inventing our own model. The article and dataset are the user's supplied source of truth.

**Honest limitation (stated on the model page).** An LSTM on daily closes is a weak learner; direction accuracy hovers near coin flip on raw data. That is exactly why the ensemble (section 8) bias corrects it, and why the site never claims more than measured numbers.

## 7. TimesFM methodology

**WHAT.** Google TimesFM 2.5 (open source, ~500M parameter time series foundation model) produces a second opinion forecast for NIFTY and for the 50 stock universe.

**WHY offline artifacts instead of live inference.** No GPU in the sandbox and way too heavy for a Netlify function. So `tools/timesfm_run.py` + `tools/stock_forecasts.py` run TimesFM offline (batched), and the outputs ship as static JSON (`assets/model-analysis.json`, `assets/stock-forecasts.json`). At runtime the engines check artifact freshness and blend only while fresh (see section 8); when stale, the site falls back to the LSTM/GBM paths and says so. This satisfies the user's standing constraint: "enough fallbacks, switching automatically."

**TimesFM is primary when it wins.** Per the user's v4 instruction ("if timesfm is more better then keep it as primarily"), the ensemble weight learns which one deserves primacy from realized outcomes — it is not hardcoded.

## 8. The adaptive ensemble methodology

**WHAT.** `lib/ensemble.mjs`: the primary NIFTY forecast is

```
forecast = w * TimesFM + (1 - w) * (LSTM + bias_correction)
```

where `w` starts at 0.5 and is relearned daily from resolved outcomes (once at least 5 exist) by minimizing recent error, and `bias_correction` is the rolling mean of the LSTM's recent signed errors. `updateScorecard()` persists outcomes; `ensembleView()` produces the panel the dashboard renders, including the calibrated band and the honest caveat line.

**WHY.** The user asked (v4) that the models be compared at the live 9am check and "learn and improve automatically". The scorecard + daily weight update is that mechanism, and its measured effect is quantified in section 15.

## 9. The per stock GBM ecosystem methodology

**WHAT.** The v6 "extend auto adaptive self improvement to every stock and the whole site ecosystem" layer, implemented in `lib/stocks-engine.mjs` + `lib/stock-features.mjs`:

- **50 symbols**: US mega caps, sector leaders, major ETFs, global names and Indian ADRs (the `STOCKS` list).
- **Features**: 26 per symbol/day (returns at several horizons, volatility regimes, RSI-14, VIX percentile) built by `featureRow()`.
- **Model**: a LightGBM regressor trained offline with `dump_model` export, evaluated in JS by `gbmPredict()` with **full precision thresholds** (a float32 truncation bug was found and fixed — see section 18). The trees live in `lib/gbm-model.json`.
- **Per stock state**: each symbol has its own bias, band width and blend weight, learned independently as predictions resolve against real closes (`runAdaptiveCycle()`).
- **Data**: incremental history pulls from the Nasdaq quote API (`fetchNewRows()`, 1.1s pacing), seeded by `assets/stock-history-seed.json`.
- **Decade backtest**: walk forward year by year 2018–2026 (`assets/backtest-decade.json`), so the user can see year by year improvement — this fulfilled the "decade training, year by year improvement" request honestly (the model only ever trains on past data within each walk forward fold; no leakage).

**WHY GBM and not deep learning per stock.** 50 symbols × daily bars is small data; gradient boosted trees beat LSTMs here, train in seconds offline, and export to plain JSON trees that run anywhere with zero dependencies. The honest measured numbers are in section 15.

## 10. The news and events layer methodology

**WHAT.** The user said: "Track other things that influence stocks also. We can't just rely on some mathematics." `lib/news-engine.mjs` implements the **display-only** layer:

- Market headlines (CNBC RSS) + India headlines (Google News RSS), parsed by a dependency free regex RSS parser.
- Per symbol feeds for all 50 stocks with request pacing.
- The earnings calendar for the next 10 weekdays (Nasdaq API) with estimates, rendered as chips on the stocks page.
- Keyword **event tags** (rates, earnings, geopolitics, guidance, accident...).
- **Heavy news detection**: a symbol is flagged when today's headline count exceeds its trailing 14 day average — the "something unusual is happening" signal.

**WHY display-only.** Honest copy requirement: news sentiment is NOT fed into the numeric forecasts, and every news panel says so plainly. The numbers stay reproducible; the news adds human context.

## 11. Netlify Functions: schedules, stubs, workers and guards

The 13 functions and the 4 schedules (UTC crons in `netlify.toml`):

| Cron (UTC) | IST | Stub | Worker |
|---|---|---|---|
| 03:10 Mon–Sat | 08:40 | `news-scan.mjs` | `news-background.mjs` |
| 03:30 Mon–Fri | 09:00 | `daily-scan.mjs` | `scan-background.mjs` |
| 03:40 Mon–Sat | 09:10 | `stocks-adaptive.mjs` | `stocks-adaptive-background.mjs` |
| 03:50 Mon–Fri | 09:20 | `post-open-scan.mjs` | `scan-background.mjs` (post-open header) |

Read APIs: `api-latest`, `api-history`, `api-report`, `api-news`, `api-stocks`, plus the guarded `api-scan` (the manual "run scan now" button).

**Guards (all blob based):**

- `api-scan`: 2 minute throttle per manual trigger.
- `news-scan` stub: 10 minute self throttle (public re-trigger cannot force reruns).
- `news-background` / `stocks-adaptive-background`: 30 minute public throttle; scheduled runs (with the secret header) always pass.
- All background workers: public HTTP POSTs **without the trigger header get 403** — the platform already blocks direct scheduled-function calls from outside, and the guards double it.

**WHY Saturday runs for news/stocks:** the US market closes Friday; the 09:10 IST Saturday cycle resolves Friday's predictions (the same reason `post-open-scan` is Monday–Friday only).

## 12. Blob storage: the patterns and the staleness bug

All persistent state is Netlify blob storage (`getStore()`), no database. Blobs: `reports/<date>.json|.md|.html`, the latest view, the framework scorecard, the ensemble scorecard, `news-history`, per stock state, `stocks-live`, and the throttle timestamps.

**The staleness bug (important).** Netlify blobs are eventually consistent: a read immediately after a write to the same key can return the OLD value. Symptom: the stored report summary did not include data just written in the same invocation. Fix pattern used everywhere: compute the summary **in memory** from the object you just wrote, never by reading the blob back (`summaryFrom()` in `scan-background.mjs`). Do not "fix" this by adding sleeps.

## 13. Frontend and design system methodology

- **One stylesheet** (`assets/styles.css`) driven by tokens: spacing scale, exactly 3 radius values, a modular type scale, light + dark palettes, layered shadows, and the Okabe-Ito color blind safe palette for charts.
- **Charts are hand written SVG** (`assets/charts.js`: `lineChart`, `sparkline`, `breadthBar`) — no chart library, no canvas.
- **Every page works without JavaScript** (progressive enhancement); JS only enhances (sort, filter, search, live data).
- **Zero overflow rule (v5.2):** no element may overflow the viewport at any width. Enforced by `check-overflow.mjs` audits at multiple widths, both themes.
- **No em dashes / hyphen style rules:** enforced by `tools/style-audit.mjs` (allowlist for numbers, tickers, ISO dates).
- **No jargon left unexplained:** every term auto links to the glossary (`linkGlossaryTerms()` in `app.js`, driven by `LINKABLE` in `glossary-terms.mjs`); separate ELI5 page for absolute beginners.
- **Fallbacks everywhere (user standing constraint):** every external source has a fallback chain; the UI renders honest empty states, never spinners that lie.
- **v5.4 anti vibe coded UI pass:** the UI was rebuilt to follow EVERY point of the user's supplied spec document (`uploads/vibe-coded-signals-exhaustive (2) (1).md`), verified point by point in `COMPLIANCE.md`, with before/after screenshots and pixel audits.

## 14. The verification stack (how everything was ever proven)

The standing rule: **nothing is "done" until it is verified live.** The tools (in `tools/` and in `resources/verification/debug-browser/` — the latter ships with this repo):

| Tool | What it proves |
|---|---|
| `test-local.mjs`, `tools/test-local.mjs` | The functions pipeline runs end to end locally |
| `tools/validate-lstm.mjs` | The JS LSTM port reproduces training outputs (LSTM_PORT_OK) |
| `tools/prove-adaptivity.mjs` | Measured gain of the adaptive layer (+0.3 to +1.1 pts; 77.97% band coverage) |
| `tools/test-news-engine.mjs` | One real news cycle against live sources (NEWS_ENGINE_OK) |
| `tools/test-stocks-engine.mjs` | Adaptive cycle against a fake blob store |
| `tools/style-audit.mjs` | Style rules (no em dashes, no buzzwords) |
| `debug-browser/render-audit.mjs` | axe style accessibility + console error audit (`BASE=` env audits the live prod site) |
| `debug-browser/check-overflow.mjs` | Zero viewport overflow at all widths |
| `debug-browser/check-interactions.mjs` | All 18 interactive behaviors |
| `debug-browser/check-badge.mjs` | Netlify badge visibility (reports rect + display) |
| `debug-browser/pixel-audit.py`, `build-compare-sheet.py` | Pixel level UI regression + visual diff sheets |
| Live `BASE=` audits | **Fixture only audits once missed data dependent UI states (see section 18); always audit production too** |

**Deployment verification loop used every time:** deploy → curl the live HTML → run the audits against prod → screenshot before declaring done.

## 15. Honest accuracy numbers and citations

These are the measured numbers stated on the site (never inflate them):

- **Per stock GBM ecosystem, walk forward 2018–2026:** direction accuracy ≈ **52–56%** by year (see `assets/backtest-decade.json` for exact per year values); the adaptive layer adds a measured **+0.3 to +1.1 percentage points** over the static baseline; the calibrated 80% band covered **77.97%** of outcomes (target 80).
- **NIFTY LSTM (article port):** reproduces the article's published behavior on HPQ; on NIFTY daily closes its raw direction accuracy is near coin flip — which is why it is bias corrected inside the ensemble and never shown alone.
- **TimesFM 2.5:** offline artifact forecasts; quality tracked by the ensemble scorecard as it resolves against real outcomes.
- Research context (v6 turn): published literature on daily equity direction forecasting puts realistic walk forward accuracy in the ~50–58% band; anything claiming 90%+ on daily direction is curve fitted or selling something. The site's copy reflects this.

**The 90–95% question:** the user asked for 90–95% accuracy; the honest answer given (with citations) is that no legitimate daily direction model reaches that on out of sample data, and the site says so rather than faking it.

## 16. Deployment: exact commands and gotchas

From `/home/user/netlify-premarket` (or the unzipped repo anywhere):

```bash
export PATH=/home/user/.npm-global/bin:$PATH   # or wherever netlify-cli is installed
export NETLIFY_AUTH_TOKEN=<the token the user provides; never commit it>
bash tools/deploy.sh          # stages site files only, then deploys --prod
bash tools/deploy.sh --dry-run   # inspect the staged file list first
```

**Token status:** the token supplied in October 2026 stopped working in November 2026 (API 401 "Access Denied" — revoked or expired). Deployment therefore requires a fresh token from the user; this is expected token rotation, not a bug.

- `netlify.toml` carries the functions dir, the 4 crons, security headers (CSP incl. the Netlify HUD hash `BkKP2XO6WOEc3kXOiLr2ZoY83hamalKjPY9xBcbXVuw=`, HSTS, XFO, XCTO, Referrer-Policy, Permissions-Policy, COOP) and cache rules. The deploy is static files + functions; no build step.
- **NEVER run `netlify deploy --dir .` from the repo root anymore.** The repo now carries the 88MB `resources/` archive, and netlify-cli does NOT read `.netlifyignore` (that is a build system feature only — verified in netlify-cli 26.2.0 source: the CLI filter skips just dotfiles, node_modules, `__MACOSX`, `_redirects`, `_headers`). Use **`bash tools/deploy.sh`** instead: it stages only the site files (78 files at the time of writing) into a temp dir and deploys from there; `--dry-run` lists what would ship. `.netlifyignore` is kept for the day the repo is connected to Netlify git builds, where it does apply.
- **Gotcha:** the Netlify CLI recreates a local `.netlify/` state directory when you run env/link commands. It is NOT part of the codebase — never commit it (`.gitignore` covers it), delete it before zipping.
- **Gotcha:** `netlify api listSiteDeploys` works but deploy objects use the key `id`, not `deploy_id`; `listFunctionsForSite` is the wrong API name (JSONDecodeError).
- **Env vars cannot be set on this free account** (account level API 403 "Upgrade"; site level 404; CLI needs a linked project). All "secrets" the runtime needs are either public data endpoints or the trigger header pattern. Do not burn time retrying env APIs.
- After any deploy: verify live (curl + `BASE=` audits), see section 14.

## 17. Secrets policy

**Nothing in this repo is secret.** Verified by scanning every file for tokens before every packaging. Specifically ABSENT from the repo (and it must stay that way):

- The Netlify auth token (`nfp_...`) — deployment only, passed as an env var per command.
- The Alpha Vantage key — used only by the offline Python tools at runtime, read strictly from the `AV_KEY` environment variable, never written to any file. (During packaging for GitHub a hardcoded default of the key was found in `tools/stock_forecasts.py` and removed; the tool now refuses to run without `AV_KEY` set. The key itself was supplied by the user in chat.)
- The internal trigger secret file (`.internal-trigger-secret` in the sandbox home, not the repo).

During packaging for GitHub, the Alpha Vantage key was found hardcoded as a fallback in FOUR scripts (`tools/stock_forecasts.py` plus the three LSTM training scripts now under `resources/training-lstm/`) and was removed from all of them; each now reads `AV_KEY` from the environment and refuses to run without it. See `resources/README.md` for the full redaction record.

A new session needs the user to re-supply only two things: the Netlify token (to deploy) and the Alpha Vantage key (only if re-running offline fetchers/retraining). Everything else — code, models, data, tools, specs, article, environment builder, evidence — is in this repository.

## 18. All mistakes and dead ends (do not retry these)

Each entry: what was tried, why it failed, what to do instead.

1. **Fixture only audits miss data dependent UI.** The 09:00 fixture lacked post-open confirmations and earnings warn states; local audits were clean while live prod had 17 contrast violations + 1 heading skip. Fix: always run a production `BASE=` audit before declaring done.
2. **Scheduled functions return 403 on public HTTP** — stub guards are invisible externally (platform blocks direct calls). Background functions always return 202 to the caller and discard in function Responses; the guard's effect is only visible via timing/logs. Do not try to "fix" this; it is correct behavior.
3. **Netlify env vars are not settable on this account/plan** (account API 403 "Upgrade", site API 404, CLI needs linked project). Mitigation shipped: blob self throttles. Retrying is wasted time.
4. **Wrong Netlify API names/shapes:** `listFunctionsForSite` (use the correct function listing API); deploys have `id` not `deploy_id`; `getSite` returns `functions.schedules = null` (not a schedule listing) — read schedules from `netlify.toml`.
5. **Playwright "element is not visible"** on `#stocks-table th.sortable`: the offline table lives inside a closed `<details>`. Open it first or target the live table.
6. **Live table re-render races:** the stocks table re-renders when `/api/news` resolves; clicks made immediately after load can hit stale elements. Wait ~1.2s and re-locate (the code rebinds via `bindLiveSort`).
7. **Blob read after write staleness** (section 12): compute in memory, don't read back, don't sleep.
8. **python `.replace()` spanning newlines fails silently** — inspect `repr()` of the region first.
9. **No vision available in the agent** — all "visual" verification is done with DOM rects, computed styles, pixel sampling scripts and Playwright screenshots, not by looking at images. Design accordingly.
10. **`networkidle` never settles** on index/stocks (live API polls) — use `domcontentloaded` + explicit waits in all Playwright audits.
11. **Node 20 JSON import quirks** — use `with { type: 'json' }` or read+parse; that is why some data ships as `.mjs` (e.g. `glossary-terms.mjs`).
12. **CSP forbids inline handlers** — all handlers are added via `addEventListener` in JS files; the CSP in `netlify.toml` has no `unsafe-inline` for scripts. Keep it that way.
13. **Netlify Edge rewrites prod URLs** for functions (`/api/*` works but the underlying URL space differs) — test against the public paths, not internals.
14. **audit vs rescan race:** running two audits against the same local server port simultaneously can interleave console errors; run them serially.
15. **zip packaging:** early zips accidentally excluded `.netlify/*` correctly but that lesson generalizes: always list the zip contents and diff against the manifest before shipping (see section 23).
16. **LightGBM threshold precision:** the first JS port of `dump_model` rounded split thresholds to float32 and silently misrouted samples; the fix uses full double precision (threshold strings from the export). `gbmPredict` now matches the Python model exactly.
17. **v5.2 overflow causes:** `min-width` on tables without a scroll wrapper, and negative margins on chip rows — both fixed with scroll containers; the zero overflow audit keeps them fixed.
18. **`querySelector` first match artifact:** when auditing, `document.querySelector` returns the FIRST match which may be a hidden template — query all matches and assert on the visible one.
19. **The Netlify badge official toggle is read only on the free tier** (section 19) — the API accepts the update and silently ignores it. The CSS hide is the correct approach.
20. **`/tmp` in the sandbox is a 992MB tmpfs** — the Understand-Anything full workspace install (tree sitter grammars for all languages) overflows it. Build only what you need (`pnpm --filter ...core...`) or work from `/var/tmp` on the root disk.
21. **Skill scripts copied out of their plugin** resolve the plugin root as two levels up from the script dir — run the plugin's own copies (`<plugin>/skills/<name>/script.mjs`), not the copies installed under `.claude/skills/`, or set `PLUGIN_ROOT`.
22. **Understand-Anything `compute-batches.mjs` needs `graphology`** which lives in the dashboard package — install it at the plugin root before running batching.
23. **`.netlifyignore` is NOT read by `netlify deploy` from the CLI** (verified by reading netlify-cli 26.2.0's `getDeployFilesFilter`): it only skips dotfiles, node_modules, `__MACOSX`, `_redirects` and `_headers`. Assuming otherwise nearly shipped an 88MB archive to production. Fix: `tools/deploy.sh` staging (section 16). The repo's `.netlifyignore` remains valid for git connected builds only.
24. **Secrets hide in "tutorial followed verbatim" code:** the Alpha Vantage key survived in THREE training scripts precisely because they were meant to be a verbatim record of the article run. Scan EVERYTHING (logs, training environments, spec docs) before publishing, not just the site code.

## 19. The Netlify badge story

Netlify's free tier injects the "Built with Netlify" HUD (`/.netlify/scripts/hud?variant=public`, `data-account-tier="free"`). The user asked for a code trick to hide it.

- **Official toggle:** `getSite` shows `built_with_badge_enabled: true` and `hud_enabled: false`; `updateSite` with both set to false returns success but the fields stay `true` — read only on the free tier. Dead end, do not retry.
- **Shipped fix:** the trailing block in `assets/styles.css` hides every badge selector variant:

```css
#nl-badge-frame, netlify-badge, .nl-badge, [class*="nl-badge"] {
  display: none !important;
  visibility: hidden !important;
}
```

- **Verified live** with `debug-browser/check-badge.mjs`: before `{x:1155, y:836, 211x64, display:block}` → after `{0x0, display:none}`; zero console errors, zero overflow.
- **Reversible:** delete the rule block to bring it back. The loader script remains in the HTML (same origin, allowed by CSP); the hide is purely visual. The CSP HUD hash stays in `netlify.toml` (needed while the script is injected).

## 20. The Understand-Anything knowledge graph (this documentation task)

The user asked that https://github.com/Egonex-AI/Understand-Anything be used for the documentation. Here is exactly what was done, so it is reproducible:

### 20.1 What Understand-Anything is

A Claude Code plugin (MIT, active, 875+ commits) that builds a **knowledge graph of a codebase**: nodes (files, functions, classes, configs, documents, resources), edges (imports, contains, configures, documents, triggers, calls, serves), architectural layers, and a guided tour. Its pipeline is 7 phases: pre flight → ignore config → scan → batch → analyze (LLM) → merge/normalize → architecture/tours → finalize into `.ua/knowledge-graph.json`. The companion dashboard visualizes the graph.

### 20.2 How it was run on this repo (exact steps)

```bash
# 1. Clone and build (in /var/tmp — /tmp is too small, see section 18 #20)
git clone --depth 1 https://github.com/Egonex-AI/Understand-Anything.git
cd Understand-Anything/understand-anything-plugin
pnpm install --filter @understand-anything/core...
pnpm --filter @understand-anything/core build
pnpm add graphology            # needed by compute-batches.mjs

# 2. Phase 1: scan (67 files found; .claude/** excluded)
node skills/understand/scan-project.mjs /home/user/netlify-premarket \
  .ua/intermediate/scan-result.json --exclude ".claude/**"

# 3. Phase 1.5: batches (louvain community batching)
node skills/understand/compute-batches.mjs /home/user/netlify-premarket

# 4. Phase 2a: deterministic tree-sitter extraction per batch
#    (tools/ua-batch-gen.py writes .ua/tmp/ua-file-analyzer-input-<i>.json
#     from batches.json + scan-result.json, then)
node skills/understand/extract-structure.mjs <input.json> <output.json>

# 5. Phase 2b: the LLM phase — THIS SESSION acted as the file-analyzer agent:
#    nodes/edges authored in tools/ua-batch-gen.py from the extractor output
#    plus first hand knowledge of every file; written to .ua/intermediate/batch-<i>.json

# 6. Phase 2c: merge + normalize + dedupe + dangling edge drop
python skills/understand/merge-batch-graphs.py /home/user/netlify-premarket
#    -> .ua/intermediate/assembled-graph.json (104 nodes, 125 edges, 0 dangling)

# 7. Phases 4-7: layers + tour + validation + finalize
#    (tools/ua-finalize.py) -> .ua/knowledge-graph.json
```

Result: **104 nodes, 125 edges, 8 layers, 14 tour steps**, every layer/tour reference validated against the node set, full layer coverage (every node in exactly one layer).

The two generator scripts (`tools/ua-batch-gen.py`, `tools/ua-finalize.py`) are committed in `tools/` — rerun them after `scan-project.mjs` + `compute-batches.mjs` + `extract-structure.mjs` to regenerate the graph after code changes.

### 20.3 Viewing the dashboard

```bash
cd Understand-Anything/understand-anything-plugin/packages/dashboard
GRAPH_DIR=/home/user/netlify-premarket npx vite --host 0.0.0.0 --port 5173
# it prints: Dashboard URL: http://127.0.0.1:5173/?token=<TOKEN>
```

The token in the URL is required (the graph endpoint 403s without it). For the sandbox preview the vite config was patched with `allowedHosts: true` + `host: 0.0.0.0`.

### 20.4 Honest note on methodology

The plugin is designed for a multi subagent Claude Code environment. This session ran the deterministic phases with the real scripts and performed the LLM phases (file analysis, layers, tours) directly as the agent, with the project author's first hand knowledge. The graph is therefore both tool extracted (structure, symbols, line counts) and hand curated (summaries, tags, edges) — higher fidelity than either alone, and every summary was written against the actual current source.

## 21. Session history timeline (v1 to today)

| Version | What shipped |
|---|---|
| v1 | The tutorial build: 4 checks, readiness at 09:00, report generation, Netlify daily deployment |
| v2 | The LSTM stock predictor from the user's article, ported to JS, validated |
| v3 | Role based framework (user specified), TimesFM research + integration, post open confirmation |
| v4 | Model comparison at live check with automatic learning; per stock dashboard; 50 symbol page; TimesFM as primary when better |
| v5 | Glossary (95 terms, 3 lines button), ELI5 page, fallback chains everywhere, style rules |
| v5.2 | Verdict clarity, off screen element fixes, zero overflow at all widths, simpler on ramp |
| v5.3 | News/earnings/event flags layer (display only, honest copy) |
| v5.4 | Anti vibe coded UI pass: full spec compliance, before/after screenshots, pixel audits |
| Badge | Netlify badge hidden in production via CSS (verified) |
| Today | Understand-Anything knowledge graph (104 nodes), this brain document, GitHub migration package (zip + SHA256SUMS + hosted URL) |

The full requirement by requirement ledger lives in `COMPLIANCE.md`.

## 22. GitHub import steps (for the low internet workflow)

The complete codebase zip is hosted at a public URL. The URL, the zip's sha256 and its byte size are in the chat message that shipped this zip and in the workspace file `HOSTED_ZIP.md` (kept beside the zip, not inside it, because a zip cannot contain its own checksum). You download it ONCE, then push to GitHub from your side:

```bash
# 1. Download once (pick the primary URL; the backup is in HOSTED_ZIP.md)
curl -L -o premarket-netlify.zip "<URL>"

# 2. Verify integrity (MUST match before proceeding)
sha256sum premarket-netlify.zip      # compare with HOSTED_ZIP.md / the chat message
#    also: the zip contains SHA256SUMS covering every file inside

# 3. Unzip and inspect
unzip premarket-netlify.zip -d premarket-netlify
cd premarket-netlify
sha256sum -c SHA256SUMS              # verifies every single file, zero compromise

# 4. Initialize git and push (create the empty repo on GitHub first, no README/license)
git init -b main
git add -A
git commit -m "Import: complete premarket-india-report codebase (v5.4 + badge hide + docs)"
git remote add origin https://github.com/<you>/premarket-india-report.git
git push -u origin main
```

Notes:

- `.gitignore` is included (ignores `node_modules/`, `.netlify/`, `.DS_Store`, `netlify.toml.bak`); nothing it ignores exists in the zip, so `git add -A` commits exactly the manifest in `SHA256SUMS`.
- The repo has no license yet — add one on GitHub if you want one (the site code is yours).
- After import, GitHub Actions is NOT needed: Netlify deploys from the CLI or can be connected to the repo later (Settings → Build & deploy → Link repository). The 4 cron schedules are in `netlify.toml` and deploy with the functions automatically.

## 23. File inventory and integrity

- `SHA256SUMS` (in the zip root and the repo root): sha256 of EVERY file, relative paths. This is the zero loss proof: after unzip, `sha256sum -c SHA256SUMS` must print `OK` for every line.
- The zip's own sha256 and byte size are published in the chat and in the workspace file `HOSTED_ZIP.md` (beside the zip; not inside it).
- File count and the full listing are reproducible: `unzip -l premarket-netlify.zip` and `find . -type f | grep -v node_modules | wc -l`.
- What is included: all 9 pages, all assets, lib engines, all 13 functions, all tools, configs, docs, `.ua/` (the knowledge graph + pipeline intermediates), `.claude/` (the installed skills + lockfile, so a future agent session has the same tools), `PROJECT_BRAIN.md` (this file) and `SHA256SUMS`, `.gitignore`.
- What is excluded: `node_modules/` (dev only, reinstall with `npm install`), `.netlify/` (local CLI state, regenerated), and every secret (section 17).

## 24. Standing user constraints (never violate)

1. **Use the internet fully** for research; if a solution cannot be found, the research methodology is wrong — change the approach, do not give up.
2. **Never fabricate metrics**; state limitations plainly.
3. **Never rely on a single source** — enough fallbacks that switch automatically.
4. **Never let the user assume a term's meaning** — link the glossary everywhere.
5. **No hyphens/em dashes in shipped copy** (style audited).
6. **Nothing overflows the viewport** at any width.
7. **The site must not look like AI slop** (v5.4 spec compliance).
8. **Zero file compromise** during migration — verify with checksums, every file equally important.
9. **Everything automatic and daily** — no manual steps in the product.
10. **Deployment continues to work without the sandbox** — it is Netlify cron driven, and the credentials to redeploy live with the user, not here.

---

*Document written during the GitHub migration turn (2026-10-16, session timezone Asia/Kolkata). It supersedes all scattered notes; `COMPLIANCE.md` remains the requirement ledger and `.ua/knowledge-graph.json` the machine readable map.*
