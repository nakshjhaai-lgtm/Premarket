// Self test of the scorecard learning loop using the REAL lib/ensemble.mjs code.
// Scenarios: (A) TimesFM wrong / LSTM right  -> w must fall toward 0
//            (B) TimesFM right / LSTM wrong  -> w must rise toward 1
//            (C) fewer than 5 resolved       -> no premature learning
import { updateScorecard, artifactParams } from "../lib/ensemble.mjs";

const makeStore = () => { const m = new Map(); return {
  get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => m.set(k, v) }; };

// six past weekdays; actuals trend up
const dates = ["2026-10-05","2026-10-06","2026-10-07","2026-10-08","2026-10-09","2026-10-12"];
const actual = dates.map((_, i) => 23000 + i * 25);

function run(name, lstmErrs, tfErrs, nSessions) {
  const ds = dates.slice(0, nSessions), ac = actual.slice(0, nSessions);
  const store = makeStore();
  store.set("model-scorecard", JSON.stringify({ meta: {}, entries: ds.map((d, i) => ({
    d, created_at: d, lstm: ac[i] + lstmErrs[i], tf: ac[i] + tfErrs[i],
    ens: ac[i] + (0.98 * tfErrs[i] + 0.02 * lstmErrs[i]), actual: null })) }));
  // the morning pred: fresh series now contains the actual closes for those dates
  const pred = {
    error: null, last_close: ac[ac.length - 1],
    series: ds.map((d, i) => ({ d, close: ac[i] })).concat([{ d: "2026-10-19", close: ac[ac.length - 1] }]),
    next: [{ d: "2026-10-19", value: 23150 }, { d: "2026-10-20", value: 23180 }],
    ensemble: { w: 0.98, tf_fresh: true,
      components: { timesfm: [{ value: 23200 }] }, next: [{ value: 23150 }] },
  };
  return updateScorecard(store, pred).then(async (summary) => {
    const sc = JSON.parse(await store.get("model-scorecard"));
    const p = artifactParams(sc.meta);
    console.log(`${name}
  resolved: ${summary.n_resolved} | w_live: ${summary.w_live} | bias_live: ${summary.bias_live}
  tomorrow uses: w = ${p.w} (${p.w_source})`);
  });
}

await run("A) TimesFM wrong (+/-180), LSTM right (+/-15):", [12,-18,8,22,-5,9], [180,-210,165,195,-175,150], 6);
await run("B) TimesFM right (+/-7), LSTM wrong (+/-345):", [350,-330,340,-360,330,-310], [8,-6,5,9,-7,6], 6);
await run("C) only 4 resolved sessions (below threshold):", [12,-18,8,22], [180,-210,165,195], 4);
