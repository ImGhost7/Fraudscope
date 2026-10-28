const express = require('express');
const router = express.Router();
const Alert = require('../models/Alert');

router.get('/', async (req, res) => {
  try {
    const { status, severity, type, limit = 100 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (severity) filter.severity = severity;
    if (type) filter.alert_type = type;

    const alerts = await Alert.find(filter).sort({ createdAt: -1 }).limit(parseInt(limit)).lean();
    const total = await Alert.countDocuments(filter);
    res.json({ alerts, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const [total, open, critical] = await Promise.all([
      Alert.countDocuments(),
      Alert.countDocuments({ status: 'OPEN' }),
      Alert.countDocuments({ severity: 'CRITICAL', status: 'OPEN' }),
    ]);
    const byType = await Alert.aggregate([{ $group: { _id: '$alert_type', count: { $sum: 1 } } }]);
    const bySeverity = await Alert.aggregate([{ $group: { _id: '$severity', count: { $sum: 1 } } }]);
    res.json({ total, open, critical, by_type: byType, by_severity: bySeverity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:alert_id', async (req, res) => {
  try {
    const alert = await Alert.findOne({ alert_id: req.params.alert_id }).lean();
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    res.json(alert);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:alert_id/status', async (req, res) => {
  try {
    const { status, assigned_to } = req.body;
    const update = { status };
    if (assigned_to) update.assigned_to = assigned_to;
    if (status === 'RESOLVED') update.resolved_at = new Date();

    const alert = await Alert.findOneAndUpdate({ alert_id: req.params.alert_id }, update, { new: true });
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    res.json(alert);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
