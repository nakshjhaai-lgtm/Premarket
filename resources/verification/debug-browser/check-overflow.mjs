import { chromium } from "playwright";
const browser = await chromium.launch();
const PAGES = ["/", "/stocks.html", "/glossary.html", "/eli5.html", "/model.html", "/methodology.html", "/privacy.html", "/search.html", "/nope-404.html"];
const WIDTHS = [[1366, 768], [768, 1024], [390, 844], [320, 700]];
// NOTE: the site polls /api/* which never settles on a static server; networkidle
// times out on index/stocks. Use domcontentloaded + fixed wait instead.
const page = await browser.newPage();
for (const [w, h] of WIDTHS) {
  await page.setViewportSize({ width: w, height: h });
  for (const pg of PAGES) {
    try { await page.goto("http://localhost:8899" + pg, { waitUntil: "domcontentloaded", timeout: 30000 }); } catch (e) { console.log(`LOAD FAIL ${w}px ${pg}: ${String(e).slice(0, 60)}`); continue; }
    await page.waitForTimeout(1800);
    const r = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - window.innerWidth;
      let worst = null;
      if (overflow > 1) {
        for (const el of document.querySelectorAll("body *")) {
          const b = el.getBoundingClientRect();
          if (b.right > window.innerWidth + 1 && b.width > 40) {
            const cls = (el.className && typeof el.className === "string") ? el.className.split(" ")[0] : el.tagName;
            if (!worst || b.right > worst.right) worst = { tag: el.tagName, cls, right: Math.round(b.right), w: Math.round(b.width) };
          }
        }
      }
      return { overflow: Math.max(0, overflow), worst };
    });
    if (r.overflow > 1) console.log(`OVERFLOW ${w}px ${pg}: +${r.overflow}px  worst=${JSON.stringify(r.worst)}`);
    else console.log(`ok ${w}px ${pg}`);
  }
}
await browser.close();
