// GET|POST /api/scan — trigger a scan on demand (the dashboard button).
// Rate-limited to one run per 2 minutes (blob-stamped) to prevent abuse.
export default async (req) => {
  const base = process.env.URL || new URL(req.url).origin;
  let last = 0;
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("premarket");
    last = parseInt((await store.get("last-manual-scan")) || "0", 10);
    if (Date.now() - last < 120000) {
      const wait = Math.ceil((120000 - (Date.now() - last)) / 1000);
      return new Response(JSON.stringify({
        status: "rate-limited", message: `A scan ran moments ago. Try again in ${wait}s.`,
      }), { status: 429, headers: { "content-type": "application/json" } });
    }
    await store.set("last-manual-scan", String(Date.now()));
  } catch { /* blob unavailable: proceed without the guard */ }
  try {
    const r = await fetch(`${base}/.netlify/functions/scan-background`, {
      headers: { "x-trigger": "manual" },
    });
    return new Response(JSON.stringify({
      status: "triggered", invoke: r.status,
      note: "scan running in background — the report appears within ~30 seconds",
    }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ status: "error", message: "Could not start the scan. Please try again in a minute." }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
};

export const config = { path: "/api/scan", method: ["GET", "POST"] };
