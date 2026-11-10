import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 100)); });
await page.goto("http://localhost:8124/stocks.html", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
const out = await page.evaluate(() => ({
  liveStatus: document.querySelector("#live-status")?.textContent.trim().slice(0, 110),
  liveRows: document.querySelectorAll("#live-root tbody tr").length,
  backtestRows: document.querySelectorAll("#backtest-root tbody tr").length,
  backtestHonestNote: !!document.querySelector("#backtest-root")?.textContent.includes("No 90 to 95"),
  artifactRows: document.querySelectorAll("#stocks-root tbody tr").length,
  h2s: [...document.querySelectorAll("main h2")].map((h) => h.textContent.trim()),
}));
console.log(JSON.stringify(out, null, 1));
console.log("errors:", errs.length ? errs : "none");
await browser.close();
