# GNN evaluation results (measured)

Generated from `gnn/evaluation.json` by `python -m fraud_gnn.report_md`. Model v1.0.0, trained 2026-10-28T22:04:39.637792+00:00, torch 2.15.0+cu132, Python 3.13.17, CPU. **Synthetic data only: these numbers do not demonstrate real-world AML effectiveness.**

## Data and split

| period | snapshots | account-snapshots | positive (suspicious) |
|---|---|---|---|
| train | 101 | 161,760 | 2,508 (1.55%) |
| val | 29 | 46,862 | 527 (1.12%) |
| test | 37 | 59,723 | 1,475 (2.47%) |

temporal split with disjoint windows (no window crosses a period boundary) + scenario-instance grouping; test period uses shifted scenario parameters and an unseen scenario family (round_trip).

Window 24.0 h, stride 6.0 h; days per period: train 0-26, val 26-34, test 34-44.

## Held-out test results (mean ± std over 3 training seeds; deterministic baselines have std 0)

| method | precision | recall | F1 | false-positive rate | FN (count) | FP (count) | ROC-AUC | PR-AUC | recall @ 1% FPR |
|---|---|---|---|---|---|---|---|---|---|
| Rules only (alert threshold 30) | 0.042 ± 0.000 | 0.749 ± 0.000 | 0.080 ± 0.000 | 0.430 ± 0.000 | 370 | 25023 | 0.726 ± 0.000 | 0.078 ± 0.000 | 0.085 ± 0.000 |
| Rules only (HIGH >= 60) | 0.077 ± 0.000 | 0.399 ± 0.000 | 0.129 ± 0.000 | 0.121 ± 0.000 | 886 | 7038 | 0.726 ± 0.000 | 0.078 ± 0.000 | 0.085 ± 0.000 |
| Isolation Forest only | 1.000 ± 0.000 | 0.033 ± 0.000 | 0.064 ± 0.000 | 0.000 ± 0.000 | 1426 | 0 | 0.922 ± 0.000 | 0.467 ± 0.000 | 0.380 ± 0.000 |
| Rules + Isolation Forest | 0.042 ± 0.000 | 0.749 ± 0.000 | 0.080 ± 0.000 | 0.430 ± 0.000 | 370 | 25023 | 0.772 ± 0.000 | 0.082 ± 0.000 | 0.085 ± 0.000 |
| GNN only | 0.970 ± 0.009 | 0.920 ± 0.013 | 0.944 ± 0.010 | 0.001 ± 0.000 | 119 | 42 | 0.998 ± 0.000 | 0.980 ± 0.004 | 0.982 ± 0.003 |
| Rules + IF + GNN (fusion, production defaults) | 0.166 ± 0.001 | 0.957 ± 0.003 | 0.282 ± 0.001 | 0.122 ± 0.000 | 64 | 7114 | 0.908 ± 0.001 | 0.132 ± 0.000 | 0.085 ± 0.000 |
| Rules + IF + GNN (fusion, weights/floor tuned on validation) | 0.969 ± 0.012 | 0.924 ± 0.008 | 0.946 ± 0.008 | 0.001 ± 0.000 | 112 | 44 | 0.993 ± 0.001 | 0.968 ± 0.006 | 0.972 ± 0.005 |

Transaction-level detectors are aligned to account level per snapshot: an account is flagged if it is sender or receiver of any flagged transaction in the window; score = max over those transactions. Rules/IF use their native decisions (rule alert threshold 30 / Isolation Forest is_anomaly); GNN and fusion thresholds are chosen on the validation period.

## Recall per scenario family (test period)

`base` = parameters like training; `shifted` = parameters outside the training range; `unseen_family` = scenario type never seen in training.

| scenario / variant | n (positive account-snapshots) | Rules only (alert threshold 30) | Rules only (HIGH >= 60) | Isolation Forest only | Rules + Isolation Forest | GNN only | Rules + IF + GNN (fusion, production defaults) | Rules + IF + GNN (fusion, weights/floor tuned on validation) |
|---|---|---|---|---|---|---|---|---|
| dormant/base | 84 | 0.67 | 0.13 | 0.00 | 0.67 | 1.00 | 0.98 | 1.00 |
| dormant/shifted | 54 | 0.81 | 0.57 | 0.00 | 0.81 | 0.65 | 0.81 | 0.68 |
| fan_out/base | 359 | 0.63 | 0.19 | 0.00 | 0.63 | 1.00 | 0.99 | 1.00 |
| fan_out/shifted | 346 | 0.68 | 0.20 | 0.00 | 0.68 | 0.90 | 0.92 | 0.90 |
| layering/base | 108 | 0.82 | 0.55 | 0.00 | 0.82 | 1.00 | 1.00 | 1.00 |
| layering/shifted | 179 | 0.97 | 0.79 | 0.04 | 0.97 | 0.89 | 1.00 | 0.91 |
| mule/base | 30 | 0.90 | 0.87 | 0.00 | 0.90 | 1.00 | 1.00 | 1.00 |
| mule/shifted | 40 | 0.85 | 0.50 | 0.00 | 0.85 | 0.86 | 1.00 | 0.86 |
| round_trip/unseen_family | 178 | 0.93 | 0.78 | 0.23 | 0.93 | 0.91 | 0.98 | 0.92 |
| structuring/base | 18 | 0.28 | 0.22 | 0.00 | 0.28 | 0.69 | 0.76 | 0.67 |
| structuring/shifted | 29 | 0.52 | 0.07 | 0.00 | 0.52 | 0.48 | 0.62 | 0.46 |
| velocity/base | 20 | 0.90 | 0.50 | 0.00 | 0.90 | 0.97 | 0.98 | 0.95 |
| velocity/shifted | 30 | 0.53 | 0.33 | 0.00 | 0.53 | 0.94 | 0.94 | 0.94 |

## Fusion configurations

Production defaults: weights {'rules': 0.5, 'isolation_forest': 0.2, 'gnn': 0.3}, rule floor 60. The tuned variant is a sensitivity analysis: a grid over weights and rule floor (floor 101 = disabled) scored on the VALIDATION period only, then applied to test:

* seed 0: weights {'rules': 0.1, 'isolation_forest': 0.2, 'gnn': 0.7}, rule floor 101, validation F1 0.967
* seed 1: weights {'rules': 0.1, 'isolation_forest': 0.0, 'gnn': 0.5}, rule floor 101, validation F1 0.979
* seed 2: weights {'rules': 0.1, 'isolation_forest': 0.2, 'gnn': 0.3}, rule floor 101, validation F1 0.971

## GNN alone, per training seed

| seed | precision | recall | F1 | FPR | ROC-AUC | PR-AUC |
|---|---|---|---|---|---|---|
| 0 | 0.964 | 0.902 | 0.932 | 0.0009 | 0.998 | 0.975 |
| 1 | 0.984 | 0.933 | 0.958 | 0.0004 | 0.998 | 0.986 |
| 2 | 0.963 | 0.923 | 0.943 | 0.0009 | 0.998 | 0.980 |
