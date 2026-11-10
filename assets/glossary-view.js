// /glossary.html viewer: search, category filters, A to Z index, anchored entries.
import { TERMS } from "./glossary-terms.mjs";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CATS = {
  "All": () => true,
  "Market": (t) => t.cat === "market",
  "Models": (t) => t.cat === "models",
  "Data": (t) => t.cat === "data",
  "Site tech": (t) => t.cat === "tech",
};

const byId = Object.fromEntries(TERMS.map((t) => [t.id, t]));

function entryHtml(t, q) {
  const hl = (s) => {
    if (!q) return esc(s);
    const i = s.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(s);
    return esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + q.length)) + "</mark>" + esc(s.slice(i + q.length));
  };
  const see = (t.see || []).map((id) => byId[id]).filter(Boolean);
  return `<article class="glossary-entry" id="${t.id}">
    <div class="glossary-head">
      <h3><a href="#${t.id}" class="entry-anchor" aria-label="Link to this entry">${hl(t.term)}</a></h3>
      <span class="chip flat cat-${t.cat}">${{ market: "Market", models: "Models", data: "Data", tech: "Site tech" }[t.cat] || t.cat}</span>
    </div>
    <p class="glossary-def">${hl(t.def)}</p>
    ${t.plain ? `<p class="glossary-plain"><span class="plain-tag">In plain words</span> ${hl(t.plain)}</p>` : ""}
    ${see.length ? `<p class="glossary-see">See also: ${see.map((s) => `<a href="#${s.id}">${esc(s.term)}</a>`).join(", ")}</p>` : ""}
  </article>`;
}

function main() {
  const root = $("#glossary-root");
  const status = $("#glossary-status");

  const letters = [...new Set(TERMS.map((t) => t.term[0].toUpperCase()))].sort();
  let filter = "All", q = "";

  function render() {
    const ql = q.trim().toLowerCase();
    const shown = TERMS.filter(CATS[filter]).filter((t) =>
      !ql || `${t.term} ${t.def} ${t.plain || ""} ${t.cat}`.toLowerCase().includes(ql));
    const groups = new Map();
    for (const t of shown) {
      const L = t.term[0].toUpperCase();
      if (!groups.has(L)) groups.set(L, []);
      groups.get(L).push(t);
    }
    $("#glossary-list").innerHTML = [...groups.entries()].map(([L, ts]) => `
      <section class="glossary-group" aria-label="Terms starting with ${L}">
        <h3 class="glossary-letter" id="letter-${L}">${L}</h3>
        ${ts.map((t) => entryHtml(t, q.trim())).join("")}
      </section>`).join("") ||
      `<div class="empty-state">No term matches ${esc(q) ? `<b>${esc(q)}</b>` : "this filter"}. If a word on the site is unclear and missing here, it will be added.</div>`;
    status.textContent = `${shown.length} of ${TERMS.length} terms${q ? ` matching "${q.trim()}"` : ""}${filter !== "All" ? ` in ${filter}` : ""}`;

    $$("#glossary-list .entry-anchor").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      history.replaceState(null, "", "#" + a.closest(".glossary-entry").id);
    }));
  }

  root.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
      <label class="src" for="glossary-search" style="margin:0">Search</label>
      <input id="glossary-search" type="search" placeholder="term, word, or idea…" style="flex:1;min-width:220px" autocomplete="off">
      <div role="group" aria-label="Filter by category" style="display:flex;gap:6px;flex-wrap:wrap">
        ${Object.keys(CATS).map((c) => `<button class="chip-btn${c === filter ? " active" : ""}" data-cat="${c}" type="button" aria-pressed="${c === filter}">${c}</button>`).join("")}
      </div>
    </div>
    <nav class="letter-index" aria-label="Jump to letter">
      <span class="src" style="margin-right:4px">A to Z</span>
      ${letters.map((L) => `<a href="#letter-${L}">${L}</a>`).join("")}
    </nav>
    <div id="glossary-list"></div>`;

  $("#glossary-search").addEventListener("input", (e) => { q = e.target.value; render(); });
  $$("button.chip-btn").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.cat;
    $$("button.chip-btn").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", x === b); });
    render();
  }));
  render();

  // deep link: /glossary.html#term (fresh load or in page hash change)
  const reveal = () => {
    const hash = location.hash.slice(1);
    if (!hash || !byId[hash]) return;
    const el = document.getElementById(hash);
    if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("flash"); }
  };
  reveal();
  addEventListener("hashchange", reveal);
}

try { main(); } catch (e) {
  console.error(e);
  const root = $("#glossary-root");
  if (root) root.innerHTML = `<div class="error-state">Something went wrong while drawing the glossary. Refresh the page to retry.</div>`;
}
