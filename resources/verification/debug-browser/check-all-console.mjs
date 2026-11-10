import { chromium } from "playwright";
const browser = await chromium.launch();
const pages = ["/", "/stocks.html", "/glossary.html", "/eli5.html", "/model.html", "/methodology.html", "/privacy.html", "/404.html"];
let bad = 0;
for (const pg of pages) {
  const page = await browser.newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 90)); });
  page.on("pageerror", (e) => errs.push("PAGEERROR " + String(e).slice(0, 90)));
  await page.goto("https://premarket-india-report.netlify.app" + pg, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(900);
  if (errs.length) { bad++; console.log("FAIL", pg, "->", errs.join(" | ")); }
  else console.log("PASS", pg);
  await page.close();
}
await browser.close();
console.log(bad ? bad + " page(s) with errors" : "CONSOLE_CLEAN_ALL_PAGES");
