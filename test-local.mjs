// Local smoke test: runs the same pipeline as scan-background (minus blobs).
// node test-local.mjs [--no-model]
import { runScan, toMarkdown } from "./lib/scan.mjs";
import { decodePackedModel, LstmForecaster } from "./lib/lstm.mjs";
import { PACKED } from "./lib/model-nifty.mjs";

let forecaster = null;
if (PACKED && !process.argv.includes("--no-model")) {
  const t0 = Date.now();
  forecaster = new LstmForecaster(decodePackedModel(PACKED));
  console.log(`model decoded in ${Date.now() - t0} ms`);
} else {
  console.log("running without LSTM model (PACKED is null or --no-model)");
}

const report = await runScan(new Date(), { forecaster });
console.log(toMarkdown(report));
console.log("\n--- raw predictions ---");
console.log(JSON.stringify(report.predictions, null, 1)?.slice(0, 2000));
