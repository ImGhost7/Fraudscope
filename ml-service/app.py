"""
Fraudscope AI — ML Service (FastAPI) v2.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Upgrade from v1: Now consumes the full 35+ feature vector produced by
the redesigned Rule Engine (v2.0), not just 12 basic transaction fields.

Feature categories consumed:
  - Rule Engine scores (structuring, layering, fan-out, dormant, velocity)
  - Behavioural baseline deviation
  - Geographic risk
  - Receiver reputation
  - Transaction basics (amount, time, channel)
  - Sender / receiver account profiles
  - Derived features (hop_count, circular_detected, forwarding ratios, etc.)

Model: Isolation Forest (unsupervised anomaly detection)
       Trained on synthetic data that reflects the above features.
       Can be swapped for a supervised XGBoost/LightGBM in production
       once labelled fraud data is available.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import networkx as nx
import joblib
import os
import json
from datetime import datetime

app = FastAPI(title="Fraudscope AI ML Service", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model state
model = None
scaler = None

# ─────────────────────────────────────────────────────────────────────────────
# Feature schema — mirrors the mlFeatures output of ruleEngine.js v2.0
# All fields are optional with sensible defaults so the API is backward
# compatible with callers that don't yet send every field.
# ─────────────────────────────────────────────────────────────────────────────

class RichTransactionFeatures(BaseModel):
    tx_id: str

    # ── Rule Engine Scores (primary signals) ──────────────────────────────────
    rule_engine_score:          float = Field(0,   description="Final rule engine composite score 0-100")
    structuring_risk_score:     float = Field(0,   description="Structuring rule contribution")
    layering_risk_score:        float = Field(0,   description="Layering rule contribution")
    fan_out_risk_score:         float = Field(0,   description="Fan-out rule contribution")
    dormant_risk_score:         float = Field(0,   description="Dormant activation rule contribution")
    velocity_risk_score:        float = Field(0,   description="Velocity burst rule contribution")
    geo_risk_score:             float = Field(0,   description="Geographic risk contribution")
    receiver_reputation_score:  float = Field(50,  description="Receiver reputation (0=trusted, 100=high risk)")

    # ── Structuring Features ──────────────────────────────────────────────────
    near_threshold_count:       int   = Field(0)
    near_threshold_ratio:       float = Field(0)
    aggregate_amount_30m:       float = Field(0)
    aggregate_amount_1h:        float = Field(0)
    tx_count_30m:               int   = Field(0)
    tx_count_1h:                int   = Field(0)
    new_beneficiary_count:      int   = Field(0)
    new_beneficiary_ratio:      float = Field(0)
    convergence_sender_count:   int   = Field(0)
    count_deviation_from_baseline: float = Field(1.0)
    amount_deviation_from_baseline: float = Field(1.0)

    # ── Layering Features ─────────────────────────────────────────────────────
    hop_count:                  int   = Field(0)
    circular_detected:          int   = Field(0)
    avg_hop_time_seconds:       float = Field(0)
    avg_preservation_ratio:     float = Field(0)
    shell_hop_count:            int   = Field(0)
    geo_crossing_count:         int   = Field(0)
    layering_chain_length:      int   = Field(0)

    # ── Fan-Out Features ──────────────────────────────────────────────────────
    unique_receiver_count:      int   = Field(0)
    new_receiver_count:         int   = Field(0)
    new_receiver_ratio:         float = Field(0)
    equal_distribution_score:   int   = Field(0)
    receiver_diversity_score:   float = Field(0)
    receiver_state_count:       int   = Field(0)
    suspicious_receiver_count:  int   = Field(0)
    reconvergence_detected:     int   = Field(0)

    # ── Dormant Features ─────────────────────────────────────────────────────
    days_inactive:              int   = Field(0)
    post_activation_forward_ratio: float = Field(0)
    sender_is_suspicious:       int   = Field(0)
    multiple_dormant_same_sender: int = Field(0)
    rapid_forwarding:           int   = Field(0)
    low_kyc_large_amount:       int   = Field(0)

    # ── Velocity Features ────────────────────────────────────────────────────
    session_tx_count:           int   = Field(0)
    session_total_value:        float = Field(0)
    session_avg_interval_sec:   float = Field(0)
    is_night_session:           int   = Field(0)
    count_deviation:            float = Field(1.0)
    value_deviation:            float = Field(1.0)

    # ── Receiver Reputation ──────────────────────────────────────────────────
    receiver_is_mule:           int   = Field(0)
    receiver_is_shell:          int   = Field(0)
    receiver_is_flagged:        int   = Field(0)
    receiver_kyc_low:           int   = Field(0)

    # ── Geographic ──────────────────────────────────────────────────────────
    is_sanctioned_country:      int   = Field(0)
    is_high_risk_country:       int   = Field(0)
    is_new_city:                int   = Field(0)
    impossible_travel:          int   = Field(0)

    # ── Transaction Basics ──────────────────────────────────────────────────
    tx_amount:                  float = Field(0)
    log_amount:                 float = Field(0)
    is_round_amount:            int   = Field(0)
    hour_of_day:                int   = Field(12)
    day_of_week:                int   = Field(1)

    # ── Sender Profile ───────────────────────────────────────────────────────
    sender_tx_count:            int   = Field(0)
    sender_total_out:           float = Field(0)
    sender_risk_score:          float = Field(0)
    sender_kyc:                 int   = Field(1)
    days_since_sender_active:   int   = Field(0)

    # ── Receiver Profile ─────────────────────────────────────────────────────
    receiver_tx_count:          int   = Field(0)
    receiver_total_in:          float = Field(0)

    # ── Baseline ─────────────────────────────────────────────────────────────
    has_baseline:               int   = Field(0)
    baseline_avg_daily_amount:  float = Field(0)
    baseline_avg_daily_count:   float = Field(0)


# Legacy 12-field format — still accepted for backward compatibility
class LegacyTransactionFeatures(BaseModel):
    tx_id: str
    amount: float
    sender_tx_count: int = 0
    receiver_tx_count: int = 0
    sender_total_out: float = 0
    receiver_total_in: float = 0
    time_gap_seconds: float = 0
    hour_of_day: int = 12
    day_of_week: int = 1
    in_out_ratio: float = 1.0
    is_round_amount: int = 0
    channel_encoded: int = 0


class BatchRequest(BaseModel):
    transactions: List[RichTransactionFeatures]

class GraphRequest(BaseModel):
    nodes: List[dict]
    edges: List[dict]


# ─────────────────────────────────────────────────────────────────────────────
# Feature extraction
# ─────────────────────────────────────────────────────────────────────────────

FEATURE_COLUMNS = [
    # Rule engine scores — highest signal quality
    "rule_engine_score", "structuring_risk_score", "layering_risk_score",
    "fan_out_risk_score", "dormant_risk_score", "velocity_risk_score",
    "geo_risk_score", "receiver_reputation_score",
    # Structuring
    "near_threshold_count", "near_threshold_ratio",
    "aggregate_amount_30m", "aggregate_amount_1h",
    "tx_count_30m", "tx_count_1h",
    "new_beneficiary_count", "new_beneficiary_ratio",
    "convergence_sender_count",
    "count_deviation_from_baseline", "amount_deviation_from_baseline",
    # Layering
    "hop_count", "circular_detected",
    "avg_hop_time_seconds", "avg_preservation_ratio",
    "shell_hop_count", "geo_crossing_count", "layering_chain_length",
    # Fan-out
    "unique_receiver_count", "new_receiver_count", "new_receiver_ratio",
    "equal_distribution_score", "receiver_diversity_score",
    "suspicious_receiver_count", "reconvergence_detected",
    # Dormant
    "days_inactive", "post_activation_forward_ratio",
    "sender_is_suspicious", "multiple_dormant_same_sender",
    "rapid_forwarding", "low_kyc_large_amount",
    # Velocity
    "session_tx_count", "session_avg_interval_sec",
    "is_night_session", "count_deviation", "value_deviation",
    # Receiver flags
    "receiver_is_mule", "receiver_is_shell", "receiver_is_flagged", "receiver_kyc_low",
    # Geo flags
    "is_sanctioned_country", "is_high_risk_country", "is_new_city", "impossible_travel",
    # Transaction basics
    "tx_amount", "log_amount", "is_round_amount", "hour_of_day",
    # Sender profile
    "sender_tx_count", "sender_risk_score", "sender_kyc",
    "days_since_sender_active",
    # Baseline
    "has_baseline", "baseline_avg_daily_amount", "baseline_avg_daily_count",
]

def extract_features_rich(tx: RichTransactionFeatures) -> list:
    """Extract features in FEATURE_COLUMNS order from the rich feature schema."""
    d = tx.dict()
    return [d.get(col, 0) or 0 for col in FEATURE_COLUMNS]


def extract_features_legacy(tx: LegacyTransactionFeatures) -> list:
    """Extract features for legacy 12-field callers — fills rich columns with 0."""
    base = {col: 0 for col in FEATURE_COLUMNS}
    base["tx_amount"]         = tx.amount
    base["log_amount"]        = np.log1p(tx.amount)
    base["is_round_amount"]   = tx.is_round_amount
    base["hour_of_day"]       = tx.hour_of_day
    base["sender_tx_count"]   = tx.sender_tx_count
    base["receiver_tx_count"] = tx.receiver_tx_count
    base["sender_total_out"]  = tx.sender_total_out
    return [base[col] for col in FEATURE_COLUMNS]


# ─────────────────────────────────────────────────────────────────────────────
# Model training
# ─────────────────────────────────────────────────────────────────────────────

def normalized_if_risk(decision_value: float) -> float:
    """Monotone 0-100 risk from the Isolation Forest's own decision function (boundary = 50).

    The legacy `fraud_probability` is a heuristic that maps almost every input to 76-89; this additive field is
    anchored on the model's trained decision boundary instead.  It is an anomaly indicator, not a probability."""
    return float(max(0.0, min(100.0, 50.0 - 250.0 * decision_value)))


def get_or_train_model():
    global model, scaler
    if model is not None:
        return model, scaler

    print("[ML] Training Isolation Forest on synthetic rich-feature dataset...")
    np.random.seed(42)
    n_normal = 3000
    n_fraud  = 300
    n_cols   = len(FEATURE_COLUMNS)

    # Build column index for clean referencing
    ci = {col: i for i, col in enumerate(FEATURE_COLUMNS)}

    # ── Normal transactions ───────────────────────────────────────────────────
    normal = np.zeros((n_normal, n_cols))
    normal[:, ci["rule_engine_score"]]           = np.random.uniform(0, 25, n_normal)
    normal[:, ci["structuring_risk_score"]]      = np.random.uniform(-12, 8, n_normal)
    normal[:, ci["layering_risk_score"]]         = np.zeros(n_normal)
    normal[:, ci["velocity_risk_score"]]         = np.random.uniform(0, 10, n_normal)
    normal[:, ci["receiver_reputation_score"]]   = np.random.uniform(20, 45, n_normal)
    normal[:, ci["tx_amount"]]                   = np.random.lognormal(9, 1.5, n_normal)
    normal[:, ci["log_amount"]]                  = np.log1p(normal[:, ci["tx_amount"]])
    normal[:, ci["hour_of_day"]]                 = np.random.choice(range(8, 20), n_normal)
    normal[:, ci["has_baseline"]]                = np.ones(n_normal)
    normal[:, ci["count_deviation_from_baseline"]] = np.random.uniform(0.8, 1.5, n_normal)
    normal[:, ci["amount_deviation_from_baseline"]] = np.random.uniform(0.7, 1.8, n_normal)
    normal[:, ci["near_threshold_count"]]        = np.zeros(n_normal)
    normal[:, ci["hop_count"]]                   = np.zeros(n_normal)
    normal[:, ci["unique_receiver_count"]]       = np.random.choice(range(1, 4), n_normal)
    normal[:, ci["new_beneficiary_ratio"]]       = np.random.uniform(0, 0.3, n_normal)

    # ── Fraud transactions (structuring + layering + fan-out mix) ─────────────
    fraud = np.zeros((n_fraud, n_cols))
    fraud[:, ci["rule_engine_score"]]            = np.random.uniform(55, 100, n_fraud)
    fraud[:, ci["structuring_risk_score"]]       = np.random.uniform(20, 40, n_fraud)
    fraud[:, ci["layering_risk_score"]]          = np.random.uniform(25, 45, n_fraud)
    fraud[:, ci["fan_out_risk_score"]]           = np.random.uniform(15, 35, n_fraud)
    fraud[:, ci["dormant_risk_score"]]           = np.random.uniform(10, 30, n_fraud)
    fraud[:, ci["velocity_risk_score"]]          = np.random.uniform(15, 25, n_fraud)
    fraud[:, ci["receiver_reputation_score"]]    = np.random.uniform(60, 100, n_fraud)
    fraud[:, ci["near_threshold_count"]]         = np.random.randint(3, 12, n_fraud)
    fraud[:, ci["near_threshold_ratio"]]         = np.random.uniform(0.6, 1.0, n_fraud)
    fraud[:, ci["tx_count_30m"]]                 = np.random.randint(5, 20, n_fraud)
    fraud[:, ci["new_beneficiary_ratio"]]        = np.random.uniform(0.7, 1.0, n_fraud)
    fraud[:, ci["hop_count"]]                    = np.random.randint(3, 6, n_fraud)
    fraud[:, ci["circular_detected"]]            = np.random.choice([0, 1], n_fraud, p=[0.4, 0.6])
    fraud[:, ci["avg_hop_time_seconds"]]         = np.random.uniform(10, 100, n_fraud)
    fraud[:, ci["avg_preservation_ratio"]]       = np.random.uniform(0.88, 0.99, n_fraud)
    fraud[:, ci["shell_hop_count"]]              = np.random.randint(1, 4, n_fraud)
    fraud[:, ci["unique_receiver_count"]]        = np.random.randint(5, 15, n_fraud)
    fraud[:, ci["equal_distribution_score"]]     = np.ones(n_fraud)
    fraud[:, ci["reconvergence_detected"]]       = np.random.choice([0, 1], n_fraud, p=[0.5, 0.5])
    fraud[:, ci["days_inactive"]]                = np.random.randint(90, 730, n_fraud)
    fraud[:, ci["rapid_forwarding"]]             = np.random.choice([0, 1], n_fraud, p=[0.3, 0.7])
    fraud[:, ci["receiver_is_mule"]]             = np.random.choice([0, 1], n_fraud, p=[0.4, 0.6])
    fraud[:, ci["is_night_session"]]             = np.random.choice([0, 1], n_fraud, p=[0.4, 0.6])
    fraud[:, ci["count_deviation_from_baseline"]] = np.random.uniform(3, 10, n_fraud)
    fraud[:, ci["amount_deviation_from_baseline"]] = np.random.uniform(3, 10, n_fraud)
    fraud[:, ci["session_avg_interval_sec"]]     = np.random.uniform(5, 25, n_fraud)
    fraud[:, ci["tx_amount"]]                    = np.random.uniform(40000, 49500, n_fraud)
    fraud[:, ci["log_amount"]]                   = np.log1p(fraud[:, ci["tx_amount"]])
    fraud[:, ci["sender_risk_score"]]            = np.random.uniform(40, 80, n_fraud)

    all_data = np.vstack([normal, fraud])

    scaler = StandardScaler()
    X = scaler.fit_transform(all_data)

    model = IsolationForest(
        n_estimators=300,
        contamination=0.09,   # ~9% fraud rate in synthetic set
        max_features=0.75,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X)
    print(f"[ML] Isolation Forest trained — {n_cols} features, {n_normal + n_fraud} samples")
    return model, scaler


# ─────────────────────────────────────────────────────────────────────────────
# Startup
# ─────────────────────────────────────────────────────────────────────────────

# ── GNN layer (GraphSAGE account-risk model) ─────────────────────────────────────────────
try:
    from fraud_gnn.api import router as gnn_router
    app.include_router(gnn_router)
except Exception as _e:  # noqa: BLE001 - the existing service must still start without torch
    print(f"[GNN] layer not mounted: {type(_e).__name__}")


@app.on_event("startup")
async def startup():
    get_or_train_model()
    print("[READY] Fraudscope ML Service v2.0 ready")


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "operational",
        "model": "IsolationForest",
        "version": "2.0.0",
        "service": "Fraudscope AI ML",
        "feature_count": len(FEATURE_COLUMNS),
    }


@app.post("/predict")
def predict_single(tx: RichTransactionFeatures):
    """Score a single transaction using the full 60+ feature vector."""
    clf, sc = get_or_train_model()
    features = extract_features_rich(tx)
    X = sc.transform([features])
    score = clf.score_samples(X)[0]
    prediction = clf.predict(X)[0]
    margin = float(clf.decision_function(X)[0])

    # Normalize: more negative anomaly_score => higher fraud probability
    fraud_prob = max(0, min(100, int((-score + 0.5) * 80)))
    is_anomaly = bool(prediction == -1)

    # If rule_engine_score is already high, boost the ML output slightly
    # This implements the "ML as second layer" design principle
    rule_score = tx.rule_engine_score or 0
    if rule_score >= 60 and fraud_prob < 50:
        fraud_prob = min(100, fraud_prob + 15)
    elif rule_score >= 40 and fraud_prob < 30:
        fraud_prob = min(100, fraud_prob + 8)

    risk_level = (
        "CRITICAL" if fraud_prob >= 80 else
        "HIGH"     if fraud_prob >= 60 else
        "MEDIUM"   if fraud_prob >= 40 else
        "LOW"
    )

    return {
        "tx_id": tx.tx_id,
        "is_anomaly": is_anomaly,
        "anomaly_score": round(float(score), 4),
        "fraud_probability": fraud_prob,
        "risk_level": risk_level,
        "rule_engine_score": rule_score,
        "feature_count": len(FEATURE_COLUMNS),
        "decision_function": round(margin, 4),            # additive (v2.1): < 0 means anomaly by the model's own threshold
        "normalized_risk": round(normalized_if_risk(margin), 1),
    }


@app.post("/predict/legacy")
def predict_legacy(tx: LegacyTransactionFeatures):
    """Legacy 12-field endpoint — backward compatible."""
    clf, sc = get_or_train_model()
    features = extract_features_legacy(tx)
    X = sc.transform([features])
    score = clf.score_samples(X)[0]
    prediction = clf.predict(X)[0]
    fraud_prob = max(0, min(100, int((-score + 0.5) * 80)))
    return {
        "tx_id": tx.tx_id,
        "is_anomaly": bool(prediction == -1),
        "anomaly_score": round(float(score), 4),
        "fraud_probability": fraud_prob,
        "risk_level": "CRITICAL" if fraud_prob >= 80 else "HIGH" if fraud_prob >= 60 else "MEDIUM" if fraud_prob >= 40 else "LOW",
        "note": "Legacy 12-field format — upgrade to /predict for full accuracy",
    }


@app.post("/predict/batch")
def predict_batch(req: BatchRequest):
    """Batch-score multiple transactions."""
    clf, sc = get_or_train_model()
    features_list = [extract_features_rich(tx) for tx in req.transactions]
    X = sc.transform(features_list)
    scores = clf.score_samples(X)
    predictions = clf.predict(X)
    margins = clf.decision_function(X)

    results = []
    for i, tx in enumerate(req.transactions):
        score = scores[i]
        pred  = predictions[i]
        fraud_prob = max(0, min(100, int((-score + 0.5) * 80)))
        rule_score = tx.rule_engine_score or 0
        if rule_score >= 60 and fraud_prob < 50:
            fraud_prob = min(100, fraud_prob + 15)
        results.append({
            "tx_id": tx.tx_id,
            "is_anomaly": bool(pred == -1),
            "anomaly_score": round(float(score), 4),
            "fraud_probability": fraud_prob,
            "risk_level": "CRITICAL" if fraud_prob >= 80 else "HIGH" if fraud_prob >= 60 else "MEDIUM" if fraud_prob >= 40 else "LOW",
            "decision_function": round(float(margins[i]), 4),
            "normalized_risk": round(normalized_if_risk(float(margins[i])), 1),
        })

    return {
        "results": results,
        "total": len(results),
        "anomalies": sum(1 for r in results if r["is_anomaly"]),
        "critical": sum(1 for r in results if r["risk_level"] == "CRITICAL"),
    }


@app.post("/graph/analyze")
def analyze_graph(req: GraphRequest):
    """Analyze fund flow graph using NetworkX."""
    G = nx.DiGraph()
    for node in req.nodes:
        G.add_node(node["id"], **node)
    for edge in req.edges:
        G.add_edge(edge["source"], edge["target"], **edge)

    results = {
        "node_count": G.number_of_nodes(),
        "edge_count": G.number_of_edges(),
        "strongly_connected": [list(c) for c in nx.strongly_connected_components(G)],
        "cycles": [],
        "high_betweenness_nodes": [],
        "hub_nodes": [],
    }

    try:
        cycles = list(nx.simple_cycles(G))
        results["cycles"] = [c for c in cycles if len(c) >= 2][:10]
        results["round_trip_detected"] = len(results["cycles"]) > 0
    except Exception:
        results["round_trip_detected"] = False

    try:
        betweenness = nx.betweenness_centrality(G)
        top_nodes = sorted(betweenness.items(), key=lambda x: -x[1])[:5]
        results["high_betweenness_nodes"] = [{"node": n, "score": round(s, 4)} for n, s in top_nodes]
    except Exception:
        pass

    out_degrees = dict(G.out_degree())
    top_hubs = sorted(out_degrees.items(), key=lambda x: -x[1])[:5]
    results["hub_nodes"] = [{"node": n, "out_degree": d} for n, d in top_hubs if d >= 3]

    in_degrees = dict(G.in_degree())
    top_sinks = sorted(in_degrees.items(), key=lambda x: -x[1])[:5]
    results["sink_nodes"] = [{"node": n, "in_degree": d} for n, d in top_sinks if d >= 3]

    return results


@app.get("/model/info")
def model_info():
    clf, _ = get_or_train_model()
    return {
        "algorithm": "Isolation Forest",
        "version": "2.0.0",
        "n_estimators": clf.n_estimators,
        "contamination": clf.contamination,
        "feature_count": len(FEATURE_COLUMNS),
        "features": FEATURE_COLUMNS,
        "trained_on": "Synthetic banking fraud dataset (3000 normal + 300 fraudulent)",
        "description": (
            "Unsupervised anomaly detection. "
            "Consumes rich 60+ feature vector from Fraudscope Rule Engine v2.0. "
            "Primary features: rule_engine_score, structuring/layering/fan-out/dormant/velocity scores, "
            "hop_count, circular_detected, receiver_reputation_score, deviation from baseline."
        ),
        "upgrade_path": (
            "For production: replace with supervised XGBoost/LightGBM once labeled fraud data "
            "is available. The feature schema is already production-ready."
        ),
    }
