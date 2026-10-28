const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  tx_id: { type: String, unique: true, required: true },
  sender: { type: String, required: true, ref: 'Account' },
  receiver: { type: String, required: true, ref: 'Account' },
  amount: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
  transaction_type: {
    type: String,
    enum: ['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'WIRE'],
    default: 'UPI'
  },
  channel: { type: String, enum: ['MOBILE', 'NET_BANKING', 'ATM', 'BRANCH', 'API'], default: 'MOBILE' },
  geo_origin: {
    city: String,
    state: String,
    lat: Number,
    lng: Number,
  },
  risk_score: { type: Number, default: 0, min: 0, max: 100 },
  anomaly_flag: { type: Boolean, default: false },
  fraud_type: { type: String, default: 'NONE' },
  ml_score: { type: Number, default: 0 },
  rule_flags: [{ type: String }],
  status: { type: String, enum: ['COMPLETED', 'PENDING', 'FLAGGED', 'BLOCKED'], default: 'COMPLETED' },
  description: String,
  // multi-detector analysis (Isolation Forest + GNN + fusion); risk_score keeps its rule-engine meaning
  detectors: { type: mongoose.Schema.Types.Mixed },
  final_risk_score: Number,
  final_risk_level: String,
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);
