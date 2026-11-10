import json, numpy as np, lightgbm as lgb

X = np.load("X.npy"); y = np.load("y.npy")
meta = json.load(open("meta.json")); FEATURES = json.load(open("features.json"))

BASE = dict(objective="regression", metric="rmse", num_leaves=63, learning_rate=0.03,
            n_estimators=800, min_child_samples=300, feature_fraction=0.9,
            bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=7)
m = lgb.train(BASE, lgb.Dataset(X, y))

# strip dump to essentials for a small JS bundle
def strip(node):
    if "leaf_value" in node or ("split_feature" not in node):
        return [float(node["leaf_value"])]
    return [int(node["split_feature"]), float(node["threshold"]),
            bool(node.get("default_left", True)), strip(node["left_child"]), strip(node["right_child"])]
dump = m.dump_model()
trees = [strip(t["tree_structure"]) for t in dump["tree_info"]]
out = {"features": FEATURES, "trees": trees, "n": len(trees)}
json.dump(out, open("gbm_final.json", "w"), separators=(",", ":"))
import os
print("trees:", len(trees), "| size: %.2f MB" % (os.path.getsize("gbm_final.json") / 1e6))

# parity: raw python predict vs manual tree-walk on stripped trees
def walk(node, x):
    if len(node) == 1: return node[0]
    f, thr, dl, l, r = node
    v = x[f]
    if v != v: return walk(l if dl else r, x)
    return walk(l if v <= thr else r, x)

rng = np.random.default_rng(1); idx = rng.choice(len(X), 500, replace=False)
p_lgb = m.predict(X[idx])
p_manual = np.array([sum(walk(t, X[i]) for t in trees) for i in idx])
print("parity lgb vs manual walk: max diff %.2e" % np.abs(p_lgb - p_manual).max())

# sanity: feature importance top 8
imp = m.feature_importance("gain")
for i in np.argsort(-imp)[:8]:
    print(f"  {FEATURES[i]:9s} {imp[i]:12.0f}")
