"""Inference: artifact loading/validation, rolling graph store, account-risk prediction + evidence."""
from __future__ import annotations

import json
import threading
import time
from collections import deque
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from .config import ARTIFACT_DIR, MAX_STORE_TRANSACTIONS, NEAR_THRESHOLD_AMOUNT, WINDOW_HOURS, anchor_score, risk_level
from .features import EDGE_FEATURES, NODE_FEATURES, N_EDGE, N_NODE, WindowGraph, build_window_graph, clean_transactions, to_model_inputs
from .preprocess import NodeScaler

REQUIRED_FILES = ["model.pt", "config.json", "scaler.json", "metadata.json"]


class ArtifactError(Exception):
    """Raised when model artifacts are missing or incompatible with the running code."""


def parse_ts(v) -> float:
    """ISO-8601 string / epoch seconds / epoch ms -> epoch seconds (UTC).  Naive datetimes are treated as UTC."""
    if v is None:
        raise ValueError("missing timestamp")
    if isinstance(v, (int, float, np.integer, np.floating)):
        f = float(v)
        return f / 1000.0 if f > 1e11 else f
    t = pd.to_datetime(str(v), utc=True, errors="raise")
    return t.timestamp()


class LoadedModel:
    def __init__(self, directory: Path):
        import torch
        from .model import GraphSAGEClassifier
        missing = [f for f in REQUIRED_FILES if not (directory / f).is_file()]
        if missing:
            raise ArtifactError(f"missing model artifacts: {', '.join(missing)} (run `python -m fraud_gnn.train`)")
        try:
            self.config = json.loads((directory / "config.json").read_text())
            self.meta = json.loads((directory / "metadata.json").read_text())
            self.scaler = NodeScaler.from_dict(json.loads((directory / "scaler.json").read_text()))
        except Exception as e:  # noqa: BLE001
            raise ArtifactError(f"artifact files unreadable or incompatible: {type(e).__name__}") from None
        if self.config.get("node_features") != NODE_FEATURES or self.config.get("edge_features") != EDGE_FEATURES:
            raise ArtifactError("feature schema in artifacts does not match the running code; retrain the model")
        mc = self.config["model_config"]
        if mc["in_dim"] != N_NODE or mc["edge_dim"] != N_EDGE + 1:
            raise ArtifactError("model dimensions do not match the feature schema; retrain the model")
        self.window_hours = float(self.config.get("window_hours", WINDOW_HOURS))
        self.threshold = float(self.meta["decision_threshold"])
        self.version = str(self.meta["model_version"])
        self.model = GraphSAGEClassifier(**mc)
        try:
            state = torch.load(directory / "model.pt", map_location="cpu", weights_only=True)   # never unpickle arbitrary objects
            self.model.load_state_dict(state)
        except Exception as e:  # noqa: BLE001
            raise ArtifactError(f"model weights could not be loaded ({type(e).__name__})") from None
        self.model.eval()

    def probs(self, g: WindowGraph):
        import torch
        x, ei, ea = to_model_inputs(g, self.scaler.transform(g.x_raw))
        with torch.no_grad():
            return torch.sigmoid(self.model(torch.from_numpy(x), torch.from_numpy(ei), torch.from_numpy(ea))).numpy()

    def attribution(self, g: WindowGraph, node: int) -> np.ndarray:
        """gradient x input for one node's logit, computed on its k-hop subgraph only (k = number of layers)."""
        import torch
        from torch_geometric.utils import k_hop_subgraph
        x, ei, ea = to_model_inputs(g, self.scaler.transform(g.x_raw))
        ei_t = torch.from_numpy(ei)
        subset, sub_ei, mapping, emask = k_hop_subgraph(node, self.model.config["layers"], ei_t, relabel_nodes=True, num_nodes=x.shape[0])
        xs = torch.from_numpy(x)[subset].clone().requires_grad_(True)
        logit = self.model(xs, sub_ei, torch.from_numpy(ea)[emask])[mapping[0]]
        logit.backward()
        return (xs.grad[mapping[0]] * xs[mapping[0]]).detach().numpy()


class GraphStore:
    """Bounded, de-duplicated rolling window of transactions (event-time based) + static account table."""

    def __init__(self, window_seconds: float, max_tx: int = MAX_STORE_TRANSACTIONS):
        self.window = window_seconds; self.max_tx = max_tx
        self.tx: deque = deque()                    # (ts, tx_id, sender, receiver, amount, channel) ordered by arrival
        self.ids: set = set()
        self.accounts: Dict[str, dict] = {}
        self.prior_last: Dict[str, float] = {}
        self.latest_ts = -np.inf
        self.version = 0
        self.stats = dict(accepted=0, duplicates=0, invalid=0, late=0, evicted=0)
        self.lock = threading.RLock()

    def upsert_accounts(self, accounts: List[dict]):
        with self.lock:
            for a in accounts:
                aid = a["account_id"]; cur = self.accounts.get(aid, {})
                rec = {**cur, **{k: v for k, v in a.items() if v is not None and k != "prior_last_active_ts"}}
                self.accounts[aid] = rec
                if a.get("prior_last_active_ts") is not None and aid not in self.prior_last:
                    self.prior_last[aid] = float(a["prior_last_active_ts"])
            self.version += 1

    def ingest(self, rows: List[dict]) -> dict:
        df = pd.DataFrame(rows)
        accepted = dup = invalid = late = 0
        with self.lock:
            if df.empty:
                return dict(accepted=0, duplicates=0, invalid=0, late=0)
            clean, rep = clean_transactions(df[["tx_id", "sender", "receiver", "amount", "ts"] + (["channel"] if "channel" in df else [])])
            invalid = rep.invalid_amount + rep.missing_time_or_ids + rep.self_transfers
            for r in clean.itertuples(index=False):
                if r.tx_id in self.ids:
                    dup += 1; continue
                if r.ts < self.latest_ts - self.window:        # older than the retained window
                    late += 1; continue
                self.tx.append((r.ts, r.tx_id, r.sender, r.receiver, float(r.amount), str(r.channel or "MOBILE")))
                self.ids.add(r.tx_id); accepted += 1
                self.latest_ts = max(self.latest_ts, r.ts)
            dup += rep.duplicates
            self._evict()
            self.stats["accepted"] += accepted; self.stats["duplicates"] += dup; self.stats["invalid"] += invalid; self.stats["late"] += late
            if accepted: self.version += 1
        return dict(accepted=accepted, duplicates=dup, invalid=invalid, late=late)

    def _evict(self):
        cutoff = self.latest_ts - self.window
        keep = deque(); n = 0
        for t in self.tx:
            if t[0] <= cutoff:                                   # leaves the window -> becomes "prior activity"
                for a in (t[2], t[3]):
                    self.prior_last[a] = max(self.prior_last.get(a, -np.inf), t[0])
                self.ids.discard(t[1]); n += 1
            else:
                keep.append(t)
        while len(keep) > self.max_tx:                           # hard memory bound
            t = keep.popleft(); self.ids.discard(t[1]); n += 1
        self.tx = keep; self.stats["evicted"] += n

    def frame(self) -> pd.DataFrame:
        with self.lock:
            return pd.DataFrame(list(self.tx), columns=["ts", "tx_id", "sender", "receiver", "amount", "channel"])

    def accounts_frame(self) -> Optional[pd.DataFrame]:
        with self.lock:
            if not self.accounts: return None
            return pd.DataFrame(list(self.accounts.values()))

    def summary(self) -> dict:
        with self.lock:
            return dict(transactions=len(self.tx), accounts_known=len(self.accounts), latest_ts=None if self.latest_ts == -np.inf else float(self.latest_ts),
                        window_hours=self.window / 3600.0, **self.stats)


def _evidence(a: str, g: WindowGraph, probs: np.ndarray, thr: float):
    f = g.facts[a]; ev: List[str] = []
    if f["fast_forwards"] > 0:
        ev.append(f"{f['fast_forwards']} transfer(s) forwarded within 5 minutes of receiving similar funds (pass-through)")
    if f["out_degree"] >= 6:
        ev.append(f"High outgoing connectivity: paid {f['out_degree']} distinct accounts (peak {f['burst_30min']} events in 30 min)")
    elif f["burst_30min"] >= 12:
        ev.append(f"Transaction burst: {f['burst_30min']} events within 30 minutes")
    if f["in_degree"] >= 5 and f["out_tx"] > 0:
        ev.append(f"Collects from {f['in_degree']} distinct accounts and forwards funds")
    if f["near_threshold_out"] >= 2:
        ev.append(f"{f['near_threshold_out']} transfers just below the INR {NEAR_THRESHOLD_AMOUNT:,.0f} reporting threshold")
    if f["scc_size"] > 1 or f["reciprocal_partners"] > 0:
        ev.append(f"Circular fund flow: member of a strongly connected group of {max(f['scc_size'], 2)} accounts")
    return ev


def _adjacency(g: WindowGraph) -> Dict[int, set]:
    nb: Dict[int, set] = {}
    for u, v in zip(g.edge_index[0].tolist(), g.edge_index[1].tolist()):
        nb.setdefault(u, set()).add(v); nb.setdefault(v, set()).add(u)
    return nb


def _neighbour_evidence(i: int, nbrs: Dict[int, set], g: WindowGraph, probs: np.ndarray, thr: float):
    nb = [j for j in nbrs.get(i, ()) if j != i]
    risky = sorted(((g.node_ids[j], float(probs[j])) for j in nb if probs[j] >= thr), key=lambda t: -t[1])
    return len(nb), risky


class GNNService:
    def __init__(self, directory: Path = ARTIFACT_DIR):
        self.dir = Path(directory); self.loaded: Optional[LoadedModel] = None; self.error: Optional[str] = None
        self.store: Optional[GraphStore] = None; self._cache = None; self._lock = threading.RLock()
        self.reload()

    # -- lifecycle -----------------------------------------------------------------------------
    def reload(self):
        try:
            self.loaded = LoadedModel(self.dir); self.error = None
            self.store = GraphStore(self.loaded.window_hours * 3600.0)
        except ArtifactError as e:
            self.loaded, self.error = None, str(e)
        except ImportError as e:
            self.loaded, self.error = None, f"PyTorch / PyTorch Geometric not installed ({e.name})"
        self._cache = None

    @property
    def ready(self) -> bool:
        return self.loaded is not None

    def status(self) -> dict:
        base = dict(artifacts_present=all((self.dir / f).is_file() for f in REQUIRED_FILES), model_loaded=self.ready, ready=self.ready)
        if self.ready:
            m = self.loaded
            base.update(model="GraphSAGE (edge-aware)", model_version=m.version, prediction_type="account_risk", window_hours=m.window_hours,
                        decision_threshold=m.threshold, feature_schema_compatible=True, trained_at=m.meta.get("trained_at"),
                        store=self.store.summary())
        else:
            base.update(reason=self.error, feature_schema_compatible=None)
        return base

    # -- prediction ----------------------------------------------------------------------------
    def predict(self, account_ids: Optional[List[str]] = None, asof: Optional[float] = None, min_score: float = 0.0,
                top_k: Optional[int] = None, explain: bool = False, store: Optional[GraphStore] = None) -> dict:
        if not self.ready:
            raise ArtifactError(self.error or "model not ready")
        m = self.loaded; st = store or self.store
        with self._lock:
            key = (id(st), st.version, asof, explain, tuple(account_ids) if (explain and account_ids) else None)
            if store is None and self._cache and self._cache[0] == key:
                allres, meta = self._cache[1]
            else:
                t0 = time.time()
                df = st.frame()
                clean, _ = clean_transactions(df) if not df.empty else (df, None)
                asof_eff = float(asof) if asof is not None else (st.latest_ts if len(clean) else 0.0)
                ws = asof_eff - st.window
                prior = dict(st.prior_last)
                if len(clean):
                    h = clean[clean.ts <= ws]
                    for col in ("sender", "receiver"):
                        for k, v in h.groupby(col).ts.max().items(): prior[k] = max(prior.get(k, -np.inf), v)
                g = build_window_graph(clean, st.accounts_frame(), asof_eff, st.window, prior) if len(clean) else build_window_graph(df.iloc[0:0], None, 0, st.window)
                allres, meta = [], dict(asof=asof_eff, nodes=len(g.node_ids), edges=int(g.edge_index.shape[1]))
                if g.node_ids:
                    p = m.probs(g); sc = anchor_score(p, m.threshold); nbrs = _adjacency(g)
                    for i, a in enumerate(g.node_ids):
                        flagged = bool(p[i] >= m.threshold)
                        allres.append(dict(account_id=a, risk_score=round(float(sc[i]), 1), risk_level=risk_level(float(sc[i])), flagged=flagged,
                                           raw_output=round(float(p[i]), 6), _i=i))
                    # evidence + attribution for flagged accounts (bounded)
                    flagged_idx = sorted([r for r in allres if r["flagged"]], key=lambda r: -r["risk_score"])[:5]    # attribution is bounded (top 5)
                    for r in allres:
                        i = r.pop("_i"); a = r["account_id"]
                        r["topological_evidence"] = _evidence(a, g, p, m.threshold) if r["flagged"] or r["risk_score"] >= 30 else []
                        n_nb, risky = _neighbour_evidence(i, nbrs, g, p, m.threshold)
                        r["neighbour_count"] = n_nb
                        r["model_evidence"] = ([f"{len(risky)} neighbouring account(s) are also flagged by the model, e.g. {', '.join(x[0] for x in risky[:3])}"] if risky else [])
                        r["graph_facts"] = g.facts[a] if r["risk_score"] >= 30 else None
                        r["_gi"] = i
                    if explain:
                        targets = flagged_idx if not account_ids else [r for r in allres if r["account_id"] in set(account_ids) and r["flagged"]][:10]
                        for r in targets:
                            attr = m.attribution(g, r["_gi"]); top = np.argsort(-np.abs(attr))[:3]
                            r["model_evidence"].append("Model attribution (gradient x input, correlational): " + ", ".join(f"{NODE_FEATURES[j]}" for j in top))
                    for r in allres: r.pop("_gi", None)
                    allres.sort(key=lambda r: -r["risk_score"])
                meta["inference_ms"] = round((time.time() - t0) * 1000, 1)
                if store is None: self._cache = (key, (allres, meta))
        by = {r["account_id"]: r for r in allres}
        if account_ids:
            results, unknown = [], []
            for a in account_ids:
                if a in by: results.append(by[a])
                else: results.append(dict(account_id=a, risk_score=None, risk_level=None, flagged=False, status="no_recent_activity",
                                          topological_evidence=[], model_evidence=[], note="account has no transactions in the analysis window"))
        else:
            results = [r for r in allres if r["risk_score"] >= min_score]
            if top_k: results = results[:top_k]
        return dict(status="success", model="GraphSAGE (edge-aware)", model_version=m.version, prediction_type="account_risk",
                    scale="threshold-anchored risk indicator (0-100); decision threshold maps to 60; not a calibrated probability",
                    decision_threshold_score=60.0, results=results, graph=meta, analysed_at=time.time())
