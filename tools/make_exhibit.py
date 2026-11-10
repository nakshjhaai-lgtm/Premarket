#!/usr/bin/env python3
"""Build the public HPQ article-exhibit JSON from the exported training artifact.

Usage: python3 tools/make_exhibit.py <model.json> <assets/hpq-article.json>

Strips the weights (only the JS-packed NIFTY model needs those) and keeps
exactly what the dashboard exhibit renders: meta, scaler, final-epoch
predictions + x-axis, and the scaled actuals after the split.
"""
import json, sys

src, dst = sys.argv[1], sys.argv[2]
m = json.load(open(src))
ex = {
    "meta": {
        "name": m["meta"]["name"],
        "trained_at": m["meta"]["trained_at"],
        "data_file": m["meta"]["data_file"],
        "n_rows": m["meta"]["n_rows"],
        "split": m["meta"]["split"],
        "epochs": m["meta"]["epochs"],
        "num_nodes": m["meta"]["num_nodes"],
        "num_unrollings": m["meta"]["num_unrollings"],
        "batch_size": m["meta"]["batch_size"],
        "dropout": m["meta"]["dropout"],
        "best_test_mse": m["meta"]["best_test_mse"],
        "best_test_epoch": m["meta"]["best_test_epoch"],
        "final_train_loss": m["meta"]["final_train_loss"],
        "test_mse_by_epoch": m["meta"]["test_mse_by_epoch"],
        "train_loss_by_epoch": m["meta"]["train_loss_by_epoch"],
    },
    "scaler": m["scaler"],
    "split": m["meta"]["split"],
    "x_axis": m["x_axis_final_epoch"],
    "preds": m["test_predictions_final_epoch"],
    "actuals_tail": m["all_mid_tail"],
}
json.dump(ex, open(dst, "w"))
import os
print(f"wrote {dst} ({os.path.getsize(dst)} bytes)")
print(f"  x_axis points: {len(ex['x_axis'])}, preds: {len(ex['preds'])}, actuals: {len(ex['actuals_tail'])}")
print(f"  best test mse: {ex['meta']['best_test_mse']} @ epoch {ex['meta']['best_test_epoch']}")
