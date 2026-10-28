/**
 * Simulation Studio — Live Event Console
 * Real-time stream of Socket.IO events with auto-scroll and color coding.
 */
import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../../contexts/SocketContext';
import { Terminal, Trash2, Pause, Play } from 'lucide-react';

const EVENT_CONFIG = {
  new_transaction:     { color: '#4a9eff', label: 'TXN CREATED',  icon: '💳' },
  transaction_flagged: { color: '#ef4444', label: 'FRAUD FLAGGED', icon: '🚨' },
  new_alert:           { color: '#f59e0b', label: 'ALERT RAISED', icon: '⚠' },
  account_created:     { color: '#22c55e', label: 'ACCOUNT ADDED', icon: '🏦' },
};

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function EventConsole() {
  const [events, setEvents] = useState([]);
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef(null);
  const pausedRef = useRef(false);

  pausedRef.current = paused;

  // Listen directly on the socket via context
  const { on } = useSocket();

  const addEvent = (type, data) => {
    if (pausedRef.current) return;
    const cfg = EVENT_CONFIG[type] || { color: '#94a3b8', label: type, icon: '·' };
    const entry = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      timestamp: Date.now(),
      color: cfg.color,
      label: cfg.label,
      icon: cfg.icon,
      summary: buildSummary(type, data),
      detail: buildDetail(type, data),
      flagged: data?.anomaly_flag || data?.severity === 'CRITICAL',
    };
    setEvents(prev => [entry, ...prev].slice(0, 100));
  };

  function buildSummary(type, d) {
    if (type === 'new_transaction') return `${d?.sender} → ${d?.receiver}  ₹${Number(d?.amount || 0).toLocaleString('en-IN')}`;
    if (type === 'transaction_flagged') return `${d?.tx_id}  [${d?.fraud_type}]  Risk ${d?.risk_score}`;
    if (type === 'new_alert') return `${d?.alert_type}  ${d?.severity}  ${d?.description?.slice(0, 60)}...`;
    if (type === 'account_created') return `${d?.account_id}  ${d?.customer_name}  [${d?.account_type}]`;
    return JSON.stringify(d)?.slice(0, 80);
  }

  function buildDetail(type, d) {
    if (type === 'new_transaction') return `${d?.transaction_type} · ${d?.channel} · TX: ${d?.tx_id}`;
    if (type === 'transaction_flagged') return `Rule flags: ${d?.rule_flags?.join(', ') || 'none'}`;
    if (type === 'new_alert') return `Alert ID: ${d?.alert_id} · Status: ${d?.status}`;
    if (type === 'account_created') return `Balance: ₹${Number(d?.balance || 0).toLocaleString('en-IN')} · KYC: ${d?.kyc_level}`;
    return '';
  }

  useEffect(() => {
    const unsubscribers = Object.keys(EVENT_CONFIG).map(type => {
      return on(type, (data) => addEvent(type, data));
    });
    return () => unsubscribers.forEach(unsub => unsub?.());
  }, [on]);

  // Auto-scroll to top (newest events are at top)
  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [events.length]);

  const clearEvents = () => setEvents([]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(26,108,188,0.12)', border: '1px solid rgba(26,108,188,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Terminal size={17} color="var(--blue-2)" />
        </div>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>Live Event Console</h2>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Real-time Socket.IO stream · Last {events.length}/100 events</p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => setPaused(p => !p)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, background: paused ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)', border: `1px solid ${paused ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`, color: paused ? '#22c55e' : '#f59e0b', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            {paused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
          </button>
          <button onClick={clearEvents} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            <Trash2 size={12} /> Clear
          </button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        {Object.entries(EVENT_CONFIG).map(([type, cfg]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color }} />
            <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontWeight: 600 }}>{cfg.label}</span>
          </div>
        ))}
        {paused && (
          <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#f59e0b', fontWeight: 700, background: 'rgba(245,158,11,0.1)', padding: '2px 8px', borderRadius: 4 }}>⏸ PAUSED</span>
        )}
      </div>

      {/* Terminal window */}
      <div style={{
        background: '#040c14',
        border: '1px solid rgba(26,108,188,0.2)',
        borderRadius: 12,
        height: 480,
        overflowY: 'auto',
        fontFamily: 'JetBrains Mono, Consolas, monospace',
        fontSize: 12,
        padding: '12px 4px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}>
        {events.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: 'rgba(255,255,255,0.15)' }}>
            <Terminal size={32} />
            <p style={{ fontSize: 12 }}>Waiting for events… create a transaction or run a scenario above.</p>
          </div>
        ) : (
          events.map((ev) => (
            <div key={ev.id} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 0,
              padding: '5px 12px',
              borderBottom: '1px solid rgba(255,255,255,0.03)',
              background: ev.flagged ? 'rgba(239,68,68,0.04)' : 'transparent',
              transition: 'background 0.3s',
            }}>
              {/* Time */}
              <span style={{ color: 'rgba(255,255,255,0.3)', minWidth: 74, fontSize: 11 }}>{formatTime(ev.timestamp)}</span>
              {/* Icon */}
              <span style={{ minWidth: 22 }}>{ev.icon}</span>
              {/* Label badge */}
              <span style={{ color: ev.color, minWidth: 130, fontWeight: 700, fontSize: 10.5, letterSpacing: '0.04em' }}>{ev.label}</span>
              {/* Summary */}
              <span style={{ color: ev.flagged ? '#fca5a5' : 'rgba(255,255,255,0.7)', flex: 1 }}>{ev.summary}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <p style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 8, textAlign: 'right' }}>
        Listening on: <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3 }}>new_transaction</code> · <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3 }}>transaction_flagged</code> · <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3 }}>new_alert</code> · <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3 }}>account_created</code>
      </p>
    </div>
  );
}
