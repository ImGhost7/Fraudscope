/**
 * ReceiverReputation Service
 *
 * Maintains a dynamic trust score for every beneficiary account based on:
 *   - How many times they appeared in suspicious/flagged transactions
 *   - KYC level
 *   - Account type (SAVINGS vs MULE vs SHELL)
 *   - Account age
 *   - Historical alert associations
 *
 * Returns a reputation object used by every rule to either raise or lower risk.
 */

/**
 * @param {string} receiverId
 * @param {Object|null} receiverAccount  - account record (may be null in mock mode)
 * @param {Object[]} allTransactions     - all transactions in memory/DB
 * @param {Object[]} allAlerts           - all alerts in memory/DB
 * @returns {{ score: number, flags: string[], label: string }}
 */
function getReceiverReputation(receiverId, receiverAccount, allTransactions, allAlerts) {
  const flags = [];
  let score = 30; // Start at low-risk (0 = fully trusted, 100 = fully suspicious)
  // 30 means a clean SAVINGS account with HIGH KYC lands around 20 (trusted).
  // 50 was causing every normal receiver to read as ELEVATED/SUSPICIOUS.

  if (!receiverAccount) {
    // Unknown receiver — treat as slightly elevated
    flags.push('RECEIVER_NOT_IN_SYSTEM');
    return { score: 60, flags, label: 'UNKNOWN' };
  }

  // ── Account Type ────────────────────────────────────────────────────────────
  if (receiverAccount.account_type === 'MULE') {
    score += 30;
    flags.push('RECEIVER_IS_MULE');
  } else if (receiverAccount.account_type === 'SHELL') {
    score += 20;
    flags.push('RECEIVER_IS_SHELL');
  } else if (receiverAccount.account_type === 'SAVINGS') {
    score -= 10;
  }

  // ── KYC Level ────────────────────────────────────────────────────────────────
  if (receiverAccount.kyc_level === 'LOW') {
    score += 10;
    flags.push('RECEIVER_LOW_KYC');
  } else if (receiverAccount.kyc_level === 'HIGH') {
    score -= 10;
    flags.push('RECEIVER_HIGH_KYC');
  }

  // ── Account Age ──────────────────────────────────────────────────────────────
  const ageMs = Date.now() - new Date(receiverAccount.opened_at || receiverAccount.createdAt || Date.now()).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Only flag as new if genuinely new (opened_at or createdAt exists and is < 30 days)
  // In mock/demo mode all accounts are created at server start — don't penalize that.
  const hasRealAge = !!(receiverAccount.opened_at);
  if (hasRealAge && ageDays < 30) {
    score += 10;
    flags.push('RECEIVER_NEW_ACCOUNT');
  } else if (ageDays > 365) {
    score -= 5;
  }

  // ── Flagged Status ───────────────────────────────────────────────────────────
  if (receiverAccount.is_flagged) {
    score += 20;
    flags.push('RECEIVER_PREVIOUSLY_FLAGGED');
  }

  // ── Alert Association ────────────────────────────────────────────────────────
  const assocAlerts = allAlerts.filter(
    a => a.account_references && a.account_references.includes(receiverId)
  );
  if (assocAlerts.length > 0) {
    score += Math.min(15, assocAlerts.length * 5);
    flags.push(`RECEIVER_IN_${assocAlerts.length}_ALERTS`);
  }

  // ── Outgoing Behaviour (Pass-through indicator) ──────────────────────────────
  if (receiverAccount.total_incoming > 0) {
    const passThrough = receiverAccount.total_outgoing / receiverAccount.total_incoming;
    if (passThrough > 0.90) {
      score += 15;
      flags.push('RECEIVER_PASS_THROUGH');
    }
  }

  score = Math.min(100, Math.max(0, score));

  let label = 'TRUSTED';
  if (score >= 80) label = 'HIGH_RISK';
  else if (score >= 60) label = 'SUSPICIOUS';
  else if (score >= 40) label = 'ELEVATED';

  return { score, flags, label };
}

module.exports = { getReceiverReputation };
