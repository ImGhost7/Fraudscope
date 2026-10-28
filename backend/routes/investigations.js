const express = require('express');
const router = express.Router();
const Investigation = require('../models/Investigation');
const { v4: uuidv4 } = require('uuid');

router.get('/', async (req, res) => {
  try {
    const { status, severity } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (severity) filter.severity = severity;
    const cases = await Investigation.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ cases, total: cases.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, description, investigator, severity, linked_accounts, linked_transactions, linked_alerts, fraud_type, total_amount_involved } = req.body;
    const inv = new Investigation({
      case_id: `CASE-${uuidv4().slice(0, 8).toUpperCase()}`,
      title, description, investigator, severity,
      linked_accounts: linked_accounts || [],
      linked_transactions: linked_transactions || [],
      linked_alerts: linked_alerts || [],
      fraud_type,
      total_amount_involved: total_amount_involved || 0,
    });
    await inv.save();
    res.status(201).json(inv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:case_id', async (req, res) => {
  try {
    const inv = await Investigation.findOne({ case_id: req.params.case_id }).lean();
    if (!inv) return res.status(404).json({ error: 'Case not found' });
    res.json(inv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:case_id', async (req, res) => {
  try {
    const inv = await Investigation.findOneAndUpdate(
      { case_id: req.params.case_id },
      { ...req.body, updatedAt: new Date() },
      { new: true }
    );
    if (!inv) return res.status(404).json({ error: 'Case not found' });
    res.json(inv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:case_id/notes', async (req, res) => {
  try {
    const { author, content } = req.body;
    const inv = await Investigation.findOneAndUpdate(
      { case_id: req.params.case_id },
      { $push: { notes: { author, content, timestamp: new Date() } } },
      { new: true }
    );
    if (!inv) return res.status(404).json({ error: 'Case not found' });
    res.json(inv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:case_id/str', async (req, res) => {
  try {
    const inv = await Investigation.findOneAndUpdate(
      { case_id: req.params.case_id },
      { str_generated: true, str_generated_at: new Date(), status: 'ESCALATED' },
      { new: true }
    );
    if (!inv) return res.status(404).json({ error: 'Case not found' });
    res.json({ message: 'STR report generated', case: inv });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
