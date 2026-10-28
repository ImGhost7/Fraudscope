const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createMlClient } = require('../services/mlClient');

function stub(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => handler(req, res, body));
    }).listen(0, () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

test('successful call returns data and resets the breaker', async () => {
  const { srv, url } = await stub((req, res) => json(res, 200, { ok: 1 }));
  const c = createMlClient({ baseURL: url, timeoutMs: 500 });
  const r = await c.gnnHealth();
  assert.equal(r.ok, true); assert.deepEqual(r.data, { ok: 1 }); assert.equal(c.breakerState().open, false);
  srv.close();
});

test('structured 503 (model not ready) is NOT a transport failure and never opens the breaker', async () => {
  const { srv, url } = await stub((req, res) => json(res, 503, { status: 'error', code: 'model_not_ready', message: 'x' }));
  const c = createMlClient({ baseURL: url, failThreshold: 2, timeoutMs: 500 });
  for (let i = 0; i < 4; i++) { const r = await c.gnnPredict({}); assert.equal(r.ok, false); assert.equal(r.error, 'model_not_ready'); }
  assert.equal(c.breakerState().open, false);
  srv.close();
});

test('unreachable service: never throws, breaker opens, later calls fail fast', async () => {
  const c = createMlClient({ baseURL: 'http://127.0.0.1:1', failThreshold: 3, openMs: 60000, timeoutMs: 300 });
  for (let i = 0; i < 3; i++) { const r = await c.isolationForest({}); assert.equal(r.ok, false); }
  assert.equal(c.breakerState().open, true);
  const t0 = Date.now(); const r = await c.gnnPredict({});
  assert.equal(r.error, 'circuit_open'); assert.ok(Date.now() - t0 < 50);
  c.resetBreaker(); assert.equal(c.breakerState().open, false);
});

test('slow service hits the bounded timeout', async () => {
  const { srv, url } = await stub((req, res) => setTimeout(() => json(res, 200, {}), 1500));
  const c = createMlClient({ baseURL: url, timeoutMs: 200, failThreshold: 99 });
  const t0 = Date.now(); const r = await c.gnnHealth();
  assert.equal(r.ok, false); assert.ok(Date.now() - t0 < 1000);
  srv.closeAllConnections?.(); srv.close();
});
