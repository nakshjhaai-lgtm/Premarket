import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 110)); });

// dashboard news panel
await page.goto("https://premarket-india-report.netlify.app/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const dash = await page.evaluate(() => ({
  newsStatus: document.querySelector("#news-status")?.textContent.trim().slice(0, 90),
  earningsChips: [...document.querySelectorAll("#news-panel .chip.warn")].slice(0, 3).map((c) => c.textContent.trim()),
  headlines: document.querySelectorAll("#news-panel .news-list li").length,
  headlineSample: document.querySelector("#news-panel .news-list li a")?.textContent.trim().slice(0, 70),
  honestNote: document.querySelector("#news-panel .note-line")?.textContent.includes("do not read"),
}));

// stocks page events column
await page.goto("https://premarket-india-report.netlify.app/stocks.html", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const stocks = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#live-root tbody tr")];
  const ev = rows.map((r) => r.lastElementChild.textContent.trim());
  const withEarnings = rows.filter((r) => r.textContent.includes("earnings in"));
  return {
    liveRows: rows.length,
    eventsHeader: [...document.querySelectorAll("#live-root thead th")].map((t) => t.textContent.trim()).pop(),
    sampleEvents: [...new Set(ev)].slice(0, 6),
    earningsRows: withEarnings.length,
    earningsLine: document.querySelector("#live-root .note-line")?.textContent.includes("Earnings this week"),
  };
});

// overflow at 3 widths
const ov = {};
for (const w of [1366, 768, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto("https://premarket-india-report.netlify.app/stocks.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  ov[w] = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
}
console.log(JSON.stringify({ dash, stocks, overflow: ov, errors: errs }, null, 1));
await browser.close();
