// /stocks.html viewer: searchable, sortable table of TimesFM per stock forecasts.
// Data: /assets/stock-forecasts.json (offline artifact; see README refresh procedure).
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (x, d = 2) => (x === null || x === undefined || Number.isNaN(+x) ? "n/a" : Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const signed = (x, d = 2) => (x === null || x === undefined || Number.isNaN(+x) ? "n/a" : `${x >= 0 ? "+" : ""}${Number(x).toFixed(d)}`);
const dir = (x) => (x >= 0 ? "var(--up)" : "var(--down)");

const REGION_GROUPS = {
  "All": () => true,
  "US": (s) => s.region === "US" && s.sector !== "Index ETF",
  "Index ETFs": (s) => s.sector === "Index ETF",
  "Global ADRs": (s) => !["US", "India"].includes(s.region),
  "India ADRs": (s) => s.region === "India",
};

function sparkline(closes, w = 110, h = 28) {
  if (!closes?.length) return "";
  const min = Math.min(...closes), max = Math.max(...closes), span = max - min || 1;
  const pts = closes.map((c, i) => `${(i / (closes.length - 1 || 1) * w).toFixed(1)},${(h - ((c - min) / span) * (h - 4) - 2).toFixed(1)}`);
  const up = closes[closes.length - 1] >= closes[0];
  const color = up ? "var(--up)" : "var(--down)";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="last ${closes.length} closes, ${up ? "up" : "down"} over the window">
    <polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${w}" cy="${pts[pts.length - 1].split(",")[1]}" r="2" fill="${color}"/></svg>`;
}

function parseHit(h) {
  const m = /^(\d+)\/(\d+)$/.exec(h || "");
  return m ? +m[1] / +m[2] : null;
}


// ---------------- live adaptive engine (primary) ----------------
async function loadLive() {
  const root = $("#live-root"), status = $("#live-status");
  let d = null, news = null;
  try {
    const [rs, rn] = await Promise.all([
      fetch("/api/stocks", { cache: "no-store" }).catch(() => null),
      fetch("/api/news", { cache: "no-store" }).catch(() => null),
    ]);
    if (rs && rs.ok) d = await rs.json();
    if (rn && rn.ok) news = await rn.json();
  } catch { /* fall back */ }
  if (!d || !d.predictions) {
    status.textContent = "Live engine: no cycle has run yet (it runs daily at 09:10 IST). The TimesFM artifact table below is fully usable meanwhile.";
    root.innerHTML = "";
    return;
  }
  const srcBad = Object.values(d.sources || {}).some((x) => x.state === "degraded");
  status.textContent = `${d.predictions.length} symbols · as of ${d.as_of} · ${srcBad ? "some sources degraded; see note" : "sources live"} · TimesFM artifact ${d.tf_artifact?.fresh ? "fresh" : "stale (tree model only)"}`;
  const arrow = (x) => (x === "up" ? "▲" : x === "down" ? "▼" : "＝");
  const col = (x) => (x === "up" ? "var(--up)" : x === "down" ? "var(--down)" : "var(--muted)");
  // sortable columns: same interaction as the offline table below (click to
  // sort, click again to flip). "learning" cells (null) always sort last.
  const LIVE_COLS = [
    { k: "sym", label: "Symbol", str: true },
    { k: "last_close", label: "Last close (USD)" },
    { k: "next_close", label: "Next session forecast" },
    { k: "pred_pct", label: "Predicted move %" },
    { k: "band_pct", label: "Likely range (80%)" },
    { k: "blend", label: "Blend", str: true },
    { k: "dir_hit_20", label: "Direction hit (last 20)" },
    { k: "band_hit_20", label: "Range hit (last 20)" },
    { k: "news_n", label: "Events and news" },
  ];
  let liveSort = { key: "pred_pct", dir: -1 };
  const newsCount = (sym) => {
    const n = news?.per_symbol?.[sym];
    if (!n) return -1;
    return (n.n || 0) + (n.earnings_days != null ? 1 : 0) + (n.heavy ? 1 : 0);
  };
  const sortedRows = () => d.predictions.filter((x) => !x.error).slice().sort((a, b) => {
    const c = LIVE_COLS.find((c2) => c2.k === liveSort.key);
    const va = c.k === "news_n" ? newsCount(a.sym) : a[c.k];
    const vb = c.k === "news_n" ? newsCount(b.sym) : b[c.k];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;    // learning cells last, both directions
    if (vb == null) return -1;
    const cmp = c.str ? String(va).localeCompare(String(vb)) : (va - vb);
    return cmp * liveSort.dir;
  });
  const theadHtml = () => LIVE_COLS.map((c) => {
    const active = c.k === liveSort.key;
    const mark = active ? (liveSort.dir < 0 ? " ↓" : " ↑") : "";
    const ariaSort = active ? (liveSort.dir < 0 ? "descending" : "ascending") : "none";
    return `<th scope="col" class="sortable${active ? " sorted" : ""}" data-key="${c.k}" aria-sort="${ariaSort}">${c.label}${mark}</th>`;
  }).join("");
  const rows = sortedRows();
  root.innerHTML = `
    <div class="table-wrap"><table class="data-table" aria-label="Live adaptive forecasts per stock">
      <thead><tr>${theadHtml()}</tr></thead>
      <tbody>
      ${rows.map((x) => x.error ? "" : `
        <tr>
          <td><strong>${esc(x.sym)}</strong><div class="cell-sub">${esc(x.name || "")}</div></td>
          <td>${fmt(x.last_close)}<div class="cell-sub">${esc(x.last_date || "")}</div></td>
          <td><strong>${fmt(x.next_close)}</strong></td>
          <td style="color:${col(x.direction)}">${signed(x.pred_pct)}% ${arrow(x.direction)}</td>
          <td>${fmt(x.band_lo)} to ${fmt(x.band_hi)}<div class="cell-sub">±${fmt(x.band_pct)}%</div></td>
          <td>${esc(x.blend)}${x.tf_pct != null ? `<div class="cell-sub">TimesFM ${signed(x.tf_pct)}%</div>` : ""}</td>
          <td>${x.dir_hit_20 == null ? `learning (${x.n_resolved} resolved)` : `${x.dir_hit_20}%`}</td>
          <td>${x.band_hit_20 == null ? `learning` : `${x.band_hit_20}%`}</td>
          <td>${(() => {
            const n = news?.per_symbol?.[x.sym];
            if (!n) return "n/a";
            const bits = [];
            if (n.earnings_days != null) bits.push(`<span class="chip warn">earnings in ${n.earnings_days} session${n.earnings_days === 1 ? "" : "s"}</span>`);
            if (n.heavy) bits.push(`<span class="chip down">heavy news</span>`);
            if (n.n) bits.push(`${n.n} headline${n.n === 1 ? "" : "s"}${n.tags?.length ? " · " + esc(n.tags.join(", ")) : ""}`);
            const tip = (n.items || []).map((i) => i.t).join("\n");
            return bits.length ? `<span title="${esc(tip)}">${bits.join(" · ")}</span>` : "quiet";
          })()}</td>
        </tr>`).join("")}
      </tbody>
    </table></div>
    <p class="note-line">Model: ${esc(d.model)}. Each stock learns its own correction from its own results: the bias, the range width and the TimesFM blend weight are relearned daily from what really happened (${d.aggregate?.n_resolved || 0} predictions resolved so far). ${d.n_resolved_this_run ? `${d.n_resolved_this_run} resolved in the last run. ` : ""}${d.failed_symbols?.length ? `Unavailable this run: ${esc(d.failed_symbols.join(", "))}. ` : ""}Forecasts are model outputs, not advice. The events column is context the models do not read: earnings dates come from the Nasdaq calendar and headlines from Google News and CNBC, collected daily at 08:40 IST.</p>`;
  function bindLiveSort() {
    root.querySelectorAll("th.sortable").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.key;
      if (liveSort.key === k) liveSort.dir = -liveSort.dir;
      else liveSort = { key: k, dir: -1 };
      const t = root.querySelector("thead tr");
      const tbody = root.querySelector("tbody");
      tbody.innerHTML = sortedRows().map((x) => x.error ? "" : `
        <tr>
          <td><strong>${esc(x.sym)}</strong><div class="cell-sub">${esc(x.name || "")}</div></td>
          <td>${fmt(x.last_close)}<div class="cell-sub">${esc(x.last_date || "")}</div></td>
          <td><strong>${fmt(x.next_close)}</strong></td>
          <td style="color:${col(x.direction)}">${signed(x.pred_pct)}% ${arrow(x.direction)}</td>
          <td>${fmt(x.band_lo)} to ${fmt(x.band_hi)}<div class="cell-sub">±${fmt(x.band_pct)}%</div></td>
          <td>${esc(x.blend)}${x.tf_pct != null ? `<div class="cell-sub">TimesFM ${signed(x.tf_pct)}%</div>` : ""}</td>
          <td>${x.dir_hit_20 == null ? `learning (${x.n_resolved} resolved)` : `${x.dir_hit_20}%`}</td>
          <td>${x.band_hit_20 == null ? `learning` : `${x.band_hit_20}%`}</td>
          <td>${(() => {
            const n = news?.per_symbol?.[x.sym];
            if (!n) return "n/a";
            const bits = [];
            if (n.earnings_days != null) bits.push(`<span class="chip warn">earnings in ${n.earnings_days} session${n.earnings_days === 1 ? "" : "s"}</span>`);
            if (n.heavy) bits.push(`<span class="chip down">heavy news</span>`);
            if (n.n) bits.push(`${n.n} headline${n.n === 1 ? "" : "s"}${n.tags?.length ? " · " + esc(n.tags.join(", ")) : ""}`);
            const tip = (n.items || []).map((i) => i.t).join("\n");
            return bits.length ? `<span title="${esc(tip)}">${bits.join(" · ")}</span>` : "quiet";
          })()}</td>
        </tr>`).join("");
      t.innerHTML = theadHtml();
      bindLiveSort();
    }));
  }
  bindLiveSort();
  if (news) {
    const up = (news.earnings_upcoming || []).slice(0, 8).map((e) => `${e.sym} ${e.date}${e.eps ? " (est " + e.eps + ")" : ""}`).join(" · ");
    if (up) root.insertAdjacentHTML("beforeend", `<p class="note-line"><strong>Earnings this week among these stocks:</strong> ${esc(up)}</p>`);
  }
}
await loadLive();

// ---------------- decade walk forward backtest (honest numbers) ----------------
async function loadBacktest() {
  const host = $("#backtest-root");
  if (!host) return;
  let d = null;
  try { d = await (await fetch("/assets/backtest-decade.json", { cache: "force-cache" })).json(); } catch { return; }
  const rows = d.years.map((y) => `
    <tr>
      <td>${y.year}</td><td>${(y.n_train / 1000).toFixed(1)}k</td>
      <td>${y.hit_rate}%</td><td>${y.hit_momentum}%</td><td>${y.hit_always_up}%</td>
      <td>${y.hi_hit == null ? "n/a" : `${y.hi_hit}% (${y.hi_n} days)`}</td>
      <td>${y.rmse.toFixed(2)}</td>
    </tr>`).join("");
  host.innerHTML = `
    <p>How the model has scored, tested year by year on data it never saw (each year uses a model trained only on earlier years). Direction means calling the next session up or down; high confidence days are those where the predicted move exceeds 1%.</p>
    <div class="table-wrap"><table class="data-table" aria-label="Walk forward results by year">
      <thead><tr><th>Year</th><th>Trained on</th><th>Direction hit</th><th>Momentum baseline</th><th>Always up baseline</th><th>High confidence days</th><th>RMSE %</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="note-line">Honest reading: next session direction sits near 50% for every model that is tested fairly, which matches published research on public data (academic results cluster at 53 to 58%; higher claims usually leak future information into the test). This site reports what the walk forward actually shows. The adaptive layer adds a per stock bias correction and a calibrated range, and every number on the live table is tracked against what really happens. No 90 to 95% daily direction accuracy exists with public data, and any product claiming it should not be trusted.</p>`;
}
await loadBacktest();


async function main() {
  const root = $("#stocks-root");
  const status = $("#stocks-status");
  let data;
  try {
    data = await (await fetch("/assets/stock-forecasts.json", { cache: "force-cache" })).json();
  } catch {
    status.textContent = "";
    root.innerHTML = `<div class="error-state">Could not load /assets/stock-forecasts.json. Refresh the page, or view the raw JSON directly.</div>`;
    return;
  }
  const stocks = (data.stocks || []).slice().sort((a, b) => b.next_pct - a.next_pct);
  if (!stocks.length) {
    status.textContent = "";
    root.innerHTML = `<div class="empty-state">The forecast artifact is empty; run the offline procedure from the README to rebuild it.</div>`;
    return;
  }

  const ageDays = Math.round((Date.now() - new Date(data.as_of + "T00:00:00Z").getTime()) / 86400000);
  const ageEl = $("#artifact-age");
  if (ageEl) ageEl.textContent = ageDays <= 1 ? "latest" : `${ageDays} days`;
  status.textContent = `${data.count} symbols · TimesFM 2.5, zero shot · as of ${data.as_of}${data.failed?.length ? ` · ${data.failed.length} unavailable: ${esc(data.failed.join(", "))}` : ""}${ageDays > 7 ? ` · artifact is ${ageDays} days old` : ""}`;

  let filter = "All", query = "", sortKey = "next_pct", sortDir = -1;

  const HEADERS = [
    { key: "sym", label: "Symbol", num: false },
    { key: "last", label: "Last (USD)", num: true },
    { key: "chg_1d_pct", label: "1 day %", num: true },
    { key: "next_pct", label: "Next session %", num: true },
    { key: "pct_5d", label: "5 session %", num: true },
    { key: "hit", label: "Direction hit (10d)", num: true },
    { key: "bt_rmse", label: "Backtest RMSE %", num: true },
    { key: "spark", label: "Last 60 sessions", num: false },
  ];

  function renderTable() {
    const q = query.toLowerCase();
    const rows = stocks
      .filter((s) => REGION_GROUPS[filter](s))
      .filter((s) => !q || `${s.sym} ${s.name} ${s.sector} ${s.region}`.toLowerCase().includes(q))
      .slice();
    const val = (s, k) => k === "hit" ? parseHit(s.bt?.hit) : k === "bt_rmse" ? s.bt?.rmse_pct : k === "sym" ? s.sym : s[k];
    rows.sort((a, b) => {
      const va = val(a, sortKey), vb = val(b, sortKey);
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * sortDir;
      return ((va ?? -Infinity) - (vb ?? -Infinity)) * sortDir;
    });

    $("#stocks-table-wrap").innerHTML = `<div class="table-scroll"><table class="data" id="stocks-table">
      <thead><tr>${HEADERS.map((h) => `<th scope="col"${h.num ? ` class="sortable${sortKey === h.key ? " sorted" : ""}" data-key="${h.key}"` : ""}>${h.label}${sortKey === h.key ? (sortDir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((s) => `<tr>
        <td><b>${esc(s.sym)}</b><br><span class="src">${esc(s.name)} · ${esc(s.sector)} · ${esc(s.region)}</span></td>
        <td class="reading">${fmt(s.last)}</td>
        <td class="reading" style="color:${dir(s.chg_1d_pct)}">${signed(s.chg_1d_pct)}</td>
        <td class="reading" style="color:${dir(s.next_pct)}"><b>${signed(s.next_pct)}</b><br><span class="src">${fmt(s.path[0])}</span></td>
        <td class="reading" style="color:${dir(s.pct_5d)}">${signed(s.pct_5d)}<br><span class="src">${fmt(s.path[s.path.length - 1])}</span></td>
        <td class="reading">${s.bt?.hit ?? "n/a"}<br><span class="src">RMSE ${fmt(s.bt?.rmse_pct, 2)}%</span></td>
        <td class="reading">${fmt(s.bt?.rmse_pct, 2)}</td>
        <td>${sparkline(s.spark)}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    <p class="src">${rows.length} of ${stocks.length} symbols shown. Click a numeric column header to sort (again to reverse).
    Forecasts are TimesFM zero shot outputs as of each row's data date; the main NIFTY dashboard forecast is the adaptive ensemble.</p>`;

    $$("#stocks-table th.sortable").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.key;
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = -1; }
      renderTable();
    }));
  }

  root.innerHTML = `
    <div class="metrics" style="margin-bottom:20px">
      <div class="metric"><div class="k">Symbols covered</div><div class="v">${data.count}</div><div class="d">US, ETFs, global &amp; Indian ADRs</div></div>
      <div class="metric"><div class="k">Model</div><div class="v" style="font-size:20px">TimesFM 2.5</div><div class="d">200M parameters, zero shot, 5 session horizon</div></div>
      <div class="metric"><div class="k">Artifact as of</div><div class="v" style="font-size:20px">${esc(data.as_of)}</div><div class="d">${ageDays <= 1 ? "fresh" : ageDays + " days old; see the README for the refresh procedure"}</div></div>
      <div class="metric"><div class="k">Median direction hit (10d)</div><div class="v">${(() => { const hs = stocks.map((s) => parseHit(s.bt?.hit)).filter((x) => x != null).sort((a, b) => a - b); return hs.length ? Math.round(hs[Math.floor(hs.length / 2)] * 100) + "%" : "n/a"; })()}</div><div class="d">one session ahead, per symbol</div></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
      <label class="src" for="stocks-search" style="margin:0">Search</label>
      <input id="stocks-search" type="search" placeholder="symbol, name, sector, region…" style="flex:1;min-width:220px" autocomplete="off">
      <div role="group" aria-label="Filter by region" style="display:flex;gap:6px;flex-wrap:wrap">
        ${Object.keys(REGION_GROUPS).map((g) => `<button class="chip-btn${g === filter ? " active" : ""}" data-group="${g}" type="button" aria-pressed="${g === filter}">${g}</button>`).join("")}
      </div>
    </div>
    <div id="stocks-table-wrap"></div>`;

  $("#stocks-search").addEventListener("input", (e) => { query = e.target.value; renderTable(); });
  $$("button.chip-btn").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.group;
    $$("button.chip-btn").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", x === b); });
    renderTable();
  }));
  renderTable();
}

main().catch((e) => {
  console.error(e);
  const root = $("#stocks-root");
  if (root) root.innerHTML = `<div class="error-state">Something went wrong while drawing the stock table. Refresh the page to retry.</div>`;
});
