// Rendered-page audit: measures what the browser actually renders (not source code)
// against the anti-vibe-coded spec: typography, radius/shadow/padding systems,
// contrast, focus, tap targets, hover states, transitions, heading hierarchy,
// text max-width, dead links, dead buttons, em-dashes/emoji in copy.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8899';
const PAGES = ['index.html', 'stocks.html', 'glossary.html', 'eli5.html', 'model.html', 'methodology.html', 'privacy.html', 'search.html', '404.html'];

const AUDIT_JS = () => {
  const out = {};
  const all = document.querySelectorAll('*');
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.05;
  };
  const lum = (c) => {
    const m = c.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
    if (!m) return null;
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a === 0) return null;
    return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]);
  };
  const bgOf = (el) => {
    let e = el;
    while (e) {
      const s = getComputedStyle(e);
      if (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)') return s.backgroundColor;
      e = e.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };

  // Typography
  const fonts = {}, weights = new Set(), headingSizes = {}, lineHeights = {};
  const textBlocks = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (!visible(el)) return;
    const s = getComputedStyle(el);
    if (el.tagName.match(/^H[1-6]$/)) {
      headingSizes[el.tagName] = headingSizes[el.tagName] || new Set();
      headingSizes[el.tagName].add(s.fontSize + '/' + s.fontWeight);
      weights.add(s.fontWeight);
    }
    if (el.children.length === 0 && el.textContent.trim().length > 30) {
      fonts[s.fontFamily.split(',')[0].replace(/["']/g, '')] = (fonts[s.fontFamily.split(',')[0].replace(/["']/g, '')] || 0) + 1;
      const lh = parseFloat(s.lineHeight) / parseFloat(s.fontSize);
      if (isFinite(lh)) lineHeights[lh.toFixed(2)] = (lineHeights[lh.toFixed(2)] || 0) + 1;
      const r = el.getBoundingClientRect();
      const chw = r.width / Math.max(1, el.textContent.trim().split(/\s+/).join(' ').length) * 1.9;
      if (r.width > 900 && el.tagName === 'P') textBlocks.push({ w: Math.round(r.width), text: el.textContent.trim().slice(0, 40) });
    }
  });
  out.fonts = fonts; out.headingWeights = [...weights];
  out.headingSizes = Object.fromEntries(Object.entries(headingSizes).map(([k, v]) => [k, [...v]]));
  out.bodyLineHeights = lineHeights;
  out.wideTextBlocks = textBlocks.slice(0, 5);

  // Radius / shadow / padding systems
  const radii = {}, shadows = {}, paddings = {};
  document.querySelectorAll('body *').forEach((el) => {
    if (!visible(el)) return;
    const s = getComputedStyle(el);
    const r = s.borderRadius;
    if (r && r !== '0px') radii[r] = (radii[r] || 0) + 1;
    if (s.boxShadow && s.boxShadow !== 'none') shadows[s.boxShadow.slice(0, 60)] = (shadows[s.boxShadow.slice(0, 60)] || 0) + 1;
    const p = s.padding;
    if (p && p !== '0px') paddings[p] = (paddings[p] || 0) + 1;
  });
  out.distinctRadii = Object.keys(radii).sort((a, b) => radii[b] - radii[a]);
  out.distinctShadows = Object.keys(shadows).length;
  out.topPaddings = Object.entries(paddings).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Contrast: every visible text node
  const bad = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  const seen = new Set();
  while ((n = walker.nextNode())) {
    const t = n.textContent.trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || !visible(el) || seen.has(el)) continue;
    seen.add(el);
    const s = getComputedStyle(el);
    if (s.fontSize === '0px') continue;
    const l1 = lum(s.color), l2 = lum(bgOf(el));
    if (l1 === null || l2 === null) continue;
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const large = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && (+s.fontWeight >= 700));
    const need = large ? 3 : 4.5;
    if (ratio < need) bad.push({ text: t.slice(0, 36), ratio: +ratio.toFixed(2), size: s.fontSize, where: el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') });
  }
  out.lowContrast = bad.slice(0, 12);
  out.lowContrastCount = bad.length;

  // Focus style presence
  const focusable = [...document.querySelectorAll('a[href], button, input, select, summary')].filter(visible);
  out.focusableCount = focusable.length;
  const probe = focusable[0];
  if (probe) {
    probe.focus();
    const s = getComputedStyle(probe);
    out.focusProbe = { tag: probe.tagName, outline: s.outlineStyle + ' ' + s.outlineWidth, boxShadow: s.boxShadow !== 'none' ? 'shadow' : 'none', borderWidth: s.borderTopWidth };
  }
  // tap targets (mobile context will re-run; desktop check nav links)
  const smallTargets = [];
  document.querySelectorAll('nav a, button, summary').forEach((el) => {
    if (!visible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.height < 40) smallTargets.push({ t: (el.textContent || '').trim().slice(0, 18), h: Math.round(r.height) });
  });
  out.sub40pxTargets = smallTargets.slice(0, 10);

  // heading structure
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => h.tagName);
  out.h1Count = hs.filter((t) => t === 'H1').length;
  out.headingOrder = hs.join(',');
  let skips = 0;
  for (let i = 1; i < hs.length; i++) if (+hs[i][1] > +hs[i - 1][1] + 1) skips++;
  out.headingSkips = skips;

  // links & buttons
  const deadLinks = [...document.querySelectorAll('a')].filter((a) => visible(a) && (a.getAttribute('href') === '#' || a.getAttribute('href') === '')).length;
  out.deadLinks = deadLinks;
  out.buttonsWithoutHandler = [...document.querySelectorAll('button')].filter((b) => visible(b) && !b.onclick && !b.getAttribute('onclick') && !b.type || (b.type === 'submit' && !b.closest('form'))).length;
  // external link check happens outside
  // copy signals
  const bodyText = document.body.innerText;
  out.emDashCount = (bodyText.match(/—/g) || []).length;
  out.emojiInHeadings = [...document.querySelectorAll('h1,h2,h3')].filter((h) => /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(h.textContent)).length;
  out.straightQuotes = (bodyText.match(/"/g) || []).length;
  out.tripleDot = (bodyText.match(/\.\.\./g) || []).length;
  const buzz = ['supercharge', 'seamless', 'revolutioniz', 'launch faster', 'transform your', 'build your dreams', 'create without limits', '10x faster', 'world-class', 'best-in-class', 'industry-leading', 'one platform for everything', 'AI-powered'];
  out.buzzwords = buzz.filter((b) => bodyText.toLowerCase().includes(b.toLowerCase()));
  const yr = bodyText.match(/©\s*(\d{4})/);
  out.copyrightYear = yr ? yr[1] : null;
  return out;
};

const browser = await chromium.launch();
const report = {};
const consoleErrors = {};
for (const p of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    route.continue({ url: 'https://premarket-india-report.netlify.app' + url.pathname + url.search }).catch(() => {});
  });
  consoleErrors[p] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors[p].push(m.text().slice(0, 100)); });
  page.on('pageerror', (e) => consoleErrors[p].push(String(e).slice(0, 100)));
  try {
    await page.goto(`${BASE}/${p}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    report[p] = await page.evaluate(AUDIT_JS);

    // hover deltas on first 3 buttons/nav links
    const hovers = [];
    const cands = await page.$$('nav a, .btn, button');
    let done = 0;
    for (const el of cands) {
      if (done >= 4) break;
      const before = await el.evaluate((e) => { const s = getComputedStyle(e); return s.backgroundColor + '|' + s.color + '|' + s.transform + '|' + s.boxShadow; });
      await el.hover().catch(() => {});
      await page.waitForTimeout(350);
      const after = await el.evaluate((e) => { const s = getComputedStyle(e); return s.backgroundColor + '|' + s.color + '|' + s.transform + '|' + s.boxShadow; });
      const moved = await el.isVisible();
      if (moved) hovers.push({ changed: before !== after, sample: (await el.textContent() || '').trim().slice(0, 16) });
      done++;
    }
    report[p].hoverProbes = hovers;
    // transition:all check on those elements
    report[p].transitionAll = await page.$$eval('nav a, .btn, button', (els) => els.filter((e) => getComputedStyle(e).transitionProperty === 'all').length);
  } catch (e) {
    report[p] = { ERROR: String(e).slice(0, 150) };
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify({ report, consoleErrors }, null, 1));
