import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1366,height:900}})).newPage();
await p.route('**/api/**', r => { const u = new URL(r.request().url()); r.continue({url:'https://premarket-india-report.netlify.app'+u.pathname+u.search}).catch(()=>{}); });
await p.goto('http://localhost:8899/stocks.html', {waitUntil:'domcontentloaded'});
await p.waitForTimeout(3000);
const lines = await p.evaluate(() => document.body.innerText.split('\n').filter(l => l.includes('"')));
console.log(lines.slice(0, 8).join('\n---\n') || 'NO straight quotes found');
await b.close();
