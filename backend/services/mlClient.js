/**
 * Resilient HTTP client for the Python ML service (ml-service/app.py).
 * Bounded timeout + circuit breaker: a slow or dead ML service can never stall or crash the Node pipeline.
 * Every call resolves to { ok, data?, error? }; nothing here throws.
 */
const axios = require('axios');

function createMlClient(opts = {}) {
  const baseURL = (opts.baseURL || process.env.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
  const timeout = Number(opts.timeoutMs || process.env.ML_TIMEOUT_MS || 1500);
  const failThreshold = Number(opts.failThreshold || process.env.ML_BREAKER_FAILURES || 3);
  const openMs = Number(opts.openMs || process.env.ML_BREAKER_OPEN_MS || 15000);
  const http = axios.create({ baseURL, timeout, headers: { 'Content-Type': 'application/json' } });

  const breaker = { failures: 0, openUntil: 0, lastError: null, lastOkAt: null, totalCalls: 0, totalFailures: 0 };

  async function call(method, url, body, timeoutMs) {
    breaker.totalCalls++;
    if (Date.now() < breaker.openUntil) return { ok: false, error: 'circuit_open', skipped: true };
    try {
      const res = await http.request({ method, url, data: body, timeout: timeoutMs || timeout });
      breaker.failures = 0; breaker.lastOkAt = Date.now(); breaker.lastError = null;
      return { ok: true, data: res.data };
    } catch (err) {
      // HTTP errors that carry a structured body (e.g. 503 model_not_ready) mean the service IS reachable
      if (err.response) {
        breaker.failures = 0;
        return { ok: false, status: err.response.status, error: err.response.data?.code || `http_${err.response.status}`, data: err.response.data };
      }
      breaker.failures++; breaker.totalFailures++; breaker.lastError = err.code || err.message;
      if (breaker.failures >= failThreshold) breaker.openUntil = Date.now() + openMs;
      return { ok: false, error: err.code || 'ml_unreachable' };
    }
  }

  return {
    baseURL,
    breakerState: () => ({
      open: Date.now() < breaker.openUntil, consecutive_failures: breaker.failures, last_error: breaker.lastError,
      last_ok_at: breaker.lastOkAt, total_calls: breaker.totalCalls, total_failures: breaker.totalFailures,
    }),
    resetBreaker: () => { breaker.failures = 0; breaker.openUntil = 0; },
    health: () => call('get', '/health'),
    gnnHealth: () => call('get', '/gnn/health'),
    gnnIngest: (payload) => call('post', '/gnn/transactions', payload, 4000),
    gnnPredict: (payload) => call('post', '/gnn/predict', payload, 8000),
    isolationForest: (features) => call('post', '/predict', features),
  };
}

module.exports = { createMlClient };
