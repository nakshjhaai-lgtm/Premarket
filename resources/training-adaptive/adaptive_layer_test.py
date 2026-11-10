import json, numpy as np, lightgbm as lgb

X = np.load("X.npy"); y = np.load("y.npy")
meta = json.load(open("meta.json")); FEATURES = json.load(open("features.json"))
ds = np.array([m["d"] for m in meta]); syms = np.array([m["sym"] for m in meta])

BASE = dict(objective="regression", metric="rmse", num_leaves=63, learning_rate=0.03,
            n_estimators=800, min_child_samples=300, feature_fraction=0.9,
            bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=7)

# 5-seed model trained through 2025, predict 2026, then simulate the ONLINE loop:
# each day per stock: pred_adj = pred - mean(recent errors), band from recent residuals
tr = ds < "2026-01-01"; te = ds >= "2026-01-01"
ps = []
for s in (7, 11, 13):
    m = lgb.train({**BASE, "seed": s}, lgb.Dataset(X[tr], y[tr]))
    ps.append(m.predict(X[te]))
p = np.mean(ps, axis=0)
yt = y[te]; symt = syms[te]; dt = ds[te]
order = np.argsort(dt)
p, yt, symt, dt = p[order], yt[order], symt[order], dt[order]

raw_hit = band_hit = adj_hit = 0; n = nband = 0
errs = {}; resid = {}
MAE_raw = MAE_adj = 0.0
for i in range(len(p)):
    s = symt[i]
    e = errs.setdefault(s, []); r = resid.setdefault(s, [])
    pred_raw = p[i]
    bias = np.mean(e[-20:]) if len(e) >= 10 else 0.0
    pred_adj = pred_raw - bias
    # 80% band from recent residuals (min 30 samples) else 2.4% fallback
    sigma = np.percentile(np.abs(r[-40:]), 80) if len(r) >= 30 else 2.4
    if len(e) >= 10:
        adj_hit += (pred_adj > 0) == (yt[i] > 0); n += 1
        band_hit += abs(yt[i] - pred_adj) <= sigma; nband += 1
        MAE_adj += abs(yt[i] - pred_adj)
    raw_hit += (pred_raw > 0) == (yt[i] > 0)
    MAE_raw += abs(yt[i] - pred_raw)
    e.append(pred_raw - yt[i]); r.append(yt[i] - pred_raw)
tot = len(p)
print(f"2026 out-of-sample, per-stock online adaptation simulated day by day:")
print(f"  raw direction hit:        {100*raw_hit/tot:5.2f}%  (n={tot})")
print(f"  adapted direction hit:    {100*adj_hit/n:5.2f}%  (n={n}, after 10-day warmup per stock)")
print(f"  80% band coverage:        {100*band_hit/nband:5.2f}%  (n={nband})  <- calibrated, not direction")
print(f"  MAE raw {MAE_raw/tot:.3f}%  ->  adapted {MAE_adj/n:.3f}%")
