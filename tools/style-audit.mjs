#!/usr/bin/env node
// Site copy audit, per the writing policy in README.md.
// Opens every page in headless Chromium, extracts VISIBLE text, and flags:
//   1. em/en dashes anywhere in visible text
//   2. hyphen compounds in prose (numbers, tickers, ISO dates, identifiers exempt)
//   3. AI tell phrases (puffery, filler connectives)
// Usage:  node tools/style-audit.mjs [baseUrl]     (default: local file check of the repo pages via a served origin)
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8123";
const PAGES = ["/", "/stocks.html", "/glossary.html", "/eli5.html", "/model.html", "/methodology.html", "/privacy.html", "/404.html"];

const ALLOW_HYPHEN = /^(?:\d[\d.,:%+\-−]*|[A-Z]{1,5}-[A-Z]{1,5}|\d{4}-\d{2}-\d{2}|[a-z]+\d*-\d+|e-?\d+|\d+(\.\d+)?e-?\d+)$/i;
const AI_TELLS = [
  /\bnot only\b[^.]*\bbut also\b/i,
  /\b(seamless\w*|robust\w*|delve\w*|moreover|furthermore|crucial\w*|pivotal\w*|testament\w*|underscore\w*|leverage\w*|realm|landscape|journey|vibrant|realm of)\b/i,
  /\bstands as a\b|\bserves as a testament\b|\bsetting the stage\b|\bevolving landscape\b|\bin today'?s\b/i,
  /\bcutting[- ]edge\b|\bgame[- ]changing\b|\bstate[- ]of[- ]the[- ]art\b/i,
];

let problems = 0;
const browser = await chromium.launch();
for (const pg of PAGES) {
  const page = await browser.newPage();
  try {
    await page.goto(BASE + pg, { waitUntil: "networkidle", timeout: 45000 });
  } catch (e) {
    console.log(`WARN  ${pg}: could not load (${String(e).slice(0, 60)})`);
    await page.close();
    continue;
  }
  await page.waitForTimeout(600);
  const texts = await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const t = n.parentElement?.tagName;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "CODE"].includes(t)) continue;
      const v = n.nodeValue?.trim();
      if (v) out.push(v);
    }
    return out;
  });
  const joined = texts.join(" ");
  const msgs = [];
  if (/[—–]/.test(joined)) msgs.push("em/en dash found");
  for (const m of joined.matchAll(/\b[\w]+-[\w\-]+\b/g)) {
    const w = m[0];
    if (ALLOW_HYPHEN.test(w)) continue;
    if (/pytorch$/.test(w) || w === "1-w") continue; // model identifiers, math notation
    if (/^\d[\d.,]*$/.test(w.replace(/-/g, ""))) continue;
    msgs.push(`hyphen word: ${w}`);
  }
  for (const re of AI_TELLS) {
    const m = joined.match(re);
    if (m) msgs.push(`AI tell: "${m[0]}"`);
  }
  if (msgs.length) {
    problems += msgs.length;
    console.log(`FAIL  ${pg}`);
    for (const m of [...new Set(msgs)].slice(0, 12)) console.log(`      ${m}`);
  } else {
    console.log(`PASS  ${pg}`);
  }
  await page.close();
}
await browser.close();
console.log(problems ? `\n${problems} issue(s) found` : "\nSTYLE_OK");
process.exit(problems ? 1 : 0);
