#!/usr/bin/env bash
# Start the pre-market automation: scheduler daemon + dashboard.
# Idempotent: kills any previous copies first.
set -u
cd "$(dirname "$0")"

pkill -f "python3 scheduler.py" 2>/dev/null
pkill -f "python3 dashboard.py" 2>/dev/null
sleep 1

nohup python3 scheduler.py >> scheduler.log 2>&1 &
echo "scheduler started (pid $!) — runs the scan at 09:00 IST, Mon–Fri"

nohup python3 dashboard.py >> dashboard.log 2>&1 &
echo "dashboard started (pid $!) — http://0.0.0.0:8090/"

echo "logs: scheduler.log, dashboard.log · reports: reports/"
