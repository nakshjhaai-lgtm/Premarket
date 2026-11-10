// GET /api/report?date=YYYY-MM-DD&format=json|md|html
const TYPES = { json: "application/json", md: "text/markdown; charset=utf-8", html: "text/html; charset=utf-8" };

export default async (req) => {
  const u = new URL(req.url);
  const date = u.searchParams.get("date") || "";
  const format = u.searchParams.get("format") || "json";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !TYPES[format]) {
    return new Response("bad request: need date=YYYY-MM-DD and format=json|md|html", { status: 400 });
  }
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("premarket");
  const body = await store.get(`reports/${date}${format === "json" ? "" : "." + format}`);
  if (body === null || body === undefined) {
    return new Response(`no report for ${date}`, { status: 404 });
  }
  return new Response(body, {
    headers: { "content-type": TYPES[format], "cache-control": "no-store" },
  });
};

export const config = { path: "/api/report" };
