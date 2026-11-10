import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
// hamburger menu on mobile viewport
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("https://premarket-india-report.netlify.app/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const burgerVisible = await page.isVisible("#nav-toggle");
if (burgerVisible) { await page.click("#nav-toggle"); await page.waitForTimeout(300); }
const navEl = page.locator("header nav");
const navOpen = await navEl.isVisible();
const links = await page.evaluate(() => [...document.querySelectorAll("header nav a")].map((a) => a.textContent.trim()));
const mobileNav = { burgerVisible, navOpen, links };
// click a term link on the dashboard -> lands on glossary entry
await page.setViewportSize({ width: 1360, height: 900 });
await page.goto("https://premarket-india-report.netlify.app/", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
const term = page.locator("#report-area a.term").first();
const termText = await term.textContent();
await term.click();
await page.waitForTimeout(1200);
const landed = await page.evaluate(() => ({
  url: location.pathname + location.hash,
  entryVisible: !!document.querySelector(".glossary-entry.flash, #scorecard.flash, :target"),
  title: document.querySelector("main h1")?.textContent,
}));
console.log(JSON.stringify({ mobileNav, termClick: { termText, landed }, errors: errs }, null, 1));
await browser.close();
