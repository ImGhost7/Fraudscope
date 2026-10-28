/**
 * Fraudscope AI — Helper Utilities
 */

const formatINR = (amount) => {
  if (!amount) return '₹0';
  return `₹${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const formatINRFull = (amount) => {
  if (!amount) return '₹0';
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)} L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${amount.toFixed(0)}`;
};

const getRiskColor = (score) => {
  if (score >= 80) return '#ef4444';
  if (score >= 60) return '#f59e0b';
  if (score >= 40) return '#00d4ff';
  return '#10b981';
};

const getRiskLabel = (score) => {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
};

const getFraudLabel = (type) => {
  const labels = {
    STRUCTURING: 'Structuring',
    LAYERING: 'Layering',
    ROUND_TRIP: 'Round-Tripping',
    DORMANT_ACTIVATION: 'Dormant Activation',
    FAN_OUT: 'Fan-Out',
    MULE: 'Mule Account',
    MULE_BEHAVIOUR: 'Mule Behaviour',
    HIGH_VELOCITY: 'High Velocity',
    GEO_ANOMALY: 'Geo Anomaly',
    NONE: 'Clean',
  };
  return labels[type] || type;
};

const timeAgo = (date) => {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(date).toLocaleDateString('en-IN');
};

module.exports = { formatINR, formatINRFull, getRiskColor, getRiskLabel, getFraudLabel, timeAgo };
