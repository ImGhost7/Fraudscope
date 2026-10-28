/**
 * Fraudscope AI — Realistic Banking Fraud Simulator
 * Generates normal transactions + scripted fraud patterns
 */

const { faker } = require('@faker-js/faker');
const { v4: uuidv4 } = require('uuid');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Alert = require('../models/Alert');
const { runFraudEngine } = require('../fraud_engine/ruleEngine');

const INDIAN_CITIES = [
  { city: 'Mumbai', state: 'Maharashtra', lat: 19.0760, lng: 72.8777 },
  { city: 'Delhi', state: 'Delhi', lat: 28.7041, lng: 77.1025 },
  { city: 'Bangalore', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  { city: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },
  { city: 'Kolkata', state: 'West Bengal', lat: 22.5726, lng: 88.3639 },
  { city: 'Hyderabad', state: 'Telangana', lat: 17.3850, lng: 78.4867 },
  { city: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567 },
  { city: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lng: 72.5714 },
  { city: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lng: 75.7873 },
  { city: 'Surat', state: 'Gujarat', lat: 21.1702, lng: 72.8311 },
];

const BRANCHES = ['SBI Main', 'HDFC Andheri', 'ICICI Kurla', 'Axis Bank Bandra', 'PNB CP', 'Canara Bank MG Road', 'BOB Navrangpura'];

let simulatorInterval = null;
let fraudScenarioInterval = null;
let io = null;

async function seedAccounts() {
  const count = await Account.countDocuments();
  if (count > 0) return;

  console.log('🌱 Seeding accounts...');
  const accounts = [];

  // Normal accounts (70)
  for (let i = 0; i < 70; i++) {
    const city = faker.helpers.arrayElement(INDIAN_CITIES);
    accounts.push({
      account_id: `ACC${String(i + 1).padStart(6, '0')}`,
      customer_name: faker.person.fullName(),
      kyc_level: faker.helpers.arrayElement(['LOW', 'MEDIUM', 'HIGH', 'HIGH']),
      branch: faker.helpers.arrayElement(BRANCHES),
      status: 'ACTIVE',
      account_type: 'SAVINGS',
      balance: faker.number.float({ min: 10000, max: 500000, fractionDigits: 2 }),
      last_active: faker.date.recent({ days: 30 }),
      geo_location: { ...city },
      risk_score: faker.number.int({ min: 0, max: 20 }),
    });
  }

  // Dormant accounts (10)
  for (let i = 70; i < 80; i++) {
    const city = faker.helpers.arrayElement(INDIAN_CITIES);
    accounts.push({
      account_id: `ACC${String(i + 1).padStart(6, '0')}`,
      customer_name: faker.person.fullName(),
      kyc_level: 'LOW',
      branch: faker.helpers.arrayElement(BRANCHES),
      status: 'DORMANT',
      account_type: 'SAVINGS',
      balance: faker.number.float({ min: 100, max: 5000, fractionDigits: 2 }),
      last_active: faker.date.past({ years: 1 }),
      geo_location: { ...city },
      risk_score: 0,
    });
  }

  // Shell/mule accounts (20)
  for (let i = 80; i < 100; i++) {
    const city = faker.helpers.arrayElement(INDIAN_CITIES);
    accounts.push({
      account_id: `ACC${String(i + 1).padStart(6, '0')}`,
      customer_name: faker.company.name() + ' Ltd',
      kyc_level: 'LOW',
      branch: faker.helpers.arrayElement(BRANCHES),
      status: 'ACTIVE',
      account_type: i < 90 ? 'SHELL' : 'MULE',
      balance: faker.number.float({ min: 0, max: 1000, fractionDigits: 2 }),
      last_active: faker.date.recent({ days: 7 }),
      geo_location: { ...city },
      risk_score: faker.number.int({ min: 40, max: 60 }),
    });
  }

  await Account.insertMany(accounts);
  console.log(`✅ ${accounts.length} accounts seeded.`);
}

function generateTransaction(senderAcc, receiverAcc, amount, type = 'UPI', isFraud = false) {
  const city = faker.helpers.arrayElement(INDIAN_CITIES);
  return {
    tx_id: `TXN-${uuidv4().slice(0, 12).toUpperCase()}`,
    sender: senderAcc,
    receiver: receiverAcc,
    amount,
    timestamp: new Date(),
    transaction_type: type,
    channel: faker.helpers.arrayElement(['MOBILE', 'NET_BANKING', 'API', 'MOBILE']),
    geo_origin: { ...city },
    risk_score: isFraud ? faker.number.int({ min: 60, max: 90 }) : faker.number.int({ min: 0, max: 30 }),
    anomaly_flag: false,
    fraud_type: 'NONE',
    status: 'COMPLETED',
    description: faker.helpers.arrayElement(['Salary', 'Rent', 'Shopping', 'Investment', 'Transfer', 'Bill Payment', 'Freelance']),
  };
}

async function emitTransaction(txData) {
  try {
    const tx = new Transaction(txData);
    await tx.save();

    // Update account balances
    await Account.findOneAndUpdate(
      { account_id: txData.sender },
      { $inc: { balance: -txData.amount, total_outgoing: txData.amount, tx_count: 1 }, last_active: new Date() }
    );
    await Account.findOneAndUpdate(
      { account_id: txData.receiver },
      { $inc: { balance: txData.amount, total_incoming: txData.amount, tx_count: 1 }, last_active: new Date() }
    );

    if (io) io.emit('new_transaction', tx);

    // Run the modular fraud engine against the last 24h of activity
    const txObj = tx.toObject();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [allTx, allAccounts, allAlerts] = await Promise.all([
      Transaction.find({ timestamp: { $gte: since }, tx_id: { $ne: txObj.tx_id } }).lean(),
      Account.find().lean(),
      Alert.find({ status: 'OPEN' }).sort({ createdAt: -1 }).limit(200).lean(),
    ]);
    const result = await runFraudEngine(txObj, { allTx, allAccounts, allAlerts, io });

    // The engine mutates txObj (score, flags, fraud type); persist the verdict
    await Transaction.updateOne({ tx_id: txObj.tx_id }, { $set: {
      risk_score: txObj.risk_score,
      anomaly_flag: !!txObj.anomaly_flag,
      fraud_type: txObj.fraud_type || 'NONE',
      rule_flags: txObj.rule_flags || [],
      status: txObj.status || 'COMPLETED',
    } });
    if (result.alert) {
      const { _id, ...alertDoc } = result.alert; // let MongoDB assign its own _id
      await Alert.create(alertDoc);
      const senderAcc = allAccounts.find(a => a.account_id === txObj.sender);
      if (senderAcc) {
        await Account.updateOne({ account_id: senderAcc.account_id }, { $set: { is_flagged: !!senderAcc.is_flagged, risk_score: senderAcc.risk_score } });
      }
    }
    if (io) io.emit('transaction_updated', txObj);

    return txObj;
  } catch (err) {
    if (!err.message.includes('duplicate key')) console.error('TX emit error:', err.message);
  }
}

// --- Normal transaction flow ---
async function simulateNormalTransactions() {
  const accounts = await Account.find({ status: 'ACTIVE', account_type: { $in: ['SAVINGS', 'CURRENT'] } }).lean();
  if (accounts.length < 2) return;

  const sender = faker.helpers.arrayElement(accounts);
  const receiver = faker.helpers.arrayElement(accounts.filter(a => a.account_id !== sender.account_id));
  const amount = faker.number.float({ min: 500, max: 25000, fractionDigits: 2 });
  const type = faker.helpers.arrayElement(['UPI', 'IMPS', 'NEFT', 'UPI', 'UPI']);

  await emitTransaction(generateTransaction(sender.account_id, receiver.account_id, amount, type));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- Structuring fraud scenario ---
async function simulateStructuring() {
  const accounts = await Account.find({ status: 'ACTIVE' }).lean();
  const shell = accounts.find(a => a.account_type === 'SHELL') || faker.helpers.arrayElement(accounts);
  const targets = faker.helpers.arrayElements(accounts.filter(a => a.account_id !== shell.account_id), 4);

  console.log('🚨 Simulating STRUCTURING fraud...');
  const tx_ids = [];
  for (const target of targets) {
    const amount = faker.number.float({ min: 42000, max: 49500, fractionDigits: 2 });
    const tx = await emitTransaction(generateTransaction(shell.account_id, target.account_id, amount, 'NEFT', true));
    if (tx) tx_ids.push(tx.tx_id);
    await sleep(800);
  }
  return { scenario: 'STRUCTURING', sender: shell.account_id, count: tx_ids.length, tx_ids };
}

// --- Layering fraud scenario ---
async function simulateLayering() {
  const accounts = await Account.find({ account_type: { $in: ['SHELL', 'MULE'] } }).lean();
  if (accounts.length < 5) return null;

  console.log('🚨 Simulating LAYERING fraud chain...');
  const chain = faker.helpers.arrayElements(accounts, Math.min(6, accounts.length));
  let amount = faker.number.float({ min: 200000, max: 1000000, fractionDigits: 2 });
  const tx_ids = [];

  for (let i = 0; i < chain.length - 1; i++) {
    amount = amount * faker.number.float({ min: 0.7, max: 0.95, fractionDigits: 2 });
    const tx = await emitTransaction(generateTransaction(chain[i].account_id, chain[i + 1].account_id, amount, 'WIRE', true));
    if (tx) tx_ids.push(tx.tx_id);
    await sleep(600);
  }
  return { scenario: 'LAYERING', hops: chain.length - 1, tx_ids, accounts: chain.map(a => a.account_id) };
}

// --- Fan-out fraud scenario ---
async function simulateFanOut() {
  const accounts = await Account.find({ status: 'ACTIVE' }).lean();
  const shell = accounts.find(a => a.account_type === 'SHELL') || faker.helpers.arrayElement(accounts);
  const targets = faker.helpers.arrayElements(accounts.filter(a => a.account_id !== shell.account_id), 8);

  console.log('🚨 Simulating FAN-OUT fraud...');
  const totalAmount = faker.number.float({ min: 500000, max: 2000000, fractionDigits: 2 });
  const tx_ids = [];
  for (const target of targets) {
    const tx = await emitTransaction(generateTransaction(shell.account_id, target.account_id, totalAmount / targets.length, 'IMPS', true));
    if (tx) tx_ids.push(tx.tx_id);
    await sleep(400);
  }
  return { scenario: 'FAN_OUT', sender: shell.account_id, receivers: targets.length, tx_ids, total_amount: totalAmount };
}

// --- Dormant account activation ---
async function simulateDormantActivation() {
  const dormant = await Account.findOne({ status: 'DORMANT' });
  const active = await Account.findOne({ status: 'ACTIVE', account_type: 'SHELL' });
  if (!dormant || !active) return null;

  console.log('🚨 Simulating DORMANT account activation...');
  const amount = faker.number.float({ min: 100000, max: 500000, fractionDigits: 2 });
  const tx = await emitTransaction(generateTransaction(active.account_id, dormant.account_id, amount, 'NEFT', true));
  return { scenario: 'DORMANT_ACTIVATION', sender: active.account_id, dormant_account: dormant.account_id, amount, tx_id: tx?.tx_id, flagged: !!tx?.anomaly_flag };
}

// --- Mule transfer ---
async function simulateMule() {
  const mule = await Account.findOne({ account_type: 'MULE' });
  const sender = await Account.findOne({ status: 'ACTIVE', account_type: 'SAVINGS' });
  if (!mule || !sender) return null;

  console.log('🚨 Simulating MULE transfer...');
  const amount = faker.number.float({ min: 50000, max: 400000, fractionDigits: 2 });
  const tx = await emitTransaction(generateTransaction(sender.account_id, mule.account_id, amount, 'IMPS', true));
  return { scenario: 'MULE_TRANSFER', sender: sender.account_id, mule_account: mule.account_id, amount, tx_id: tx?.tx_id, flagged: !!tx?.anomaly_flag };
}

const fraudScenarios = [simulateStructuring, simulateLayering, simulateFanOut, simulateDormantActivation];

function startSimulator(socketIo) {
  io = socketIo;

  seedAccounts().then(() => {
    console.log('🚀 Transaction simulator started');

    // Normal transactions every 2 seconds
    simulatorInterval = setInterval(simulateNormalTransactions, 2000);

    // Fraud scenario every 30 seconds
    fraudScenarioInterval = setInterval(async () => {
      const scenario = faker.helpers.arrayElement(fraudScenarios);
      await scenario();
    }, 30000);

    // First fraud scenario after 10 seconds
    setTimeout(async () => {
      await simulateLayering();
    }, 10000);
  });
}

function stopSimulator() {
  if (simulatorInterval) clearInterval(simulatorInterval);
  if (fraudScenarioInterval) clearInterval(fraudScenarioInterval);
  console.log('⏹️ Simulator stopped');
}

module.exports = {
  startSimulator, stopSimulator, seedAccounts, emitTransaction, generateTransaction,
  scenarios: { layering: simulateLayering, structuring: simulateStructuring, fanout: simulateFanOut, dormant: simulateDormantActivation, mule: simulateMule },
};
