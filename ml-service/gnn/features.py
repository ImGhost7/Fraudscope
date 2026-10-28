"""Node / edge / time features for one temporal window (leakage-free: only that window's events)."""
import numpy as np
import pandas as pd
from gen_data import N_ACC, THRESH

NODE_COLS = [
    "out_cnt", "in_cnt", "out_sum", "in_sum", "out_mean", "in_mean", "out_max", "in_max",
    "out_uniq", "in_uniq", "out_in_ratio", "retention", "near_thresh", "min_gap", "mean_gap",
    "burst30", "active_span",
]


def node_features(w: pd.DataFrame, t0: float, t1: float) -> np.ndarray:
    X = pd.DataFrame(0.0, index=range(N_ACC), columns=NODE_COLS)
    o = w.groupby("sender").amount.agg(["count", "sum", "mean", "max"])
    i = w.groupby("receiver").amount.agg(["count", "sum", "mean", "max"])
    X.loc[o.index, ["out_cnt", "out_sum", "out_mean", "out_max"]] = o.values
    X.loc[i.index, ["in_cnt", "in_sum", "in_mean", "in_max"]] = i.values
    X.loc[w.groupby("sender").receiver.nunique().index, "out_uniq"] = w.groupby("sender").receiver.nunique().values
    X.loc[w.groupby("receiver").sender.nunique().index, "in_uniq"] = w.groupby("receiver").sender.nunique().values
    X["out_in_ratio"] = X.out_sum / (X.in_sum + 1)
    X["retention"] = np.where(X.in_sum > 0, (X.in_sum - X.out_sum) / (X.in_sum + 1), 0.0)
    nt = w[(w.amount >= 0.9 * THRESH) & (w.amount < THRESH)].groupby("sender").size()
    X.loc[nt.index, "near_thresh"] = nt.values
    # time features per account: inter-event gaps and 30-minute burst size
    ev = pd.concat([w[["sender", "ts"]].rename(columns={"sender": "a"}), w[["receiver", "ts"]].rename(columns={"receiver": "a"})]).sort_values(["a", "ts"])
    ev["gap"] = ev.groupby("a").ts.diff()
    g = ev.groupby("a").gap
    X.loc[g.min().index, "min_gap"] = g.min().fillna(DAYSEC := 86400).values
    X.loc[g.mean().index, "mean_gap"] = g.mean().fillna(86400).values
    X["min_gap"] = np.where(X.min_gap == 0, 86400, X.min_gap)
    X["mean_gap"] = np.where(X.mean_gap == 0, 86400, X.mean_gap)
    for a, ts in ev.groupby("a").ts:
        v = ts.values
        j = np.searchsorted(v, v + 1800, side="right")
        X.loc[a, "burst30"] = (j - np.arange(len(v))).max()
        X.loc[a, "active_span"] = v[-1] - v[0]
    X = X.values.astype(np.float32)
    # log-scale heavy tails, then standardise
    X = np.log1p(np.abs(X)) * np.sign(X)
    return X


def edge_features(w: pd.DataFrame, t1: float, t0: float):
    """Per-transaction temporal attributes: amount, recency, hop latency (time since the sender
    last received money) and forwarded fraction of that incoming amount."""
    w = w.sort_values("ts").reset_index(drop=True)
    last_in_t, last_in_a = {}, {}
    gap = np.full(len(w), 86400.0); frac = np.zeros(len(w))
    for k, (ts, s, r, a) in enumerate(zip(w.ts.values, w.sender.values, w.receiver.values, w.amount.values)):
        if s in last_in_t:
            gap[k] = ts - last_in_t[s]; frac[k] = min(a / (last_in_a[s] + 1e-9), 2.0)
        last_in_t[r] = ts; last_in_a[r] = a
    ea = np.stack([
        np.log1p(w.amount.values) / 12.0,
        (t1 - w.ts.values) / (t1 - t0),
        np.log1p(np.minimum(gap, 86400)) / np.log1p(86400),
        frac,
        (np.abs(w.amount.values - THRESH * 0.95) < 0.05 * THRESH).astype(float),
    ], 1).astype(np.float32)
    return w, ea
