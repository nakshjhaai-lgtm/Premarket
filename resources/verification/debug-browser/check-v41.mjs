import { chromium } from "playwright";
const browser = await chromium.launch();
const out = {};
const errs = [];

// dashboard: freshness strip + term links + scorecard
{
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.on("pageerror", (e) => errs.push("dash: " + String(e).slice(0, 120)));
  await page.goto("https://premarket-india-report.netlify.app/", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  out.dash = await page.evaluate(() => ({
    freshness: document.querySelector("#freshness")?.textContent.trim().slice(0, 90),
    freshnessHidden: document.querySelector("#freshness")?.hidden,
    termLinks: document.querySelectorAll("#report-area a.term").length,
    sampleTermLinks: [...document.querySelectorAll("#report-area a.term")].slice(0, 6).map((a) => a.textContent + "->" + a.getAttribute("href")),
    learningLoop: /Learning scorecard|How this forecast learns/i.test(document.querySelector("#prediction")?.textContent || ""),
    modelPanel: !!document.querySelector("#model-analysis")?.textContent.includes("Ensemble"),
  }));
  await page.close();
}

// glossary + eli5 on production
{
  const page = await browser.newPage();
  page.on("pageerror", (e) => errs.push("glossary: " + String(e).slice(0, 120)));
  await page.goto("https://premarket-india-report.netlify.app/glossary.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  out.glossary = await page.evaluate(() => ({
    entries: document.querySelectorAll(".glossary-entry").length,
    status: document.querySelector("#glossary-status")?.textContent.slice(0, 60),
    navLinks: document.querySelectorAll(".nav-link").length,
  }));
  await page.close();
}
{
  const page = await browser.newPage();
  page.on("pageerror", (e) => errs.push("eli5: " + String(e).slice(0, 120)));
  await page.goto("https://premarket-india-report.netlify.app/eli5.html", { waitUntil: "networkidle" });
  out.eli5 = await page.evaluate(() => ({
    sections: document.querySelectorAll("main section").length,
    glossaryLinks: document.querySelectorAll('a[href^="/glossary.html"]').length,
  }));
  await page.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
console.log("PAGEERRORS (" + errs.length + "):", errs.join(" | ") || "none");
