// Load the live dashboard in headless Chromium and capture console errors,
// failed requests, and whether the report area ever renders.
import { chromium } from "playwright";

const url = process.argv[2] || "https://premarket-india-report.netlify.app/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`[console.${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}\n${(e.stack || "").split("\n").slice(0, 6).join("\n")}`));
page.on("requestfailed", (r) => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`);
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(9000);

const state = await page.evaluate(() => {
  const report = document.querySelector("#report-area");
  const bias = document.querySelector("#bias");
  const status = document.querySelector("#status");
  return {
    reportChildren: report ? report.children.length : -1,
    reportHtmlLen: report ? report.innerHTML.length : -1,
    biasHtmlLen: bias ? bias.innerHTML.length : -1,
    statusText: status ? status.textContent : null,
    title: document.title,
    hasSkeleton: !!document.querySelector(".skeleton"),
  };
});
console.log("PAGE STATE:", JSON.stringify(state, null, 1));
console.log("ERRORS (" + errors.length + "):");
for (const e of errors.slice(0, 25)) console.log("  " + e.split("\n").slice(0,7).join("\n  "));
await page.screenshot({ path: "/home/user/debug-browser/dash.png", fullPage: false });
await browser.close();
