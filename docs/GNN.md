# Graph Neural Network layer

Fraudscope now has three complementary detection layers plus graph analytics:

| layer | what it is | granularity |
|---|---|---|
| 1. Rule engine (existing) | six AML rules + geo + receiver reputation, composite 0-100 | transaction |
| 2. Isolation Forest (existing, now actually wired in) | unsupervised anomaly detector fed by the rule engine's feature vector | transaction |
| 3. **GNN (new)** | edge-aware GraphSAGE node classifier over the recent transaction graph | **account** |
| support | NetworkX analytics (cycles, SCCs, hubs/sinks via `/graph/analyze`; SCC size and reciprocal flows also feed GNN features / evidence) | graph |
| fusion | `backend/services/riskFusion.js`, transparent weighted fusion with an authoritative-rule floor | transaction / account |

```
 simulator -> rule engine -----------------------------+
      |            |  (63 features)                    v
      |            +--> Isolation Forest (/predict) --> riskFusion --> final_risk_score on tx + alert evidence
      |                                                 ^
      +--> batched /gnn/transactions --> rolling graph store --> GraphSAGE --> account risk cache (/gnn/predict, every ~5 s)
                                                                                    |--> GNN_ACCOUNT_RISK alerts (deduplicated)
                                                                                    |--> Socket.io `gnn_update`, REST /api/ml/*
```

## Why GraphSAGE, and what the model learns
GraphSAGE aggregates neighbour information with *learned* functions, works on unseen/new nodes (inductive) and is cheap on CPU, which suits a hackathon demo and a streaming graph where accounts appear constantly. Standard GraphSAGE ignores edge attributes, but amount, timing gaps, forwarded fraction and direction carry most of the AML signal, so the layer is **edge-aware**: the neighbour message is `MLP([h_neighbour, edge_features])`, aggregated with mean‖max, concatenated with the node's own state and passed through a learned update (`ml-service/fraud_gnn/model.py`, 2 layers, hidden 64, dropout 0.3, ~28k parameters). An account can look ordinary by itself and become suspicious because of who paid it and how quickly it forwards: that neighbourhood context is exactly what a tabular model cannot see.

The output is a **statistical risk indicator for an account in the current window**, not a statement of criminal intent and not a calibrated probability.

## Graph construction (`fraud_gnn/features.py`)
* **Nodes** = account ids; **edges** = individual transactions, directed `sender -> receiver`; parallel edges are kept (several transfers = several edges).
* Node indices are local to one `WindowGraph` and only produced by `build_window_graph`; the id <-> index map travels with the graph (ids are never assumed to be integers or consecutive).
* **Reverse message-passing edges** are added only in `to_model_inputs`, with a direction flag (0 = real transfer, 1 = reverse), so the model can tell them apart and explanations always use the real direction.
* **Time**: epoch seconds, UTC; naive timestamps are treated as UTC (`parse_ts`). The window is `(asof - W, asof]` (default W = 24 h, `GNN_WINDOW_HOURS`); a transaction after `asof` can never influence a prediction (test: `test_window_boundaries_and_no_future_leakage`).
* **Hygiene** (`clean_transactions`): duplicate `tx_id`s, non-positive/NaN amounts, self-transfers, missing ids/timestamps are dropped and counted; unknown accounts get neutral static defaults; empty graphs return empty results.
* **Streaming** (`inference.GraphStore`): thread-safe, event-time bounded window, de-duplicated by `tx_id`, hard cap `GNN_MAX_STORE_TX`; older events leave the window and become "prior activity" (used for the leak-free dormancy feature).

## Features (`NODE_FEATURES`, `EDGE_FEATURES`)
Node (26, all computed from the window, scaled with a scaler fitted on **training snapshots only**): out/in transaction count, amount sum/mean/max (log), distinct out/in counterparties, out-share of flow, retention, near-threshold outgoing count (INR 45,000-50,000 band), min/mean inter-event gap, peak events in 30 min, fraction of outgoing transfers that forward >= 80% of funds received in the previous 5 minutes (pass-through), reciprocal partners and strongly-connected-component size (NetworkX), recency/span in window, KYC level, DORMANT status, log balance, log account age, log dormancy days (time since last activity **before** the window).
Edge (11 + direction flag): log amount, age in window, log gap since the sender's previous incoming transfer, forwarded fraction of that transfer, has-previous flag, hour sin/cos, near-threshold flag, channel one-hot.

**Deliberately not used**: account type (SHELL/MULE), the rule engine's account `risk_score`, rule flags, alert status, Isolation Forest output, any label. Existing detector outputs are only combined *after* the GNN, in fusion.

## Task, labels and synthetic data (`fraud_gnn/datagen.py`, `dataset.py`)
Task: **binary node classification** - "is this account involved in a suspicious scenario in the current window?". Positives are the *actor* accounts of generated scenarios whose transactions fall in the window (layering chain members, structuring sender, fan-out sender and recipients, mule collector and forwarder, dormant account and funder, velocity-burst sender, round-trip members); innocent counterparties (e.g. victims paying a mule, structuring recipients) are negatives. Overlapping scenarios keep the first scenario label (per-scenario recall uses it). Accounts without any transaction in the window are not scored (`status: no_recent_activity`).

Anti-shortcut measures (all tested): account ids are a random permutation and fraud actors are spread over the whole id range; 40% of actors are previously active ("compromised") accounts; account type is not a feature; legitimate look-alikes are generated (payroll bursts, merchants, slow multi-hop legit transfers, near-threshold one-offs, traders with high velocity, rent deposit/refund round-trips, legitimate dormant reactivation), so no single feature separates the classes. The generator is seeded and reproducible.

Scenarios: structuring, layering, fan-out, dormant activation, velocity, mule collect-and-forward (all supported by the rule engine) + **round-trip** which exists **only in the test period** to measure generalisation to an unseen family. In the test period 50% of scenarios use parameters outside the training range ("shifted": different chain lengths, slower hops, different amounts, fewer/more receivers).

## Evaluation protocol
* Temporal split with disjoint windows: train days 0-26, validation 26-34, test 34-44; snapshots are built every 6 h with a 24 h window, and only snapshots whose whole window lies inside one period are used, so no transaction appears in two splits; scenarios never start in the last 4 h of a period (a scenario instance never straddles two splits). Both properties are unit-tested.
* Hyper-parameters are fixed defaults (no search). Early stopping and the decision threshold use the **validation** period only. Three training seeds; mean ± std reported.
* Baselines run on the same account-snapshot instances: the **existing Node rule engine** is replayed over the stream (`backend/scripts/replay_engine.js`, clock pinned to simulated time, keeping only the most recent 2,500 transactions in memory as the live pipeline does) and the **existing Isolation Forest** scores the engine's feature vectors; transaction verdicts are aligned to accounts (flagged if sender or receiver of a flagged transaction in the window, score = max). The fusion row uses the production `riskFusion.js` through `scripts/fuse_scores.js`, with its threshold chosen on validation.
* Metrics: precision, recall, F1, false-positive rate and counts, FN count, ROC-AUC, PR-AUC, recall at 1% FPR, per-scenario/variant recall.

Measured numbers are generated into **[`docs/GNN_RESULTS.md`](GNN_RESULTS.md)** (`python -m fraud_gnn.report_md`) from `ml-service/models/gnn/evaluation.json`; nothing is typed by hand. Read them with the caveats below.

### How to read the measured results (full tables in `GNN_RESULTS.md`)
Headline (test period, 3 seeds, synthetic data): GNN alone reaches F1 about 0.94 (precision about 0.97, recall about 0.92, false-positive rate about 0.1%); the existing rule engine flags 43% of normal account-snapshots at its alert threshold 30 (F1 0.08) and 12% at HIGH >= 60 (F1 0.13); the Isolation Forest, using its own anomaly decision, is precise but finds almost nothing (recall 0.03) although its ranking is useful (ROC-AUC 0.92). Reasons to treat this carefully rather than as a win:
* The benchmark generator is ours, GNN training data come from the same generator, and the rules are not trained on it. The comparison shows what a graph model can learn from this simulator, not how the rule engine performs in a real bank.
* The rule baseline is aligned to accounts with a generous "any flagged transaction in 24 h" rule, which maximises its recall and its false positives; the HIGH >= 60 row shows another operating point. Rule alerts are meant for investigator review of transactions, not account labelling.
* Weak spots are visible: structuring is the hardest family for the GNN (recall 0.69 base / 0.48 shifted) - a few near-threshold transfers carry little graph structure - and dormant/shifted (0.65) and layering/shifted (0.89) drop when parameters leave the training range. The unseen round-trip family is detected at 0.91. The rules do better than the GNN on some shifted families (e.g. dormant/shifted, layering/shifted), which is why fusion keeps the rules authoritative.
* **Fusion with the production defaults (rules 0.5 / IF 0.2 / GNN 0.3, rule floor 60) is worse than the GNN alone on this benchmark** (F1 0.28): the rules' false positives dominate. Weights and floor tuned on the validation period (rules 0.1, floor disabled) recover GNN-level performance (F1 0.95). Defaults were deliberately kept conservative (rules never diluted); change them with `FUSION_WEIGHTS` / `FUSION_RULE_FLOOR` after validating on your own data.

### Measured inference latency
`python -m fraud_gnn.bench` (CPU only, 4 cores x86_64, torch 2.15.0, quiet machine, warm-up then median of 9 calls, random transaction graphs; wall time of `GNNService.predict` = graph build + features + forward + evidence):

| transactions in window | accounts | median ms (no attribution) | median ms (with attribution) |
|---|---|---|---|
| 1,000 | 400 | 38 | 26 |
| 5,000 | 1,500 | 77 | 79 |
| 20,000 | 3,000 | 217 | 264 |
| 50,000 | 6,000 | 549 | 627 |

Timings were noisy when other processes were running (individual runs varied by an order of magnitude), so treat them as indicative. The Node backend therefore runs the analysis cycle every few seconds in the background and never inside the transaction path.

### Screenshots
`docs/img/gnn_dashboard.png`, `gnn_transaction_detail.png`, `gnn_alert_evidence.png`, `gnn_graph.png` (captured from the running app with the committed model).

## Risk fusion (`backend/services/riskFusion.js`)
`score = sum(w_i * s_i) / sum(w_i)` over the detectors that are *available* (defaults rules 0.5, Isolation Forest 0.2, GNN 0.3 - configuration, not fitted optima; `FUSION_WEIGHTS`), a floor `final >= rules` when `rules >= 60` (authoritative high-confidence rule hits are never diluted), clamp to 0-100, map to the engine's LOW/MEDIUM/HIGH/CRITICAL bands. A missing detector re-normalises the weights instead of counting as zero. Every detector's own output stays visible (`tx.detectors`), the existing `risk_score` keeps its rule-engine meaning, and the fused value is stored separately as `final_risk_score`. Correlated evidence is not double-counted by any bonus term. The GNN score is the threshold-anchored sigmoid output (the validation-selected decision threshold maps to 60); it is an indicator, not a probability.

Alert policy: rule alerts are unchanged and receive detector evidence; the GNN can additionally raise a `GNN_ACCOUNT_RISK` alert per flagged account when score >= `GNN_ALERT_MIN_SCORE` (70), with one open alert per account, a per-account cooldown (30 min) and a global hourly cap (30). Repeated inference refreshes evidence instead of duplicating alerts.

## Explainability (what it is and is not)
`topological_evidence`: structural facts about the account in the window (pass-through forwards, fan-out/fan-in degree, bursts, threshold-hugging transfers, circular flow). `model_evidence`: other accounts flagged in the neighbourhood and, for flagged accounts, the three node features with the largest gradient x input attribution. These are supporting observations and correlational attributions, not proof of laundering and not a faithful causal explanation of the model.

## Running it
```bash
# one-time
python -m venv .venv && source .venv/bin/activate
pip install -r ml-service/requirements.txt          # CPU PyTorch + PyG, FastAPI, scikit-learn, networkx ...
(cd backend && npm install) && (cd frontend && npm install)

# train + evaluate (generates data, trains 3 seeds, replays the Node rule engine, scores the Isolation Forest, writes artifacts)
cd ml-service && python -m fraud_gnn.train          # ~12 min on 4 CPU cores (the first run also replays the Node rule engine, ~6 min; --reuse-replay skips that);  --smoke for a ~1 min check
python -m fraud_gnn.report_md                       # -> docs/GNN_RESULTS.md

# run the system (3 terminals)
cd ml-service && python -m uvicorn app:app --port 8000        # loads models/gnn/* at start-up (inference only)
cd backend    && npm run demo                                  # ML_SERVICE_URL defaults to http://localhost:8000
cd frontend   && npm run dev                                   # http://localhost:5173
```
Inference-only start: artifacts live in `ml-service/models/gnn/` (committed); `GNN_ARTIFACT_DIR` overrides the location. Missing/incompatible artifacts make `/gnn/health` report `ready: false` with a reason and `/gnn/predict` return HTTP 503 - the service never fabricates random-weight predictions. Training is a CLI operation; there is no training endpoint.

### API (ML service)
`GET /gnn/health`, `GET /gnn/model`, `POST /gnn/transactions` (ingest), `POST /gnn/predict`. Interactive docs at `http://localhost:8000/docs`.
```bash
curl -s localhost:8000/gnn/health
curl -s -XPOST localhost:8000/gnn/predict -H 'content-type: application/json' -d '{
  "transactions":[{"tx_id":"t1","sender":"A","receiver":"B","amount":48000,"timestamp":"2026-01-01T10:00:00Z"},
                  {"tx_id":"t2","sender":"B","receiver":"C","amount":47000,"timestamp":"2026-01-01T10:00:40Z"}],
  "explain":true}'
```
Response (shape): `{"status":"success","model":"GraphSAGE (edge-aware)","model_version":"1.0.0","prediction_type":"account_risk","results":[{"account_id":"B","risk_score":..., "risk_level":..., "flagged":..., "topological_evidence":[...], "model_evidence":[...]}], "graph":{"nodes":..,"edges":..,"inference_ms":..}}`. Errors: `{"status":"error","code":"model_not_ready|invalid_asof|too_many_transactions|inference_failed","message":...}`. Omit `transactions` to score the rolling store fed by `/gnn/transactions`.

### Backend endpoints (Node)
`GET /api/ml/status`, `GET /api/ml/gnn/accounts?limit=&min_score=`, `GET /api/ml/gnn/accounts/:id`, `POST /api/ml/gnn/refresh`; transactions carry `detectors`, `final_risk_score`, `final_risk_level`; accounts carry `gnn_*`; Socket.io `gnn_update`, `transaction_updated`. Env: `ML_SERVICE_URL`, `ML_TIMEOUT_MS` (1500), `ML_ENABLED=false` to switch the layers off, `GNN_FLUSH_MS`, `GNN_PREDICT_MS`, `FUSION_WEIGHTS`, `GNN_ALERT_*`. A circuit breaker (3 failures -> 15 s open) keeps the simulator running when the ML service is down.

## Tests
```bash
cd ml-service && python -m pytest tests -q     # graph construction, leakage, model/artifacts, training smoke, API
cd backend    && npm test                      # fusion, ML client resilience, pipeline logic, spawned-server integration (auth, STR workflow, Socket.io, ML up/down)
cd frontend   && npm test                      # GNN panel and detector breakdown states (loading/error/unavailable/ready/empty/missing fields)
```

## Demonstration
Start the three services, log in (`admin@fraudscope.ai` / `Fraudscope@2024`), open **Simulation Studio -> Scenario Generator** and run Layering, Structuring, Fan-out, Dormant and Mule, then watch: Dashboard (GNN card), Alerts (evidence under each alert; `GNN ACCOUNT RISK` alerts), Transactions (click a row for the detector breakdown), Graph (dashed purple ring = GNN-flagged), Accounts (GNN Risk column). Normal traffic runs continuously, so false positives are visible too. `ml-service/fraud_gnn/demo_scenarios.py` replays the same scenario families straight into the model with the measured predictions printed.

## Limitations (please read)
* All results are on **synthetic** data produced by the same author-defined generator that defines the labels; patterns that the generator encodes are easier than real laundering. Good test numbers do not show real-world effectiveness, and the system is a demo, not production-ready for regulated banking.
* The live demo simulator is much denser (10,000 accounts, ~0.5 tx/s) than the training simulation (3,000 accounts, ~1,100 tx/day); until the 24 h window fills, live features are computed from short history, so live GNN flags can differ from the offline evaluation. Retrain with a generator that matches your deployment.
* The model scores accounts, not transactions; a transaction shows the higher of its two endpoints' scores, labelled as account scope.
* The Isolation Forest's `fraud_probability` is a heuristic, not a probability; fusion treats it as a normalised indicator.
* MongoDB mode (`backend/server.js`) is implemented with the same pipeline and persistence hooks and was exercised with stubbed models only (no MongoDB available in the build environment).
* Gradient x input attributions are an approximation; do not present them as legal evidence. Generated STR documents are demo artefacts, not regulatory filings.
