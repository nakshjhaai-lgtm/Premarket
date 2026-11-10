"""
Environment check for the DataCamp LSTM tutorial.

Confirms that the interpreter can actually build and train the tutorial's exact
model structure -- a 3-layer stacked tf.contrib.rnn.LSTMCell with a
DropoutWrapper, driven through tf.nn.dynamic_rnn over `num_unrollings` steps,
optimised by tf.train.AdamOptimizer inside a tf.InteractiveSession.

This is a throwaway probe, not part of the tutorial. It uses the tutorial's own
hyperparameters but a handful of steps so it finishes in seconds.
"""
import sys
import numpy as np

print("python      ", sys.version.split()[0])
import tensorflow as tf
print("tensorflow  ", tf.__version__)
import numpy, pandas, sklearn, matplotlib
print("numpy       ", numpy.__version__)
print("pandas      ", pandas.__version__)
print("scikit-learn", sklearn.__version__)
print("matplotlib  ", matplotlib.__version__)
import pandas_datareader.data  # noqa: F401  (the tutorial imports this)
print("pandas_datareader.data import: OK")
from sklearn.preprocessing import MinMaxScaler  # noqa: F401
print("MinMaxScaler import: OK")

# ---- the exact tutorial hyperparameters (block 19) -------------------------
D = 1
num_unrollings = 50
batch_size = 500
num_nodes = [200, 200, 150]
n_layers = len(num_nodes)
dropout = 0.2

tf.reset_default_graph()

train_inputs, train_outputs = [], []
for ui in range(num_unrollings):
    train_inputs.append(tf.placeholder(tf.float32, shape=[batch_size, D], name='train_inputs_%d' % ui))
    train_outputs.append(tf.placeholder(tf.float32, shape=[batch_size, 1], name='train_outputs_%d' % ui))

lstm_cells = [
    tf.contrib.rnn.LSTMCell(num_units=num_nodes[li],
                            state_is_tuple=True,
                            initializer=tf.contrib.layers.xavier_initializer())
    for li in range(n_layers)]

drop_lstm_cells = [tf.contrib.rnn.DropoutWrapper(
    lstm, input_keep_prob=1.0, output_keep_prob=1.0 - dropout, state_keep_prob=1.0 - dropout
) for lstm in lstm_cells]
drop_multi_cell = tf.contrib.rnn.MultiRNNCell(drop_lstm_cells)
multi_cell = tf.contrib.rnn.MultiRNNCell(lstm_cells)

w = tf.get_variable('w', shape=[num_nodes[-1], 1], initializer=tf.contrib.layers.xavier_initializer())
b = tf.get_variable('b', initializer=tf.random_uniform([1], -0.1, 0.1))

c, h = [], []
initial_state = []
for li in range(n_layers):
    c.append(tf.Variable(tf.zeros([batch_size, num_nodes[li]]), trainable=False))
    h.append(tf.Variable(tf.zeros([batch_size, num_nodes[li]]), trainable=False))
    initial_state.append(tf.contrib.rnn.LSTMStateTuple(c[li], h[li]))

all_inputs = tf.concat([tf.expand_dims(t, 0) for t in train_inputs], axis=0)
all_lstm_outputs, state = tf.nn.dynamic_rnn(
    drop_multi_cell, all_inputs, initial_state=tuple(initial_state),
    time_major=True, dtype=tf.float32)
all_lstm_outputs = tf.reshape(all_lstm_outputs, [batch_size * num_unrollings, num_nodes[-1]])
all_outputs = tf.nn.xw_plus_b(all_lstm_outputs, w, b)
split_outputs = tf.split(all_outputs, num_unrollings, axis=0)

loss = 0.0
with tf.control_dependencies([tf.assign(c[li], state[li][0]) for li in range(n_layers)] +
                             [tf.assign(h[li], state[li][1]) for li in range(n_layers)]):
    for ui in range(num_unrollings):
        loss += tf.reduce_mean(0.5 * (split_outputs[ui] - train_outputs[ui]) ** 2)

global_step = tf.Variable(0, trainable=False)
inc_gstep = tf.assign(global_step, global_step + 1)
tf_learning_rate = tf.placeholder(shape=None, dtype=tf.float32)
tf_min_learning_rate = tf.placeholder(shape=None, dtype=tf.float32)
learning_rate = tf.maximum(
    tf.train.exponential_decay(tf_learning_rate, global_step, decay_steps=1, decay_rate=0.5, staircase=True),
    tf_min_learning_rate)

optimizer = tf.train.AdamOptimizer(learning_rate)
gradients, v = zip(*optimizer.compute_gradients(loss))
gradients, _ = tf.clip_by_global_norm(gradients, 5.0)
optimizer = optimizer.apply_gradients(zip(gradients, v))

# prediction-side graph (block 25)
sample_inputs = tf.placeholder(tf.float32, shape=[1, D])
sample_c, sample_h, initial_sample_state = [], [], []
for li in range(n_layers):
    sample_c.append(tf.Variable(tf.zeros([1, num_nodes[li]]), trainable=False))
    sample_h.append(tf.Variable(tf.zeros([1, num_nodes[li]]), trainable=False))
    initial_sample_state.append(tf.contrib.rnn.LSTMStateTuple(sample_c[li], sample_h[li]))
reset_sample_states = tf.group(*[tf.assign(sample_c[li], tf.zeros([1, num_nodes[li]])) for li in range(n_layers)],
                               *[tf.assign(sample_h[li], tf.zeros([1, num_nodes[li]])) for li in range(n_layers)])
sample_outputs, sample_state = tf.nn.dynamic_rnn(multi_cell, tf.expand_dims(sample_inputs, 0),
                                                 initial_state=tuple(initial_sample_state),
                                                 time_major=True, dtype=tf.float32)
with tf.control_dependencies([tf.assign(sample_c[li], sample_state[li][0]) for li in range(n_layers)] +
                             [tf.assign(sample_h[li], sample_state[li][1]) for li in range(n_layers)]):
    sample_prediction = tf.nn.xw_plus_b(tf.reshape(sample_outputs, [1, -1]), w, b)

n_trainable = int(sum(np.prod(x.get_shape().as_list()) for x in tf.trainable_variables()))
print("\ntrainable parameters in the tutorial's model: {:,}".format(n_trainable))

session = tf.InteractiveSession()
tf.global_variables_initializer().run()
print("session initialised: OK")

# a few real optimiser steps on synthetic data shaped exactly like the generator's
rng = np.random.RandomState(0)
prices = np.cumsum(rng.randn(4000) * 0.01)
prices = (prices - prices.min()) / (prices.max() - prices.min())

for step in range(3):
    feed_dict = {}
    for ui in range(num_unrollings):
        idx = rng.randint(0, len(prices) - 6, size=batch_size)
        feed_dict[train_inputs[ui]] = prices[idx].reshape(-1, 1).astype(np.float32)
        feed_dict[train_outputs[ui]] = prices[idx + rng.randint(1, 5, size=batch_size)].reshape(-1, 1).astype(np.float32)
    feed_dict.update({tf_learning_rate: 0.0001, tf_min_learning_rate: 0.000001})
    _, l = session.run([optimizer, loss], feed_dict=feed_dict)
    print("  step %d loss=%f" % (step + 1, l))

# exercise the prediction path too
session.run(reset_sample_states)
cur = 0.5
for i in range(5):
    p = session.run(sample_prediction, feed_dict={sample_inputs: np.array(cur).reshape(1, 1)})
    cur = float(np.asscalar(p))
print("  5-step recursive prediction ran, last=%.6f" % cur)
session.run(inc_gstep)
print("\nSMOKE TEST PASSED -- the tutorial's graph builds and trains on TF %s" % tf.__version__)
