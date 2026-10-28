/**
 * RULE 5 — VELOCITY DETECTOR
 *
 * Detects sudden bursts of activity from an account.
 * Compares current session activity against the customer's historical baseline.
 *
 * Suspicious signals:
 *   - Transaction count > 3× historical daily average in 30 minutes
 *   - Total value > 3× historical daily average in 30 minutes
 *   - Average interval between transactions < 30 seconds
 *   - Activity during unusual hours (11PM–5AM)
 *
 * Returns: { riskContribution, flags, reasons, features }
 */

const { MODIFIERS, BEHAVIOUR } = require('../config/riskWeights');
const { deviationFactor } = require('../services/behaviourBaseline');

/**
 * @param {Object}   tx       - current transaction
 * @param {Object[]} allTx    - all transactions in memory
 * @param {Object}   baseline - from behaviourBaseline.buildBaseline()
 * @returns {{ riskContribution, flags, reasons, features }}
 */
/**
 * @param {Object}   tx       - current transaction
 * @param {Object[]} allTx    - all transactions in memory
 * @param {Object}   baseline - from behaviourBaseline.buildBaseline()
 * @returns {{ riskContribution, flags, reasons, features }}
 */
function checkVelocity(tx, allTx, baseline) {
  const configService = require('../config/riskWeights');
  const CONFIG = configService.get();
  const { RULE_STATES, MODIFIERS, BEHAVIOUR } = CONFIG;

  if (RULE_STATES && RULE_STATES.VELOCITY === false) {
    return {
      ruleName: 'VELOCITY',
      riskContribution: 0,
      flags: [],
      reasons: [],
      features: { velocity_risk_score: 0 },
      trace: { ruleName: 'VELOCITY', enabled: false, score: 0, checks: [] }
    };
  }

  const flags   = [];
  const reasons = [];
  let contribution = 0;

  const now = new Date(tx.timestamp).getTime();

  // All transactions from this sender in the velocity window
  const windowTxs = allTx.filter(
    t => t.sender === tx.sender &&
         t.tx_id !== tx.tx_id &&
         now - new Date(t.timestamp).getTime() <= BEHAVIOUR.VELOCITY_WINDOW_MS
  );
  const sessionTxs = [...windowTxs, tx].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  const sessionCount  = sessionTxs.length;
  const sessionValue  = sessionTxs.reduce((s, t) => s + t.amount, 0);
  const sessionMinutes = BEHAVIOUR.VELOCITY_WINDOW_MS / 60000;

  let countDeviationMatched = false;
  let countDev = 0;
  let valueDeviationMatched = false;
  let valueDev = 0;
  let absoluteThresholdMatched = false;

  // ── Count Deviation ──────────────────────────────────────────────────────────
  if (baseline.hasHistory) {
    countDev = deviationFactor(sessionCount, baseline.avgDailyCount);
    if (countDev >= BEHAVIOUR.VELOCITY_BURST_MULTIPLIER) {
      countDeviationMatched = true;
      contribution += MODIFIERS.BURST_HIGH_COUNT;
      flags.push('VELOCITY_BURST_COUNT');
      reasons.push(
        `${sessionCount} transactions in ${sessionMinutes} minutes — ` +
        `${countDev.toFixed(1)}× above historical daily average ` +
        `(avg: ${baseline.avgDailyCount.toFixed(1)}/day).`
      );
    }

    // ── Value Deviation ────────────────────────────────────────────────────────
    valueDev = deviationFactor(sessionValue, baseline.avgDailyAmount);
    if (valueDev >= BEHAVIOUR.VELOCITY_BURST_MULTIPLIER) {
      valueDeviationMatched = true;
      contribution += MODIFIERS.BURST_HIGH_VALUE;
      flags.push('VELOCITY_BURST_VALUE');
      reasons.push(
        `₹${Math.round(sessionValue).toLocaleString('en-IN')} transferred in ${sessionMinutes} minutes — ` +
        `${valueDev.toFixed(1)}× above historical daily average ` +
        `(avg: ₹${Math.round(baseline.avgDailyAmount).toLocaleString('en-IN')}/day).`
      );
    }
  } else {
    // No baseline: use absolute minimum threshold for completely new accounts
    if (sessionCount >= 10) {
      absoluteThresholdMatched = true;
      contribution += MODIFIERS.BURST_HIGH_COUNT;
      flags.push('VELOCITY_BURST_COUNT_NEW_ACCOUNT');
      reasons.push(
        `${sessionCount} transactions in ${sessionMinutes} minutes from an account with no history.`
      );
    }
  }

  // ── Average Interval (too-fast = bot-like) ───────────────────────────────────
  let avgIntervalSec = Infinity;
  let intervalTooFastMatched = false;
  if (sessionTxs.length >= 2) {
    const intervals = [];
    for (let i = 1; i < sessionTxs.length; i++) {
      const diff = new Date(sessionTxs[i].timestamp) - new Date(sessionTxs[i - 1].timestamp);
      intervals.push(diff / 1000);
    }
    avgIntervalSec = intervals.reduce((s, v) => s + v, 0) / intervals.length;

    if (avgIntervalSec < BEHAVIOUR.VELOCITY_MAX_INTERVAL_FAST_SEC) {
      intervalTooFastMatched = true;
      contribution += MODIFIERS.SESSION_TOO_FAST;
      flags.push('SESSION_TOO_FAST');
      reasons.push(
        `Average interval between transactions is ${avgIntervalSec.toFixed(1)}s ` +
        `(< ${BEHAVIOUR.VELOCITY_MAX_INTERVAL_FAST_SEC}s threshold). Possible automated activity.`
      );
    }
  }

  // ── Late-Night Activity ──────────────────────────────────────────────────────
  const txHour = new Date(tx.timestamp).getHours();
  const isNight = txHour >= 23 || txHour <= 5;
  const nightBurstMatched = isNight && sessionCount >= 3;

  if (nightBurstMatched) {
    contribution += MODIFIERS.NIGHT_SESSION;
    flags.push('NIGHT_SESSION_BURST');
    reasons.push(
      `High-velocity activity between 11PM–5AM: ${sessionCount} transactions at ${txHour}:00h.`
    );
  }

  const finalContribution = Math.min(CONFIG.VELOCITY_MAX, Math.max(0, contribution));

  const trace = {
    ruleName: 'VELOCITY',
    enabled: true,
    score: finalContribution,
    rawScore: contribution,
    maxPossibleScore: CONFIG.VELOCITY_MAX,
    checks: [
      {
        name: 'Historical Count Velocity',
        description: `Flags count surges exceeding historical daily average by ${BEHAVIOUR.VELOCITY_BURST_MULTIPLIER}x in ${sessionMinutes}m`,
        matched: countDeviationMatched,
        scoreEffect: countDeviationMatched ? MODIFIERS.BURST_HIGH_COUNT : 0,
        details: baseline.hasHistory ? `Count deviation: ${countDev.toFixed(1)}x.` : 'No baseline history.'
      },
      {
        name: 'Historical Value Velocity',
        description: `Flags value surges exceeding historical daily average by ${BEHAVIOUR.VELOCITY_BURST_MULTIPLIER}x in ${sessionMinutes}m`,
        matched: valueDeviationMatched,
        scoreEffect: valueDeviationMatched ? MODIFIERS.BURST_HIGH_VALUE : 0,
        details: baseline.hasHistory ? `Value deviation: ${valueDev.toFixed(1)}x.` : 'No baseline history.'
      },
      {
        name: 'New Account Absolute Count Limit',
        description: `Flags new accounts exceeding ${10} transactions within ${sessionMinutes} minutes without baseline`,
        matched: absoluteThresholdMatched,
        scoreEffect: absoluteThresholdMatched ? MODIFIERS.BURST_HIGH_COUNT : 0,
        details: absoluteThresholdMatched ? `New account session count: ${sessionCount}.` : 'Account has history or is below limit.'
      },
      {
        name: 'High Frequency Interval Check',
        description: `Detects bot-like transaction intervals (average interval < ${BEHAVIOUR.VELOCITY_MAX_INTERVAL_FAST_SEC} seconds)`,
        matched: intervalTooFastMatched,
        scoreEffect: intervalTooFastMatched ? MODIFIERS.SESSION_TOO_FAST : 0,
        details: `Average interval between transactions: ${avgIntervalSec === Infinity ? 'N/A' : avgIntervalSec.toFixed(1) + 's'}.`
      },
      {
        name: 'Late Night High Velocity Check',
        description: 'Raises risk if multiple transactions occur during unusual late night hours (11 PM - 5 AM)',
        matched: nightBurstMatched,
        scoreEffect: nightBurstMatched ? MODIFIERS.NIGHT_SESSION : 0,
        details: `Session count at hour ${txHour}:00h: ${sessionCount}.`
      }
    ]
  };

  const features = {
    velocity_risk_score:      finalContribution,
    session_tx_count:         sessionCount,
    session_total_value:      Math.round(sessionValue),
    session_avg_interval_sec: avgIntervalSec === Infinity ? 0 : parseFloat(avgIntervalSec.toFixed(1)),
    is_night_session:         isNight ? 1 : 0,
    count_deviation:          baseline.hasHistory ? parseFloat(deviationFactor(sessionCount, baseline.avgDailyCount).toFixed(2)) : 0,
    value_deviation:          baseline.hasHistory ? parseFloat(deviationFactor(sessionValue, baseline.avgDailyAmount).toFixed(2)) : 0,
  };

  return {
    ruleName: 'VELOCITY',
    riskContribution: finalContribution,
    flags: [...new Set(flags)],
    reasons,
    features,
    trace,
  };
}

module.exports = { checkVelocity };

module.exports = { checkVelocity };
