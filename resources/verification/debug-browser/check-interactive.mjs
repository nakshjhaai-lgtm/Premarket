import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 150)));

// --- stocks page interactions ---
await page.goto("https://premarket-india-report.netlify.app/stocks.html", { waitUntil: "networkidle" });
await page.fill("#stocks-search", "india");
await page.waitForTimeout(300);
const indiaRows = await page.evaluate(() => document.querySelectorAll("#stocks-table tbody tr").length);
const allIndia = await page.evaluate(() => [...document.querySelectorAll("#stocks-table tbody tr td:first-child")].map((td) => td.textContent));
await page.fill("#stocks-search", "");
await page.click("button.chip-btn[data-group='Index ETFs']");
await page.waitForTimeout(200);
const etfRows = await page.evaluate(() => document.querySelectorAll("#stocks-table tbody tr").length);
await page.click("#stocks-table th[data-key='next_pct']"); // toggle ascending
await page.waitForTimeout(200);
const sortedTop = await page.evaluate(() => document.querySelector("#stocks-table tbody tr td:nth-child(4)")?.textContent?.slice(0, 40));

// --- dashboard ensemble panel ---
await page.goto("https://premarket-india-report.netlify.app/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const ens = await page.evaluate(() => {
  const host = document.querySelector("#prediction");
  const txt = host ? host.textContent : "";
  return {
    hasEnsembleHeading: /adaptive ensemble|Model forecast/i.test(txt),
    hasW: /w\s*=\s*0\.98|Blend weight/.test(txt),
    hasComponents: /TimesFM 2\.5/.test(txt) && /LSTM/.test(txt),
    hasScorecard: /scorecard|Self-learning/i.test(txt),
    hasModelAnalysis: !!document.querySelector("#model-analysis") && /Ensemble|TimesFM/i.test(document.querySelector("#model-analysis").textContent),
    predLen: txt.length,
  };
});
console.log("stocks: india search rows =", indiaRows, JSON.stringify(allIndia.slice(0, 2)));
console.log("stocks: ETF chip rows =", etfRows, "| after sort, top next% cell:", sortedTop);
console.log("dashboard ensemble:", JSON.stringify(ens, null, 1));
console.log("PAGEERRORS (" + errs.length + "):", errs.join(" | ") || "none");
await browser.close();
