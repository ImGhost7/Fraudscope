/**
 * Simulation Studio — Fraud Scenario Generator
 * One-click buttons that fire real backend scenarios through the existing pipeline.
 */
import { useState } from 'react';
import { simulatorApi } from '../../services/api';
import { Zap, GitBranch, Layers, Users, Moon, Skull, CheckCircle2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

const SCENARIOS = [
  {
    id: 'layering',
    label: 'Generate Layering',
    icon: Layers,
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.25)',
    desc: 'Creates a 4-5 hop chain where funds move through shell accounts, each hop reducing by 15%. Classic money layering pattern.',
    result_key: 'hops',
    result_label: 'hops executed',
  },
  {
    id: 'structuring',
    label: 'Generate Structuring',
    icon: GitBranch,
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.25)',
    desc: 'Sends 4 transactions of ₹43k–₹49.8k — just below the ₹50k RBI reporting threshold. Triggers structuring alert.',
    result_key: 'count',
    result_label: 'transactions created',
  },
  {
    id: 'fanout',
    label: 'Generate Fan-Out',
    icon: Users,
    color: '#f97316',
    bg: 'rgba(249,115,22,0.08)',
    border: 'rgba(249,115,22,0.25)',
    desc: 'One shell account distributes funds to 8 normal accounts simultaneously. Classic mule network activation pattern.',
    result_key: 'receivers',
    result_label: 'receivers funded',
  },
  {
    id: 'dormant',
    label: 'Generate Dormant Activation',
    icon: Moon,
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.08)',
    border: 'rgba(139,92,246,0.25)',
    desc: 'Sends ₹1L–₹5L to a dormant account (inactive 1+ year). Triggers DORMANT_ACTIVATION CRITICAL alert.',
    result_key: 'amount',
    result_label: 'amount transferred',
    format: v => `₹${Number(v).toLocaleString('en-IN')}`,
  },
  {
    id: 'mule',
    label: 'Generate Mule Transfer',
    icon: Skull,
    color: '#6b7280',
    bg: 'rgba(107,114,128,0.08)',
    border: 'rgba(107,114,128,0.25)',
    desc: 'Transfers ₹1L–₹4L from a normal account to a known MULE account. Triggers MULE_TRANSFER HIGH alert.',
    result_key: 'amount',
    result_label: 'amount to mule',
    format: v => `₹${Number(v).toLocaleString('en-IN')}`,
  },
];

export default function ScenarioGenerator() {
  const [running, setRunning] = useState(null);
  const [results, setResults] = useState({});

  const run = async (scenario) => {
    setRunning(scenario.id);
    try {
      const result = await simulatorApi.runScenario(scenario.id);
      setResults(r => ({ ...r, [scenario.id]: result }));
      const count = result[scenario.result_key];
      const formatted = scenario.format ? scenario.format(count) : count;
      toast.success(`🚨 ${scenario.label}: ${formatted} ${scenario.result_label}`);
    } catch (err) {
      toast.error(err?.error || `Failed to run ${scenario.label}`);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Zap size={17} color="#ef4444" />
        </div>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>Fraud Scenario Generator</h2>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>One-click fraud patterns — all run through the exact same pipeline as the auto simulator</p>
        </div>
      </div>

      <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(201,168,76,0.07)', border: '1px solid rgba(201,168,76,0.2)', marginBottom: 22, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <AlertTriangle size={14} color="#c9a84c" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
          Each scenario calls <code style={{ fontFamily: 'JetBrains Mono, monospace', background: 'rgba(255,255,255,0.07)', padding: '1px 5px', borderRadius: 3 }}>emitTransaction()</code> → <code style={{ fontFamily: 'JetBrains Mono, monospace', background: 'rgba(255,255,255,0.07)', padding: '1px 5px', borderRadius: 3 }}>detectFraud()</code> → <code style={{ fontFamily: 'JetBrains Mono, monospace', background: 'rgba(255,255,255,0.07)', padding: '1px 5px', borderRadius: 3 }}>createAlert()</code>. Transactions appear immediately in Live Transactions, Fund Flow Graph, Alerts, and Dashboard.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        {SCENARIOS.map(s => {
          const Icon = s.icon;
          const res = results[s.id];
          const isRunning = running === s.id;

          return (
            <div key={s.id} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', overflow: 'hidden' }}>
              {/* Glow orb */}
              <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: `radial-gradient(circle, ${s.color}20, transparent)`, pointerEvents: 'none' }} />

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: `${s.color}1a`, border: `1px solid ${s.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={18} color={s.color} />
                </div>
                <div>
                  <p style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.2 }}>{s.label.replace('Generate ', '')}</p>
                  <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>{s.desc}</p>
                </div>
              </div>

              {/* Result */}
              {res && (
                <div style={{ padding: '8px 10px', borderRadius: 7, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)', display: 'flex', alignItems: 'center', gap: 7 }}>
                  <CheckCircle2 size={13} color="#22c55e" />
                  <span style={{ fontSize: 11.5, color: '#22c55e', fontWeight: 600 }}>
                    {s.format ? s.format(res[s.result_key]) : res[s.result_key]} {s.result_label}
                  </span>
                  {res.tx_ids && <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 'auto' }}>{res.tx_ids.length} txns</span>}
                </div>
              )}

              <button
                id={`btn-scenario-${s.id}`}
                onClick={() => run(s)}
                disabled={isRunning || running !== null}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: s.color, color: '#fff', border: 'none', cursor: isRunning || running !== null ? 'not-allowed' : 'pointer',
                  opacity: running !== null && !isRunning ? 0.5 : 1,
                  transition: 'all 0.2s', boxShadow: `0 4px 16px ${s.color}40`,
                }}
              >
                {isRunning
                  ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2, borderColor: `#fff4`, borderTopColor: '#fff' }} /> Running...</>
                  : <><Icon size={14} /> {s.label}</>
                }
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
