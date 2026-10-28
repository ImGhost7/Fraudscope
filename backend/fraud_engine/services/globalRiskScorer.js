/**
 * GlobalRiskScorer Service
 *
 * Aggregates all rule contributions into one final Risk Score (0-100).
 *
 * KEY DESIGN CHANGE (v2.1):
 *   Each rule has a configurable MAX contribution so that a single rule
 *   (e.g. layering with 4 compounding modifiers at +15 each = 60pts)
 *   cannot alone push the score into HIGH/CRITICAL.
 *   Multiple independent signals are required to reach HIGH/CRITICAL.
 *
 * Also produces per-rule breakdown for AML investigators in the alert
 * dashboard's explanation panel.
 */

'use strict';

const { RISK_LEVELS } = require('../config/riskWeights');

// Per-rule contribution caps — mirrors riskWeights.js _MAX constants.
// FAST_HOP_TIME fires per-hop, so without a cap layering can produce
// 4 hops x (+15 + +12) = 108 from a single rule alone. Cap prevents this.
const RULE_CAPS = {
  STRUCTURING:          40,
  LAYERING:             45,
  FAN_OUT:              35,
  DORMANT_ACTIVATION:   30,
  VELOCITY:             25,
  RECEIVER_RISK:        20,
  GEO_RISK:             20,
};

/**
 * @param {Object[]} ruleResults  - array of { ruleName, riskContribution, flags, reasons, features }
 * @returns {{ finalScore, riskLevel, action, allFlags, allReasons, mlFeatures, explanation }}
 */
function aggregate(ruleResults) {
  let total = 0;
  const allFlags = [];
  const allReasons = [];
  const mlFeatures = {};
  const ruleBreakdown = [];

  for (const result of ruleResults) {
    const raw = result.riskContribution || 0;
    // Apply per-rule cap — prevents one rule from dominating the final score
    const cap = RULE_CAPS[result.ruleName] ?? 50;
    const capped = raw > 0
      ? Math.min(raw, cap)
      : Math.max(raw, -cap); // also cap negative (de-risking) contributions

    if (Math.abs(capped) > 0 || (result.flags && result.flags.length > 0)) {
      ruleBreakdown.push({
        rule: result.ruleName,
        rawScore: raw,
        cappedScore: capped,
        flags: result.flags || [],
      });
    }

    total += capped;
    if (result.flags)    allFlags.push(...result.flags);
    if (result.reasons)  allReasons.push(...result.reasons);
    if (result.features) Object.assign(mlFeatures, result.features);
  }

  const finalScore = Math.min(100, Math.max(0, Math.round(total)));

  // Determine risk band
  let riskLevel = RISK_LEVELS.LOW;
  for (const level of Object.values(RISK_LEVELS)) {
    if (finalScore >= level.min && finalScore <= level.max) {
      riskLevel = level;
      break;
    }
  }

  const explanation = generateExplanation(finalScore, riskLevel, allFlags, allReasons, ruleBreakdown);

  return {
    finalScore,
    riskLevel: riskLevel.label,
    action: riskLevel.action,
    allFlags,
    allReasons,
    mlFeatures,
    explanation,
  };
}

/**
 * Formats a human-readable explanation object for the Alert dashboard.
 * Includes per-rule score breakdown so investigators can see exactly
 * which signals contributed to the final risk score.
 *
 * @param {number}   score
 * @param {Object}   riskLevel
 * @param {string[]} flags
 * @param {string[]} reasons
 * @param {Object[]} ruleBreakdown
 */
function generateExplanation(score, riskLevel, flags, reasons, ruleBreakdown = []) {
  // Human-readable score table for the investigation panel
  const scoreTable = ruleBreakdown
    .filter(r => r.cappedScore !== 0)
    .map(r => {
      const sign = r.cappedScore > 0 ? `+${r.cappedScore}` : `${r.cappedScore}`;
      return `${r.rule.padEnd(22)} ${sign.padStart(4)}`;
    })
    .join('\n');

  return {
    summary: `${riskLevel.label} Risk — Score ${score}/100`,
    recommendedAction: riskLevel.action,
    triggerCount: reasons.length,
    reasonCodes: [...new Set(flags)],   // deduplicated flags
    detailedReasons: reasons,
    ruleBreakdown,                      // full per-rule breakdown for dashboard
    scoreTable,                         // analyst-friendly text table
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { aggregate };
