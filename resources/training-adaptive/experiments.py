import json, numpy as np, lightgbm as lgb

X = np.load("X.npy"); y = np.load("y.npy")
meta = json.load(open("meta.json")); FEATURES = json.load(open("features.json"))
ds = np.array([m["d"] for m in meta]); syms = np.array([m["sym"] for m in meta])

BASE = dict(objective="regression", metric="rmse", num_leaves=63, learning_rate=0.03,
            n_estimators=800, min_child_samples=300, feature_fraction=0.9,
            bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=7)

def evaluate(p, yt, tag):
    hit = ((p > 0) == (yt > 0))
    hi = np.abs(p) >= 1.0
    print(f"  {tag}: hit {100*hit.mean():5.2f}% | hi-conf n={int(hi.sum()):5d} hit {100*hit[hi].mean() if hi.sum()>30 else float('nan'):5.2f}% | rmse {np.sqrt(((p-yt)**2).mean()):.3f}")

def fold_years(label_fn, feature_fn=None, params=None, seeds=(7,), tag=""):
    """returns per-year hit rates for a given label transform"""
    yl = label_fn()
    out = []
    for yr in range(2022, 2027):   # fewer folds for speed: 5 recent years
        tr = ds < f"{yr}-01-01"
        te = (ds >= f"{yr}-01-01") & (ds < f"{yr+1}-01-01")
        Xtr = feature_fn(X, tr) if feature_fn else X
        Xte = feature_fn(X, te) if feature_fn else X
        # feature_fn applied per date needs whole matrix; do simple variant below
        ps = []
        for s in seeds:
            prm = {**(params or BASE), "seed": s}
            m = lgb.train(prm, lgb.Dataset(X[tr], yl[tr]))
            ps.append(m.predict(X[te]))
        p = np.mean(ps, axis=0)
        yt = yl[te]
        hit = ((p > 0) == (yt > 0)); hi = np.abs(p) >= 1.0
        out.append((yr, 100*hit.mean(), 100*hit[hi].mean() if hi.sum() > 30 else None, int(hi.sum())))
        print(f"  {tag} {yr}: hit {100*hit.mean():5.2f}% hi {('%5.2f'%hit[hi].mean()) if hi.sum()>30 else '  n/a'}% (n={int(hi.sum())})")
    return out

print("== A) 5-seed ensemble, raw direction, 2022-2026 ==")
fold_years(lambda: y, seeds=(7,11,13,17,23), tag="ens5")

print("\n== B) 5-session forward direction (predict sign of 5-day return) ==")
# build 5-day forward label
fwd5 = np.full(len(y), np.nan)
idx_by_sym = {}
for i, mm in enumerate(meta): idx_by_sym.setdefault(mm["sym"], []).append(i)
for sym, idxs in idx_by_sym.items():
    idxs = np.array(idxs)
    for j in range(len(idxs)-5):
        i0 = idxs[j]; i5 = idxs[j+5]
        fwd5[i0] = y[idxs[j+1]] + y[idxs[j+2]] + y[idxs[j+3]] + y[idxs[j+4]] + y[idxs[j+5]]
ok = ~np.isnan(fwd5)
Xf, yf, dsf = X[ok], fwd5[ok], ds[ok]
print(f"  rows with 5d label: {ok.sum()}")
for yr in range(2022, 2027):
    tr = dsf < f"{yr}-01-01"; te = (dsf >= f"{yr}-01-01") & (dsf < f"{yr+1}-01-01")
    m = lgb.train(BASE, lgb.Dataset(Xf[tr], yf[tr]))
    p = m.predict(Xf[te]); yt = yf[te]
    hit = ((p>0)==(yt>0))
    print(f"  5d {yr}: hit {100*hit.mean():5.2f}%")

print("\n== C) volatility regime: will |next move| exceed the stock's trailing median |move|? ==")
import numpy as np
med = np.full(len(y), np.nan)
for sym, idxs in idx_by_sym.items():
    idxs = np.array(idxs)
    for j in range(60, len(idxs)):
        w = np.abs(y[idxs[j-60:j]])
        med[idxs[j]] = np.median(w)
okm = ~np.isnan(med)
Xm, dsm, medm, ym = X[okm], ds[okm], med[okm], y[okm]
for yr in range(2022, 2027):
    tr = dsm < f"{yr}-01-01"; te = (dsm >= f"{yr}-01-01") & (dsm < f"{yr+1}-01-01")
    lab = (np.abs(ym) > medm).astype(int)   # 1 = big move day
    m = lgb.train({**BASE, "objective":"binary"}, lgb.Dataset(Xm[tr], lab[tr]))
    prob = m.predict(Xm[te])
    pred = prob > 0.5
    acc = (pred == lab[te]).mean()
    base = max(lab[te].mean(), 1-lab[te].mean())
    print(f"  volregime {yr}: accuracy {100*acc:5.2f}% (majority baseline {100*base:5.2f}%)")
