// Validate the JS inference engine against the TF session's own reference
// predictions (exported with each model by train_export.py).
//   node tools/validate-lstm.mjs <model.json>
import { readFileSync } from "node:fs";
import { LstmForecaster } from "../lib/lstm.mjs";

const model = JSON.parse(readFileSync(process.argv[2], "utf8"));
const fc = new LstmForecaster(model);
const { w_i, warm_inputs, preds } = model.ref;

// same protocol as the TF epilogue: series = warm_inputs, predict from index = len
const series = warm_inputs;
const jsPreds = fc.predictFrom(series, series.length, preds.length);

let maxAbs = 0;
console.log(`model: ${model.meta.name} | w_i=${w_i} | warm=${series.length} steps`);
for (let i = 0; i < preds.length; i++) {
  const d = Math.abs(jsPreds[i] - preds[i]);
  maxAbs = Math.max(maxAbs, d);
  console.log(
    `  step ${i}: tf=${preds[i].toFixed(6)}  js=${jsPreds[i].toFixed(6)}  |d|=${d.toExponential(2)}`
  );
}
// price-space error too
const priceErr = maxAbs * (model.scaler.max - model.scaler.min);
console.log(`max |TF-JS| (scaled): ${maxAbs.toExponential(3)}  ≈ ${priceErr.toFixed(4)} price units`);
console.log(maxAbs < 5e-3 ? "PASS" : "FAIL");
process.exit(maxAbs < 5e-3 ? 0 : 1);
