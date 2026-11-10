import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 110)); });

// dashboard: plain words + intro strip + track record (n=1 now)
await page.goto("https://premarket-india-report.netlify.app/", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const dash = await page.evaluate(() => ({
  plainWords: document.querySelector("#plain-words")?.textContent.trim().slice(0, 170),
  intro: document.querySelector(".intro-strip")?.textContent.trim().slice(0, 80),
  trackChip: [...document.querySelectorAll(".bias .chip")].map((c) => c.textContent.trim()).find((t) => t.startsWith("Track record")) || null,
}));

// stocks page: collapsed sections + live table + overflow
await page.goto("https://premarket-india-report.netlify.app/stocks.html", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const stocks = await page.evaluate(() => ({
  liveRows: document.querySelectorAll("#live-root tbody tr").length,
  backtestCollapsed: !document.querySelector("#backtest-root")?.closest("details")?.open,
  artifactCollapsed: !document.querySelector("#stocks-root")?.closest("details")?.open,
  overflow: document.documentElement.scrollWidth - window.innerWidth,
}));

// overflow sweep at 3 widths on the two busiest pages
const widths = [1366, 768, 390];
const ov = {};
for (const w of widths) {
  await page.setViewportSize({ width: w, height: 900 });
  for (const pg of ["/", "/stocks.html", "/methodology.html", "/glossary.html"]) {
    await page.goto("https://premarket-india-report.netlify.app" + pg, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    ov[`${w}${pg}`] = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  }
}
console.log(JSON.stringify({ dash, stocks, overflow: ov, errors: errs }, null, 1));
await browser.close();
