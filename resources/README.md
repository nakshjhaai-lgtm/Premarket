# resources/ — The Complete Tools & Resources Archive

Everything that was ever used to build, train, verify and document the site, but does not ship as part of the deployed site itself. **A new session with only this repository has every tool, dataset, script and document needed to continue the work — nothing has to be re-supplied manually except the two secrets (see the end of this file).**

## Map

| Directory | What it is | Why it matters |
|---|---|---|
| `specs/` | The two uploaded versions of the design spec (`vibe-coded-signals-exhaustive`). v2-1 is the final one the v5.4 UI pass was audited against; v2 is the earlier revision kept for the record. | The requirements source of truth. `COMPLIANCE.md` (repo root) is the ledger against it. |
| `article/` | The DataCamp LSTM tutorial artifacts: `blocks.txt` (the article code split into numbered blocks), `datacamp-article-page.html` (the saved article page, 711KB), `Stocks_hpq.txt` (the HPQ daily data the article uses), `datacamp-cf-block-page.html` (a Cloudflare block page saved during fetching — kept for the record only, it contains no article content). | Provenance for "follow the provided document fully 100%". The LSTM in `lib/lstm.mjs` is the faithful port of this exact article. |
| `training-lstm/` | The complete LSTM training environment (22 files): `lstm_stock_prediction.py` (the article code, run verbatim with tracked edits), `lstm_stock_prediction_kaggle.py` (Kaggle variant), `train_export.py` (trains + exports the packed model), `compat_runner.py`, `make_baselines.py`, `smoke_test.py`, `models/` (the two trained models: `hpq-article-model.json` = reproduction proof, `nifty-model.json` = the model whose packed weights ship as `lib/model-nifty.mjs`), `figures/` (the article's four output figures reproduced), `Stocks/hpq.us.txt` + `Stocks/nsei.us.txt` (training data), `DEVIATIONS.md` (every tracked deviation from the article), `_blocks.json`, `run.sh`, training logs, `README.md`. | Reproducibility of the model from raw data to packed weights. |
| `training-adaptive/` | The per stock GBM ecosystem training environment (76 files): `build_features.py` (26 feature builder), `train_walkforward.py` (the decade walk forward trainer), `download_data.py` (Nasdaq/Yahoo/AV fetcher with fallbacks), `export_final_model.py` (LightGBM `dump_model` export → `lib/gbm-model.json`), `adaptive_layer_test.py` + `experiments.py` (the adaptivity measurements), `parity_check.mjs` (JS vs Python parity gate), `gbm_final.json`, `meta.json`, `X.npy`/`y.npy` (the full feature matrix), `features.json`, `test_features.json`, `walkforward_results.json`, `data/` (62 per symbol history files + VIX history). | Reproducibility of the 50 symbol ecosystem and its honest accuracy numbers. |
| `verification/` | The browser verification stack: `debug-browser/` (29 files — `shot-all.mjs`, `render-audit.mjs` (accepts `BASE=` for live prod audits), `check-overflow.mjs`, `check-interactions.mjs`, `check-badge.mjs`, the per version check scripts v41–v55, `pixel-audit.py`, `build-compare-sheet.py`, `find-quotes.mjs`, `find-wf.mjs`, fixtures for local runs) plus `package.json` + `package-lock.json` (the Playwright dev dependencies for these scripts). | The verification methodology of PROJECT_BRAIN §14. Run `npm ci` inside this directory to restore the toolchain. |
| `env/` | `setup_env.sh` — the builder for the exact training environment: CPython 3.6.15 + TensorFlow 1.6.0 on modern Debian, with the three portability fixes (sinpi rename, `-fno-tree-vectorize` + libffi 3.3 for _ctypes, `make altinstall`). Plus both setup logs. | Without this, the article's TF 1.6 code cannot run on a modern machine. This script is the distilled solution. |
| `history-v1/` | The original v1 project (Python): `scan.py`, `dashboard.py`, `scheduler.py`, `start.sh`, `README.md`, and the first generated reports (2026-10-17 in md/json/html). | Project history: what ran locally before the Netlify migration. |
| `evidence/screens/` | The v5.4 UI evidence: `before/` (16 screenshots), `after/` (9 pages × desktop/mobile), `compare-before-after.html` (the 1.8MB visual diff sheet). | The proof of the anti vibe coded UI pass. |
| `history-agent-skills/` | The earlier standalone skills install (find-skills, web-design-guidelines + its lockfile) before they moved into `.claude/skills/` in the project root. | Install history; the live copies are in the repo root `.claude/skills/`. |

## Duplicates (deliberate, documented)

`Stocks_hpq.txt`, `Stocks/hpq.us.txt` and `training-lstm/Stocks/hpq.us.txt` are **byte identical** (sha256 `1262649f27cb011ec3ea527780cc59d09f3c8592eb2af69f244fc94682aa3429`). The copy under `training-lstm/Stocks/` is required there (the training scripts use that relative path); `article/Stocks_hpq.txt` preserves the original fetch. The workspace's separate `Stocks/` directory held nothing new and is not duplicated a third time.

## What was redacted before publishing (and why)

The Alpha Vantage free key appeared as a hardcoded fallback in **four** scripts: `tools/stock_forecasts.py` (site tools), and `training-lstm/lstm_stock_prediction.py`, `training-lstm/train_export.py`, `training-lstm/lstm_stock_prediction_kaggle.py` (resources). All four now read the key from the `AV_KEY` environment variable and refuse to run without it. The training results are unaffected (training already completed; re-running requires `export AV_KEY=<your key>`). No other secret was ever present in these files (full pattern scan: tokens, AWS, GitHub, private keys — all clean).

The quoted strings `password = "admin123"` and `api_key = "test_key_replace_this"` inside `specs/` are **illustrative examples of bad code in the spec document itself**, not credentials.

## What is NOT here (and why)

- `.venv/`, `node_modules/`, `__pycache__/`, Playwright browser caches — regenerable (`resources/verification/npm ci`, `python -m venv`, `setup_env.sh`).
- The Netlify auth token and the Alpha Vantage key — secrets, by policy never committed (PROJECT_BRAIN §17).
- Sandbox-local config (`.keras/`, `.config/`) — empty or environment specific.
- The Understand-Anything plugin clone and build — regenerable from GitHub; the exact build steps are PROJECT_BRAIN §20.2, and the skills themselves are in `.claude/skills/`.

## The only things a new session needs you to re-supply

1. **Netlify auth token** — to deploy (env var per command, PROJECT_BRAIN §16).
2. **Alpha Vantage key** — only if re-running the offline data fetchers or retraining (`export AV_KEY=...`).

Everything else — code, models, data, tools, specs, article, environment builder, evidence — is in this repository.
