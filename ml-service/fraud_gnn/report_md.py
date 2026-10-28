"""Render docs/GNN_RESULTS.md from the measured evaluation.json (no hand-typed numbers).
   python -m fraud_gnn.report_md [artifact_dir] [out.md]"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from .config import ARTIFACT_DIR, ROOT

ORDER = [("rules_only", "Rules only (alert threshold 30)"), ("rules_only_high_threshold_60", "Rules only (HIGH >= 60)"),
         ("isolation_forest_only", "Isolation Forest only"), ("rules_plus_isolation_forest", "Rules + Isolation Forest"),
         ("gnn_only", "GNN only"), ("fusion_rules_if_gnn", "Rules + IF + GNN (fusion, production defaults)"), ("fusion_tuned_on_validation", "Rules + IF + GNN (fusion, weights/floor tuned on validation)")]


def pm(v):
    return f"{v[0]:.3f} ± {v[1]:.3f}"


def main(argv=None):
    a = argv if argv is not None else sys.argv[1:]
    d = Path(a[0]) if a else ARTIFACT_DIR
    out = Path(a[1]) if len(a) > 1 else ROOT.parent / "docs" / "GNN_RESULTS.md"
    ev = json.loads((d / "evaluation.json").read_text()); meta = json.loads((d / "metadata.json").read_text())
    L = ["# GNN evaluation results (measured)", "",
         f"Generated from `{d.name}/evaluation.json` by `python -m fraud_gnn.report_md`. Model v{meta['model_version']}, trained {meta['trained_at']}, "
         f"torch {meta['torch']}, Python {meta['python']}, CPU. **Synthetic data only: these numbers do not demonstrate real-world AML effectiveness.**", "",
         "## Data and split", "", "| period | snapshots | account-snapshots | positive (suspicious) |", "|---|---|---|---|"]
    for p, c in ev["counts"].items():
        L.append(f"| {p} | {c['snapshots']} | {c['nodes']:,} | {c['positives']:,} ({100 * c['positives'] / c['nodes']:.2f}%) |")
    L += ["", ev["split"]["strategy"] + ".", "",
          f"Window {ev['split']['window_hours']} h, stride {ev['split']['stride_hours']} h; days per period: " + ", ".join(f"{k} {v[0]:.0f}-{v[1]:.0f}" for k, v in ev["split"]["bounds_days"].items()) + ".", ""]
    if "methods" in ev:
        L += ["## Held-out test results (mean ± std over %d training seeds; deterministic baselines have std 0)" % next(iter(ev["methods"].values()))["runs"], "",
              "| method | precision | recall | F1 | false-positive rate | FN (count) | FP (count) | ROC-AUC | PR-AUC | recall @ 1% FPR |", "|---|---|---|---|---|---|---|---|---|---|"]
        for k, name in ORDER:
            if k in ev["methods"]:
                m = ev["methods"][k]["metrics"]
                L.append(f"| {name} | {pm(m['precision'])} | {pm(m['recall'])} | {pm(m['f1'])} | {pm(m['false_positive_rate'])} | {m['false_negatives'][0]:.0f} | {m['false_positives'][0]:.0f} | {pm(m['roc_auc'])} | {pm(m['pr_auc'])} | {pm(m['recall_at_fpr_1pct'])} |")
        L += ["", ev["alignment"], "", "## Recall per scenario family (test period)", "",
              "`base` = parameters like training; `shifted` = parameters outside the training range; `unseen_family` = scenario type never seen in training.", ""]
        keys = sorted({s for k, _ in ORDER if k in ev["methods"] for s in ev["methods"][k]["per_scenario_recall"]})
        L += ["| scenario / variant | n (positive account-snapshots) | " + " | ".join(n for k, n in ORDER if k in ev["methods"]) + " |", "|---|---|" + "---|" * sum(1 for k, _ in ORDER if k in ev["methods"])]
        for s in keys:
            ref = next(ev["methods"][k]["per_scenario_recall"][s] for k, _ in ORDER if k in ev["methods"] and s in ev["methods"][k]["per_scenario_recall"])
            L.append(f"| {s} | {ref['n']} | " + " | ".join(f"{ev['methods'][k]['per_scenario_recall'].get(s, {'recall': float('nan')})['recall']:.2f}" for k, _ in ORDER if k in ev["methods"]) + " |")
    if ev.get("fusion_tuned_configs"):
        L += ["", "## Fusion configurations", "", f"Production defaults: weights {ev['fusion_default_config']['weights']}, rule floor {ev['fusion_default_config']['rule_floor']}. "
              "The tuned variant is a sensitivity analysis: a grid over weights and rule floor (floor 101 = disabled) scored on the VALIDATION period only, then applied to test:", ""]
        L += [f"* seed {i}: weights {c['weights']}, rule floor {c['rule_floor']}, validation F1 {c['val_f1']:.3f}" for i, c in enumerate(ev["fusion_tuned_configs"])]
    L += ["", "## GNN alone, per training seed", "", "| seed | precision | recall | F1 | FPR | ROC-AUC | PR-AUC |", "|---|---|---|---|---|---|---|"]
    for r in ev["gnn_seeds"]:
        L.append(f"| {r['seed']} | {r['precision']:.3f} | {r['recall']:.3f} | {r['f1']:.3f} | {r['false_positive_rate']:.4f} | {r['roc_auc']:.3f} | {r['pr_auc']:.3f} |")
    out.parent.mkdir(parents=True, exist_ok=True); out.write_text("\n".join(L) + "\n")
    print("wrote", out)


if __name__ == "__main__":
    main()
