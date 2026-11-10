# LSTM for stock prediction — DataCamp tutorial, built and run

An implementation of the tutorial at
<https://www.datacamp.com/tutorial/lstm-python-stock-market> (Thushan Ganegedara, DataCamp).

`lstm_stock_prediction.py` is the tutorial's own code, transcribed verbatim and assembled in
the tutorial's order. Nothing in its logic was changed. Every value, constant, layer size,
loss term, optimiser setting and plot call is the tutorial's. Where the outside world has
moved on since it was written, that is recorded in [`DEVIATIONS.md`](DEVIATIONS.md) rather
than patched into the source.

## Layout

| Path | What it is |
| --- | --- |
| `lstm_stock_prediction.py` | The tutorial, verbatim, top to bottom |
| `compat_runner.py` | Restores two removed pandas/numpy APIs so the tutorial runs unedited |
| `run.sh` | Runner: sets `LD_LIBRARY_PATH`, picks the Python 3.6 interpreter, saves figures |
| `smoke_test.py` | Builds and trains the tutorial's exact graph for 3 steps to prove the env works |
| `../setup_env.sh` | Builds CPython 3.6.15 + OpenSSL 1.1.1w + libffi 3.3 and installs TensorFlow 1.6.0 |
| `../wheels36/` | Every wheel, pre-downloaded, so the install is fully offline |
| `../Stocks/hpq.us.txt` | The Kaggle HPQ series the tutorial's default branch reads |
| `figures/` | PNG output (there is no display here, so `MPLBACKEND=Agg`) |

## Running it

```bash
cd /home/user/lstm-stock
./run.sh --smoke       # ~1 min: prove TF 1.6 builds and trains the tutorial's exact graph
./run.sh --baselines   # ~5 s: exploration plot + both averaging baselines and their plots
./run.sh               # the full tutorial: 30 epochs (the Alpha Vantage branch)
```

A completed 30-epoch run of the kaggle branch is already in this project:
`run_log_30_epochs.txt` plus the four figures in `figures/`.

On this box (2 cores, 2 GB RAM + 6 GB swap I added, no GPU) one epoch takes ~45 s, so the
full run finished in ~25 min. Your numbers will differ in the low-order digits because the
tutorial never seeds a RNG; the structure and the MSE magnitudes reproduce.

## Results obtained here (kaggle branch, HPQ, 30 epochs)

| Quantity | This run | Tutorial's published value |
| --- | --- | --- |
| MSE, standard averaging | `0.00418` | `0.00418` |
| MSE, EMA averaging | `0.00003` | `0.00003` |
| Train loss, epoch 30 | `0.040059` | `0.033753` |
| Test MSE, epoch 30 | `0.00245` | `0.00243` |
| Best test MSE | `0.00231` at epoch 12 | (author used epoch 28 on their machine) |

The two baseline MSEs match the tutorial's printed output to every published digit. The
LSTM's loss/MSE are in the same range but not identical — expected, since the data generator
samples labels at random (`np.random.randint(0,5)`) and no seed is set anywhere in the
tutorial. Per the tutorial's own instruction, `best_prediction_epoch` in the plotting cell
should be set to the best epoch of *your* run; it is left at the tutorial's `28`, and for
this run that would be `12`.

## Why a separate Python 3.6 interpreter

The tutorial's model is written against TensorFlow 1.6 and uses `tf.contrib.rnn.LSTMCell`,
`MultiRNNCell`, `DropoutWrapper`, `LSTMStateTuple` and `tf.contrib.layers.xavier_initializer`.
`tf.contrib` was deleted in TensorFlow 2.0, and Keras 3 removed every legacy RNN cell, so on
this machine's Python 3.13 that code cannot run in any form. `tensorflow==1.6.0` publishes
wheels for CPython 2.7 and 3.3–3.6 only, so the genuine article requires CPython 3.6.

`setup_env.sh` therefore builds CPython 3.6.15 from source and installs the real TF 1.6.0
wheel. Getting a 2016-era interpreter to build on Debian 13 (glibc 2.41, gcc 14.2, OpenSSL
3.5) took four separate fixes; each one is explained in
[`DEVIATIONS.md` §6](DEVIATIONS.md). The interesting one: gcc 14 auto-vectorises two adjacent
pointer stores in CPython's `_ctypes.c` into an alignment-checked `movaps`, which segfaults
because `PyObject_Malloc` only guarantees 8-byte alignment — and TensorFlow imports `ctypes`,
so `import tensorflow` died before running a single op.

## Data

You asked for Alpha Vantage, so the script is set to `data_source = 'alphavantage'` with
`ticker = "AAL"` and your key in place, exactly as the tutorial's Alpha Vantage branch
expects.

That branch cannot currently produce data. Alpha Vantage made `outputsize=full` on
`TIME_SERIES_DAILY` a premium feature, and `TIME_SERIES_DAILY_ADJUSTED` and `OVERVIEW`
premium endpoints; the free tier is 25 requests per day and returns 100 rows of history. The
tutorial requires more than 12,000 rows (11,000 training points plus predictions anchored at
indices 11,000–11,950 rolling 50 steps ahead). `DEVIATIONS.md` §5 has the full evidence,
including the verbatim API responses.

Two consequences worth knowing before you spend money on a premium plan:

* AAL cannot reach 12,000 daily rows from any source. American Airlines Group started trading
  on 2005-09-27 — about 5,300 trading days to 2026. Even with `outputsize=full` unlocked, the
  AAL branch will fail the tutorial's hard-coded 11,000-point split.
* The outputs the tutorial prints and plots correspond to its **kaggle** branch: HPQ, 12,075
  daily rows from 1970-01-02. That file is in `../Stocks/hpq.us.txt` and reproduces the
  tutorial's `head()` output exactly. Setting `data_source = 'kaggle'` runs the tutorial as
  published.

Both branches are present in the script, untouched.
