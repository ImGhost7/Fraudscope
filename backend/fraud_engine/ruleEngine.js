/**
 * Fraudscope AI — Redesigned Rule-Based Fraud Detection Engine  (v2.1)
 * ─────────────────────────────────────────────────────────────────────
 *
 * Architecture:
 *   Each rule is an independent module in /rules/.
 *   Each rule returns a standardized output:
 *     { ruleName, riskContribution, flags, reasons, features }
 *
 *   Shared services in /services/ provide:
 *     - behaviourBaseline   → per-customer historical profile
 *     - receiverReputation  → dynamic trust score for any beneficiary
 *     - geoRisk             → geographic anomaly scoring
 *     - globalRiskScorer    → aggregates all rule outputs
 *
 *   The final output contains:
 *     - finalScore (0–100)
 *     - riskLevel (LOW / MEDIUM / HIGH / CRITICAL)
 *     - action (recommended investigator action)
 *     - allFlags (array of reason codes)
 *     - explanation (human-readable alert detail)
 *     - mlFeatures (rich feature vector for the ML layer)
 *
 * Rules (6 total):
 *   1. structuringRule   — near-threshold patterns, convergence, frequency bursts
 *   2. layeringRule      — multi-hop fund obfuscation chains, circular detection
 *   3. fanOutRule        — rapid fund dispersal to many receivers
 *   4. dormantRule       — suspicious reactivation of long-inactive accounts
 *   5. velocityRule      — burst activity vs. historical baseline
 *   6. muleRiskRule      — behavioural money-mule detection (6 signals)
 *
 * Cross-Rule Mule Probability Wiring (v2.1):
 *   muleRiskRule exports computeMuleScore(accountId) — a lightweight helper
 *   that scores any account 0–95 based on the 6 mule signals.
 *   This score is consumed by three other rules to amplify their own risk:
 *
 *     layeringRule:
 *       • Each hop node is scored — mule hops raise contribution by +5 (MEDIUM)
 *         or +12 (HIGH) above the base SHELL_ACCOUNT_HOP weight
 *       • Chain destination scored — +10 if HIGH mule (LAYERING_DESTINATION_IS_MULE)
 *
 *     dormantRule:
 *       • Sender mule score ≥25 triggers ACTIVATED_BY_SUSPICIOUS_SENDER even if
 *         account_type is not yet 'MULE' in the DB (catches unclassified mules)
 *       • sender_mule_score exposed as an ML feature
 *
 *     structuringRule:
 *       • After MANY_TO_ONE_CONVERGENCE fires, receiver mule score amplifies:
 *         score 25–54 → +8 (CONVERGENCE_TO_MULE_MEDIUM)
 *         score 55+   → +15 (CONVERGENCE_TO_MULE_HIGH)
 *       • receiver_mule_score exposed as an ML feature
 *
 * Key Design Principles:
 *   1. No single rule triggers a HIGH alert alone
 *   2. Behaviour > Amount thresholds
 *   3. Every alert is fully explainable
 *   4. Salary / utility / known-beneficiary patterns reduce risk
 *   5. Modular — add new rules without touching existing ones
 *   6. Cross-rule signals compound: mule probability amplifies layering,
 *      dormant activation, and structuring convergence detectors
 *
 * Compatible with:
 *   - mock-server.js (in-memory arrays)
 *   - server.js + MongoDB (passes allTx / allAccounts from DB)
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

// ── Config ──────────────────────────────────────────────────────────────────
const { RISK_LEVELS } = require('./config/riskWeights');

// ── Services ─────────────────────────────────────────────────────────────────
const { buildBaseline } = require('./services/behaviourBaseline');
const { getReceiverReputation } = require('./services/receiverReputation');
const { evaluateGeoRisk } = require('./services/geoRisk');
const { aggregate } = require('./services/globalRiskScorer');

// ── Rule Modules ─────────────────────────────────────────────────────────────
const { checkStructuring } = require('./rules/structuringRule');  // Rule 1 — now mule-aware (convergence amplification)
const { checkLayering } = require('./rules/layeringRule');          // Rule 2 — now mule-aware (hop + destination scoring)
const { checkFanOut } = require('./rules/fanOutRule');              // Rule 3
const { checkDormantActivation } = require('./rules/dormantRule'); // Rule 4 — now mule-aware (behavioural sender check)
const { checkVelocity } = require('./rules/velocityRule');          // Rule 5
const { checkMuleRisk } = require('./rules/muleRiskRule');          // Rule 6 — provides computeMuleScore to Rules 1,2,4

// ─────────────────────────────────────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runFraudEngine
 *
 * Orchestrates all 6 rule modules and the mule cross-rule amplification layer.
 * Evaluation order:
 *   1. Build sender behavioural baseline
 *   2. Evaluate receiver reputation
 *   3. Evaluate geographic risk
 *   4. Run rules 1–6 (structuring, layering, fanOut, dormant, velocity, muleRisk)
 *      Rules 1, 2, 4 internally call computeMuleScore() to amplify their own
 *      contribution when they involve high-probability mule accounts.
 *   5. Aggregate all rule outputs via globalRiskScorer
 *   6. Emit alert + socket event if finalScore ≥ 30
 *
 * @param {Object}   tx          - the transaction being evaluated
 * @param {Object}   context     - { allTx, allAccounts, allAlerts, io }
 *                                 allTx / allAccounts / allAlerts = in-memory arrays
 *                                 io = socket.io instance (optional)
 * @returns {Object} result      - { finalScore, riskLevel, action, explanation, mlFeatures, allFlags }
 */
async function runFraudEngine(tx, context = {}) {
  const { allTx = [], allAccounts = [], allAlerts = [], io = null } = context;

  const configService = require('./config/riskWeights');
  const CONFIG = configService.get();
  const { RULE_STATES } = CONFIG;

  try {
    // ── 1. Lookup accounts ──────────────────────────────────────────────────
    const senderAccount = allAccounts.find(a => a.account_id === tx.sender) || null;
    const receiverAccount = allAccounts.find(a => a.account_id === tx.receiver) || null;

    // ── 2. Build Behavioural Baseline for Sender ────────────────────────────
    const baseline = buildBaseline(tx.sender, allTx);

    // ── 3. Receiver Reputation ──────────────────────────────────────────────
    const receiverRep = getReceiverReputation(
      tx.receiver, receiverAccount, allTx, allAlerts
    );

    // ── 4. Geographic Risk ──────────────────────────────────────────────────
    const recentFromSender = allTx
      .filter(t => t.sender === tx.sender && t.tx_id !== tx.tx_id)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 5);

    const knownCities = new Set(
      recentFromSender.map(t => t.geo_origin?.city).filter(Boolean)
    );

    const geoResult = evaluateGeoRisk(tx, recentFromSender, knownCities);

    // ── 5. Run All Rules ────────────────────────────────────────────────────
    const structuringResult = checkStructuring(tx, allTx, baseline, allAccounts, allAlerts);
    const layeringResult = checkLayering(tx, allTx, allAccounts, allAlerts);
    const fanOutResult = checkFanOut(tx, allTx, allAccounts, baseline);
    const dormantResult = checkDormantActivation(tx, receiverAccount, senderAccount, allTx, allAlerts, allAccounts);
    const velocityResult = checkVelocity(tx, allTx, baseline);
    const muleRiskResult = checkMuleRisk(tx, allTx, allAccounts, allAlerts, baseline);

    // ── 6. Receiver Reputation as a Rule Result ─────────────────────────────
    const receiverRiskEnabled = RULE_STATES.RECEIVER_RISK !== false;
    const receiverRiskContribution = receiverRiskEnabled ? (
      receiverRep.score >= 80 ? 15 :
        receiverRep.score >= 60 ? 8 :
          receiverRep.score >= 40 ? 3 : -5
    ) : 0;

    const receiverRiskResult = {
      ruleName: 'RECEIVER_RISK',
      riskContribution: receiverRiskContribution,
      flags: receiverRiskEnabled ? receiverRep.flags : [],
      reasons: receiverRiskEnabled && receiverRep.flags.length > 0
        ? [`Receiver ${tx.receiver} reputation score: ${receiverRep.score}/100 (${receiverRep.label}). ` +
          `Flags: ${receiverRep.flags.join(', ')}.`]
        : [],
      features: {
        receiver_reputation_score: receiverRep.score,
        receiver_is_mule: receiverRep.flags.includes('RECEIVER_IS_MULE') ? 1 : 0,
        receiver_is_shell: receiverRep.flags.includes('RECEIVER_IS_SHELL') ? 1 : 0,
        receiver_is_flagged: receiverRep.flags.includes('RECEIVER_PREVIOUSLY_FLAGGED') ? 1 : 0,
        receiver_kyc_low: receiverRep.flags.includes('RECEIVER_LOW_KYC') ? 1 : 0,
      },
      trace: {
        ruleName: 'RECEIVER_RISK',
        enabled: receiverRiskEnabled,
        score: receiverRiskContribution,
        maxPossibleScore: CONFIG.RECEIVER_RISK_MAX,
        checks: [
          {
            name: 'Receiver Reputation Score',
            description: 'Analyzes history and KYC level of the receiving account',
            matched: receiverRep.score >= 40,
            scoreEffect: receiverRiskContribution,
            details: `Reputation score: ${receiverRep.score}/100 (${receiverRep.label}). Flags: ${receiverRep.flags.join(', ') || 'None'}`
          }
        ]
      }
    };

    // ── 7. Geo as a Rule Result ─────────────────────────────────────────────
    const geoRiskEnabled = RULE_STATES.GEO_RISK !== false;
    const geoRiskContribution = geoRiskEnabled ? geoResult.riskContribution : 0;

    const geoRuleResult = {
      ruleName: 'GEO_RISK',
      riskContribution: geoRiskContribution,
      flags: geoRiskEnabled ? geoResult.flags : [],
      reasons: geoRiskEnabled ? geoResult.reasons : [],
      features: {
        geo_risk_score: geoResult.riskContribution,
        is_sanctioned_country: geoResult.flags.includes('SANCTIONED_COUNTRY') ? 1 : 0,
        is_high_risk_country: geoResult.flags.includes('HIGH_RISK_COUNTRY') ? 1 : 0,
        is_new_city: geoResult.flags.includes('NEW_CITY_FIRST_TIME') ? 1 : 0,
        impossible_travel: geoResult.flags.includes('IMPOSSIBLE_TRAVEL') ? 1 : 0,
      },
      trace: {
        ruleName: 'GEO_RISK',
        enabled: geoRiskEnabled,
        score: geoRiskContribution,
        maxPossibleScore: CONFIG.GEO_RISK_MAX,
        checks: [
          {
            name: 'Geographic Anomaly Check',
            description: 'Identifies geographical risk patterns, sanctioned nations, and impossible speed-of-travel anomalies',
            matched: geoRiskContribution > 0,
            scoreEffect: geoRiskContribution,
            details: geoResult.reasons.join(', ') || 'No geographical risk flagged.'
          }
        ]
      }
    };

    // ── 8. Aggregate via Global Scorer ──────────────────────────────────────
    const allRuleResults = [
      structuringResult,
      layeringResult,
      fanOutResult,
      dormantResult,
      velocityResult,
      muleRiskResult,
      receiverRiskResult,
      geoRuleResult,
    ];

    const aggregated = aggregate(allRuleResults);
    aggregated.traces = allRuleResults.map(r => r.trace).filter(Boolean);

    // Enrich ML features with sender/receiver profile data
    aggregated.mlFeatures = {
      ...aggregated.mlFeatures,
      // Transaction basics
      tx_amount: tx.amount,
      log_amount: Math.log1p(tx.amount),
      is_round_amount: tx.amount % 1000 === 0 ? 1 : 0,
      hour_of_day: new Date(tx.timestamp).getHours(),
      day_of_week: new Date(tx.timestamp).getDay(),
      // Sender profile
      sender_tx_count: senderAccount?.tx_count || 0,
      sender_total_out: senderAccount?.total_outgoing || 0,
      sender_risk_score: senderAccount?.risk_score || 0,
      sender_kyc: senderAccount ? { LOW: 0, MEDIUM: 1, HIGH: 2 }[senderAccount.kyc_level] || 1 : 1,
      days_since_sender_active: senderAccount
        ? Math.floor((Date.now() - new Date(senderAccount.last_active).getTime()) / 86400000)
        : 0,
      // Receiver profile
      receiver_tx_count: receiverAccount?.tx_count || 0,
      receiver_total_in: receiverAccount?.total_incoming || 0,
      // Baseline
      has_baseline: baseline.hasHistory ? 1 : 0,
      baseline_avg_daily_amount: Math.round(baseline.avgDailyAmount),
      baseline_avg_daily_count: parseFloat(baseline.avgDailyCount.toFixed(2)),
      // Final engine score
      rule_engine_score: aggregated.finalScore,
    };

    // ── 9. Persist & Emit if suspicious ────────────────────────────────────
    const isSuspicious = aggregated.finalScore >= 30; // MEDIUM or above

    if (isSuspicious) {
      // Update transaction in-memory record
      tx.anomaly_flag = true;
      tx.rule_flags = aggregated.allFlags;
      tx.risk_score = aggregated.finalScore;
      tx.fraud_type = pickPrimaryFraudType(aggregated.allFlags);
      tx.status = 'FLAGGED';
      tx.ml_features = aggregated.mlFeatures;
      tx.explanation = aggregated.explanation;

      // Update sender account risk
      if (senderAccount) {
        senderAccount.is_flagged = aggregated.finalScore >= 60;
        senderAccount.risk_score = Math.min(100, (senderAccount.risk_score || 0) + Math.round(aggregated.finalScore / 10));
      }

      // Build alert record
      if (aggregated.finalScore >= 30) {
        const alert = {
          _id: uuidv4(),
          alert_id: `ALT-${tx.fraud_type.slice(0, 3)}-${uuidv4().slice(0, 8).toUpperCase()}`,
          alert_type: tx.fraud_type,
          severity: aggregated.riskLevel,
          risk_score: aggregated.finalScore,
          status: 'OPEN',
          tx_references: [tx.tx_id],
          account_references: [...new Set([tx.sender, tx.receiver])],
          description: aggregated.explanation.summary,
          metadata: {
            explanation: aggregated.explanation,
            ml_features: aggregated.mlFeatures,
            rule_flags: aggregated.allFlags,
            reason_codes: aggregated.explanation.reasonCodes,
            reasons: aggregated.explanation.detailedReasons,
            recommended: aggregated.action,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        if (io) io.emit('new_alert', alert);
        if (io) io.emit('transaction_flagged', tx);

        return {
          ...aggregated,
          alert,
          isSuspicious: true,
        };
      }
    }

    return {
      ...aggregated,
      isSuspicious,
    };

  } catch (err) {
    console.error('[FraudEngine] Error:', err.message);
    return {
      finalScore: 0,
      riskLevel: 'LOW',
      action: 'No Action',
      allFlags: [],
      explanation: { summary: 'Engine error — transaction not scored', detailedReasons: [err.message] },
      mlFeatures: {},
      isSuspicious: false,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: pick the primary fraud type label from flags
// ─────────────────────────────────────────────────────────────────────────────
function pickPrimaryFraudType(flags) {
  if (!flags || flags.length === 0) return 'NONE';
  const priority = [
    'CIRCULAR_TRANSACTION',
    'FAN_OUT_FAN_IN_DETECTED',
    'LAYERING',
    'STRUCTURING',
    'FAN_OUT',
    'DORMANT_ACTIVATION',
    'MULE_RISK_HIGH',
    'MULE_RISK_MEDIUM',
    'MULE_BEHAVIOUR',
    'VELOCITY_BURST_COUNT',
    'GEO_RISK',
  ];
  for (const p of priority) {
    if (flags.some(f => f.includes(p))) return p;
  }
  return flags[0] || 'ANOMALY';
}

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compatible wrapper for mock-server.js (in-memory mode)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * detectFraud — replaces the old detectFraud(tx) used in mock-server.js
 *
 * @param {Object}   tx          - transaction being evaluated
 * @param {Object}   db          - { accounts, transactions, alerts } in-memory store
 * @param {Object}   io          - socket.io instance
 * @returns {Object}             - { flags, riskScore, explanation, mlFeatures }
 */
async function detectFraud(tx, db, io) {
  const result = await runFraudEngine(tx, {
    allTx: db.transactions || [],
    allAccounts: db.accounts || [],
    allAlerts: db.alerts || [],
    io,
  });

  // Push alert into db.alerts if generated
  if (result.alert) {
    db.alerts.unshift(result.alert);
    if (db.alerts.length > 500) db.alerts.pop();
  }

  return {
    flags: result.allFlags,
    riskScore: result.finalScore,
    riskLevel: result.riskLevel,
    explanation: result.explanation,
    mlFeatures: result.mlFeatures,
    action: result.action,
  };
}

module.exports = { runFraudEngine, detectFraud };
