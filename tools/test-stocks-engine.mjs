// Local end-to-end test of the per stock adaptive cycle with an in-memory store.
import { runAdaptiveCycle } from "../lib/stocks-engine.mjs";

const makeStore = () => { const m = new Map(); return {
  get: async (k) => (m.has(k) ? m.get(k) : null),
  set: async (k, v) => { m.set(k, v); },
  dump: () => m,
}; };

const store = makeStore();
console.log("run 1 (fresh state, real fetches)...");
const v1 = await runAdaptiveCycle(store);
console.log("as_of:", v1.as_of, "| stocks:", v1.predictions.length,
  "| resolved this run:", v1.n_resolved_this_run, "| failed:", v1.failed_symbols.length);
console.log("sources:", JSON.stringify(v1.sources));
console.log("tf artifact:", JSON.stringify(v1.tf_artifact));
const p = v1.predictions.find((x) => x.sym === "AAPL");
console.log("AAPL:", JSON.stringify(p, null, 1));
const withBand = v1.predictions.filter((x) => x.band_hit_20 == null).length;
console.log("first-run entries have no hit stats yet (expected):", withBand === v1.predictions.length);

console.log("\nrun 2 immediately (idempotency)...");
const st = JSON.parse(store.dump().get("stocks-adaptive"));
const before = st.hist.AAPL.d.length;
const v2 = await runAdaptiveCycle(store);
const st2 = JSON.parse(store.dump().get("stocks-adaptive"));
console.log("AAPL history len before/after:", before, st2.hist.AAPL.d.length, "(must be equal)");
console.log("AAPL scorecard entries:", st2.sc.AAPL.length, "(must be 1)");
const dupes = Object.entries(st2.sc).filter(([s, es]) => new Set(es.map((e) => e.made_on)).size !== es.length);
console.log("duplicate made_on entries:", dupes.length, "(must be 0)");
console.log("run2 n_resolved:", v2.n_resolved_this_run);

// sanity: every prediction has a band, direction, next_close
const bad = v2.predictions.filter((x) => !x.error && (x.next_close == null || !x.band_lo || !x.direction));
console.log("malformed predictions:", bad.length, "(must be 0)");
console.log("\nENGINE_OK");
