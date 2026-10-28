/**
 * Fraudscope AI — Standalone Demo Server (No MongoDB Required)
 * Uses in-memory data store — perfect for hackathon demos
 * Run: node mock-server.js
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { faker } = require('@faker-js/faker');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { detectFraud } = require('./fraud_engine/ruleEngine');
const { createMlPipeline } = require('./services/mlPipeline');
const mountMlRoutes = require('./routes/ml');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'] }
});

app.use(cors());
app.use(express.json());

const JWT_SECRET = 'FraudscopeAI_SecretKey_2024_Hackathon';

// ==================== IN-MEMORY STORE ====================
const db = {
  users: [{
    _id: 'u1', name: 'Admin Investigator', email: 'admin@fraudscope.ai',
    password: bcrypt.hashSync('Fraudscope@2024', 10), role: 'ADMIN'
  }],
  accounts: [],
  transactions: [],
  alerts: [],
  investigations: [],
};
const mlPipeline = createMlPipeline({ db, io });   // Isolation Forest + GNN + risk fusion (optional, fails open)

// ==================== SEED ACCOUNTS ====================
const CITIES = [
  { city: 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.877 },
  { city: 'Delhi', state: 'Delhi', lat: 28.704, lng: 77.102 },
  { city: 'Bangalore', state: 'Karnataka', lat: 12.971, lng: 77.594 },
  { city: 'Chennai', state: 'Tamil Nadu', lat: 13.082, lng: 80.270 },
  { city: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.486 },
  { city: 'Pune', state: 'Maharashtra', lat: 18.520, lng: 73.856 },
  { city: 'Kolkata', state: 'West Bengal', lat: 22.572, lng: 88.363 },
  { city: 'Ahmedabad', state: 'Gujarat', lat: 23.022, lng: 72.571 },
];
const BRANCHES = ['SBI Main', 'HDFC Andheri', 'ICICI Kurla', 'Axis Bandra', 'PNB CP', 'Canara MG Road'];

function seedAccounts() {
  // 7000 normal
  for (let i = 0; i < 7000; i++) {
    const city = faker.helpers.arrayElement(CITIES);
    db.accounts.push({
      _id: `acc-${i}`, account_id: `ACC${String(i + 1).padStart(6, '0')}`,
      customer_name: faker.person.fullName(), kyc_level: faker.helpers.arrayElement(['LOW', 'MEDIUM', 'HIGH']),
      branch: faker.helpers.arrayElement(BRANCHES), status: 'ACTIVE', account_type: 'SAVINGS',
      balance: faker.number.float({ min: 10000, max: 500000, fractionDigits: 0 }),
      last_active: faker.date.recent({ days: 30 }), geo_location: city,
      risk_score: faker.number.int({ min: 0, max: 20 }), is_flagged: false,
      total_incoming: 0, total_outgoing: 0, tx_count: 0,
      createdAt: new Date(), updatedAt: new Date()
    });
  }
  // 1000 dormant
  for (let i = 7000; i < 8000; i++) {
    const city = faker.helpers.arrayElement(CITIES);
    db.accounts.push({
      _id: `acc-${i}`, account_id: `ACC${String(i + 1).padStart(6, '0')}`,
      customer_name: faker.person.fullName(), kyc_level: 'LOW',
      branch: faker.helpers.arrayElement(BRANCHES), status: 'DORMANT', account_type: 'SAVINGS',
      balance: faker.number.float({ min: 100, max: 2000, fractionDigits: 0 }),
      last_active: faker.date.past({ years: 1 }), geo_location: city,
      risk_score: 0, is_flagged: false,
      total_incoming: 0, total_outgoing: 0, tx_count: 0,
      createdAt: new Date(), updatedAt: new Date()
    });
  }
  // 2000 shell/mule
  for (let i = 8000; i < 10000; i++) {
    const city = faker.helpers.arrayElement(CITIES);
    db.accounts.push({
      _id: `acc-${i}`, account_id: `ACC${String(i + 1).padStart(6, '0')}`,
      customer_name: faker.company.name() + ' Ltd', kyc_level: 'LOW',
      branch: faker.helpers.arrayElement(BRANCHES), status: 'ACTIVE',
      account_type: i < 9000 ? 'SHELL' : 'MULE',
      balance: faker.number.float({ min: 0, max: 500, fractionDigits: 0 }),
      last_active: faker.date.recent({ days: 7 }), geo_location: city,
      risk_score: faker.number.int({ min: 40, max: 65 }), is_flagged: false,
      total_incoming: 0, total_outgoing: 0, tx_count: 0,
      createdAt: new Date(), updatedAt: new Date()
    });
  }
  console.log(`✅ ${db.accounts.length} accounts seeded`);
}

// ==================== FRAUD DETECTION (v2 — Modular Rule Engine) ==============
// The old inline detectFraud is replaced by the imported modular engine.
// detectFraud(tx, db, io) is exported from fraud_engine/ruleEngine.js

// ==================== SIMULATOR ====================
function emitTransaction(txData) {
  txData._id = uuidv4();
  txData.createdAt = new Date();
  txData.rule_flags = txData.rule_flags || [];
  db.transactions.unshift(txData);
  if (db.transactions.length > 2000) db.transactions.pop();

  const sender = db.accounts.find(a => a.account_id === txData.sender);
  const receiver = db.accounts.find(a => a.account_id === txData.receiver);
  // Activity BEFORE this transaction (dormancy rules + the GNN's leak-free dormancy feature need the prior value).
  const prior = { sender: sender?.last_active, receiver: receiver?.last_active };
  if (sender) { sender.balance -= txData.amount; sender.total_outgoing += txData.amount; sender.tx_count++; }
  if (receiver) { receiver.balance += txData.amount; receiver.total_incoming += txData.amount; receiver.tx_count++; }
  mlPipeline.queueTransaction(txData, sender, receiver, prior);

  io.emit('new_transaction', txData);

  // ── Async modular fraud engine ───────────────────────────────────────────────
  // detectFraud mutates txData in-place (sets anomaly_flag, rule_flags, fraud_type etc.)
  // After it completes we re-broadcast the enriched tx so the live feed and graph
  // both receive the updated anomaly_flag / fraud_type values.
  const engine = detectFraud(txData, db, io).then(result => {
    // Advance account activity only AFTER scoring, so rules see the pre-transaction state
    if (sender) sender.last_active = new Date();
    if (receiver) receiver.last_active = new Date();
    // Re-broadcast the enriched tx so all listeners (graph, live feed) get updated data
    io.emit('transaction_updated', txData);
    if (result && result.flags && result.flags.length > 0 && txData.anomaly_flag) {
      // ruleEngine already emits transaction_flagged internally via io,
      // but emit again here in case io was not passed through (belt-and-suspenders).
      io.emit('transaction_flagged', txData);
    }
    // Second/third detection layers run detached: they never delay the rule verdict or the simulator
    mlPipeline.enrichTransaction(txData, result).catch(() => {});
    return result;
  }).catch(err => {
    if (sender) sender.last_active = new Date();
    if (receiver) receiver.last_active = new Date();
    console.error('[FraudEngine] async error:', err.message);
  });

  // Non-enumerable so it never leaks into JSON responses / socket payloads;
  // lets callers await the engine verdict before replying.
  Object.defineProperty(txData, 'engine', { value: engine, enumerable: false });
  return txData;
}

function makeTx(sender, receiver, amount, type = 'UPI', isFraud = false) {
  const city = faker.helpers.arrayElement(CITIES);
  return {
    tx_id: `TXN-${uuidv4().slice(0, 12).toUpperCase()}`,
    sender, receiver, amount,
    timestamp: new Date(),
    transaction_type: type,
    channel: faker.helpers.arrayElement(['MOBILE', 'NET_BANKING', 'API']),
    geo_origin: city,
    risk_score: isFraud ? faker.number.int({ min: 55, max: 85 }) : faker.number.int({ min: 0, max: 20 }),
    anomaly_flag: false, fraud_type: 'NONE', status: 'COMPLETED',
    description: isFraud
      ? faker.helpers.arrayElement(['Wire Transfer', 'Account Transfer', 'Funds Movement'])
      : faker.helpers.arrayElement(['Salary Credit', 'Rent Payment', 'Shopping', 'EMI', 'UPI Transfer', 'Bill Payment', 'Recharge', 'Grocery']),
    rule_flags: []
  };
}

function getNormal() { return db.accounts.filter(a => a.account_type === 'SAVINGS' && a.status === 'ACTIVE'); }
function getShell() { return db.accounts.filter(a => a.account_type === 'SHELL'); }
function getMule() { return db.accounts.filter(a => a.account_type === 'MULE'); }
function getDormant() { return db.accounts.filter(a => a.status === 'DORMANT'); }

function replenishDormant() {
  // Keep at least 3 dormant accounts available for scenarios
  const dormantCount = getDormant().length;
  if (dormantCount < 3) {
    const needed = 3 - dormantCount;
    for (let i = 0; i < needed; i++) {
      const idx = db.accounts.length;
      const city = faker.helpers.arrayElement(CITIES);
      db.accounts.push({
        _id: `acc-${idx}`, account_id: `ACC${String(idx + 1).padStart(6, '0')}`,
        customer_name: faker.person.fullName(), kyc_level: 'LOW',
        branch: faker.helpers.arrayElement(BRANCHES), status: 'DORMANT', account_type: 'SAVINGS',
        balance: faker.number.float({ min: 50, max: 1000, fractionDigits: 0 }),
        last_active: faker.date.past({ years: 1 }), geo_location: city,
        risk_score: 0, is_flagged: false,
        total_incoming: 0, total_outgoing: 0, tx_count: 0,
        createdAt: new Date(), updatedAt: new Date()
      });
    }
  }
}

function simulateNormal() {
  const accs = getNormal();
  if (accs.length < 2) return;
  const s = faker.helpers.arrayElement(accs);
  const r = faker.helpers.arrayElement(accs.filter(a => a.account_id !== s.account_id));
  const amount = faker.number.float({ min: 200, max: 25000, fractionDigits: 0 });
  emitTransaction(makeTx(s.account_id, r.account_id, amount, faker.helpers.arrayElement(['UPI', 'IMPS', 'NEFT'])));
}

async function simulateLayering() {
  console.log('🚨 FRAUD: Layering chain');
  const shells = getShell();
  if (shells.length < 4) return;
  const chain = faker.helpers.arrayElements(shells, Math.min(5, shells.length));
  let amount = faker.number.float({ min: 200000, max: 800000, fractionDigits: 0 });
  for (let i = 0; i < chain.length - 1; i++) {
    amount = Math.floor(amount * 0.85);
    emitTransaction(makeTx(chain[i].account_id, chain[i + 1].account_id, amount, 'WIRE', true));
    await new Promise(r => setTimeout(r, 800));
  }
}

async function simulateStructuring() {
  console.log('🚨 FRAUD: Structuring');
  const shells = getShell();
  const normals = getNormal();
  if (!shells.length || normals.length < 4) return;
  const shell = faker.helpers.arrayElement(shells);
  const targets = faker.helpers.arrayElements(normals, 4);
  for (const t of targets) {
    const amt = faker.number.float({ min: 43000, max: 49800, fractionDigits: 0 });
    emitTransaction(makeTx(shell.account_id, t.account_id, amt, 'NEFT', true));
    await new Promise(r => setTimeout(r, 800));
  }
}

async function simulateFanOut() {
  console.log('🚨 FRAUD: Fan-Out');
  const shells = getShell();
  const normals = getNormal();
  if (!shells.length || normals.length < 8) return;
  const shell = faker.helpers.arrayElement(shells);
  const targets = faker.helpers.arrayElements(normals, 8);
  const total = faker.number.float({ min: 500000, max: 1500000, fractionDigits: 0 });
  for (const t of targets) {
    emitTransaction(makeTx(shell.account_id, t.account_id, Math.floor(total / targets.length), 'IMPS', true));
    await new Promise(r => setTimeout(r, 400));
  }
}

async function simulateDormant() {
  replenishDormant();
  const dormant = getDormant();
  const shells = getShell();
  if (!dormant.length || !shells.length) return;
  console.log('🚨 FRAUD: Dormant activation');
  const d = faker.helpers.arrayElement(dormant);
  const s = faker.helpers.arrayElement(shells);
  emitTransaction(makeTx(s.account_id, d.account_id, faker.number.float({ min: 100000, max: 500000, fractionDigits: 0 }), 'NEFT', true));
}

const fraudScenarios = [simulateLayering, simulateStructuring, simulateFanOut, simulateDormant];
let fraudIndex = 0;

function startSimulator() {
  seedAccounts();
  console.log('🚀 Transaction simulator started');
  // Normal transactions every 3 seconds (was 2s — less noise)
  setInterval(simulateNormal, 3000);
  // First fraud scenario after 10 seconds
  setTimeout(() => simulateLayering(), 10000);
  // Cycle through fraud scenarios every 45 seconds (was 25s — more realistic)
  setInterval(async () => {
    const fn = fraudScenarios[fraudIndex % fraudScenarios.length];
    fraudIndex++;
    await fn();
  }, 45000);
}

// ==================== REST API ====================

// RULES CONFIG
app.get('/api/rules/config', (req, res) => {
  const riskWeights = require('./fraud_engine/config/riskWeights');
  res.json(riskWeights.get());
});

app.patch('/api/rules/config', (req, res) => {
  try {
    const riskWeights = require('./fraud_engine/config/riskWeights');
    riskWeights.update(req.body);
    res.json({ message: 'Configuration updated successfully', config: riskWeights.get() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// RULE DRY RUN TESTER
app.post('/api/rules/dry-run', async (req, res) => {
  try {
    const { chain, sender, receiver, amount, transaction_type = 'UPI', channel = 'MOBILE', city = 'Mumbai' } = req.body;

    let txChainInput = [];
    if (chain && Array.isArray(chain)) {
      txChainInput = chain;
    } else if (sender && receiver && amount) {
      txChainInput = [{ sender, receiver, amount, transaction_type, channel, city }];
    } else {
      return res.status(400).json({ error: 'Either "chain" array or "sender, receiver, amount" fields are required' });
    }

    let maxOffset = 0;
    const chainWithOffsets = txChainInput.map((row, idx) => {
      const ts_offset_seconds = row.ts_offset_seconds !== undefined && row.ts_offset_seconds !== '' ? Number(row.ts_offset_seconds) : idx * 45;
      if (ts_offset_seconds > maxOffset) {
        maxOffset = ts_offset_seconds;
      }
      return { ...row, ts_offset_seconds };
    });

    // Place baseTime in the past relative to now, so simulated transactions are in the recent past
    const baseTime = Date.now() - (maxOffset + 30) * 1000;

    const { runFraudEngine } = require('./fraud_engine/ruleEngine');

    // Pre-populate all transactions from the chain into a copy of db.transactions
    // This allows both forward BFS (layering) and backward/rolling window queries (structuring, velocity, dormant activation)
    // to inspect the entire chain context correctly.
    const tempAllTx = [...(db.transactions || [])];
    const chainTxs = chainWithOffsets.map((step, i) => {
      return {
        tx_id: `DRY-${uuidv4().slice(0, 8).toUpperCase()}`,
        sender: step.sender,
        receiver: step.receiver,
        amount: Number(step.amount),
        timestamp: new Date(baseTime + step.ts_offset_seconds * 1000),
        transaction_type: step.transaction_type || 'UPI',
        channel: step.channel || 'MOBILE',
        geo_origin: { city: step.city || 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.877 },
        description: `Dry Run Chain Step ${i + 1}`,
        ts_offset_seconds: step.ts_offset_seconds
      };
    });

    // Add them to tempAllTx so they are all queryable
    tempAllTx.push(...chainTxs);

    const results = [];
    for (let i = 0; i < chainTxs.length; i++) {
      const tx = chainTxs[i];
      // Filter out current tx from allTx passed to engine, to avoid double-counting within rules
      const ruleAllTx = tempAllTx.filter(t => t.tx_id !== tx.tx_id);
      
      const result = await runFraudEngine(tx, {
        allTx: ruleAllTx,
        allAccounts: db.accounts || [],
        allAlerts: db.alerts || []
      });

      results.push({
        transaction: tx,
        result: {
          finalScore: result.finalScore,
          riskLevel: result.riskLevel,
          action: result.action,
          allFlags: result.allFlags,
          explanation: result.explanation,
          traces: result.traces
        }
      });
    }

    if (chain && Array.isArray(chain)) {
      res.json({ chain: results });
    } else {
      res.json(results[0]);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AUTH
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ userId: user._id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { name: user.name, email: user.email, role: user.role } });
});

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const existing = db.users.find(u => u.email === email);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  const newUser = {
    _id: `u${db.users.length + 1}`,
    name,
    email,
    password: bcrypt.hashSync(password, 10),
    role: role || 'ANALYST',
    createdAt: new Date(),
  };
  db.users.push(newUser);
  const token = jwt.sign(
    { userId: newUser._id, role: newUser.role, name: newUser.name },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  console.log(`✅ New user registered: ${email} (${newUser.role})`);
  res.status(201).json({ token, user: { name: newUser.name, email: newUser.email, role: newUser.role } });
});

// DASHBOARD
app.get('/api/dashboard/stats', (req, res) => {
  const since24h = Date.now() - 86400000;
  const txToday = db.transactions.filter(t => new Date(t.timestamp) >= since24h);
  const hourMap = {};
  txToday.forEach(t => {
    const h = new Date(t.timestamp).getHours();
    if (!hourMap[h]) hourMap[h] = { _id: h, count: 0, total_amount: 0 };
    hourMap[h].count++; hourMap[h].total_amount += t.amount;
  });
  res.json({
    tx: { total: db.transactions.length, flagged: db.transactions.filter(t => t.anomaly_flag).length, today: txToday.length },
    alerts: { open: db.alerts.filter(a => a.status === 'OPEN').length, critical: db.alerts.filter(a => a.severity === 'CRITICAL' && a.status === 'OPEN').length },
    accounts: { flagged: db.accounts.filter(a => a.is_flagged).length },
    cases: { open: db.investigations.filter(i => ['OPEN', 'IN_PROGRESS'].includes(i.status)).length },
    recent_transactions: db.transactions.slice(0, 10),
    recent_alerts: db.alerts.filter(a => a.status === 'OPEN').slice(0, 5),
    tx_by_hour: Object.values(hourMap).sort((a, b) => a._id - b._id),
  });
});

// TRANSACTIONS
app.get('/api/transactions', (req, res) => {
  let txs = [...db.transactions];
  if (req.query.flagged === 'true') txs = txs.filter(t => t.anomaly_flag);
  if (req.query.fraud_type && req.query.fraud_type !== 'ALL') txs = txs.filter(t => t.fraud_type === req.query.fraud_type);
  const limit = parseInt(req.query.limit) || 100;
  res.json({ transactions: txs.slice(0, limit), total: txs.length });
});

app.get('/api/transactions/graph', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const since = Date.now() - hours * 3600000;
  const flaggedOnly = req.query.flaggedOnly === 'true';
  let txs = db.transactions.filter(t => new Date(t.timestamp) >= since);
  if (flaggedOnly) txs = txs.filter(t => t.anomaly_flag);
  txs = txs.slice(0, 300);
  const accIds = new Set([...txs.map(t => t.sender), ...txs.map(t => t.receiver)]);
  const nodes = db.accounts.filter(a => accIds.has(a.account_id)).map(a => ({
    id: a.account_id, name: a.customer_name, type: a.account_type,
    risk_score: a.risk_score, is_flagged: a.is_flagged, status: a.status,
    gnn_risk_score: a.gnn_risk_score, gnn_risk_level: a.gnn_risk_level, gnn_flagged: a.gnn_flagged,
    balance: a.balance, kyc_level: a.kyc_level, branch: a.branch, geo_location: a.geo_location,
    gnn_risk_score: a.gnn_risk_score, gnn_risk_level: a.gnn_risk_level, gnn_flagged: a.gnn_flagged,
    val: Math.max(2, (a.risk_score || 0) / 10)
  }));
  const links = txs.map(t => ({
    source: t.sender, target: t.receiver, amount: t.amount, tx_id: t.tx_id,
    fraud_type: t.fraud_type, risk_score: t.risk_score, anomaly_flag: t.anomaly_flag,
    timestamp: t.timestamp, transaction_type: t.transaction_type
  }));
  res.json({ nodes, links });
});

app.get('/api/transactions/stats/summary', (req, res) => {
  const fraudTypes = {};
  db.transactions.filter(t => t.anomaly_flag).forEach(t => {
    fraudTypes[t.fraud_type] = (fraudTypes[t.fraud_type] || 0) + 1;
  });
  res.json({
    total: db.transactions.length,
    flagged: db.transactions.filter(t => t.anomaly_flag).length,
    total_amount: db.transactions.reduce((s, t) => s + t.amount, 0),
    fraud_types: Object.entries(fraudTypes).map(([_id, count]) => ({ _id, count }))
  });
});

app.get('/api/transactions/:tx_id', (req, res) => {
  const tx = db.transactions.find(t => t.tx_id === req.params.tx_id);
  if (!tx) return res.status(404).json({ error: 'Not found' });
  res.json(tx);
});

// ALERTS
app.get('/api/alerts', (req, res) => {
  let alerts = [...db.alerts];
  if (req.query.status) alerts = alerts.filter(a => a.status === req.query.status);
  if (req.query.severity) alerts = alerts.filter(a => a.severity === req.query.severity);
  res.json({ alerts: alerts.slice(0, parseInt(req.query.limit) || 100), total: alerts.length });
});

app.get('/api/alerts/stats', (req, res) => {
  const byType = {}, bySev = {};
  db.alerts.forEach(a => {
    byType[a.alert_type] = (byType[a.alert_type] || 0) + 1;
    bySev[a.severity] = (bySev[a.severity] || 0) + 1;
  });
  res.json({
    total: db.alerts.length,
    open: db.alerts.filter(a => a.status === 'OPEN').length,
    critical: db.alerts.filter(a => a.severity === 'CRITICAL' && a.status === 'OPEN').length,
    by_type: Object.entries(byType).map(([_id, count]) => ({ _id, count })),
    by_severity: Object.entries(bySev).map(([_id, count]) => ({ _id, count })),
  });
});

app.get('/api/alerts/:alert_id', (req, res) => {
  const alert = db.alerts.find(a => a.alert_id === req.params.alert_id);
  if (!alert) return res.status(404).json({ error: 'Not found' });
  res.json(alert);
});

app.patch('/api/alerts/:alert_id/status', (req, res) => {
  const alert = db.alerts.find(a => a.alert_id === req.params.alert_id);
  if (!alert) return res.status(404).json({ error: 'Not found' });
  Object.assign(alert, req.body, { updatedAt: new Date() });
  res.json(alert);
});

// ACCOUNTS
app.get('/api/accounts', (req, res) => {
  let accounts = [...db.accounts];
  if (req.query.flagged === 'true') accounts = accounts.filter(a => a.is_flagged);
  if (req.query.type) accounts = accounts.filter(a => a.account_type === req.query.type);
  if (req.query.status) accounts = accounts.filter(a => a.status === req.query.status);
  accounts.sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));
  res.json({ accounts: accounts.slice(0, parseInt(req.query.limit) || 100), total: accounts.length });
});

app.get('/api/accounts/stats/summary', (req, res) => {
  const byType = {};
  db.accounts.forEach(a => { byType[a.account_type] = (byType[a.account_type] || 0) + 1; });
  res.json({
    total: db.accounts.length,
    flagged: db.accounts.filter(a => a.is_flagged).length,
    dormant: db.accounts.filter(a => a.status === 'DORMANT').length,
    suspicious: db.accounts.filter(a => a.status === 'SUSPICIOUS').length,
    by_type: Object.entries(byType).map(([_id, count]) => ({ _id, count })),
  });
});

app.get('/api/accounts/:account_id', (req, res) => {
  const account = db.accounts.find(a => a.account_id === req.params.account_id);
  if (!account) return res.status(404).json({ error: 'Not found' });
  const recentTxs = db.transactions.filter(t => t.sender === account.account_id || t.receiver === account.account_id).slice(0, 20);
  res.json({ ...account, recent_transactions: recentTxs });
});

// INVESTIGATIONS
app.get('/api/investigations', (req, res) => {
  let cases = [...db.investigations];
  if (req.query.status) cases = cases.filter(c => c.status === req.query.status);
  res.json({ cases, total: cases.length });
});

app.post('/api/investigations', (req, res) => {
  const inv = {
    _id: uuidv4(),
    case_id: `CASE-${uuidv4().slice(0, 8).toUpperCase()}`,
    ...req.body,
    notes: [], evidence_timeline: [],
    str_generated: false,
    createdAt: new Date(), updatedAt: new Date()
  };
  db.investigations.unshift(inv);
  res.status(201).json(inv);
});

app.get('/api/investigations/:case_id', (req, res) => {
  const inv = db.investigations.find(i => i.case_id === req.params.case_id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  res.json(inv);
});

app.patch('/api/investigations/:case_id', (req, res) => {
  const inv = db.investigations.find(i => i.case_id === req.params.case_id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  Object.assign(inv, req.body, { updatedAt: new Date() });
  res.json(inv);
});

app.post('/api/investigations/:case_id/notes', (req, res) => {
  const inv = db.investigations.find(i => i.case_id === req.params.case_id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  inv.notes.push({ ...req.body, timestamp: new Date() });
  inv.updatedAt = new Date();
  res.json(inv);
});

app.post('/api/investigations/:case_id/str', (req, res) => {
  const inv = db.investigations.find(i => i.case_id === req.params.case_id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  inv.str_generated = true;
  inv.str_generated_at = new Date();
  inv.status = 'ESCALATED';
  res.json({ message: 'STR report generated', case: inv });
});

/****************************************
 * MANUAL SIMULATION STUDIO APIs
 ****************************************/

// GET /api/simulator/accounts — all accounts for dropdown selectors
app.get('/api/simulator/accounts', (req, res) => {
  const accounts = db.accounts.map(a => ({
    account_id: a.account_id,
    customer_name: a.customer_name,
    account_type: a.account_type,
    status: a.status,
    balance: a.balance,
    kyc_level: a.kyc_level,
    risk_score: a.risk_score,
    is_flagged: a.is_flagged,
    geo_location: a.geo_location,
  }));
  res.json({ accounts, total: accounts.length });
});

// POST /api/simulator/account — create a new account manually
app.post('/api/simulator/account', (req, res) => {
  const { customer_name, account_type = 'SAVINGS', status = 'ACTIVE', opening_balance = 10000, kyc_level = 'MEDIUM', city = 'Mumbai' } = req.body;
  if (!customer_name) return res.status(400).json({ error: 'customer_name is required' });

  const idx = db.accounts.length;
  const cityData = CITIES.find(c => c.city === city) || CITIES[0];
  const account = {
    _id: `acc-manual-${uuidv4().slice(0, 8)}`,
    account_id: `ACC${String(idx + 1).padStart(6, '0')}`,
    customer_name,
    kyc_level,
    branch: faker.helpers.arrayElement(BRANCHES),
    status,
    account_type,
    balance: Number(opening_balance),
    last_active: status === 'DORMANT' ? faker.date.past({ years: 1 }) : new Date(),
    geo_location: { city: cityData.city, state: cityData.state, lat: cityData.lat, lng: cityData.lng },
    risk_score: account_type === 'SAVINGS' ? 5 : account_type === 'MULE' ? 55 : 45,
    is_flagged: false,
    total_incoming: 0,
    total_outgoing: 0,
    tx_count: 0,
    manual: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  db.accounts.push(account);
  io.emit('account_created', account);
  console.log(`🏦 [Studio] Account created: ${account.account_id} — ${customer_name}`);
  res.status(201).json(account);
});

// POST /api/simulator/transaction — manually submit a transaction through the full pipeline
app.post('/api/simulator/transaction', async (req, res) => {
  const { sender, receiver, amount, transaction_type = 'UPI', channel = 'MOBILE' } = req.body;

  if (!sender || !receiver || !amount) {
    return res.status(400).json({ error: 'sender, receiver, and amount are required' });
  }

  const senderAcc = db.accounts.find(a => a.account_id === sender);
  const receiverAcc = db.accounts.find(a => a.account_id === receiver);

  if (!senderAcc) return res.status(404).json({ error: `Sender account ${sender} not found` });
  if (!receiverAcc) return res.status(404).json({ error: `Receiver account ${receiver} not found` });
  if (sender === receiver) return res.status(400).json({ error: 'Sender and receiver cannot be the same account' });
  if (senderAcc.balance < Number(amount)) {
    return res.status(400).json({ error: `Insufficient balance: ₹${senderAcc.balance.toLocaleString()} available, ₹${Number(amount).toLocaleString()} requested` });
  }

  const city = senderAcc.geo_location || faker.helpers.arrayElement(CITIES);
  const isFraud = Number(amount) >= 43000;

  const tx = makeTx(sender, receiver, Number(amount), transaction_type, isFraud);
  tx.channel = channel;
  tx.geo_origin = city;
  tx.manual = true; // tag as manually submitted

  // Route through the SAME emitTransaction() pipeline
  const result = emitTransaction(tx);
  await result.engine; // wait for the fraud engine so the response carries the real verdict

  console.log(`💳 [Studio] Manual transaction: ${sender} → ${receiver} ₹${Number(amount).toLocaleString()} [${result.anomaly_flag ? '🚨 FLAGGED' : '✅ CLEAN'}]`);
  res.status(201).json(result);
});

// POST /api/simulator/scenario/layering
app.post('/api/simulator/scenario/layering', async (req, res) => {
  const shells = getShell();
  const normals = getNormal();
  const pool = shells.length >= 4 ? shells : [...shells, ...normals];
  if (pool.length < 4) return res.status(400).json({ error: 'Not enough accounts for layering (need 4+ shell/normal accounts)' });

  const chain = faker.helpers.arrayElements(pool, Math.min(5, pool.length));
  let amount = faker.number.float({ min: 200000, max: 800000, fractionDigits: 0 });
  const txIds = [];

  for (let i = 0; i < chain.length - 1; i++) {
    amount = Math.floor(amount * 0.85);
    const tx = makeTx(chain[i].account_id, chain[i + 1].account_id, amount, 'WIRE', true);
    tx.manual = true;
    const result = emitTransaction(tx);
    txIds.push(result.tx_id);
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`🚨 [Studio] Layering scenario: ${chain.length - 1} hops`);
  res.json({ scenario: 'LAYERING', hops: chain.length - 1, tx_ids: txIds, accounts: chain.map(a => a.account_id) });
});

// POST /api/simulator/scenario/structuring
app.post('/api/simulator/scenario/structuring', async (req, res) => {
  const shells = getShell();
  const normals = getNormal();
  if (!shells.length && !normals.length) return res.status(400).json({ error: 'No accounts available' });

  const sender = shells.length ? faker.helpers.arrayElement(shells) : faker.helpers.arrayElement(normals);
  const targets = faker.helpers.arrayElements(normals.filter(a => a.account_id !== sender.account_id), Math.min(4, normals.length));
  if (!targets.length) return res.status(400).json({ error: 'Not enough receiver accounts' });

  const txIds = [];
  for (const t of targets) {
    const amt = faker.number.float({ min: 43000, max: 49800, fractionDigits: 0 });
    const tx = makeTx(sender.account_id, t.account_id, amt, 'NEFT', true);
    tx.manual = true;
    const result = emitTransaction(tx);
    txIds.push(result.tx_id);
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`🚨 [Studio] Structuring scenario: ${targets.length} transactions from ${sender.account_id}`);
  res.json({ scenario: 'STRUCTURING', sender: sender.account_id, count: targets.length, tx_ids: txIds });
});

// POST /api/simulator/scenario/fanout
app.post('/api/simulator/scenario/fanout', async (req, res) => {
  const shells = getShell();
  const normals = getNormal();
  if (!normals.length) return res.status(400).json({ error: 'No normal accounts available for receivers' });

  const sender = shells.length ? faker.helpers.arrayElement(shells) : faker.helpers.arrayElement(normals);
  const targets = faker.helpers.arrayElements(normals.filter(a => a.account_id !== sender.account_id), Math.min(8, normals.length));
  if (targets.length < 2) return res.status(400).json({ error: 'Not enough receiver accounts' });

  const total = faker.number.float({ min: 500000, max: 1500000, fractionDigits: 0 });
  const txIds = [];
  for (const t of targets) {
    const tx = makeTx(sender.account_id, t.account_id, Math.floor(total / targets.length), 'IMPS', true);
    tx.manual = true;
    const result = emitTransaction(tx);
    txIds.push(result.tx_id);
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`🚨 [Studio] Fan-out scenario: ${sender.account_id} → ${targets.length} accounts`);
  res.json({ scenario: 'FAN_OUT', sender: sender.account_id, receivers: targets.length, tx_ids: txIds, total_amount: total });
});

// POST /api/simulator/scenario/dormant
app.post('/api/simulator/scenario/dormant', async (req, res) => {
  replenishDormant();
  const dormant = getDormant();
  const shells = getShell();
  const normals = getNormal();

  if (!dormant.length) return res.status(400).json({ error: 'No dormant accounts available' });
  const sender = shells.length ? faker.helpers.arrayElement(shells) : faker.helpers.arrayElement(normals);
  if (!sender) return res.status(400).json({ error: 'No sender accounts available' });

  const d = faker.helpers.arrayElement(dormant);
  const amount = faker.number.float({ min: 100000, max: 500000, fractionDigits: 0 });
  const tx = makeTx(sender.account_id, d.account_id, amount, 'NEFT', true);
  tx.manual = true;
  const result = emitTransaction(tx);

  console.log(`🚨 [Studio] Dormant activation: ${d.account_id} received ₹${amount.toLocaleString()}`);
  res.json({ scenario: 'DORMANT_ACTIVATION', sender: sender.account_id, dormant_account: d.account_id, amount, tx_id: result.tx_id, flagged: result.anomaly_flag });
});

// POST /api/simulator/scenario/mule
app.post('/api/simulator/scenario/mule', async (req, res) => {
  const mules = getMule();
  const normals = getNormal();

  if (!mules.length) return res.status(400).json({ error: 'No mule accounts available' });
  const sender = normals.length ? faker.helpers.arrayElement(normals) : faker.helpers.arrayElement(db.accounts);
  const mule = faker.helpers.arrayElement(mules);
  const amount = faker.number.float({ min: 100000, max: 400000, fractionDigits: 0 });
  const tx = makeTx(sender.account_id, mule.account_id, amount, 'IMPS', true);
  tx.manual = true;
  const result = emitTransaction(tx);

  console.log(`🚨 [Studio] Mule transfer: ${sender.account_id} → ${mule.account_id} ₹${amount.toLocaleString()}`);
  res.json({ scenario: 'MULE_TRANSFER', sender: sender.account_id, mule_account: mule.account_id, amount, tx_id: result.tx_id, flagged: result.anomaly_flag });
});

// HEALTH
app.get('/health', (req, res) => {
  res.json({ status: 'operational', mode: 'in-memory-demo', accounts: db.accounts.length, transactions: db.transactions.length, alerts: db.alerts.length });
});

// Socket
io.on('connection', (socket) => {
  console.log(`🔌 Client: ${socket.id}`);
  socket.on('trigger_fraud_scenario', async (type) => {
    const map = { layering: simulateLayering, structuring: simulateStructuring, fanout: simulateFanOut, dormant: simulateDormant };
    if (map[type]) await map[type]();
    socket.emit('scenario_triggered', { type, timestamp: new Date() });
  });
  socket.on('disconnect', () => console.log(`🔌 Disconnected: ${socket.id}`));
});

mountMlRoutes(app, mlPipeline, db);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n🚀 Fraudscope AI DEMO Server (In-Memory Mode)`);
  console.log(`📡 Running on: http://localhost:${PORT}`);
  console.log(`🌐 Open frontend: http://localhost:5173`);
  console.log(`🔑 Login: admin@fraudscope.ai / Fraudscope@2024\n`);






  
  startSimulator();
  mlPipeline.start();
});
