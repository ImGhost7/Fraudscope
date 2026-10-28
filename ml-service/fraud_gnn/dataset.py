"""Snapshot dataset: one graph per (period, as-of time); labels from scenario actors in that window."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

import numpy as np
import pandas as pd

from .features import WindowGraph, build_window_graph, clean_transactions, prior_last_activity


@dataclass
class Snapshot:
    period: str
    asof: float
    graph: WindowGraph
    y: np.ndarray                 # [N] 0/1
    scenario: List[str]           # per node: scenario family of its fraud involvement ("" if none)
    variant: List[str]


def snapshot_times(lo: float, hi: float, window: float, stride: float) -> List[float]:
    """As-of times whose whole window lies inside [lo, hi] -> no window crosses a split boundary."""
    t = lo + window
    out = []
    while t <= hi + 1e-6:
        out.append(t); t += stride
    return out


def node_labels(g: WindowGraph, tx_window: pd.DataFrame):
    y = np.zeros(len(g.node_ids), np.float32); scen = [""] * len(g.node_ids); var = [""] * len(g.node_ids)
    f = tx_window[tx_window.fraud == 1]
    for row in f.itertuples(index=False):
        for acct, actor in ((row.sender, row.s_actor), (row.receiver, row.r_actor)):
            if actor and acct in g.index:
                i = g.index[acct]; y[i] = 1.0
                if not scen[i]: scen[i], var[i] = row.scenario, row.variant
    return y, scen, var


def build_snapshots(tx: pd.DataFrame, accounts: pd.DataFrame, bounds: Dict[str, tuple], window: float, stride: float,
                    periods=("train", "val", "test")) -> List[Snapshot]:
    cols = ["tx_id", "sender", "receiver", "amount", "ts", "channel"]
    clean, _ = clean_transactions(tx[cols])
    meta = tx.set_index("tx_id")[["fraud", "scenario", "variant", "s_actor", "r_actor"]]
    initial = accounts.set_index("account_id").initial_last_active
    snaps = []
    for p in periods:
        lo, hi = bounds[p]
        for asof in snapshot_times(lo, hi, window, stride):
            ws = asof - window
            prior = prior_last_activity(clean[clean.ts <= ws], ws, initial)
            g = build_window_graph(clean, accounts, asof, window, prior)
            if not g.node_ids:
                continue
            win = clean[(clean.ts > ws) & (clean.ts <= asof)].join(meta, on="tx_id")
            y, sc, va = node_labels(g, win)
            snaps.append(Snapshot(p, asof, g, y, sc, va))
    return snaps
