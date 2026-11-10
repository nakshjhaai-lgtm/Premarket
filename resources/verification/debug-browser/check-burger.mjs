import { chromium } from "playwright";
const browser = await chromium.launch();
const errs = [];
const results = [];
const pages = ["/", "/stocks.html", "/glossary.html", "/eli5.html", "/model.html", "/methodology.html", "/privacy.html"];
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => errs.push(e.message.slice(0, 100)));
for (const pg of pages) {
  await page.goto("https://premarket-india-report.netlify.app" + pg, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const burgerVisible = await page.locator(".nav-toggle").isVisible();
  const linksHiddenBefore = await page.locator(".nav-links a").first().isHidden();
  if (burgerVisible) {
    await page.click(".nav-toggle");
    await page.waitForTimeout(250);
  }
  const glossaryLinkVisible = await page.locator('.nav-links a[href*="glossary"]').first().isVisible();
  const expanded = await page.getAttribute(".nav-toggle", "aria-expanded");
  results.push({ pg, burgerVisible, linksHiddenBefore, glossaryLinkVisible, expanded });
}
await browser.close();
for (const r of results) console.log(`${r.glossaryLinkVisible ? "PASS" : "FAIL"}  ${r.pg}  burger=${r.burgerVisible} collapsedBefore=${r.linksHiddenBefore} glossaryVisibleAfter=${r.glossaryLinkVisible} aria=${r.expanded}`);
console.log("PAGEERRORS (" + errs.length + "):", errs.join(" | ") || "none");
