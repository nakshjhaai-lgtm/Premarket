// Premarket scan: pure logic shared by all Netlify functions.
// Port of /home/user/premarket/scan.py (same checks, same scoring, same report shape).
//
//   1. NASDAQ + Dow Jones   green/red overnight -> Indian open hint
//   2. India VIX            above 15 -> higher volatility; below -> calmer
//   3. Advances vs declines NIFTY 50 breadth -> bullish/bearish
//   4. Singapore Nifty      (GIFT Nifty) green/red -> open higher/lower
//
// Every value is labelled with the source that actually served it.
// A check that cannot be fetched is UNAVAILABLE and excluded from the score.

export const VIX_THRESHOLD = 15;

export const NIFTY50 = [
  "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "BHARTIARTL", "SBIN",
  "LT", "ITC", "AXISBANK", "KOTAKBANK", "HINDUNILVR", "BAJFINANCE", "MARUTI",
  "SUNPHARMA", "TATAMOTORS", "TITAN", "M&M", "NTPC", "ULTRACEMCO", "ONGC",
  "POWERGRID", "WIPRO", "NESTLEIND", "ADANIENT", "ADANIPORTS", "COALINDIA",
  "JSWSTEEL", "TATASTEEL", "GRASIM", "HCLTECH", "TECHM", "BAJAJFINSV",
  "DRREDDY", "CIPLA", "DIVISLAB", "APOLLOHOSP", "EICHERMOT", "HEROMOTOCO",
  "BRITANNIA", "INDUSINDBK", "SBILIFE", "HDFCLIFE", "TATACONSUM", "UPL",
  "BPCL", "IOC", "ETERNAL", "DLF", "TRENT",
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ------------------------------------------------------------------ helpers
export function fnum(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).trim().replace(/,/g, "");
  let neg = false;
  if (t.startsWith("(") && t.endsWith(")")) { neg = true; t = t.slice(1, -1); }
  t = t.replace(/[^0-9.+\-eE]/g, "");
  if (!t || t === "-" || t === ".") return null;
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export function colour(pct) {
  if (pct === null || pct === undefined) return "UNAVAILABLE";
  return pct > 0 ? "GREEN" : pct < 0 ? "RED" : "FLAT";
}

async function get(url, { timeout = 15000, headers = {} } = {}) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r;
}
async function jget(url, opts) { return (await get(url, opts)).json(); }

// current date/time in Asia/Kolkata
export function istNow(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata", weekday: "long", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(d).map((p) => [p.type, p.value])
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    weekday: parts.weekday,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    stamp: `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second} IST`,
    isWeekend: parts.weekday === "Saturday" || parts.weekday === "Sunday",
  };
}

// ------------------------------------------------------------------ check 1
export async function usIndices() {
  // specified source: investing.com (expected 403 from cloud IPs, fast attempt)
  try {
    const page = await (await get("https://www.investing.com/indices/nasdaq-composite", { timeout: 6000 })).text();
    const m = page.match(/data-test="instrument-price-last"[^>]*>([\d,.]+)/);
    if (m) {
      // only invest further if the page really rendered quotes; else fall through
      throw new Error("partial page");
    }
  } catch { /* fall through */ }
  // CNBC quote API: reliable JSON for both indices in one call
  try {
    const d = await jget(
      "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol" +
      "?symbols=.IXIC|.DJI&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json",
      { timeout: 12000 }
    );
    let q = d?.FormattedQuoteResult?.FormattedQuote || [];
    if (!Array.isArray(q)) q = [q];
    const out = q.map((x) => ({
      label: x.name, value: fnum(x.last), change: fnum(x.change),
      pct: fnum(x.change_pct), source: "cnbc.com quote API",
    }));
    if (out.length === 2 && out.every((o) => o.value !== null)) return out;
  } catch { /* fall through */ }
  // last resort: Yahoo chart API
  const res = [];
  for (const [sym, name] of [["^IXIC", "NASDAQ Composite"], ["^DJI", "Dow Jones Industrial Average"]]) {
    try {
      const d = await jget(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`,
        { timeout: 12000 }
      );
      const m = d.chart.result[0].meta;
      const price = m.regularMarketPrice ?? null;
      const prev = m.chartPreviousClose ?? m.previousClose ?? null;
      res.push({
        label: name, value: price,
        change: price !== null && prev ? +(price - prev).toFixed(2) : null,
        pct: price !== null && prev ? +((100 * (price - prev) / prev).toFixed(2)) : null,
        source: "Yahoo Finance chart API",
      });
    } catch {
      res.push({ label: name, value: null, change: null, pct: null, source: null });
    }
  }
  return res;
}

// ------------------------------------------------------------------ check 2
export async function indiaVix() {
  // specified source: nseindia.com (expected 403, fast attempt)
  let source = null, price = null;
  try {
    const d = await jget("https://www.nseindia.com/api/allIndices", {
      timeout: 5000, headers: { Referer: "https://www.nseindia.com/" },
    });
    const row = (d.data || []).find((x) => /india vix/i.test(x["index name"] || ""));
    if (row) { price = fnum(row.last); source = "nseindia.com"; }
  } catch { /* fall through */ }
  // Yahoo fallback, plus 1y history for the percentile-based risk gauge
  // (a fixed "15" threshold was retired: VIX is assessed against its own
  // recent distribution, and it measures expected volatility, not direction)
  let percentile1y = null, hist = [];
  try {
    const d = await jget(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX?range=1y&interval=1d",
      { timeout: 12000 }
    );
    const r = d.chart.result[0];
    if (price === null) { price = r.meta.regularMarketPrice ?? null; source = "Yahoo Finance chart API"; }
    hist = (r.indicators?.quote?.[0]?.close || []).filter((x) => x !== null && x !== undefined);
    if (price !== null && hist.length >= 60) {
      const below = hist.filter((h) => h < price).length;
      percentile1y = +((100 * below) / hist.length).toFixed(0);
    }
  } catch {
    if (price === null) {
      try {
        const d = await jget(
          "https://query1.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX?range=5d&interval=1d",
          { timeout: 12000 }
        );
        price = d.chart.result[0].meta.regularMarketPrice ?? null;
        source = "Yahoo Finance chart API";
      } catch { /* give up */ }
    }
  }
  return { price, source, percentile_1y: percentile1y };
}

// ------------------------------------------------------------------ check 3
export async function advanceDecline() {
  // specified source: nseindia.com (expected 403, fast attempt)
  try {
    const d = await jget(
      "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050",
      { timeout: 5000, headers: { Referer: "https://www.nseindia.com/" } }
    );
    let adv = 0, dec = 0;
    for (const row of (d.data || []).slice(1)) {
      const c = fnum(row.chg);
      if (c === null) continue;
      if (c > 0) adv++; else if (c < 0) dec++;
    }
    if (adv || dec) {
      return {
        advances: adv, declines: dec, unchanged: null,
        universe: "NSE India (as published)", source: "nseindia.com",
      };
    }
  } catch { /* fall through */ }

  // derived: NIFTY 50 breadth from Yahoo.
  // spark rejects >~20 symbols per call (HTTP 400) and the raw '&' in M&M.NS
  // truncates the query string, so: chunks of 15 + M&M via the chart API.
  const CH = 15;
  const basket = NIFTY50.filter((s) => s !== "M&M").map((s) => s + ".NS");
  let adv = 0, dec = 0, unch = 0, fetched = false;

  const chunks = [];
  for (let i = 0; i < basket.length; i += CH) {
    chunks.push(
      jget("https://query1.finance.yahoo.com/v7/finance/spark?symbols=" +
           basket.slice(i, i + CH).join(",") + "&range=1d&interval=5m", { timeout: 12000 })
        .catch(() => null)
    );
  }
  const results = await Promise.all(chunks);
  for (const d of results) {
    for (const r of d?.spark?.result || []) {
      try {
        const meta = r.response[0].meta;
        const price = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose ?? meta.previousClose;
        if (price === null || price === undefined || !prev) continue;
        if (price > prev) adv++; else if (price < prev) dec++; else unch++;
        fetched = true;
      } catch { /* skip */ }
    }
  }
  try {
    const d = await jget(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent("M&M.NS")}?range=1d&interval=5m`,
      { timeout: 12000 }
    );
    const meta = d.chart.result[0].meta;
    const price = meta.regularMarketPrice, prev = meta.chartPreviousClose ?? meta.previousClose;
    if (price !== null && price !== undefined && prev) {
      if (price > prev) adv++; else if (price < prev) dec++; else unch++;
      fetched = true;
    }
  } catch { /* skip */ }

  if (fetched) {
    return {
      advances: adv, declines: dec, unchanged: unch,
      universe: "NIFTY 50 constituents (derived), previous session",
      source: "Yahoo Finance spark API",
    };
  }
  return { advances: null, declines: null, unchanged: null, universe: null, source: null };
}

// ------------------------------------------------------------------ check 4
export async function singaporeNifty() {
  // a. specified source: investing.com (expected 403 from cloud IPs, fast attempt)
  try {
    const page = await (await get("https://www.investing.com/indices/gift-nifty", { timeout: 6000 })).text();
    const m = page.match(/data-test="instrument-price-last"[^>]*>([\d,.]+)/);
    const p = page.match(/data-test="instrument-price-change-percent"[^>]*>\(?([+\-\d,.]+)%/);
    if (m) {
      return { price: fnum(m[1]), pct: p ? fnum(p[1]) : null, contract: "GIFT Nifty", source: "investing.com" };
    }
  } catch { /* fall through */ }

  // b. crawl the web: TradingView renders the live GIFT Nifty (NSEIX:NIFTY1!,
  // "GIFT NIFTY 50 INDEX FUTURES") quote server side in the page HTML, no API key.
  // Both the Indian and the global host are tried, one after the other.
  for (const host of ["in.tradingview.com", "www.tradingview.com"]) {
    try {
      const page = await (await get(`https://${host}/symbols/NSEIX-NIFTY1!/`, { timeout: 20000 })).text();
      const m = page.match(/"name":"daily_bar_close"[^}]*"value":([\d.]+)/);
      const c = page.match(/"name":"daily_bar_change"[^}]*"value":(-?[\d.]+)/);
      if (m) {
        return {
          price: parseFloat(m[1]), pct: c ? parseFloat(c[1]) : null,
          contract: "GIFT Nifty (front month)", source: `TradingView page crawl (${host})`,
        };
      }
      const t = page.match(
        /current price of GIFT NIFTY 50 INDEX FUTURES is ([\d,.]+)[^%]*?(risen|fallen|hasn.t changed)[^%\d]*([\d,.]+)?%/
      );
      if (t) {
        const pct = t[2].startsWith("hasn") ? 0 : (fnum(t[3]) || 0) * (t[2] === "risen" ? 1 : -1);
        return {
          price: fnum(t[1]), pct,
          contract: "GIFT Nifty (front month)", source: `TradingView page crawl (${host})`,
        };
      }
    } catch { /* next host */ }
  }

  return { price: null, pct: null, contract: null, source: null };
}

// ------------------------------------------------- market context ("the oil ones, everything")
export const CONTEXT_SYMBOLS = [
  { key: "wti", sym: "CL=F", name: "WTI Crude", group: "Energy", unit: "USD/bbl" },
  { key: "brent", sym: "BZ=F", name: "Brent Crude", group: "Energy", unit: "USD/bbl" },
  { key: "gold", sym: "GC=F", name: "Gold", group: "Metals", unit: "USD/oz" },
  { key: "usdinr", sym: "INR=X", name: "USD / INR", group: "FX", unit: "₹" },
  { key: "us10y", sym: "^TNX", name: "US 10Y yield", group: "Rates", unit: "%" },
  { key: "sp500", sym: "^GSPC", name: "S&P 500", group: "US overnight", unit: "" },
  // live US index futures: more recent information than the overnight close
  { key: "es_fut", sym: "ES=F", name: "S&P 500 futures", group: "US futures (live)", unit: "" },
  { key: "nq_fut", sym: "NQ=F", name: "Nasdaq 100 futures", group: "US futures (live)", unit: "" },
  { key: "ym_fut", sym: "YM=F", name: "Dow futures", group: "US futures (live)", unit: "" },
  { key: "nikkei", sym: "^N225", name: "Nikkei 225", group: "Asia session", unit: "" },
  { key: "hsi", sym: "^HSI", name: "Hang Seng", group: "Asia session", unit: "" },
  { key: "nifty", sym: "^NSEI", name: "NIFTY 50 spot", group: "India", unit: "" },
  { key: "banknifty", sym: "^NSEBANK", name: "NIFTY Bank", group: "India", unit: "" },
];

// documented heuristic interpretations, one per factor (see methodology page)
function interpret(key, pct, bpChange) {
  const s = (t) => t;
  switch (key) {
    case "wti": case "brent":
      if (pct === null) return null;
      if (pct >= 1) return s("Headwind: costlier imports pressure OMCs, paints, tyres, aviation; supports upstream (ONGC, Oil India)");
      if (pct <= -1) return s("Tailwind: cheaper import bill helps OMCs, paints, aviation; weighs on upstream");
      return s("Neutral for India at this move size");
    case "usdinr":
      if (pct === null) return null;
      if (pct >= 0.2) return s("Rupee weakening: pressure on FII flows and importers; helps IT exporters");
      if (pct <= -0.2) return s("Rupee strengthening: supportive for FII flows and importers");
      return s("Stable currency, no directional read");
    case "gold":
      if (pct === null) return null;
      if (pct >= 0.5) return s("Safe-haven bid, risk-off tone in global markets");
      if (pct <= -0.5) return s("Risk appetite improving, safe-haven demand easing");
      return s("No strong risk signal");
    case "us10y":
      if (bpChange === null) return null;
      if (bpChange >= 5) return s("Yields rising: pressure on rate-sensitive sectors (banks, realty, autos)");
      if (bpChange <= -5) return s("Yields falling: supportive for rate-sensitive sectors");
      return s("Rates steady");
    case "sp500":
      if (pct === null) return null;
      return pct > 0 ? s("Overnight US risk appetite positive") : pct < 0 ? s("Overnight US risk appetite negative") : s("US flat overnight");
    case "nikkei": case "hsi":
      if (pct === null) return null;
      return pct > 0.3 ? s("Asia session trading positive, supportive tone for the Indian open")
        : pct < -0.3 ? s("Asia session trading negative, caution for the Indian open")
        : s("Asia session broadly flat");
    case "es_fut": case "nq_fut": case "ym_fut":
      if (pct === null) return null;
      return pct > 0.15 ? s("Live futures above their prior settle, more recent than the overnight close")
        : pct < -0.15 ? s("Live futures below their prior settle, more recent than the overnight close")
        : s("Futures near flat");
    case "nifty": case "banknifty":
      return null; // reference anchors, no interpretation
    default:
      return null;
  }
}

export async function marketContext() {
  const one = async (spec) => {
    try {
      const d = await jget(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(spec.sym)}?range=5d&interval=1d`,
        { timeout: 12000 }
      );
      const r = d.chart.result[0];
      const m = r.meta;
      const price = m.regularMarketPrice ?? null;
      const closes = (r.indicators?.quote?.[0]?.close || []).filter((x) => x !== null && x !== undefined);
      // daily change: latest price vs the PREVIOUS session's close from the 5d series.
      // (meta.chartPreviousClose with range=5d is the close before the whole window,
      // that would make every "daily" change a 5-day change.)
      const prev = closes.length >= 2 ? closes[closes.length - 2] : (m.chartPreviousClose ?? m.previousClose ?? null);
      const pct = price !== null && prev ? +((100 * (price - prev) / prev).toFixed(2)) : null;
      // ^TNX convention guard: modern Yahoo returns the yield in % directly (e.g. 5.098);
      // older feeds returned yield x10 (e.g. 50.98). Normalize to % for display.
      const tnxScale = spec.key === "us10y" ? (price !== null && price > 20 ? 10 : 1) : 1;
      const bpChange = spec.key === "us10y" && price !== null && prev
        ? +(((price - prev) / tnxScale) * 100).toFixed(1) : null;
      const display = spec.key === "us10y" && price !== null ? +(price / tnxScale).toFixed(3) : price;
      const displayPrev = spec.key === "us10y" && prev ? +(prev / tnxScale).toFixed(3) : prev;
      return {
        ...spec, price: display, prev: displayPrev, pct, bpChange,
        spark: closes.slice(-5).map((x) => (spec.key === "us10y" ? +(x / tnxScale).toFixed(3) : +x.toFixed(2))),
        signal: pct === null ? "UNAVAILABLE" : pct > 0 ? "UP" : pct < 0 ? "DOWN" : "FLAT",
        note: interpret(spec.key, pct, bpChange),
        source: "Yahoo Finance chart API",
      };
    } catch {
      return { ...spec, price: null, prev: null, pct: null, bpChange: null, spark: [], signal: "UNAVAILABLE", note: null, source: null };
    }
  };
  return (await Promise.all(CONTEXT_SYMBOLS.map(one)));
}

// GIFT Nifty vs NIFTY spot prev close = implied opening gap (includes futures basis)
export function impliedOpen(giftPrice, niftyItem) {
  if (giftPrice == null || !niftyItem || niftyItem.price == null) return null;
  const gap = (giftPrice / niftyItem.price - 1) * 100;
  return {
    gift: giftPrice, nifty_prev_close: niftyItem.price,
    gap_pct: +gap.toFixed(2),
    note: "GIFT Nifty trades nearly 21 hours and carries a futures basis, so read the gap as directional context, not an exact open print.",
  };
}

// ------------------------------------------------- decision framework
// Roles are NOT equal votes (that was the old, naive model):
//   GIFT Nifty  -> primary opening indication (gap size matters, not just colour)
//   US indices  -> global context (close vs live futures are different inputs)
//   NSE pre open -> domestic cross confirmation of the opening indication
//   Breadth     -> trend confirmation after the open, not a pre open predictor
//   India VIX   -> risk gauge (volatility expectation), never direction
// Thresholds are documented constants; the framework classifies the OPENING
// (Question A) and explicitly refuses forced conclusions on conflicting data.

export const GAP_NEUTRAL = 0.15; // |gap| below this % is a neutral indication
export const GAP_STRONG = 0.50;  // |gap| above this % is a strong indication

export function classifyGap(gapPct) {
  if (gapPct === null || gapPct === undefined) {
    return { direction: "unknown", magnitude: "unknown", label: "unknown" };
  }
  const abs = Math.abs(gapPct);
  if (abs < GAP_NEUTRAL) return { direction: "neutral", magnitude: "negligible", label: "near unchanged" };
  const dir = gapPct > 0 ? "positive" : "negative";
  const mag = abs < GAP_STRONG ? "modest" : "strong";
  return { direction: dir, magnitude: mag, label: `${mag} ${dir} gap (${gapPct > 0 ? "+" : ""}${gapPct}%)` };
}

function avgOf(nums) {
  const v = nums.filter((x) => x !== null && x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// Step 2: do global cues support the opening indication? Context, not override.
export function assessGlobalCues(usIdx, ctx, opening) {
  const pctOf = (k) => { const c = ctx.find((x) => x.key === k); return c ? c.pct : null; };
  const groups = [
    { name: "US close (previous session)", value: avgOf(usIdx.map((n) => n.pct)) },
    { name: "US futures (live)", value: avgOf([pctOf("es_fut"), pctOf("nq_fut"), pctOf("ym_fut")]) },
    { name: "Asia session", value: avgOf([pctOf("nikkei"), pctOf("hsi")]) },
  ];
  const dir = opening.direction;
  for (const g of groups) {
    if (g.value === null) { g.stance = "unknown"; continue; }
    if (dir === "neutral" || dir === "unknown") { g.stance = "neutral"; continue; }
    g.stance = Math.abs(g.value) < GAP_NEUTRAL ? "neutral"
      : (g.value > 0) === (dir === "positive") ? "supportive" : "opposing";
  }
  const known = groups.filter((g) => g.stance === "supportive" || g.stance === "opposing");
  const support = known.filter((g) => g.stance === "supportive").length;
  const oppose = known.filter((g) => g.stance === "opposing").length;
  const classification = !known.length ? "no read"
    : oppose === 0 ? "supportive" : support === 0 ? "opposing" : "mixed";
  return { groups, classification };
}

// Step 5: VIX as a risk gauge against its own 1y distribution (no fixed 15 line)
export function vixRisk(vix) {
  if (vix.price === null || vix.price === undefined) return { level: "unknown", note: "India VIX unavailable" };
  const p = vix.percentile_1y;
  if (p === null || p === undefined) {
    return { level: "unclassified", note: `India VIX ${vix.price.toFixed(2)}; 1y history unavailable for a percentile read` };
  }
  const level = p < 25 ? "low" : p < 60 ? "moderate" : p < 85 ? "elevated" : "high";
  const notes = {
    low: "Expected volatility is near the low end of its 1 year range, which means comparatively calm conditions",
    moderate: "Expected volatility is mid-range for the past year",
    elevated: "Expected volatility is elevated vs the past year: tighten risk management, wider stops or smaller size",
    high: "Expected volatility is near 1 year highs. This is a risk statement, not a direction call.",
  };
  return { level, percentile_1y: p, note: `${notes[level]} (${vix.price.toFixed(2)}, ${p}th percentile of the trailing year)` };
}

// Step 3: NSE pre open session (09:00 to 09:15 IST), indicative equilibrium price.
// nseindia.com generally refuses datacenter IPs, so this is a best-effort,
// short-timeout attempt; failure is reported honestly and the framework simply
// loses domestic cross-confirmation (it never fabricates the value).
export async function nsePreOpen() {
  const attempts = [
    { url: "https://www.nseindia.com/api/EquityIndex?index=NIFTY%2050", pick: (d) => d?.data?.preopen?.find?.((x) => /nifty\s*50/i.test(x.symbol || x.index || "")) },
    { url: "https://www.nseindia.com/api/PreOpenNseIndices", pick: (d) => (d?.data || []).find?.((x) => /nifty\s*50/i.test(x.symbol || x.indexName || x.index || "")) },
  ];
  for (const a of attempts) {
    try {
      const d = await jget(a.url, { timeout: 6000, headers: { Referer: "https://www.nseindia.com/" } });
      const row = a.pick(d);
      const price = row ? fnum(row.lastPrice ?? row.last ?? row.price ?? row.iep) : null;
      if (price !== null) {
        return { available: true, price, source: "nseindia.com pre open session" };
      }
    } catch { /* next */ }
  }
  return { available: false, price: null, source: null, reason: "NSE pre open feed unreachable from this host (nseindia.com blocks datacenter IPs)" };
}

// Step 4: post open confirmation (around 09:20 IST): what price action actually did.
export async function postOpenConfirmation({ cache = null } = {}) {
  const out = { captured_at: istNow().stamp };
  const poUrl = "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?range=1d&interval=5m";
  let d = null, poCached = null;
  try {
    d = await jget(poUrl, { timeout: 15000 });
    if (cache) cache.set("cache/postopen_chart", JSON.stringify({ at: Date.now(), v: d })).catch(() => {});
  } catch {
    if (cache) {
      try {
        const c = JSON.parse((await cache.get("cache/postopen_chart")) || "null");
        if (c && Date.now() - c.at <= 20 * 60000) { d = c.v; poCached = Math.round((Date.now() - c.at) / 60000); }
      } catch { /* unreadable */ }
    }
  }
  try {
    if (!d) throw new Error("source down, no fresh cache");
    const r = d.chart.result[0];
    const prevClose = r.meta.chartPreviousClose ?? r.meta.previousClose ?? null;
    const ts = r.timestamp || [];
    const q = r.indicators.quote[0];
    let open = null, last = null;
    for (let i = 0; i < ts.length; i++) {
      // only candles at/after 09:15 IST (03:45 UTC) count as regular session
      const utc = new Date(ts[i] * 1000).toISOString();
      const hm = utc.slice(11, 16);
      if (hm < "03:45") continue;
      if (open === null && q.open?.[i] != null) open = q.open[i];
      if (q.close?.[i] != null) last = q.close[i];
    }
    if (open === null && r.meta.regularMarketOpen != null) open = r.meta.regularMarketOpen;
    if (last === null) last = r.meta.regularMarketPrice ?? null;
    if (open !== null && last !== null) {
      out.open = +open.toFixed(2);
      out.last = +last.toFixed(2);
      out.prev_close = prevClose !== null ? +prevClose.toFixed(2) : null;
      out.vs_open_pct = +((100 * (last - open) / open)).toFixed(2);
      out.open_vs_prev_pct = prevClose ? +((100 * (open - prevClose) / prevClose)).toFixed(2) : null;
      out.holding = out.vs_open_pct > 0.05 ? "above open" : out.vs_open_pct < -0.05 ? "below open" : "near open";
    }
  } catch (e) { out.error = "post open chart unavailable: " + String(e?.message || e); }
  if (poCached !== null) out.cached_min = poCached;
  try {
    const ad = await advanceDecline();
    out.breadth_now = { advances: ad.advances, declines: ad.declines, signal: ad.signal, source: ad.source };
  } catch { /* breadth unavailable */ }
  try {
    const v = await indiaVix();
    out.vix_now = v.price;
  } catch { /* vix unavailable */ }
  out.note = "Captured around 09:20 IST. Opening bias is Question A. Sustaining the move after the open is Question B. This snapshot is the first evidence for it, not a verdict on the day.";
  return out;
}

// Full framework assembly (see methodology page for the documented rules)
export function assembleFramework({ giftValue, niftyCtx, usIdx, ctx, vix, preOpen }) {
  const implied = impliedOpen(giftValue, niftyCtx);
  const gap = implied ? implied.gap_pct : null;
  const opening = classifyGap(gap);
  const global = assessGlobalCues(usIdx, ctx, opening);
  const risk = vixRisk(vix);

  let preOpenVerdict = null;
  if (preOpen?.available && preOpen.price !== null && niftyCtx?.price != null && opening.direction !== "unknown") {
    const pGap = +((100 * (preOpen.price - niftyCtx.price) / niftyCtx.price).toFixed(2));
    preOpen = { ...preOpen, gap_pct: pGap, direction: classifyGap(pGap).direction };
    preOpenVerdict = preOpen.direction === opening.direction ? "confirms"
      : opening.direction === "neutral" || preOpen.direction === "neutral" ? "neutral"
      : "conflicts";
  }

  const rationale = [];
  rationale.push(`GIFT Nifty implied gap ${gap === null ? "unavailable" : (gap > 0 ? "+" : "") + gap + "%"}: ${opening.label} (primary opening indication).`);
  rationale.push(`Global cues: ${global.groups.map((g) => `${g.name} ${g.value === null ? "n/a" : (g.value > 0 ? "+" : "") + g.value.toFixed(2) + "%"}`).join(", ")} → ${global.classification}.`);
  rationale.push(preOpen?.available
    ? `NSE pre open indicative ${preOpen.price} (${preOpen.direction} vs previous close) → ${preOpenVerdict}.`
    : "NSE pre open indicative unavailable → domestic cross confirmation missing.");
  rationale.push(`Risk: India VIX ${vix.price === null ? "unavailable" : vix.price.toFixed(2)}: ${risk.level}${risk.percentile_1y !== undefined && risk.percentile_1y !== null ? ` (${risk.percentile_1y}th pct of 1y)` : ""}; volatility expectation, not direction.`);

  let classification;
  if (opening.direction === "unknown") {
    classification = "Opening indication unknown: GIFT Nifty unavailable";
  } else if (preOpenVerdict === "conflicts") {
    classification = "Conflicting signals: GIFT Nifty and the NSE pre open disagree; no directional conclusion";
  } else if (opening.direction === "neutral") {
    classification = `Neutral opening indication${preOpenVerdict === "confirms" ? " (pre open agrees)" : ""}`;
  } else {
    const word = opening.direction === "positive" ? "Positive" : "Negative";
    const conf = preOpenVerdict === "confirms" ? ", confirmed by the NSE pre open session" : "";
    const glob = global.classification === "supportive" ? "; global cues supportive"
      : global.classification === "opposing" ? "; global cues opposing, treat with caution"
      : global.classification === "mixed" ? "; global cues mixed" : "";
    classification = `${word} opening bias (${opening.magnitude} gap)${conf}${glob}`;
  }

  return {
    version: 2,
    opening: { ...opening, implied },
    global,
    pre_open: preOpen || null,
    pre_open_verdict: preOpenVerdict,
    risk,
    classification,
    rationale,
    scope_note: "This assesses the opening direction only (Question A). Whether the move sustains after 09:15 is a separate question, judged from the post-open confirmation snapshot and the session's own price action.",
    breadth_note: "Advances and declines at the last close are a trend confirmation input once trading begins, not an opening predictor.",
  };
}

import { ensembleView } from "./ensemble.mjs";

// ------------------------------------------------- LSTM prediction (tutorial pipeline, JS inference)
function nextTradingDays(lastDateStr, count) {
  const out = [];
  const d = new Date(lastDateStr + "T00:00:00Z");
  while (out.length < count) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export async function niftyPrediction(fc, { backtestPoints = 10, horizon = 5, chartDays = 120, cache = null } = {}) {
  if (!fc) return null;
  const now = Date.now();
  const p1 = Math.floor((now - 400 * 86400000) / 1000);
  const p2 = Math.floor(now / 1000);
  const niftyUrl = `https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?period1=${p1}&period2=${p2}&interval=1d`;
  let d;
  let inputCached = null;
  try {
    d = await jget(niftyUrl, { timeout: 15000 });
    if (cache) cache.set("cache/nifty_series", JSON.stringify({ at: Date.now(), v: d })).catch(() => {});
  } catch (e) {
    // fallback: the last good series. Overnight the series does not change,
    // so a recent cached copy is the same data; the age is disclosed.
    let recovered = false;
    if (cache) {
      try {
        const c = JSON.parse((await cache.get("cache/nifty_series")) || "null");
        if (c && Date.now() - c.at <= 1440 * 60000) {
          d = c.v;
          inputCached = { age_min: Math.round((Date.now() - c.at) / 60000) };
          recovered = true;
        }
      } catch { /* unreadable */ }
    }
    if (!recovered) return { error: "NIFTY history fetch failed: " + String(e?.message || e) };
  }
  const r = d.chart.result[0];
  const ts = r.timestamp || [];
  const q = r.indicators.quote[0];
  const todayIst = istNow().date;
  const dates = [], mids = [], closes = [];
  for (let i = 0; i < ts.length; i++) {
    const dt = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    // drop a same-day placeholder bar formed before/just after the open
    if (dt === todayIst) continue;
    const h = q.high[i], l = q.low[i], c = q.close[i];
    if (h == null || l == null || c == null) continue;
    dates.push(dt); mids.push((h + l) / 2); closes.push(c);
  }
  if (mids.length < fc.meta.num_unrollings + backtestPoints + 5) {
    return { error: "not enough history" };
  }
  const scaled = mids.map((m) => fc.scale(m));
  const recent = scaled.slice(-60);
  const rangeOk = Math.max(...recent) <= 1.05 && Math.min(...recent) >= -0.05;

  const t0 = Date.now();
  const nextScaled = fc.predictFrom(scaled, scaled.length, horizon);
  const nextDates = nextTradingDays(dates[dates.length - 1], horizon);
  const lastClose = closes[closes.length - 1];
  const next = nextScaled.map((s, i) => {
    const v = fc.unscale(s);
    return { d: nextDates[i], value: +v.toFixed(2), chg_pct_vs_last_close: +((100 * (v - lastClose) / lastClose).toFixed(2)) };
  });
  const bt = fc.backtest(scaled, backtestPoints);
  const rows = bt.map((x) => ({
    d: dates[x.idx],
    actual_mid: +fc.unscale(x.actual).toFixed(2),
    pred_mid: +fc.unscale(x.pred).toFixed(2),
    prev_close: +closes[x.idx - 1].toFixed(2),
  }));
  const rmsePrice = Math.sqrt(rows.reduce((a, x) => a + (x.pred_mid - x.actual_mid) ** 2, 0) / rows.length);
  const rmseScaled = Math.sqrt(bt.reduce((a, x) => a + (x.pred - x.actual) ** 2, 0) / bt.length);
  let hits = 0;
  for (const x of rows) {
    const pd = x.pred_mid - x.prev_close, ad = x.actual_mid - x.prev_close;
    if ((pd > 0 && ad > 0) || (pd < 0 && ad < 0) || (pd === 0 && ad === 0)) hits++;
  }
  const series = dates.slice(-chartDays).map((dt, i) => ({ d: dt, close: +closes[closes.length - chartDays + i].toFixed(2) }));

  return {
    as_of: dates[dates.length - 1],
    input_cached: inputCached,
    last_close: +lastClose.toFixed(2),
    last_mid: +mids[mids.length - 1].toFixed(2),
    next, backtest: { rows, rmse_price: +rmsePrice.toFixed(2), rmse_scaled: +rmseScaled.toFixed(5), hit_rate: +(hits / rows.length).toFixed(2), points: rows.length },
    series, range_ok: rangeOk, inference_ms: Date.now() - t0,
    model: {
      name: fc.meta.name, trained_at: fc.meta.trained_at, arch: `LSTM ${fc.meta.num_nodes.join("-")} + FC(1), truncated BPTT (unrollings=${fc.meta.num_unrollings}), EMA-smoothed MinMax scaling`,
      trained_on: `${fc.meta.data_file}, rows ${fc.meta.n_rows}, split ${fc.meta.split}`,
      best_test_mse: fc.meta.best_test_mse, epochs: fc.meta.epochs,
      target: "mid price = (High+Low)/2, one session ahead, predictions fed back for the multi-day path",
    },
  };
}

// ------------------------------------------------------------------ source fallbacks
// Every data check gets, in order: its primary source, an alternate source
// where one exists, and a last good cached copy with a per source freshness
// limit. Switching is automatic and every fallback is disclosed in the report
// (r.sources), so a reader always knows where a number came from.
export function makeSourceTracker(cache) {
  const states = {};
  // bad: predicate telling a degraded result from a good one
  const wrap = (key, label, ttlMin, fn, bad) => async () => {
    let v;
    try { v = await fn(); } catch (e) { v = null; }
    const degraded = v === null || v === undefined || (bad ? bad(v) : false);
    if (!degraded) {
      states[key] = { label, state: "live" };
      if (cache) cache.set(`cache/${key}`, JSON.stringify({ at: Date.now(), v })).catch(() => {});
      return v;
    }
    if (cache) {
      try {
        const c = JSON.parse((await cache.get(`cache/${key}`)) || "null");
        const ageMin = c ? Math.round((Date.now() - c.at) / 60000) : Infinity;
        if (c && ageMin <= ttlMin) {
          states[key] = { label, state: "cached", age_min: ageMin };
          return c.v;
        }
      } catch { /* cache unreadable */ }
    }
    states[key] = { label, state: "degraded" };
    return v; // the fetcher's own honest "unavailable" shape
  };
  return { wrap, states };
}

// ------------------------------------------------------------------ scan
export async function runScan(now = new Date(), opts = {}) {
  const t = istNow(now);
  const track = makeSourceTracker(opts.cache);
  const w = track.wrap;
  const [us, vix, ad, sn, ctx, preOpen] = await Promise.all([
    w("us_indices", "US indices", 360, usIndices,
      (r) => !Array.isArray(r) || r.length < 2 || r.some((x) => x.value === null))(),
    w("india_vix", "India VIX", 360, indiaVix, (r) => r.price === null)(),
    w("advance_decline", "Advances and declines", 1440, advanceDecline, (r) => r.advances === null)(),
    w("gift_nifty", "GIFT Nifty", 30, singaporeNifty, (r) => r.price === null)(),
    w("market_context", "Market context", 360, marketContext,
      (r) => !Array.isArray(r) || r.filter((c) => c.pct === null).length > r.length / 2)(),
    nsePreOpen(),
  ]);
  let pred = opts.forecaster
    ? await niftyPrediction(opts.forecaster, { cache: opts.cache }).catch((e) => ({ error: String(e?.message || e) }))
    : null;
  if (pred && !pred.error && opts.ensembleParams !== undefined) {
    // ensembleParams === null -> skip; {} -> artifact defaults via ensembleView
    pred.ensemble = opts.ensembleParams ? ensembleView(pred, opts.ensembleParams) : null;
  }

  const checks = {
    us_overnight: us.map((n) => ({ ...n, signal: colour(n.pct) })),
    india_vix: {
      label: "India VIX", value: vix.price, threshold: VIX_THRESHOLD,
      percentile_1y: vix.percentile_1y,
      signal: vix.price === null ? "UNAVAILABLE"
        : vix.price > VIX_THRESHOLD ? "HIGH volatility expected" : "LOW volatility expected",
      source: vix.source,
      role: "risk assessment: expected volatility over the next 30 calendar days, not a direction call",
    },
    advance_decline: {
      label: "Advances vs Declines (last close)", advances: ad.advances, declines: ad.declines,
      unchanged: ad.unchanged, universe: ad.universe,
      signal: ad.advances === null ? "UNAVAILABLE"
        : ad.advances > ad.declines ? "BULLISH breadth"
        : ad.advances < ad.declines ? "BEARISH breadth" : "NEUTRAL breadth",
      source: ad.source,
      role: "trend confirmation once trading begins, not a standalone pre open predictor",
    },
    singapore_nifty: {
      label: "GIFT Nifty (NSE IX)", contract: sn.contract,
      value: sn.price, pct: sn.pct, signal: colour(sn.pct), source: sn.source,
      role: "primary opening indication",
    },
  };

  // legacy plus minus 1 score (kept for archive continuity only; the dashboard leads
  // with the framework classification, which does NOT count equal votes)
  let score = 0;
  const notes = [];
  for (const n of checks.us_overnight) {
    if (n.pct !== null && n.pct !== undefined) score += n.pct > 0 ? 1 : -1;
    else notes.push(n.label);
  }
  const v = checks.india_vix.value;
  if (v !== null && v !== undefined) score += v < VIX_THRESHOLD ? 1 : -1;
  else notes.push("India VIX");
  const a = ad.advances, dcl = ad.declines;
  if (a !== null && a !== undefined) score += a > dcl ? 1 : a < dcl ? -1 : 0;
  else notes.push("Advances/Declines");
  if (sn.pct !== null && sn.pct !== undefined) score += sn.pct > 0 ? 1 : -1;
  else notes.push("GIFT Nifty");
  if (preOpen && !preOpen.available && preOpen.reason) notes.push("NSE pre open");

  const niftyCtx = ctx.find((c) => c.key === "nifty");
  const framework = assembleFramework({ giftValue: sn.price, niftyCtx, usIdx: us, ctx, vix, preOpen });

  return {
    generated_at: t.stamp, date: t.date, weekday: t.weekday,
    score, bias: framework.classification, unavailable: notes, checks,
    sources: track.states,
    framework,
    context: ctx,
    implied_open: framework.opening.implied,
    predictions: pred,
  };
}

// ------------------------------------------------------------------ renderers
const fmt2 = (n) => (n === null || n === undefined ? "n/a"
  : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pctS = (p) => (p === null || p === undefined ? "n/a" : `${p >= 0 ? "+" : ""}${Number(p).toFixed(2)}%`);

export function toMarkdown(r) {
  const c = r.checks;
  const L = [];
  L.push(`# Premarket report: ${r.date} (${r.weekday})`, "");
  L.push(`Generated ${r.generated_at} · market opens 09:15 IST`, "");
  if (r.framework) {
    L.push(`**Opening bias: ${r.framework.classification}**`, "");
    for (const line of r.framework.rationale) L.push(`- ${line}`);
    L.push("", `_${r.framework.scope_note}_`, "");
  } else {
    L.push(`**${r.bias}**  (legacy score ${r.score >= 0 ? "+" : ""}${r.score})`, "");
  }
  L.push("| # | Check | Reading | Signal | Role | Source |", "|---|-------|---------|--------|------|--------|");
  for (const n of c.us_overnight) {
    L.push(`| 1 | ${n.label} | ${fmt2(n.value)} (${pctS(n.pct)}) | ${n.signal} | global context | ${n.source || "unavailable"} |`);
  }
  const v = c.india_vix;
  const vixRead = v.value === null || v.value === undefined ? "n/a" : `${Number(v.value).toFixed(2)}${v.percentile_1y != null ? ` (${v.percentile_1y}th pct of 1y)` : ""}`;
  L.push(`| 2 | ${v.label} | ${vixRead} | ${v.signal} | risk assessment | ${v.source || "unavailable"} |`);
  const a = c.advance_decline;
  const reading = a.advances === null || a.advances === undefined ? "n/a" : `${a.advances} advances / ${a.declines} declines`;
  L.push(`| 3 | ${a.label} | ${reading} | ${a.signal} | trend confirmation (post-open) | ${a.source || "unavailable"} |`);
  const s = c.singapore_nifty;
  L.push(`| 4 | ${s.label} | ${fmt2(s.value)} (${pctS(s.pct)}) | ${s.signal} | primary opening indication | ${s.source || "unavailable"} |`);
  if (r.framework?.pre_open?.available) {
    const po = r.framework.pre_open;
    L.push(`| 5 | NSE pre open (indicative) | ${fmt2(po.price)} (${po.direction}) | ${r.framework.pre_open_verdict} | domestic confirmation | ${po.source || "nseindia.com"} |`);
  }
  if (r.implied_open) {
    L.push("", `**Implied open (GIFT Nifty vs NIFTY prev close): ${r.implied_open.gap_pct >= 0 ? "+" : ""}${r.implied_open.gap_pct}%**`);
  }
  if (Array.isArray(r.context) && r.context.length) {
    L.push("", "### Market context", "", "| Factor | Price | Change | Read |", "|---|---|---|---|");
    for (const x of r.context) {
      if (x.price === null) { L.push(`| ${x.name} | n/a | n/a | unavailable |`); continue; }
      const chg = x.key === "us10y" && x.bpChange !== null
        ? `${x.bpChange >= 0 ? "+" : ""}${x.bpChange} bp`
        : `${x.pct >= 0 ? "+" : ""}${x.pct}%`;
      L.push(`| ${x.name} | ${Number(x.price).toLocaleString("en-US", { maximumFractionDigits: 2 })} | ${chg} | ${x.note || x.signal} |`);
    }
  }
  if (r.predictions && !r.predictions.error && r.predictions.next) {
    const p = r.predictions;
    const e = p.ensemble;
    L.push("", e ? "### Model forecast: adaptive ensemble (primary)" : "### LSTM model prediction (NIFTY 50)", "");
    if (e) {
      const nx = e.next[0];
      L.push(`Next session (${nx.d}): **${nx.value.toLocaleString("en-US")}** (${nx.chg_pct_vs_last_close >= 0 ? "+" : ""}${nx.chg_pct_vs_last_close}% vs last close ${p.last_close.toLocaleString("en-US")})`);
      L.push(`Formula ${e.formula} with w = ${e.w}, LSTM bias ${e.lstm_bias}; weight learned: ${e.w_source}.`);
      L.push(`5 session path: ${e.next.map((n) => n.value.toLocaleString("en-US")).join(" → ")}`);
      if (e.fallback_note) L.push(`> ${e.fallback_note}`);
      const c = e.components;
      L.push("", "| Component | Next session | vs last close |", "| --- | --- | --- |");
      L.push(`| **Ensemble (primary)** | **${nx.value.toLocaleString("en-US")}** | **${nx.chg_pct_vs_last_close >= 0 ? "+" : ""}${nx.chg_pct_vs_last_close}%** |`);
      if (c.timesfm?.[0]) L.push(`| TimesFM 2.5 (artifact ${e.tf_as_of}) | ${c.timesfm[0].value.toLocaleString("en-US")} | ${c.timesfm[0].chg_pct_vs_last_close >= 0 ? "+" : ""}${c.timesfm[0].chg_pct_vs_last_close}% |`);
      if (c.lstm_corrected?.[0]) L.push(`| LSTM live, bias corrected | ${c.lstm_corrected[0].value.toLocaleString("en-US")} | ${c.lstm_corrected[0].chg_pct_vs_last_close >= 0 ? "+" : ""}${c.lstm_corrected[0].chg_pct_vs_last_close}% |`);
      if (c.lstm_live?.[0]) L.push(`| LSTM live, raw | ${c.lstm_live[0].value.toLocaleString("en-US")} | ${c.lstm_live[0].chg_pct_vs_last_close >= 0 ? "+" : ""}${c.lstm_live[0].chg_pct_vs_last_close}% |`);
      if (e.scorecard) {
        const sc = e.scorecard;
        L.push("", `**Learning loop:** ${sc.n_resolved} past session${sc.n_resolved === 1 ? "" : "s"} scored against actuals${sc.w_live != null ? `: live weight w = ${sc.w_live} (bias ${sc.bias_live}, window ${sc.live_window})` : ": live relearning starts once 5 sessions have resolved"}. ${sc.note || ""}`.trim());
      }
    } else {
      L.push(`Next session (${p.next[0].d}): **${p.next[0].value.toLocaleString("en-US")}** (${p.next[0].chg_pct_vs_last_close >= 0 ? "+" : ""}${p.next[0].chg_pct_vs_last_close}% vs last close ${p.last_close.toLocaleString("en-US")})`);
      L.push(`${p.horizonText || ""}5 session path: ${p.next.map((n) => n.value.toLocaleString("en-US")).join(" → ")}`);
    }
    L.push(`LSTM rolling ${p.backtest.points}-session backtest: RMSE ${p.backtest.rmse_price} pts (${p.backtest.rmse_scaled} scaled), direction hit-rate ${(p.backtest.hit_rate * 100).toFixed(0)}%`);
    if (!p.range_ok) L.push("> Warning: recent prices sit outside the model's training range; treat this forecast as unreliable until the model is retrained.");
  } else if (r.predictions && r.predictions.error) {
    L.push("", `### Model forecast (NIFTY 50)`, "", `> Prediction unavailable this run: ${r.predictions.error}`);
  }
  if (r.confirmation) {
    const cf = r.confirmation;
    L.push("", "### Post-open confirmation", "");
    if (cf.open !== undefined) {
      L.push(`Open ${fmt2(cf.open)}${cf.open_vs_prev_pct !== null && cf.open_vs_prev_pct !== undefined ? ` (${cf.open_vs_prev_pct >= 0 ? "+" : ""}${cf.open_vs_prev_pct}% vs prev close)` : ""} · last ${fmt2(cf.last)} (${cf.vs_open_pct >= 0 ? "+" : ""}${cf.vs_open_pct}% vs open, holding ${cf.holding})`);
    }
    if (cf.breadth_now) L.push(`Breadth now: ${cf.breadth_now.advances} advances / ${cf.breadth_now.declines} declines (${cf.breadth_now.signal}).`);
    if (cf.vix_now != null) L.push(`India VIX now: ${Number(cf.vix_now).toFixed(2)}.`);
    L.push("", `_${cf.note}_`);
  }
  L.push("", "### How to read this (decision framework)", "");
  L.push("1. **GIFT Nifty (NSE IX)** is the primary opening indication. Gap size matters, not just colour (neutral under 0.15%, modest under 0.5%, strong at 0.5% or more).");
  L.push("2. **Global cues** (US close, live US futures, Asia) provide context; they do not automatically override domestic price discovery.");
  L.push("3. **NSE pre open session** (09:00 to 09:15) gives the domestic indicative opening. Agreement confirms the bias; disagreement means conflicting signals, not a forced conclusion.");
  L.push("4. **Advances and declines** confirm the developing trend once trading begins (holding above or below the open, breadth participation). They are not a pre open predictor.");
  L.push("5. **India VIX** measures expected volatility (next 30 calendar days), assessed against its own 1 year range. It informs risk management, never direction.");
  L.push("");
  L.push("_Terminology: GIFT Nifty (NSE International Exchange) replaced SGX Nifty in July 2023; 'Singapore Nifty' is outdated._");
  L.push("_This report classifies the opening direction (Question A). Whether the move sustains after 09:15 is Question B, judged from post-open price action._");
  if (r.unavailable && r.unavailable.length) {
    L.push("", `> Note: ${r.unavailable.join(", ")} could not be fetched from any source at scan time and is reported as unavailable rather than guessed.`);
  }
  // data freshness disclosure (fallback cache transparency)
  if (r.sources) {
    const parts = Object.entries(r.sources).map(([k, v]) =>
      `${v.label}: ${v.state === "live" ? "live" : v.state === "cached" ? `cached, ${v.age_min} min old` : "degraded"}`);
    const pc = r.predictions && r.predictions.input_cached ? `Model input series cached, ${r.predictions.input_cached.age_min} min old.` : "";
    if (parts.length) L.push("", `**Data freshness:** ${parts.join(" · ")}.${pc}`);
  }
  L.push("", "*Source policy: Investing.com and nseindia.com are tried first as specified. If they reject the request (Cloudflare or Akamai 403), labelled fallbacks serve the values instead, including a live web crawl for GIFT Nifty, and each source keeps a last good cache as a final fallback. Every row names the source that actually served it.*", "");
  return L.join("\n");
}

const SIG_BG = { GREEN: "#052e16", RED: "#450a0a", FLAT: "#1e293b", UNAVAILABLE: "#1e293b" };
const SIG_FG = { GREEN: "#4ade80", RED: "#f87171", FLAT: "#cbd5e1", UNAVAILABLE: "#94a3b8" };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function row(num, name, reading, signal, source) {
  return `<tr>
<td style="padding:9px 10px;border-bottom:1px solid #1e293b;color:#64748b">${num}</td>
<td style="padding:9px 10px;border-bottom:1px solid #1e293b">${esc(name)}</td>
<td style="padding:9px 10px;border-bottom:1px solid #1e293b">${reading}</td>
<td style="padding:9px 10px;border-bottom:1px solid #1e293b"><span style="background:${SIG_BG[signal] || "#1e293b"};color:${SIG_FG[signal] || "#94a3b8"};padding:3px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap">${esc(signal)}</span></td>
<td style="padding:9px 10px;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:12px">${esc(source || "unavailable")}</td></tr>`;
}

export function toHtml(r) {
  const c = r.checks;
  const rows = [];
  for (const n of c.us_overnight) {
    rows.push(row(1, n.label, `${esc(fmt2(n.value))} (${esc(pctS(n.pct))})`, n.signal, n.source));
  }
  const v = c.india_vix;
  rows.push(row(2, v.label, `${v.value === null || v.value === undefined ? "n/a" : esc(Number(v.value).toFixed(2))} vs threshold ${v.threshold}`, v.signal, v.source));
  const a = c.advance_decline;
  const reading = a.advances === null || a.advances === undefined ? "n/a" : `${a.advances} advances / ${a.declines} declines`;
  rows.push(row(3, a.label, esc(reading), a.signal, a.source));
  const s = c.singapore_nifty;
  rows.push(row(4, s.label, `${esc(fmt2(s.value))} (${esc(pctS(s.pct))})`, s.signal, s.source));

  const pos = r.framework ? /Positive/i.test(r.framework.classification) : r.score >= 1;
  const conf = r.framework ? /Conflicting/i.test(r.framework.classification) : r.score === 0;
  const neg = r.framework ? /Negative/i.test(r.framework.classification) : r.score < 0;
  const biasbg = conf ? "#1e293b" : pos ? "#052e16" : neg ? "#450a0a" : "#1e293b";
  const biasbd = conf ? "#334155" : pos ? "#166534" : neg ? "#991b1b" : "#334155";
  const note = r.unavailable && r.unavailable.length
    ? `<div style="margin-top:14px;padding:10px 12px;border-radius:8px;background:#1e293b;font-size:12px;color:#94a3b8">Note: ${esc(r.unavailable.join(", "))} could not be fetched from any source at scan time and is reported as unavailable rather than guessed.</div>`
    : "";
  const fwBlock = r.framework ? `
<div style="margin:12px 0 0;padding:12px 16px;border-radius:10px;background:#0f172a;border:1px solid #1e293b;font-size:12px;color:#94a3b8;line-height:1.7">
${r.framework.rationale.map((x) => `&bull; ${esc(x)}`).join("<br>")}
<div style="margin-top:6px;color:#64748b">${esc(r.framework.scope_note)}</div>
</div>` : "";
  const confirmBlock = r.confirmation ? `
<h2 style="font-size:16px;margin:22px 0 8px">Post-open confirmation</h2>
<div style="padding:12px 16px;border-radius:10px;background:#1e293b;border:1px solid #334155;font-size:13px;line-height:1.7">
${r.confirmation.open !== undefined ? `Open ${esc(fmt2(r.confirmation.open))}${r.confirmation.open_vs_prev_pct != null ? ` (${r.confirmation.open_vs_prev_pct >= 0 ? "+" : ""}${r.confirmation.open_vs_prev_pct}% vs prev close)` : ""} &middot; last ${esc(fmt2(r.confirmation.last))} (${r.confirmation.vs_open_pct >= 0 ? "+" : ""}${r.confirmation.vs_open_pct}% vs open, holding ${esc(r.confirmation.holding)})<br>` : ""}
${r.confirmation.breadth_now ? `Breadth now: ${r.confirmation.breadth_now.advances} advances / ${r.confirmation.breadth_now.declines} declines (${esc(r.confirmation.breadth_now.signal)})<br>` : ""}
${r.confirmation.vix_now != null ? `India VIX now: ${Number(r.confirmation.vix_now).toFixed(2)}<br>` : ""}
<span style="color:#94a3b8">${esc(r.confirmation.note)}</span>
</div>` : "";

  return `<!doctype html><html><head><meta charset="utf-8">
<title>Pre-market report ${r.date}</title></head>
<body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0">
<div style="max-width:860px;margin:0 auto;padding:28px 20px">
<h1 style="font-size:22px;margin:0 0 4px">Premarket report: ${r.date} (${esc(r.weekday)})</h1>
<div style="color:#94a3b8;font-size:13px">Generated ${esc(r.generated_at)} &middot; NSE opens 09:15 IST</div>
<div style="margin:18px 0;padding:14px 16px;border-radius:10px;background:${biasbg};border:1px solid ${biasbd}">
<div style="font-size:15px;font-weight:600">Opening bias: ${esc(r.bias)}</div>
<div style="font-size:12px;color:#cbd5e1;margin-top:4px">${r.framework ? esc(r.framework.opening.label) + " &middot; framework v2 (roles, not equal votes)" : "legacy equal-vote score " + (r.score >= 0 ? "+" : "") + r.score}</div></div>
${fwBlock}
<table style="width:100%;border-collapse:collapse;font-size:14px">
<tr style="color:#94a3b8;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.04em">
<th style="padding:8px 10px;border-bottom:1px solid #334155">#</th>
<th style="padding:8px 10px;border-bottom:1px solid #334155">Check</th>
<th style="padding:8px 10px;border-bottom:1px solid #334155">Reading</th>
<th style="padding:8px 10px;border-bottom:1px solid #334155">Signal</th>
<th style="padding:8px 10px;border-bottom:1px solid #334155">Source</th></tr>
${rows.join("\n")}
</table>
${r.implied_open ? `<div style="margin-top:14px;padding:12px 16px;border-radius:10px;background:#1e293b;border:1px solid #334155">
<b style="font-size:14px">Implied open (GIFT Nifty vs NIFTY prev close):
<span style="color:${r.implied_open.gap_pct >= 0 ? "#4ade80" : "#f87171"}">${r.implied_open.gap_pct >= 0 ? "+" : ""}${r.implied_open.gap_pct}%</span></b>
<div style="font-size:12px;color:#94a3b8;margin-top:4px">${esc(r.implied_open.note)}</div></div>` : ""}
${Array.isArray(r.context) && r.context.length ? `
<h2 style="font-size:16px;margin:22px 0 8px">Market context</h2>
<table style="width:100%;border-collapse:collapse;font-size:13px">
<tr style="color:#94a3b8;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.04em">
<th style="padding:6px 10px;border-bottom:1px solid #334155">Factor</th>
<th style="padding:6px 10px;border-bottom:1px solid #334155">Price</th>
<th style="padding:6px 10px;border-bottom:1px solid #334155">Change</th>
<th style="padding:6px 10px;border-bottom:1px solid #334155">Read</th></tr>
${r.context.map((x) => x.price === null
  ? `<tr><td style="padding:6px 10px;border-bottom:1px solid #1e293b">${esc(x.name)}</td><td colspan="3" style="padding:6px 10px;border-bottom:1px solid #1e293b;color:#64748b">unavailable</td></tr>`
  : `<tr><td style="padding:6px 10px;border-bottom:1px solid #1e293b">${esc(x.name)}</td>
<td style="padding:6px 10px;border-bottom:1px solid #1e293b;font-variant-numeric:tabular-nums">${esc(fmt2(x.price))}</td>
<td style="padding:6px 10px;border-bottom:1px solid #1e293b;color:${(x.key === "us10y" ? (x.bpChange || 0) : (x.pct || 0)) >= 0 ? "#4ade80" : "#f87171"};font-variant-numeric:tabular-nums">${x.key === "us10y" && x.bpChange !== null ? `${x.bpChange >= 0 ? "+" : ""}${x.bpChange} bp` : esc(pctS(x.pct))}</td>
<td style="padding:6px 10px;border-bottom:1px solid #1e293b;color:#94a3b8">${esc(x.note || x.signal)}</td></tr>`).join("\n")}
</table>` : ""}
${r.predictions && !r.predictions.error && r.predictions.next && r.predictions.next.length ? (() => {
  const P = r.predictions, E = P.ensemble;
  if (!E) return `
<h2 style="font-size:16px;margin:22px 0 8px">LSTM model prediction (NIFTY 50)</h2>
<div style="padding:12px 16px;border-radius:10px;background:#1e293b;border:1px solid #334155;font-size:13px;line-height:1.7">
Next session (${esc(P.next[0].d)}):
<b style="font-size:15px">${esc(fmt2(P.next[0].value))}</b>
<span style="color:${P.next[0].chg_pct_vs_last_close >= 0 ? "#4ade80" : "#f87171"}">(${P.next[0].chg_pct_vs_last_close >= 0 ? "+" : ""}${P.next[0].chg_pct_vs_last_close}% vs last close ${esc(fmt2(P.last_close))})</span><br>
5 session path: ${P.next.map((n) => esc(fmt2(n.value))).join(" &rarr; ")}<br>
<span style="color:#94a3b8">Rolling ${P.backtest.points}-session backtest: RMSE ${esc(fmt2(P.backtest.rmse_price))} pts (${P.backtest.rmse_scaled} scaled), direction hit-rate ${Math.round(P.backtest.hit_rate * 100)}%.
Model: ${esc(P.model.name)} (LSTM ${esc(P.model.arch)}), trained on ${esc(P.model.trained_on)}, best test MSE ${P.model.best_test_mse}.</span>
${P.range_ok ? "" : `<br><b style="color:#fbbf24">Warning: recent prices are outside the model's training range; treat this forecast as unreliable until retrained.</b>`}
</div>`;
  const nx = E.next[0], K = E.components;
  return `
<h2 style="font-size:16px;margin:22px 0 8px">Model forecast: adaptive ensemble (primary)</h2>
<div style="padding:12px 16px;border-radius:10px;background:#1e293b;border:1px solid #334155;font-size:13px;line-height:1.7">
Next session (${esc(nx.d)}): <b style="font-size:16px">${esc(fmt2(nx.value))}</b>
<span style="color:${nx.chg_pct_vs_last_close >= 0 ? "#4ade80" : "#f87171"}">(${nx.chg_pct_vs_last_close >= 0 ? "+" : ""}${nx.chg_pct_vs_last_close}% vs last close ${esc(fmt2(P.last_close))})</span><br>
${esc(E.formula)} with w = ${E.w}, LSTM bias = ${E.lstm_bias} &middot; weight learned: ${esc(E.w_source)}<br>
5 session path: ${E.next.map((n) => esc(fmt2(n.value))).join(" &rarr; ")}<br>
${E.fallback_note ? `<b style="color:#fbbf24">${esc(E.fallback_note)}</b><br>` : ""}
<span style="color:#94a3b8">Component forecasts, next session:</span>
${K.timesfm && K.timesfm[0] ? ` TimesFM 2.5 (artifact ${esc(E.tf_as_of)}): <b>${esc(fmt2(K.timesfm[0].value))}</b> (${K.timesfm[0].chg_pct_vs_last_close >= 0 ? "+" : ""}${K.timesfm[0].chg_pct_vs_last_close}%);` : ""}
${K.lstm_corrected && K.lstm_corrected[0] ? ` LSTM live, bias corrected: <b>${esc(fmt2(K.lstm_corrected[0].value))}</b> (${K.lstm_corrected[0].chg_pct_vs_last_close >= 0 ? "+" : ""}${K.lstm_corrected[0].chg_pct_vs_last_close}%);` : ""}
${K.lstm_live && K.lstm_live[0] ? ` LSTM raw: <b>${esc(fmt2(K.lstm_live[0].value))}</b> (${K.lstm_live[0].chg_pct_vs_last_close >= 0 ? "+" : ""}${K.lstm_live[0].chg_pct_vs_last_close}%).` : ""}<br>
${E.scorecard ? `<span style="color:#94a3b8">Learning loop: ${E.scorecard.n_resolved} past session${E.scorecard.n_resolved === 1 ? "" : "s"} scored against actuals${E.scorecard.w_live != null ? `: live weight w = ${E.scorecard.w_live} (bias ${E.scorecard.bias_live}, window ${esc(E.scorecard.live_window || "")})` : ": live relearning begins once 5 sessions have resolved"}.</span><br>` : ""}
<span style="color:#94a3b8">LSTM rolling ${P.backtest.points}-session backtest: RMSE ${esc(fmt2(P.backtest.rmse_price))} pts, direction hit-rate ${Math.round(P.backtest.hit_rate * 100)}%. Model: ${esc(P.model.name)}, trained on ${esc(P.model.trained_on)}.</span>
${P.range_ok ? "" : `<br><b style="color:#fbbf24">Warning: recent prices are outside the model's training range; treat this forecast as unreliable until retrained.</b>`}
</div>`;
})() : r.predictions && r.predictions.error ? `
<h2 style="font-size:16px;margin:22px 0 8px">Model forecast (NIFTY 50)</h2>
<div style="padding:10px 16px;border-radius:10px;background:#1e293b;color:#94a3b8;font-size:13px">Prediction unavailable this run: ${esc(r.predictions.error)}</div>` : ""}
${r.sources ? `<div style="margin-top:14px;font-size:13px;color:#94a3b8"><b style="color:#cbd5e1">Data freshness:</b> ${Object.entries(r.sources).map(([k, v]) => `${esc(v.label)}: ${v.state === "live" ? "live" : v.state === "cached" ? `cached, ${v.age_min} min old` : "degraded"}`).join(" &middot; ")}${r.predictions && r.predictions.input_cached ? `. Model input series cached, ${r.predictions.input_cached.age_min} min old` : ""}.</div>` : ""}
<div style="margin-top:18px;font-size:13px;color:#94a3b8;line-height:1.6">
<b style="color:#cbd5e1">How to read (decision framework):</b>
1) GIFT Nifty (NSE IX) is the primary opening indication. Gap size matters, not just colour (neutral under 0.15%, modest under 0.5%, strong at 0.5% or more).
2) Global cues (US close, live US futures, Asia) are context; they do not override domestic price discovery.
3) The NSE pre open session (09:00 to 09:15) cross confirms the opening; disagreement means conflicting signals, not a forced conclusion.
4) Advances and declines confirm the trend once trading begins. They are not a pre open predictor.
5) India VIX measures expected volatility (next 30 calendar days) against its own 1 year range. It is a risk management input, never a direction call.
GIFT Nifty (NSE IX) replaced SGX Nifty in July 2023. This classifies the opening (Question A); intraday direction (Question B) is judged from post-open price action.
</div>
${confirmBlock}
${note}
<div style="margin-top:14px;font-size:12px;color:#64748b">Investing.com and nseindia.com are
tried first as specified; if they reject the request, labelled fallbacks serve those values
(GIFT Nifty via live TradingView page crawl). Every row names the source that actually served it.</div>
</div></body></html>`;
}
