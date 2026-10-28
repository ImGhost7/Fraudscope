import { useState, useEffect } from 'react';
import {
  Shield, Sliders, Play, Check, AlertTriangle, Eye, Save, RefreshCw, Plus, Trash2, Layers, Zap
} from 'lucide-react';
import { rulesApi, simulatorApi } from '../services/api';
import toast from 'react-hot-toast';

const createChainStep = (overrides = {}) => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  sender: '',
  receiver: '',
  amount: '',
  transaction_type: 'NEFT',
  channel: 'MOBILE',
  city: 'Mumbai',
  ts_offset_seconds: '',
  ...overrides,
});

export default function RuleSettingsPage() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [activeTab, setActiveTab] = useState('trace');

  // Unified Transaction Chain Trace Tester State
  const [chainRows, setChainRows] = useState([]);
  const [chainResults, setChainResults] = useState(null);
  const [activeResultStep, setActiveResultStep] = useState(0);
  const [tracing, setTracing] = useState(false);

  useEffect(() => {
    fetchConfig();
    fetchAccounts();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const data = await rulesApi.getConfig();
      setConfig(data);
    } catch (err) {
      toast.error('Failed to load rule configuration');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAccounts = async () => {
    try {
      const data = await simulatorApi.getAccounts();
      const loadedAccounts = data.accounts || [];
      
      // Select a balanced, smaller subset of accounts to prevent select list lag
      const normal = loadedAccounts.filter(a => a.account_type === 'SAVINGS' && a.status === 'ACTIVE').slice(0, 30);
      const dormant = loadedAccounts.filter(a => a.status === 'DORMANT').slice(0, 15);
      const shell = loadedAccounts.filter(a => a.account_type === 'SHELL').slice(0, 25);
      const mule = loadedAccounts.filter(a => a.account_type === 'MULE').slice(0, 25);
      const balancedSubset = [...normal, ...dormant, ...shell, ...mule];

      setAccounts(balancedSubset);

      // Initialize with a simple 2-step chain if accounts are available
      if (balancedSubset.length >= 3) {
        setChainRows([
          createChainStep({ sender: balancedSubset[0].account_id, receiver: balancedSubset[1].account_id, amount: '48500', ts_offset_seconds: '0' }),
          createChainStep({ sender: balancedSubset[1].account_id, receiver: balancedSubset[2].account_id, amount: '47500', ts_offset_seconds: '45' })
        ]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleStateToggle = (ruleKey) => {
    setConfig(prev => {
      const updatedStates = { ...prev.RULE_STATES, [ruleKey]: !prev.RULE_STATES[ruleKey] };
      return { ...prev, RULE_STATES: updatedStates };
    });
  };

  const handleModifierChange = (key, value) => {
    setConfig(prev => {
      const updatedModifiers = { ...prev.MODIFIERS, [key]: Number(value) };
      return { ...prev, MODIFIERS: updatedModifiers };
    });
  };

  const handleBehaviourChange = (key, value) => {
    setConfig(prev => {
      const updatedBehaviour = { ...prev.BEHAVIOUR, [key]: Number(value) };
      return { ...prev, BEHAVIOUR: updatedBehaviour };
    });
  };

  const handleMaxWeightChange = (key, value) => {
    setConfig(prev => ({
      ...prev,
      [key]: Number(value)
    }));
  };

  const saveConfig = async () => {
    try {
      setSaving(true);
      await rulesApi.updateConfig(config);
      toast.success('AML Rule Configuration updated successfully');
    } catch (err) {
      toast.error('Failed to save configuration');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Chain Builder Actions
  const addChainStep = () => {
    setChainRows(prev => {
      const lastStep = prev[prev.length - 1];
      // Automatically chain the sender of the new step to be the receiver of the previous step
      const sender = lastStep ? lastStep.receiver : '';
      const amount = lastStep ? lastStep.amount : '48500';
      const ts_offset_seconds = lastStep && lastStep.ts_offset_seconds !== '' ? String(Number(lastStep.ts_offset_seconds) + 45) : '45';
      return [...prev, createChainStep({ sender, amount, ts_offset_seconds })];
    });
  };

  const removeChainStep = (id) => {
    setChainRows(prev => (prev.length > 1 ? prev.filter(step => step.id !== id) : prev));
  };

  const updateChainStep = (id, key, value) => {
    setChainRows(prev => prev.map(step => (step.id === id ? { ...step, [key]: value } : step)));
  };

  const clearChain = () => {
    if (accounts.length >= 2) {
      setChainRows([createChainStep({ sender: accounts[0].account_id, receiver: accounts[1].account_id, amount: '48500', ts_offset_seconds: '0' })]);
    } else {
      setChainRows([createChainStep()]);
    }
    setChainResults(null);
  };

  const applyPatternPreset = (pattern) => {
    if (accounts.length < 4) {
      toast.error('Not enough accounts loaded to build pattern presets');
      return;
    }

    const normal = accounts.filter(a => a.account_type === 'SAVINGS' && a.status === 'ACTIVE');
    const dormant = accounts.filter(a => a.status === 'DORMANT');
    const shell = accounts.filter(a => a.account_type === 'SHELL');
    const mule = accounts.filter(a => a.account_type === 'MULE');

    let rows = [];

    if (pattern === 'structuring') {
      const sender = normal[0]?.account_id || accounts[0].account_id;
      const receiver = normal[1]?.account_id || accounts[1].account_id;
      rows = [
        createChainStep({ sender, receiver, amount: '49200', transaction_type: 'NEFT', ts_offset_seconds: '0' }),
        createChainStep({ sender, receiver, amount: '48500', transaction_type: 'NEFT', ts_offset_seconds: '90' }),
        createChainStep({ sender, receiver, amount: '49100', transaction_type: 'NEFT', ts_offset_seconds: '180' }),
        createChainStep({ sender, receiver, amount: '48800', transaction_type: 'NEFT', ts_offset_seconds: '270' })
      ];
      toast.success('Loaded Structuring (Smurfing) preset: 4 sub-threshold splits');
    } else if (pattern === 'layering') {
      const p1 = normal[0]?.account_id || accounts[0].account_id;
      const s1 = shell[0]?.account_id || accounts[2].account_id;
      const s2 = shell[1]?.account_id || accounts[3].account_id;
      const m1 = mule[0]?.account_id || accounts[4].account_id;
      rows = [
        createChainStep({ sender: p1, receiver: s1, amount: '250000', transaction_type: 'RTGS', channel: 'NET_BANKING', city: 'Mumbai', ts_offset_seconds: '0' }),
        createChainStep({ sender: s1, receiver: s2, amount: '245000', transaction_type: 'WIRE', channel: 'API', city: 'Delhi', ts_offset_seconds: '20' }),
        createChainStep({ sender: s2, receiver: m1, amount: '240000', transaction_type: 'WIRE', channel: 'API', city: 'Dubai', ts_offset_seconds: '40' })
      ];
      toast.success('Loaded Layering (Multi-Hop) preset: Normal -> Shell -> Shell -> Mule');
    } else if (pattern === 'fanout') {
      const sender = shell[0]?.account_id || accounts[0].account_id;
      const receivers = mule.slice(0, 4).map(m => m.account_id);
      while (receivers.length < 4 && accounts.length > receivers.length + 1) {
        receivers.push(accounts[receivers.length + 1].account_id);
      }
      rows = receivers.map((rec, index) => createChainStep({
        sender,
        receiver: rec,
        amount: '45000',
        transaction_type: 'IMPS',
        channel: 'API',
        ts_offset_seconds: String(index * 15)
      }));
      toast.success('Loaded Fan-Out (Fund Dispersal) preset: 1 Shell dispersing to 4 targets');
    } else if (pattern === 'velocity') {
      const sender = normal[0]?.account_id || accounts[0].account_id;
      const receiver = normal[1]?.account_id || accounts[1].account_id;
      rows = [
        createChainStep({ sender, receiver, amount: '12000', transaction_type: 'UPI', ts_offset_seconds: '0' }),
        createChainStep({ sender, receiver, amount: '15000', transaction_type: 'UPI', ts_offset_seconds: '10' }),
        createChainStep({ sender, receiver, amount: '11000', transaction_type: 'UPI', ts_offset_seconds: '20' }),
        createChainStep({ sender, receiver, amount: '14000', transaction_type: 'UPI', ts_offset_seconds: '30' }),
        createChainStep({ sender, receiver, amount: '13000', transaction_type: 'UPI', ts_offset_seconds: '40' }),
        createChainStep({ sender, receiver, amount: '15000', transaction_type: 'UPI', ts_offset_seconds: '50' })
      ];
      toast.success('Loaded Velocity preset: 6 high-frequency burst transactions');
    } else if (pattern === 'dormant') {
      const d1 = dormant[0]?.account_id || accounts[0].account_id;
      const s1 = shell[0]?.account_id || accounts[1].account_id;
      const m1 = mule[0]?.account_id || accounts[2].account_id;
      rows = [
        createChainStep({ sender: s1, receiver: d1, amount: '350000', transaction_type: 'RTGS', ts_offset_seconds: '0' }),
        createChainStep({ sender: d1, receiver: m1, amount: '342000', transaction_type: 'WIRE', ts_offset_seconds: '120' })
      ];
      toast.success('Loaded Dormant Account Activation preset: Shell activates Dormant -> Drained to Mule');
    }

    setChainRows(rows);
    setChainResults(null);
  };

  const runChainTrace = async (e) => {
    e.preventDefault();
    if (chainRows.length === 0) {
      toast.error('Add at least one transaction step');
      return;
    }

    for (let i = 0; i < chainRows.length; i++) {
      const step = chainRows[i];
      if (!step.sender || !step.receiver) {
        toast.error(`Step ${i + 1}: Select both sender and receiver`);
        return;
      }
      if (step.sender === step.receiver) {
        toast.error(`Step ${i + 1}: Sender and receiver cannot be the same`);
        return;
      }
      if (!step.amount || Number(step.amount) <= 0) {
        toast.error(`Step ${i + 1}: Enter a valid amount`);
        return;
      }
    }

    try {
      setTracing(true);
      setChainResults(null);

      // Construct ordered transaction payload
      const payload = {
        chain: chainRows.map(row => ({
          sender: row.sender,
          receiver: row.receiver,
          amount: Number(row.amount),
          transaction_type: row.transaction_type,
          channel: row.channel,
          city: row.city,
          ts_offset_seconds: row.ts_offset_seconds !== '' ? Number(row.ts_offset_seconds) : undefined
        }))
      };

      const res = await rulesApi.dryRun(payload);
      
      if (res && res.chain) {
        setChainResults(res.chain);
        setActiveResultStep(0);
        toast.success(`Evaluated sequence of ${res.chain.length} transactions successfully`);
      } else {
        toast.error('Evaluation returned empty results');
      }
    } catch (err) {
      toast.error(err.error || 'Dry-run evaluation failed');
      console.error(err);
    } finally {
      setTracing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <RefreshCw className="animate-spin text-blue-500 mb-4" size={32} />
        <p className="text-gray-400">Loading AML Rule Engine Configuration...</p>
      </div>
    );
  }

  const ruleCards = [
    {
      id: 'STRUCTURING',
      title: 'Structuring Rule (Rule 1)',
      desc: 'Detects artificial split transfers designed to bypass PMLA ₹50,000 reporting threshold.',
      maxKey: 'STRUCTURING_MAX',
      stateKey: 'STRUCTURING',
      params: [
        { key: 'STRUCTURING_THRESHOLD_INR', label: 'PMLA Reporting Threshold (INR)', min: 10000, max: 200000, step: 5000 },
        { key: 'NEAR_THRESHOLD_BAND', label: 'Structuring Band Factor (e.g. 0.86 = 86% of threshold)', min: 0.5, max: 0.99, step: 0.01 },
        { key: 'NEAR_THRESHOLD_MIN_COUNT', label: 'Minimum Repeat Count', min: 2, max: 10, step: 1 }
      ],
      modifiers: [
        { key: 'NEAR_THRESHOLD_PATTERN', label: 'Near Threshold Pattern Match' },
        { key: 'HIGH_FREQUENCY_SHORT_WINDOW', label: 'High Frequency Short Window Burst' },
        { key: 'MULTIPLE_NEW_BENEFICIARIES', label: 'Multiple New Beneficiaries Hit' },
        { key: 'MANY_TO_ONE_CONVERGENCE', label: 'Many-to-One Convergence Hit' },
        { key: 'KNOWN_BENEFICIARY', label: 'Known Beneficiary Mitigator (Negative)', isNegative: true },
        { key: 'SALARY_PATTERN', label: 'Salary Pattern Mitigator (Negative)', isNegative: true },
        { key: 'UTILITY_PAYMENT', label: 'Utility Bill Mitigator (Negative)', isNegative: true }
      ]
    },
    {
      id: 'LAYERING',
      title: 'Layering Rule (Rule 2)',
      desc: 'Traces graph hops forward through shells, mules, and geographical jumps to detect money laundering trails.',
      maxKey: 'LAYERING_MAX',
      stateKey: 'LAYERING',
      params: [
        { key: 'LAYERING_MIN_HOPS', label: 'Minimum Chain Hop Depth', min: 2, max: 6, step: 1 },
        { key: 'LAYERING_HOP_TIME_SUSPICIOUS_SEC', label: 'Suspicious Hop Gap Threshold (seconds)', min: 10, max: 600, step: 10 },
        { key: 'LAYERING_PRESERVATION_RATIO', label: 'Pass-through Preservation Ratio (e.g. 0.90 = 90% forwarded)', min: 0.5, max: 0.99, step: 0.01 }
      ],
      modifiers: [
        { key: 'FAST_HOP_TIME', label: 'Extremely Fast Hop Penalty' },
        { key: 'HIGH_PRESERVATION', label: 'High Fund Preservation Ratio' },
        { key: 'CIRCULAR_DETECTED', label: 'Circular Cycle Found (A→B→C→A)' },
        { key: 'SHELL_ACCOUNT_HOP', label: 'Shell/Mule Intermediate Hop' },
        { key: 'GEO_CROSSING', label: 'Geographic Boundary Crossing' }
      ]
    },
    {
      id: 'FAN_OUT',
      title: 'Fan-Out Rule (Rule 3)',
      desc: 'Detects rapid fund dispersal from one source to many unknown destinations.',
      maxKey: 'FAN_OUT_MAX',
      stateKey: 'FAN_OUT',
      params: [
        { key: 'FAN_OUT_MIN_RECEIVERS', label: 'Minimum Destination Receivers', min: 3, max: 15, step: 1 },
        { key: 'FAN_OUT_NEW_BENEFICIARY_RATIO', label: 'Ratio of First-Time Receivers', min: 0.5, max: 0.95, step: 0.05 }
      ],
      modifiers: [
        { key: 'EQUAL_DISTRIBUTION', label: 'Near-Equal Splits Distribution' },
        { key: 'UNKNOWN_RECEIVERS', label: 'Mostly Unknown Target Receivers' },
        { key: 'RECONVERGENCE', label: 'Reconvergence Flow Detected (Fan-In)' }
      ]
    },
    {
      id: 'DORMANT',
      title: 'Dormant Account Activation (Rule 4)',
      desc: 'Flags long-inactive accounts suddenly receiving large inflows and immediately draining them.',
      maxKey: 'DORMANT_MAX',
      stateKey: 'DORMANT',
      params: [
        { key: 'DORMANT_DAYS', label: 'Inactivity Period (Days)', min: 30, max: 360, step: 10 },
        { key: 'DORMANT_RAPID_FORWARD_MIN', label: 'Post-Activation Outflow Window (Minutes)', min: 5, max: 180, step: 5 },
        { key: 'DORMANT_FORWARD_RATIO', label: 'Outflow Drain Ratio', min: 0.5, max: 0.95, step: 0.05 }
      ],
      modifiers: [
        { key: 'FAST_FORWARD_POST_ACTIVATION', label: 'Immediate Post-Activation Outflow' },
        { key: 'ACTIVATED_BY_SUSPICIOUS', label: 'Source is Flagged/Suspicious' },
        { key: 'MULTIPLE_DORMANT_SAME_SENDER', label: 'Sender Activates Multiple Dormant Accounts' },
        { key: 'DORMANT_SALARY_MATCH', label: 'Salary Pattern Mitigator (Negative)', isNegative: true }
      ]
    },
    {
      id: 'VELOCITY',
      title: 'Velocity Rule (Rule 5)',
      desc: 'Detects sudden bursts of transactions deviating sharply from customer historical averages.',
      maxKey: 'VELOCITY_MAX',
      stateKey: 'VELOCITY',
      params: [
        { key: 'VELOCITY_WINDOW_MS', label: 'Velocity Window (Minutes)', min: 5, max: 120, step: 5, multiplier: 60000 },
        { key: 'VELOCITY_BURST_MULTIPLIER', label: 'Activity Baseline Multiplier (e.g. 3 = 3x avg)', min: 1.5, max: 10, step: 0.5 },
        { key: 'VELOCITY_MAX_INTERVAL_FAST_SEC', label: 'Bot-Like Interval Threshold (Seconds)', min: 5, max: 120, step: 5 }
      ],
      modifiers: [
        { key: 'BURST_HIGH_COUNT', label: 'Count Multiplier Exceeded' },
        { key: 'BURST_HIGH_VALUE', label: 'Value Multiplier Exceeded' },
        { key: 'NIGHT_SESSION', label: 'Unusual Night Hour Activity (11PM-5AM)' },
        { key: 'SESSION_TOO_FAST', label: 'Automated/Bot-Like Interval' }
      ]
    },
    {
      id: 'MULE_RISK',
      title: 'Behavioral Money Mule (Rule 6)',
      desc: 'Runs composite behavioral profiling. Combines balance, inflow structure, and kyc levels to detect mule targets.',
      maxKey: 'MULE_RISK_MAX',
      stateKey: 'MULE_RISK',
      params: [
        { key: 'MIN_UNIQUE_SENDERS', label: 'Minimum Inbound Send Senders', min: 2, max: 10, step: 1, objectPath: 'MULE' },
        { key: 'LOW_BALANCE_THRESHOLD_INR', label: 'Mule Balance Cap Limit (INR)', min: 100, max: 5000, step: 100, objectPath: 'MULE' },
        { key: 'FIRST_TIME_SENDER_RATIO', label: 'One-Time Senders Ratio', min: 0.5, max: 0.95, step: 0.05, objectPath: 'MULE' }
      ],
      modifiers: [
        { key: 'SCORE_MANY_UNRELATED_SENDERS', label: 'Many Unrelated Inbound Senders Penalty', objectPath: 'MULE' },
        { key: 'SCORE_PASS_THROUGH', label: 'Rapid Forwarding Pass-Through Penalty', objectPath: 'MULE' },
        { key: 'SCORE_LOW_BALANCE', label: 'Minimal Balance Draining Penalty', objectPath: 'MULE' },
        { key: 'SCORE_FIRST_TIME_SENDERS', label: 'Mostly One-Time Senders Penalty', objectPath: 'MULE' },
        { key: 'SCORE_PRIOR_ALERTS', label: 'Prior AML Alerts History Penalty', objectPath: 'MULE' },
        { key: 'SCORE_LOW_KYC', label: 'Low Profile KYC Penalty', objectPath: 'MULE' }
      ]
    }
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 11,
          background: 'linear-gradient(135deg, rgba(26,108,188,0.3), rgba(15,122,82,0.2))',
          border: '1px solid rgba(26,108,188,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 24px rgba(26,108,188,0.2)',
        }}>
          <Shield size={22} color="#4a9eff" />
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.02em', lineHeight: 1 }}>
            AML Rule Engine Studio & Simulation
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 5 }}>
            Fine-tune parameters/modifiers dynamically and build chain traces to audit layered money laundering scenarios.
          </p>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 10, padding: 4 }}>
        <button
          onClick={() => setActiveTab('trace')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
            background: activeTab === 'trace' ? 'rgba(15,122,82,0.15)' : 'transparent',
            color: activeTab === 'trace' ? '#10b981' : 'var(--text-3)',
            transition: 'all 0.2s'
          }}
        >
          <Zap size={14} />
          Step-by-Step Trace Tester
        </button>
        <button
          onClick={() => setActiveTab('tuning')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
            background: activeTab === 'tuning' ? 'rgba(26,108,188,0.18)' : 'transparent',
            color: activeTab === 'tuning' ? 'var(--blue-2)' : 'var(--text-3)',
            transition: 'all 0.2s'
          }}
        >
          <Sliders size={14} />
          Rule Weights & Threshold Tuning
        </button>
      </div>

      {/* Save Button Bar for Tuning Tab */}
      {activeTab === 'tuning' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
          <button
            onClick={saveConfig}
            disabled={saving}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 8,
              background: 'linear-gradient(135deg, #1a6cbc, #125699)', color: '#fff', border: 'none',
              fontWeight: 600, fontSize: 13, cursor: 'pointer', boxShadow: '0 4px 12px rgba(26,108,188,0.3)',
              transition: 'all 0.2s'
            }}
          >
            {saving ? <RefreshCw className="animate-spin" size={14} /> : <Save size={14} />}
            {saving ? 'Applying...' : 'Apply Live Changes'}
          </button>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'tuning' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(600px, 1fr))', gap: 24 }}>
          {ruleCards.map(rule => {
            const isEnabled = config.RULE_STATES[rule.stateKey];
            return (
              <div
                key={rule.id}
                className="glass-card"
                style={{
                  padding: 24,
                  opacity: isEnabled ? 1 : 0.65,
                  border: isEnabled ? '1px solid var(--border)' : '1px dashed var(--border-2)',
                  transition: 'opacity 0.3s, border-color 0.3s'
                }}
              >
                {/* Rule Title Card Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: isEnabled ? 'var(--text-1)' : 'var(--text-3)' }}>
                      {rule.title}
                    </h3>
                    <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.4 }}>
                      {rule.desc}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 12, background: isEnabled ? 'rgba(15,122,82,0.15)' : 'rgba(200,40,40,0.12)', color: isEnabled ? '#10b981' : '#f87171' }}>
                      {isEnabled ? 'ACTIVE' : 'DISABLED'}
                    </span>
                    <button
                      onClick={() => handleStateToggle(rule.stateKey)}
                      style={{
                        padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer',
                        background: isEnabled ? 'rgba(200,40,40,0.15)' : 'rgba(26,108,188,0.15)',
                        color: isEnabled ? '#f87171' : '#4a9eff'
                      }}
                    >
                      {isEnabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>

                {isEnabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 20, borderTop: '1px solid var(--border-2)', paddingTop: 18 }}>
                    {/* Max Weight Sliders */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>Maximum Rule Score Contribution Cap</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--gold)' }}>{config[rule.maxKey]} pts</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="100"
                        value={config[rule.maxKey]}
                        onChange={(e) => handleMaxWeightChange(rule.maxKey, e.target.value)}
                        style={{ width: '100%', accentColor: 'var(--gold)' }}
                      />
                    </div>

                    {/* Parameters Settings */}
                    <div>
                      <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                        Trigger Thresholds
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {rule.params.map(param => {
                          const val = param.objectPath === 'MULE'
                            ? config.MULE[param.key]
                            : config.BEHAVIOUR[param.key];
                          const displayVal = param.multiplier ? val / param.multiplier : val;
                          
                          return (
                            <div key={param.key}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <label style={{ fontSize: 12, color: 'var(--text-2)' }}>{param.label}</label>
                                <span style={{ fontSize: 12, fontWeight: 700, color: '#4a9eff' }}>
                                  {param.key.includes('THRESHOLD_INR') ? `₹${displayVal.toLocaleString('en-IN')}` : displayVal}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={param.min}
                                max={param.max}
                                step={param.step}
                                value={displayVal}
                                onChange={(e) => {
                                  const realValue = param.multiplier ? Number(e.target.value) * param.multiplier : Number(e.target.value);
                                  if (param.objectPath === 'MULE') {
                                    setConfig(prev => {
                                      const updatedMule = { ...prev.MULE, [param.key]: realValue };
                                      return { ...prev, MULE: updatedMule };
                                    });
                                  } else {
                                    handleBehaviourChange(param.key, realValue);
                                  }
                                }}
                                style={{ width: '100%', accentColor: '#4a9eff' }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Score Modifiers */}
                    <div>
                      <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                        Score Modifiers & Multipliers
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        {rule.modifiers.map(mod => {
                          const val = mod.objectPath === 'MULE'
                            ? config.MULE[mod.key]
                            : config.MODIFIERS[mod.key];
                          return (
                            <div key={mod.key} style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-2)', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 11.5, color: 'var(--text-2)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                                {mod.label}
                              </span>
                              <input
                                type="number"
                                value={val}
                                onChange={(e) => {
                                  if (mod.objectPath === 'MULE') {
                                    setConfig(prev => {
                                      const updatedMule = { ...prev.MULE, [mod.key]: Number(e.target.value) };
                                      return { ...prev, MULE: updatedMule };
                                    });
                                  } else {
                                    handleModifierChange(mod.key, e.target.value);
                                  }
                                }}
                                style={{
                                  width: 54, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 4,
                                  color: mod.isNegative ? '#f87171' : '#10b981', textAlign: 'center', fontWeight: 600, fontSize: 12, padding: '3px 0'
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Unified Chain Trace Tester Tab */
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 28, alignItems: 'start' }}>
          
          {/* Left Column: Chain Builder */}
          <div className="glass-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Layers size={18} color="#10b981" />
                  Transaction Chain Builder
                </h3>
                <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4 }}>
                  Build an ordered chain of transactions to evaluate multi-hop AML rules.
                </p>
              </div>
              <button
                type="button"
                onClick={clearChain}
                style={{
                  background: 'transparent', border: '1px solid var(--border-2)', color: 'var(--text-3)',
                  padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600,
                  transition: 'all 0.2s'
                }}
              >
                Clear Chain
              </button>
            </div>

            {/* Quick Scenario Preset Selector */}
            <div style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-2)', borderRadius: 8, padding: 14, marginBottom: 20 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                Quick-Load Fraud Scenario Presets
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" onClick={() => applyPatternPreset('structuring')} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Structuring (Smurfing)
                </button>
                <button type="button" onClick={() => applyPatternPreset('layering')} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Layering (Multi-Hop)
                </button>
                <button type="button" onClick={() => applyPatternPreset('fanout')} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(249,115,22,0.25)', background: 'rgba(249,115,22,0.1)', color: '#f97316', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Fan-Out (Dispersal)
                </button>
                <button type="button" onClick={() => applyPatternPreset('velocity')} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(16,185,129,0.25)', background: 'rgba(16,185,129,0.1)', color: '#10b981', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Velocity Burst
                </button>
                <button type="button" onClick={() => applyPatternPreset('dormant')} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(74,158,255,0.25)', background: 'rgba(74,158,255,0.1)', color: '#4a9eff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Dormant Activation
                </button>
              </div>
            </div>

            {/* Steps Form List */}
            <form onSubmit={runChainTrace} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '550px', overflowY: 'auto', paddingRight: 6 }}>
                {chainRows.map((row, index) => (
                  <div 
                    key={row.id} 
                    style={{ 
                      position: 'relative',
                      border: '1px solid var(--border-2)', 
                      borderRadius: 10, 
                      padding: '16px 16px 16px 20px', 
                      background: 'rgba(255,255,255,0.015)' 
                    }}
                  >
                    {/* Left connection bar indicator */}
                    <div style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, 
                      borderRadius: '10px 0 0 10px',
                      background: index === 0 ? '#10b981' : 'linear-gradient(180deg, #10b981, #4a9eff)'
                    }} />

                    {/* Step label header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-2)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--border-2)', color: 'var(--text-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>
                          {index + 1}
                        </span>
                        Transaction Step
                      </span>
                      <button
                        type="button"
                        onClick={() => removeChainStep(row.id)}
                        disabled={chainRows.length === 1}
                        style={{ 
                          display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 6, 
                          border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)', color: '#f87171', 
                          fontSize: 11, fontWeight: 700, cursor: chainRows.length === 1 ? 'not-allowed' : 'pointer', 
                          opacity: chainRows.length === 1 ? 0.3 : 1 
                        }}
                      >
                        <Trash2 size={12} />
                        Remove
                      </button>
                    </div>

                    {/* Accounts fields */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)', marginBottom: 5 }}>Sender Account</label>
                        <select
                          value={row.sender}
                          onChange={(e) => updateChainStep(row.id, 'sender', e.target.value)}
                          style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-1)', fontSize: 12.5 }}
                        >
                          <option value="">Select sender</option>
                          {accounts.map(acc => (
                            <option key={acc.account_id} value={acc.account_id}>
                              {acc.account_id} — {acc.customer_name} ({acc.account_type})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)', marginBottom: 5 }}>Receiver Account</label>
                        <select
                          value={row.receiver}
                          onChange={(e) => updateChainStep(row.id, 'receiver', e.target.value)}
                          style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-1)', fontSize: 12.5 }}
                        >
                          <option value="">Select receiver</option>
                          {accounts.map(acc => (
                            <option key={acc.account_id} value={acc.account_id}>
                              {acc.account_id} — {acc.customer_name} ({acc.account_type})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Amount & Time Gap */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)', marginBottom: 5 }}>Amount (INR)</label>
                        <input
                          type="number"
                          value={row.amount}
                          onChange={(e) => updateChainStep(row.id, 'amount', e.target.value)}
                          placeholder="e.g. 48500"
                          style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-1)', fontSize: 12.5 }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)', marginBottom: 5 }} title="Offset in seconds from chain start to determine frequency/velocity">
                          Time Gap (Offset in Seconds)
                        </label>
                        <input
                          type="number"
                          value={row.ts_offset_seconds}
                          onChange={(e) => updateChainStep(row.id, 'ts_offset_seconds', e.target.value)}
                          placeholder="Leave blank for auto 45s gap"
                          style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-1)', fontSize: 12.5 }}
                        />
                      </div>
                    </div>

                    {/* Metadata fields */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginBottom: 5 }}>Tx Type</label>
                        <select
                          value={row.transaction_type}
                          onChange={(e) => updateChainStep(row.id, 'transaction_type', e.target.value)}
                          style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text-1)', fontSize: 12 }}
                        >
                          {['NEFT', 'RTGS', 'UPI', 'IMPS', 'WIRE'].map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginBottom: 5 }}>Channel</label>
                        <select
                          value={row.channel}
                          onChange={(e) => updateChainStep(row.id, 'channel', e.target.value)}
                          style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text-1)', fontSize: 12 }}
                        >
                          {['MOBILE', 'NET_BANKING', 'API'].map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginBottom: 5 }}>City Origin</label>
                        <select
                          value={row.city}
                          onChange={(e) => updateChainStep(row.id, 'city', e.target.value)}
                          style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text-1)', fontSize: 12 }}
                        >
                          {['Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Pune', 'Kolkata', 'Dubai', 'Singapore'].map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Form trigger bar */}
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={addChainStep}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '12px 18px', borderRadius: 8, border: '1px dashed rgba(74,158,255,0.4)',
                    background: 'rgba(74,158,255,0.06)', color: 'var(--blue-2)', fontWeight: 700, fontSize: 13,
                    cursor: 'pointer', transition: 'all 0.2s'
                  }}
                >
                  <Plus size={15} />
                  Add Chain Step
                </button>

                <button
                  type="submit"
                  disabled={tracing}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '12px 18px', borderRadius: 8, border: 'none',
                    background: 'linear-gradient(135deg, #10b981, #0f766e)', color: '#fff',
                    fontWeight: 700, fontSize: 13, cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(16,185,129,0.25)', transition: 'all 0.2s'
                  }}
                >
                  {tracing ? <RefreshCw className="animate-spin" size={15} /> : <Play size={15} />}
                  {tracing ? 'Evaluating Chain...' : 'Run Chain Trace Evaluation'}
                </button>
              </div>
            </form>
          </div>

          {/* Right Column: Telemetry Output */}
          <div className="glass-card" style={{ padding: 24, minHeight: 650 }}>
            {chainResults ? (
              <div>
                {/* Steps Flow Map Header */}
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Evaluation Chain Path ({chainResults.length} Steps)
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {chainResults.map((stepResult, idx) => {
                      const score = stepResult.result.finalScore;
                      const isSelected = activeResultStep === idx;
                      const severityColor = score >= 60 ? 'var(--danger-2)' : score >= 30 ? 'var(--gold)' : 'var(--success-2)';
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setActiveResultStep(idx)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8,
                            border: `2px solid ${isSelected ? severityColor : 'var(--border-2)'}`,
                            background: isSelected ? `rgba(255,255,255,0.02)` : 'transparent',
                            color: 'var(--text-1)', fontSize: 12, cursor: 'pointer', fontWeight: 600,
                            transition: 'all 0.2s'
                          }}
                        >
                          <span style={{ width: 18, height: 18, borderRadius: '50%', background: severityColor, color: '#000', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800 }}>
                            {idx + 1}
                          </span>
                          <span>
                            {stepResult.transaction.sender} → {stepResult.transaction.receiver}
                          </span>
                          <span style={{ color: severityColor, fontWeight: 800 }}>
                            ({score} pts)
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Selected Step Result details */}
                {chainResults[activeResultStep] && (
                  <div style={{ borderTop: '1px solid var(--border-2)', paddingTop: 20 }}>
                    {/* Summary Bar */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20, padding: 18, borderRadius: 10, background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-2)', marginBottom: 24 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Composite Score</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: chainResults[activeResultStep].result.finalScore >= 60 ? 'var(--danger-2)' : chainResults[activeResultStep].result.finalScore >= 30 ? 'var(--gold)' : 'var(--success-2)' }}>
                          {chainResults[activeResultStep].result.finalScore} / 100
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Risk Classification</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', marginTop: 4 }}>
                          {chainResults[activeResultStep].result.riskLevel}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recommended Investigator Action</div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#4a9eff', marginTop: 4 }}>
                          {chainResults[activeResultStep].result.action}
                        </div>
                      </div>
                    </div>

                    {/* Metadata Detail */}
                    <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border-2)', borderRadius: 8, padding: 14, marginBottom: 20 }}>
                      <h5 style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                        Transaction Step metadata
                      </h5>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, fontSize: 12 }}>
                        <div><span style={{ color: 'var(--text-3)' }}>Origin:</span> {chainResults[activeResultStep].transaction.geo_origin?.city || 'N/A'}</div>
                        <div><span style={{ color: 'var(--text-3)' }}>Type:</span> {chainResults[activeResultStep].transaction.transaction_type}</div>
                        <div><span style={{ color: 'var(--text-3)' }}>Channel:</span> {chainResults[activeResultStep].transaction.channel}</div>
                        <div><span style={{ color: 'var(--text-3)' }}>Amount:</span> ₹{Number(chainResults[activeResultStep].transaction.amount).toLocaleString('en-IN')}</div>
                        <div><span style={{ color: 'var(--text-3)' }}>Offset:</span> {chainResults[activeResultStep].transaction.ts_offset_seconds ?? '45'}s</div>
                        <div><span style={{ color: 'var(--text-3)' }}>ID:</span> {chainResults[activeResultStep].transaction.tx_id}</div>
                      </div>
                    </div>

                    {/* Explanation text */}
                    <div style={{ marginBottom: 24 }}>
                      <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', marginBottom: 8 }}>Rationale Explanation</h4>
                      <p style={{ fontSize: 12.5, color: 'var(--text-3)', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-2)', borderRadius: 8, padding: 14, lineHeight: 1.5 }}>
                        {chainResults[activeResultStep].result.explanation?.summary || 'No explanation summary available.'}
                      </p>
                    </div>

                    {/* Trace list one-by-one */}
                    <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', marginBottom: 14 }}>One-by-One Detection Check Breakdown</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                      {chainResults[activeResultStep].result.traces.map(trace => {
                        return (
                          <div key={trace.ruleName} style={{ border: '1px solid var(--border-2)', borderRadius: 8, overflow: 'hidden' }}>
                            {/* Header of Rule Trace */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-2)' }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: '#4a9eff' }}>{trace.ruleName}</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: trace.score > 0 ? 'var(--gold)' : 'var(--text-3)' }}>
                                Contribution: +{trace.score} (Raw: {trace.rawScore ?? trace.score})
                              </span>
                            </div>

                            {/* List of subchecks */}
                            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, background: 'rgba(0,0,0,0.1)' }}>
                              {trace.checks && trace.checks.length > 0 ? (
                                trace.checks.map((chk, idx) => (
                                  <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                    <div style={{ marginTop: 2 }}>
                                      {chk.matched ? (
                                        <AlertTriangle size={14} color={chk.scoreEffect < 0 ? '#4a9eff' : '#ef4444'} />
                                      ) : (
                                        <Check size={14} color="#22c55e" />
                                      )}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                        <span style={{ fontSize: 12.5, fontWeight: 600, color: chk.matched ? 'var(--text-1)' : 'var(--text-3)' }}>
                                          {chk.name}
                                        </span>
                                        {chk.matched && (
                                          <span style={{ fontSize: 11, fontWeight: 700, color: chk.scoreEffect < 0 ? '#3b82f6' : '#ef4444' }}>
                                            {chk.scoreEffect < 0 ? '' : '+'}{chk.scoreEffect} pts
                                          </span>
                                        )}
                                      </div>
                                      <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>
                                        {chk.description}
                                      </div>
                                      {chk.details && (
                                        <div style={{ fontSize: 11.5, fontFamily: 'monospace', color: chk.matched ? 'var(--gold)' : 'var(--text-3)', marginTop: 4, background: 'rgba(255,255,255,0.01)', padding: '3px 8px', borderRadius: 4, display: 'inline-block' }}>
                                          {chk.details}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
                                  Rule was bypassed or no checks triggered.
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-3)', minHeight: 400 }}>
                <div style={{ textAlign: 'center' }}>
                  <Eye size={42} color="var(--border)" style={{ margin: '0 auto 12px' }} />
                  <p style={{ fontSize: 13.5 }}>Configure a sequence of transaction steps or click a scenario preset to get started.</p>
                  <p style={{ fontSize: 12.5, color: 'var(--text-4)', marginTop: 4 }}>
                    Clicking "Run Chain Trace Evaluation" triggers dynamic telemetry mapping in the rule engine.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
