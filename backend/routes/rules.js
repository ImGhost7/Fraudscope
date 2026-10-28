const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Alert = require('../models/Alert');
const riskWeights = require('../fraud_engine/config/riskWeights');
const { runFraudEngine } = require('../fraud_engine/ruleEngine');

router.get('/config', (req, res) => res.json(riskWeights.get()));

router.patch('/config', (req, res) => {
  try {
    riskWeights.update(req.body);
    res.json({ message: 'Configuration updated successfully', config: riskWeights.get() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Dry-run a chain of hypothetical transactions through the engine (nothing is persisted)
router.post('/dry-run', async (req, res) => {
  try {
    const { chain, sender, receiver, amount, transaction_type = 'UPI', channel = 'MOBILE', city = 'Mumbai' } = req.body;
    let steps;
    if (Array.isArray(chain)) steps = chain;
    else if (sender && receiver && amount) steps = [{ sender, receiver, amount, transaction_type, channel, city }];
    else return res.status(400).json({ error: 'Either "chain" array or "sender, receiver, amount" fields are required' });

    const withOffsets = steps.map((row, idx) => ({
      ...row,
      ts_offset_seconds: row.ts_offset_seconds !== undefined && row.ts_offset_seconds !== '' ? Number(row.ts_offset_seconds) : idx * 45,
    }));
    const maxOffset = Math.max(0, ...withOffsets.map(r => r.ts_offset_seconds));
    const baseTime = Date.now() - (maxOffset + 30) * 1000;

    const [stored, allAccounts, allAlerts] = await Promise.all([
      Transaction.find({ timestamp: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } }).lean(),
      Account.find().lean(),
      Alert.find({ status: 'OPEN' }).limit(200).lean(),
    ]);

    const chainTxs = withOffsets.map((step, i) => ({
      tx_id: `DRY-${uuidv4().slice(0, 8).toUpperCase()}`,
      sender: step.sender,
      receiver: step.receiver,
      amount: Number(step.amount),
      timestamp: new Date(baseTime + step.ts_offset_seconds * 1000),
      transaction_type: step.transaction_type || 'UPI',
      channel: step.channel || 'MOBILE',
      geo_origin: { city: step.city || 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.877 },
      description: `Dry Run Chain Step ${i + 1}`,
      ts_offset_seconds: step.ts_offset_seconds,
    }));
    const pool = [...stored, ...chainTxs];

    const results = [];
    for (const tx of chainTxs) {
      const result = await runFraudEngine(tx, { allTx: pool.filter(t => t.tx_id !== tx.tx_id), allAccounts, allAlerts });
      results.push({
        transaction: tx,
        result: {
          finalScore: result.finalScore, riskLevel: result.riskLevel, action: result.action,
          allFlags: result.allFlags, explanation: result.explanation, traces: result.traces,
        },
      });
    }
    res.json(Array.isArray(chain) ? { chain: results } : results[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
