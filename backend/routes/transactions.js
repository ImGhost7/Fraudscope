const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');

// GET all transactions (paginated)
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, flagged, fraud_type, sender, receiver } = req.query;
    const filter = {};
    if (flagged === 'true') filter.anomaly_flag = true;
    if (fraud_type && fraud_type !== 'ALL') filter.fraud_type = fraud_type;
    if (sender) filter.sender = sender;
    if (receiver) filter.receiver = receiver;

    const txs = await Transaction.find(filter)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    const total = await Transaction.countDocuments(filter);
    res.json({ transactions: txs, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET graph data for visualization
router.get('/graph', async (req, res) => {
  try {
    const { hours = 24, flaggedOnly = false } = req.query;
    const since = new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000);
    const filter = { timestamp: { $gte: since } };
    if (flaggedOnly === 'true') filter.anomaly_flag = true;

    const txs = await Transaction.find(filter).sort({ timestamp: -1 }).limit(500).lean();
    const accountIds = [...new Set([...txs.map(t => t.sender), ...txs.map(t => t.receiver)])];
    const accounts = await Account.find({ account_id: { $in: accountIds } }).lean();

    const nodes = accounts.map(a => ({
      id: a.account_id,
      name: a.customer_name,
      type: a.account_type,
      risk_score: a.risk_score,
      is_flagged: a.is_flagged,
      status: a.status,
      balance: a.balance,
      kyc_level: a.kyc_level,
      branch: a.branch,
      geo_location: a.geo_location,
      val: Math.max(2, a.risk_score / 10),
    }));

    const links = txs.map(t => ({
      source: t.sender,
      target: t.receiver,
      amount: t.amount,
      tx_id: t.tx_id,
      fraud_type: t.fraud_type,
      risk_score: t.risk_score,
      anomaly_flag: t.anomaly_flag,
      timestamp: t.timestamp,
      transaction_type: t.transaction_type,
    }));

    res.json({ nodes, links });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET stats
router.get('/stats/summary', async (req, res) => {
  try {
    const [total, flagged, totalAmount] = await Promise.all([
      Transaction.countDocuments(),
      Transaction.countDocuments({ anomaly_flag: true }),
      Transaction.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
    ]);
    const fraudTypes = await Transaction.aggregate([
      { $match: { anomaly_flag: true } },
      { $group: { _id: '$fraud_type', count: { $sum: 1 } } },
    ]);
    res.json({ total, flagged, total_amount: totalAmount[0]?.total || 0, fraud_types: fraudTypes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single transaction
router.get('/:tx_id', async (req, res) => {
  try {
    const tx = await Transaction.findOne({ tx_id: req.params.tx_id }).lean();
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
