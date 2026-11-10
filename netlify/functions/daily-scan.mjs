// Scheduled function — fires at 03:30 UTC = 09:00 IST, Monday-Friday.
// Scheduled functions have a 30-second cap, so all this does is hand the work
// to the background function (which gets up to 15 minutes) and exit.
export default async () => {
  const base = process.env.URL || "http://localhost:8888";
  try {
    // background functions answer 202 immediately and keep running
    await fetch(`${base}/.netlify/functions/scan-background`, {
      headers: { "x-trigger": "daily-schedule" },
    });
    console.log("daily-scan: background scan triggered for 09:00 IST window");
  } catch (e) {
    console.error("daily-scan: trigger failed:", e);
  }
};
