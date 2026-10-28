const test = require('node:test');
const assert = require('node:assert/strict');
const { createMlPipeline } = require('../services/mlPipeline');

const emitted = [];
const io = { emit: (e, p) => emitted.push([e, p]) };

function fakeClient(over = {}) {
  const calls = { ingest: 0, predict: 0, iso: 0 };
  return {
    calls, baseURL: 'http://fake', breakerState: () => ({ open: false }),
    gnnHealth: async () => ({ ok: true, data: { model: { ready: true, model_version: '9.9.9', window_hours: 24, decision_threshold: 0.9 } } }),
    gnnIngest: async () => { calls.ingest++; return { ok: true, data: { accepted: 1 } }; },
    gnnPredict: async () => { calls.predict++; return { ok: true, data: { model_version: '9.9.9', graph: { nodes: 2 }, results: [
      { account_id: 'ACC1', risk_score: 91.5, risk_level: 'CRITICAL', flagged: true, topological_evidence: ['fast pass-through'], model_evidence: [], graph_facts: { out_degree: 3 } },
      { account_id: 'ACC2', risk_score: 12, risk_level: 'LOW', flagged: false, topological_evidence: [], model_evidence: [] },
      { account_id: 'ACC9', risk_score: null, flagged: false, status: 'no_recent_activity' } ] } }; },
    isolationForest: async () => { calls.iso++; return { ok: true, data: { fraud_probability: 88, normalized_risk: 40, is_anomaly: true, anomaly_score: -0.6 } }; },
    ...over,
  };
}
const mkdb = () => ({ accounts: [{ account_id: 'ACC1', risk_score: 5 }, { account_id: 'ACC2', risk_score: 5 }], transactions: [{ tx_id: 'T0', sender: 'ACC1', receiver: 'ACC2' }], alerts: [] });
const tx = (id = 'T1') => ({ tx_id: id, sender: 'ACC1', receiver: 'ACC2', amount: 1000, timestamp: new Date(), risk_score: 10, rule_flags: [] });

test('GNN alert is created once and then deduplicated across repeated inference', async () => {
  const db = mkdb(); const p = createMlPipeline({ db, io, client: fakeClient(), env: {} });
  p.queueTransaction(tx(), db.accounts[0], db.accounts[1], {});
  await p.flush();
  await p.predict(true); await p.predict(true); await p.predict(true);
  const g = db.alerts.filter((a) => a.alert_type === 'GNN_ACCOUNT_RISK');
  assert.equal(g.length, 1); assert.deepEqual(g[0].account_references, ['ACC1']);
  assert.equal(g[0].metadata.detectors.gnn.scope, 'account'); assert.equal(g[0].severity, 'CRITICAL');
  assert.equal(db.accounts[0].gnn_risk_score, 91.5); assert.equal(db.accounts[0].risk_score, 5);       // existing account risk untouched
  assert.equal(p.state.accounts.has('ACC9'), false);
});

test('cooldown and per-hour flood guard hold even after an alert is resolved', async () => {
  const db = mkdb(); let t = 1_000_000;
  const p = createMlPipeline({ db, io, client: fakeClient(), env: { GNN_ALERT_COOLDOWN_MS: '60000' }, now: () => t });
  await p.predict(true); db.alerts[0].status = 'RESOLVED';
  t += 30_000; await p.predict(true);
  assert.equal(db.alerts.length, 1);                                // within cooldown: no new alert
  t += 120_000; await p.predict(true);
  assert.equal(db.alerts.length, 2);                                // cooldown elapsed and previous alert closed
  const q = createMlPipeline({ db: mkdb(), io, client: fakeClient(), env: { GNN_ALERT_MIN_SCORE: '95' } });
  await q.predict(true); assert.equal(q.client !== null && q.state.counters.gnnAlerts, 0);   // below min score: visible, no alert
});

test('enrichment fuses rules + IF + GNN and attaches evidence to the rule alert', async () => {
  const db = mkdb(); const p = createMlPipeline({ db, io, client: fakeClient(), env: {} });
  await p.predict(true);
  const t = tx('T7'); db.alerts.unshift({ alert_id: 'ALT-R', alert_type: 'LAYERING', tx_references: ['T7'], metadata: {}, status: 'OPEN' });
  const d = await p.enrichTransaction(t, { riskScore: 70, riskLevel: 'HIGH', flags: ['X'], mlFeatures: { tx_amount: 1 } });
  assert.deepEqual(d.fusion.used, ['rules', 'isolation_forest', 'gnn']);
  assert.equal(d.gnn.scope, 'account'); assert.equal(t.risk_score, 10);                  // rule risk_score semantics unchanged
  assert.equal(t.final_risk_score, d.fusion.score); assert.ok(d.fusion.score >= 70);    // authoritative floor
  assert.ok(db.alerts.find((a) => a.alert_id === 'ALT-R').metadata.detectors.gnn.available);
});

test('ML service down: enrichment degrades to rules, nothing throws, simulator path unaffected', async () => {
  const down = fakeClient({
    gnnHealth: async () => ({ ok: false, error: 'ECONNREFUSED' }), gnnIngest: async () => ({ ok: false, error: 'ECONNREFUSED' }),
    gnnPredict: async () => ({ ok: false, error: 'ECONNREFUSED' }), isolationForest: async () => ({ ok: false, error: 'circuit_open' }),
  });
  const db = mkdb(); const p = createMlPipeline({ db, io, client: down, env: {} });
  await p.refreshHealth(); assert.equal(p.state.gnn.ready, false); assert.match(p.state.gnn.reason, /unreachable/);
  p.queueTransaction(tx(), db.accounts[0], db.accounts[1], {}); await p.flush(); assert.equal(await p.predict(true), null);
  const t = tx('T2'); const d = await p.enrichTransaction(t, { riskScore: 35, riskLevel: 'MEDIUM', flags: [], mlFeatures: {} });
  assert.equal(d.gnn.available, false); assert.equal(d.isolation_forest.available, false);
  assert.deepEqual(d.fusion.used, ['rules']); assert.equal(t.final_risk_score, 35);
  assert.equal(p.status().gnn.ready, false);
});

test('model_not_ready from the ML service is reported honestly (no fabricated GNN output)', async () => {
  const c = fakeClient({ gnnHealth: async () => ({ ok: true, data: { model: { ready: false, reason: 'missing model artifacts: model.pt' } } }) });
  const p = createMlPipeline({ db: mkdb(), io, client: c, env: {} });
  await p.refreshHealth(); const s = p.status();
  assert.equal(s.gnn.ready, false); assert.match(s.gnn.reason, /missing model artifacts/); assert.equal(s.gnn.analysed_accounts, 0);
});

test('pending queue is bounded', () => {
  const db = mkdb(); const p = createMlPipeline({ db, io, client: fakeClient(), env: { GNN_MAX_PENDING: '10' } });
  for (let i = 0; i < 50; i++) p.queueTransaction(tx('T' + i), db.accounts[0], db.accounts[1], {});
  assert.equal(p.state.pending.length, 10);
});

test('Isolation Forest enters fusion through its boundary-anchored normalized_risk, not the legacy heuristic', async () => {
  const db = mkdb(); const p = createMlPipeline({ db, io, client: fakeClient(), env: {} });
  const t = tx('T3'); const d = await p.enrichTransaction(t, { riskScore: 20, riskLevel: 'LOW', flags: [], mlFeatures: { tx_amount: 1 } });
  assert.equal(d.isolation_forest.score, 40); assert.match(d.isolation_forest.note, /boundary = 50/);
});

test('transactions enriched before the first GNN cycle are re-fused once their accounts are scored', async () => {
  const db = mkdb(); const p = createMlPipeline({ db, io, client: fakeClient(), env: {} });
  const t = tx('T4'); db.transactions.unshift(t);
  const d0 = await p.enrichTransaction(t, { riskScore: 20, riskLevel: 'LOW', flags: [], mlFeatures: { tx_amount: 1 } });
  assert.equal(d0.gnn.available, false); assert.deepEqual(d0.fusion.used, ['rules', 'isolation_forest']);
  const before = emitted.length;
  await p.predict(true);                                                   // GNN now scores ACC1 / ACC2
  assert.equal(t.detectors.gnn.available, true); assert.ok(t.detectors.fusion.used.includes('gnn'));
  assert.equal(t.detectors.gnn.score, 91.5); assert.ok(emitted.slice(before).some(([e, x]) => e === 'transaction_updated' && x.tx_id === 'T4'));
});
