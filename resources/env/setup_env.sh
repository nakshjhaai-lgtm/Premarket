#!/usr/bin/env bash
# Builds the exact environment the DataCamp LSTM tutorial needs:
#   Python 3.6.15 + TensorFlow 1.6.0
# TF 1.6.0 ships cp36 wheels only, so CPython 3.6 is required.
#
# Three portability problems have to be solved to build CPython 3.6 on
# Debian 13 (glibc 2.41, gcc 14):
#   1. glibc 2.41 declares sinpi(), which collides with CPython 3.6's own
#      static sinpi() in Modules/mathmodule.c  -> rename it to m_sinpi.
#   2. gcc 14 vectorises the adjacent `self->callable = ...; self->thunk = ...`
#      stores in Modules/_ctypes/_ctypes.c into one 16-byte-aligned `movaps`,
#      but PyObject_Malloc only guarantees 8-byte alignment, so building a
#      ctypes callback segfaults (ctypes/__init__.py:273, which TensorFlow hits
#      on import). Fix: -fno-tree-vectorize. Separately, Debian's libffi is
#      3.4.8 while CPython 3.6 expects 3.2/3.3, so libffi 3.3 is built and
#      _ctypes is pointed at it. CPython 3.6's _ctypes mis-uses it and
#      segfaults inside libffi closure allocation (ctypes/__init__.py:273).
#      -> build libffi 3.3 and force _ctypes to link against that exact
#         SONAME, so headers and runtime match.
#   3. `make install`'s ensurepip step segfaults -> use `make altinstall` and
#      bootstrap pip by unzipping the wheel (a wheel is just a zip).
set -uo pipefail

ROOT=/home/user
OPT=$ROOT/opt
SRC=$ROOT/src
BLD=$ROOT/build
WHEELS=$ROOT/wheels36
PY=$OPT/py36

log(){ echo "[$(date +%H:%M:%S)] $*"; }

rm -rf "$BLD"; mkdir -p "$BLD" "$OPT"

# ---------------------------------------------------------------- libffi 3.3
log "building libffi 3.3 (static + shared)"
cd "$BLD" && tar xzf "$SRC/libffi-3.3.tar.gz" && cd libffi-3.3
./configure --prefix="$OPT/libffi33" \
    CFLAGS="-O2 -fPIC -Wno-error -Wno-return-mismatch -Wno-incompatible-function-pointer-types -Wno-implicit-function-declaration" \
    > "$BLD/ffi_conf.log" 2>&1 || { log "FAIL libffi configure"; tail -20 "$BLD/ffi_conf.log"; exit 1; }
make -j2 > "$BLD/ffi_make.log" 2>&1 && make install > "$BLD/ffi_inst.log" 2>&1 \
  || { log "FAIL libffi make"; tail -20 "$BLD/ffi_make.log"; exit 1; }
# NOTE: do NOT alias libffi.so.7 as libffi.so.8. System libraries (libp11-kit)
# need the real libffi 8 versioned symbols and will crash if they resolve to a
# 3.3 runtime. _ctypes reaches libffi.so.7 through its own rpath instead.
log "libffi 3.3 -> $(ls "$OPT/libffi33/lib/" | tr '\n' ' ')"

# ------------------------------------------------------------ OpenSSL 1.1.1w
log "building OpenSSL 1.1.1w (CPython 3.6 cannot use OpenSSL 3.x)"
cd "$BLD" && tar xzf "$SRC/openssl-1.1.1w.tar.gz" && cd openssl-1.1.1w
./config --prefix="$OPT/openssl11" --openssldir="$OPT/openssl11" shared zlib no-tests \
    > "$BLD/ssl_conf.log" 2>&1 || { log "FAIL openssl configure"; tail -20 "$BLD/ssl_conf.log"; exit 1; }
make -j2 > "$BLD/ssl_make.log" 2>&1 && make install_sw > "$BLD/ssl_inst.log" 2>&1 \
  || { log "FAIL openssl make"; tail -20 "$BLD/ssl_make.log"; exit 1; }
log "OpenSSL -> $("$OPT/openssl11/bin/openssl" version 2>/dev/null)"

# ------------------------------------------------------------- CPython 3.6.15
log "building CPython 3.6.15"
cd "$BLD" && tar xf "$SRC/py36.tar.xz" && cd Python-3.6.15

# portability fix 1: glibc 2.41 already declares sinpi()
if grep -q "^sinpi(double x)" Modules/mathmodule.c; then
    sed -i 's/\bsinpi\b/m_sinpi/g' Modules/mathmodule.c
    log "patched mathmodule.c sinpi -> m_sinpi (glibc 2.41 collision)"
fi

RPATHS="-Wl,-rpath,$PY/lib -Wl,-rpath,$OPT/openssl11/lib -Wl,-rpath,$OPT/libffi33/lib"
./configure --prefix="$PY" --enable-shared --with-system-ffi --with-system-expat \
    CPPFLAGS="-I$OPT/openssl11/include -I$OPT/libffi33/include" \
    LDFLAGS="-L$OPT/libffi33/lib -L$OPT/openssl11/lib $RPATHS" \
    CFLAGS="-O2 -fPIC -std=gnu99 -Wno-error -fno-tree-vectorize" \
    > "$BLD/py_conf.log" 2>&1 || { log "FAIL python configure"; tail -20 "$BLD/py_conf.log"; exit 1; }
make -j2 > "$BLD/py_make.log" 2>&1 || { log "FAIL python make"; grep -nE "error:|Error [0-9]+" "$BLD/py_make.log" | head -20; exit 1; }
# portability fix 3: skip the segfaulting ensurepip step
make altinstall > "$BLD/py_inst.log" 2>&1
log "python installed: $("$PY/bin/python3.6" -c 'import sys;print(sys.version.split()[0])' 2>&1 | tail -1)"

# Force the _ctypes extension to be rebuilt against libffi 3.3 explicitly.
log "relinking _ctypes against libffi 3.3"
rm -f build/temp.linux-x86_64-3.6/tmp/*/Modules/_ctypes/*.o 2>/dev/null
rm -f build/lib.linux-x86_64-3.6/_ctypes*.so "$PY"/lib/python3.6/lib-dynload/_ctypes*.so 2>/dev/null
make -j2 > "$BLD/py_make2.log" 2>&1
make altinstall > "$BLD/py_inst2.log" 2>&1
log "_ctypes links: $(ldd "$PY"/lib/python3.6/lib-dynload/_ctypes.cpython-36m-x86_64-linux-gnu.so 2>/dev/null | grep -i ffi | tr -s ' ')"

export LD_LIBRARY_PATH="$PY/lib:$OPT/openssl11/lib"

log "ctypes closure test (5x)"
CTOK=0
for i in 1 2 3 4 5; do
    if "$PY/bin/python3.6" -c "import ctypes; assert ctypes.CFUNCTYPE(ctypes.c_int)(lambda: 42)() == 42" >/dev/null 2>&1; then
        CTOK=$((CTOK+1))
    fi
done
log "  ctypes passed $CTOK/5"
if [ "$CTOK" -lt 5 ]; then
    log "CTYPES STILL BROKEN -- aborting before wheel install"
    "$PY/bin/python3.6" -X faulthandler -c "import ctypes" 2>&1 | head -6
    exit 2
fi

# ------------------------------------------------------------------- packages
log "bootstrapping pip 21.3.1 by unzip"
SP=$("$PY/bin/python3.6" -c "import site;print(site.getsitepackages()[0])")
for w in pip-21.3.1-py3-none-any setuptools-59.6.0-py3-none-any wheel-0.37.1-py2.py3-none-any; do
    "$PY/bin/python3.6" -c "import zipfile;zipfile.ZipFile('$WHEELS/$w.whl').extractall('$SP')"
done
"$PY/bin/python3.6" -m pip --version

log "installing TensorFlow 1.6.0 + tutorial deps (from PyPI)"
"$PY/bin/python3.6" -m pip install -q --no-cache-dir \
    tensorflow==1.6.0 numpy==1.19.5 pandas==1.1.5 scikit-learn==0.24.2 \
    matplotlib==3.3.4 pandas-datareader==0.9.0 > "$BLD/pip.log" 2>&1 \
  || { log "FAIL pip install"; grep -viE "^INFO: pip is looking|^Processing " "$BLD/pip.log" | tail -15; exit 1; }

log "verifying imports"
"$PY/bin/python3.6" - <<'PYEOF' 2>&1 | grep -viE "tensorflow/core/platform|Instructions for updating|future version"
import sys, numpy, pandas, sklearn, matplotlib
import tensorflow as tf
print("python      ", sys.version.split()[0])
print("tensorflow  ", tf.__version__)
print("numpy       ", numpy.__version__)
print("pandas      ", pandas.__version__)
print("scikit-learn", sklearn.__version__)
print("matplotlib  ", matplotlib.__version__)
import pandas_datareader.data
from sklearn.preprocessing import MinMaxScaler
print("pandas_datareader.data / MinMaxScaler: OK")
for a in ["contrib.rnn.LSTMCell","contrib.rnn.MultiRNNCell","contrib.rnn.DropoutWrapper",
          "contrib.rnn.LSTMStateTuple","contrib.layers.xavier_initializer",
          "nn.dynamic_rnn","nn.xw_plus_b","train.AdamOptimizer","train.exponential_decay",
          "InteractiveSession","clip_by_global_norm","random_uniform"]:
    o = tf
    for p in a.split("."):
        o = getattr(o, p)
    assert o is not None, a
print("tf.contrib.rnn.* and all tutorial TF 1.6 APIs: OK")
print("np.asscalar present:", hasattr(numpy, "asscalar"))
print("DataFrame.as_matrix present:", hasattr(pandas.DataFrame([1]), "as_matrix"))
PYEOF

log "ENVIRONMENT_READY"
