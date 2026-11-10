// Scheduled function — fires at 03:50 UTC = 09:20 IST, Monday-Friday, five
// minutes after the regular session opens. It asks the background function
// for a post-open confirmation snapshot (actual open, price vs open, live
// breadth, live VIX) that gets appended to the morning's report.
export default async () => {
  const base = process.env.URL || "http://localhost:8888";
  try {
    await fetch(`${base}/.netlify/functions/scan-background`, {
      headers: { "x-trigger": "post-open" },
    });
    console.log("post-open-scan: confirmation snapshot triggered for 09:20 IST");
  } catch (e) {
    console.error("post-open-scan: trigger failed:", e);
  }
};
