/**
 * RULE 6 — MULE RISK DETECTOR
 *
 * Detects accounts behaviorally acting as money mules.
 * Banks cannot identify mules on account creation —
 * instead they compute a Mule Risk Score from behavioral signals:
 *
 *   Signal                                   | Score | Flag
 *   ──────────────────────────────────────── | ───── | ──────────────────────────────────
 *   Receives money from many unrelated people  | +20   | MULE_MANY_UNRELATED_SENDERS
 *   Forwards almost all money within minutes   | +20   | MULE_PASS_THROUGH
 *   Maintains very low balance                 | +10   | MULE_LOW_BALANCE
 *   Many first-time / one-time senders         | +15   | MULE_FIRST_TIME_SENDERS
 *   Already involved in previous alerts        | +20   | MULE_PRIOR_ALERT_HISTORY
 *   Low KYC verification level                 | +10   | MULE_LOW_KYC
 *
 * Score bands:
 *   ≥25  → MULE_RISK_MEDIUM
 *   ≥55  → MULE_RISK_HIGH
 *   Max  → 95 (hard cap — mule rule alone cannot auto-trigger CRITICAL)
 *
 * Exports (2):
 *   checkMuleRisk(tx, allTx, allAccounts, allAlerts, baseline)
 *     Full rule — evaluates the RECEIVER of tx as a potential mule.
 *     Returns the standard { ruleName, riskContribution, flags, reasons, features } output.
 *
 *   computeMuleScore(accountId, allTx, allAccounts, allAlerts)  ← cross-rule helper
 *     Lightweight scorer — returns only the raw 0–95 number for any account.
 *     Imported by other rules to amplify their own detection:
 *       • layeringRule    — amplifies hops through mule-probability accounts
 *                           and flags mule-destination at chain end
 *       • dormantRule     — flags behavioural-mule senders (even if not re-classified in DB)
 *       • structuringRule — amplifies MANY_TO_ONE_CONVERGENCE when target is a probable mule
 *
 * Returns: { ruleName, riskContribution, flags, reasons, features }
 */

'use strict';

const { BEHAVIOUR } = require('../config/riskWeights');

// ── Tuneable Thresholds ───────────────────────────────────────────────────────
// ── Tuneable Thresholds ───────────────────────────────────────────────────────
// MULE thresholds are now resolved dynamically from the config service.

/**
 * checkMuleRisk
 *
 * @param {Object}   tx           - the transaction being evaluated (the receiver is the potential mule)
 * @param {Object[]} allTx        - all transactions in memory
 * @param {Object[]} allAccounts  - all accounts in memory
 * @param {Object[]} allAlerts    - all alerts in memory
 * @param {Object}   baseline     - from behaviourBaseline.buildBaseline() for the *receiver*
 * @returns {{ ruleName, riskContribution, flags, reasons, features }}
 */
function checkMuleRisk(tx, allTx, allAccounts, allAlerts, baseline) {
  const configService = require('../config/riskWeights');
  const CONFIG = configService.get();
  const { RULE_STATES, MULE } = CONFIG;

  if (RULE_STATES && RULE_STATES.MULE_RISK === false) {
    return {
      ruleName: 'MULE_RISK',
      riskContribution: 0,
      flags: [],
      reasons: [],
      features: { mule_risk_score: 0 },
      trace: { ruleName: 'MULE_RISK', enabled: false, score: 0, checks: [] }
    };
  }

  const flags   = [];
  const reasons = [];
  let muleScore = 0;

  const potentialMuleId = tx.receiver; // The receiver of this transaction is the suspected mule
  const now             = new Date(tx.timestamp).getTime();
  const windowStart     = now - MULE.LOOK_BACK_WINDOW_MS;

  // ── Lookup receiver account ─────────────────────────────────────────────────
  const muleAccount = allAccounts.find(a => a.account_id === potentialMuleId) || null;

  // ── All inbound transactions to the potential mule in the look-back window ──
  const inboundTxs = allTx.filter(
    t => t.receiver === potentialMuleId &&
         new Date(t.timestamp).getTime() >= windowStart
  );
  // Include current tx as inbound
  const allInbound = [...inboundTxs, tx];

  // ── All outbound transactions from the potential mule ─────────────────────
  const outboundTxs = allTx.filter(
    t => t.sender === potentialMuleId
  );

  // ── SIGNAL 1: Receives money from many unrelated people ──────────────────────
  const uniqueInboundSenders = new Set(allInbound.map(t => t.sender));
  uniqueInboundSenders.delete(potentialMuleId);
  const inboundSenderCount = uniqueInboundSenders.size;
  const signalManySenders = inboundSenderCount >= MULE.MIN_UNIQUE_SENDERS;

  if (signalManySenders) {
    muleScore += MULE.SCORE_MANY_UNRELATED_SENDERS;
    flags.push('MULE_MANY_UNRELATED_SENDERS');
    reasons.push(
      `Account ${potentialMuleId} received funds from ${inboundSenderCount} distinct senders ` +
      `in the last 24 hours — a classic mule aggregation pattern.`
    );
  }

  // ── SIGNAL 2: Forwards almost all money within minutes ───────────────────────
  const totalReceived  = allInbound.reduce((s, t) => s + (t.amount || 0), 0);

  const rapidForwards  = outboundTxs.filter(t => {
    const outTime = new Date(t.timestamp).getTime();
    return allInbound.some(inTx => {
      const inTime = new Date(inTx.timestamp).getTime();
      return outTime >= inTime && (outTime - inTime) <= MULE.FORWARD_WINDOW_MS;
    });
  });

  const totalRapidlySent = rapidForwards.reduce((s, t) => s + (t.amount || 0), 0);
  const forwardRatio     = totalReceived > 0 ? totalRapidlySent / totalReceived : 0;
  const signalPassThrough = forwardRatio >= MULE.FORWARD_RATIO_SUSPICIOUS;

  if (signalPassThrough) {
    muleScore += MULE.SCORE_PASS_THROUGH;
    flags.push('MULE_PASS_THROUGH');
    reasons.push(
      `Account ${potentialMuleId} rapidly forwarded ${(forwardRatio * 100).toFixed(0)}% ` +
      `(₹${Math.round(totalRapidlySent).toLocaleString('en-IN')}) of received funds ` +
      `(₹${Math.round(totalReceived).toLocaleString('en-IN')}) within 60 minutes of receipt.`
    );
  }

  // ── SIGNAL 3: Maintains very low balance ──────────────────────────────────
  const currentBalance = muleAccount?.balance ?? muleAccount?.current_balance ?? null;
  const signalLowBalance = currentBalance !== null && currentBalance <= MULE.LOW_BALANCE_THRESHOLD_INR;

  if (signalLowBalance) {
    muleScore += MULE.SCORE_LOW_BALANCE;
    flags.push('MULE_LOW_BALANCE');
    reasons.push(
      `Account ${potentialMuleId} maintains an extremely low balance ` +
      `(₹${currentBalance.toLocaleString('en-IN')}), consistent with funds being fully drained.`
    );
  }

  // ── SIGNAL 4: Many first-time / one-time senders ─────────────────────────────
  const firstTimeSenders = [...uniqueInboundSenders].filter(senderId => {
    const totalSentToMule = allTx.filter(
      t => t.sender === senderId && t.receiver === potentialMuleId
    ).length;
    return totalSentToMule <= 1;
  });

  const firstTimeSenderRatio = inboundSenderCount > 0
    ? firstTimeSenders.length / inboundSenderCount
    : 0;
  const signalFirstTimeSenders = inboundSenderCount > 0 && firstTimeSenderRatio >= MULE.FIRST_TIME_SENDER_RATIO;

  if (signalFirstTimeSenders) {
    muleScore += MULE.SCORE_FIRST_TIME_SENDERS;
    flags.push('MULE_FIRST_TIME_SENDERS');
    reasons.push(
      `${firstTimeSenders.length} of ${inboundSenderCount} ` +
      `(${Math.round(firstTimeSenderRatio * 100)}%) senders to account ${potentialMuleId} ` +
      `have never transacted with this account before — characteristic of a mule receiver network.`
    );
  }

  // ── SIGNAL 5: Already involved in previous alerts ────────────────────────────
  const priorAlerts = allAlerts.filter(
    a => a.account_references?.includes(potentialMuleId) ||
         a.tx_references?.some(txId =>
           allTx.find(t => t.tx_id === txId && (t.sender === potentialMuleId || t.receiver === potentialMuleId))
         )
  );
  const signalPriorAlerts = priorAlerts.length > 0;

  if (signalPriorAlerts) {
    muleScore += MULE.SCORE_PRIOR_ALERTS;
    flags.push('MULE_PRIOR_ALERT_HISTORY');
    reasons.push(
      `Account ${potentialMuleId} is referenced in ${priorAlerts.length} previous alert(s): ` +
      `[${priorAlerts.slice(0, 3).map(a => a.alert_id).join(', ')}` +
      `${priorAlerts.length > 3 ? ` +${priorAlerts.length - 3} more` : ''}].`
    );
  }

  // ── SIGNAL 6: Low KYC verification ─────────────────────────────────────────
  const kycLevel = muleAccount?.kyc_level || null;
  const signalLowKyc = kycLevel === 'LOW' || kycLevel === null;

  if (signalLowKyc) {
    muleScore += MULE.SCORE_LOW_KYC;
    flags.push('MULE_LOW_KYC');
    reasons.push(
      `Account ${potentialMuleId} has ${kycLevel === null ? 'unverified' : 'LOW'} KYC level. ` +
      `Mule accounts frequently use minimal identity verification to avoid detection.`
    );
  }

  // ── Composite Risk Band ──────────────────────────────────────────────────────
  if (muleScore >= MULE.MULE_SCORE_HIGH) {
    flags.push('MULE_RISK_HIGH');
  } else if (muleScore >= MULE.MULE_SCORE_MEDIUM) {
    flags.push('MULE_RISK_MEDIUM');
  }

  const finalContribution = Math.min(muleScore, MULE.MAX_CONTRIBUTION);

  const signalsFired = [
    signalManySenders,
    signalPassThrough,
    signalLowBalance,
    signalFirstTimeSenders,
    signalPriorAlerts,
    signalLowKyc,
  ].filter(Boolean).length;

  if (flags.length > 0) {
    reasons.unshift(
      `Mule Risk Score: ${muleScore}/95 — ${signalsFired} of 6 behavioral signal(s) triggered ` +
      `for account ${potentialMuleId}.`
    );
  }

  const trace = {
    ruleName: 'MULE_RISK',
    enabled: true,
    score: finalContribution,
    rawScore: muleScore,
    maxPossibleScore: MULE.MAX_CONTRIBUTION,
    checks: [
      {
        name: 'Inbound Aggregation (Many senders)',
        description: `Triggered if unique sender count >= ${MULE.MIN_UNIQUE_SENDERS} within 24h`,
        matched: signalManySenders,
        scoreEffect: signalManySenders ? MULE.SCORE_MANY_UNRELATED_SENDERS : 0,
        details: `Found ${inboundSenderCount} distinct senders (threshold: >= ${MULE.MIN_UNIQUE_SENDERS}).`
      },
      {
        name: 'Outbound Velocity Pass-Through',
        description: `Triggered if outbound transfer ratio >= ${MULE.FORWARD_RATIO_SUSPICIOUS * 100}% within ${MULE.FORWARD_WINDOW_MS / 60000} mins`,
        matched: signalPassThrough,
        scoreEffect: signalPassThrough ? MULE.SCORE_PASS_THROUGH : 0,
        details: `Forwarded ${Math.round(forwardRatio * 100)}% of funds (₹${Math.round(totalRapidlySent).toLocaleString()} / ₹${Math.round(totalReceived).toLocaleString()}).`
      },
      {
        name: 'Low Balance Retention',
        description: `Checks if residual balance is <= ₹${MULE.LOW_BALANCE_THRESHOLD_INR} INR`,
        matched: signalLowBalance,
        scoreEffect: signalLowBalance ? MULE.SCORE_LOW_BALANCE : 0,
        details: `Current account balance: ₹${currentBalance?.toLocaleString() || 'N/A'}.`
      },
      {
        name: 'One-Time Senders Pattern',
        description: `Checks if first-time senders ratio >= ${MULE.FIRST_TIME_SENDER_RATIO * 100}%`,
        matched: signalFirstTimeSenders,
        scoreEffect: signalFirstTimeSenders ? MULE.SCORE_FIRST_TIME_SENDERS : 0,
        details: `Ratio: ${Math.round(firstTimeSenderRatio * 100)}% (${firstTimeSenders.length} of ${inboundSenderCount}).`
      },
      {
        name: 'Alert History Cross-Check',
        description: 'Traces if the recipient account was flagged in past AML investigations',
        matched: signalPriorAlerts,
        scoreEffect: signalPriorAlerts ? MULE.SCORE_PRIOR_ALERTS : 0,
        details: `Involved in ${priorAlerts.length} past incident reports.`
      },
      {
        name: 'Low KYC Profile Level',
        description: 'Checks if receiver account has Low or Unverified KYC validation status',
        matched: signalLowKyc,
        scoreEffect: signalLowKyc ? MULE.SCORE_LOW_KYC : 0,
        details: `Profile KYC tier: ${kycLevel || 'UNVERIFIED'}.`
      }
    ]
  };

  const features = {
    mule_risk_score:             finalContribution,
    unique_inbound_sender_count: inboundSenderCount,
    rapid_forward_ratio:         parseFloat(forwardRatio.toFixed(3)),
    current_balance:             currentBalance ?? -1,
    first_time_sender_ratio:     parseFloat(firstTimeSenderRatio.toFixed(3)),
    prior_alert_count:           priorAlerts.length,
    kyc_level_numeric:           kycLevel === 'HIGH' ? 2 : kycLevel === 'MEDIUM' ? 1 : 0,
    signals_fired:               signalsFired,
  };

  return {
    ruleName: 'MULE_RISK',
    riskContribution: finalContribution,
    flags: [...new Set(flags)],
    reasons,
    features,
    trace,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Helper — computeMuleScore
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string}   accountId    - the account to score as a potential mule
 * @param {Object[]} allTx        - all transactions in memory
 * @param {Object[]} allAccounts  - all accounts in memory
 * @param {Object[]} allAlerts    - all alerts in memory
 * @returns {number}              - mule score 0–95
 */
function computeMuleScore(accountId, allTx, allAccounts, allAlerts) {
  if (!accountId) return 0;

  const configService = require('../config/riskWeights');
  const CONFIG = configService.get();
  const { MULE } = CONFIG;

  const account      = allAccounts.find(a => a.account_id === accountId) || null;
  const now          = Date.now();
  const windowStart  = now - MULE.LOOK_BACK_WINDOW_MS;

  let score = 0;

  // Signal 1: Many unique inbound senders in 24h
  const inboundTxs = allTx.filter(
    t => t.receiver === accountId && new Date(t.timestamp).getTime() >= windowStart
  );
  const uniqueSenders = new Set(inboundTxs.map(t => t.sender));
  uniqueSenders.delete(accountId);
  if (uniqueSenders.size >= MULE.MIN_UNIQUE_SENDERS) {
    score += MULE.SCORE_MANY_UNRELATED_SENDERS;
  }

  // Signal 2: Pass-through (rapid forwarding ≥85% of received)
  const totalReceived = inboundTxs.reduce((s, t) => s + (t.amount || 0), 0);
  if (totalReceived > 0) {
    const outboundTxs = allTx.filter(t => t.sender === accountId);
    const rapidlySent = outboundTxs
      .filter(outTx => {
        const outTime = new Date(outTx.timestamp).getTime();
        return inboundTxs.some(inTx => {
          const inTime = new Date(inTx.timestamp).getTime();
          return outTime >= inTime && (outTime - inTime) <= MULE.FORWARD_WINDOW_MS;
        });
      })
      .reduce((s, t) => s + (t.amount || 0), 0);

    if (rapidlySent / totalReceived >= MULE.FORWARD_RATIO_SUSPICIOUS) {
      score += MULE.SCORE_PASS_THROUGH;
    }
  }

  // Signal 3: Very low account balance
  const balance = account?.balance ?? account?.current_balance ?? null;
  if (balance !== null && balance <= MULE.LOW_BALANCE_THRESHOLD_INR) {
    score += MULE.SCORE_LOW_BALANCE;
  }

  // Signal 4: High first-time-sender ratio
  const senderCount = uniqueSenders.size;
  if (senderCount > 0) {
    const firstTimers = [...uniqueSenders].filter(sid =>
      allTx.filter(t => t.sender === sid && t.receiver === accountId).length <= 1
    ).length;
    if (firstTimers / senderCount >= MULE.FIRST_TIME_SENDER_RATIO) {
      score += MULE.SCORE_FIRST_TIME_SENDERS;
    }
  }

  // Signal 5: Referenced in prior alerts
  const inAlerts = allAlerts.some(
    a => a.account_references?.includes(accountId)
  );
  if (inAlerts) score += MULE.SCORE_PRIOR_ALERTS;

  // Signal 6: Low/unverified KYC
  const kyc = account?.kyc_level || null;
  if (kyc === 'LOW' || kyc === null) score += MULE.SCORE_LOW_KYC;

  return Math.min(score, MULE.MAX_CONTRIBUTION);
}

module.exports = { checkMuleRisk, computeMuleScore };
