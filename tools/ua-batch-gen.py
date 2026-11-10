#!/usr/bin/env python3
"""Phase 2 (ANALYZE) of the Understand-Anything pipeline, executed with the
project author's own knowledge. Reads the deterministic tree-sitter extraction
(.ua/tmp/ua-file-extract-results-*.json) and emits batch-<i>.json graph files:
nodes (files, functions, classes, configs, documents, resources) plus edges
(imports, contains, configures, documents, triggers, calls, serves, related).
Summaries are hand-written, not generated filler."""
import json, os

ROOT = '/home/user/netlify-premarket'

# ---------------- curated file knowledge ----------------
F = {
  # ---- pages ----
  'index.html': ('file', 'Dashboard page', 'The daily report page and the site front door. Renders the plain words summary, the framework bias call, indicator checks, market context, the adaptive ensemble forecast with charts, the TimesFM second opinion, the news and events panel, the HPQ validation exhibit and the report archive. All data comes from /api/latest at runtime; app.js drives it.', ['page', 'dashboard', 'entry'], 'complex'),
  'stocks.html': ('file', 'Stocks page', 'Live adaptive forecasts for 50 symbols (US mega caps, sector leaders, ETFs, global and Indian ADRs). The live table sorts on every column, filters by region and search; collapsed sections hold the decade backtest and the offline TimesFM artifact table. Fetches /api/stocks and /api/news.', ['page', 'stocks', 'table'], 'complex'),
  'glossary.html': ('file', 'Glossary page', 'All 95 terms used anywhere on the site, each with a formal definition and a plain words line, cross linked. Searchable and filterable by category; an A to Z letter index jumps to entries. Rendered client side from glossary-terms.mjs.', ['page', 'glossary'], 'moderate'),
  'eli5.html': ('file', 'ELI5 page', 'The whole site explained in the simplest possible words, for someone who has never traded. Every jargon word links to the glossary. Works fully without JavaScript.', ['page', 'eli5', 'onboarding'], 'simple'),
  'model.html': ('file', 'Models page', 'Deep documentation of the LSTM (architecture, training data, validation against the DataCamp article), TimesFM 2.5, the adaptive ensemble and the per stock ecosystem. Honest limitations section. Static content plus one chart exhibit.', ['page', 'models', 'documentation'], 'moderate'),
  'methodology.html': ('file', 'Methodology page', 'How the report is built: every check, the role based framework steps, data sources with their exact endpoints, interpretation thresholds, the 4 daily schedules and a 6 question FAQ. The trust center of the site.', ['page', 'methodology', 'trust'], 'moderate'),
  'privacy.html': ('file', 'Privacy page', 'Plain language privacy policy: no accounts, no tracking, one localStorage key for the theme preference, data ownership of the upstream providers.', ['page', 'privacy', 'legal'], 'simple'),
  'search.html': ('file', 'Site search page', 'One search box over every page and all 95 glossary terms. The 102 document index (search-index.json) is fetched once and searched locally in the browser; nothing is transmitted.', ['page', 'search'], 'simple'),
  '404.html': ('file', 'Custom 404 page', 'Branded error page showing the missing URL (filled in by chrome.js) with recovery links to today\'s report, the glossary and the methodology.', ['page', '404'], 'simple'),
  # ---- assets: code ----
  'assets/app.js': ('file', 'Dashboard controller', 'The dashboard brain: theme handling, report loading and rendering (bias, checks, context, prediction, news panel, archive), glossary term auto linking, the copy report button and the run scan button. Imports chart builders and the linkable glossary terms.', ['frontend', 'dashboard', 'rendering'], 'complex'),
  'assets/charts.js': ('file', 'Chart builders', 'Dependency free SVG chart builders: lineChart (multi series with axes and legend), sparkline (tiny inline series) and breadthBar (advance decline bar). Pure functions returning SVG markup.', ['frontend', 'charts', 'svg'], 'moderate'),
  'assets/chrome.js': ('file', 'Shared page chrome', 'Theme toggle with persistence and prefers-color-scheme, scroll progress bar, header shadow, back to top button, mobile nav disclosure and the 404 missing path fill. Loaded by every page except the dashboard (app.js owns its own chrome).', ['frontend', 'chrome'], 'simple'),
  'assets/glossary-terms.mjs': ('file', 'Glossary term data', 'The 95 term dataset (id, term, short definition, plain words line, category, cross links) plus LINKABLE, the map of phrases that pages auto link to glossary anchors.', ['data', 'glossary'], 'moderate'),
  'assets/glossary-view.js': ('file', 'Glossary viewer', 'Renders the term list with search, category filters, the A to Z index and anchored entries; highlights search matches and flashes deep linked entries.', ['frontend', 'glossary'], 'moderate'),
  'assets/search-view.js': ('file', 'Site search viewer', 'Fetches search-index.json, matches every whitespace separated term, ranks by hit count, renders up to 20 results with snippets and an aria-live result count. Focuses the box on fine pointer devices only.', ['frontend', 'search'], 'simple'),
  'assets/stocks-view.js': ('file', 'Stocks page viewer', 'Renders the live adaptive table (sortable columns, region filter chips, search), the events and news column with earnings chips, the decade backtest section and the offline TimesFM table. Binds all interactions.', ['frontend', 'stocks', 'table'], 'complex'),
  'assets/styles.css': ('file', 'Design system', 'The single stylesheet: token block (spacing scale, 3 radius values, type scale, light and dark palettes, layered shadows, Okabe-Ito chart colors), base elements, header/nav, panels, tables, chips, skeletons, print rules and the Netlify badge hide.', ['frontend', 'design-system', 'css'], 'complex'),
  # ---- assets: data ----
  'assets/backtest-decade.json': ('resource', 'Decade backtest data', 'Walk-forward direction accuracy by year (2018 to 2026) for the per stock GBM ecosystem; rendered by the collapsed backtest section on the stocks page.', ['data', 'backtest'], 'simple'),
  'assets/hpq-article.json': ('resource', 'HPQ validation data', 'The article\'s own HPQ dataset and training history used to prove the LSTM port reproduces the published result; drives the validation exhibit on the dashboard.', ['data', 'validation'], 'simple'),
  'assets/model-analysis.json': ('resource', 'TimesFM model analysis', 'Offline TimesFM 2.5 forecasts for NIFTY with the ensemble analysis; drives the second opinion panel and part of the model page.', ['data', 'timesfm'], 'simple'),
  'assets/search-index.json': ('resource', 'Site search index', '102 documents (7 pages plus 95 glossary terms with anchors) with plain text extracted at build time by tools/build-search-index.mjs. Consumed by search.html.', ['data', 'search'], 'simple'),
  'assets/stock-forecasts.json': ('resource', 'Offline TimesFM stock forecasts', 'The offline per stock TimesFM artifact (5 session paths and per symbol backtest stats) rendered as the second table on the stocks page; blended into live forecasts while fresh.', ['data', 'timesfm', 'stocks'], 'simple'),
  'assets/stock-history-seed.json': ('resource', 'Stock history seed', 'Seed close history used to bootstrap per stock state before the adaptive cycle accumulates its own data.', ['data', 'seed'], 'simple'),
  # ---- lib ----
  'lib/scan.mjs': ('file', 'Pre-market scan engine', 'The heart of the daily report: IST clock helpers, the four source checks (US indices, India VIX, NIFTY breadth, GIFT Nifty), market context (oil, gold, rates, FX, Asia), the role based framework v2 verdict, LSTM forecast integration and the markdown/HTML serialization of the report.', ['engine', 'scan', 'framework'], 'complex'),
  'lib/ensemble.mjs': ('file', 'Adaptive ensemble', 'The NIFTY primary forecast: TimesFM artifact loading, artifact freshness, next trading day math, the learned weight blend w*TF+(1-w)*(LSTM-bias), the framework scorecard persistence and daily weight relearning from resolved outcomes.', ['engine', 'ensemble', 'learning'], 'complex'),
  'lib/lstm.mjs': ('file', 'LSTM runtime', 'A faithful JavaScript port of the TensorFlow 1.6 LSTMCell math (3 stacked layers, 200/200/150 units) with a decoder for the base64 packed weights and a 5 session recursive forecaster. Runs in Node functions and could run in the browser.', ['engine', 'lstm', 'model'], 'complex'),
  'lib/model-nifty.mjs': ('file', 'Packed NIFTY model', 'The trained NIFTY LSTM weights shipped as a base64 blob (~693k float32 parameters) plus the frozen scaler window; decoded once per cold start.', ['engine', 'lstm', 'weights'], 'simple'),
  'lib/stock-features.mjs': ('file', 'Stock feature math', 'Feature engineering for the per stock models: date bisect, percent change, population std, RSI-14, the 26 feature row builder, the walk-forward splitter and the exported GBM tree prediction (dump_model port from LightGBM).', ['engine', 'features', 'gbm'], 'complex'),
  'lib/stocks-engine.mjs': ('file', 'Per stock adaptive engine', 'The 50 symbol ecosystem: STOCKS list, incremental Nasdaq history pulls, per stock state (bias, band, blend weight), prediction resolution against real closes, daily relearning, the calibrated 80 percent band and the stocks-live view assembly.', ['engine', 'stocks', 'learning'], 'complex'),
  'lib/news-engine.mjs': ('file', 'News and events engine', 'The 08:40 IST cycle: CNBC and Google News RSS fetching and regex parsing, per symbol feeds with pacing, the Nasdaq earnings calendar (10 weekdays), keyword event tags, heavy news detection against a trailing 14 day average and the news-history blob accounting.', ['engine', 'news', 'events'], 'complex'),
  'lib/gbm-model.json': ('resource', 'GBM tree model', 'The LightGBM dump_model export (trees, thresholds, leaf values) for the pooled direction model; evaluated in JS by gbmPredict with full precision thresholds.', ['data', 'gbm', 'model'], 'simple'),
  # ---- functions ----
  'netlify/functions/daily-scan.mjs': ('file', 'daily-scan stub', 'Scheduled 03:30 UTC (09:00 IST, Mon-Fri). Hands the full scan to scan-background with the daily-schedule trigger header; scheduled functions have a 30s cap so the work must move to a background function.', ['function', 'schedule', 'stub'], 'simple'),
  'netlify/functions/post-open-scan.mjs': ('file', 'post-open-scan stub', 'Scheduled 03:50 UTC (09:20 IST, Mon-Fri). Triggers the post-open confirmation snapshot in scan-background with the post-open header.', ['function', 'schedule', 'stub'], 'simple'),
  'netlify/functions/news-scan.mjs': ('file', 'news-scan stub', 'Scheduled 03:10 UTC (08:40 IST, Mon-Sat). Triggers news-background; also self throttles to one run per 10 minutes via the last-news-run blob so public re-triggers cannot force reruns.', ['function', 'schedule', 'stub'], 'simple'),
  'netlify/functions/stocks-adaptive.mjs': ('file', 'stocks-adaptive stub', 'Scheduled 03:40 UTC (09:10 IST, Mon-Sat; Saturday catches the Friday US close). Triggers stocks-adaptive-background with a 10 minute stub guard.', ['function', 'schedule', 'stub'], 'simple'),
  'netlify/functions/scan-background.mjs': ('file', 'scan-background worker', 'The 15 minute budget worker for the daily scan and the post-open confirmation. Rejects headerless public POSTs (403), stores the report as JSON/markdown/HTML in blobs, updates the framework scorecard and computes the summary in memory to dodge blob read-after-write staleness.', ['function', 'background', 'worker'], 'complex'),
  'netlify/functions/news-background.mjs': ('file', 'news-background worker', 'Runs the full news cycle (market + India headlines, 50 per symbol feeds, earnings calendar). Public invocations are throttled to one run per 30 minutes by the last-news-run blob guard; scheduled runs always pass.', ['function', 'background', 'worker'], 'moderate'),
  'netlify/functions/stocks-adaptive-background.mjs': ('file', 'stocks-adaptive-background worker', 'Runs the per stock learning cycle: resolves pending predictions against real closes, relearns per stock parameters and emits the next session forecasts into the stocks-live blob. Same 30 minute public throttle pattern.', ['function', 'background', 'worker'], 'moderate'),
  'netlify/functions/api-latest.mjs': ('file', 'api-latest endpoint', 'GET /api/latest: serves the stored latest report JSON from blobs (no-store) with a small in-memory cache.', ['function', 'api'], 'simple'),
  'netlify/functions/api-history.mjs': ('file', 'api-history endpoint', 'GET /api/history: lists every saved report date from the reports/ blob prefix for the archive UI.', ['function', 'api'], 'simple'),
  'netlify/functions/api-report.mjs': ('file', 'api-report endpoint', 'GET /api/report?date=YYYY-MM-DD: serves one archived report (JSON, markdown or HTML by extension).', ['function', 'api'], 'simple'),
  'netlify/functions/api-news.mjs': ('file', 'api-news endpoint', 'GET /api/news: serves the latest news cycle view (market and India headlines, per symbol feeds, earnings, tags, heavy flags).', ['function', 'api'], 'simple'),
  'netlify/functions/api-stocks.mjs': ('file', 'api-stocks endpoint', 'GET /api/stocks: serves the stocks-live view (50 predictions, per stock learning state, aggregate stats, artifact freshness).', ['function', 'api'], 'simple'),
  'netlify/functions/api-scan.mjs': ('file', 'api-scan endpoint', 'POST /api/scan: the run-scan-now button behind the 2 minute blob throttle; forwards to scan-background with the manual trigger header.', ['function', 'api', 'guarded'], 'simple'),
  # ---- tools ----
  'tools/build-search-index.mjs': ('file', 'Search index builder', 'Builds assets/search-index.json from the 7 content pages (tags stripped) plus the 95 glossary terms imported from the real module, so search covers the glossary with anchors. Run after any content change.', ['tooling', 'search'], 'simple'),
  'tools/build-model-analysis.mjs': ('file', 'Model analysis builder', 'Offline: learns the ensemble weight from the TimesFM and LSTM forecast histories and writes assets/model-analysis.json.', ['tooling', 'ensemble'], 'moderate'),
  'tools/test-news-engine.mjs': ('file', 'News engine test', 'Runs one real news cycle locally against the live sources and asserts headline counts, symbol feed health and earnings parsing. The NEWS_ENGINE_OK gate.', ['tooling', 'test'], 'simple'),
  'tools/test-stocks-engine.mjs': ('file', 'Stocks engine test', 'Simulates the adaptive cycle against a fake blob store and asserts prediction resolution and relearning.', ['tooling', 'test'], 'moderate'),
  'tools/prove-adaptivity.mjs': ('file', 'Adaptivity proof', 'Replays the walk-forward with the adaptive layer on and off to measure the honest gain (+0.3 to +1.1 points) and band coverage (77.97 percent).', ['tooling', 'backtest'], 'moderate'),
  'tools/validate-lstm.mjs': ('file', 'LSTM validator', 'Loads the packed NIFTY model, runs the 5 session forecast and compares against the recorded training-time outputs to prove the JS port is bit faithful.', ['tooling', 'validation'], 'simple'),
  'tools/style-audit.mjs': ('file', 'Style auditor', 'Audits all shipped text for em dashes, buzzwords and style rule violations with an allowlist for numbers, tickers and ISO dates.', ['tooling', 'audit'], 'moderate'),
  'tools/pack_model.py': ('file', 'Model packer', 'Python: reads the trained Keras LSTM weights and emits the base64 packed blob consumed by lib/model-nifty.mjs.', ['tooling', 'lstm'], 'moderate'),
  'tools/stock_forecasts.py': ('file', 'Offline data fetcher', 'Python: pulls per stock history from Nasdaq, Yahoo and Alpha Vantage with fallbacks and paces requests; feeds the offline TimesFM runs.', ['tooling', 'data'], 'moderate'),
  'tools/timesfm_run.py': ('file', 'TimesFM runner', 'Python: batches the 50 symbols through TimesFM 2.5 offline and writes the forecast artifact.', ['tooling', 'timesfm'], 'moderate'),
  'tools/make_exhibit.py': ('file', 'Exhibit builder', 'Python: builds the HPQ validation exhibit data from the article dataset.', ['tooling', 'validation'], 'simple'),
  'tools/test-local.mjs': ('file', 'Local end-to-end test', 'Boots the functions locally with netlify dev style stubs and checks the report pipeline.', ['tooling', 'test'], 'simple'),
  'test-local.mjs': ('file', 'Root local test', 'Smoke test runner for the local function stack from the project root.', ['tooling', 'test'], 'simple'),
  # ---- config and docs ----
  'netlify.toml': ('config', 'Netlify configuration', 'Deploy config: publish dir, functions dir, esbuild bundler, the 4 cron schedules (news 03:10, daily 03:30, stocks 03:40, post-open 03:50 UTC) and the global security headers (CSP with the Netlify HUD hash, HSTS, XFO, XCTO, Referrer-Policy, Permissions-Policy, COOP) plus asset cache rules.', ['config', 'deploy', 'security'], 'moderate'),
  'package.json': ('config', 'Package manifest', 'Dev-only dependencies (netlify-cli, playwright) and the test script; the site itself ships zero npm dependencies.', ['config'], 'simple'),
  'skills-lock.json': ('config', 'Skills lockfile', 'Records the agent skills installed into .claude/skills (find-skills, web-design-guidelines, the Understand-Anything suite) for reproducibility.', ['config', 'tooling'], 'simple'),
  'README.md': ('document', 'Project README', 'The project manual: what runs every trading day, the LSTM model provenance, TimesFM and the ensemble, the per stock ecosystem, the glossary and ELI5 pages, operations and the v5.4 changelog.', ['docs'], 'moderate'),
  'COMPLIANCE.md': ('document', 'Compliance ledger', 'The point by point audit ledger against the original spec document, version by version (v1 through v5.4), including what is deliberately honest versus what is out of scope.', ['docs', 'compliance'], 'moderate'),
  'llms.txt': ('document', 'LLM instructions file', 'Guides AI systems and crawlers: what the site is, the page map, the honest accuracy numbers and the data sources.', ['docs', 'seo'], 'simple'),
  'robots.txt': ('resource', 'Robots file', 'Allows all crawlers, points to the sitemap.', ['seo'], 'simple'),
  'sitemap.xml': ('resource', 'Sitemap', 'All 9 pages with change frequencies and priorities.', ['seo'], 'simple'),
}

# ---------------- curated function knowledge (the significant ones) ----------------
FN = {
  'lib/scan.mjs:runScan': ('Fetches all four checks plus context, applies the role framework, attaches the LSTM forecast and returns the full report object.', ['engine', 'framework'], 'complex'),
  'lib/scan.mjs:istNow': ('IST clock: current date, time, weekend flag and session awareness for the scheduler and the report.', ['time'], 'simple'),
  'lib/scan.mjs:usIndices': ('Overnight US index closes (S&P, Nasdaq, Dow) with change percents from Yahoo/CNBC with fallbacks.', ['data', 'source'], 'moderate'),
  'lib/scan.mjs:indiaVix': ('India VIX level and its 10 day percentile, the fear gauge check.', ['data', 'source'], 'moderate'),
  'lib/scan.mjs:advanceDecline': ('NIFTY 50 breadth: advancers vs decliners, the participation check.', ['data', 'source'], 'moderate'),
  'lib/scan.mjs:giftNifty': ('GIFT Nifty implied open scraped from TradingView; drives the readiness call.', ['data', 'source'], 'moderate'),
  'lib/scan.mjs:frameworkVerdict': ('Role based framework v2: weighs each check\'s role and state into the overall bias classification (Positive large to Negative large, Neutral or Conflicting).', ['engine', 'framework'], 'complex'),
  'lib/scan.mjs:toMarkdown': ('Serializes the report to the plain markdown archive format.', ['serialize'], 'moderate'),
  'lib/ensemble.mjs:ensembleView': ('Blends TimesFM and the bias corrected LSTM with the learned weight and produces the forecast panel view.', ['engine', 'ensemble'], 'complex'),
  'lib/ensemble.mjs:updateScorecard': ('Records each resolved forecast outcome and relearns the blend weight daily once at least 5 outcomes exist.', ['engine', 'learning'], 'moderate'),
  'lib/ensemble.mjs:nextTradingDays': ('Trading day calendar skipping weekends only, used for forecast horizons.', ['time'], 'simple'),
  'lib/lstm.mjs:decodePackedModel': ('Decodes the base64 packed weights (Little Endian float32) into layer matrices for inference.', ['lstm', 'decode'], 'moderate'),
  'lib/lstm.mjs:LstmForecaster': ('The recursive forecaster: warm starts with 49 real observations, predicts t+1, feeds predictions forward for the 5 session path.', ['lstm', 'forecast'], 'complex'),
  'lib/lstm.mjs:LstmCell': ('One LSTM cell step: input/forget/output gates with peephole free TF 1.6 semantics and clipped internal state.', ['lstm', 'math'], 'moderate'),
  'lib/stocks-engine.mjs:runAdaptiveCycle': ('One full learning cycle: pull new closes, resolve pending predictions, relearn per stock bias/band/blend, emit next forecasts.', ['engine', 'learning'], 'complex'),
  'lib/stocks-engine.mjs:newState': ('Initializes per stock state including the VIX history the feature row needs (a past bug forgot it).', ['engine', 'state'], 'simple'),
  'lib/stocks-engine.mjs:fetchNewRows': ('Incremental Nasdaq quote API pulls with 1.1s pacing and newest-first row parsing.', ['data', 'source'], 'moderate'),
  'lib/news-engine.mjs:runNewsCycle': ('The whole 08:40 cycle: market and India headlines, 50 paced per symbol feeds, the earnings calendar, tags, heavy flags and history accounting.', ['engine', 'news'], 'complex'),
  'lib/news-engine.mjs:parseRss': ('Regex RSS/Atom parser extracting titles, links and dates without an XML dependency.', ['parse'], 'moderate'),
  'lib/news-engine.mjs:fetchEarnings': ('Nasdaq earnings calendar walker for the next 10 weekdays with per request pacing.', ['data', 'source'], 'moderate'),
  'lib/news-engine.mjs:tagHeadline': ('Keyword matcher that tags headlines (rates, earnings, geopolitics, guidance, accident) using the TAGS table.', ['parse', 'tags'], 'simple'),
  'lib/stock-features.mjs:featureRow': ('Builds the 26 features (returns, RSI, vol regimes, VIX percentile) for one symbol and day.', ['features'], 'moderate'),
  'lib/stock-features.mjs:gbmPredict': ('Evaluates the exported LightGBM trees in JS with full precision thresholds; regression starts at 0.', ['gbm', 'predict'], 'moderate'),
  'assets/app.js:loadReport': ('Fetches /api/latest (or an archived date), renders every dashboard panel and wires glossary term links.', ['rendering'], 'complex'),
  'assets/app.js:renderNews': ('Renders the news panel: earnings chips with estimates, heavy news flags, US and India headline lists and the honest display-only note.', ['rendering', 'news'], 'moderate'),
  'assets/app.js:plainWords': ('The one box a first time visitor reads: today\'s call in one sentence with the model number and its honest caveat.', ['rendering', 'ux'], 'simple'),
  'assets/app.js:linkGlossaryTerms': ('Auto links known jargon phrases in rendered text to their glossary anchors.', ['rendering', 'glossary'], 'moderate'),
  'assets/app.js:initTheme': ('Theme bootstrap and toggle with localStorage persistence and theme-color meta sync.', ['chrome', 'theme'], 'simple'),
  'assets/charts.js:lineChart': ('Multi series SVG line chart with axes, nice ticks, legend and the fixed Okabe-Ito palette.', ['charts'], 'moderate'),
  'assets/stocks-view.js:loadLive': ('Fetches /api/stocks and /api/news in parallel and renders the live table with the events column.', ['rendering', 'stocks'], 'complex'),
  'assets/stocks-view.js:bindLiveSort': ('Wires the sortable headers: click flips direction, re-renders tbody and thead and rebinds.', ['rendering', 'table'], 'moderate'),
  'netlify/functions/scan-background.mjs:storeReport': ('Writes the report as JSON, markdown and HTML blobs for the archive, the API and the latest view.', ['storage'], 'moderate'),
  'netlify/functions/scan-background.mjs:postOpenConfirmation': ('The 09:20 snapshot: what actually happened after the bell, merged into today\'s stored report.', ['engine', 'framework'], 'moderate'),
  'netlify/functions/scan-background.mjs:summaryFrom': ('Computes the summary in memory after storing, dodging the blob read-after-write staleness bug.', ['storage'], 'simple'),
}

CLASSES = {
  'lib/lstm.mjs:LstmForecaster': ('Recursive 5 session forecaster around the ported cell stack.', ['lstm'], 'complex'),
  'lib/lstm.mjs:LstmCell': ('Single LSTM cell step with TF 1.6 gate semantics.', ['lstm'], 'moderate'),
}

# ---------------- edges ----------------
IMPORTS = [
  ('index.html', 'assets/app.js'), ('index.html', 'assets/styles.css'),
  ('stocks.html', 'assets/stocks-view.js'), ('stocks.html', 'assets/chrome.js'), ('stocks.html', 'assets/styles.css'),
  ('glossary.html', 'assets/glossary-view.js'), ('glossary.html', 'assets/chrome.js'), ('glossary.html', 'assets/styles.css'),
  ('eli5.html', 'assets/chrome.js'), ('eli5.html', 'assets/styles.css'),
  ('model.html', 'assets/chrome.js'), ('model.html', 'assets/styles.css'),
  ('methodology.html', 'assets/chrome.js'), ('methodology.html', 'assets/styles.css'),
  ('privacy.html', 'assets/chrome.js'), ('privacy.html', 'assets/styles.css'),
  ('search.html', 'assets/search-view.js'), ('search.html', 'assets/chrome.js'), ('search.html', 'assets/styles.css'),
  ('404.html', 'assets/chrome.js'), ('404.html', 'assets/styles.css'),
  ('assets/app.js', 'assets/charts.js'), ('assets/app.js', 'assets/glossary-terms.mjs'),
  ('assets/glossary-view.js', 'assets/glossary-terms.mjs'),
  ('netlify/functions/scan-background.mjs', 'lib/scan.mjs'), ('netlify/functions/scan-background.mjs', 'lib/ensemble.mjs'),
  ('netlify/functions/scan-background.mjs', 'lib/lstm.mjs'), ('netlify/functions/scan-background.mjs', 'lib/model-nifty.mjs'),
  ('netlify/functions/news-background.mjs', 'lib/news-engine.mjs'), ('netlify/functions/news-background.mjs', 'lib/stocks-engine.mjs'),
  ('netlify/functions/stocks-adaptive-background.mjs', 'lib/stocks-engine.mjs'),
  ('lib/ensemble.mjs', 'lib/lstm.mjs'), ('lib/ensemble.mjs', 'lib/model-nifty.mjs'),
  ('lib/stocks-engine.mjs', 'lib/stock-features.mjs'),
  ('tools/build-search-index.mjs', 'assets/glossary-terms.mjs'),
]
RUNTIME = [  # fetched at runtime, not ESM
  ('index.html', 'assets/hpq-article.json'), ('index.html', 'assets/model-analysis.json'),
  ('stocks.html', 'assets/backtest-decade.json'), ('stocks.html', 'assets/stock-forecasts.json'),
  ('search.html', 'assets/search-index.json'),
  ('lib/stocks-engine.mjs', 'lib/gbm-model.json'), ('lib/stocks-engine.mjs', 'assets/stock-history-seed.json'),
]
CONFIGURES = [
  ('netlify.toml', 'netlify/functions/daily-scan.mjs'), ('netlify.toml', 'netlify/functions/post-open-scan.mjs'),
  ('netlify.toml', 'netlify/functions/news-scan.mjs'), ('netlify.toml', 'netlify/functions/stocks-adaptive.mjs'),
  ('netlify.toml', 'netlify/functions/scan-background.mjs'), ('netlify.toml', 'netlify/functions/news-background.mjs'),
  ('netlify.toml', 'netlify/functions/stocks-adaptive-background.mjs'),
  ('netlify.toml', 'netlify/functions/api-latest.mjs'), ('netlify.toml', 'netlify/functions/api-history.mjs'),
  ('netlify.toml', 'netlify/functions/api-report.mjs'), ('netlify.toml', 'netlify/functions/api-news.mjs'),
  ('netlify.toml', 'netlify/functions/api-stocks.mjs'), ('netlify.toml', 'netlify/functions/api-scan.mjs'),
  ('package.json', 'test-local.mjs'), ('package.json', 'tools/test-local.mjs'),
]
TRIGGERS = [
  ('netlify/functions/daily-scan.mjs', 'netlify/functions/scan-background.mjs'),
  ('netlify/functions/post-open-scan.mjs', 'netlify/functions/scan-background.mjs'),
  ('netlify/functions/news-scan.mjs', 'netlify/functions/news-background.mjs'),
  ('netlify/functions/stocks-adaptive.mjs', 'netlify/functions/stocks-adaptive-background.mjs'),
  ('netlify/functions/api-scan.mjs', 'netlify/functions/scan-background.mjs'),
]
SERVES = [
  ('netlify/functions/api-latest.mjs', 'index.html'), ('netlify/functions/api-news.mjs', 'index.html'),
  ('netlify/functions/api-history.mjs', 'index.html'), ('netlify/functions/api-report.mjs', 'index.html'),
  ('netlify/functions/api-stocks.mjs', 'stocks.html'), ('netlify/functions/api-news.mjs', 'stocks.html'),
]
DOCUMENTS = [
  ('README.md', 'lib/scan.mjs'), ('README.md', 'lib/ensemble.mjs'), ('README.md', 'lib/lstm.mjs'),
  ('README.md', 'lib/stocks-engine.mjs'), ('README.md', 'lib/news-engine.mjs'), ('README.md', 'netlify.toml'),
  ('COMPLIANCE.md', 'README.md'), ('llms.txt', 'index.html'), ('llms.txt', 'search.html'),
]
CALLS = [
  ('netlify/functions/scan-background.mjs:default', 'lib/scan.mjs:runScan'),
  ('netlify/functions/news-background.mjs:default', 'lib/news-engine.mjs:runNewsCycle'),
  ('netlify/functions/stocks-adaptive-background.mjs:default', 'lib/stocks-engine.mjs:runAdaptiveCycle'),
  ('lib/ensemble.mjs:ensembleView', 'lib/lstm.mjs:LstmForecaster'),
  ('assets/app.js:loadReport', 'assets/app.js:renderNews'),
  ('assets/app.js:loadReport', 'assets/app.js:plainWords'),
  ('assets/app.js:loadReport', 'assets/app.js:linkGlossaryTerms'),
  ('lib/stocks-engine.mjs:runAdaptiveCycle', 'lib/stock-features.mjs:featureRow'),
  ('lib/stocks-engine.mjs:runAdaptiveCycle', 'lib/stock-features.mjs:gbmPredict'),
]

PREFIX = {'file': 'file', 'config': 'config', 'document': 'document', 'resource': 'resource'}

def nid(path, prefix):
    return f'{prefix}:{path}'

def build():
    # group files into the same batches the extractor used
    batches = json.load(open(f'{ROOT}/.ua/intermediate/batches.json'))['batches']
    out = {}
    for batch in batches:
        i = batch['batchIndex']
        nodes, edges = [], []
        for f in batch['files']:
            p = f if isinstance(f, str) else f.get('path')
            if p.startswith('.netlify'):
                continue  # CLI state, not part of the codebase
            if p not in F:
                # uncurated leftover: emit a minimal honest node rather than nothing
                nodes.append({'id': nid(p, 'file'), 'type': 'file', 'name': p.split('/')[-1],
                              'filePath': p, 'summary': 'Project file.', 'tags': ['file'], 'complexity': 'simple'})
                continue
            typ, name, summary, tags, cx = F[p]
            nodes.append({'id': nid(p, PREFIX[typ]), 'type': typ, 'name': name,
                          'filePath': p, 'summary': summary, 'tags': tags, 'complexity': cx})
        out[i] = (nodes, edges)

    def edge(list_, etype, weight=0.7):
        for a, b in list_:
            src = a if ':' in a.split('/')[0] and a.split('/')[0].endswith(('.mjs', '.js')) is False and ':' in a else None
            out_edges.append({'source': a, 'target': b, 'type': etype, 'direction': 'forward', 'weight': weight})

    # resolve node id for a path
    def pid(p):
        if p not in F:
            return nid(p, 'file')
        return nid(p, PREFIX[F[p][0]])

    def fid(key):
        p, name = key.split(':')
        return f'function:{p}:{name}'

    def cid(key):
        p, name = key.split(':')
        return f'class:{p}:{name}'

    all_edges = []
    for a, b in IMPORTS:
        all_edges.append({'source': pid(a), 'target': pid(b), 'type': 'imports', 'direction': 'forward', 'weight': 0.7})
    for a, b in RUNTIME:
        all_edges.append({'source': pid(a), 'target': pid(b), 'type': 'related', 'direction': 'forward', 'weight': 0.5})
    for a, b in CONFIGURES:
        all_edges.append({'source': pid(a), 'target': pid(b), 'type': 'configures', 'direction': 'forward', 'weight': 0.6})
    for a, b in TRIGGERS:
        all_edges.append({'source': pid(a), 'target': pid(b), 'type': 'triggers', 'direction': 'forward', 'weight': 0.8})
    for a, b in SERVES:
        all_edges.append({'source': pid(a), 'target': pid(b), 'type': 'serves', 'direction': 'forward', 'weight': 0.5})
    for a, b in DOCUMENTS:
        all_edges.append({'source': pid(a), 'target': pid(b), 'type': 'documents', 'direction': 'forward', 'weight': 0.4})

    # function + class nodes with contains edges
    fn_nodes = []
    for key, (summary, tags, cx) in FN.items():
        p, name = key.split(':')
        fn_nodes.append({'id': fid(key), 'type': 'function', 'name': name, 'filePath': p,
                         'summary': summary, 'tags': tags, 'complexity': cx})
        all_edges.append({'source': pid(p), 'target': fid(key), 'type': 'contains', 'direction': 'forward', 'weight': 0.9})
    for key, (summary, tags, cx) in CLASSES.items():
        p, name = key.split(':')
        fn_nodes.append({'id': cid(key), 'type': 'class', 'name': name, 'filePath': p,
                         'summary': summary, 'tags': tags, 'complexity': cx})
        all_edges.append({'source': pid(p), 'target': cid(key), 'type': 'contains', 'direction': 'forward', 'weight': 0.9})
    for a, b in CALLS:
        all_edges.append({'source': fid(a) if not a.endswith(':default') else pid(a.replace(':default', '')),
                          'target': fid(b) if ':' in b and b.split(':')[0].endswith(('.mjs', '.js')) else pid(b),
                          'type': 'calls', 'direction': 'forward', 'weight': 0.6})

    # special: default-export handlers (functions) for the workers
    for p in ['netlify/functions/scan-background.mjs', 'netlify/functions/news-background.mjs', 'netlify/functions/stocks-adaptive-background.mjs']:
        fn_nodes.append({'id': f'function:{p}:default', 'type': 'function', 'name': 'default handler',
                         'filePath': p, 'summary': 'The function entrypoint: guards, then runs the cycle and stores the result.',
                         'tags': ['entrypoint'], 'complexity': 'moderate'})
        all_edges.append({'source': pid(p), 'target': f'function:{p}:default', 'type': 'contains', 'direction': 'forward', 'weight': 0.9})

    # distribute nodes/edges to their batch files: a node belongs to the batch its file was scanned in
    batch_of = {}
    for batch in batches:
        for f in batch['files']:
            p = f if isinstance(f, str) else f.get('path')
            batch_of[p] = batch['batchIndex']

    def target_batch(node):
        p = node['filePath']
        return batch_of.get(p, 3)

    for i in out:
        nodes, _ = out[i]
        for n in fn_nodes:
            if target_batch(n) == i:
                nodes.append(n)
        out[i] = (nodes, None)

    # edges: put each edge in the batch of its SOURCE node (merge concatenates anyway)
    for i in out:
        out[i] = (out[i][0], [])
    for e in all_edges:
        src_path = e['source'].split(':', 1)[1]
        if e['source'].startswith('function:') or e['source'].startswith('class:'):
            src_path = ':'.join(e['source'].split(':')[1:])
        bi = batch_of.get(src_path)
        if bi is None:
            bi = 3
        out[bi][1].append(e)

    for i, (nodes, edges) in out.items():
        payload = {
            'batchFiles': [],
            'nodes': nodes,
            'edges': edges,
            'notes': 'Authored by the project author as the file-analyzer agent (Understand-Anything Phase 2).',
        }
        path = f'{ROOT}/.ua/intermediate/batch-{i}.json'
        json.dump(payload, open(path, 'w'), indent=1)
        print(f'batch-{i}.json: {len(nodes)} nodes, {len(edges)} edges')

build()
