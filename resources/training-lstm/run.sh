#!/usr/bin/env bash
# Runner for the DataCamp LSTM stock-prediction tutorial.
#
# The tutorial's model code targets TensorFlow 1.6 (`tf.contrib.rnn.*`).
# TF 1.6.0 only ships wheels for CPython 3.6, so this project pins a
# dedicated Python 3.6.15 interpreter built from source into /home/user/py36.
#
# Usage:
#   ./run.sh                 # run the whole tutorial end to end
#   ./run.sh --smoke         # env check only: versions + a tiny LSTM train step
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY36=/home/user/opt/py36/bin/python3.6

# NB: /home/user/opt/libffi33/lib is deliberately NOT on LD_LIBRARY_PATH.
# Python's _ctypes finds libffi.so.7 through its own rpath; putting that
# directory on the global search path made system libraries resolve libffi.so.8
# to a 3.3 runtime and crash.
export LD_LIBRARY_PATH="/home/user/opt/py36/lib:/home/user/opt/openssl11/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# TensorFlow 1.6 is very chatty and single-threaded workloads thrash on 2 cores.
export TF_CPP_MIN_LOG_LEVEL="${TF_CPP_MIN_LOG_LEVEL:-0}"
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-2}"
export MPLBACKEND=Agg          # no display in this sandbox; figures go to PNG

if [[ ! -x "$PY36" ]]; then
  echo "FATAL: $PY36 not found. Rebuild it with ./setup_env.sh" >&2
  exit 1
fi

cd "$HERE"

if [[ "${1:-}" == "--smoke" ]]; then
  exec "$PY36" smoke_test.py
fi

if [[ "${1:-}" == "--fig1" || "${1:-}" == "--baselines" ]]; then
  # fast deterministic section: exploration plot + the two averaging baselines
  export FIG_PREFIX="${FIG_PREFIX:-base-}"
  exec "$PY36" -u compat_runner.py make_baselines.py
fi

mkdir -p figures
# The tutorial source is executed verbatim; compat_runner.py only restores two
# pandas/numpy APIs the tutorial calls that have since been removed. See
# DEVIATIONS.md section 4.
exec "$PY36" -u compat_runner.py lstm_stock_prediction.py "$@"
