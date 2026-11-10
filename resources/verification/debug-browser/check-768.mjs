import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
await page.goto("http://localhost:8124/", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
const burger = await page.locator(".nav-toggle").isVisible();
const linksHidden = await page.locator(".nav-links a").first().isHidden();
if (burger) { await page.click(".nav-toggle"); await page.waitForTimeout(250); }
const open = await page.locator(".nav-links a").first().isVisible();
console.log(JSON.stringify({ burger, linksHidden, opensOnTap: open }));
await browser.close();
