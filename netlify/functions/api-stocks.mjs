// GET /api/stocks — live per stock adaptive forecasts (blob "stocks-live")
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async () => {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("premarket");
  const raw = await store.get("stocks-live");
  if (!raw) return json({ status: "empty", message: "No live stock cycle yet. It runs at 09:10 IST, or trigger it from the stocks page." }, 404);
  return new Response(raw, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};

export const config = { path: "/api/stocks" };
