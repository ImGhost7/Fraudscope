const express = require('express');
const router = express.Router();
const Account = require('../models/Account');

router.get('/', async (req, res) => {
  try {
    const { status, type, flagged, limit = 100 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.account_type = type;
    if (flagged === 'true') filter.is_flagged = true;

    const accounts = await Account.find(filter).sort({ risk_score: -1 }).limit(parseInt(limit)).lean();
    const total = await Account.countDocuments(filter);
    res.json({ accounts, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/summary', async (req, res) => {
  try {
    const [total, flagged, dormant, suspicious] = await Promise.all([
      Account.countDocuments(),
      Account.countDocuments({ is_flagged: true }),
      Account.countDocuments({ status: 'DORMANT' }),
      Account.countDocuments({ status: 'SUSPICIOUS' }),
    ]);
    const byType = await Account.aggregate([{ $group: { _id: '$account_type', count: { $sum: 1 } } }]);
    res.json({ total, flagged, dormant, suspicious, by_type: byType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:account_id', async (req, res) => {
  try {
    const account = await Account.findOne({ account_id: req.params.account_id }).lean();
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const Transaction = require('../models/Transaction');
    const recentTxs = await Transaction.find({
      $or: [{ sender: account.account_id }, { receiver: account.account_id }]
    }).sort({ timestamp: -1 }).limit(20).lean();
    res.json({ ...account, recent_transactions: recentTxs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
