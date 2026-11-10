// Detect the Netlify free-tier badge (iframe #nl-badge-frame from /.netlify/scripts/hud)
import { chromium } from 'playwright';
const url = process.argv[2] || 'https://premarket-india-report.netlify.app/';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
await p.goto(url, { waitUntil: 'domcontentloaded' });
// the HUD script mounts the iframe asynchronously; give it time
let found = null;
for (let i = 0; i < 20; i++) {
  found = await p.evaluate(() => {
    const f = document.querySelector('#nl-badge-frame, .nl-badge, iframe[src*="hud"], netlify-badge');
    if (!f) return null;
    const r = f.getBoundingClientRect();
    const s = getComputedStyle(f);
    return { id: f.id, cls: f.className && String(f.className).slice(0, 30), tag: f.tagName,
             rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
             display: s.display, visibility: s.visibility };
  });
  if (found) break;
  await p.waitForTimeout(500);
}
console.log(found ? 'BADGE PRESENT: ' + JSON.stringify(found) : 'no badge element found in DOM after 10s');
await b.close();
