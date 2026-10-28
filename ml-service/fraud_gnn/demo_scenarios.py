"""Replay scenario families (incl. shifted-parameter and unseen ones) through the saved GNN and print the ACTUAL predictions.

   python -m fraud_gnn.demo_scenarios [--artifacts DIR] [--seed 123]

A fresh seeded world is generated (different seed from training); for each scenario instance the 24 h window ending
just after it is scored.  Nothing is hard-coded: scores come from `GNNService.predict`.
"""
from __future__ import annotations

import argparse

import numpy as np

from .config import ARTIFACT_DIR
from .datagen import SimConfig, generate
from .features import clean_transactions, prior_last_activity
from .inference import GNNService, GraphStore


def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument("--artifacts", default=str(ARTIFACT_DIR)); ap.add_argument("--seed", type=int, default=123)
    a = ap.parse_args(argv)
    svc = GNNService(a.artifacts)
    if not svc.ready:
        raise SystemExit(f"model not ready: {svc.error}")
    cfg = SimConfig(seed=a.seed, n_accounts=1500, train_days=2, val_days=2, test_days=8, normal_tx_per_day=600, shifted_fraction_test=0.5)
    tx, acc = generate(cfg)
    clean, _ = clean_transactions(tx[["tx_id", "sender", "receiver", "amount", "ts", "channel"]])
    initial = acc.set_index("account_id").initial_last_active
    accs = acc.set_index("account_id")
    window = svc.loaded.window_hours * 3600.0
    test = tx[(tx.period == "test") & (tx.fraud == 1)]
    print(f"model v{svc.loaded.version}  decision threshold maps to score 60  (flag = model output >= validation threshold)\n")
    print(f"{'scenario / variant':<28}{'actors':>7}{'flagged':>9}{'min':>7}{'median':>8}{'max':>7}   {'normal accts':>12}{'flagged':>9}")
    for (sc, var), g in test.groupby(["scenario", "variant"]):
        sid = g.scenario_id.iloc[0]; inst = g[g.scenario_id == sid]
        asof = float(inst.ts.max()) + 1.0; ws = asof - window
        win = clean[(clean.ts > ws) & (clean.ts <= asof)]
        prior = prior_last_activity(clean[clean.ts <= ws], ws, initial)
        store = GraphStore(window)
        store.upsert_accounts([dict(account_id=i, kyc_level=r.kyc_level, status=r.status, balance=float(r.balance), opened_ts=float(r.opened_ts),
                                    prior_last_active_ts=float(prior[i]) if i in prior else None) for i, r in accs.loc[sorted(set(win.sender) | set(win.receiver))].iterrows()])
        store.ingest(win.to_dict("records"))
        res = svc.predict(asof=asof, store=store)["results"]
        by = {r["account_id"]: r for r in res}
        actors = set(inst[inst.s_actor].sender) | set(inst[inst.r_actor].receiver)
        # accounts that are actors of ANY scenario in this window are excluded from the "normal" group
        any_actor = set(tx[(tx.fraud == 1) & (tx.ts > ws) & (tx.ts <= asof) & tx.s_actor].sender) | set(tx[(tx.fraud == 1) & (tx.ts > ws) & (tx.ts <= asof) & tx.r_actor].receiver)
        normals = [r for k, r in by.items() if k not in any_actor]
        sc_act = np.array([by[x]["risk_score"] for x in actors if x in by])
        print(f"{sc + ' / ' + var:<28}{len(actors):>7}{sum(by[x]['flagged'] for x in actors if x in by):>9}{sc_act.min():>7.0f}{np.median(sc_act):>8.0f}{sc_act.max():>7.0f}   {len(normals):>12}{sum(r['flagged'] for r in normals):>9}")
    print("\nNote: one instance per family; see docs/GNN_RESULTS.md for the full held-out evaluation. Synthetic data.")


if __name__ == "__main__":
    main()
