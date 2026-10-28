const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  account_id: { type: String, unique: true, required: true },
  customer_name: { type: String, required: true },
  kyc_level: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
  branch: { type: String, required: true },
  status: { type: String, enum: ['ACTIVE', 'DORMANT', 'FROZEN', 'SUSPICIOUS'], default: 'ACTIVE' },
  account_type: { type: String, enum: ['SAVINGS', 'CURRENT', 'SHELL', 'MULE'], default: 'SAVINGS' },
  balance: { type: Number, default: 0 },
  last_active: { type: Date, default: Date.now },
  geo_location: {
    city: String,
    state: String,
    country: { type: String, default: 'India' },
    lat: Number,
    lng: Number,
  },
  risk_score: { type: Number, default: 0, min: 0, max: 100 },
  is_flagged: { type: Boolean, default: false },
  total_incoming: { type: Number, default: 0 },
  total_outgoing: { type: Number, default: 0 },
  tx_count: { type: Number, default: 0 },
  opened_at: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Account', accountSchema);
