import json, numpy as np, lightgbm as lgb

X = np.load("X.npy"); y = np.load("y.npy")
meta = json.load(open("meta.json")); FEATURES = json.load(open("features.json"))
ds = np.array([m["d"] for m in meta]); syms = np.array([m["sym"] for m in meta])

PARAMS = dict(objective="regression", metric="rmse", num_leaves=63, learning_rate=0.03,
              n_estimators=800, min_child_samples=300, feature_fraction=0.9,
              bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=7)

def run_fold(train_mask, test_mask):
    Xtr, ytr = X[train_mask], y[train_mask]
    m = lgb.train(PARAMS, lgb.Dataset(Xtr, ytr), num_boost_round=PARAMS["n_estimators"])
    p = m.predict(X[test_mask])
    return m, p

results = {"config": {"features": FEATURES, "params": {k: v for k, v in PARAMS.items() if k != "verbose"}, "trained": "2026-10-17"}, "years": [], "per_stock_2026": {}}
year_preds = {}
for test_year in range(2018, 2027):
    tr = ds < f"{test_year}-01-01"
    te = (ds >= f"{test_year}-01-01") & (ds < f"{test_year+1}-01-01")
    m, p = run_fold(tr, te)
    yt = y[te]; symt = syms[te]; dt = ds[te]
    hit = ((p > 0) == (yt > 0))
    mom = (X[te][:, FEATURES.index("r1")] > 0) == (yt > 0)     # momentum baseline
    up = np.ones_like(yt, dtype=bool) == (yt > 0)               # always up baseline
    hi = np.abs(p) >= 1.0                                        # high confidence days
    row = {"year": test_year, "n_train": int(tr.sum()), "n_test": int(te.sum()),
           "hit_rate": round(100*hit.mean(), 2), "hit_momentum": round(100*mom.mean(), 2),
           "hit_always_up": round(100*up.mean(), 2),
           "rmse": round(float(np.sqrt(((p-yt)**2).mean())), 4),
           "hi_n": int(hi.sum()),
           "hi_hit": round(100*hit[hi].mean(), 2) if hi.sum() > 30 else None,
           "hi_up": round(100*up[hi].mean(), 2) if hi.sum() > 30 else None}
    results["years"].append(row)
    year_preds[test_year] = (p, yt, symt, dt)
    print(f"{test_year}: train={tr.sum():6d} test={te.sum():5d} | hit {row['hit_rate']:5.2f}% "
          f"(mom {row['hit_momentum']:5.2f} / up {row['hit_always_up']:5.2f}) | rmse {row['rmse']:.3f} "
          f"| hi-conf n={row['hi_n']:4d} hit {row['hi_hit']}%", flush=True)

# per stock final year
for sym in sorted(set(syms)):
    p, yt, symt, dt = year_preds[2026]
    k = symt == sym
    if k.sum() < 30: continue
    results["per_stock_2026"][sym] = {"n": int(k.sum()), "hit": round(100*((p[k]>0)==(yt[k]>0)).mean(), 2)}
imp = m.feature_importance("gain")
results["feature_importance"] = sorted([{"f": FEATURES[i], "gain": round(float(imp[i]),1)} for i in range(len(FEATURES))], key=lambda r: -r["gain"])
json.dump(results, open("walkforward_results.json", "w"), indent=1)
print("\nsaved walkforward_results.json")
