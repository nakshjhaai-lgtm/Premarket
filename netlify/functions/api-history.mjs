// GET /api/history — list of saved report dates (newest first)
export default async () => {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("premarket");
  const raw = await store.get("history");
  let hist = [];
  try { hist = raw ? JSON.parse(raw) : []; } catch { hist = []; }
  return new Response(JSON.stringify(hist), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};

export const config = { path: "/api/history" };
