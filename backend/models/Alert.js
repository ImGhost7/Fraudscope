const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  alert_id: { type: String, unique: true, required: true },
  alert_type: { type: String, required: true },
  severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'HIGH' },
  risk_score: { type: Number, default: 0, min: 0, max: 100 },
  final_risk_score: Number,
  tx_references: [{ type: String }],
  account_references: [{ type: String }],
  description: String,
  status: { type: String, enum: ['OPEN', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE'], default: 'OPEN' },
  assigned_to: String,
  resolved_at: Date,
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

module.exports = mongoose.model('Alert', alertSchema);
