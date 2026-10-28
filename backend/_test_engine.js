// Quick smoke test for the redesigned engine
async function main() {
  try {
    const { runFraudEngine, detectFraud } = require('./fraud_engine/ruleEngine');
    console.log('[OK] ruleEngine.js loaded. Exports:', Object.keys({ runFraudEngine, detectFraud }));

    // Minimal fake transaction
    const tx = {
      tx_id: 'TXN-TEST-001',
      sender: 'ACC000001',
      receiver: 'ACC000002',
      amount: 47500,
      timestamp: new Date(),
      transaction_type: 'NEFT',
      channel: 'MOBILE',
      geo_origin: { city: 'Mumbai', state: 'Maharashtra', country: 'India', lat: 19.076, lng: 72.877 },
      anomaly_flag: false,
      fraud_type: 'NONE',
      status: 'COMPLETED',
      description: 'Transfer',
      rule_flags: [],
    };

    const db = {
      accounts: [
        { account_id: 'ACC000001', customer_name: 'Test Sender', kyc_level: 'MEDIUM', account_type: 'SAVINGS', status: 'ACTIVE', balance: 500000, last_active: new Date(), opened_at: new Date(Date.now() - 365*24*60*60*1000), risk_score: 0, is_flagged: false, total_incoming: 0, total_outgoing: 0, tx_count: 5 },
        { account_id: 'ACC000002', customer_name: 'Test Receiver', kyc_level: 'HIGH', account_type: 'SAVINGS', status: 'ACTIVE', balance: 100000, last_active: new Date(), opened_at: new Date(Date.now() - 200*24*60*60*1000), risk_score: 0, is_flagged: false, total_incoming: 0, total_outgoing: 0, tx_count: 3 },
      ],
      transactions: [],
      alerts: [],
    };

    const result = await detectFraud(tx, db, null);
    console.log('[OK] detectFraud ran successfully.');
    console.log('  → riskLevel  :', result.riskLevel);
    console.log('  → finalScore :', result.riskScore || 0);
    console.log('  → flags      :', result.flags.length > 0 ? result.flags.join(', ') : 'NONE (clean pass)');
    console.log('  → action     :', result.action);
    console.log('\n[PASS] Engine v2.0 smoke test complete.\n');
  } catch (err) {
    console.error('[FAIL]', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
