/**
 * BehaviourBaseline Service
 *
 * Computes a customer's historical behavioural profile from the last
 * BASELINE_WINDOW_DAYS of transactions. This baseline is used by every
 * rule to measure deviation rather than comparing against global thresholds.
 *
 * Returns a rich profile:
 *   avgDailyAmount, avgDailyCount, avgTransferAmount,
 *   activeDays, typicalHours, typicalBeneficiaries, knownBeneficiaries
 */

const { BEHAVIOUR } = require('../config/riskWeights');

/**
 * @param {string} accountId
 * @param {Object[]} allTransactions  - full in-memory or DB array of transactions
 * @returns {Object} baseline profile
 */
function buildBaseline(accountId, allTransactions) {
  const cutoff = Date.now() - BEHAVIOUR.BASELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const history = allTransactions.filter(
    t => t.sender === accountId && new Date(t.timestamp).getTime() >= cutoff
  );

  if (history.length === 0) {
    return {
      hasHistory: false,
      avgDailyAmount: 0,
      avgDailyCount: 0,
      avgTransferAmount: 0,
      activeDays: 0,
      knownBeneficiaries: new Set(),
      typicalHours: [],
      totalAmount: 0,
      totalCount: 0,
    };
  }

  // Group by day
  const byDay = {};
  history.forEach(t => {
    const day = new Date(t.timestamp).toDateString();
    if (!byDay[day]) byDay[day] = { count: 0, total: 0 };
    byDay[day].count++;
    byDay[day].total += t.amount;
  });

  const days = Object.values(byDay);
  const activeDays = days.length;
  const totalAmount = history.reduce((s, t) => s + t.amount, 0);
  const totalCount = history.length;

  const avgDailyAmount = totalAmount / activeDays;
  const avgDailyCount = totalCount / activeDays;
  const avgTransferAmount = totalAmount / totalCount;

  const knownBeneficiaries = new Set(history.map(t => t.receiver));

  // Hours distribution
  const hours = history.map(t => new Date(t.timestamp).getHours());
  const hourFreq = {};
  hours.forEach(h => { hourFreq[h] = (hourFreq[h] || 0) + 1; });
  const typicalHours = Object.entries(hourFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([h]) => parseInt(h));

  return {
    hasHistory: true,
    avgDailyAmount,
    avgDailyCount,
    avgTransferAmount,
    activeDays,
    knownBeneficiaries,
    typicalHours,
    totalAmount,
    totalCount,
  };
}

/**
 * Deviation factor: how many times current value exceeds baseline average.
 * Returns 1.0 if no history (treat as normal).
 */
function deviationFactor(currentValue, baselineAvg) {
  if (!baselineAvg || baselineAvg === 0) return 1.0;
  return currentValue / baselineAvg;
}

module.exports = { buildBaseline, deviationFactor };
