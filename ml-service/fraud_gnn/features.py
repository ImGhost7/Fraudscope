"""Graph construction and feature pipeline (shared by training, evaluation and inference).

Semantics
---------
* Node = bank account id (string).  Node indices are local to one WindowGraph and are only ever
  produced by `build_window_graph`; they are never confused with account ids.
* Edge = one transaction, directed sender -> receiver, in the original money-flow direction.
  `reverse` message-passing edges are added by the *model input builder* (`to_model_inputs`) and
  carry a direction flag, so a reverse message can never be mistaken for a real transfer.
* Time: epoch seconds (UTC).  Only transactions with  asof - window < ts <= asof  are used, so
  nothing after `asof` can influence a prediction.
* Static account attributes (KYC, status, balance, age) come from the accounts table; account
  type (SHELL/MULE), the rule engine's account risk score and any label are deliberately NOT used.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import networkx as nx
import numpy as np
import pandas as pd

from .config import BURST_SECONDS, CHANNELS, FAST_FORWARD_SECONDS, NEAR_THRESHOLD_AMOUNT

DAY = 86_400.0

NODE_FEATURES = [
    "out_cnt", "in_cnt", "out_sum", "in_sum", "out_mean", "in_mean", "out_max", "in_max",
    "out_uniq", "in_uniq", "flow_ratio", "retention", "near_thresh_out", "min_gap", "mean_gap",
    "burst30", "fast_forward_frac", "reciprocal_partners", "scc_size", "recency", "span_frac",
    "kyc_level", "status_dormant", "log_balance", "log_age_days", "log_dormancy_days",
]
EDGE_FEATURES = [
    "log_amount", "age_frac", "log_gap_since_prev_in", "forward_fraction", "has_prev_in",
    "hour_sin", "hour_cos", "near_threshold",
] + [f"channel_{c.lower()}" for c in CHANNELS]
N_NODE, N_EDGE = len(NODE_FEATURES), len(EDGE_FEATURES)
KYC = {"LOW": 0.0, "MEDIUM": 0.5, "HIGH": 1.0}


@dataclass
class CleanReport:
    received: int = 0
    kept: int = 0
    duplicates: int = 0
    invalid_amount: int = 0
    missing_time_or_ids: int = 0
    self_transfers: int = 0

    def as_dict(self):
        return self.__dict__.copy()


@dataclass
class WindowGraph:
    node_ids: List[str]
    index: Dict[str, int]
    x_raw: np.ndarray            # [N, N_NODE]
    edge_index: np.ndarray       # [2, E] forward (money-flow) edges, local node indices
    edge_attr: np.ndarray        # [E, N_EDGE]
    tx_ids: List[str]
    asof: float
    window_start: float
    facts: Dict[str, dict] = field(default_factory=dict)   # per-account human-readable structural facts


def clean_transactions(df: pd.DataFrame) -> Tuple[pd.DataFrame, CleanReport]:
    """Validate/normalise a transaction frame: tx_id, sender, receiver, amount, ts (+ optional channel)."""
    rep = CleanReport(received=len(df))
    if df.empty:
        return df.assign(channel=pd.Series(dtype=str)), rep
    d = df.copy()
    if "channel" not in d:
        d["channel"] = "MOBILE"
    d["amount"] = pd.to_numeric(d["amount"], errors="coerce")
    d["ts"] = pd.to_numeric(d["ts"], errors="coerce")
    miss = d["ts"].isna() | d["sender"].isna() | d["receiver"].isna() | d["tx_id"].isna()
    rep.missing_time_or_ids = int(miss.sum()); d = d[~miss]
    bad = ~np.isfinite(d["amount"]) | (d["amount"] <= 0)
    rep.invalid_amount = int(bad.sum()); d = d[~bad]
    selfx = d["sender"] == d["receiver"]
    rep.self_transfers = int(selfx.sum()); d = d[~selfx]
    dup = d.duplicated("tx_id", keep="first")
    rep.duplicates = int(dup.sum()); d = d[~dup]
    d = d.sort_values("ts", kind="stable").reset_index(drop=True)
    rep.kept = len(d)
    return d, rep


def _prev_incoming(d: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray]:
    """For each tx, time and amount of the sender's most recent EARLIER incoming transfer (NaN if none)."""
    inc = d[["receiver", "ts", "amount"]].rename(columns={"receiver": "acct", "ts": "prev_ts", "amount": "prev_amt"}).sort_values("prev_ts")
    left = d[["sender", "ts"]].rename(columns={"sender": "acct"}).reset_index().sort_values("ts")
    m = pd.merge_asof(left, inc, left_on="ts", right_on="prev_ts", by="acct", direction="backward", allow_exact_matches=False)
    m = m.sort_values("index")
    return m["prev_ts"].to_numpy(float), m["prev_amt"].to_numpy(float)


def build_window_graph(tx: pd.DataFrame, accounts: Optional[pd.DataFrame], asof: float, window_seconds: float,
                       prior_last_active: Optional[Dict[str, float]] = None) -> WindowGraph:
    """Build the directed transaction graph for (asof - window, asof] and compute raw features.

    tx must already be cleaned.  accounts: optional static table (account_id, kyc_level, status,
    balance, opened_ts).  prior_last_active: last activity strictly before the window per account
    (used for the dormancy feature); missing -> unknown, treated as "no long dormancy".
    """
    ws = asof - window_seconds
    d = tx[(tx.ts > ws) & (tx.ts <= asof)].sort_values("ts", kind="stable").reset_index(drop=True)
    if d.empty:
        return WindowGraph([], {}, np.zeros((0, N_NODE), np.float32), np.zeros((2, 0), np.int64),
                           np.zeros((0, N_EDGE), np.float32), [], asof, ws)
    node_ids = sorted(set(d.sender) | set(d.receiver))
    index = {a: i for i, a in enumerate(node_ids)}
    n = len(node_ids)
    s = d.sender.map(index).to_numpy(np.int64); r = d.receiver.map(index).to_numpy(np.int64)
    amt = d.amount.to_numpy(float); ts = d.ts.to_numpy(float)

    # ---- edge features -------------------------------------------------------------------------
    prev_ts, prev_amt = _prev_incoming(d)
    has_prev = ~np.isnan(prev_ts)
    gap = np.where(has_prev, ts - np.nan_to_num(prev_ts), window_seconds)
    frac = np.where(has_prev, np.clip(amt / np.where(has_prev, prev_amt, 1.0), 0, 2.0), 0.0)
    hour = (ts % DAY) / 3600.0
    near = ((amt >= 0.9 * NEAR_THRESHOLD_AMOUNT) & (amt < NEAR_THRESHOLD_AMOUNT)).astype(float)
    chan = d.channel.fillna("MOBILE").astype(str).str.upper().to_numpy()
    ea = np.column_stack([
        np.log1p(amt) / 12.0, (asof - ts) / window_seconds,
        np.log1p(np.minimum(gap, window_seconds)) / np.log1p(window_seconds),
        frac / 2.0, has_prev.astype(float),
        np.sin(2 * np.pi * hour / 24), np.cos(2 * np.pi * hour / 24), near,
        *[(chan == c).astype(float) for c in CHANNELS],
    ]).astype(np.float32)

    # ---- node features -------------------------------------------------------------------------
    def agg(idx, w=None, fn="sum"):
        out = np.zeros(n)
        if fn == "sum": np.add.at(out, idx, 1.0 if w is None else w)
        elif fn == "max": np.maximum.at(out, idx, w)
        return out
    out_cnt, in_cnt = agg(s), agg(r)
    out_sum, in_sum = agg(s, amt), agg(r, amt)
    out_max, in_max = agg(s, amt, "max"), agg(r, amt, "max")
    out_uniq = np.bincount(np.unique(np.column_stack([s, r]), axis=0)[:, 0], minlength=n).astype(float)
    in_uniq = np.bincount(np.unique(np.column_stack([s, r]), axis=0)[:, 1], minlength=n).astype(float)
    near_out = agg(s, near)
    ff = agg(s, ((gap <= FAST_FORWARD_SECONDS) & has_prev & (frac >= 0.8)).astype(float))

    # event stream (each tx is an event for both endpoints) for gap / burst features
    ev_node = np.concatenate([s, r]); ev_ts = np.concatenate([ts, ts])
    order = np.lexsort((ev_ts, ev_node)); ev_node, ev_ts = ev_node[order], ev_ts[order]
    same = np.r_[False, ev_node[1:] == ev_node[:-1]]
    gaps = np.where(same, np.r_[0.0, np.diff(ev_ts)], np.nan)
    gdf = pd.DataFrame({"n": ev_node, "g": gaps}).dropna()
    min_gap = np.full(n, window_seconds); mean_gap = np.full(n, window_seconds)
    if len(gdf):
        gg = gdf.groupby("n").g; min_gap[gg.min().index] = gg.min().to_numpy(); mean_gap[gg.mean().index] = gg.mean().to_numpy()
    key = ev_node.astype(float) * 1e9 + (ev_ts - ws)
    j = np.searchsorted(key, key + BURST_SECONDS, side="right")
    burst = np.zeros(n); np.maximum.at(burst, ev_node, (j - np.arange(len(key))).astype(float))
    first = np.full(n, np.inf); last = np.full(n, -np.inf)
    np.minimum.at(first, ev_node, ev_ts); np.maximum.at(last, ev_node, ev_ts)

    # structural (NetworkX): reciprocal partners and strongly-connected-component size
    G = nx.DiGraph(); G.add_nodes_from(range(n)); G.add_edges_from(zip(s.tolist(), r.tolist()))
    recip = np.array([sum(1 for v in G.successors(u) if G.has_edge(v, u)) for u in range(n)], float)
    scc = np.ones(n)
    for comp in nx.strongly_connected_components(G):
        if len(comp) > 1:
            for u in comp: scc[u] = len(comp)

    # static / account attributes
    kyc = np.full(n, 0.5); dormant = np.zeros(n); logbal = np.zeros(n); logage = np.zeros(n); logdorm = np.zeros(n)
    acc = None if accounts is None else accounts.set_index("account_id")
    for a, i in index.items():
        if acc is not None and a in acc.index:
            row = acc.loc[a]
            kyc[i] = KYC.get(str(row.get("kyc_level", "MEDIUM")).upper(), 0.5)
            dormant[i] = float(str(row.get("status", "ACTIVE")).upper() == "DORMANT")
            logbal[i] = np.log1p(max(float(row.get("balance", 0) or 0), 0))
            opened = row.get("opened_ts", np.nan)
            logage[i] = np.log1p(max((asof - float(opened)) / DAY, 0)) if pd.notna(opened) else 0.0
        pl = None if prior_last_active is None else prior_last_active.get(a)
        if pl is not None:
            logdorm[i] = np.log1p(max((first[i] - pl) / DAY, 0))

    x = np.column_stack([
        np.log1p(out_cnt), np.log1p(in_cnt), np.log1p(out_sum), np.log1p(in_sum),
        np.log1p(out_sum / np.maximum(out_cnt, 1)), np.log1p(in_sum / np.maximum(in_cnt, 1)),
        np.log1p(out_max), np.log1p(in_max), np.log1p(out_uniq), np.log1p(in_uniq),
        out_sum / (in_sum + out_sum + 1.0), np.clip((in_sum - out_sum) / (in_sum + 1.0), -1, 1),
        np.log1p(near_out), np.log1p(min_gap), np.log1p(mean_gap), np.log1p(burst), ff / np.maximum(out_cnt, 1),
        np.log1p(recip), np.log1p(scc), np.clip((asof - last) / window_seconds, 0, 1), np.clip((last - first) / window_seconds, 0, 1),
        kyc, dormant, logbal, logage, logdorm,
    ]).astype(np.float32)

    facts = {}
    for a, i in index.items():
        facts[a] = dict(out_degree=int(out_uniq[i]), in_degree=int(in_uniq[i]), out_tx=int(out_cnt[i]), in_tx=int(in_cnt[i]),
                        out_amount=float(out_sum[i]), in_amount=float(in_sum[i]), burst_30min=int(burst[i]),
                        fast_forwards=int(ff[i]), near_threshold_out=int(near_out[i]), reciprocal_partners=int(recip[i]),
                        scc_size=int(scc[i]))
    return WindowGraph(node_ids, index, x, np.vstack([s, r]), ea, d.tx_id.tolist(), asof, ws, facts)


def to_model_inputs(g: WindowGraph, x_scaled: np.ndarray):
    """Add reverse message-passing edges (direction flag = 1) next to the real edges (flag = 0)."""
    ei = g.edge_index
    fwd = np.hstack([g.edge_attr, np.zeros((ei.shape[1], 1), np.float32)])
    rev = np.hstack([g.edge_attr, np.ones((ei.shape[1], 1), np.float32)])
    edge_index = np.hstack([ei, ei[::-1]])
    edge_attr = np.vstack([fwd, rev]).astype(np.float32)
    return x_scaled.astype(np.float32), edge_index.astype(np.int64), edge_attr


def prior_last_activity(history: pd.DataFrame, window_start: float, initial: Optional[pd.Series] = None) -> Dict[str, float]:
    """Last activity of each account strictly BEFORE window_start (leak-free dormancy input)."""
    h = history[history.ts <= window_start]
    out = {}
    if not h.empty:
        a = pd.concat([h.groupby("sender").ts.max(), h.groupby("receiver").ts.max()], axis=1).max(axis=1)
        out = a.to_dict()
    if initial is not None:
        for k, v in initial.items():
            out[k] = max(out.get(k, -np.inf), v)
    return out
