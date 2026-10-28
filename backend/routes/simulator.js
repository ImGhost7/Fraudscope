const express = require('express');
const { faker } = require('@faker-js/faker');
const router = express.Router();
const Account = require('../models/Account');
const { emitTransaction, generateTransaction, scenarios } = require('../simulator/txSimulator');

const CITIES = {
  Mumbai: ['Maharashtra', 19.076, 72.8777], Delhi: ['Delhi', 28.7041, 77.1025], Bangalore: ['Karnataka', 12.9716, 77.5946],
  Chennai: ['Tamil Nadu', 13.0827, 80.2707], Hyderabad: ['Telangana', 17.385, 78.4867], Pune: ['Maharashtra', 18.5204, 73.8567],
  Kolkata: ['West Bengal', 22.5726, 88.3639], Ahmedabad: ['Gujarat', 23.0225, 72.5714],
};
const BRANCHES = ['SBI Main', 'HDFC Andheri', 'ICICI Kurla', 'Axis Bank Bandra', 'PNB CP'];

router.get('/accounts', async (req, res) => {
  try {
    const accounts = await Account.find({}, 'account_id customer_name account_type status balance kyc_level risk_score is_flagged geo_location -_id').sort({ account_id: 1 }).lean();
    res.json({ accounts, total: accounts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/account', async (req, res) => {
  try {
    const { customer_name, account_type = 'SAVINGS', status = 'ACTIVE', opening_balance = 10000, kyc_level = 'MEDIUM', city = 'Mumbai' } = req.body;
    if (!customer_name) return res.status(400).json({ error: 'customer_name is required' });
    const last = await Account.findOne().sort({ account_id: -1 }).lean();
    const next = last ? parseInt(last.account_id.replace('ACC', ''), 10) + 1 : 1;
    const [state, lat, lng] = CITIES[city] || CITIES.Mumbai;
    const account = await Account.create({
      account_id: `ACC${String(next).padStart(6, '0')}`,
      customer_name, kyc_level, status, account_type,
      branch: faker.helpers.arrayElement(BRANCHES),
      balance: Number(opening_balance),
      last_active: status === 'DORMANT' ? faker.date.past({ years: 1 }) : new Date(),
      geo_location: { city: CITIES[city] ? city : 'Mumbai', state, lat, lng },
      risk_score: account_type === 'SAVINGS' ? 5 : account_type === 'MULE' ? 55 : 45,
    });
    const io = req.app.get('io');
    if (io) io.emit('account_created', account);
    res.status(201).json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/transaction', async (req, res) => {
  try {
    const { sender, receiver, amount, transaction_type = 'UPI', channel = 'MOBILE' } = req.body;
    if (!sender || !receiver || !amount) return res.status(400).json({ error: 'sender, receiver, and amount are required' });
    if (sender === receiver) return res.status(400).json({ error: 'Sender and receiver cannot be the same account' });
    const [s, r] = await Promise.all([Account.findOne({ account_id: sender }).lean(), Account.findOne({ account_id: receiver }).lean()]);
    if (!s) return res.status(404).json({ error: `Sender account ${sender} not found` });
    if (!r) return res.status(404).json({ error: `Receiver account ${receiver} not found` });
    if (s.balance < Number(amount)) {
      return res.status(400).json({ error: `Insufficient balance: ₹${s.balance.toLocaleString()} available, ₹${Number(amount).toLocaleString()} requested` });
    }
    const tx = generateTransaction(sender, receiver, Number(amount), transaction_type, false);
    tx.channel = channel;
    if (s.geo_location?.city) tx.geo_origin = { ...s.geo_location };
    const result = await emitTransaction(tx);
    if (!result) return res.status(500).json({ error: 'Transaction could not be processed' });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/scenario/:type', async (req, res) => {
  const run = scenarios[req.params.type];
  if (!run) return res.status(404).json({ error: `Unknown scenario "${req.params.type}"` });
  try {
    const result = await run();
    if (!result) return res.status(400).json({ error: 'Not enough suitable accounts for this scenario' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
