// Dashboard behaviour: theme, deep links, report rendering, charts, states.
import { lineChart, sparkline, breadthBar } from "./charts.js";
import { LINKABLE } from "./glossary-terms.mjs";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const C = { // Okabe-Ito, fixed hex so SVG colours never depend on theme
  blue: "#0072b2", vermillion: "#d55e00", green: "#009e73",
  amber: "#e69f00", sky: "#56b4e9", pink: "#cc79a7",
};

const fmt = (n, d = 2) =>
  n === null || n === undefined ? "n/a"
  : Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtSigned = (p) => (p === null || p === undefined ? "n/a" : `${p >= 0 ? "+" : ""}${Number(p).toFixed(2)}%`);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------------- inline glossary links ---------------- */
// First mention of a known term in each panel becomes a link to the glossary,
// so no reader has to guess what a word means. Links skip existing anchors.
const TERM_RE = new RegExp(
  "\\b(" + LINKABLE.map(([t]) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|") + ")\\b",
  "g"
);
const TERM_ID = Object.fromEntries(LINKABLE);
function linkGlossaryTerms(host) {
  if (!host) return;
  const seen = new Set();
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const t = n.parentElement?.tagName;
      if (t === "A" || t === "CODE" || t === "MARK" || t === "SCRIPT" || t === "STYLE" || t === "BUTTON") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const txt = node.nodeValue;
    if (!txt || txt.trim().length < 3) continue;
    TERM_RE.lastIndex = 0;
    let m, last = 0, frag = null;
    while ((m = TERM_RE.exec(txt))) {
      const id = TERM_ID[m[1]];
      if (!id || seen.has(id)) continue;
      if (!frag) frag = document.createDocumentFragment();
      frag.append(txt.slice(last, m.index));
      const a = document.createElement("a");
      a.href = "/glossary.html#" + id;
      a.className = "term";
      a.textContent = m[1];
      frag.append(a);
      last = m.index + m[1].length;
      seen.add(id);
    }
    if (frag) { frag.append(txt.slice(last)); node.replaceWith(frag); }
  }
}

/* ---------------- data freshness strip ---------------- */
function renderFreshness(r) {
  const host = $("#freshness");
  if (!host) return;
  const src = r.sources || null;
  const parts = Object.values(src || {});
  if (!parts.length) { host.innerHTML = ""; host.hidden = true; return; }
  host.hidden = false;
  const chip = (label, state, age) => {
    const cls = state === "live" ? "up" : state === "cached" ? "warn" : "down";
    const txt = state === "live" ? "live" : state === "cached" ? `cached ${age} min` : "degraded";
    return `<span class="src-chip ${cls}">${esc(label)}: ${txt}</span>`;
  };
  host.innerHTML = `<span class="src" style="margin-right:6px">Data freshness</span>` +
    parts.map((v) => chip(v.label, v.state, v.age_min)).join("") +
    (r.predictions?.input_cached ? chip("model input", "cached", r.predictions.input_cached.age_min) : "");
}

/* ---------------- theme ---------------- */
function applyTheme(t) {
  if (t) document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = resolvedTheme() === "dark" ? "#12161b" : "#f5f6f8";
}
function resolvedTheme() {
  const stored = localStorage.getItem("pm-theme");
  if (stored) return stored;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function initTheme() {
  applyTheme(localStorage.getItem("pm-theme"));
  $("#theme-toggle")?.addEventListener("click", () => {
    const next = resolvedTheme() === "dark" ? "light" : "dark";
    localStorage.setItem("pm-theme", next);
    applyTheme(next);
  });
}

/* ---------------- chrome: header shadow, progress, to-top, mobile nav ---------------- */
function initChrome() {
  const header = $(".site-header");
  const progress = $("#progress");
  const toTop = $("#to-top");
  const onScroll = () => {
    const y = scrollY;
    header?.classList.toggle("scrolled", y > 4);
    const h = document.documentElement.scrollHeight - innerHeight;
    if (progress) progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    toTop?.classList.toggle("show", y > 600);
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  toTop?.addEventListener("click", () => scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  // mobile nav disclosure (the dashboard ships app.js instead of chrome.js,
  // so this lives here too)
  const navToggle = $(".nav-toggle");
  navToggle?.addEventListener("click", () => {
    const nav = $(".site-nav");
    navToggle.setAttribute("aria-expanded", String(nav.classList.toggle("open")));
  });
}


/* ---------------- news, earnings and event flags ---------------- */
async function renderNews() {
  const host = $("#news-panel"), status = $("#news-status");
  if (!host) return;
  let d = null;
  try { const r = await fetch("/api/news", { cache: "no-store" }); if (r.ok) d = await r.json(); } catch { /* offline */ }
  if (!d || !d.market) {
    status.textContent = "Headlines: no cycle has run yet (it runs daily at 08:40 IST).";
    host.innerHTML = "";
    return;
  }
  const src = Object.values(d.sources || {});
  const degraded = src.some((x) => x.state === "degraded");
  status.textContent = `As of ${d.as_of}${degraded ? " · some sources degraded" : ""} · the forecast models do not read these; this panel is for you`;
  const chip = (t) => `<span class="chip flat">${esc(t)}</span>`;
  const line = (x) => `<li><a href="${esc(x.u || "#")}" rel="noopener noreferrer" target="_blank">${esc(x.t)}</a>${x.tags?.length ? " " + x.tags.map(chip).join(" ") : ""}</li>`;
  const earn = (d.earnings_upcoming || []).slice(0, 6).map((e) =>
    `<span class="chip warn">${esc(e.sym)} reports ${esc(e.date)}${e.eps ? `, est ${esc(e.eps)}` : ""}</span>`).join(" ");
  const heavy = Object.entries(d.per_symbol || {})
    .filter(([sym, v]) => v.heavy).slice(0, 8)
    .map(([sym, v]) => `<span class="chip down">${esc(sym)}: heavy news (${v.n} headlines${v.tags?.length ? ", " + esc(v.tags.join(", ")) : ""})</span>`).join(" ");
  host.innerHTML = `
    ${earn ? `<h3>Earnings this week among the 50 tracked stocks</h3><div style="display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 16px">${earn}</div>` : ""}
    ${heavy ? `<h3>Unusually heavy news today</h3><div style="display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 16px">${heavy}</div>` : ""}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:20px">
      <div><h3>United States markets</h3><ul class="news-list">${(d.market || []).slice(0, 6).map(line).join("") || "<li>No headlines loaded.</li>"}</ul></div>
      <div><h3>India markets</h3><ul class="news-list">${(d.india || []).slice(0, 4).map(line).join("") || "<li>No headlines loaded.</li>"}</ul></div>
    </div>
    <p class="note-line">${esc(d.note || "")}</p>`;
}
renderNews();

/* ---------------- plain words summary ---------------- */
function plainWords(r) {
  const host = $("#plain-words");
  if (!host) return;
  const cls = r.framework ? r.framework.classification : null;
  let reading;
  if (!cls) reading = "The framework has no read today.";
  else if (/^Neutral/i.test(cls)) reading = "no strong lean either way at today's open";
  else if (/^Conflicting/i.test(cls)) reading = "the signals disagree today, so no directional call";
  else if (/unknown/i.test(cls)) reading = "today's open is unreadable because GIFT Nifty is unavailable";
  else if (/^Positive/i.test(cls)) reading = `a ${/large/i.test(cls) ? "strongly higher" : "slightly higher"} open looks likely`;
  else if (/^Negative/i.test(cls)) reading = `a ${/large/i.test(cls) ? "strongly lower" : "slightly lower"} open looks likely`;
  else reading = cls;
  const ens = r.predictions?.ensemble;
  const n0 = ens?.next?.[0];
  const model = n0
    ? ` The forecast model puts NIFTY at ${fmt(n0.value)} next session (${n0.chg_pct_vs_last_close >= 0 ? "+" : ""}${n0.chg_pct_vs_last_close}% versus the last close).`
    : "";
  host.innerHTML = `<strong>In plain words:</strong> ${esc(reading)}.${model} <a href="/eli5.html">Explain like I am 5</a>`;
  host.hidden = false;
}

/* ---------------- status + skeletons ---------------- */
let statusTimer = null;
function setStatus(msg) {
  const s = $("#status");
  if (!s) return;
  s.textContent = msg || "";
}
function showSkeleton() {
  // fills ONLY the dedicated loader strip; the section hosts must survive,
  // the renderers write into them (an earlier version replaced the whole
  // report area and dead-ended the page if any renderer threw).
  const loader = $("#loader");
  if (!loader) return;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    loader.innerHTML = `
      <div class="skeleton" style="height:64px;margin-bottom:16px"></div>
      <div class="skeleton" style="height:220px;margin-bottom:16px"></div>
      <div class="skeleton" style="height:120px"></div>`;
  }, 180);
}
function clearSkeleton() {
  clearTimeout(statusTimer);
  const loader = $("#loader");
  if (loader) loader.innerHTML = "";
}
function hideSkeletonTimer() { clearTimeout(statusTimer); }

/* ---------------- fetch helpers ---------------- */
async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, body };
}

/* ---------------- rendering: bias + checks ---------------- */
function chipFor(signal) {
  const map = {
    GREEN: ["up", "Green"], RED: ["down", "Red"], FLAT: ["flat", "Flat"],
    UNAVAILABLE: ["na", "Unavailable"],
    "BULLISH breadth": ["up", "Bullish"], "BEARISH breadth": ["down", "Bearish"],
    "NEUTRAL breadth": ["flat", "Neutral"],
    "LOW volatility expected": ["up", "Low volatility"], "HIGH volatility expected": ["warn", "High volatility"],
    UP: ["up", "Up"], DOWN: ["down", "Down"],
  };
  const [cls, label] = map[signal] || ["flat", signal];
  return `<span class="chip ${cls}">${esc(label)}</span>`;
}

function renderFramework(r) {
  const host = $("#bias");
  const fw = r.framework;
  if (!fw) {
    host.innerHTML = `<div class="bias mix"><div style="flex:1 1 320px">
      <div class="headline">${esc(r.bias)}</div>
      <div class="sub">legacy equal-vote report (score ${r.score >= 0 ? "+" : ""}${r.score})</div></div></div>`;
    return;
  }
  const cls = fw.classification;
  const kind = /Conflicting/i.test(cls) ? "mix" : /Positive/i.test(cls) ? "pos" : /Negative/i.test(cls) ? "neg" : "mix";
  // framework track record: has the opening bias call matched the actual open?
  const fsc = r.framework_scorecard;
  const trackChip = fsc && fsc.n
    ? `<span class="chip ${fsc.hit_rate_20 != null && fsc.hit_rate_20 >= 50 ? "up" : "warn"}" title="Opening bias calls vs what the market actually did at the open">Track record: ${fsc.hit_rate_20 != null ? `${fsc.hit_rate_20}% of last ${Math.min(20, fsc.n)}` : `${fsc.hit_rate}% of ${fsc.n}`}</span>`
    : `<span class="chip" title="Each day's opening bias call is checked against the actual open and the hit rate is tracked here">Track record: learning starts with the next open</span>`;
  const stanceChip = (st) =>
    st === "supportive" ? `<span class="chip up">Supportive</span>`
    : st === "opposing" ? `<span class="chip down">Opposing</span>`
    : st === "mixed" ? `<span class="chip warn">Mixed</span>`
    : st === "neutral" ? `<span class="chip flat">Neutral</span>`
    : `<span class="chip na">No read</span>`;
  const riskChipCls = { low: "up", moderate: "flat", elevated: "warn", high: "down" }[fw.risk.level] || "na";

  const im = fw.opening.implied;
  const g = fw.global;
  const preOpenCell = fw.pre_open?.available
    ? `${esc(fmt(fw.pre_open.price))} indicative (${esc(fw.pre_open.direction)})`
    : `unavailable: ${esc(fw.pre_open?.reason || "NSE pre open feed unreachable")}`;
  const preOpenVerdict = fw.pre_open_verdict === "confirms" ? `<span class="chip up">Confirms</span>`
    : fw.pre_open_verdict === "conflicts" ? `<span class="chip down">Conflicts</span>`
    : fw.pre_open_verdict === "neutral" ? `<span class="chip flat">Neutral</span>`
    : `<span class="chip na">n/a</span>`;

  const gapCell = im
    ? `<b class="num" style="font-size:16px;color:${im.gap_pct >= 0 ? "var(--up)" : "var(--down)"}">${fmtSigned(im.gap_pct)}</b>
       <span class="src">GIFT ${fmt(im.gift)} vs NIFTY prev close ${fmt(im.nifty_prev_close)} · ${esc(fw.opening.label)}</span>`
    : `<span class="src">GIFT Nifty unavailable</span>`;

  const globalCell = g.groups.map((x) =>
    `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="min-width:170px">${esc(x.name)}</span>
      <span class="num">${x.value === null ? "n/a" : fmtSigned(+x.value.toFixed(2))}</span>
      ${stanceChip(x.stance)}</div>`).join("");

  const riskCell = fw.risk.level === "unknown" || fw.risk.level === "unclassified"
    ? esc(fw.risk.note)
    : `<span class="chip ${riskChipCls}">${esc(fw.risk.level)} volatility</span>
       <span class="src">${esc(fw.risk.note)}</span>`;

  const confBlock = r.confirmation ? `
  <h3 style="margin-top:24px">Post open confirmation, captured ${esc(r.confirmation.captured_at || "")}</h3>
  <table class="data"><tbody>
  ${r.confirmation.open !== undefined ? `<tr><td>Open (regular session)</td><td class="reading">${fmt(r.confirmation.open)}
    ${r.confirmation.open_vs_prev_pct != null ? ` <span class="src">(${fmtSigned(r.confirmation.open_vs_prev_pct)} vs prev close)</span>` : ""}</td>
    <td rowspan="3" style="vertical-align:top">${r.confirmation.holding === "above open" ? `<span class="chip up">Holding above open</span>` : r.confirmation.holding === "below open" ? `<span class="chip down">Holding below open</span>` : `<span class="chip flat">Near open</span>`}
    <div class="src" style="margin-top:8px;max-width:34ch">${esc(r.confirmation.note || "")}</div></td></tr>
  <tr><td>Last (snapshot)</td><td class="reading">${fmt(r.confirmation.last)} <span class="src">(${fmtSigned(r.confirmation.vs_open_pct)} vs open)</span></td></tr>
  <tr><td>Breadth / VIX now</td><td class="reading">${r.confirmation.breadth_now ? `${r.confirmation.breadth_now.advances}▲ / ${r.confirmation.breadth_now.declines}▼` : "n/a"}
    ${r.confirmation.vix_now != null ? ` · VIX ${Number(r.confirmation.vix_now).toFixed(2)}` : ""}</td></tr>` : ""}
  </tbody></table>` : "";

  host.innerHTML = `
  <div class="bias ${kind}">
    <div style="flex:1 1 420px">
      <div class="headline">Opening bias: ${esc(cls)}</div>
      <div class="sub">${esc(r.date)} (${esc(r.weekday)}) · generated ${esc(r.generated_at)} · framework v2: indicator roles, not equal votes</div>
      <div style="margin-top:8px">${trackChip}</div>
    </div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="table-scroll"><table class="data">
      <thead><tr><th scope="col" style="width:36px">Step</th><th scope="col">Input</th><th scope="col">Reading</th><th scope="col">Verdict</th></tr></thead>
      <tbody>
        <tr><td class="num">1</td><td>GIFT Nifty: primary opening indication</td><td>${gapCell}</td>
          <td>${im ? (fw.opening.direction === "positive" ? `<span class="chip up">Positive</span>` : fw.opening.direction === "negative" ? `<span class="chip down">Negative</span>` : `<span class="chip flat">Neutral</span>`) : `<span class="chip na">n/a</span>`}</td></tr>
        <tr><td class="num">2</td><td>Global cues: context, never an override</td><td>${globalCell}</td><td>${stanceChip(g.classification)}</td></tr>
        <tr><td class="num">3</td><td>NSE pre open (09:00 to 09:15): domestic confirmation</td><td>${preOpenCell}</td><td>${preOpenVerdict}</td></tr>
        <tr><td class="num">4</td><td>Breadth: trend confirmation after the open</td><td><span class="src">See indicator table: advances vs declines at the last close. Its job starts once trading begins.</span></td><td><span class="chip flat">Deferred</span></td></tr>
        <tr><td class="num">5</td><td>India VIX: risk assessment, never direction</td><td>${riskCell}</td><td><span class="chip ${riskChipCls}">${esc(fw.risk.level)}</span></td></tr>
      </tbody>
    </table></div>
    <p class="src" style="margin-top:12px">${esc(fw.scope_note)}</p>
    ${confBlock}
  </div>`;
}

function renderChecks(r) {
  const c = r.checks;
  const rows = [];
  for (const n of c.us_overnight) {
    rows.push(`<tr><td class="num">1</td><td>${esc(n.label)}<div class="src">global context, previous session</div></td>
      <td class="reading">${fmt(n.value)} <span class="src">(${fmtSigned(n.pct)})</span></td>
      <td>${chipFor(n.signal)}</td><td class="src">${esc(n.source || "unavailable")}</td></tr>`);
  }
  const v = c.india_vix;
  rows.push(`<tr><td class="num">2</td><td>${esc(v.label)}<div class="src">${esc(v.role || "risk assessment, not a direction call")}</div></td>
    <td class="reading">${v.value == null ? "n/a" : Number(v.value).toFixed(2)}${v.percentile_1y != null ? ` <span class="src">(${v.percentile_1y}th pct of 1y)</span>` : ""}</td>
    <td>${chipFor(v.signal)}</td><td class="src">${esc(v.source || "unavailable")}</td></tr>`);
  const a = c.advance_decline;
  const adCell = a.advances == null ? "n/a" :
    `<div>${a.advances} advances / ${a.declines} declines${a.unchanged ? ` / ${a.unchanged} unchanged` : ""}</div>
     ${breadthBar(a.advances, a.declines, a.unchanged, C.green, C.vermillion).outerHTML}`;
  rows.push(`<tr><td class="num">3</td><td>${esc(a.label)}<div class="src">${esc(a.role || "trend confirmation once trading begins")}</div></td>
    <td class="reading">${adCell}</td><td>${chipFor(a.signal)}</td><td class="src">${esc(a.source || "unavailable")}</td></tr>`);
  const s = c.singapore_nifty;
  rows.push(`<tr><td class="num">4</td><td>${esc(s.label)}${s.contract ? `<div class="src">${esc(s.contract)}</div>` : ""}<div class="src">${esc(s.role || "primary opening indication")}</div></td>
    <td class="reading">${fmt(s.value)} <span class="src">(${fmtSigned(s.pct)})</span></td>
    <td>${chipFor(s.signal)}</td><td class="src">${esc(s.source || "unavailable")}</td></tr>`);
  if (r.framework?.pre_open?.available) {
    const po = r.framework.pre_open;
    rows.push(`<tr><td class="num">5</td><td>NSE pre open session<div class="src">domestic confirmation (09:00 to 09:15)</div></td>
      <td class="reading">${fmt(po.price)} <span class="src">(${po.direction})</span></td>
      <td>${chipFor(po.direction === "positive" ? "GREEN" : po.direction === "negative" ? "RED" : "FLAT")}</td><td class="src">${esc(po.source || "nseindia.com")}</td></tr>`);
  }

  const implied = r.implied_open ? `
    <div class="metrics" style="margin-top:16px">
      <div class="metric"><div class="k">Implied open gap</div>
        <div class="v" style="color:${r.implied_open.gap_pct >= 0 ? "var(--up)" : "var(--down)"}">${fmtSigned(r.implied_open.gap_pct)}</div>
        <div class="d">GIFT Nifty ${fmt(r.implied_open.gift)} vs NIFTY prev close ${fmt(r.implied_open.nifty_prev_close)}</div></div>
      <div class="metric" style="max-width:46ch"><div class="k">&nbsp;</div><div class="d">${esc(r.implied_open.note)}</div></div>
    </div>` : "";

  $("#checks").innerHTML = `
    <div class="table-scroll"><table class="data">
      <thead><tr><th scope="col">#</th><th scope="col">Indicator</th><th scope="col">Reading</th><th scope="col">Signal</th><th scope="col">Source</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table></div>
    ${implied}
    ${r.unavailable?.length ? `<p class="src" style="margin-top:12px">Unavailable this run: ${esc(r.unavailable.join(", "))}. Unavailable inputs are reported as gaps, never guessed.</p>` : ""}`;
}

/* ---------------- rendering: market context ---------------- */
function renderContext(r) {
  const host = $("#context");
  if (!r.context?.length) { host.innerHTML = `<div class="empty-state">Context data unavailable this run.</div>`; return; }
  host.innerHTML = `<div class="grid-context">${r.context.map((x) => {
    if (x.price == null) {
      return `<div class="factor"><div class="top"><span class="name">${esc(x.name)}</span><span class="group">${esc(x.group)}</span></div>
        <div class="val">n/a</div><div class="note src">unavailable</div></div>`;
    }
    const chgCls = x.pct > 0 ? "up" : x.pct < 0 ? "down" : "flat";
    const chg = x.key === "us10y" && x.bpChange != null
      ? `${x.bpChange >= 0 ? "+" : ""}${x.bpChange} bp`
      : fmtSigned(x.pct);
    const dec = x.key === "usdinr" || x.key === "us10y" ? (x.key === "us10y" ? 2 : 4) : 2;
    const color = x.pct > 0 ? C.green : x.pct < 0 ? C.vermillion : C.blue;
    const spark = x.spark?.length >= 2 ? sparkline(x.spark, color).outerHTML : "";
    return `<div class="factor">
      <div class="top"><span class="name">${esc(x.name)}</span><span class="group">${esc(x.group)}</span></div>
      <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
        <span class="val">${fmt(x.price, dec)}${x.unit === "%" ? "%" : ""}</span>
        <span class="chg ${chgCls}">${chg}</span>
      </div>
      ${spark}
      ${x.note ? `<div class="note">${esc(x.note)}</div>` : ""}
    </div>`;
  }).join("")}</div>`;
}

/* ---------------- rendering: LSTM prediction ---------------- */
function renderEnsemblePrediction(host, p) {
  const e = p.ensemble;
  const hist = p.series || [];
  const n = hist.length;
  const H = e.next.length;

  // chart: history + LSTM backtest + all three forward paths
  const xLabels = [];
  for (let i = 0; i < n + H; i += Math.max(1, Math.floor((n + H) / 7))) {
    const d = i < n ? hist[i]?.d : e.next[i - n]?.d;
    if (d) xLabels.push({ at: i, text: new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }) });
  }
  const series = [
    { name: "NIFTY close", color: C.blue, pts: hist.map((h, i) => [i, h.close, `${h.d}: ${fmt(h.close)}`]), markersDots: false },
  ];
  const bt = p.backtest?.rows || [];
  if (bt.length) {
    const startIdx = n - bt.length;
    series.push({ name: "LSTM one session ahead backtest", color: C.vermillion, markersDots: true, width: 0,
      pts: bt.map((b, i) => [startIdx + i, b.pred_mid, `${b.d}: predicted ${fmt(b.pred_mid)}, actual mid ${fmt(b.actual_mid)}`]) });
  }
  const anchor0 = [n - 1, hist[n - 1]?.close ?? p.last_close, `last session: ${fmt(p.last_close)}`];
  series.push({ name: `ensemble forecast (w=${e.w})`, color: C.amber, dashed: true, markersDots: true,
    pts: [anchor0, ...e.next.map((x, i) => [n + i, x.value, `${x.d}: ${fmt(x.value)} (${fmtSigned(x.chg_pct_vs_last_close)} vs last close)`])] });
  if (e.components.timesfm?.length) {
    series.push({ name: "TimesFM 2.5 path", color: C.sky, dashed: true, width: 1,
      pts: [anchor0, ...e.components.timesfm.map((x, i) => [n + i, x.value, `${x.d || e.next[i]?.d || ""}: TimesFM ${fmt(x.value)}`])] });
  }
  if (e.components.lstm_live?.length) {
    series.push({ name: "LSTM raw path", color: C.vermillion, dashed: true, width: 1,
      pts: [anchor0, ...e.components.lstm_live.map((x, i) => [n + i, x.value, `${x.d}: LSTM ${fmt(x.value)}`])] });
  }
  const svg = lineChart({
    height: 320, series, xLabels, bandFrom: n - 0.5,
    markers: [{ at: n - 0.5, color: C.sky, label: "last session" }],
    ariaLabel: `NIFTY 50 closes with the adaptive ensemble forecast path, its TimesFM and LSTM components, and the LSTM one session ahead backtest`,
  });

  const nx = e.next[0];
  const K = e.components;
  const sc = e.scorecard;
  const legend = series.map((x) => `<span><span class="swatch" style="background:${x.color}"></span>${esc(x.name)}</span>`).join("");
  const tfBt = e.backtest?.timesfm;

  host.innerHTML = `
    ${e.fallback_note ? `<div class="empty-state" style="border-style:solid;border-color:var(--warn);color:var(--warn);text-align:left;padding:12px 16px;margin-bottom:16px">${esc(e.fallback_note)}</div>` : ""}
    ${!p.range_ok ? `<div class="empty-state" style="border-style:solid;border-color:var(--warn);color:var(--warn);text-align:left;padding:12px 16px;margin-bottom:16px">Recent prices sit outside the LSTM's training range; its component is flagged unreliable.</div>` : ""}
    <div class="metrics">
      <div class="metric"><div class="k">Next session (${esc(nx?.d || "")}), ensemble</div>
        <div class="v">${fmt(nx?.value)}</div>
        <div class="d" style="color:${nx && nx.chg_pct_vs_last_close >= 0 ? "var(--up)" : "var(--down)"}">${fmtSigned(nx?.chg_pct_vs_last_close)} vs last close ${fmt(p.last_close)}</div></div>
      <div class="metric"><div class="k">Blend weight w</div>
        <div class="v">${e.w}</div>
        <div class="d">${esc(e.formula)}, bias ${e.lstm_bias}</div></div>
      <div class="metric"><div class="k">Best component backtest</div>
        <div class="v">${fmt(tfBt?.rmse, 1)}<span style="font-size:13px;color:var(--text-muted)"> pts</span></div>
        <div class="d">TimesFM, ${tfBt?.points || "?"} sessions, hit ${Math.round((tfBt?.hit_rate || 0) * 100)}%</div></div>
      <div class="metric"><div class="k">Learning scorecard</div>
        <div class="v">${sc ? sc.n_resolved : "0"}</div>
        <div class="d">${sc ? (sc.w_live != null ? `live w = ${sc.w_live} (bias ${sc.bias_live})` : "resolving; live relearning starts at 5") : "sessions scored"}</div></div>
    </div>
    <div class="chart-wrap">${svg}</div>
    <div class="chart-legend">${legend}</div>
    <h3>Forecast paths by component</h3>
    <div class="table-scroll"><table class="data"><thead><tr>
      <th scope="col">Session</th><th scope="col">Ensemble (primary)</th><th scope="col">TimesFM 2.5</th>
      <th scope="col">LSTM corrected</th><th scope="col">LSTM raw</th></tr></thead>
    <tbody>${e.next.map((x, i) => {
      const tfx = K.timesfm?.[i], lc = K.lstm_corrected?.[i], lv = K.lstm_live?.[i];
      const cell = (o) => o ? `${fmt(o.value)} <span class="src">(${fmtSigned(o.chg_pct_vs_last_close)})</span>` : "n/a";
      return `<tr><td>${esc(x.d)}</td>
        <td class="reading"><b>${fmt(x.value)}</b> <span class="src">(${fmtSigned(x.chg_pct_vs_last_close)})</span></td>
        <td class="reading">${cell(tfx)}</td><td class="reading">${cell(lc)}</td><td class="reading">${cell(lv)}</td></tr>`;
    }).join("")}</tbody></table></div>
    <h3>How this forecast learns</h3>
    <p>The weight <b>w = ${e.w}</b> and the LSTM bias <b>${e.lstm_bias}</b> were learned on ${esc(e.w_source)}.
    Every morning the scan also records its prediction in a scorecard; once the session prints, the error is scored and
    ${(sc && sc.w_live != null) ? `the weight has been relearned live (currently w = ${sc.w_live}, bias ${sc.bias_live}, window ${esc(sc.live_window || "")})` : "the weight is relearned live once 5 sessions have resolved"}.<p>
    ${sc?.recent?.length ? `<div class="table-scroll"><table class="data"><thead><tr>
      <th scope="col">Session</th><th scope="col">Actual close</th><th scope="col">LSTM err</th><th scope="col">TimesFM err</th><th scope="col">Ensemble err</th></tr></thead>
      <tbody>${sc.recent.map((x) => `<tr><td>${esc(x.d)}</td><td class="reading">${fmt(x.actual)}</td>
        <td class="reading" style="color:var(--text-muted)">${x.err_lstm == null ? "n/a" : fmtSigned(x.err_lstm)}</td>
        <td class="reading" style="color:var(--text-muted)">${x.err_tf == null ? "n/a" : fmtSigned(x.err_tf)}</td>
        <td class="reading" style="color:var(--text-muted)">${x.err_ens == null ? "n/a" : fmtSigned(x.err_ens)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <p class="src">TimesFM (Google, 200M parameters, zero shot) supplies the level; the live LSTM (tutorial pipeline, in function inference) supplies a small corrective tilt.
    Component forecasts beyond one or two sessions widen in error quickly. Treat them as directional context, not targets. Not investment advice.</p>`;
}

function renderPrediction(r) {
  const host = $("#prediction");
  const p = r.predictions;
  if (!p) { host.closest("section").hidden = true; return; }
  host.closest("section").hidden = false;
  if (p.error) {
    host.innerHTML = `<div class="error-state">Prediction unavailable this run: ${esc(p.error)}</div>`;
    return;
  }
  if (p.ensemble) { renderEnsemblePrediction(host, p); return; }

  // chart: last 120 closes + backtest preds + forward path
  const hist = p.series || [];
  const n = hist.length;
  const xLabels = [];
  for (let i = 0; i < n + p.next.length; i += Math.max(1, Math.floor((n + p.next.length) / 7))) {
    const d = i < n ? hist[i]?.d : p.next[i - n]?.d;
    if (d) xLabels.push({ at: i, text: new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }) });
  }
  const series = [
    { name: "NIFTY close", color: C.blue, pts: hist.map((h, i) => [i, h.close, `${h.d}: ${fmt(h.close)}`]), markersDots: false },
  ];
  // backtest rows align to the last `points` historical sessions
  const bt = p.backtest?.rows || [];
  if (bt.length) {
    const startIdx = n - bt.length;
    series.push({
      name: "model prediction (1-session ahead)", color: C.vermillion, markersDots: true, dashed: false, width: 0,
      pts: bt.map((b, i) => [startIdx + i, b.pred_mid, `${b.d}: predicted ${fmt(b.pred_mid)}, actual mid ${fmt(b.actual_mid)}`]),
    });
  }
  if (p.next?.length) {
    const anchor = n - 1;
    series.push({
      name: "forecast path (fed back)", color: C.amber, dashed: true, markersDots: true,
      pts: [[anchor, hist[anchor]?.close ?? p.last_close], ...p.next.map((x, i) => [n + i, x.value, `${x.d}: ${fmt(x.value)} (${fmtSigned(x.chg_pct_vs_last_close)} vs last close)`])],
    });
  }
  const svg = lineChart({
    height: 320, series, xLabels, bandFrom: n - 0.5,
    markers: [{ at: n - 0.5, color: C.sky, label: "last session" }],
    ariaLabel: `NIFTY 50 closing prices for the last ${n} sessions with the LSTM model's one session ahead backtest predictions and a ${p.next?.length || 0} session forecast path`,
  });

  const nx = p.next?.[0];
  const legend = series.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${esc(s.name)}</span>`).join("");

  host.innerHTML = `
    ${!p.range_ok ? `<div class="empty-state" style="border-style:solid;border-color:var(--warn);color:var(--warn);text-align:left;padding:12px 16px;margin-bottom:16px">
      Recent prices sit outside the model's training range, so this forecast is flagged unreliable. The model needs retraining on fresh data.</div>` : ""}
    <div class="metrics">
      <div class="metric"><div class="k">Next session (${esc(nx?.d || "")})</div>
        <div class="v">${fmt(nx?.value)}</div>
        <div class="d" style="color:${nx && nx.chg_pct_vs_last_close >= 0 ? "var(--up)" : "var(--down)"}">${fmtSigned(nx?.chg_pct_vs_last_close)} vs last close ${fmt(p.last_close)}</div></div>
      <div class="metric"><div class="k">Backtest RMSE (${p.backtest?.points} sessions)</div>
        <div class="v">${fmt(p.backtest?.rmse_price, 1)}<span style="font-size:13px;color:var(--text-muted)"> pts</span></div>
        <div class="d">${p.backtest?.rmse_scaled} in scaled units (comparable to the article's test MSE)</div></div>
      <div class="metric"><div class="k">Direction hit-rate</div>
        <div class="v">${Math.round((p.backtest?.hit_rate || 0) * 100)}%</div>
        <div class="d">vs previous close, rolling one session ahead</div></div>
      <div class="metric"><div class="k">Inference</div>
        <div class="v">${p.inference_ms} ms</div>
        <div class="d">pure JS, in the cloud function</div></div>
    </div>
    <div class="chart-wrap" id="pred-chart"></div>
    <div class="chart-legend">${legend}</div>
    <h3>5 session forecast path</h3>
    <div class="table-scroll"><table class="data"><thead><tr><th scope="col">Session</th><th scope="col">Predicted mid</th><th scope="col">vs last close</th></tr></thead>
    <tbody>${(p.next || []).map((x) => `<tr><td>${esc(x.d)}</td><td class="reading">${fmt(x.value)}</td><td class="reading" style="color:${x.chg_pct_vs_last_close >= 0 ? "var(--up)" : "var(--down)"}">${fmtSigned(x.chg_pct_vs_last_close)}</td></tr>`).join("")}</tbody></table></div>
    <p class="src">The model predicts the mid price (High+Low)/2 one session ahead; each further step feeds the previous
    prediction back in, exactly like the tutorial's sampling loop. Paths beyond 1-2 sessions widen in error quickly;
    treat them as directional context, not targets. Trading-day calendar skips weekends only (exchange holidays not modelled).</p>
    <h3>Rolling backtest detail</h3>
    <div class="table-scroll"><table class="data"><thead><tr><th scope="col">Date</th><th scope="col">Actual mid</th><th scope="col">Predicted</th><th scope="col">Error</th><th scope="col">Direction</th></tr></thead>
    <tbody>${bt.map((b) => {
      const err = b.pred_mid - b.actual_mid;
      const pd = b.pred_mid - b.prev_close, ad = b.actual_mid - b.prev_close;
      const hit = (pd > 0 && ad > 0) || (pd < 0 && ad < 0) || (pd === 0 && ad === 0);
      return `<tr><td>${esc(b.d)}</td><td class="reading">${fmt(b.actual_mid)}</td><td class="reading">${fmt(b.pred_mid)}</td>
        <td class="reading" style="color:${Math.abs(err) > 100 ? "var(--down)" : "var(--text-muted)"}">${err >= 0 ? "+" : ""}${fmt(err, 1)}</td>
        <td>${hit ? `<span class="chip up">Hit</span>` : `<span class="chip down">Miss</span>`}</td></tr>`;
    }).join("")}</tbody></table></div>`;

  $("#pred-chart").appendChild(svg);
}

/* ---------------- rendering: HPQ article exhibit ---------------- */
async function renderArticleExhibit() {
  const host = $("#article-exhibit");
  if (!host) return;
  let ex;
  try { ex = await (await fetch("/assets/hpq-article.json", { cache: "force-cache" })).json(); }
  catch { host.innerHTML = `<div class="empty-state">Article-model exhibit not published yet (training in progress).</div>`; return; }
  const { meta, scaler, x_axis, preds, actuals_tail, split } = ex;
  const unscale = (v) => scaler.min + v * (scaler.max - scaler.min);
  const n = x_axis.length;
  const x0 = x_axis[0];
  const actualPts = [], predPts = [];
  for (let i = 0; i < n; i++) {
    const a = actuals_tail[x_axis[i] - split];
    if (a !== undefined) actualPts.push([x_axis[i] - x0, +unscale(a).toFixed(2), `${x_axis[i]}: actual $${unscale(a).toFixed(2)}`]);
    predPts.push([x_axis[i] - x0, +unscale(preds[i]).toFixed(2), `${x_axis[i]}: predicted $${unscale(preds[i]).toFixed(2)}`]);
  }
  const xLabels = [];
  for (let i = 0; i < n; i += Math.floor(n / 8)) xLabels.push({ at: x_axis[i] - x0, text: String(x_axis[i]) });
  const svg = lineChart({
    height: 300,
    series: [
      { name: "actual mid price (test period)", color: C.blue, pts: actualPts },
      { name: "model predictions (final epoch)", color: C.vermillion, pts: predPts, width: 1.6 },
    ],
    xLabels, ariaLabel: "HPQ test period actual mid prices versus the tutorial model's predictions, in US dollars",
  });
  host.innerHTML = `
    <div class="metrics">
      <div class="metric"><div class="k">Final test MSE</div><div class="v">${meta.best_test_mse != null ? Number(meta.best_test_mse).toFixed(5) : "n/a"}</div>
        <div class="d">best epoch: ${meta.best_test_epoch ?? "n/a"} of ${meta.epochs}</div></div>
      <div class="metric"><div class="k">Architecture</div><div class="v" style="font-size:16px">LSTM ${meta.num_nodes.join("·")}</div>
        <div class="d">truncated BPTT, unrollings ${meta.num_unrollings}, batch ${meta.batch_size}, dropout ${meta.dropout}</div></div>
      <div class="metric"><div class="k">Training rows</div><div class="v">${meta.n_rows?.toLocaleString("en-US")}</div>
        <div class="d">train ${meta.split?.toLocaleString("en-US")} / test ${(meta.n_rows - meta.split).toLocaleString("en-US")}</div></div>
    </div>
    <div class="chart-wrap" id="hpq-chart"></div>
    <div class="chart-legend">
      <span><span class="swatch" style="background:${C.blue}"></span>actual mid price</span>
      <span><span class="swatch" style="background:${C.vermillion}"></span>model prediction</span>
    </div>
    <p class="src">HPQ daily bars 1970 to 2017 (the article's Kaggle dataset), test region from index ${split}.
    Values shown in US dollars after inverting the frozen MinMax scaler. Trained with TensorFlow 1.6 on Python 3.6,
    the exact stack the article specifies; these are the TF session's own predictions, exported after training.</p>`;
  $("#hpq-chart").appendChild(svg);
}

/* ---------------- rendering: TimesFM second opinion ---------------- */
async function renderModelAnalysis() {
  const host = $("#model-analysis");
  if (!host) return;
  let m;
  try { m = await (await fetch("/assets/model-analysis.json", { cache: "force-cache" })).json(); }
  catch { host.innerHTML = `<div class="empty-state">Model analysis not published yet (generated offline; see the model page for the procedure).</div>`; return; }
  const tfPath = m.timesfm?.forecast || m.forecast || [];
  if (!tfPath.length) { host.innerHTML = `<div class="empty-state">TimesFM analysis has no forecast path (artifact incomplete; run the offline procedure again).</div>`; return; }
  const staleDays = Math.round((Date.now() - new Date(m.as_of + "T00:00:00Z").getTime()) / 86400000);
  const E = m.ensemble;
  const num = (x) => (x === null || x === undefined ? "n/a" : Number(x).toLocaleString("en-US", { maximumFractionDigits: 1 }));
  const pct = (x) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(0)}%`);
  const dir = (v) => (v >= 0 ? "var(--up)" : "var(--down)");
  const cmp = m.comparison || {};
  const lstmPath = cmp.lstm?.path || [];

  const row = (label, st, nextVal, nextChg, path, extra) => `<tr><td>${label}${extra ? ` <span class="src">(${esc(extra)})</span>` : ""}</td>
    <td class="reading">${nextVal == null ? "n/a" : `<b>${num(nextVal)}</b> <span class="src">(${nextChg == null ? "" : fmtSigned(nextChg)} vs close)</span>`}</td>
    <td class="reading">${(path || []).map((v) => num(v)).join(" → ")}</td>
    <td class="reading">${st ? `${num(st.rmse)} pts` : "n/a"}</td>
    <td class="reading">${st ? pct(st.hit_rate) : "n/a"}</td></tr>`;
  const lastClose = m.last_close;
  const chgOf = (v) => lastClose ? +((100 * (v - lastClose) / lastClose).toFixed(2)) : null;

  host.innerHTML = `
    <p class="src" style="margin-top:0">${esc(m.timesfm.model)} vs the live LSTM, and the <b>adaptive ensemble</b> learned on top of both.
    All three are scored on the same ${E?.learned_on?.sessions || cmp.window || "?"} session walk forward window (${esc(E?.learned_on?.window || "")}).</p>
    ${E ? `<div class="metrics">
      <div class="metric"><div class="k">Ensemble (primary)</div>
        <div class="v">${num(E.forward_path?.[0])}</div>
        <div class="d" style="color:${dir(chgOf(E.forward_path?.[0]))}">${fmtSigned(chgOf(E.forward_path?.[0]))} vs close ${num(lastClose)}</div></div>
      <div class="metric"><div class="k">Learned weight w</div>
        <div class="v">${E.w}</div>
        <div class="d">${esc(E.formula)} · bias ${E.lstm_bias}</div></div>
      <div class="metric"><div class="k">Ensemble backtest</div>
        <div class="v">${num(E.backtest?.rmse, 1)}<span style="font-size:13px;color:var(--text-muted)"> pts</span></div>
        <div class="d">hit ${pct(E.backtest?.hit_rate)} over ${E.backtest?.points} sessions</div></div>
      <div class="metric"><div class="k">Weight stability</div>
        <div class="v">${E.stability?.first_half?.w} → ${E.stability?.second_half?.w}</div>
        <div class="d">w learned on each half of the window (RMSE ${num(E.stability?.first_half?.rmse)} → ${num(E.stability?.second_half?.rmse)})</div></div>
    </div>` : ""}
    <div class="table-scroll"><table class="data">
      <thead><tr><th scope="col">Model</th><th scope="col">Next session</th><th scope="col">5 session path</th><th scope="col">Backtest RMSE</th><th scope="col">Direction hit</th></tr></thead>
      <tbody>
        ${E ? row(`<b>Ensemble, primary</b>`, E.backtest, E.forward_path?.[0], chgOf(E.forward_path?.[0]), E.forward_path, `w=${E.w}`) : ""}
        ${row("TimesFM 2.5, zero shot", E?.components?.timesfm || cmp.timesfm, tfPath[0], chgOf(tfPath[0]), tfPath, "offline artifact")}
        ${E ? row("LSTM, bias corrected", E.components?.lstm_bias_corrected, null, null, null, `bias ${E.lstm_bias}`) : ""}
        ${row("LSTM (live, in function)", E?.components?.lstm_raw || cmp.lstm, m.lstm_live_next?.value, m.lstm_live_next?.chg, lstmPath, "tutorial pipeline")}
      </tbody>
    </table></div>
    ${E ? `<p class="src">The LSTM corrected row has no forward path of its own; its path is the live LSTM path minus the learned bias, and it feeds the ensemble directly.</p>` : ""}
    <p class="src">Forecast as of <b>${esc(m.as_of)}</b>${staleDays > 7 ? `: ${staleDays} days old; refresh via the documented offline procedure` : ""}.
    LSTM numbers are recomputed live in every scan; TimesFM numbers are refreshed when the analysis is re-run (its checkpoint is too large for the serverless runtime).
    Direction hit is measured against the previous session's close. None of this is investment advice.</p>`;
  linkGlossaryTerms(host);
}

/* ---------------- rendering: history ---------------- */
async function renderHistory() {
  const host = $("#history");
  const { ok, body } = await getJSON("/api/history");
  if (!ok || !Array.isArray(body) || !body.length) {
    host.innerHTML = `<div class="empty-state">No past reports yet. The first scheduled run publishes at 09:00 IST on the next trading day.</div>`;
    return;
  }
  host.innerHTML = `<ul class="hist-list">${body.map((h) => `
    <li><a href="/?date=${h.date}" data-date="${h.date}">
      <span><b>${esc(h.date)}</b> <span class="d">${esc(h.weekday || "")} · ${esc(h.generated_at || "")}</span></span>
      <span>${h.classification
        ? (/Positive/i.test(h.classification) ? `<span class="chip up">Positive open</span>`
          : /Negative/i.test(h.classification) ? `<span class="chip down">Negative open</span>`
          : /Conflicting/i.test(h.classification) ? `<span class="chip warn">Conflicting</span>`
          : `<span class="chip flat">Neutral</span>`)
        : (h.score > 0 ? `<span class="chip up">Score +${h.score}</span>` : h.score < 0 ? `<span class="chip down">Score ${h.score}</span>` : `<span class="chip flat">Score 0</span>`)}</span>
    </a></li>`).join("")}</ul>`;
  $$("#history a[data-date]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    history.pushState({}, "", "/?date=" + a.dataset.date);
    loadReport(a.dataset.date);
    scrollTo({ top: 0 });
  }));
}

/* ---------------- report loading ---------------- */
function renderAll(r) {
  renderFramework(r);
  renderChecks(r);
  renderContext(r);
  renderPrediction(r);
  renderFreshness(r);
  plainWords(r);
  for (const sel of ["#bias", "#checks", "#context", "#prediction"]) linkGlossaryTerms($(sel));
  const upd = $("#last-updated");
  if (upd) upd.textContent = `Report generated ${r.generated_at}`;
  $("#report-date-heading")?.setAttribute("hidden", "");
}

async function loadReport(date) {
  const host = $("#report-area");
  showSkeleton();
  const url = date ? `/api/report?date=${encodeURIComponent(date)}&format=json` : "/api/latest";
  let res;
  try {
    res = await getJSON(url);
  } catch (e) {
    clearSkeleton();
    host.innerHTML = `<div class="error-state">
      <div>Could not reach the report service. Check the connection and try again.</div>
      <button class="btn secondary" id="retry">Try again</button></div>`;
    $("#retry").addEventListener("click", () => loadReport(date));
    return;
  }
  const { ok, body, status } = res;
  clearSkeleton();
  if (!ok) {
    const msg = status === 404 && body?.message ? body.message
      : status === 404 ? `No report for ${date}.`
      : "Could not reach the report service.";
    host.innerHTML = `<div class="error-state">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>
      <div>${esc(msg)}</div>
      <button class="btn secondary" id="retry">Try again</button></div>`;
    $("#retry").addEventListener("click", () => loadReport(date));
    return;
  }
  try {
    renderAll(body);
  } catch (e) {
    console.error("render failed:", e);
    host.innerHTML = `<div class="error-state">
      <div>Something went wrong while drawing this report. Trying again usually fixes it.</div>
      <button class="btn secondary" id="retry">Try again</button></div>`;
    $("#retry").addEventListener("click", () => loadReport(date));
    return;
  }
  window.__report = body;
  setStatus(date ? `Viewing archived report for ${date}` : "");
}

/* ---------------- run scan ---------------- */
function initRunButton() {
  const btn = $("#run-scan");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.classList.add("loading");
    btn.querySelector(".label").textContent = "Scanning…";
    setStatus("Starting scan…");
    const t0 = Date.now();
    try {
      const { body } = await getJSON("/api/scan");
      if (body?.status === "rate-limited") {
        setStatus(body.message);
      } else {
        setStatus("Scan running in the cloud, typically 20 to 40 seconds…");
        const before = window.__report?.generated_at;
        for (let i = 0; i < 24; i++) {
          await new Promise((res) => setTimeout(res, 4000));
          const { ok, body: rep } = await getJSON("/api/latest");
          if (ok && rep.generated_at !== before) {
            renderAll(rep);
            window.__report = rep;
            renderHistory();
            setStatus(`Fresh report ready in ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
            break;
          }
          setStatus(`Still scanning… ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        }
      }
    } catch (e) {
      setStatus("Scan trigger failed. Check the connection and try again.");
    }
    // keep the loading state visible for at least 500 ms (avoids flicker)
    const elapsed = Date.now() - t0;
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove("loading");
      btn.querySelector(".label").textContent = "Run scan now";
    }, Math.max(0, 500 - elapsed));
  });
}

/* ---------------- copy report ---------------- */
function initCopy() {
  const btn = $("#copy-report");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const r = window.__report;
    if (!r) return;
    const md = reportToMarkdown(r);
    try {
      await navigator.clipboard.writeText(md);
      btn.querySelector(".label").textContent = "Copied";
    } catch {
      btn.querySelector(".label").textContent = "Copy failed";
    }
    setTimeout(() => (btn.querySelector(".label").textContent = "Copy report"), 1600);
  });
}
function reportToMarkdown(r) {
  const c = r.checks;
  const L = [`Premarket report: ${r.date} (${r.weekday})`, `Generated ${r.generated_at}`,
    `Opening bias: ${r.framework ? r.framework.classification : r.bias}`, ""];
  if (r.framework) L.push(...r.framework.rationale);
  for (const n of c.us_overnight) L.push(`1. ${n.label}: ${fmt(n.value)} (${fmtSigned(n.pct)}): ${n.signal} [${n.source || "unavailable"}]`);
  L.push(`2. India VIX: ${c.india_vix.value ?? "n/a"} vs 15: ${c.india_vix.signal} [${c.india_vix.source || "unavailable"}]`);
  L.push(`3. Advances/Declines: ${c.advance_decline.advances ?? "n/a"}/${c.advance_decline.declines ?? "n/a"}: ${c.advance_decline.signal} [${c.advance_decline.source || "unavailable"}]`);
  L.push(`4. GIFT Nifty: ${fmt(c.singapore_nifty.value)} (${fmtSigned(c.singapore_nifty.pct)}): ${c.singapore_nifty.signal} [${c.singapore_nifty.source || "unavailable"}]`);
  if (r.implied_open) L.push(`Implied open gap: ${fmtSigned(r.implied_open.gap_pct)}`);
  if (r.predictions?.next?.[0]) L.push(`LSTM next session (${r.predictions.next[0].d}): ${fmt(r.predictions.next[0].value)} (${fmtSigned(r.predictions.next[0].chg_pct_vs_last_close)})`);
  return L.join("\n");
}

/* ---------------- boot ---------------- */
initTheme();
initChrome();
initRunButton();
initCopy();
const params = new URLSearchParams(location.search);
loadReport(params.get("date") || null);
renderHistory();
renderArticleExhibit();
renderModelAnalysis();
addEventListener("popstate", () => {
  const d = new URLSearchParams(location.search).get("date");
  loadReport(d);
});
