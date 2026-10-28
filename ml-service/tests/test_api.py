import time

import pytest
from fastapi.testclient import TestClient

import app as mlapp
from fraud_gnn import api
from fraud_gnn.inference import GNNService

NOW = 1_800_000_000.0


def txs(n=30, start=NOW - 3600):
    out = [dict(tx_id=f"t{i}", sender=f"A{i % 7}", receiver=f"A{(i + 1) % 7}", amount=1000 + i, timestamp=start + i * 60, channel="MOBILE") for i in range(n)]
    out += [dict(tx_id=f"f{i}", sender="HUB", receiver=f"M{i}", amount=40000, timestamp=NOW - 600 + i * 20) for i in range(10)]
    return out


@pytest.fixture()
def client(artifacts):
    api.set_service(GNNService(artifacts))
    with TestClient(mlapp.app) as c:
        yield c
    api.set_service(None)


def test_health_distinguishes_service_from_model(client, tmp_path):
    h = client.get("/gnn/health").json()
    assert h["service"] == "up" and h["model"]["ready"] is True and h["model"]["model_version"]
    api.set_service(GNNService(tmp_path))                       # empty artifact dir
    h = client.get("/gnn/health").json()
    assert h["service"] == "up" and h["model"]["ready"] is False and "missing model artifacts" in h["model"]["reason"]
    assert client.post("/gnn/predict", json={}).status_code == 503
    assert client.post("/gnn/transactions", json={"transactions": []}).json()["code"] == "model_not_ready"


def test_ingest_dedup_and_predict(client):
    r = client.post("/gnn/transactions", json={"transactions": txs()}).json()
    assert r["accepted"] == 40 and r["duplicates"] == 0
    r = client.post("/gnn/transactions", json={"transactions": txs()}).json()
    assert r["accepted"] == 0 and r["duplicates"] == 40                         # repeated delivery never duplicates edges
    p = client.post("/gnn/predict", json={"explain": True}).json()
    assert p["status"] == "success" and p["prediction_type"] == "account_risk" and p["results"]
    top = p["results"][0]
    assert 0 <= top["risk_score"] <= 100 and top["risk_level"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"} and "topological_evidence" in top
    assert p["graph"]["edges"] == 40


def test_predict_unknown_account_and_empty_graph(client):
    client.post("/gnn/transactions", json={"transactions": txs()})
    p = client.post("/gnn/predict", json={"account_ids": ["A1", "NOPE"]}).json()
    by = {x["account_id"]: x for x in p["results"]}
    assert by["A1"]["risk_score"] is not None and by["NOPE"]["status"] == "no_recent_activity" and by["NOPE"]["risk_score"] is None
    e = client.post("/gnn/predict", json={"transactions": [], "account_ids": ["X"]}).json()     # inline + empty -> empty graph, no crash
    assert e["status"] == "success" and e["results"][0]["status"] == "no_recent_activity" and e["graph"]["nodes"] == 0


def test_inline_mode_is_stateless_and_respects_asof(client):
    base = txs()
    p = client.post("/gnn/predict", json={"transactions": base}).json()
    assert p["graph"]["edges"] == 40
    assert client.get("/gnn/health").json()["model"]["store"]["transactions"] == 0       # store untouched
    early = client.post("/gnn/predict", json={"transactions": base, "asof": NOW - 3000}).json()   # future tx ignored
    assert early["graph"]["edges"] < 40


def test_validation_and_error_shape(client):
    assert client.post("/gnn/transactions", json={"transactions": [{"tx_id": "x"}]}).status_code == 422
    assert client.post("/gnn/predict", json={"top_k": 0}).status_code == 422
    bad = client.post("/gnn/predict", json={"asof": "not-a-date"})
    assert bad.status_code == 422 and bad.json()["code"] == "invalid_asof"
    r = client.post("/gnn/transactions", json={"transactions": [dict(tx_id="n", sender="A", receiver="B", amount=-5, timestamp=NOW),
                                                                dict(tx_id="m", sender="A", receiver="A", amount=5, timestamp=NOW),
                                                                dict(tx_id="k", sender="A", receiver="B", amount=5, timestamp="garbage")]}).json()
    assert r["accepted"] == 0 and r["invalid"] == 3


def test_store_is_bounded_by_window(client):
    old = [dict(tx_id=f"o{i}", sender="A", receiver="B", amount=10, timestamp=NOW - 200000 + i) for i in range(5)]
    client.post("/gnn/transactions", json={"transactions": txs() + old})
    s = client.get("/gnn/health").json()["model"]["store"]
    assert s["transactions"] == 40 and s["late"] + s["evicted"] == 5      # events older than the 24h window never stay in the store


def test_existing_endpoints_unchanged(client):
    assert client.get("/health").json()["model"] == "IsolationForest"
    r = client.post("/predict", json={"tx_id": "t"}).json()
    assert isinstance(r["is_anomaly"], bool) and "fraud_probability" in r
    g = client.post("/graph/analyze", json={"nodes": [{"id": "a"}, {"id": "b"}], "edges": [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}]}).json()
    assert g["round_trip_detected"] is True
    assert client.get("/model/info").json()["algorithm"] == "Isolation Forest"
