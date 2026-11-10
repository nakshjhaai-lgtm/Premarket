// Minimal SVG chart builders — no external libraries (bundle stays tiny,
// CSP stays strict, charts render identically in every modern browser).
// All charts take CSS-variable colours via currentColor or explicit hex from
// the Okabe-Ito palette so they survive theme switches.

const NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

const fmtNum = (v) =>
  Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
  : Math.abs(v) >= 10 ? v.toFixed(1)
  : v.toFixed(2);

/**
 * Line chart with optional second (dashed) series and point markers.
 * cfg: { height, series: [{ name, color, pts: [[xIdx, y]], dashed }],
 *        xLabels: [{at, text}], markers: [{at, color, label}],
 *        yFmt, ariaLabel, bandFrom (index where prediction region starts) }
 */
export function lineChart(cfg) {
  const W = 960, H = cfg.height || 300;
  const P = { t: 14, r: 14, b: 26, l: 58 };
  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`, width: W, height: H,
    role: "img", "aria-label": cfg.ariaLabel || "line chart",
    preserveAspectRatio: "xMidYMid meet",
  });
  el("title", {}, svg).textContent = cfg.ariaLabel || "line chart";

  const allPts = cfg.series.flatMap((s) => s.pts);
  if (!allPts.length) return svg;
  const xs = allPts.map((p) => p[0]), ys = allPts.map((p) => p[1]);
  const { lo, hi, ticks } = niceTicks(Math.min(...ys), Math.max(...ys), 5);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const sx = (x) => P.l + ((x - xmin) / (xmax - xmin || 1)) * (W - P.l - P.r);
  const sy = (y) => H - P.b - ((y - lo) / (hi - lo || 1)) * (H - P.t - P.b);

  // gridlines + y labels
  for (const t of ticks) {
    const y = sy(t);
    el("line", { x1: P.l, x2: W - P.r, y1: y, y2: y, stroke: "currentColor", "stroke-opacity": ".12", "stroke-width": 1 }, svg);
    const lab = el("text", { x: P.l - 8, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "currentColor", "fill-opacity": ".55" }, svg);
    lab.textContent = cfg.yFmt ? cfg.yFmt(t) : fmtNum(t);
  }
  // x labels
  for (const xl of cfg.xLabels || []) {
    const x = sx(xl.at);
    if (x < P.l - 5 || x > W - P.r + 5) continue;
    el("line", { x1: x, x2: x, y1: H - P.b, y2: H - P.b + 4, stroke: "currentColor", "stroke-opacity": ".3" }, svg);
    const lab = el("text", { x, y: H - P.b + 16, "text-anchor": "middle", "font-size": 11, fill: "currentColor", "fill-opacity": ".55" }, svg);
    lab.textContent = xl.text;
  }
  // prediction band shading
  if (cfg.bandFrom !== undefined && cfg.bandFrom > xmin) {
    el("rect", {
      x: sx(cfg.bandFrom), y: P.t, width: Math.max(0, sx(xmax) - sx(cfg.bandFrom)), height: H - P.t - P.b,
      fill: "currentColor", "fill-opacity": ".05",
    }, svg);
  }
  // markers (e.g. "today" line)
  for (const m of cfg.markers || []) {
    const x = sx(m.at);
    el("line", { x1: x, x2: x, y1: P.t, y2: H - P.b, stroke: m.color || "currentColor", "stroke-opacity": ".5", "stroke-width": 1, "stroke-dasharray": "3 3" }, svg);
    if (m.label) {
      const lab = el("text", { x: x + 4, y: P.t + 10, "font-size": 10, fill: m.color || "currentColor", "fill-opacity": ".8" }, svg);
      lab.textContent = m.label;
    }
  }
  // series
  for (const s of cfg.series) {
    if (!s.pts.length) continue;
    const d = s.pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
    el("path", {
      d, fill: "none", stroke: s.color, "stroke-width": s.width || 2,
      "stroke-linejoin": "round", "stroke-linecap": "round",
      "stroke-dasharray": s.dashed ? "6 4" : "",
    }, svg);
    for (const p of s.pts.filter((_, i, a) => s.markersDots && (a.length < 30 || i % 5 === 0))) {
      const c = el("circle", { cx: sx(p[0]), cy: sy(p[1]), r: 3, fill: s.color, stroke: "var(--surface)", "stroke-width": 1.5 }, svg);
      if (p[2]) el("title", {}, c).textContent = p[2];
    }
  }
  return svg;
}

/** sparkline for factor cards */
export function sparkline(values, color) {
  const W = 220, H = 34, P = 3;
  const svg = el("svg", { class: "spark", viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", focusable: "false" });
  const vs = values.filter((v) => v !== null && v !== undefined);
  if (vs.length < 2) return svg;
  const min = Math.min(...vs), max = Math.max(...vs);
  const sx = (i) => P + (i / (vs.length - 1)) * (W - 2 * P);
  const sy = (v) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);
  const d = vs.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join("");
  el("path", { d: `${d}L${sx(vs.length - 1)},${H - P}L${sx(0)},${H - P}Z`, fill: color, "fill-opacity": ".10" }, svg);
  el("path", { d, fill: "none", stroke: color, "stroke-width": 1.8, "stroke-linejoin": "round" }, svg);
  return svg;
}

/** horizontal stacked bar: advances vs declines */
export function breadthBar(adv, dec, unch, upColor, downColor) {
  const total = (adv || 0) + (dec || 0) + (unch || 0) || 1;
  const W = 260, H = 14;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img",
    "aria-label": `${adv} advancing, ${dec} declining, ${unch || 0} unchanged` });
  let x = 0;
  for (const [v, c] of [[adv, upColor], [unch, "currentColor"], [dec, downColor]]) {
    if (!v) continue;
    const w = (v / total) * W;
    el("rect", { x, y: 0, width: w, height: H, fill: c, "fill-opacity": v === unch ? .2 : .85, rx: x === 0 ? 4 : 0 }, svg);
    x += w;
  }
  return svg;
}
