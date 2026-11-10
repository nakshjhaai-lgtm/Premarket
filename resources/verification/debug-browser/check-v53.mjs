import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
await page.goto("http://localhost:8124/stocks.html", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
const st = await page.evaluate(() => ({
  liveVisible: !!document.querySelector("#live-root")?.offsetParent,
  backtestCollapsed: !document.querySelector("#backtest-root")?.closest("details")?.open,
  artifactCollapsed: !document.querySelector("#stocks-root")?.closest("details")?.open,
  summaries: [...document.querySelectorAll("details.collapse-section > summary")].map((x) => x.textContent.trim()),
}));
// tap to open the backtest
await page.click("details.collapse-section > summary");
await page.waitForTimeout(400);
st.backtestOpens = await page.evaluate(() => document.querySelector("#backtest-root")?.closest("details")?.open);
st.backtestRowsAfterOpen = await page.evaluate(() => document.querySelectorAll("#backtest-root tbody tr").length);
console.log(JSON.stringify(st, null, 1), "| errors:", errs.length ? errs : "none");
await browser.close();
