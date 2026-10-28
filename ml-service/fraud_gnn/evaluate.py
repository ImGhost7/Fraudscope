"""Held-out evaluation: GNN vs the existing detectors, on identical node-snapshot instances.

Account-level alignment of the transaction-level detectors (documented in docs/GNN.md):
  an account in a snapshot is flagged by a detector if it is the sender OR receiver of any transaction
  inside that snapshot's window that the detector flags; its score is the max score over those transactions.
"""
from __future__ import annotations

import json
import subprocess
import sys
import warnings
from pathlib import Path
from typing import Dict, List

import numpy as np
import pandas as pd
from sklearn.metrics import (average_precision_score, confusion_matrix, precision_recall_curve, precision_recall_fscore_support, roc_auc_score, roc_curve)

from .config import ROOT
from .dataset import Snapshot

BACKEND = ROOT.parent / "backend"


def run_rule_engine(tx: pd.DataFrame, accounts: pd.DataFrame, score_from: float, warmup_from: float, work: Path, reuse: bool = False) -> pd.DataFrame:
    """Replay history through the EXISTING Node rule engine; returns per-tx rule verdicts + engine ml_features."""
    work.mkdir(parents=True, exist_ok=True)
    sub = tx[tx.ts >= warmup_from][["tx_id", "sender", "receiver", "amount", "ts", "channel"]]
    accs = [dict(account_id=r.account_id, kyc_level=r.kyc_level, status=r.status, account_type=r.account_type,
                 balance=float(r.balance), last_active_ts=float(r.initial_last_active), opened_ts=float(r.opened_ts))
            for r in accounts.itertuples()]
    fin, fout = work / "replay_in.json", work / "replay_out.json"
    if reuse and fout.is_file() and fin.is_file():          # the (slow) replay is deterministic for a given dataset; reuse it
        return pd.DataFrame(json.loads(fout.read_text()))
    fin.write_text(json.dumps(dict(accounts=accs, transactions=sub.to_dict("records"), score_from_ts=float(score_from))))
    subprocess.run(["node", str(BACKEND / "scripts" / "replay_engine.js"), str(fin), str(fout)], check=True, capture_output=True)
    return pd.DataFrame(json.loads(fout.read_text()))


def run_isolation_forest(rules: pd.DataFrame) -> pd.DataFrame:
    """Score the engine's feature vectors with the EXISTING Isolation Forest (ml-service/app.py)."""
    sys.path.insert(0, str(ROOT))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        import app as mlapp  # existing service module
    rows, out = rules.to_dict("records"), []
    for i in range(0, len(rows), 1000):
        chunk = rows[i:i + 1000]
        req = mlapp.BatchRequest(transactions=[mlapp.RichTransactionFeatures(tx_id=r["tx_id"], rule_engine_score=r["final_score"], **{k: v for k, v in (r["ml_features"] or {}).items() if k in mlapp.RichTransactionFeatures.model_fields and k != "rule_engine_score"}) for r in chunk])
        out += mlapp.predict_batch(req)["results"]
    df = pd.DataFrame(out)[["tx_id", "is_anomaly", "normalized_risk"]]
    return df.rename(columns={"is_anomaly": "if_anomaly", "normalized_risk": "if_prob"})   # boundary-anchored 0-100 indicator


def per_account(snaps: List[Snapshot], txverd: pd.DataFrame, clean_tx: pd.DataFrame) -> pd.DataFrame:
    """Rows = (snapshot, account) with rule/IF scores aligned to account level."""
    tv = txverd.set_index("tx_id")
    rows = []
    c = clean_tx[["tx_id", "sender", "receiver", "ts"]]
    for si, s in enumerate(snaps):
        w = c[(c.ts > s.graph.window_start) & (c.ts <= s.asof)].join(tv, on="tx_id")
        w = w.dropna(subset=["final_score"])
        ends = pd.concat([w[["sender", "final_score", "anomaly_flag", "if_prob", "if_anomaly"]].rename(columns={"sender": "acct"}),
                          w[["receiver", "final_score", "anomaly_flag", "if_prob", "if_anomaly"]].rename(columns={"receiver": "acct"})])
        g = ends.groupby("acct").agg(rule_score=("final_score", "max"), rule_flag=("anomaly_flag", "max"), if_score=("if_prob", "max"), if_flag=("if_anomaly", "max"))
        df = pd.DataFrame({"acct": s.graph.node_ids, "y": s.y, "scenario": s.scenario, "variant": s.variant, "snap": si}).join(g, on="acct")
        rows.append(df)
    out = pd.concat(rows, ignore_index=True)
    for col in ("rule_score", "if_score"): out[col] = out[col].fillna(0.0)
    for col in ("rule_flag", "if_flag"): out[col] = out[col].fillna(False).astype(bool)
    return out


def best_f1_threshold(y, score) -> float:
    p, r, th = precision_recall_curve(y, score)
    f = 2 * p[:-1] * r[:-1] / (p[:-1] + r[:-1] + 1e-12)
    return float(th[int(np.argmax(f))]) if len(th) else 0.5


def metrics(y, score, pred) -> Dict:
    y = np.asarray(y).astype(int); pred = np.asarray(pred).astype(int)
    p, r, f, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    fpr_, tpr_, _ = roc_curve(y, score)
    return dict(precision=float(p), recall=float(r), f1=float(f), false_positive_rate=float(fp / max(fp + tn, 1)),
                false_negatives=int(fn), false_positives=int(fp), true_positives=int(tp), true_negatives=int(tn),
                roc_auc=float(roc_auc_score(y, score)), pr_auc=float(average_precision_score(y, score)),
                recall_at_fpr_1pct=float(np.interp(0.01, fpr_, tpr_)), recall_at_fpr_5pct=float(np.interp(0.05, fpr_, tpr_)))


def fuse_scores(frame: pd.DataFrame, work: Path, weights=None, rule_floor=None) -> np.ndarray:
    """Fuse with the production JS module (services/riskFusion.js); weights/floor default to the production configuration."""
    import os
    env = dict(os.environ)
    if weights is not None: env["FUSION_WEIGHTS"] = json.dumps(weights)
    if rule_floor is not None: env["FUSION_RULE_FLOOR"] = str(rule_floor)
    rows = [dict(rules=float(a), isolation_forest=float(b), gnn=float(c) * 100.0) for a, b, c in zip(frame.rule_score, frame.if_score, frame.gnn)]
    fin, fout = work / "fuse_in.json", work / "fuse_out.json"
    fin.write_text(json.dumps(rows))
    subprocess.run(["node", str(BACKEND / "scripts" / "fuse_scores.js"), str(fin), str(fout)], check=True, capture_output=True, env=env)
    return np.array(json.loads(fout.read_text())) / 100.0


def per_scenario_recall(frame: pd.DataFrame, pred: np.ndarray) -> Dict:
    out = {}
    pos = frame[frame.y == 1].assign(pred=pred[frame.y.values == 1])
    for (sc, va), g in pos.groupby(["scenario", "variant"]):
        out[f"{sc}/{va}"] = dict(n=int(len(g)), recall=float(g.pred.mean()))
    return out
