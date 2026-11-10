#!/usr/bin/env python3
"""TimesFM (google/timesfm-2.5-200m-pytorch) analysis on NIFTY 50 daily closes.

Produces /tmp/timesfm-raw.json:
  - 5-session forward forecast from the latest data
  - rolling one-session-ahead walk-forward over the last WALK sessions
    (same window the LSTM is scored on), used to LEARN the ensemble blend
  - timings

Run:  /home/user/.venv/bin/python tools/timesfm_run.py
"""
import csv, json, datetime as dt

DATA = "/home/user/lstm-stock/Stocks/nsei.us.txt"
WALK = 250          # walk-forward sessions (~1 year)
HORIZON = 5
CONTEXT = 1024
CHUNK = 32          # contexts per forecast() call (RAM safety)
OUT = "/tmp/timesfm-raw.json"

dates, closes = [], []
with open(DATA) as f:
    for row in csv.DictReader(f):
        c = float(row["Close"])
        if c and c > 0:
            dates.append(row["Date"])
            closes.append(c)
print(f"loaded {len(closes)} sessions, {dates[0]} -> {dates[-1]}", flush=True)

import numpy as np
import timesfm

print("loading timesfm-2.5-200m...", flush=True)
t0 = dt.datetime.now()
model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
    "google/timesfm-2.5-200m-pytorch", torch_compile=False
)
model.compile(
    timesfm.ForecastConfig(
        max_context=CONTEXT,
        max_horizon=HORIZON,
        normalize_inputs=True,
        use_continuous_quantile_head=False,
        force_flip_invariance=True,
        infer_is_positive=True,
        fix_quantile_crossing=False,
    )
)
print(f"model ready in {(dt.datetime.now() - t0).total_seconds():.0f}s", flush=True)

def batch_forecast(contexts, horizon):
    """forecast() in chunks; returns list of point-prediction arrays."""
    out = []
    for i in range(0, len(contexts), CHUNK):
        chunk = contexts[i:i + CHUNK]
        point, _ = model.forecast(horizon=horizon, inputs=chunk)
        out.extend([np.asarray(p, dtype=np.float64) for p in point])
    return out

# ---- forward 5-session forecast ----
t0 = dt.datetime.now()
fwd = batch_forecast([np.asarray(closes[-CONTEXT:], dtype=np.float64)], HORIZON)
fwd_ms = int((dt.datetime.now() - t0).total_seconds() * 1000)
forecast = [round(float(v), 2) for v in fwd[0]]
print("5-session forecast:", forecast, f"({fwd_ms} ms)", flush=True)

# ---- walk-forward, one session ahead, WALK sessions ----
t0 = dt.datetime.now()
contexts = [
    np.asarray(closes[max(0, i - CONTEXT):i], dtype=np.float64)
    for i in range(len(closes) - WALK, len(closes))
]
walk_preds = [round(float(p[0]), 2) for p in batch_forecast(contexts, 1)]
walk_ms = int((dt.datetime.now() - t0).total_seconds() * 1000)
walk_dates = dates[len(closes) - WALK:]
walk_actuals = [round(closes[i], 2) for i in range(len(closes) - WALK, len(closes))]
print(f"walk-forward done: {WALK} sessions in {walk_ms} ms", flush=True)

def next_days(last, n):
    out, d = [], dt.date.fromisoformat(last)
    while len(out) < n:
        d += dt.timedelta(days=1)
        if d.weekday() < 5:
            out.append(d.isoformat())
    return out

payload = {
    "as_of": dates[-1],
    "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    "model": "google/timesfm-2.5-200m-pytorch (TimesFM 2.5, 200M params, zero-shot)",
    "horizon_dates": next_days(dates[-1], HORIZON),
    "forecast": forecast,
    "walk_forward": {"dates": walk_dates, "preds": walk_preds, "actuals": walk_actuals},
    "backtest": {"dates": walk_dates[-30:], "preds": walk_preds[-30:], "actuals": walk_actuals[-30:]},
    "timings_ms": {"forward": fwd_ms, "walk_total": walk_ms},
}
json.dump(payload, open(OUT, "w"), indent=1)
print("wrote", OUT, flush=True)
errs = [p - a for p, a in zip(walk_preds, walk_actuals)]
rmse = (sum(e * e for e in errs) / len(errs)) ** 0.5
hits = sum(1 for j in range(1, len(walk_preds))
           if (walk_preds[j] - closes[len(closes) - WALK + j - 1]) * (walk_actuals[j] - closes[len(closes) - WALK + j - 1]) > 0)
print(f"WALK {WALK}: RMSE {rmse:.2f} pts | direction hit {hits}/{WALK-1}")
