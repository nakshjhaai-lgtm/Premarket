// Shared chrome for the static pages (model / methodology / privacy / 404):
// theme toggle + persistence, scroll progress, header shadow, back-to-top,
// mobile nav disclosure. The dashboard uses app.js instead.
(function () {
  const stored = localStorage.getItem("pm-theme");
  if (stored) document.documentElement.setAttribute("data-theme", stored);

  const meta = document.querySelector('meta[name="theme-color"]');
  const syncMeta = () => {
    if (!meta) return;
    const dark = document.documentElement.getAttribute("data-theme") === "dark"
      || (!document.documentElement.getAttribute("data-theme")
          && matchMedia("(prefers-color-scheme: dark)").matches);
    meta.content = dark ? "#12161b" : "#f5f6f8";
  };
  syncMeta();

  document.querySelector("#theme-toggle")?.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme")
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    localStorage.setItem("pm-theme", next);
    document.documentElement.setAttribute("data-theme", next);
    syncMeta();
  });

  const prog = document.querySelector("#progress");
  addEventListener("scroll", () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    if (prog) prog.style.width = (h > 0 ? (scrollY / h) * 100 : 0) + "%";
    document.querySelector("#to-top")?.classList.toggle("show", scrollY > 600);
    document.querySelector(".site-header")?.classList.toggle("scrolled", scrollY > 4);
  }, { passive: true });

  document.querySelector("#to-top")?.addEventListener("click", () =>
    scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));

  const navToggle = document.querySelector(".nav-toggle");
  navToggle?.addEventListener("click", () => {
    const nav = document.querySelector(".site-nav");
    navToggle.setAttribute("aria-expanded", String(nav.classList.toggle("open")));
  });

  // 404 page: show the missing path
  const missing = document.querySelector("#missing");
  if (missing) missing.textContent = location.pathname + location.search;
})();
