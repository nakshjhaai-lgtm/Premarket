# Compliance audit — "vibe-coded signals" document

Audit of this project against `/home/user/uploads/vibe-coded-signals-exhaustive (2).md`
(sections 15–21). Status legend: ✅ done · ⛔ N/A with reason · ⚠️ deliberate deviation,
documented · ⏳ pending user input.

---

## §15 Quick self-audit (red flags) — target: none present

| Area | Status | Evidence |
|---|---|---|
| Purple/indigo gradients, neon, glow, gradient blobs, animated grids, noise, spotlight | ✅ none | Palette: deep teal accent `#0e6e78`, neutrals; zero gradients except skeleton shimmer and the score track (both functional) |
| Sparkles/emojis in headings | ✅ none | No emoji anywhere in UI copy |
| Cards-in-cards, shadow on everything, floating cards | ✅ | One shadow level (`--sh1`) on panels; factor cards use border only; header shadow appears on scroll |
| Pill buttons (radius 9999) / inconsistent radii | ✅ | Two radii only: `--r1: 6px` controls, `--r2: 10px` surfaces |
| Status dots representing nothing | ✅ | Chip dots always accompany a text label (redundant cue) |
| Text-only logo | ✅ | Custom SVG brand mark (teal tile + trend line) |
| Glassmorphism | ✅ none | Opaque surfaces |
| Inter/Geist default font | ⚠️ deliberate | System font stack chosen intentionally: zero webfont latency, no default-AI-tool look; numerals tabular (`--t-*` scale defined) |
| Oversized weights / random type sizes / full-width text | ✅ | Defined type scale; prose capped at 72ch |
| Inconsistent layout/padding/containers | ✅ | Spacing scale 4/8/12/16/24/32/48/64; single `.container` 1080px; same header/footer on every page |
| Dead social icons, fake carousels, template pricing cards, logo marquees | ✅ none | No such components exist |
| Empty footer | ✅ | Footer: description, product links, trust links, source attribution, legal |
| No loading states / broken toggles / animation overload | ✅ | Skeletons with 180ms show-delay; scan button keeps label + spinner; no scroll-triggered animations (reduced-motion honored globally) |
| Em-dash copy everywhere | ⚠️ | Used sparingly as punctuation, not as a stylistic tic; no "Launch faster"/"Transform your workflow" class copy anywhere |
| Fake testimonials/reviews/photos/visitor counters/dashboard screenshots | ✅ none | Every number on the site is measured live and timestamped; the only image is the self-designed OG card |
| Default/missing favicon | ✅ | Custom `/favicon.svg` |
| Tool domain | ⏳ | Currently `*.netlify.app` — custom domain awaiting user decision |
| Tab title, blank screen while JS loads, content not in initial HTML | ✅ | Real titles; static prose sections + `<noscript>` fallback with links to the server-rendered report endpoints |
| Missing meta/OG/alt/H1/sitemap/robots/llms/canonical/structured data | ✅ | All present (see §16 rows 10–17) |
| Source maps in prod | ✅ | No build step → no maps |
| Console errors | ✅ | Browser-verified clean in production (headless Chromium); one known Netlify-injected HUD script explicitly hash-allowed in CSP |
| Site copy style | ✅ | Plain language policy (no dashes as punctuation, no prose hyphens, no AI tells); automated audit on all 8 pages: STYLE_OK |
| Bundle > 500KB | ✅ | Total JS ≈ 30KB (app+charts+chrome), CSS ≈ 14KB, no framework; the 2.8MB model blob is server-side only (function bundle), never shipped to the browser |
| "Made with X" branding | ✅ none | — |
| Missing privacy policy / contact / wrong © year | ✅ / ⏳ / ✅ | `/privacy.html` real and specific; © 2026; contact address awaiting user input |
| Fake metrics ("99.9% uptime") | ✅ none | Model metrics come from actual training runs; backtest recomputed daily |

## §16 Anti-vibe-coded 20-point checklist

1. Custom 404 — ✅ branded `/404.html` showing the missing path, recovery links
2. Clear CTA above the fold — ✅ "Run scan now" primary button + bias banner
3. Internal links — ✅ nav, footers, cross-page references, in-content links
4. Thank-you page after inquiry — ⛔ no forms exist (by design: no accounts, no contact form yet)
5. Breadcrumbs — ⛔ 4-page flat site; `aria-current` nav + skip link instead
6. Case study section — ✅ functional equivalent: the HPQ article-reproduction exhibit with real MSE numbers
7. 5 FAQs — ✅ 6 FAQs on `/methodology.html#faq` (+ FAQPage schema)
8. Response time promise — ⛔ no support channel yet; ⏳ pending contact decision
9. Sticky mobile CTA — ✅ sticky header carries nav; run-scan button is above the fold on mobile too
10. robots.txt — ✅ with sitemap reference (stocks.html added)
11. Unique page titles — ✅ 8 distinct titles (dashboard, stocks, models, methodology, glossary, ELI5, privacy, 404)
12. Meta descriptions — ✅ unique per page
13. Social share image — ✅ self-designed `/og.png` 1200×630 (42KB)
14. Maps + directions — ⛔ not a local business
15. Real customer reviews — ⛔ none fabricated; no users yet
16. Alt text — ✅ charts carry `role="img"` + descriptive `aria-label`/`<title>`; decorative SVGs `aria-hidden`
17. Local business schema — ⛔ → WebApplication + TechArticle + FAQPage schema shipped instead
18. Privacy policy — ✅ `/privacy.html`, specific (names the one localStorage key)
19. Google Analytics — ⚠️ deliberately omitted: privacy page promises "no analytics"; ⏳ user can override
20. Team photo — ⛔ solo research project; no fake team invented

## §17 Security vulnerabilities (20)

All N/A-by-architecture or fixed: no .env, no repo (⏳ if one is created: model pack is generated, not secret);
no API keys anywhere (all data sources are keyless public endpoints called server-side); no database (Blobs store
public report data only); no auth (nothing private); **rate limiting ✅** (120s blob-stamped guard on `/api/scan`);
no SQL; **server-side input validation ✅** (`/api/report` date regex + format whitelist, 400 otherwise);
no user content rendered (all HTML built from own data through `esc()`); no passwords/tokens/sessions;
no admin panel; no CORS wildcard (same-origin only); **no stack traces in responses** (generic messages, details to
function logs); dependencies: platform runtime + zero npm deps in the browser; no file uploads; no webhooks.

## §18 Security hardening (20)

1. Hide API keys — ✅ none exist; if added later they go in Netlify env vars (server-side only)
2. Purge git secrets — ⛔ no repo yet
3. Public DB key only — ⛔ no DB
4–8. RLS / encryption at rest / server-side auth / record locking / field tampering — ⛔ no user data exists; TLS in transit ✅ (Netlify HTTPS)
9. Secure cookies — ⛔ no cookies at all
10. Hash passwords — ⛔ no accounts
11. Rate limit login — ⛔ no login; scan endpoint rate-limited ✅
12. Bot protection — ✅ equivalent: rate limit + no forms; Turnstile can be added if abuse appears
13. Parameterized queries — ⛔ no DB
14. Validate all input — ✅ see §17
15. Escape user content — ✅ `esc()` on every dynamic string in `app.js`
16. Restrict uploads — ⛔ no uploads
17. Trim API responses — ✅ reports contain only rendered fields
18. Security headers — ✅ CSP (`script-src 'self'`, no inline scripts), X-Frame-Options DENY + `frame-ancestors 'none'`, nosniff, HSTS (1y + includeSubDomains), Referrer-Policy, Permissions-Policy
19. Force HTTPS — ✅ Netlify + HSTS
20. Scan dependencies — ✅ nothing to scan in the browser bundle; function deps are the managed runtime

## §19 Website features (20)

1. Dark mode toggle — ✅ respects `prefers-color-scheme`, persists in localStorage, syncs `theme-color`
2. Loading animations — ✅ skeletons with show-delay (180ms), shimmer respects reduced-motion
3. Hover states — ✅ every clickable element
4. Scroll progress bar — ✅ 2px accent, all pages
5. Site search — ⛔ 4 pages + date-keyed archive; archive list is the search surface
6. Back to top — ✅ appears past 600px
7. Mobile menu — ✅ accessible disclosure (`aria-expanded`, `aria-controls`), 48px rows
8. Sticky header — ✅ with elevation shadow on scroll
9. Skip to content — ✅ visible on focus, all pages
10. Copy to clipboard — ✅ "Copy report" with Copied/Copy-failed feedback
11. Print stylesheet — ✅ hides chrome, avoids page-break inside panels
12. Last updated — ✅ report generation timestamp + policy dates
13. Expandable FAQ — ✅ native `<details>`
14. Cookie banner — ⛔ no cookies (privacy page states this)
15–16. Form success/error states — ⛔ no forms; scan button success → fresh report + status line; failure → specific status message + retry
17. Confirmation modals — ⛔ no destructive actions exist
18. Password visibility toggle — ⛔ no passwords
19. UTM tracking — ⛔ no analytics by policy; deep links `?date=` supported (URL as state)
20. Floating contact button — ⏳ pending contact decision (back-to-top occupies the slot)

## §20 Website fixes (20)

1. No horizontal scroll — ✅ tables wrapped in `.table-scroll`; body never overflows
2. Mobile menu — ✅
3. Mobile overflow — ✅ tested layout at 375px (fluid grids, `minmax(240px,1fr)`)
4. No unused nav — ✅ every link resolves
5. All pages mobile-optimized — ✅ one design system across all 4 pages + 404
6–7. Broken/footer links — ✅ verified post-deploy (see deploy checklist below)
8. Logo clickable → home — ✅
9–10. Clickable phone/email — ⏳ pending contact decision
11. Favicon — ✅ custom SVG (+ .ico reference)
12. Page titles — ✅ "Name — Site" pattern, unique
13. Meta descriptions — ✅ <160 chars each
14. Custom 404 — ✅
15. Broken buttons — ✅ every button has a handler (verified in local DOM test)
16–17. Success/error messages — ✅ status line (`aria-live="polite"`) + error states with retry
18. Placeholder text — ✅ none; every paragraph is real, specific copy
19. Copyright year — ✅ 2026
20. Compress images — ✅ single 42KB optimized PNG; charts are vector SVG

## §21 Vercel web interface guidelines (mapped to Netlify)

Keyboard/focus: `:focus-visible` rings everywhere, native semantics (button/a/table/details) before ARIA,
icon-only buttons named (`aria-label`), skip link, hierarchical single-H1 pages, `scroll-margin-top` on anchors.
Targets: ≥44px touch targets (nav rows 48px), `touch-action: manipulation`. Zoom never disabled.
Loading: button keeps label + spinner; skeleton show-delay and minimum-visible-time; loading copy ends with "…".
URL as state: `?date=` deep links, `pushState`/`popstate`, shareable/refreshable, back-forward restores report.
All states designed: empty (no report yet), sparse (partial sources → "unavailable" rows), dense (full context
grid), error (fetch failure → retry), plus stale-model warning state.
Layout stability: charts ship explicit `viewBox`/dimensions; OG image never loaded in-page.
Design: two-layer shadows, crisp borders + hue-consistent tinting, nested radii (6 inside 10), Okabe-Ito
color-blind-safe chart palette, `color-scheme` set for both themes, `theme-color` synced, redundant status cues
(color + text), tabular numerals, locale-aware `en-US`/`en-IN` number and date formatting.
Copy: active voice, second person, numerals for counts, positive-framed errors that guide the exit
("Try again", "Check the connection"), specific labels ("Run scan now", not "Submit").
Performance: no main-thread blocking (model inference is server-side in the background function), no webfonts,
5-minute asset cache with revalidate, `no-store` on API.

---

## Deploy-time verification checklist

Verified in production on 2026-10-17 (deploy `6ad34bf1` + schedule fix):

- [x] `curl -I` every page: 200 + security headers present (CSP, X-Frame-Options DENY, nosniff, HSTS, Referrer-Policy, Permissions-Policy all confirmed on `/`)
- [x] `/api/latest`, `/api/history`, `/api/report?date=…&format=md|html` → 200; `/api/scan` double-tap → 429 rate-limited with message
- [x] Scheduled functions registered: `function_schedules` = `daily-scan · 30 3 * * 1-5` (09:00 IST) AND `post-open-scan · 50 3 * * 1-5` (09:20 IST) — both verified after the framework v2 deploy
- [x] 404 for a random path → custom branded page
- [x] robots.txt / sitemap.xml / llms.txt / og.png / favicon.svg reachable (all 200)
- [x] All footer + nav links resolve (verified against the deployed page set)
- [x] Model validation: `tools/validate-lstm.mjs` → HPQ max |Δ| 6.0e-7, NIFTY max |Δ| 7.4e-7 (both ≪ 5e-3) — PASS
- [x] Live framework-v2 report verified: opening-bias classification, gap-size tiers, global stances, VIX 1y percentile, 13 context factors (incl. live US futures), LSTM prediction + backtest, `unavailable: ['NSE pre-open']` (honestly reported — nseindia.com blocks datacenter IPs)
- [x] Post-open confirmation path validated from AWS (temporary probe: 5-minute candle parse + blobs both OK; probe deleted afterwards)
- [x] TimesFM asset live: `/assets/model-analysis.json` (head-to-head now on the 250-session walk-forward window + learned ensemble)
- [x] v4: dashboard browser-tested with headless Chromium (console clean, all sections render — fixed the m.forecast path bug and the skeleton that destroyed the host divs; renderers now fail into a visible error state instead of an eternal loader)
- [x] v4: CSP `script-src` carries only `'self'` + the SHA-256 hash of Netlify's injected HUD widget (not `unsafe-inline`); console verified clean in production
- [x] v4: adaptive-ensemble forecast in every report (formula, learned w/bias, component table, scorecard provenance); scorecard blob records/learns daily
- [x] v4: `/stocks.html` per-stock TimesFM forecasts (Nasdaq-API sourced EOD, ~50 symbols, per-symbol backtests) with as-of stamps
- [x] v4.1: `/glossary.html` (86 terms, search + A to Z + category filters, cross links, deep link anchors) and `/eli5.html` (static, works without JS); both in nav on every page including the mobile menu, sitemap and llms.txt
- [x] v4.1: inline term linking on the dashboard (first mention of each known term links to its glossary entry) via the shared assets/glossary-terms.mjs database
- [x] v4.1: automatic source fallbacks in the live scan: primary source, then an alternate where one exists, then a last-good blob cache with per-source TTLs; every report carries a sources map (live / cached with age / degraded) shown in the markdown, HTML and dashboard renderers; GIFT Nifty now tries both TradingView hosts; model input and post-open chart have cached fallbacks too
- [x] v5.1: per stock adaptive engine: decade trained gradient boosted trees (50 symbols, 26 features incl. VIX, SPY, QQQ, sector ETFs), walk forward by year validation with honest out-of-sample scores displayed, daily automatic resolve and re-learn per stock (bias, band, TimesFM blend), /api/stocks endpoint, Saturday schedule to catch the Friday US close
- [x] v5.4: anti vibe coded UI pass (spec: vibe-coded-signals-exhaustive): all 90 low contrast text tokens fixed in both themes (faint text #848e99 to #616c78 light, #7c8794 to #8d98a5 dark, accent contrast token for text on teal), 44px minimum tap targets everywhere (glossary chips, A to Z letters, FAQ rows, collapsed sections, breadcrumb links, all inputs), heading ladder repaired (footer h4 to h2, panel titles h2 to h3, glossary letters h2 to h3, 404 h1 to site scale, zero level skips on all 9 pages), one 3 value radius system (3/6/10 + geometric circles), spacing normalized to the 4/8 grid, typographic quotes, favicon.ico + apple-touch-icon added, unified rich footer with copyright on every page, breadcrumbs, estimated reading time, whole site /search.html over 102 documents, live stocks table made sortable (same pattern as the offline table), double theme-toggle handler on the dashboard fixed (chrome.js removed from index, app.js owns it), long code tokens wrap (320px overflow fixed), noscript nav fallback synced to the 919px breakpoint; security: Cross-Origin-Opener-Policy header, 30 minute rate guards on news-background + stocks-adaptive-background public invocations, 10 minute stub re-trigger guards; verified visually via screenshots + pixel analysis (0 percent neon, 0 gradients, 1 accent family) and programmatically (0 contrast violations, 0 overflows at 320/390/768/1366, 0 console errors, 18/18 interaction tests, both themes)
- [x] v5.3: news and events layer: 08:40 IST cycle (CNBC + Google News headlines US/India, per stock headlines, Nasdaq earnings calendar, keyword event tags, heavy news flags, daily news volume history blob), /api/news endpoint, dashboard "What else is moving markets" panel, stocks page events column + earnings line; explicitly displayed as context the models do not read, with copy updated on ELI5/model/methodology pages
- [x] v5.2: UX fixes: header nav collapses below 919px (was 720px, which overflowed tablet widths), all tables scroll inside their containers (new .table-wrap rule, methodology tables wrapped), dashboard gained a plain words summary line and a first visit strip, stocks page secondary tables collapse behind tap to open sections; framework scorecard summary now built from the state just written (same run read could be stale)
- [x] v5.1: framework track record: each opening bias call is resolved against the actual open and the rolling hit rate is shown on the dashboard
- [x] v4.1: writing policy applied site wide (Wikipedia Signs of AI writing as the model): no dashes as punctuation, no hyphenated compounds in prose (numbers, tickers, dates, identifiers exempt), no filler or promotional words; enforced by tools/style-audit.mjs (headless browser audit of visible text on all 8 pages) plus renderer assertions in tools/test-local.mjs; passing state verified in production
- [x] v4 final: headless-browser re-verification on `/`, `/stocks.html`, `/model.html` after the final deploy — all sections render, interactions (search/filter/sort) work, zero console/page errors

## Pending user decisions (⏳)

1. Contact email (for footer, mailto:, response-time promise)
2. Google Analytics or remain tracking-free (privacy page currently promises tracking-free)
3. Custom domain or keep `premarket-india-report.netlify.app`
