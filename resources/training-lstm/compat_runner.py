"""
Compatibility shim loaded *around* the tutorial script. It exists so that
`lstm_stock_prediction.py` can stay byte-for-byte identical to the DataCamp
tutorial.

The tutorial calls two APIs that were deprecated after it was written:

  * pandas  DataFrame.as_matrix()   -- removed in pandas 1.0
  * numpy   np.asscalar()           -- removed in numpy 1.23

The pinned versions here (pandas 1.1.5 / numpy 1.19.5, the newest that run on
CPython 3.6) still have `np.asscalar`, but `as_matrix` is already gone. Both
are restored here with their documented, behaviour-preserving equivalents, so
the tutorial line

    high_prices = df.loc[:,'High'].as_matrix()

runs unchanged and returns exactly what it returned in 2018: a 1-D float64
ndarray holding that column.

Usage:  python3.6 compat_runner.py lstm_stock_prediction.py
"""
import runpy
import sys

import numpy as np
import pandas as pd


def _install_pandas_as_matrix():
    """Re-attach DataFrame.as_matrix / Series.as_matrix as pandas defined them.

    The original signature was `as_matrix(self, columns=None)` and it returned
    `self.values` (an ndarray) when no columns were given.
    """
    def as_matrix(self, columns=None):
        if columns is not None:
            return self[columns].to_numpy()
        return self.to_numpy()

    if not hasattr(pd.DataFrame, "as_matrix"):
        pd.DataFrame.as_matrix = as_matrix
    if not hasattr(pd.Series, "as_matrix"):
        pd.Series.as_matrix = as_matrix


def _install_numpy_asscalar():
    """np.asscalar(a) was documented as exactly `a.item()`."""
    if not hasattr(np, "asscalar"):
        def asscalar(a):
            return a.item()
        np.asscalar = asscalar


def _install_matplotlib_saving(outdir="figures"):
    """Make plt.show() also write the figure to disk.

    There is no display in this sandbox, so MPLBACKEND is Agg and plt.show() is
    a silent no-op -- the tutorial's four figures would simply be lost. This
    wraps show() so each figure is saved to figures/fig-NN.png first. The
    tutorial's plotting code itself is untouched.
    """
    import os

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    prefix = os.environ.get("FIG_PREFIX", "fig-")
    os.makedirs(outdir, exist_ok=True)
    counter = [0]
    real_show = plt.show

    def show(*a, **k):
        fig = plt.gcf()
        if fig.get_axes():
            counter[0] += 1
            path = os.path.join(outdir, "%s%02d.png" % (prefix, counter[0]))
            fig.savefig(path, dpi=110, bbox_inches="tight")
            sys.stdout.write("[saved %s]\n" % path)
            sys.stdout.flush()
        return real_show(*a, **k)

    plt.show = show


_install_pandas_as_matrix()
_install_numpy_asscalar()
_install_matplotlib_saving()

if len(sys.argv) < 2:
    sys.stderr.write("usage: compat_runner.py <script.py> [args...]\n")
    raise SystemExit(2)

target = sys.argv[1]
sys.argv = sys.argv[1:]          # the script should see itself as argv[0]
runpy.run_path(target, run_name="__main__")
