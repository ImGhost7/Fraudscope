/**
 * RULE 4 — DORMANT ACCOUNT ACTIVATION DETECTOR
 *
 * Detects suspicious reactivation of long-inactive accounts.
 * No longer depends on a fixed ₹50k threshold.
 * Instead, any activation triggers scoring based on:
 *
 *   - How long the account was dormant
 *   - Whether funds are rapidly forwarded post-activation
 *   - Whether the sender is already suspicious (static check: account_type / is_flagged)
 *   - Behavioural mule probability of the sender (v2.1)
 *       Uses computeMuleScore() from muleRiskRule.
 *       Sender mule score ≥25 triggers ACTIVATED_BY_SUSPICIOUS_SENDER even if
 *       account_type is still 'SAVINGS' in the DB — catches unclassified mules
 *       that haven't been re-labelled yet but exhibit clear pass-through behaviour.
 *       sender_mule_score added as an ML feature for the downstream ML layer.
 *   - Whether one sender activates multiple dormant accounts
 *   - Post-activation behaviour (groceries/bills vs immediate forwarding)
 *   - Customer profile match (student account getting ₹8L = suspicious)
 *
 * New ML features (v2.1):
 *   sender_mule_score
 *
 * Returns: { ruleName, riskContribution, flags, reasons, features }
 */

const { MODIFIERS, BEHAVIOUR } = require('../config/riskWeights');
const { computeMuleScore } = require('./muleRiskRule');

/**
 * @param {Object}   tx                  - current transaction
 * @param {Object|null} receiverAccount  - account record of the receiver
 * @param {Object|null} senderAccount    - account record of the sender
 * @param {Object[]} allTx               - all transactions
 * @param {Object[]} allAlerts           - all alerts (open alert check + mule scoring)
 * @param {Object[]} allAccounts         - all accounts (used by computeMuleScore for sender)
 * @returns {{ ruleName, riskContribution, flags, reasons, features }}
 */
function checkDormantActivation(tx, receiverAccount, senderAccount, allTx, allAlerts, allAccounts = []) {
  const configService = require('../config/riskWeights');
  const CONFIG = configService.get();
  const { RULE_STATES, MODIFIERS, BEHAVIOUR } = CONFIG;

  if (RULE_STATES && RULE_STATES.DORMANT === false) {
    return {
      ruleName: 'DORMANT_ACTIVATION',
      riskContribution: 0,
      flags: [],
      reasons: [],
      features: { dormant_risk_score: 0 },
      trace: { ruleName: 'DORMANT_ACTIVATION', enabled: false, score: 0, checks: [] }
    };
  }

  const flags   = [];
  const reasons = [];
  let contribution = 0;

  if (!receiverAccount) {
    return {
      ruleName: 'DORMANT_ACTIVATION',
      riskContribution: 0,
      flags: [],
      reasons: [],
      features: { dormant_risk_score: 0, days_inactive: 0 },
      trace: {
        ruleName: 'DORMANT_ACTIVATION',
        enabled: true,
        score: 0,
        maxPossibleScore: CONFIG.DORMANT_MAX,
        checks: [{ name: 'Receiver Account Available', description: 'Checks if receiver account is registered in DB', matched: false, scoreEffect: 0, details: 'Receiver account record not found.' }]
      }
    };
  }

  // Calculate inactivity duration
  const lastActive = new Date(receiverAccount.last_active || receiverAccount.updatedAt || Date.now());
  const daysSinceActive = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24);

  const isDormant = daysSinceActive >= BEHAVIOUR.DORMANT_DAYS;

  const traceChecks = [
    {
      name: 'Receiver Account Inactivity Threshold',
      description: `Flags accounts that have been dormant for at least ${BEHAVIOUR.DORMANT_DAYS} days`,
      matched: isDormant,
      scoreEffect: 0,
      details: `Account inactive for ${Math.round(daysSinceActive)} days (status: ${receiverAccount.status}).`
    }
  ];

  if (!isDormant) {
    return {
      ruleName: 'DORMANT_ACTIVATION',
      riskContribution: 0,
      flags: [],
      reasons: [],
      features: { dormant_risk_score: 0, days_inactive: Math.round(daysSinceActive) },
      trace: {
        ruleName: 'DORMANT_ACTIVATION',
        enabled: true,
        score: 0,
        maxPossibleScore: CONFIG.DORMANT_MAX,
        checks: traceChecks
      }
    };
  }

  // Base contribution for dormant activation (any amount)
  const dormancyMultiplier = Math.min(2.0, daysSinceActive / BEHAVIOUR.DORMANT_DAYS);
  const baseScore = 10 * dormancyMultiplier;
  contribution += baseScore;

  flags.push('DORMANT_ACTIVATION');
  reasons.push(
    `Account ${tx.receiver} was inactive for ${Math.round(daysSinceActive)} days ` +
    `and received ₹${tx.amount.toLocaleString('en-IN')} from ${tx.sender}.`
  );

  // ── Sender is Suspicious ─────────────────────────────────────────────────────
  const isSenderStaticMule = senderAccount &&
    (senderAccount.is_flagged || ['SHELL', 'MULE'].includes(senderAccount.account_type));

  const senderMuleScore = computeMuleScore(tx.sender, allTx, allAccounts, allAlerts);
  const isSenderBehaviouralMule = senderMuleScore >= 25;
  const senderSuspiciousMatched = isSenderStaticMule || isSenderBehaviouralMule;

  if (senderSuspiciousMatched) {
    contribution += MODIFIERS.ACTIVATED_BY_SUSPICIOUS;
    flags.push('ACTIVATED_BY_SUSPICIOUS_SENDER');

    if (isSenderStaticMule) {
      reasons.push(
        `Activating sender ${tx.sender} is of type ${senderAccount?.account_type || 'FLAGGED'} ` +
        (senderAccount?.is_flagged ? 'and is already flagged.' : '.')
      );
    }
    if (isSenderBehaviouralMule) {
      reasons.push(
        `Activating sender ${tx.sender} has a behavioural mule score of ${senderMuleScore}/95 ` +
        `— it exhibits pass-through and aggregation patterns consistent with mule operation.`
      );
    }
  }

  // Check if sender has open alerts
  const senderAlerts = allAlerts.filter(
    a => a.account_references && a.account_references.includes(tx.sender) && a.status === 'OPEN'
  );
  const senderAlertsMatched = senderAlerts.length > 0;
  if (senderAlertsMatched) {
    contribution += Math.min(10, senderAlerts.length * 5);
    flags.push('SENDER_HAS_OPEN_ALERTS');
    reasons.push(`Sender ${tx.sender} has ${senderAlerts.length} open AML alert(s).`);
  }

  // ── One Sender Activating Multiple Dormant Accounts ─────────────────────────
  const recentByThisSender = allTx.filter(
    t => t.sender === tx.sender &&
         t.tx_id !== tx.tx_id &&
         Date.now() - new Date(t.timestamp).getTime() <= 60 * 60 * 1000 // 1 hour
  );

  let multipleDormantMatched = false;
  let activeCount = 0;
  if (recentByThisSender.length >= 2) {
    const recentReceivers = new Set(recentByThisSender.map(t => t.receiver));
    if (recentReceivers.size >= 2) {
      multipleDormantMatched = true;
      activeCount = recentReceivers.size;
      contribution += MODIFIERS.MULTIPLE_DORMANT_SAME_SENDER;
      flags.push('MULTIPLE_DORMANT_ACTIVATIONS');
      reasons.push(
        `Sender ${tx.sender} appears to have activated ${recentReceivers.size} accounts ` +
        `within 1 hour. Possible coordinated dormant account exploitation.`
      );
    }
  }

  // ── Post-Activation Behaviour ────────────────────────────────────────────────
  const postActivationTxs = allTx.filter(
    t => t.sender === tx.receiver &&
         new Date(t.timestamp).getTime() > new Date(tx.timestamp).getTime() &&
         new Date(t.timestamp).getTime() <= new Date(tx.timestamp).getTime() + BEHAVIOUR.DORMANT_RAPID_FORWARD_MIN * 60000
  );

  let rapidForwardingMatched = false;
  let totalForwarded = 0;
  let forwardRatio = 0;
  if (postActivationTxs.length > 0) {
    totalForwarded = postActivationTxs.reduce((s, t) => s + t.amount, 0);
    forwardRatio   = totalForwarded / tx.amount;

    if (forwardRatio >= BEHAVIOUR.DORMANT_FORWARD_RATIO) {
      rapidForwardingMatched = true;
      contribution += MODIFIERS.FAST_FORWARD_POST_ACTIVATION;
      flags.push('RAPID_POST_ACTIVATION_FORWARDING');
      reasons.push(
        `${Math.round(forwardRatio * 100)}% of received funds (₹${Math.round(totalForwarded).toLocaleString('en-IN')}) ` +
        `were forwarded out within ${BEHAVIOUR.DORMANT_RAPID_FORWARD_MIN} minutes of account activation.`
      );
    }
  }

  // ── Customer Profile vs Amount Mismatch ──────────────────────────────────────
  const profileMismatchMatched = receiverAccount.kyc_level === 'LOW' && tx.amount > 200000;
  if (profileMismatchMatched) {
    contribution += 8;
    flags.push('LOW_KYC_LARGE_ACTIVATION');
    reasons.push(
      `Account ${tx.receiver} has LOW KYC level but received ₹${tx.amount.toLocaleString('en-IN')} ` +
      `upon reactivation. Profile mismatch.`
    );
  }

  // ── False Positive Reducer: Salary Return Pattern ────────────────────────────
  const salaryReturnMatched =
    tx.amount < 100000 &&
    receiverAccount.kyc_level === 'HIGH' &&
    (tx.description || '').toLowerCase().includes('salary');

  if (salaryReturnMatched) {
    contribution += MODIFIERS.DORMANT_SALARY_MATCH;
    flags.push('DORMANT_SALARY_MATCH');
    reasons.push('Dormant account activation resembles a salary credit to a legitimate employee account. Risk reduced.');
  }

  traceChecks.push(
    {
      name: 'Reactivating Sender Risk Evaluation',
      description: 'Checks if the activating account is a flagged user or behavioural money mule',
      matched: senderSuspiciousMatched,
      scoreEffect: senderSuspiciousMatched ? MODIFIERS.ACTIVATED_BY_SUSPICIOUS : 0,
      details: `Sender static type: ${senderAccount?.account_type || 'Unknown'}. Behavioural Mule Score: ${senderMuleScore}/95.`
    },
    {
      name: 'Sender Active Alerts Check',
      description: 'Raises risk if the source account has open cases/alerts in progress',
      matched: senderAlertsMatched,
      scoreEffect: senderAlertsMatched ? Math.min(10, senderAlerts.length * 5) : 0,
      details: `Source has ${senderAlerts.length} open alert(s).`
    },
    {
      name: 'Coordinated Multiple Activation Check',
      description: 'Flags if the same sender activates multiple dormant accounts in a short time frame',
      matched: multipleDormantMatched,
      scoreEffect: multipleDormantMatched ? MODIFIERS.MULTIPLE_DORMANT_SAME_SENDER : 0,
      details: multipleDormantMatched ? `Activated ${activeCount} dormant accounts in 1h.` : 'No multiple activations detected.'
    },
    {
      name: 'Rapid Post-Activation Outflows',
      description: `Flags accounts forwarding a large percentage (>= ${BEHAVIOUR.DORMANT_FORWARD_RATIO * 100}%) of funds within ${BEHAVIOUR.DORMANT_RAPID_FORWARD_MIN} mins`,
      matched: rapidForwardingMatched,
      scoreEffect: rapidForwardingMatched ? MODIFIERS.FAST_FORWARD_POST_ACTIVATION : 0,
      details: rapidForwardingMatched ? `Outflow: ${(forwardRatio * 100).toFixed(1)}% of inbound amount.` : 'No rapid outflow observed.'
    },
    {
      name: 'Low KYC Account Profile Check',
      description: 'Identifies high amount activation on low KYC savings profiles',
      matched: profileMismatchMatched,
      scoreEffect: profileMismatchMatched ? 8 : 0,
      details: `Profile KYC level: ${receiverAccount.kyc_level}. Transfer size: ₹${tx.amount.toLocaleString()}.`
    },
    {
      name: 'Salary Credit Activation Mitigator',
      description: 'Reduces risk if reactivation resembles regular corporate salary dispatch',
      matched: salaryReturnMatched,
      scoreEffect: salaryReturnMatched ? MODIFIERS.DORMANT_SALARY_MATCH : 0,
      details: salaryReturnMatched ? 'Recognised salary activation.' : 'No salary context.'
    }
  );

  const finalContribution = Math.min(CONFIG.DORMANT_MAX, Math.max(0, contribution));

  const trace = {
    ruleName: 'DORMANT_ACTIVATION',
    enabled: true,
    score: finalContribution,
    rawScore: contribution,
    maxPossibleScore: CONFIG.DORMANT_MAX,
    checks: traceChecks
  };

  const features = {
    dormant_risk_score:             finalContribution,
    days_inactive:                  Math.round(daysSinceActive),
    post_activation_forward_ratio:  postActivationTxs.length > 0
      ? parseFloat((postActivationTxs.reduce((s, t) => s + t.amount, 0) / tx.amount).toFixed(3))
      : 0,
    sender_is_suspicious:           flags.includes('ACTIVATED_BY_SUSPICIOUS_SENDER') ? 1 : 0,
    sender_mule_score:              senderMuleScore,
    multiple_dormant_same_sender:   flags.includes('MULTIPLE_DORMANT_ACTIVATIONS') ? 1 : 0,
    rapid_forwarding:               flags.includes('RAPID_POST_ACTIVATION_FORWARDING') ? 1 : 0,
    low_kyc_large_amount:           flags.includes('LOW_KYC_LARGE_ACTIVATION') ? 1 : 0,
  };

  return {
    ruleName: 'DORMANT_ACTIVATION',
    riskContribution: finalContribution,
    flags: [...new Set(flags)],
    reasons,
    features,
    trace,
  };
}

module.exports = { checkDormantActivation };

module.exports = { checkDormantActivation };
