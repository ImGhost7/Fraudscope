/**
 * End-to-end: spawns the REAL demo server (mock-server.js) against (a) a stub ML service and (b) a dead one.
 * Verifies the existing workflows still work and the ML layers integrate / degrade safely.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { io: ioClient } = require('socket.io-client');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
async function until(fn, ms = 20000, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(step); }
  throw new Error('timeout waiting for condition');
}
const json = (url, opts = {}) => fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

/** Minimal ML service stub (same contract as ml-service) that flags whichever account sent the most recent transaction. */
function startStub() {
  const seen = []; const calls = { ingest: 0, predict: 0, iso: 0 };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/gnn/health') return send(200, { service: 'up', model: { ready: true, model_version: 'stub-1', window_hours: 24, decision_threshold: 0.5 } });
      if (req.url === '/gnn/transactions') { calls.ingest++; const d = JSON.parse(b); seen.push(...d.transactions); return send(200, { status: 'success', accepted: d.transactions.length, duplicates: 0, invalid: 0, late: 0 }); }
      if (req.url === '/gnn/predict') {
        calls.predict++; const accts = [...new Set(seen.flatMap((t) => [t.sender, t.receiver]))];
        const results = accts.map((a, i) => ({ account_id: a, risk_score: i === 0 ? 88 : 10, risk_level: i === 0 ? 'CRITICAL' : 'LOW', flagged: i === 0, topological_evidence: i === 0 ? ['stub evidence'] : [], model_evidence: [] }));
        return send(200, { status: 'success', model_version: 'stub-1', graph: { nodes: accts.length }, results });
      }
      if (req.url === '/predict') { calls.iso++; return send(200, { fraud_probability: 45, risk_level: 'MEDIUM', is_anomaly: false, anomaly_score: -0.5 }); }
      send(404, {});
    });
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, calls, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function startBackend(mlUrl) {
  const port = await freePort();
  const child = spawn('node', ['mock-server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore',
    env: { ...process.env, PORT: String(port), ML_SERVICE_URL: mlUrl, GNN_PREDICT_MS: '600', GNN_FLUSH_MS: '300', ML_TIMEOUT_MS: '800', ML_BREAKER_OPEN_MS: '3000' } });
  const base = `http://127.0.0.1:${port}`;
  await until(async () => (await fetch(`${base}/health`)).ok, 30000);
  return { base, port, stop: () => child.kill('SIGKILL') };
}

test('with ML service: existing workflows intact, detectors fused, GNN alerts deduplicated, realtime events delivered', async (t) => {
  const stub = await startStub(); const be = await startBackend(stub.url);
  t.after(() => { be.stop(); stub.srv.close(); });

  // auth preserved
  assert.equal((await json(`${be.base}/api/auth/login`, { method: 'POST', body: { email: 'admin@fraudscope.ai', password: 'Fraudscope@2024' } })).status, 200);
  assert.equal((await json(`${be.base}/api/auth/login`, { method: 'POST', body: { email: 'admin@fraudscope.ai', password: 'wrong' } })).status, 401);

  const events = new Set(); const sock = ioClient(be.base, { transports: ['websocket'] });
  ['new_transaction', 'transaction_updated', 'new_alert', 'gnn_update'].forEach((e) => sock.on(e, () => events.add(e)));
  t.after(() => sock.close());

  await json(`${be.base}/api/simulator/scenario/layering`, { method: 'POST' });
  const status = await until(async () => { const s = (await json(`${be.base}/api/ml/status`)).body; return s.gnn.ready && s.gnn.analysed_accounts > 0 && s; });
  assert.equal(status.gnn.model_version, 'stub-1');

  // transactions carry all detector outputs + fused score; rule risk_score semantics preserved
  const tx = await until(async () => (await json(`${be.base}/api/transactions?limit=100&flaggedOnly=true`)).body.transactions.find((x) => x.detectors?.fusion));
  assert.deepEqual(Object.keys(tx.detectors).sort(), ['fusion', 'gnn', 'isolation_forest', 'rules']);
  assert.equal(typeof tx.risk_score, 'number'); assert.equal(typeof tx.final_risk_score, 'number'); assert.ok(tx.detectors.fusion.used.includes('rules'));

  // repeated inference never duplicates the GNN alert
  for (let i = 0; i < 3; i++) await json(`${be.base}/api/ml/gnn/refresh`, { method: 'POST' });
  const alerts = (await json(`${be.base}/api/alerts?limit=500`)).body.alerts.filter((a) => a.alert_type === 'GNN_ACCOUNT_RISK');
  const perAccount = {}; alerts.forEach((a) => { const k = a.account_references[0]; perAccount[k] = (perAccount[k] || 0) + 1; });
  assert.ok(alerts.length >= 1 && Object.values(perAccount).every((n) => n === 1), JSON.stringify(perAccount));

  // existing investigation + STR workflow unchanged
  const inv = (await json(`${be.base}/api/investigations`, { method: 'POST', body: { title: 'it', severity: 'HIGH', fraud_type: 'LAYERING', investigator: 'x' } })).body;
  assert.ok(inv.case_id);
  assert.equal((await json(`${be.base}/api/investigations/${inv.case_id}/notes`, { method: 'POST', body: { author: 'x', text: 'n' } })).status, 200);
  assert.equal((await json(`${be.base}/api/investigations/${inv.case_id}`, { method: 'PATCH', body: { status: 'IN_PROGRESS' } })).body.status, 'IN_PROGRESS');
  assert.equal((await json(`${be.base}/api/investigations/${inv.case_id}/str`, { method: 'POST' })).body.message, 'STR report generated');
  const stats = (await json(`${be.base}/api/dashboard/stats`)).body; assert.ok(stats.tx.total > 0);

  await until(() => events.has('gnn_update') && events.has('transaction_updated') && events.has('new_transaction'), 10000);
  assert.ok(stub.calls.ingest > 0 && stub.calls.predict > 0 && stub.calls.iso > 0);
});

test('ML service unreachable: simulator and rule pipeline keep running, GNN reported unavailable', async (t) => {
  const be = await startBackend('http://127.0.0.1:1'); t.after(() => be.stop());
  const count = async () => (await json(`${be.base}/api/transactions/stats/summary`)).body.total;
  const before = await count(); await sleep(5000);
  assert.ok((await count()) > before, 'simulator must keep producing transactions');
  const s = (await json(`${be.base}/api/ml/status`)).body;
  assert.equal(s.gnn.ready, false); assert.match(s.gnn.reason, /unreachable/);
  await json(`${be.base}/api/simulator/scenario/layering`, { method: 'POST' });
  const tx = await until(async () => (await json(`${be.base}/api/transactions?limit=100`)).body.transactions.find((x) => x.detectors?.fusion));
  assert.equal(tx.detectors.gnn.available, false); assert.equal(tx.detectors.isolation_forest.available, false); assert.deepEqual(tx.detectors.fusion.used, ['rules']);
  assert.equal((await json(`${be.base}/health`)).status, 200);
});
