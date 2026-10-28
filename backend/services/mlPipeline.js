/**
 * ML orchestration for the Node backend.
 *
 *   rule engine (existing)  ->  enrichTransaction():  Isolation Forest + GNN account risk + risk fusion
 *   queueTransaction()      ->  batched sync of the rolling transaction graph into the GNN service
 *   gnn poll loop           ->  account risk cache, GNN account alerts (deduplicated), Socket.io 'gnn_update'
 *
 * Failure policy: every ML interaction is optional.  If the ML service / model is unavailable the
 * existing rule-based pipeline continues unchanged and fusion renormalises over the detectors present.
 */
const { v4: uuidv4 } = require('uuid');
const { createMlClient } = require('./mlClient');
const { fuse, loadConfig, levelFor } = require('./riskFusion');

function createMlPipeline({ db, io, client, hooks = {}, env = process.env, now = () => Date.now() } = {}) {
  const ml = client || createMlClient();
  const cfg = {
    enabled: env.ML_ENABLED !== 'false',
    flushMs: Number(env.GNN_FLUSH_MS || 2000),
    predictMs: Number(env.GNN_PREDICT_MS || 5000),
    alertCooldownMs: Number(env.GNN_ALERT_COOLDOWN_MS || 30 * 60 * 1000),
    maxAlertsPerCycle: Number(env.GNN_MAX_ALERTS_PER_CYCLE || 5),
    alertMinScore: Number(env.GNN_ALERT_MIN_SCORE || 70),          // flagged accounts below this stay visible but do not open an alert
    maxAlertsPerHour: Number(env.GNN_MAX_ALERTS_PER_HOUR || 30),    // global alert-flood guard
    maxPending: Number(env.GNN_MAX_PENDING || 5000),
    batchSize: 1500,
  };
  const fusionCfg = loadConfig(env);
  const state = {
    gnn: { ready: false, version: null, reason: 'not checked yet', window_hours: null, decision_threshold: null, checkedAt: null },
    accounts: new Map(),               // account_id -> latest GNN result
    pending: [], pendingAccounts: new Map(),
    alertedAt: new Map(),              // account_id -> ms of last GNN alert
    alertLog: [],                      // timestamps of GNN alerts raised in the last hour
    dirty: false, lastPredictAt: null, lastAnalysisNodes: 0,
    counters: { ingested: 0, ingestFailures: 0, predictCalls: 0, predictFailures: 0, ifCalls: 0, ifFailures: 0, gnnAlerts: 0 },
  };
  let flushTimer = null, predictTimer = null, running = false;

  const iso = (d) => new Date(d).toISOString();
  // persistence hooks are optional (Mongo mode); a failing hook must never break detection
  const safe = (fn) => { try { const r = fn(); if (r && typeof r.catch === 'function') r.catch((e) => console.error('[ML] hook error:', e.message)); } catch (e) { console.error('[ML] hook error:', e.message); } };

  /** Called by the pipeline for every new transaction (prior_last_active = activity BEFORE this tx). */
  function queueTransaction(tx, senderAcc, receiverAcc, prior = {}) {
    if (!cfg.enabled) return;
    state.pending.push({ tx_id: tx.tx_id, sender: tx.sender, receiver: tx.receiver, amount: tx.amount, timestamp: iso(tx.timestamp), channel: tx.channel || 'MOBILE' });
    for (const [acc, prev] of [[senderAcc, prior.sender], [receiverAcc, prior.receiver]]) {
      if (!acc || state.pendingAccounts.has(acc.account_id)) continue;
      state.pendingAccounts.set(acc.account_id, {
        account_id: acc.account_id, kyc_level: acc.kyc_level, status: acc.status, balance: acc.balance,
        opened_at: acc.opened_at || acc.createdAt || undefined, prior_last_active: prev ? iso(prev) : undefined,
      });
    }
    if (state.pending.length > cfg.maxPending) state.pending.splice(0, state.pending.length - cfg.maxPending); // bounded memory
  }

  async function refreshHealth() {
    const r = await ml.gnnHealth();
    state.gnn.checkedAt = now();
    if (r.ok && r.data?.model?.ready) {
      const m = r.data.model;
      Object.assign(state.gnn, { ready: true, version: m.model_version, reason: null, window_hours: m.window_hours, decision_threshold: m.decision_threshold });
    } else {
      const reason = r.ok ? (r.data?.model?.reason || 'model not ready') : (r.error === 'circuit_open' ? 'ML service unreachable (circuit open)' : `ML service unreachable (${r.error})`);
      Object.assign(state.gnn, { ready: false, reason });
    }
    return state.gnn;
  }

  async function flush() {
    if (!cfg.enabled || state.pending.length === 0) return;
    const batch = state.pending.splice(0, cfg.batchSize);
    const accounts = [...state.pendingAccounts.values()]; state.pendingAccounts.clear();
    const r = await ml.gnnIngest({ transactions: batch, accounts });
    if (r.ok) { state.counters.ingested += r.data.accepted || 0; state.dirty = true; }
    else {
      state.counters.ingestFailures++;
      if (r.error !== 'model_not_ready') state.pending.unshift(...batch.slice(-500)); // retry a bounded tail later
      accounts.forEach((a) => { if (!state.pendingAccounts.has(a.account_id)) state.pendingAccounts.set(a.account_id, a); });
    }
  }

  function severityFor(score) { return score >= 80 ? 'CRITICAL' : 'HIGH'; }

  async function maybeAlert(res, budget) {
    if (budget.n <= 0 || !res.flagged || res.risk_score < cfg.alertMinScore) return false;
    state.alertLog = state.alertLog.filter((t) => now() - t < 3600 * 1000);
    if (state.alertLog.length >= cfg.maxAlertsPerHour) return false;
    const last = state.alertedAt.get(res.account_id) || 0;
    if (now() - last < cfg.alertCooldownMs) return false;
    const open = db.alerts.find((a) => a.alert_type === 'GNN_ACCOUNT_RISK' && a.account_references?.includes(res.account_id) && ['OPEN', 'INVESTIGATING'].includes(a.status));
    if (open) {                                                  // refresh evidence instead of duplicating
      open.risk_score = res.risk_score; open.updatedAt = new Date();
      open.metadata = { ...open.metadata, detectors: { gnn: detectorView(res) } };
      safe(() => hooks.persistAlertUpdate?.(open));
      return false;
    }
    // targeted (single-account) explanation only for accounts that actually open an alert
    const ex = await ml.gnnPredict({ account_ids: [res.account_id], explain: true });
    const detail = ex.ok ? ex.data.results?.find((x) => x.account_id === res.account_id) : null;
    if (detail) res = { ...res, model_evidence: detail.model_evidence, topological_evidence: detail.topological_evidence, graph_facts: detail.graph_facts };
    const recent = db.transactions.filter((t) => t.sender === res.account_id || t.receiver === res.account_id).slice(0, 5).map((t) => t.tx_id);
    const alert = {
      _id: uuidv4(), alert_id: `ALT-GNN-${uuidv4().slice(0, 8).toUpperCase()}`, alert_type: 'GNN_ACCOUNT_RISK',
      severity: severityFor(res.risk_score), risk_score: Math.round(res.risk_score), final_risk_score: Math.round(res.risk_score),
      status: 'OPEN', tx_references: recent, account_references: [res.account_id],
      description: `GNN flagged account ${res.account_id}: ${res.topological_evidence?.[0] || 'suspicious neighbourhood pattern'}`,
      metadata: {
        detectors: { gnn: detectorView(res) },
        reasons: [...(res.topological_evidence || []), ...(res.model_evidence || [])],
        note: 'GNN output is a statistical risk indicator, not proof of laundering.',
      },
      createdAt: new Date(), updatedAt: new Date(),
    };
    db.alerts.unshift(alert); if (db.alerts.length > 500) db.alerts.pop();
    safe(() => hooks.persistAlert?.(alert));
    state.alertedAt.set(res.account_id, now()); state.alertLog.push(now()); state.counters.gnnAlerts++; budget.n--;
    io?.emit('new_alert', alert);
    return true;
  }

  function detectorView(res) {
    return {
      available: true, scope: 'account', account_id: res.account_id, risk_score: res.risk_score, risk_level: res.risk_level, flagged: res.flagged,
      topological_evidence: res.topological_evidence || [], model_evidence: res.model_evidence || [], graph_facts: res.graph_facts || null,
      model_version: state.gnn.version, analysed_at: state.lastPredictAt ? iso(state.lastPredictAt) : null,
    };
  }

  async function predict(force = false) {
    if (!cfg.enabled || (!state.dirty && !force)) return null;
    const r = await ml.gnnPredict({ min_score: 0, top_k: 2000, explain: false });   // cheap cycle; attribution is requested per alert
    state.counters.predictCalls++;
    if (!r.ok) {
      state.counters.predictFailures++;
      if (r.error === 'model_not_ready') await refreshHealth();
      return null;
    }
    state.dirty = false; state.lastPredictAt = now(); state.lastAnalysisNodes = r.data.graph?.nodes || 0;
    state.gnn.ready = true; state.gnn.version = r.data.model_version;
    const seen = new Set(), budget = { n: cfg.maxAlertsPerCycle };
    for (const res of r.data.results) {
      if (res.risk_score === null || res.risk_score === undefined) continue;
      seen.add(res.account_id); state.accounts.set(res.account_id, { ...res, updated_at: now() });
      const acc = db.accounts.find((a) => a.account_id === res.account_id);
      const fields = { gnn_risk_score: res.risk_score, gnn_risk_level: res.risk_level, gnn_flagged: res.flagged, gnn_updated_at: new Date(), gnn_model_version: state.gnn.version };
      if (acc) Object.assign(acc, fields);
      safe(() => hooks.persistAccount?.(res.account_id, fields));
      await maybeAlert(res, budget);
    }
    for (const id of [...state.accounts.keys()]) if (!seen.has(id)) state.accounts.delete(id);   // out of window -> no stale scores
    refuseRecent();
    io?.emit('gnn_update', summary());
    return r.data;
  }


  /** GNN detector view for a transaction = the higher-scored of its two endpoints (account scope). */
  function gnnDetectorFor(tx) {
    const s = state.accounts.get(tx.sender), rc = state.accounts.get(tx.receiver);
    const pick = [s, rc].filter(Boolean).sort((a, b) => b.risk_score - a.risk_score)[0];
    return pick ? {
      available: true, scope: 'account', note: 'account-level risk of the transaction endpoints, not a transaction fraud probability',
      score: pick.risk_score, risk_level: pick.risk_level, model_version: state.gnn.version,
      sender: s ? detectorView(s) : null, receiver: rc ? detectorView(rc) : null,
    } : { available: false, scope: 'account', note: state.gnn.ready ? 'endpoints have no GNN score yet' : `GNN unavailable: ${state.gnn.reason}` };
  }

  /** Fuse rules + Isolation Forest + current GNN view and attach everything to the transaction / its rule alert. */
  function applyDetectors(tx, rulesInfo, iso_) {
    const gnn = gnnDetectorFor(tx);
    const f = fuse({ rules: rulesInfo.score, isolation_forest: iso_.available ? iso_.score : null, gnn: gnn.available ? gnn.score : null }, fusionCfg);
    tx.detectors = { rules: { available: true, ...rulesInfo }, isolation_forest: iso_, gnn, fusion: f };
    tx.final_risk_score = f.score; tx.final_risk_level = f.level;
    const alert = db.alerts.find((a) => a.tx_references?.includes(tx.tx_id) && a.alert_type !== 'GNN_ACCOUNT_RISK');
    if (alert) { alert.final_risk_score = f.score; alert.metadata = { ...alert.metadata, detectors: tx.detectors }; alert.updatedAt = new Date(); safe(() => hooks.persistAlertUpdate?.(alert)); }
    safe(() => hooks.persistTransaction?.(tx));
  }

  /** After each GNN cycle, re-fuse recent transactions whose endpoints now have (new) GNN scores. */
  function refuseRecent(limit = 150) {
    let n = 0;
    for (const tx of db.transactions.slice(0, 300)) {
      if (n >= limit) break;
      const d = tx.detectors; if (!d?.rules) continue;
      const before = tx.final_risk_score, hadGnn = d.gnn?.available, prevGnnScore = d.gnn?.score;
      applyDetectors(tx, { score: d.rules.score, level: d.rules.level, flags: d.rules.flags }, d.isolation_forest || { available: false });
      if (tx.final_risk_score !== before || tx.detectors.gnn.available !== hadGnn || tx.detectors.gnn.score !== prevGnnScore) { io?.emit('transaction_updated', tx); n++; }
    }
    return n;
  }

  /** Isolation Forest + GNN + fusion for one already-rule-scored transaction.  Never throws. */
  async function enrichTransaction(tx, ruleResult) {
    if (!cfg.enabled) return null;
    try {
      const rules = typeof ruleResult?.riskScore === 'number' ? ruleResult.riskScore : tx.risk_score;
      let iso_ = { available: false, note: 'Isolation Forest unavailable' };
      const feats = ruleResult?.mlFeatures;
      if (feats) {
        state.counters.ifCalls++;
        const r = await ml.isolationForest({ tx_id: tx.tx_id, ...feats, rule_engine_score: rules });
        if (r.ok) {
          const norm = typeof r.data.normalized_risk === 'number';
          iso_ = { available: true, score: norm ? r.data.normalized_risk : r.data.fraud_probability, risk_level: levelFor(norm ? r.data.normalized_risk : r.data.fraud_probability), is_anomaly: !!r.data.is_anomaly, anomaly_score: r.data.anomaly_score,
                   note: norm ? 'Isolation Forest decision function mapped to 0-100 (its own anomaly boundary = 50); an anomaly indicator, not a probability'
                              : 'legacy heuristic fraud_probability (older ML service); not calibrated' };
        }
        else state.counters.ifFailures++;
      }
      applyDetectors(tx, { score: rules, level: ruleResult?.riskLevel || null, flags: ruleResult?.flags || tx.rule_flags || [] }, iso_);
      io?.emit('transaction_updated', tx);
      return tx.detectors;
    } catch (err) {
      console.error('[ML] enrichment error:', err.message);
      return null;
    }
  }

  function summary() {
    const list = [...state.accounts.values()];
    return {
      ready: state.gnn.ready, model_version: state.gnn.version, reason: state.gnn.reason,
      analysed_accounts: list.length, high_risk_accounts: list.filter((a) => a.flagged).length,
      last_analysis_at: state.lastPredictAt ? iso(state.lastPredictAt) : null,
    };
  }

  function status() {
    return {
      ml_service: { url: ml.baseURL, enabled: cfg.enabled, ...ml.breakerState() },
      gnn: { ...state.gnn, ...summary(), window_hours: state.gnn.window_hours, decision_threshold: state.gnn.decision_threshold,
             alerts_with_gnn_evidence: db.alerts.filter((a) => a.metadata?.detectors?.gnn?.available).length, pending_transactions: state.pending.length },
      isolation_forest: { calls: state.counters.ifCalls, failures: state.counters.ifFailures },
      counters: { ...state.counters },
      fusion: { weights: fusionCfg.weights, rule_floor: fusionCfg.rule_floor },
    };
  }

  const listAccounts = ({ limit = 50, minScore = 0 } = {}) =>
    [...state.accounts.values()].filter((a) => a.risk_score >= minScore).sort((a, b) => b.risk_score - a.risk_score).slice(0, limit);

  function start() {
    if (running || !cfg.enabled) return; running = true;
    refreshHealth();
    flushTimer = setInterval(() => flush().catch(() => {}), cfg.flushMs);
    predictTimer = setInterval(async () => {
      if (!state.gnn.ready && (!state.gnn.checkedAt || now() - state.gnn.checkedAt > 10000)) await refreshHealth();
      await predict().catch(() => {});
    }, cfg.predictMs);
    flushTimer.unref?.(); predictTimer.unref?.();
  }
  function stop() { running = false; clearInterval(flushTimer); clearInterval(predictTimer); }

  return { start, stop, flush, predict, refreshHealth, queueTransaction, enrichTransaction, status, summary, listAccounts, state, client: ml, config: cfg };
}

module.exports = { createMlPipeline };
