// /search.html: client-side site search over assets/search-index.json.
// Everything runs locally: no request leaves the site, no tracking.
(function () {
  const input = document.querySelector("#site-search");
  const status = document.querySelector("#search-status");
  const hits = document.querySelector("#hits");
  if (!input || !hits) return;

  const esc = (s) => s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const PAGE_LABEL = {
    "/": "Dashboard", "/stocks.html": "Stocks", "/model.html": "Models",
    "/methodology.html": "Methodology", "/glossary.html": "Glossary",
    "/eli5.html": "ELI5", "/privacy.html": "Privacy",
  };

  let docs = null;

  const snippetFor = (doc, q) => {
    const i = doc.text.toLowerCase().indexOf(q);
    if (i < 0) return doc.text.split("\n")[0].slice(0, 160);
    const from = Math.max(0, i - 60);
    const raw = doc.text.slice(from, i + q.length + 100).replace(/\n/g, " ");
    return (from > 0 ? "…" : "") + raw + "…";
  };

  const run = () => {
    const q = input.value.trim().toLowerCase();
    if (!docs) return;
    if (q.length < 2) {
      hits.innerHTML = "";
      status.textContent = "Type at least two letters…";
      return;
    }
    const terms = q.split(/\s+/);
    const found = docs
      .map((d) => {
        const hay = (d.title + " " + d.text).toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (!hay.includes(t)) return null;
          score += hay.split(t).length - 1;
        }
        return { d, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    status.textContent = found.length
      ? `${found.length} ${found.length === 1 ? "match" : "matches"} for \u201C${input.value.trim()}\u201D`
      : `No matches for \u201C${input.value.trim()}\u201D. Try a shorter word, or browse the glossary from A to Z.`;
    hits.innerHTML = found.map(({ d }) => {
      const label = d.url.startsWith("/glossary.html#") ? "Glossary term" : (PAGE_LABEL[d.url] || "Page");
      return `<li>
        <span class="where">${esc(label)}</span><br>
        <a href="${esc(d.url)}">${esc(d.title)}</a>
        <p>${esc(snippetFor(d, terms[0]))}</p>
      </li>`;
    }).join("");
  };

  // desktop single primary input: focus it; on touch devices the opening
  // keyboard would shift the layout, so leave it alone there
  if (matchMedia("(pointer: fine)").matches) input.focus();
  input.addEventListener("input", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();   // no form submit; results are already live
  });

  fetch("/assets/search-index.json")
    .then((r) => r.json())
    .then((d) => { docs = d; if (input.value.trim().length >= 2) run(); })
    .catch(() => { if (status) status.textContent = "The search index could not load. The page menus still work."; });
})();
