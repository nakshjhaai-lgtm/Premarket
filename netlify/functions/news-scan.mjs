// Scheduled function — fires at 03:10 UTC = 08:40 IST, Monday-Saturday.
// Headlines, earnings calendar and event flags, ready before the 09:00 report.
export default async () => {
  const base = process.env.URL || "http://localhost:8888";
  const { getStore } = await import("@netlify/blobs");
  try {
    const store = getStore("premarket");
    const last = parseInt((await store.get("last-news-run")) || "0", 10);
    if (Date.now() - last < 600000) {
      console.log(`news-scan: a news cycle ran in the last 10 minutes; skipping`);
      return;
    }
  } catch { /* blob unavailable: proceed */ }
  try {
    await fetch(`${base}/.netlify/functions/news-background`, { headers: { "x-trigger": "daily-schedule" } });
    console.log("news-scan: background news cycle triggered for 08:40 IST");
  } catch (e) {
    console.error("news-scan: trigger failed:", e);
  }
};
