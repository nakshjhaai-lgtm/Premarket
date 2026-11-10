import { chromium } from "playwright";
const browser = await chromium.launch();
const errs = [];
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 120)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 110)); });
await page.goto("https://premarket-india-report.netlify.app/stocks.html", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
const stocks = await page.evaluate(() => ({
  liveStatus: document.querySelector("#live-status")?.textContent.trim().slice(0, 120),
  liveRows: document.querySelectorAll("#live-root tbody tr").length,
  learningCells: [...document.querySelectorAll("#live-root tbody tr td:nth-child(7)")].slice(0, 3).map((td) => td.textContent.trim()),
  backtestRows: document.querySelectorAll("#backtest-root tbody tr").length,
  honestNote: document.querySelector("#backtest-root")?.textContent.includes("No 90 to 95"),
  artifactRows: document.querySelectorAll("#stocks-root tbody tr").length,
}));
// dashboard: track record chip
await page.goto("https://premarket-india-report.netlify.app/", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
const dash = await page.evaluate(() => ({
  trackChip: [...document.querySelectorAll(".bias .chip")].map((c) => c.textContent.trim()).find((t) => t.startsWith("Track record")) || null,
  freshness: document.querySelector("#freshness")?.textContent.trim().slice(0, 60),
  termLinks: document.querySelectorAll("#report-area a.term").length,
  ensembleShown: !!document.querySelector("#prediction")?.textContent.includes("Adaptive ensemble") || !!document.querySelector("#prediction")?.textContent.includes("ensemble"),
}));
await browser.close();
console.log(JSON.stringify({ stocks, dash, errors: errs }, null, 1));
