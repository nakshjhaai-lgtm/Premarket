// GET /api/latest — most recent report as JSON
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async () => {
  // dynamic import + plain get/set only: the runtime-provided blobs build
  // lacks getJSON/setJSON, so JSON handling is done manually.
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("premarket");
  const raw = await store.get("latest");
  if (!raw) {
    return json({
      status: "empty",
      message: "No report yet. The scheduled scan runs at 09:00 IST on trading days, " +
               "or press 'Run scan now' to generate one immediately.",
    }, 404);
  }
  return new Response(raw, {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};

export const config = { path: "/api/latest" };
