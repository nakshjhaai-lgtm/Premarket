// News, earnings calendar and event flags: the non price layer.
// The forecast models still learn from prices and market data only; this layer
// tracks what is happening in the world (headlines, earnings dates, event
// keywords) and shows it next to the math, so nothing important is invisible.
// Sources: CNBC top news RSS + Google News RSS (per symbol, US and India
// market queries) + the Nasdaq earnings calendar. Every fetch is cached in
// the "news-latest" blob and every source state is disclosed.
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "application/json" };

export const TAGS = {
  earnings: /\b(earnings|quarterly results|q[1-4] results|eps|beats? estimates?|misses? estimates?|profit (rises|falls|jumps|slips)|revenue (rises|falls|jumps|slips))\b/i,
  guidance: /\b(guidance|outlook|forecast cut|raises? outlook|cuts? outlook)\b/i,
  merger: /\b(merger|acquisition|acquires?|takeover|buyout|deal to buy|to acquire)\b/i,
  lawsuit: /\b(lawsuit|sues?|sued|investigation|probe|fraud|charges|settlement|indictment)\b/i,
  recall: /\brecalls?\b/i,
  layoffs: /\b(layoffs?|job cuts?|restructuring|downsizing|workforce reduction)\b/i,
  rates: /\b(the fed|fomc|interest rates?|rate cut|rate hike|powell|rbi|repo rate|central bank)\b/i,
  inflation: /\b(inflation|cpi|ppi|wholesale prices|price index)\b/i,
  geopolitics: /\b(war|missile|airstrike|conflict|sanctions?|tariffs?|trade war|geopolitic|ceasefire|ukraine|russia|israel|gaza|iran|taiwan|middle east)\b/i,
  election: /\b(election|elections|polls?|voting|parliament|congress|senate|ballot)\b/i,
  regulator: /\b(fda|approval|clinical trial|securities and exchange|antitrust|regulator)\b/i,
  cyber: /\b(hack|hacked|breach|cyber|ransomware|data leak)\b/i,
  accident: /\b(outage|crash(es|ed)?|accident|explosion|fire at|plant fire|strike at)\b/i,
  product: /\b(launch|unveils?|announces?|debut|release)\b/i,
};

export function tagHeadline(t) {
  const tags = [];
  for (const [k, re] of Object.entries(TAGS)) if (re.test(t)) tags.push(k);
  return tags;
}

function decode(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

async function fetchText(url, timeout = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { headers: UA, signal: ac.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

export function parseRss(xml, max = 8) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const b of blocks.slice(0, max)) {
    const title = decode((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
    const link = decode((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
    const when = decode((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]);
    const source = decode((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]);
    if (title && title.length > 15) items.push({ t: title.slice(0, 160), u: link, when, s: source || "" });
    if (items.length >= max) break;
  }
  return items;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function googleNews(query, hl, gl, ceid, max) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  return parseRss(await fetchText(url), max);
}

function nextWeekdays(n, from = new Date()) {
  const out = [];
  let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (out.length < n) {
    d = new Date(d.getTime() + 86400000);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function fetchEarnings(dates, watchlist) {
  const bySym = {};
  const perDay = [];
  for (const date of dates) {
    try {
      const d = JSON.parse(await fetchText(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`));
      const rows = (d.data && d.data.rows) || [];
      perDay.push({ date, n: rows.length });
      for (const r of rows) {
        const sym = String(r.symbol || "").toUpperCase().replace(".", "-");
        if (watchlist.includes(sym) && !bySym[sym]) {
          bySym[sym] = { date, eps: r.epsForecast || null };
        }
      }
      await sleep(1100);
    } catch { /* that date unavailable */ }
  }
  return { bySym, perDay };
}

function isoDate() { return new Date().toISOString().slice(0, 10); }

export async function runNewsCycle(store, symbols) {
  const sources = {
    market: { label: "Market headlines (CNBC and Google News)", state: "live" },
    symbols: { label: "Per stock headlines (Google News)", state: "live", n_ok: 0 },
    earnings: { label: "Earnings calendar (Nasdaq)", state: "live" },
  };

  // 1) market wide news (US) + India
  let market = [], india = [];
  try {
    const [cnbc, gus] = await Promise.all([
      fetchText("https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114").catch(() => ""),
      googleNews("stock market", "en-US", "US", "US:en", 8).catch(() => []),
    ]);
    const cnbcItems = cnbc ? parseRss(cnbc, 8) : [];
    const seen = new Set();
    market = [...cnbcItems, ...(Array.isArray(gus) ? gus : [])]
      .filter((x) => { const k = x.t.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 10);
  } catch { sources.market.state = "degraded"; }
  try { india = await googleNews("Indian stock market Nifty Sensex", "en-IN", "IN", "IN:en", 6); }
  catch { /* india feed optional */ }
  if (!market.length && !india.length) sources.market.state = "degraded";

  // 2) per symbol headlines
  const perSymbol = {};
  let nOk = 0;
  for (const sym of symbols) {
    try {
      const items = await googleNews(`${sym.replace("-", ".")} stock`, "en-US", "US", "US:en", 5);
      perSymbol[sym] = {
        n: items.length,
        items: items.slice(0, 4).map((x) => ({ t: x.t, u: x.u, when: x.when })),
        tags: [...new Set(items.flatMap((x) => tagHeadline(x.t)))].slice(0, 4),
      };
      if (items.length) nOk++;
      await sleep(700);
    } catch {
      perSymbol[sym] = { n: 0, items: [], tags: [] };
    }
  }
  sources.symbols.n_ok = nOk;
  if (nOk === 0) sources.symbols.state = "degraded";
  else if (nOk < symbols.length / 2) sources.symbols.state = "cached";

  // 3) earnings calendar, next 10 trading days
  let earnings = { bySym: {}, perDay: [] };
  try { earnings = await fetchEarnings(nextWeekdays(10), symbols); }
  catch { sources.earnings.state = "degraded"; }

  // 4) heavy news flags from the accumulated daily counts
  let hist = null;
  try { hist = JSON.parse((await store.get("news-history")) || "null"); } catch { /* none */ }
  if (!hist || typeof hist !== "object") hist = {};
  const today = isoDate();
  hist[today] = Object.fromEntries(symbols.map((s) => [s, perSymbol[s]?.n || 0]));
  const days = Object.keys(hist).sort().slice(-15);   // trailing window incl. today
  for (const sym of symbols) {
    const trail = days.slice(0, -1).map((d) => hist[d][sym] || 0);   // previous days only
    const n = perSymbol[sym]?.n || 0;
    const avg = trail.length ? trail.reduce((a, b) => a + b, 0) / trail.length : null;
    perSymbol[sym].heavy = avg != null && n >= Math.max(3, 2 * avg) && n >= 3;
    const e = earnings.bySym[sym];
    perSymbol[sym].earnings = e ? e.date : null;
    if (e) {
      const dIdx = nextWeekdays(14).indexOf(e.date);
      perSymbol[sym].earnings_days = dIdx >= 0 ? dIdx + 1 : null;
    } else perSymbol[sym].earnings_days = null;
  }
  await store.set("news-history", JSON.stringify(
    Object.fromEntries(Object.entries(hist).sort().slice(-120))));

  const view = {
    as_of: today,
    generated_at: new Date().toISOString(),
    sources,
    market: market.map((x) => ({ ...x, tags: tagHeadline(x.t) })),
    india: india.map((x) => ({ ...x, tags: tagHeadline(x.t) })),
    per_symbol: perSymbol,
    earnings_upcoming: Object.entries(earnings.bySym)
      .map(([sym, v]) => ({ sym, ...v }))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(0, 20),
    earnings_days: earnings.perDay,
    note: "The forecast models do not read these headlines. This layer exists so you can check the math against the world: earnings dates, lawsuits, wars, elections and accidents often move stocks before any equation can.",
  };
  await store.set("news-latest", JSON.stringify(view));
  return view;
}

export async function loadNews(store) {
  try { return JSON.parse((await store.get("news-latest")) || "null"); } catch { return null; }
}
