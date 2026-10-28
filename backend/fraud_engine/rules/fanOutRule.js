/**
 * RULE 3 — FAN-OUT DETECTOR
 *
 * Detects rapid distribution of funds from one source to many receivers.
 * Goes beyond simple receiver count:
 *
 *   - Analyses receiver types (trusted vs unknown)
 *   - Detects equal-distribution pattern (equal splits = suspicious)
 *   - Checks for new vs historical beneficiaries
 *   - Detects Fan-Out → Fan-In (dispersal + reconvergence)
 *   - Receiver geographic diversity
 *
 * Returns: { riskContribution, flags, reasons, features }
 */

const { MODIFIERS, BEHAVIOUR } = require('../config/riskWeights');

// Trusted receiver keywords (salary/employer/gov/utility accounts)
const TRUSTED_PATTERNS = ['employer', 'gov', 'govt', 'lic', 'nsdl', 'epfo', 'municipal', 'hdfc payroll', 'salary'];

/**
 * @param {Object}   tx           - current transaction
 * @param {Object[]} allTx        - all transactions (in-memory)
 * @param {Object[]} allAccounts  - all accounts (in-memory)
 * @param {Object}   baseline     - from behaviourBaseline.buildBaseline()
 * @returns {{ riskContribution, flags, reasons, features }}
 */
function checkFanOut(tx, allTx, allAccounts, baseline) {
  const configService = require('../config/riskWeights');
  const CONFIG = configService.get();
  const { RULE_STATES, MODIFIERS, BEHAVIOUR } = CONFIG;

  if (RULE_STATES && RULE_STATES.FAN_OUT === false) {
    return {
      ruleName: 'FAN_OUT',
      riskContribution: 0,
      flags: [],
      reasons: [],
      features: { fan_out_risk_score: 0 },
      trace: { ruleName: 'FAN_OUT', enabled: false, score: 0, checks: [] }
    };
  }

  const flags   = [];
  const reasons = [];
  let contribution = 0;

  const now = new Date(tx.timestamp).getTime();
  const windowStart = now - BEHAVIOUR.FAN_OUT_WINDOW_MS;

  // Transactions from same sender in window (include current tx)
  const windowTxs = allTx.filter(
    t => t.sender === tx.sender &&
         new Date(t.timestamp).getTime() >= windowStart
  );
  const allWindowTxs = [...windowTxs, tx];

  const uniqueReceivers = [...new Set(allWindowTxs.map(t => t.receiver))];
  const meetsMinReceivers = uniqueReceivers.length >= BEHAVIOUR.FAN_OUT_MIN_RECEIVERS;

  const traceChecks = [
    {
      name: 'Minimum Receiver Count Threshold',
      description: `Verifies if the sender distributed funds to a minimum number of unique accounts (threshold: >= ${BEHAVIOUR.FAN_OUT_MIN_RECEIVERS})`,
      matched: meetsMinReceivers,
      scoreEffect: 0,
      details: `Found ${uniqueReceivers.length} unique receivers within a ${BEHAVIOUR.FAN_OUT_WINDOW_MS / 60000} min window.`
    }
  ];

  if (!meetsMinReceivers) {
    return {
      ruleName: 'FAN_OUT',
      riskContribution: 0,
      flags: [],
      reasons: [],
      features: {
        fan_out_risk_score: 0,
        unique_receiver_count: uniqueReceivers.length,
        new_receiver_count: 0,
        new_receiver_ratio: 0,
        equal_distribution_score: 0,
        receiver_diversity_score: 0,
      },
      trace: {
        ruleName: 'FAN_OUT',
        enabled: true,
        score: 0,
        maxPossibleScore: CONFIG.FAN_OUT_MAX,
        checks: traceChecks
      }
    };
  }

  const accountMap = {};
  for (const acc of allAccounts) accountMap[acc.account_id] = acc;

  // ── Receiver Type Analysis ───────────────────────────────────────────────────
  let trustedCount = 0;
  let suspiciousCount = 0;

  for (const receiverId of uniqueReceivers) {
    const acc = accountMap[receiverId];
    if (acc) {
      const name = (acc.customer_name || '').toLowerCase();
      const isTrusted = TRUSTED_PATTERNS.some(p => name.includes(p));
      if (isTrusted || acc.account_type === 'SAVINGS') {
        if (baseline.knownBeneficiaries.has(receiverId)) trustedCount++;
      }
      if (['SHELL', 'MULE'].includes(acc.account_type) || acc.is_flagged) suspiciousCount++;
    }
  }

  // ── New Beneficiaries ────────────────────────────────────────────────────────
  const newReceivers = uniqueReceivers.filter(r => !baseline.knownBeneficiaries.has(r));
  const newReceiverRatio = uniqueReceivers.length > 0 ? newReceivers.length / uniqueReceivers.length : 0;
  const newReceiversMatched = newReceiverRatio >= BEHAVIOUR.FAN_OUT_NEW_BENEFICIARY_RATIO;

  if (newReceiversMatched) {
    contribution += MODIFIERS.UNKNOWN_RECEIVERS;
    flags.push('UNKNOWN_RECEIVERS');
    reasons.push(
      `${newReceivers.length} of ${uniqueReceivers.length} receivers (${Math.round(newReceiverRatio * 100)}%) ` +
      `are first-time beneficiaries for this account.`
    );
  }

  // ── Equal Distribution Detection ─────────────────────────────────────────────
  const amounts = allWindowTxs.map(t => t.amount);
  const cv = coefficientOfVariation(amounts);
  let equalDistScore = 0;
  const equalDistMatched = cv < BEHAVIOUR.FAN_OUT_EQUAL_DISTRIBUTION_CV && amounts.length >= 5;

  if (equalDistMatched) {
    equalDistScore = 1;
    contribution += MODIFIERS.EQUAL_DISTRIBUTION;
    flags.push('EQUAL_DISTRIBUTION');
    reasons.push(
      `${amounts.length} transactions show near-equal distribution ` +
      `(coefficient of variation: ${(cv * 100).toFixed(2)}% — avg ₹${Math.round(amounts.reduce((s, v) => s + v, 0) / amounts.length).toLocaleString('en-IN')} each). ` +
      `Humans rarely split funds so precisely.`
    );
  }

  // ── Receiver Geographic Diversity ────────────────────────────────────────────
  const receiverCities = new Set();
  const receiverStates = new Set();

  for (const receiverId of uniqueReceivers) {
    const acc = accountMap[receiverId];
    if (acc?.geo_location?.city)  receiverCities.add(acc.geo_location.city);
    if (acc?.geo_location?.state) receiverStates.add(acc.geo_location.state);
  }

  const diversityScore = receiverStates.size / Math.max(uniqueReceivers.length, 1);
  const geoDiversityMatched = receiverStates.size >= 4;
  if (geoDiversityMatched) {
    contribution += 3;
    flags.push('RECEIVER_GEO_DIVERSITY');
    reasons.push(
      `Receivers span ${receiverStates.size} different states / ${receiverCities.size} cities ` +
      `(${[...receiverStates].join(', ')}). High geographic distribution.`
    );
  }

  // ── Fan-Out → Fan-In Reconvergence ──────────────────────────────────────────
  const downstreamReceiverIds = [];
  for (const receiverId of uniqueReceivers) {
    const downstreamTxs = allTx.filter(
      t => t.sender === receiverId &&
           new Date(t.timestamp).getTime() >= now &&
           new Date(t.timestamp).getTime() <= now + 2 * 60 * 60 * 1000 // 2 hours later
    );
    for (const dTx of downstreamTxs) {
      downstreamReceiverIds.push(dTx.receiver);
    }
  }

  let reconvergenceMatched = false;
  let reconvergenceTarget = '';
  if (downstreamReceiverIds.length >= 3) {
    const freqMap = {};
    for (const id of downstreamReceiverIds) freqMap[id] = (freqMap[id] || 0) + 1;
    const topConvergence = Object.entries(freqMap).sort((a, b) => b[1] - a[1])[0];

    if (topConvergence && topConvergence[1] >= Math.ceil(uniqueReceivers.length * 0.5)) {
      reconvergenceMatched = true;
      reconvergenceTarget = topConvergence[0];
      contribution += MODIFIERS.RECONVERGENCE;
      flags.push('FAN_OUT_FAN_IN_DETECTED');
      reasons.push(
        `Fan-Out → Fan-In pattern: funds dispersed to ${uniqueReceivers.length} receivers ` +
        `then reconverge to account ${topConvergence[0]} within 2 hours.`
      );
    }
  }

  // ── False Positive Reducers ──────────────────────────────────────────────────
  const mostlyTrustedMatched = (trustedCount / uniqueReceivers.length) > 0.70;
  if (mostlyTrustedMatched) {
    contribution += MODIFIERS.HISTORICAL_RECEIVER;
    flags.push('MOSTLY_TRUSTED_RECEIVERS');
    reasons.push(`Majority of receivers (${trustedCount}) are known historical beneficiaries. Risk reduced.`);
  }

  const suspiciousReceiversMatched = suspiciousCount > 0;
  if (suspiciousReceiversMatched) {
    contribution += Math.min(10, suspiciousCount * 5);
    flags.push('SUSPICIOUS_RECEIVERS_IN_FAN_OUT');
    reasons.push(`${suspiciousCount} receivers in the fan-out are flagged/SHELL/MULE type accounts.`);
  }

  reasons.unshift(
    `Fan-Out detected: account ${tx.sender} distributed funds to ` +
    `${uniqueReceivers.length} unique receivers within 30 minutes.`
  );

  traceChecks.push(
    {
      name: 'New / Unknown Receivers',
      description: `Identifies if the distribution target accounts are new to this sender (threshold: >= ${BEHAVIOUR.FAN_OUT_NEW_BENEFICIARY_RATIO * 100}%)`,
      matched: newReceiversMatched,
      scoreEffect: newReceiversMatched ? MODIFIERS.UNKNOWN_RECEIVERS : 0,
      details: `${newReceivers.length} first-time receivers out of ${uniqueReceivers.length}.`
    },
    {
      name: 'Equal Distribution Splits',
      description: 'Checks if transactions distribute almost equal amounts to different receivers (highly automated pattern)',
      matched: equalDistMatched,
      scoreEffect: equalDistMatched ? MODIFIERS.EQUAL_DISTRIBUTION : 0,
      details: `Coefficient of Variation: ${(cv * 100).toFixed(2)}% (threshold: < ${BEHAVIOUR.FAN_OUT_EQUAL_DISTRIBUTION_CV * 100}%).`
    },
    {
      name: 'Receiver Geographic Diversity Check',
      description: 'Reviews state/city dispersion of receivers',
      matched: geoDiversityMatched,
      scoreEffect: geoDiversityMatched ? 3 : 0,
      details: `Receivers located across ${receiverStates.size} states.`
    },
    {
      name: 'Fan-Out Fan-In Reconvergence',
      description: 'Traces downstream transactions to detect if dispersed funds aggregate back to a single node',
      matched: reconvergenceMatched,
      scoreEffect: reconvergenceMatched ? MODIFIERS.RECONVERGENCE : 0,
      details: reconvergenceMatched ? `Funds gathered back to ${reconvergenceTarget} within 2 hours.` : 'No reconvergence detected.'
    },
    {
      name: 'Mostly Trusted Receivers Mitigator',
      description: 'Reduces risk score if the majority of receivers are historical trusted targets',
      matched: mostlyTrustedMatched,
      scoreEffect: mostlyTrustedMatched ? MODIFIERS.HISTORICAL_RECEIVER : 0,
      details: `${trustedCount} trusted receivers detected.`
    },
    {
      name: 'Flagged Receiver Penalty',
      description: 'Increases risk if any receiver is a known Shell/Mule or previously flagged account',
      matched: suspiciousReceiversMatched,
      scoreEffect: suspiciousReceiversMatched ? Math.min(10, suspiciousCount * 5) : 0,
      details: `Flagged/Shell receivers found: ${suspiciousCount}.`
    }
  );

  const finalContribution = Math.min(CONFIG.FAN_OUT_MAX, Math.max(0, contribution));

  const trace = {
    ruleName: 'FAN_OUT',
    enabled: true,
    score: finalContribution,
    rawScore: contribution,
    maxPossibleScore: CONFIG.FAN_OUT_MAX,
    checks: traceChecks
  };

  const features = {
    fan_out_risk_score:       finalContribution,
    unique_receiver_count:    uniqueReceivers.length,
    new_receiver_count:       newReceivers.length,
    new_receiver_ratio:       parseFloat(newReceiverRatio.toFixed(3)),
    equal_distribution_score: equalDistScore,
    receiver_diversity_score: parseFloat(diversityScore.toFixed(3)),
    receiver_state_count:     receiverStates.size,
    suspicious_receiver_count:suspiciousCount,
    trusted_receiver_count:   trustedCount,
    reconvergence_detected:   flags.includes('FAN_OUT_FAN_IN_DETECTED') ? 1 : 0,
  };

  return {
    ruleName: 'FAN_OUT',
    riskContribution: finalContribution,
    flags: [...new Set(flags)],
    reasons,
    features,
    trace,
  };
}

/** Coefficient of variation */
function coefficientOfVariation(amounts) {
  if (amounts.length < 2) return 1;
  const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
  if (mean === 0) return 1;
  const variance = amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / amounts.length;
  return Math.sqrt(variance) / mean;
}

module.exports = { checkFanOut };
