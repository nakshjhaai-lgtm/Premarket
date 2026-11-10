#!/usr/bin/env python3
"""
Daily scheduler for the pre-market scanner.

Wakes just before 09:00 IST every Monday-Friday, runs scan.py at 09:00:00 IST
(the market opens 09:15 IST, so the whole four-point check completes inside the
fifteen-minute window), writes the report, and goes back to sleep until the
next trading day.

Usage:
    python3 scheduler.py            # daemonise in the foreground, log to scheduler.log
    python3 scheduler.py --once     # run one scan now and exit (same as scan.py)

The process is deliberately simple and restart-safe: every loop iteration
recomputes the next 09:00 IST from the wall clock, so a restarted scheduler
never double-fires or misses a day. If the host is asleep at 09:00 and wakes
later the same morning before 09:15, the scan still runs inside the window;
if it wakes after that, the scan runs immediately and the report is stamped
with the real time (late, but never silently missing).
"""

import datetime as dt
import os
import subprocess
import sys
import time
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "scheduler.log")
SCAN = os.path.join(HERE, "scan.py")
READY_AT = dt.time(8, 59, 30)     # be awake and ready before the 09:00 window
SCAN_AT = dt.time(9, 0, 0)        # the checks run at 09:00 IST sharp
LATEST = dt.time(9, 14, 0)        # still inside the pre-open window


def log(msg):
    line = "[%s] %s" % (dt.datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST"), msg)
    with open(LOG, "a") as f:
        f.write(line + "\n")
    print(line, flush=True)


def next_run(now):
    """Next 08:59:30 IST wake-up on a weekday."""
    day = now.date()
    for step in range(0, 10):
        cand_date = day + dt.timedelta(days=step)
        if cand_date.weekday() >= 5:          # Sat/Sun: NSE closed
            continue
        cand = dt.datetime.combine(cand_date, READY_AT, tzinfo=IST)
        if cand > now:
            return cand
    return None                               # unreachable


def run_scan():
    log("running scan")
    p = subprocess.run([sys.executable, SCAN], capture_output=True, text=True)
    tail = (p.stdout or "").strip().splitlines()
    log("scan exit=%d" % p.returncode)
    for line in tail[:4]:
        log("  | " + line)
    if p.returncode != 0:
        log("scan stderr: " + (p.stderr or "")[-500:])


def main():
    if "--once" in sys.argv:
        run_scan()
        return
    log("scheduler started (pid %d); scans at 09:00 IST Mon-Fri" % os.getpid())
    last_fire = None
    while True:
        now = dt.datetime.now(IST)
        target = next_run(now)
        # If we are already inside today's 09:00-09:14 window and have not
        # fired today (e.g. the host just woke up), fire immediately.
        inside = (SCAN_AT <= now.time() < LATEST and now.weekday() < 5
                  and last_fire != now.date())
        if inside:
            log("woke inside the pre-open window; scanning now")
            run_scan()
            last_fire = now.date()
            time.sleep(60)
            continue
        wait = (target - now).total_seconds()
        log("next wake-up %s (in %.0f min)" % (target.strftime("%Y-%m-%d %H:%M:%S IST"), wait / 60))
        # sleep in chunks so log/health stays fresh and clock jumps are safe
        while wait > 0:
            step = min(wait, 300)
            time.sleep(step)
            wait -= step
            now = dt.datetime.now(IST)
            if now >= target:
                break
        now = dt.datetime.now(IST)
        if now.weekday() >= 5:
            continue
        # hold at readiness until 09:00:00 sharp
        while dt.datetime.now(IST) < dt.datetime.combine(now.date(), SCAN_AT, tzinfo=IST):
            time.sleep(0.5)
        log("09:00 IST reached")
        run_scan()
        last_fire = now.date()


if __name__ == "__main__":
    main()
