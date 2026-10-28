"""Central configuration. Every tunable is overridable through environment variables."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARTIFACT_DIR = Path(os.environ.get("GNN_ARTIFACT_DIR", ROOT / "models" / "gnn"))

WINDOW_HOURS = float(os.environ.get("GNN_WINDOW_HOURS", 24))        # graph look-back window
SNAPSHOT_STRIDE_HOURS = float(os.environ.get("GNN_SNAPSHOT_STRIDE_HOURS", 6))
NEAR_THRESHOLD_AMOUNT = 50_000.0                                    # PMLA reporting threshold used by the rule engine
FAST_FORWARD_SECONDS = 300.0                                         # pass-through horizon for "fast forwarding"
BURST_SECONDS = 1800.0

RISK_LEVELS = [(80.0, "CRITICAL"), (60.0, "HIGH"), (40.0, "MEDIUM"), (0.0, "LOW")]

MAX_STORE_TRANSACTIONS = int(os.environ.get("GNN_MAX_STORE_TX", 200_000))  # hard memory bound
MAX_REQUEST_TRANSACTIONS = 50_000

CHANNELS = ["MOBILE", "NET_BANKING", "API"]


def risk_level(score_0_100: float) -> str:
    for cutoff, label in RISK_LEVELS:
        if score_0_100 >= cutoff:
            return label
    return "LOW"


def anchor_score(p, thr):
    """Monotone, threshold-anchored risk score in [0, 100].

    The decision threshold (chosen on validation data) maps to 60 (the HIGH band boundary used across
    Fraudscope); 0 -> 0 and 1 -> 100.  It is a risk INDICATOR, not a calibrated probability."""
    import numpy as np
    p = np.clip(np.asarray(p, dtype=float), 0.0, 1.0)
    thr = float(np.clip(thr, 1e-6, 1 - 1e-6))
    return np.where(p < thr, 60.0 * p / thr, 60.0 + 40.0 * (p - thr) / (1.0 - thr))
