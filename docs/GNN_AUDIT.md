# Repository audit (before the GNN upgrade)

Findings are from reading and running the code, not from the README. "Baseline" = state before this upgrade.

## Architecture as found
| service | entry | notes |
|---|---|---|
| React/Vite frontend | `frontend/` (port 5173) | pages: Dashboard, Transactions, Graph, Alerts, Investigations, Accounts, GeoMap, Rules, Simulation Studio |
| Node backend (demo) | `backend/mock-server.js` (5000) | in-memory store, 10,000 seeded accounts, simulator, Socket.io, REST |
| Node backend (Mongo) | `backend/server.js` | same API on MongoDB; used `runFraudChecks` which does not exist (fixed earlier in this project) |
| ML service | `ml-service/app.py` (8000) | FastAPI: Isolation Forest (`/predict`, `/predict/batch`, `/predict/legacy`), NetworkX (`/graph/analyze`), `/model/info`, `/health` |

## Detection pipeline as found
`emitTransaction()` -> `detectFraud()` (`backend/fraud_engine/ruleEngine.js`): six rules (structuring, layering, fan-out, dormant, velocity, mule) + geo + receiver reputation + behavioural baseline -> composite 0-100 score (`LOW <30, MEDIUM 30-59, HIGH 60-79, CRITICAL >=80`); score >= 30 creates an alert. The engine returns a 63-field feature vector (`mlFeatures`) intended for the Isolation Forest.

## Findings relevant to the upgrade
1. **The Node backend never called the ML service.** `ML_SERVICE_URL` existed only in `.env.example`; no `axios`/HTTP call to port 8000 existed. The Isolation Forest was therefore *not* part of the running pipeline.
2. The Isolation Forest is trained at start-up on 3,300 synthetic rows (`get_or_train_model`), consumes the rule-engine scores as inputs, and its `fraud_probability` is a heuristic (`(-score+0.5)*80`, plus a rule boost) that is **not calibrated**: typical inputs map to 76-89, so it should not be read as a probability.
3. **Baseline failure:** `POST /predict` returned HTTP 500 with the installed FastAPI/NumPy (`numpy.bool` is not JSON-serialisable). Fixed (`bool(...)`).
4. **Baseline bug:** the rule engine reads `Date.now()` in several rules and the receiver's `last_active`; the live pipeline advanced `last_active` *before* scoring, so dormant-account activation could never fire. Fixed (activity is advanced after scoring); a `DORMANT_ACTIVATION` alert is now produced in the live demo.
5. The layering rule walked forward from the sender, where later hops do not exist yet, so it never detected chains (fixed earlier in this project).
6. API routes have no JWT verification middleware (tokens are issued but not enforced) - pre-existing, unchanged; new ML routes are read-only and no training endpoint is exposed.
7. Existing automated tests before the upgrade: only `backend/_test_engine.js` (smoke test, passes). No Python, frontend or integration tests.
8. Simulator accounts typed `SHELL`/`MULE` are the accounts used by fraud scenarios and the rule engine reads `account_type` - a built-in shortcut for the rules. The GNN never sees `account_type` and its training data does not tie fraud to account type.

## Baseline run
`node backend/_test_engine.js` passes; ML service starts and `/health` works; `/predict` failed (finding 3). Frontend builds; 41 lint errors, mostly React-compiler style rules, none blocking.

## Files added / changed by the upgrade
See `docs/GNN.md` section "What changed".
