/**
 * Simulation Studio — Main Container
 * Tabbed interface housing: Account Builder, Transaction Console,
 * Scenario Generator, and Live Event Console.
 */
import { useState } from 'react';
import { Beaker, UserPlus, Send, Zap, Terminal } from 'lucide-react';
import AccountBuilder from './AccountBuilder';
import TransactionConsole from './TransactionConsole';
import ScenarioGenerator from './ScenarioGenerator';
import EventConsole from './EventConsole';

const TABS = [
  { id: 'accounts',     label: 'Account Builder',     icon: UserPlus,  component: AccountBuilder },
  { id: 'transaction',  label: 'Transaction Console',  icon: Send,      component: TransactionConsole },
  { id: 'scenarios',    label: 'Scenario Generator',   icon: Zap,       component: ScenarioGenerator },
  { id: 'console',      label: 'Live Event Console',   icon: Terminal,  component: EventConsole },
];

export default function SimulationStudio() {
  const [activeTab, setActiveTab] = useState('accounts');
  const [accountRefreshKey, setAccountRefreshKey] = useState(0);

  const onAccountCreated = () => setAccountRefreshKey(k => k + 1);

  const ActiveComponent = TABS.find(t => t.id === activeTab)?.component;

  return (
    <div style={{ padding: 24, maxWidth: 1300 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 11,
          background: 'linear-gradient(135deg, rgba(26,108,188,0.3), rgba(201,168,76,0.2))',
          border: '1px solid rgba(26,108,188,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 24px rgba(26,108,188,0.2)',
        }}>
          <Beaker size={22} color="#4a9eff" />
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.02em', lineHeight: 1 }}>
            Simulation Studio
          </h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 5 }}>
            Manual transaction control · Routes through the exact same pipeline as the auto simulator
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: 20, background: 'rgba(26,108,188,0.1)', border: '1px solid rgba(26,108,188,0.25)' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e', animation: 'pulse 2s infinite' }} />
          <span style={{ fontSize: 10.5, color: '#4a9eff', fontWeight: 700, letterSpacing: '0.1em' }}>LIVE PIPELINE</span>
        </div>
      </div>

      {/* Pipeline banner */}
      <div style={{ padding: '12px 18px', borderRadius: 10, background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.18)', marginBottom: 22, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {['Account / Transaction', '→ emitTransaction()', '→ detectFraud()', '→ createAlert()', '→ Socket.IO', '→ All Pages'].map((step, i) => (
          <span key={i} style={{ fontSize: 11.5, fontFamily: i > 0 ? 'JetBrains Mono, monospace' : 'inherit', color: i === 0 ? 'var(--text-2)' : i === 5 ? '#22c55e' : '#c9a84c', fontWeight: i === 0 ? 400 : 600 }}>
            {step}
          </span>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 22, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 10, padding: 4 }}>
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              id={`tab-studio-${id}`}
              onClick={() => setActiveTab(id)}
              style={{
                flex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                padding: '9px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
                border: 'none', cursor: 'pointer', transition: 'all 0.2s',
                background: isActive ? 'rgba(26,108,188,0.18)' : 'transparent',
                color: isActive ? 'var(--blue-2)' : 'var(--text-3)',
                boxShadow: isActive ? 'inset 0 0 0 1px rgba(26,108,188,0.3)' : 'none',
              }}
            >
              <Icon size={14} />
              <span style={{ display: 'none' }}>{/* mobile hide */}</span>
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Content area */}
      <div className="glass-card" style={{ padding: '26px 28px', minHeight: 520 }}>
        {ActiveComponent && (
          <ActiveComponent
            onAccountCreated={activeTab === 'accounts' ? onAccountCreated : undefined}
            refreshTrigger={accountRefreshKey}
          />
        )}
      </div>
    </div>
  );
}
