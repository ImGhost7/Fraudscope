#!/usr/bin/env node
/**
 * Replay a time-ordered transaction stream through the EXISTING rule engine (detectFraud),
 * exactly as the live pipeline does, and write per-transaction verdicts.
 *
 *   node scripts/replay_engine.js input.json output.json
 *
 * input.json : { accounts: [{account_id, kyc_level, status, account_type, balance, last_active_ts, opened_ts}],
 *                transactions: [{tx_id, sender, receiver, amount, ts, channel}], score_from_ts }
 *   ts values are seconds on an arbitrary simulation clock. Transactions with ts < score_from_ts are
 *   replayed to build history (not scored/written) so the engine sees realistic context.
 * The engine reads Date.now(); the clock is pinned to the simulated transaction time for the replay.
 */
const fs = require('fs');
const path = require('path');
const { detectFraud } = require(path.join(__dirname, '..', 'fraud_engine', 'ruleEngine'));

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) { console.error('usage: replay_engine.js input.json output.json'); process.exit(2); }
const input = JSON.parse(fs.readFileSync(inFile, 'utf8'));

// Pin the clock: simulated time -> real epoch ms (offset keeps dates realistic)
const EPOCH0 = Date.UTC(2026, 0, 1);
let SIM_NOW = null;
const realNow = Date.now.bind(Date);
Date.now = () => (SIM_NOW === null ? realNow() : SIM_NOW);
const toMs = (ts) => EPOCH0 + ts * 1000;

const CITIES = [
  { city: 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.8777 }, { city: 'Delhi', state: 'Delhi', lat: 28.7041, lng: 77.1025 },
  { city: 'Bangalore', state: 'Karnataka', lat: 12.9716, lng: 77.5946 }, { city: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },
  { city: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.4867 }, { city: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567 },
];
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

const MAX_HISTORY = Number(process.env.REPLAY_MAX_HISTORY || 2500);
const db = { accounts: [], transactions: [], alerts: [] };
const byId = new Map();
input.accounts.forEach((a, i) => {
  const home = CITIES[i % CITIES.length];
  const acc = {
    account_id: a.account_id, customer_name: a.account_id, kyc_level: a.kyc_level, branch: 'SIM', status: a.status,
    account_type: a.account_type, balance: a.balance, last_active: new Date(toMs(a.last_active_ts)),
    opened_at: new Date(toMs(a.opened_ts)), geo_location: home, risk_score: 5, is_flagged: false,
    total_incoming: 0, total_outgoing: 0, tx_count: 0,
  };
  db.accounts.push(acc); byId.set(acc.account_id, acc);
});

const out = [];
const t0 = Date.now(); let n = 0;
(async () => {
  for (const t of input.transactions) {
    SIM_NOW = toMs(t.ts);
    const s = byId.get(t.sender), r = byId.get(t.receiver);
    if (!s || !r) continue;
    const city = rnd() < 0.92 ? s.geo_location : CITIES[Math.floor(rnd() * CITIES.length)];
    const tx = {
      tx_id: t.tx_id, sender: t.sender, receiver: t.receiver, amount: t.amount, timestamp: new Date(SIM_NOW),
      transaction_type: 'UPI', channel: t.channel || 'MOBILE', geo_origin: city, risk_score: 0, anomaly_flag: false,
      fraud_type: 'NONE', status: 'COMPLETED', description: 'replay', rule_flags: [],
    };
    db.transactions.unshift(tx);
    // Mirror the live pipeline, which keeps only the most recent transactions in memory (mock-server.js caps at 2,000;
    // 2,500 here because simulated traffic is sparser per hour). Also keeps the replay linear-time.
    if (db.transactions.length > MAX_HISTORY) db.transactions.pop();
    s.balance -= t.amount; s.total_outgoing += t.amount; s.tx_count++; r.balance += t.amount; r.total_incoming += t.amount; r.tx_count++;
    const res = await detectFraud(tx, db, null);
    s.last_active = new Date(SIM_NOW); r.last_active = new Date(SIM_NOW); // advance activity AFTER scoring (dormancy needs the prior value)
    if (t.ts >= (input.score_from_ts || 0)) {
      out.push({ tx_id: t.tx_id, final_score: res.riskScore, risk_level: res.riskLevel, flags: res.flags, anomaly_flag: !!tx.anomaly_flag, ml_features: res.mlFeatures });
    }
    if (++n % 2000 === 0) {
      console.error(`[replay] ${n}/${input.transactions.length} (${((Date.now ? realNow() : 0) - t0) / 1000}s)`);
    }
  }
  fs.writeFileSync(outFile, JSON.stringify(out));
  console.error(`[replay] done: ${out.length} scored transactions`);
})();
