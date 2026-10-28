const mongoose = require('mongoose');

const investigationSchema = new mongoose.Schema({
  case_id: { type: String, unique: true, required: true },
  title: { type: String, required: true },
  description: String,
  investigator: { type: String, required: true },
  severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'HIGH' },
  status: { type: String, enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED'], default: 'OPEN' },
  linked_accounts: [{ type: String }],
  linked_transactions: [{ type: String }],
  linked_alerts: [{ type: String }],
  notes: [{
    author: String,
    content: String,
    timestamp: { type: Date, default: Date.now },
  }],
  evidence_timeline: [{
    event_type: String,
    description: String,
    timestamp: { type: Date, default: Date.now },
    metadata: mongoose.Schema.Types.Mixed,
  }],
  fraud_type: String,
  total_amount_involved: { type: Number, default: 0 },
  str_generated: { type: Boolean, default: false },
  str_generated_at: Date,
}, { timestamps: true });

module.exports = mongoose.model('Investigation', investigationSchema);
