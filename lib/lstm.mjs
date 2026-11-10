// Pure-JS inference for the tutorial's TF 1.6 LSTM stack.
//
// Reproduces tf.contrib.rnn.LSTMCell semantics EXACTLY (verified against the
// TF session's own reference predictions exported with the model):
//   z = concat([x, h]) · kernel + bias          kernel: [in+units, 4*units]
//   i, j, f, o = split(z, 4)                    gate order i, j, f, o
//   c' = sigmoid(f + 1.0) * c + sigmoid(i) * tanh(j)     (forget_bias added at runtime)
//   h' = sigmoid(o) * tanh(c')
// Stacked via MultiRNNCell (layer input = previous layer h), output layer h
// (150-d) goes through the FC:  pred = h·w + b,  w: [150, 1], b: [1].
//
// Sampling protocol (tutorial block 28): reset state, feed the real scaled
// series for indices [w_i-num_unrollings+1 .. w_i-2] (warm-up, 48 steps for
// num_unrollings=50), then feed the real value at w_i-1 and take the output as
// the prediction for w_i; every following step feeds its own prediction back.

const FORGET_BIAS = 1.0;

const sigmoid = (x) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
const tanh = Math.tanh;

export class LstmCell {
  constructor(kernel, bias, inDim, units) {
    // kernel: Float64Array row-major [(inDim+units) x 4*units]
    this.kernel = kernel;
    this.bias = bias;
    this.inDim = inDim;
    this.units = units;
    this.c = new Float64Array(units);
    this.h = new Float64Array(units);
  }
  reset() { this.c.fill(0); this.h.fill(0); }
  step(x, out) {
    const { kernel: K, bias: B, inDim, units } = this;
    const cols = 4 * units;
    const z = out; // length cols
    // z = x·K[0:inDim] + h·K[inDim:inDim+units] + B
    for (let j = 0; j < cols; j++) z[j] = B[j];
    for (let r = 0; r < inDim; r++) {
      const xv = x[r];
      if (xv === 0) continue;
      const off = r * cols;
      for (let j = 0; j < cols; j++) z[j] += xv * K[off + j];
    }
    const hoff = inDim * cols;
    for (let r = 0; r < units; r++) {
      const hv = this.h[r];
      if (hv === 0) continue;
      const off = hoff + r * cols;
      for (let j = 0; j < cols; j++) z[j] += hv * K[off + j];
    }
    // gates: i, j(cand), f, o
    for (let u = 0; u < units; u++) {
      const ig = sigmoid(z[u]);
      const jg = tanh(z[units + u]);
      const fg = sigmoid(z[2 * units + u] + FORGET_BIAS);
      const og = sigmoid(z[3 * units + u]);
      const cNew = fg * this.c[u] + ig * jg;
      this.c[u] = cNew;
      this.h[u] = og * tanh(cNew);
    }
    return this.h;
  }
}

export class LstmForecaster {
  // model: { meta:{num_nodes, num_unrollings, ...}, scaler:{min,max}, weights: {name: nested arrays} }
  constructor(model) {
    this.meta = model.meta;
    this.scaler = model.scaler;
    const w = model.weights;
    const findAny = (candidates) => {
      for (const suffix of candidates) {
        const k = Object.keys(w).find((n) => n === suffix || n.endsWith(suffix));
        if (k) return w[k];
      }
      throw new Error("weight not found: " + candidates.join(" | "));
    };
    const flat = (m) => Float64Array.from((Array.isArray(m) && Array.isArray(m[0])) ? m.flat() : m);
    const nodes = model.meta.num_nodes; // [200, 200, 150]
    this.cells = [];
    let inDim = 1;
    for (let li = 0; li < nodes.length; li++) {
      // real TF 1.6 export: rnn/multi_rnn_cell/cell_N/lstm_cell/{kernel,bias}
      // (some builds omit the scope/cell prefix: multi_rnn_cell/lstm_cell{_N}/...)
      const candK = [`cell_${li}/lstm_cell/kernel`, li === 0 ? "multi_rnn_cell/lstm_cell/kernel" : `lstm_cell_${li}/kernel`];
      const candB = [`cell_${li}/lstm_cell/bias`, li === 0 ? "multi_rnn_cell/lstm_cell/bias" : `lstm_cell_${li}/bias`];
      this.cells.push(new LstmCell(flat(findAny(candK)), Float64Array.from(findAny(candB)), inDim, nodes[li]));
      inDim = nodes[li];
    }
    this.w = flat(w["w"] !== undefined ? w["w"] : findAny(["/w"])); // exact "w" (output head)
    this.b = Float64Array.from(w["b"] !== undefined ? w["b"] : findAny(["/b"]));
    this.zbuf = new Float64Array(4 * nodes[nodes.length - 1] > 0 ? 4 * Math.max(...nodes) : 0);
    this.xbuf = [new Float64Array(1), new Float64Array(nodes[0]), new Float64Array(nodes[1])];
  }
  scale(mid) { return (mid - this.scaler.min) / (this.scaler.max - this.scaler.min); }
  unscale(s) { return this.scaler.min + s * (this.scaler.max - this.scaler.min); }

  reset() { for (const c of this.cells) c.reset(); }

  // feed one scaled value, return scaled prediction (FC over last layer h)
  step(xScaled) {
    this.xbuf[0][0] = xScaled;
    let inp = this.xbuf[0];
    for (let li = 0; li < this.cells.length; li++) {
      const buf = this.zbuf;
      inp = this.cells[li].step(inp, buf);
      if (li + 1 < this.cells.length) { this.xbuf[li + 1].set(inp); inp = this.xbuf[li + 1]; }
    }
    let pred = this.b[0];
    for (let u = 0; u < inp.length; u++) pred += inp[u] * this.w[u];
    return pred;
  }

  // Tutorial protocol: warm-start on real values, then feedback predictions.
  // series: full scaled array; w_i: index to predict; steps: how many feedback preds.
  predictFrom(series, w_i, steps) {
    const nu = this.meta.num_unrollings;
    this.reset();
    const warmStart = Math.max(0, w_i - nu + 1);
    for (let t = warmStart; t <= w_i - 2; t++) this.step(series[t]);
    const preds = [];
    let p = this.step(series[w_i - 1]); // predicts w_i
    preds.push(p);
    for (let s = 1; s < steps; s++) { p = this.step(p); preds.push(p); }
    return preds;
  }

  // one-step-ahead rolling backtest over the last `points` indices
  backtest(series, points) {
    const rows = [];
    const from = Math.max(this.meta.num_unrollings + 1, series.length - points);
    for (let w = from; w < series.length; w++) {
      const pred = this.predictFrom(series, w, 1)[0];
      rows.push({ idx: w, pred, actual: series[w] });
    }
    return rows;
  }
}

// decode the compact base64 float32 weight blob produced by tools/pack_model.py
export function decodePackedModel(packed) {
  const buf = Buffer.from(packed.weights_b64, "base64");
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const weights = {};
  let off = 0;
  for (const part of packed.layout) {
    const n = part.shape.reduce((a, b) => a * b, 1);
    const slice = Array.from(f32.subarray(off, off + n)).map((v, i) => v);
    if (part.shape.length === 2) {
      const [r, c] = part.shape;
      const m = [];
      for (let i = 0; i < r; i++) m.push(slice.slice(i * c, (i + 1) * c));
      weights[part.name] = m;
    } else {
      weights[part.name] = slice;
    }
    off += n;
  }
  return { meta: packed.meta, scaler: packed.scaler, weights };
}
