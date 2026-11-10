import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 150)));
await page.goto("http://localhost:8123/glossary.html", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
const initial = await page.evaluate(() => document.querySelectorAll(".glossary-entry").length);
await page.fill("#glossary-search", "ensemble");
await page.waitForTimeout(250);
const searchHits = await page.evaluate(() => [...document.querySelectorAll(".glossary-entry h3")].map((h) => h.textContent.trim()));
await page.fill("#glossary-search", "");
await page.click("button.chip-btn[data-cat='Models']");
await page.waitForTimeout(200);
const modelCount = await page.evaluate(() => document.querySelectorAll(".glossary-entry").length);
await page.click("button.chip-btn[data-cat='All']");
await page.waitForTimeout(150);
const letters = await page.evaluate(() => document.querySelectorAll(".letter-index a").length);
// deep link
await page.goto("http://localhost:8123/glossary.html#scorecard", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const flashed = await page.evaluate(() => document.querySelector("#scorecard")?.classList.contains("flash"));
// plain-words count
const plainCount = await page.evaluate(() => document.querySelectorAll(".glossary-plain").length);
const seeCount = await page.evaluate(() => document.querySelectorAll(".glossary-see").length);
console.log(JSON.stringify({ initial, searchHits, modelCount, letters, deepLinkFlash: flashed, plainCount, seeCount, errors: errs }, null, 1));
await browser.close();
