"""Reproducible GNN pipeline:  python -m fraud_gnn.train  [--smoke] [--skip-baselines] [--out DIR]

1. generate synthetic AML transactions (datagen.py)           5. evaluate vs rules / Isolation Forest / fusion
2. build leak-free window snapshots (dataset.py)              6. write artifacts + evaluation.json
3. fit scalers on TRAIN snapshots only (preprocess.py)
4. train GraphSAGE with early stopping on VALIDATION PR-AUC
"""
from __future__ import annotations

import argparse
import itertools
import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch

from . import __version__
from .config import ARTIFACT_DIR, SNAPSHOT_STRIDE_HOURS, WINDOW_HOURS, anchor_score
from .datagen import SimConfig, generate
from .dataset import build_snapshots
from .evaluate import (best_f1_threshold, fuse_scores, metrics, per_account, per_scenario_recall, run_isolation_forest, run_rule_engine)
from .features import EDGE_FEATURES, NODE_FEATURES, clean_transactions
from .preprocess import NodeScaler
from .trainer import DEFAULT_HP, predict_snapshots, train


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ARTIFACT_DIR)); ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--skip-baselines", action="store_true"); ap.add_argument("--reuse-replay", action="store_true", help="reuse work/replay_out.json from a previous run on the same dataset"); ap.add_argument("--seeds", type=int, default=3)
    a = ap.parse_args(argv)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True); work = out / "work"; work.mkdir(exist_ok=True)
    cfg = SimConfig(n_accounts=400, train_days=6, val_days=2, test_days=3, normal_tx_per_day=150) if a.smoke else SimConfig(val_days=8)
    hp = {**DEFAULT_HP, **({"epochs": 4, "patience": 2} if a.smoke else {})}
    seeds = list(range(1 if a.smoke else a.seeds))
    window, stride = WINDOW_HOURS * 3600.0, SNAPSHOT_STRIDE_HOURS * 3600.0
    t0 = time.time()

    print("[1/6] generating synthetic transactions ...")
    tx, accounts = generate(cfg)
    bounds = cfg.period_bounds()
    print("[2/6] building snapshots ...")
    snaps = build_snapshots(tx, accounts, bounds, window, stride)
    by = {p: [s for s in snaps if s.period == p] for p in ("train", "val", "test")}
    counts = {p: dict(snapshots=len(v), nodes=int(sum(len(s.y) for s in v)), positives=int(sum(s.y.sum() for s in v))) for p, v in by.items()}
    print("   ", counts)
    print("[3/6] fitting scaler on training snapshots only ...")
    scaler = NodeScaler.fit([s.graph.x_raw for s in by["train"]])

    print("[4/6] training GraphSAGE ...")
    runs = []
    for sd in seeds:
        model, info = train(by["train"], by["val"], scaler, hp, sd)
        pv = np.concatenate(predict_snapshots(model, scaler, by["val"])); yv = np.concatenate([s.y for s in by["val"]])
        thr = best_f1_threshold(yv, pv)
        runs.append(dict(seed=sd, model=model, info=info, thr=thr))
        print(f"    seed {sd}: best epoch {info['best_epoch']}, val PR-AUC {info['best_val_pr_auc']:.4f}, thr {thr:.4f}")
    primary = max(runs, key=lambda r: r["info"]["best_val_pr_auc"])

    print("[5/6] evaluating on held-out TEST period ...")
    yt = np.concatenate([s.y for s in by["test"]])
    gnn_runs = []
    for r in runs:
        pt = np.concatenate(predict_snapshots(r["model"], scaler, by["test"]))
        gnn_runs.append(dict(seed=r["seed"], **metrics(yt, pt, pt >= r["thr"])))
    evaluation = dict(counts=counts, gnn_seeds=gnn_runs, split=dict(
        strategy="temporal split with disjoint windows (no window crosses a period boundary) + scenario-instance grouping; "
                 "test period uses shifted scenario parameters and an unseen scenario family (round_trip)",
        bounds_days={k: [v[0] / 86400, v[1] / 86400] for k, v in bounds.items()}, window_hours=WINDOW_HOURS, stride_hours=SNAPSHOT_STRIDE_HOURS))
    if not a.skip_baselines:
        clean, _ = clean_transactions(tx[["tx_id", "sender", "receiver", "amount", "ts", "channel"]])
        warm = bounds["val"][0] - 3 * 86400 - window
        print("    replaying existing rule engine (node) ...")
        rules = run_rule_engine(tx, accounts, warm, warm, work, reuse=a.reuse_replay)
        print("    scoring existing Isolation Forest ...")
        iforest = run_isolation_forest(rules)
        verd = rules.merge(iforest, on="tx_id")
        fv, ft = per_account(by["val"], verd, clean), per_account(by["test"], verd, clean)
        table = {}; tuned_cfg = []
        def row(name, frame, score, pred): table.setdefault(name, []).append(dict(**metrics(frame.y, score, pred), per_scenario=per_scenario_recall(frame, pred)))
        for r in runs:
            fv["gnn"] = anchor_score(np.concatenate(predict_snapshots(r["model"], scaler, by["val"])), r["thr"]) / 100.0
            ft["gnn"] = anchor_score(np.concatenate(predict_snapshots(r["model"], scaler, by["test"])), r["thr"]) / 100.0
            gthr = float(anchor_score(r["thr"], r["thr"]) / 100.0)
            fv["fused"], ft["fused"] = fuse_scores(fv, work), fuse_scores(ft, work)
            fthr = best_f1_threshold(fv.y, fv.fused)
            # sensitivity: fusion weights / rule floor chosen on VALIDATION only (production defaults stay as documented)
            best = None
            for wr, wi, wg, fl in itertools.product([0.1, 0.2, 0.35, 0.5], [0.0, 0.1, 0.2], [0.3, 0.5, 0.7, 1.0], [60, 80, 101]):
                w = dict(rules=wr, isolation_forest=wi, gnn=wg)
                sv = fuse_scores(fv, work, w, fl); th = best_f1_threshold(fv.y, sv)
                f1v = metrics(fv.y, sv, sv >= th)["f1"]
                if best is None or f1v > best[0]: best = (f1v, w, fl, th)
            _, tw, tfl, tth = best
            st = fuse_scores(ft, work, tw, tfl)
            tuned_cfg.append(dict(weights=tw, rule_floor=tfl, val_f1=best[0]))
            row("fusion_tuned_on_validation", ft, st, st >= tth)
            row("rules_only", ft, ft.rule_score, ft.rule_flag)
            row("rules_only_high_threshold_60", ft, ft.rule_score, ft.rule_score >= 60)
            row("isolation_forest_only", ft, ft.if_score, ft.if_flag)
            row("rules_plus_isolation_forest", ft, np.maximum(ft.rule_score, ft.if_score), ft.rule_flag | ft.if_flag)
            row("gnn_only", ft, ft.gnn, ft.gnn >= gthr)
            row("fusion_rules_if_gnn", ft, ft.fused, ft.fused >= fthr)
        def agg(rows):
            keys = [k for k in rows[0] if k != "per_scenario"]
            d = {k: [float(np.mean([x[k] for x in rows])), float(np.std([x[k] for x in rows]))] for k in keys}
            scen = {}
            for k in rows[0]["per_scenario"]:
                scen[k] = dict(n=rows[0]["per_scenario"][k]["n"], recall=float(np.mean([x["per_scenario"].get(k, {"recall": 0})["recall"] for x in rows])))
            return dict(metrics=d, per_scenario_recall=scen, runs=len(rows))
        evaluation["methods"] = {k: agg(v) for k, v in table.items()}
        evaluation["fusion_tuned_configs"] = tuned_cfg
        evaluation["fusion_default_config"] = dict(weights=dict(rules=0.5, isolation_forest=0.2, gnn=0.3), rule_floor=60)
        evaluation["alignment"] = ("Transaction-level detectors are aligned to account level per snapshot: an account is flagged if it is sender or "
                                   "receiver of any flagged transaction in the window; score = max over those transactions. Rules/IF use their native "
                                   "decisions (rule alert threshold 30 / Isolation Forest is_anomaly); GNN and fusion thresholds are chosen on the validation period.")
    (out / "evaluation.json").write_text(json.dumps(evaluation, indent=1))

    print("[6/6] writing artifacts ...")
    torch.save(primary["model"].state_dict(), out / "model.pt")
    (out / "scaler.json").write_text(json.dumps(scaler.to_dict()))
    (out / "config.json").write_text(json.dumps(dict(
        architecture="EdgeSAGE (GraphSAGE with edge-aware messages, mean||max aggregation)", model_config=primary["model"].config,
        node_features=NODE_FEATURES, edge_features=EDGE_FEATURES, edge_dim_with_direction_flag=len(EDGE_FEATURES) + 1,
        window_hours=WINDOW_HOURS, label_mapping={"0": "no suspicious-scenario involvement", "1": "involved in suspicious scenario"},
        prediction_type="account_risk")))
    (out / "metadata.json").write_text(json.dumps(dict(
        model_version=__version__, trained_at=datetime.now(timezone.utc).isoformat(), seed=primary["seed"], decision_threshold=primary["thr"],
        hyperparameters=primary["info"]["hp"], best_epoch=primary["info"]["best_epoch"], val_pr_auc=primary["info"]["best_val_pr_auc"],
        test_metrics=next(g for g in gnn_runs if g["seed"] == primary["seed"]), data=counts, sim_config=cfg.__dict__ | {"scenarios_per_day": cfg.scenarios_per_day},
        torch=torch.__version__, python=platform.python_version(), smoke=bool(a.smoke), training_seconds=time.time() - t0), indent=1, default=str))
    print(f"done in {time.time() - t0:.0f}s -> {out}")


if __name__ == "__main__":
    main()
