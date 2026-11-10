// Background worker: the per stock adaptive cycle.
//   1. pull the latest completed US session closes (incremental, Nasdaq API)
//   2. resolve every pending prediction against what really happened
//   3. re-learn per stock parameters (bias, band, TimesFM blend weight)
//   4. forecast the next session for every stock and record it
// Result blob: "stocks-live" (served by /api/stocks).
import { runAdaptiveCycle } from "../../lib/stocks-engine.mjs";

export default async (req) => {
  const t0 = Date.now();
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("premarket");

  // Abuse guard: public calls are throttled to one run per 30 minutes.
  // Scheduled calls (x-trigger: daily-schedule) always pass.
  const trigger = req?.headers?.get?.("x-trigger") || "manual";
  if (trigger !== "daily-schedule") {
    try {
      const last = parseInt((await store.get("last-stocks-run")) || "0", 10);
      if (Date.now() - last < 1800000) {
        const wait = Math.ceil((1800000 - (Date.now() - last)) / 60000);
        return new Response(JSON.stringify({
          status: "rate-limited", message: `A stocks cycle ran recently. Try again in about ${wait} minutes.`,
        }), { status: 429, headers: { "content-type": "application/json" } });
      }
      await store.set("last-stocks-run", String(Date.now()));
    } catch { /* blob unavailable: proceed without the guard */ }
  }
  await store.set("last-stocks-run", String(Date.now()));
  try {
    const view = await runAdaptiveCycle(store);
    view.ms = Date.now() - t0;
    await store.set("stocks-live", JSON.stringify(view));
    console.log(`stocks-adaptive: as_of ${view.as_of}, ${view.predictions.length} stocks, ${view.n_resolved_this_run} resolved, ${view.ms}ms`);
    return new Response(JSON.stringify({ ok: true, as_of: view.as_of, n: view.predictions.length, resolved: view.n_resolved_this_run, ms: view.ms }),
      { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("stocks-adaptive failed:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
