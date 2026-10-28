import json
import shutil
import subprocess
import sys

import numpy as np
import pandas as pd
import pytest
import torch

from fraud_gnn.datagen import SimConfig, generate
from fraud_gnn.dataset import build_snapshots
from fraud_gnn.features import N_EDGE, N_NODE
from fraud_gnn.inference import ArtifactError, GNNService, LoadedModel
from fraud_gnn.model import GraphSAGEClassifier
from fraud_gnn.preprocess import NodeScaler

CFG = SimConfig(n_accounts=300, train_days=5, val_days=2, test_days=3, normal_tx_per_day=120)


def test_model_forward_shapes():
    m = GraphSAGEClassifier(N_NODE, N_EDGE + 1, hidden=16)
    x = torch.randn(5, N_NODE); ei = torch.tensor([[0, 1, 2], [1, 2, 0]]); ea = torch.randn(3, N_EDGE + 1)
    out = m(x, ei, ea)
    assert out.shape == (5,)
    m.eval()
    assert torch.allclose(m(x, ei, ea), m(x, ei, ea))             # deterministic in eval mode


def test_datagen_is_reproducible_and_has_no_id_shortcut():
    a, acc = generate(CFG); b, _ = generate(CFG)
    pd.testing.assert_frame_equal(a, b)
    actors = set(a[(a.fraud == 1) & a.s_actor].sender) | set(a[(a.fraud == 1) & a.r_actor].receiver)
    ids = sorted(int(x[3:]) for x in acc.account_id)
    act = sorted(int(x[3:]) for x in actors)
    assert np.mean(act) / np.mean(ids) > 0.7 and np.mean(act) / np.mean(ids) < 1.3      # actor ids are spread over the whole id range
    assert "fraud" not in __import__("fraud_gnn.features", fromlist=["NODE_FEATURES"]).NODE_FEATURES


def test_split_has_no_window_or_scenario_leakage():
    tx, acc = generate(CFG)
    snaps = build_snapshots(tx, acc, CFG.period_bounds(), 86400.0, 6 * 3600.0)
    used = {p: set() for p in ("train", "val", "test")}
    for s in snaps: used[s.period] |= set(s.graph.tx_ids)
    assert not (used["train"] & used["val"]) and not (used["val"] & used["test"]) and not (used["train"] & used["test"])
    sc = tx[tx.fraud == 1].groupby("scenario_id").period.nunique()
    assert (sc == 1).all()                                    # a scenario instance never straddles two periods
    assert tx[(tx.period == "test") & (tx.fraud == 1)].scenario.isin(["round_trip"]).any()   # unseen family present only at test
    assert not tx[(tx.period == "train") & (tx.scenario == "round_trip")].shape[0]


def test_scaler_fit_on_train_only_and_roundtrip():
    tx, acc = generate(CFG)
    snaps = build_snapshots(tx, acc, CFG.period_bounds(), 86400.0, 6 * 3600.0, periods=("train",))
    sc = NodeScaler.fit([s.graph.x_raw for s in snaps])
    again = NodeScaler.from_dict(json.loads(json.dumps(sc.to_dict())))
    assert np.allclose(sc.mean, again.mean) and np.allclose(sc.transform(snaps[0].graph.x_raw), again.transform(snaps[0].graph.x_raw))


def test_training_pipeline_produces_loadable_artifacts(artifacts):
    for f in ("model.pt", "config.json", "scaler.json", "metadata.json", "evaluation.json"):
        assert (artifacts / f).is_file()
    ev = json.loads((artifacts / "evaluation.json").read_text())
    assert set(ev["gnn_seeds"][0]) >= {"precision", "recall", "f1", "roc_auc", "pr_auc", "false_positive_rate", "false_positives", "false_negatives"}
    meta = json.loads((artifacts / "metadata.json").read_text())
    assert meta["smoke"] is True and 0 < meta["decision_threshold"] < 1
    # fresh interpreter can load it (independent inference path)
    code = f"from fraud_gnn.inference import GNNService; s=GNNService(r'{artifacts}'); print(s.ready)"
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=str(artifacts.parent.parent.parent) if False else None, env={**__import__('os').environ, "PYTHONPATH": str(__import__('pathlib').Path(__file__).resolve().parent.parent)})
    assert out.stdout.strip().endswith("True"), out.stderr[-400:]


def test_missing_checkpoint_is_reported_not_faked(tmp_path):
    s = GNNService(tmp_path)
    assert not s.ready and "missing model artifacts" in s.error
    with pytest.raises(ArtifactError):
        s.predict()


def test_incompatible_schema_or_weights_rejected(artifacts, tmp_path):
    d = tmp_path / "bad"; shutil.copytree(artifacts, d)
    cfg = json.loads((d / "config.json").read_text()); cfg["node_features"] = cfg["node_features"][:-1]
    (d / "config.json").write_text(json.dumps(cfg))
    with pytest.raises(ArtifactError, match="schema"):
        LoadedModel(d)
    d2 = tmp_path / "bad2"; shutil.copytree(artifacts, d2); (d2 / "model.pt").write_bytes(b"not a checkpoint")
    with pytest.raises(ArtifactError, match="weights"):
        LoadedModel(d2)
