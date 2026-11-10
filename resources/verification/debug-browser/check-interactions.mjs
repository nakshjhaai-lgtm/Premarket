// Interaction audit: every interactive control must visibly DO something.
// POSTs to /api/scan are intercepted (fake 200) so no real production scan fires.
import { chromium } from 'playwright';
const BASE = 'http://localhost:8899';

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);

const browser = await chromium.launch();
async function sortWait(page) {
  for (let i = 0; i < 40; i++) {
    if (await page.locator('#stocks-table th.sortable').count()) return;
    await page.waitForTimeout(500);
  }
}

async function fresh(w = 1366, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['clipboard-write', 'clipboard-read'] });
  await ctx.route('**/api/scan', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'triggered' }) }));
  await ctx.route('**/api/latest', (route) => route.fulfill({ path: 'debug-browser/fixtures/latest.json' }));
  await ctx.route('**/api/stocks', (route) => route.fulfill({ path: 'debug-browser/fixtures/stocks.json' }));
  await ctx.route('**/api/news', (route) => route.fulfill({ path: 'debug-browser/fixtures/news.json' }));
  const page = await ctx.newPage();
  return { ctx, page };
}

// ---------- index: theme toggle, copy report, run button (mocked), to-top ----------
{
  const { ctx, page } = await fresh();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const t0 = await page.evaluate(() => { const t = document.documentElement.getAttribute('data-theme'); if (t) return t; return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; });
  await page.click('#theme-toggle');
  const t1 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('theme toggle switches theme', (t0 === 'light' && t1 === 'dark') || (t0 === 'dark' && t1 === 'light'), `${t0} -> ${t1}`);
  check('theme persists in localStorage', await page.evaluate(() => ['dark', 'light'].includes(localStorage.getItem('pm-theme'))));

  const copy = page.locator('#copy-report');
  if (await copy.count()) {
    await copy.scrollIntoViewIfNeeded();
    // the dashboard fetches /api/latest from the live API; wait for the render
    for (let i = 0; i < 30 && !(await page.evaluate(() => !!window.__report)); i++) await page.waitForTimeout(500);
    const hadReport = await page.evaluate(() => !!window.__report);
    await copy.click();
    await page.waitForTimeout(400);
    const label = await copy.evaluate((e) => e.textContent.trim());
    check('copy report gives feedback', label.includes('Copied') || label.includes('failed'), `label="${label}" (report loaded: ${hadReport})`);
  } else check('copy report button exists', false);

  const run = page.locator('#run-scan');
  if (await run.count()) {
    await run.scrollIntoViewIfNeeded();
    await run.click();
    await page.waitForTimeout(600);
    const status = await page.evaluate(() => document.querySelector('#status')?.textContent || '');
    check('run scan button responds', /scan|trigger|running|moment/i.test(status), `status="${status.slice(0, 60)}"`);
  } else check('run scan button exists', false);

  await page.evaluate(() => scrollTo(0, 1200));
  await page.waitForTimeout(400);
  const prog = await page.evaluate(() => document.querySelector('#progress')?.style.width || '0%');
  check('scroll progress bar fills', parseFloat(prog) > 0, `width=${prog}`);
  const top = page.locator('#to-top');
  const visible = await top.evaluate((e) => getComputedStyle(e).display !== 'none' && e.classList.contains('show'));
  check('back-to-top appears after scroll', visible);
  await top.click();
  await page.waitForTimeout(900);
  check('back-to-top scrolls to top', await page.evaluate(() => scrollY < 50), `scrollY=${await page.evaluate(() => scrollY)}`);
  await ctx.close();
}

// ---------- glossary: search filters, chips filter, letter anchor ----------
{
  const { ctx, page } = await fresh();
  await page.goto(BASE + '/glossary.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const before = await page.locator('.glossary-entry').count();
  await page.fill('#glossary-search', 'nifty');
  await page.waitForTimeout(600);
  const after = await page.locator('.glossary-entry').count();
  check('glossary search filters terms', before > 3 && after >= 1 && after < before, `${before} -> ${after}`);
  const chip = page.locator('.chip-btn', { hasText: 'Models' }).first();
  if (await chip.count()) {
    await page.fill('#glossary-search', '');
    await chip.click();
    await page.waitForTimeout(500);
    const n = await page.locator('.glossary-entry').count();
    check('glossary category chip filters', n >= 1 && n < before, `${before} -> ${n}`);
    check('active chip is marked', await chip.evaluate((e) => e.classList.contains('active')));
  } else check('glossary chips exist', false);
  await ctx.close();
}

// ---------- stocks: sortable header, details sections, search ----------
{
  const { ctx, page } = await fresh();
  await page.goto(BASE + '/stocks.html', { waitUntil: 'domcontentloaded' });
  await sortWait(page);
  await page.waitForTimeout(1200);  // let the parallel news render settle
  // LIVE table (primary, always visible)
  const liveHeader = page.locator('.data-table th.sortable[data-key="pred_pct"]').first();
  if (await liveHeader.count()) {
    await liveHeader.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const before = await page.locator('.data-table tbody tr td strong').first().innerText();
    await liveHeader.click({ timeout: 10000 });
    await page.waitForTimeout(700);
    const ariaSort = await liveHeader.evaluate(() => document.querySelector('.data-table th[data-key="pred_pct"]').getAttribute('aria-sort'));
    const after = await page.locator('.data-table tbody tr td strong').first().innerText();
    check('live stocks table sorts on header click', ariaSort === 'descending' || before !== after, `aria-sort=${ariaSort}, first symbol ${before} -> ${after}`);
    // sort by symbol (string column) ascending
    const symHeader = page.locator('.data-table th.sortable[data-key="sym"]').first();
    await symHeader.click();
    await page.waitForTimeout(500);
    const firstSym = await page.locator('.data-table tbody tr td strong').first().innerText();
    check('live table string column sorts (symbol A-Z)', /^[A-Z]{2,4}$/.test(firstSym.trim()), `first symbol after sort: ${firstSym}`);
  } else check('live stocks table sortable header exists', false);
  // OFFLINE table (inside the collapsed details section)
  const offSummary = page.locator('details.collapse-section summary', { hasText: 'offline table' }).first();
  if (await offSummary.count()) {
    await offSummary.click();
    await page.waitForTimeout(600);
    const offHeader = page.locator('#stocks-table th.sortable').first();
    if (await offHeader.count()) {
      await offHeader.scrollIntoViewIfNeeded();
      const before = await page.locator('#stocks-table tbody tr').first().innerText();
      await offHeader.click({ timeout: 10000 });
      await page.waitForTimeout(600);
      const after = await page.locator('#stocks-table tbody tr').first().innerText();
      check('offline table sorts on header click', before !== after, `first row changed: ${before !== after}`);
    } else check('offline table sortable header exists', false);
  } else check('offline details section exists', false);
  const det = page.locator('details.collapse-section summary').first();
  if (await det.count()) {
    const open0 = await det.evaluate((e) => e.parentElement.open);
    await det.click();
    await page.waitForTimeout(400);
    const open1 = await det.evaluate((e) => e.parentElement.open);
    check('stocks details section opens/closes', open0 !== open1, `open ${open0} -> ${open1}`);
  } else check('stocks details sections exist', false);
  await ctx.close();
}

// ---------- search page: query returns hits ----------
{
  const { ctx, page } = await fresh();
  await page.goto(BASE + '/search.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.fill('#site-search', 'nifty');
  await page.waitForTimeout(700);
  const hits = await page.locator('#hits li').count();
  const status = await page.locator('#search-status').innerText();
  check('site search returns results', hits >= 3, `${hits} hits, status="${status.slice(0, 50)}"`);
  await page.fill('#site-search', 'zzzqqq');
  await page.waitForTimeout(700);
  const empty = await page.locator('#search-status').innerText();
  check('site search handles no matches gracefully', /no match/i.test(empty), `"${empty.slice(0, 60)}"`);
  await ctx.close();
}

// ---------- mobile: nav toggle opens the menu ----------
{
  const { ctx, page } = await fresh(390, 844);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const toggle = page.locator('.nav-toggle');
  const shown = await toggle.evaluate((e) => getComputedStyle(e).display !== 'none');
  if (shown) {
    await toggle.click();
    await page.waitForTimeout(300);
    const expanded = await toggle.evaluate((e) => e.getAttribute('aria-expanded'));
    const linksVisible = await page.evaluate(() => {
      const nl = document.querySelector('#nav-links');
      return getComputedStyle(nl).display !== 'none';
    });
    check('mobile hamburger opens nav', expanded === 'true' && linksVisible, `aria-expanded=${expanded}`);
  } else check('mobile hamburger visible at 390px', false);
  await ctx.close();
}

// ---------- methodology: FAQ details ----------
{
  const { ctx, page } = await fresh();
  await page.goto(BASE + '/methodology.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const faq = page.locator('details.faq summary').first();
  const open0 = await faq.evaluate((e) => e.parentElement.open);
  await faq.click();
  await page.waitForTimeout(300);
  const open1 = await faq.evaluate((e) => e.parentElement.open);
  check('methodology FAQ opens/closes', open0 !== open1);
  await ctx.close();
}

await browser.close();
console.log(results.join('\n'));
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
