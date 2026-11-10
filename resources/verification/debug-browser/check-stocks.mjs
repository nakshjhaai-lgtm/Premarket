// verify the stocks page + model page render
import { chromium } from "playwright";
const urls = process.argv.slice(2);
const browser = await chromium.launch();
for (const url of urls) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errs.push("PAGEERROR: " + String(e).slice(0, 200)));
  page.on("requestfailed", (r) => { const u = r.url(); if (!/hud|netlify_identity/.test(u)) errs.push("REQFAIL: " + u.slice(0, 120)); });
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => ({
    status: document.querySelector("#stocks-status")?.textContent?.slice(0, 120) || null,
    rows: document.querySelectorAll("#stocks-table tbody tr").length,
    searchWorks: !!document.querySelector("#stocks-search"),
    chips: [...document.querySelectorAll("button.chip-btn")].length,
    modelH2: [...document.querySelectorAll("h2")].map((h) => h.textContent.trim()).slice(0, 12),
  }));
  console.log("URL:", url);
  console.log(JSON.stringify(state, null, 1));
  console.log("ERRORS (" + errs.length + "):", errs.slice(0, 4).join(" | ") || "none");
  await page.screenshot({ path: url.includes("stocks") ? "stocks.png" : "model.png", fullPage: false });
  await page.close();
}
await browser.close();
