// Scheduled function — fires at 03:40 UTC = 09:10 IST, Monday-Saturday.
// (Saturday catches the Friday US close.) Scheduled functions have a 30s cap,
// so this just hands the work to the background function.
export default async () => {
  const base = process.env.URL || "http://localhost:8888";
  const { getStore } = await import("@netlify/blobs");
  try {
    const store = getStore("premarket");
    const last = parseInt((await store.get("last-stocks-run")) || "0", 10);
    if (Date.now() - last < 600000) {
      console.log(`stocks-adaptive: a stocks cycle ran in the last 10 minutes; skipping`);
      return;
    }
  } catch { /* blob unavailable: proceed */ }
  try {
    await fetch(`${base}/.netlify/functions/stocks-adaptive-background`, {
      headers: { "x-trigger": "daily-schedule" },
    });
    console.log("stocks-adaptive: per stock learning cycle triggered for 09:10 IST");
  } catch (e) {
    console.error("stocks-adaptive: trigger failed:", e);
  }
};
