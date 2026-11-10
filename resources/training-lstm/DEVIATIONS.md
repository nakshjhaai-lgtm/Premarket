# Deviations from the tutorial

Source: <https://www.datacamp.com/tutorial/lstm-python-stock-market> (Thushan Ganegedara, DataCamp).

The tutorial's code is reproduced in `lstm_stock_prediction.py` **verbatim**, in the
tutorial's own order, with no restructuring. This file records every place where the
world has moved on since the tutorial was written, what actually happens when the code
reaches that point, and what was done about it.

---

## 1. Nothing in the tutorial's logic was changed

Same data pipeline, same constants, same model, same optimiser, same number of epochs:

| Item | Value in this build |
| --- | --- |
| Data source flag | `data_source = 'alphavantage'` (you asked for Alpha Vantage) |
| Ticker | `AAL` |
| Train / test split | first 11,000 points train, remainder test |
| Windowed normalisation | `smoothing_window_size = 2500`, windows over `range(0,10000,2500)` |
| EMA smoothing of train data | `gamma = 0.1` |
| Standard-average baseline | `window_size = 100` |
| EMA baseline | `decay = 0.5` |
| `D` / `num_unrollings` / `batch_size` | `1` / `50` / `500` |
| `num_nodes` (3 LSTM layers) | `[200, 200, 150]` |
| `dropout` | `0.2` (output + state keep-prob `0.8`, input keep-prob `1.0`) |
| Regression head | `w [150,1]` xavier, `b` uniform `[-0.1, 0.1]` |
| Loss | `sum` over 50 unrollings of `mean(0.5*(pred-true)**2)` |
| Optimiser | Adam, `lr=0.0001`, floor `1e-6`, `exponential_decay(rate=0.5, staircase=True)` |
| Gradient clipping | `clip_by_global_norm(..., 5.0)` |
| Epochs | `30`, `valid_summary = 1`, `n_predict_once = 50` |
| Test prediction anchors | `np.arange(11000, 12000, 50)` |
| Final plot | `best_prediction_epoch = 28` |

## 2. The two value edits

Both are values, not logic, and both are marked `<<< EDIT` in the script:

1. `data_source` — the tutorial's file ships this as `'kaggle'`; set to `'alphavantage'`
   because you chose Alpha Vantage.
2. `api_key` — the tutorial's placeholder `'<your API key>'` replaced with the key you supplied.

## 3. Two statements call APIs that no longer exist

These are *pandas/numpy* removals, not TensorFlow ones. The tutorial was written against
pandas 0.22-era and numpy 1.14-era APIs. The pinned versions in this environment
(pandas 1.1.5, numpy 1.19.5) are the newest that still run on CPython 3.6, and both of
these APIs were already deprecated-but-present there, so they still execute:

| Tutorial statement | Status on pandas 1.1.5 / numpy 1.19.5 |
| --- | --- |
| `df.loc[:,'High'].as_matrix()` | works, emits `FutureWarning` (removed in pandas 1.0+ → actually removed; on 1.1.5 it is gone). See §4. |
| `np.asscalar(pred)` | works, emits `DeprecationWarning` (removed in numpy 1.23). |

## 4. `DataFrame.as_matrix()` — removed in pandas 1.0

`as_matrix()` was removed in pandas 1.0.0, so on pandas 1.1.5 this tutorial line raises
`AttributeError`:

```python
high_prices = df.loc[:,'High'].as_matrix()
low_prices  = df.loc[:,'Low'].as_matrix()
```

Rather than edit the tutorial text, `run.sh` launches it through `compat_runner.py`, which
re-attaches `as_matrix` (and `np.asscalar`, removed in numpy 1.23) with their documented,
behaviour-preserving definitions before the tutorial code executes. The tutorial source on
disk stays untouched. `as_matrix(columns=None)` is mapped to `to_numpy()`, which returns the
same 1-D float64 ndarray the original did. If you would rather have the edit inline, change
those two calls to `.to_numpy()` and run the script directly.

## 5. Alpha Vantage free tier cannot supply this dataset

This is a hard external limit, verified against your key on 2026-10-16 at ≤1 request/sec:

| Request | Result |
| --- | --- |
| `TIME_SERIES_DAILY&symbol=AAL&outputsize=full` | `Information: "The outputsize=full parameter value is a premium feature for the TIME_SERIES_DAILY endpoint."` |
| `TIME_SERIES_DAILY&symbol=AAL` (compact) | 100 rows, `2026-05-26 .. 2026-10-15` |
| `TIME_SERIES_DAILY&symbol=AAL&from_date=2006-01-01&to_date=2026-01-01` | 100 rows (date params ignored) |
| `TIME_SERIES_DAILY_ADJUSTED&symbol=AAL&outputsize=full` | `"This is a premium endpoint."` |
| `OVERVIEW&symbol=AAL` | `"This is a premium endpoint."` |

Alpha Vantage's own premium page states the free allowance is **25 API requests per day**
and that premium functions require a paid plan from $49.99/month.

The tutorial needs **more than 12,000 rows**: it hard-codes `train_data = mid_prices[:11000]`
and predicts at anchors `np.arange(11000, 12000, 50)` with `n_predict_once = 50`, so it
indexes up to `all_mid_data[12049]`. 100 rows cannot run it, and no code change can create
the missing history.

Note also that AAL cannot reach 12,000 rows from *any* source: American Airlines Group began
trading on 2005-09-27, roughly 5,300 trading days to 2026. The tutorial's own published
outputs correspond to its **kaggle** branch (`Stocks/hpq.us.txt`, HPQ, 12,075 daily rows from
1970-01-02) — the tutorial's `data_source` default. That file is present in this project and
reproduces the tutorial's printed `head()` exactly.

So: to run the Alpha Vantage branch you need a premium key; to run the tutorial as published
you use the kaggle branch. Both branches are in the script, untouched.

## 6. TensorFlow 1.6 requires CPython 3.6, and CPython 3.6 needs three portability fixes

`tensorflow==1.6.0` publishes wheels for `cp27, cp33, cp34, cp35, cp36` only. This machine
has Python 3.13, where `tf.contrib` does not exist and Keras 3 has removed every legacy RNN
cell. Rather than port the model, `setup_env.sh` builds CPython 3.6.15 from source and
installs the genuine TF 1.6.0 wheel, so `tf.contrib.rnn.LSTMCell`, `MultiRNNCell`,
`DropoutWrapper`, `LSTMStateTuple` and `tf.contrib.layers.xavier_initializer` are the real
2018 implementations.

Building CPython 3.6.15 on Debian 13 (glibc 2.41, gcc 14.2) needs these fixes, all recorded
in `setup_env.sh`:

1. **`sinpi` collision — the `math` module would not compile.** glibc 2.41's `<math.h>` now
   declares `sinpi`, which clashes with CPython 3.6's file-static
   `static double sinpi(double)` in `Modules/mathmodule.c`:
   `error: static declaration of 'sinpi' follows non-static declaration`.
   The function is used only by the gamma reflection formula, so it is renamed to `m_sinpi`.
   Numerics are unchanged — `math.gamma(0.5)` returns `1.7724538509055159`.

2. **gcc 14 vectorisation broke `ctypes` — and therefore TensorFlow.** This was the subtle
   one. `import tensorflow` segfaulted, and `faulthandler` pointed at
   `ctypes/__init__.py:273`, which is `CFUNCTYPE(c_int)(lambda: None)`. A gdb backtrace gave
   the faulting instruction:

   ```
   => movaps %xmm0, 0x60(%rbx)      # rbx = 0x7ffff7815368   (self)
   ```

   In `PyCFuncPtr_new` (`Modules/_ctypes/_ctypes.c:3556-3557`) gcc merged the two adjacent
   pointer stores `self->callable = callable; self->thunk = thunk;` into a single 16-byte
   `movaps`. `movaps` requires 16-byte alignment, but `PyObject_Malloc` only guarantees
   `SIZEOF_VOID_P` (8) alignment, and this object landed on an 8-mod-16 address — so the
   store faulted. gcc only auto-vectorises at `-O2` and above, which is why CPython 3.6
   built fine on 2018-era compilers. Fix: compile with `-fno-tree-vectorize`. This is a
   code-generation issue, not a libffi one.

3. **libffi version skew.** Debian ships libffi 3.4.8; CPython 3.6's `_ctypes` predates it.
   libffi 3.3 is built from source and `_ctypes` is compiled and linked against it via
   `CPPFLAGS`/`-L`/`rpath`, so headers and runtime match. Importantly,
   `/home/user/opt/libffi33/lib` is **not** placed on `LD_LIBRARY_PATH`: an earlier attempt
   aliased `libffi.so.7` as `libffi.so.8` there, and system libraries such as
   `libp11-kit.so.0` then resolved `libffi.so.8` to the 3.3 runtime and failed with
   ``version `LIBFFI_CLOSURE_8.0' not found``. `_ctypes` reaches libffi 3.3 through its own
   rpath, which does not affect anyone else.

4. **`ensurepip` segfaults during `make install`.** `make altinstall` is used instead and
   pip 21.3.1 is installed by unzipping its wheel (a wheel is just a zip). pip 21.3.1 is the
   last release supporting Python 3.6 and understands the `manylinux1` tags the TF 1.6.0
   wheel uses.

OpenSSL 1.1.1w is built from source too, since CPython 3.6 predates OpenSSL 3.x; the
resulting interpreter reports `OpenSSL 1.1.1w  11 Sep 2023`.

## 7. `best_prediction_epoch` is hard-coded to 28

The tutorial tells you to replace `28` with whichever epoch actually scored best in *your*
run. It is left at `28` because that is the value printed in the tutorial. In the completed
30-epoch run stored in `run_log_30_epochs.txt`, the best test MSE was `0.00231` at epoch 12,
so if you want the bottom subplot of `figures/04-*.png` to show *this* run's best rather than
epoch 28, set `best_prediction_epoch = 12` and re-run only the plotting cell (or re-run the
script; training is the expensive part and the tutorial offers no checkpointing).

## 8. Figures

There is no display in this environment, so `MPLBACKEND=Agg`, under which `plt.show()` is a
silent no-op and the tutorial's four figures would be discarded. `compat_runner.py` wraps
`plt.show()` so that each figure is also written to `figures/` before delegating to the real
`show()`. No plotting code in the tutorial was changed. `FIG_PREFIX` selects the filename
prefix so concurrent runs do not overwrite each other.

The four saved figures, in tutorial order:

1. `figures/01-data-exploration-mid-price.png` — mid price over the whole series
2. `figures/02-standard-average-one-step-prediction.png` — standard averaging, MSE 0.00418
3. `figures/03-exponential-moving-average-one-step-prediction.png` — EMA, MSE 0.00003
4. `figures/04-lstm-test-predictions-evolution-and-best.png` — evolution of the LSTM's test
   predictions over epochs (top) and the selected best epoch (bottom)
