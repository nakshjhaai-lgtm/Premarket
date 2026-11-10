import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("https://premarket-india-report.netlify.app/", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
const hits = await page.evaluate(() => {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (/walk-forward/.test(walker.currentNode.nodeValue)) {
      out.push({
        text: walker.currentNode.nodeValue.trim().slice(0, 110),
        section: walker.currentNode.parentElement.closest("section,article,div.panel")?.querySelector("h2,h3")?.textContent?.trim() || walker.currentNode.parentElement.className || "?",
      });
    }
  }
  return out;
});
console.log(JSON.stringify(hits, null, 1));
await browser.close();
