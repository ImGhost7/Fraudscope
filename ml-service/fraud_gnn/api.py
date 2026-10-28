"""FastAPI router for the GNN layer, mounted by ml-service/app.py.

  GET  /gnn/health        process + model readiness (distinguishes "service up" from "model ready")
  GET  /gnn/model         model card: version, schema, training/evaluation summary
  POST /gnn/transactions  ingest transactions / account records into the bounded rolling graph store
  POST /gnn/predict       account-risk inference over the store (or over inline transactions, stateless)
Training is deliberately NOT exposed over HTTP; use `python -m fraud_gnn.train`.
"""
from __future__ import annotations

import json
from typing import List, Optional, Union

import pandas as pd
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import ARTIFACT_DIR, MAX_REQUEST_TRANSACTIONS

router = APIRouter(prefix="/gnn", tags=["gnn"])
_service = None
_import_error: Optional[str] = None


def service():
    global _service, _import_error
    if _service is None:
        try:
            from .inference import GNNService
            _service = GNNService(ARTIFACT_DIR)
        except Exception as e:  # noqa: BLE001 - torch missing etc.
            _import_error = f"{type(e).__name__}: GNN dependencies unavailable"
    return _service


def set_service(s):           # used by tests
    global _service
    _service = s


def err(status: int, code: str, message: str):
    return JSONResponse(status_code=status, content=dict(status="error", code=code, message=message))


class TxIn(BaseModel):
    tx_id: str = Field(min_length=1, max_length=128)
    sender: str = Field(min_length=1, max_length=64)
    receiver: str = Field(min_length=1, max_length=64)
    amount: float
    timestamp: Union[str, float, int]
    channel: Optional[str] = "MOBILE"


class AccountIn(BaseModel):
    account_id: str = Field(min_length=1, max_length=64)
    kyc_level: Optional[str] = None
    status: Optional[str] = None
    balance: Optional[float] = None
    opened_at: Optional[Union[str, float, int]] = None
    prior_last_active: Optional[Union[str, float, int]] = None


class IngestRequest(BaseModel):
    transactions: List[TxIn] = []
    accounts: List[AccountIn] = []


class PredictRequest(BaseModel):
    account_ids: Optional[List[str]] = None
    transactions: Optional[List[TxIn]] = None        # inline mode: stateless, store untouched
    accounts: List[AccountIn] = []
    asof: Optional[Union[str, float, int]] = None
    min_score: float = 0.0
    top_k: Optional[int] = Field(default=None, ge=1, le=5000)
    explain: bool = False


def _rows(txs: List[TxIn]):
    from .inference import parse_ts
    rows, bad = [], 0
    for t in txs:
        try:
            rows.append(dict(tx_id=t.tx_id, sender=t.sender, receiver=t.receiver, amount=t.amount, ts=parse_ts(t.timestamp), channel=t.channel or "MOBILE"))
        except Exception:  # noqa: BLE001
            bad += 1
    return rows, bad


def _accounts(accs: List[AccountIn]):
    from .inference import parse_ts
    out = []
    for a in accs:
        d = dict(account_id=a.account_id, kyc_level=a.kyc_level, status=a.status, balance=a.balance)
        try:
            if a.opened_at is not None: d["opened_ts"] = parse_ts(a.opened_at)
            if a.prior_last_active is not None: d["prior_last_active_ts"] = parse_ts(a.prior_last_active)
        except Exception:  # noqa: BLE001
            pass
        out.append(d)
    return out


@router.get("/health")
def health():
    s = service()
    if s is None:
        return dict(service="up", model=dict(ready=False, model_loaded=False, artifacts_present=False, reason=_import_error))
    return dict(service="up", model=s.status())


@router.get("/model")
def model_card():
    s = service()
    if s is None or not s.ready:
        return err(503, "model_not_ready", (s.error if s else _import_error) or "model not ready")
    out = dict(s.status())
    ev = ARTIFACT_DIR / "evaluation.json"
    try:
        if ev.is_file():
            e = json.loads(ev.read_text()); out["evaluation_summary"] = dict(counts=e.get("counts"), split=e.get("split"), methods={k: v["metrics"] for k, v in e.get("methods", {}).items()})
    except Exception:  # noqa: BLE001
        pass
    out["node_features"] = s.loaded.config["node_features"]; out["edge_features"] = s.loaded.config["edge_features"]
    return out


@router.post("/transactions")
def ingest(req: IngestRequest):
    s = service()
    if s is None or not s.ready:
        return err(503, "model_not_ready", (s.error if s else _import_error) or "model not ready")
    if len(req.transactions) > MAX_REQUEST_TRANSACTIONS:
        return err(413, "too_many_transactions", f"at most {MAX_REQUEST_TRANSACTIONS} transactions per request")
    rows, bad = _rows(req.transactions)
    if req.accounts: s.store.upsert_accounts(_accounts(req.accounts))
    res = s.store.ingest(rows) if rows else dict(accepted=0, duplicates=0, invalid=0, late=0)
    res["invalid"] += bad
    return dict(status="success", **res, store=s.store.summary())


@router.post("/predict")
def predict(req: PredictRequest):
    s = service()
    if s is None or not s.ready:
        return err(503, "model_not_ready", (s.error if s else _import_error) or "model not ready")
    try:
        asof = None
        if req.asof is not None:
            from .inference import parse_ts
            asof = parse_ts(req.asof)
    except Exception:  # noqa: BLE001
        return err(422, "invalid_asof", "asof must be an ISO-8601 timestamp or epoch seconds")
    store = None
    if req.transactions is not None:
        if len(req.transactions) > MAX_REQUEST_TRANSACTIONS:
            return err(413, "too_many_transactions", f"at most {MAX_REQUEST_TRANSACTIONS} transactions per request")
        from .inference import GraphStore
        store = GraphStore(s.loaded.window_hours * 3600.0)
        rows, _ = _rows(req.transactions)
        store.upsert_accounts(_accounts(req.accounts)); store.ingest(rows)
    elif req.accounts:
        s.store.upsert_accounts(_accounts(req.accounts))
    try:
        return s.predict(req.account_ids, asof, req.min_score, req.top_k, req.explain, store)
    except Exception as e:  # noqa: BLE001 - never leak internals
        return err(500, "inference_failed", f"inference failed ({type(e).__name__})")
