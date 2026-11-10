// Build assets/search-index.json from the site's own static content:
// the 7 content pages + all 95 glossary terms (so glossary entries are
// searchable with their anchors). Run: node tools/build-search-index.mjs
import { readFile, writeFile } from 'node:fs/promises';

const pages = [
  ['/', 'Dashboard: today\'s premarket report', 'index.html'],
  ['/stocks.html', 'Stocks: 50 live adaptive forecasts', 'stocks.html'],
  ['/model.html', 'The models', 'model.html'],
  ['/methodology.html', 'Methodology', 'methodology.html'],
  ['/glossary.html', 'Glossary: every term in plain words', 'glossary.html'],
  ['/eli5.html', 'This site, explained like you are five', 'eli5.html'],
  ['/privacy.html', 'Privacy policy', 'privacy.html'],
];

const strip = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<noscript[\s\S]*?<\/noscript>/g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<\/(p|li|h[1-6]|tr|div|section|summary|details|figcaption)>/g, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&copy;/g, '(c)')
  .replace(/&middot;/g, '·').replace(/&hellip;/g, '…').replace(/&#[x0-9a-f]+;/gi, ' ')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n\s*\n+/g, '\n')
  .trim();

const docs = [];
for (const [url, title, file] of pages) {
  const html = await readFile(file, 'utf8');
  docs.push({ url, title, text: strip(html) });
}

// glossary terms with anchors (import the real module: comments make it non-JSON)
const mod = await import('../assets/glossary-terms.mjs');
const terms = mod.TERMS || mod.default || mod.terms;
for (const t of terms) {
  docs.push({
    url: `/glossary.html#${t.id}`,
    title: `Glossary: ${t.term}`,
    text: `${t.term}\n${t.short || ''}\n${t.plain || ''}\n${t.def || ''}`.trim(),
  });
}

await writeFile('assets/search-index.json', JSON.stringify(docs));
console.log('search index:', docs.length, 'documents,', JSON.stringify(docs).length, 'bytes');
