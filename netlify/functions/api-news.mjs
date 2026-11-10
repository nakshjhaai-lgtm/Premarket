// GET /api/news — market headlines, per stock news and earnings calendar
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async () => {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("premarket");
  const raw = await store.get("news-latest");
  if (!raw) return json({ status: "empty", message: "No news cycle yet. It runs daily at 08:40 IST." }, 404);
  return new Response(raw, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};

export const config = { path: "/api/news" };
