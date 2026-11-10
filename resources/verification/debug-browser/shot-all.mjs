// Screenshot all pages at given widths. Usage: node shot-all.mjs <before|after|N> [fullpage]
// Pages are the 8 site pages; API-backed panels need the API... local static server
// has no functions, so we inject the LIVE production API origin into fetch via
// page.route rewrite so panels render with real data exactly like production.
import { chromium } from 'playwright';
import fs from 'node:fs';

const label = process.argv[2] || 'before';
const fullOnly = process.argv[3] === 'fullpage';
const OUT = `/home/user/screens/${label}`;
fs.mkdirSync(OUT, { recursive: true });

const BASE = 'http://localhost:8899';
const PROD_API = 'https://premarket-india-report.netlify.app';
const PAGES = [
  ['index.html', 'index'],
  ['stocks.html', 'stocks'],
  ['glossary.html', 'glossary'],
  ['eli5.html', 'eli5'],
  ['model.html', 'model'],
  ['methodology.html', 'methodology'],
  ['privacy.html', 'privacy'],
  ['search.html', 'search'],
  ['nope-does-not-exist.html', '404'],
];
const WIDTHS = [
  [1366, 900, 'desk'],
  [390, 844, 'mob'],
];

const browser = await chromium.launch();
for (const [w, h, tag] of WIDTHS) {
  for (const [file, name] of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    // Rewrite same-origin /api/* calls to the production API so data panels render.
    await page.route('**/api/latest', (route) => route.fulfill({ path: 'debug-browser/fixtures/latest.json' }));
    await page.route('**/api/stocks', (route) => route.fulfill({ path: 'debug-browser/fixtures/stocks.json' }));
    await page.route('**/api/news', (route) => route.fulfill({ path: 'debug-browser/fixtures/news.json' }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    try {
      await page.goto(`${BASE}/${file}`, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (e) {
      errors.push('LOAD: ' + String(e).slice(0, 120));
    }
    await page.waitForTimeout(1200);
    // glossary: expand first letter section? No — default view is the honest baseline.
    const kind = fullOnly ? 'full' : 'fold';
    if (fullOnly) {
      await page.screenshot({ path: `${OUT}/${name}-${tag}-full.png`, fullPage: true });
    } else {
      await page.screenshot({ path: `${OUT}/${name}-${tag}-fold.png` });
    }
    console.log(`${name}-${tag}: errors=${errors.length ? JSON.stringify(errors).slice(0, 200) : 'none'}`);
    await ctx.close();
  }
}
await browser.close();
console.log('DONE ->', OUT);
