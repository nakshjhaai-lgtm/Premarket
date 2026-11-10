// Background worker: the daily news, earnings calendar and event flag cycle.
// Triggered by news-scan at 08:40 IST (Mon-Sat) or manually.
import { runNewsCycle } from "../../lib/news-engine.mjs";
import { STOCKS } from "../../lib/stocks-engine.mjs";

export default async (req) => {
  const t0 = Date.now();
  const trigger = req?.headers?.get?.("x-trigger") || "manual";
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("premarket");

  // Abuse guard: public calls are throttled to one run per 30 minutes.
  // Scheduled calls (x-trigger: daily-schedule) always pass.
  if (trigger !== "daily-schedule") {
    try {
      const last = parseInt((await store.get("last-news-run")) || "0", 10);
      if (Date.now() - last < 1800000) {
        const wait = Math.ceil((1800000 - (Date.now() - last)) / 60000);
        return new Response(JSON.stringify({
          status: "rate-limited", message: `A news cycle ran recently. Try again in about ${wait} minutes.`,
        }), { status: 429, headers: { "content-type": "application/json" } });
      }
      await store.set("last-news-run", String(Date.now()));
    } catch { /* blob unavailable: proceed without the guard */ }
  }
  await store.set("last-news-run", String(Date.now()));
  try {
    const view = await runNewsCycle(store, STOCKS);
    console.log(`news-background: ${view.market.length} market + ${view.india.length} india headlines, ${view.sources.symbols.n_ok}/${STOCKS.length} symbol feeds, ${view.earnings_upcoming.length} earnings, ${Date.now() - t0}ms`);
    return new Response(JSON.stringify({ ok: true, as_of: view.as_of, market: view.market.length, symbols_ok: view.sources.symbols.n_ok, earnings: view.earnings_upcoming.length, ms: Date.now() - t0 }),
      { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("news-background failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
