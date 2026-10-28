import { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { txApi } from '../services/api';
import { useSocket } from '../contexts/SocketContext';
import { Filter, AlertTriangle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

const FRAUD_TYPE_COLOR = {
  NONE: 'var(--success-2)',
  STRUCTURING: 'var(--warning-2)',
  LAYERING: 'var(--danger-2)',
  ROUND_TRIP: 'var(--danger-2)',
  DORMANT_ACTIVATION: 'var(--gold)',
  FAN_OUT: 'var(--warning-2)',
  MULE: 'var(--danger-2)',
  HIGH_VELOCITY: 'var(--warning-2)',
};

const TX_TYPE_COLOR = {
  UPI: 'var(--blue-2)', NEFT: 'var(--gold)', RTGS: 'var(--warning-2)', IMPS: 'var(--success-2)', CASH: 'var(--text-3)', WIRE: 'var(--danger-2)'
};

function TxBadge({ type, label }) {
  const color = type === 'fraud' ? FRAUD_TYPE_COLOR[label] || 'var(--text-3)' : TX_TYPE_COLOR[label] || 'var(--text-3)';
  return (
    <span style={{
      display: 'inline-block', padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
      background: type === 'fraud' && label !== 'NONE' ? `rgba(200,40,40,0.1)` : 'rgba(26,108,188,0.1)',
      color, border: `1px solid ${color}44`, letterSpacing: '0.04em', textTransform: 'uppercase'
    }}>
      {label?.replace(/_/g, ' ')}
    </span>
  );
}

function RiskBar({ score }) {
  const color = score >= 70 ? 'var(--danger-2)' : score >= 40 ? 'var(--warning-2)' : 'var(--success-2)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="risk-bar" style={{ width: 60, height: 5, borderRadius: 2.5, background: 'var(--surface)' }}>
        <div className="risk-bar-fill" style={{ width: `${score}%`, background: color, borderRadius: 2.5 }} />
      </div>
      <span style={{ fontSize: 11, color, fontWeight: 700 }}>{score}</span>
    </div>
  );
}

export default function TransactionsPage() {
  const { liveTransactions, connected, on } = useSocket();
  const [allTxs, setAllTxs] = useState([]);
  const [filter, setFilter] = useState({ flagged: false, fraud_type: 'ALL' });
  const [newIds, setNewIds] = useState(new Set());
  const tableRef = useRef(null);

  // When fraud engine finishes (async), update the enriched tx in allTxs in-place
  useEffect(() => {
    const unsub = on('transaction_updated', (tx) => {
      setAllTxs(prev => {
        const exists = prev.some(t => t.tx_id === tx.tx_id);
        if (exists) return prev.map(t => t.tx_id === tx.tx_id ? tx : t);
        return [tx, ...prev.slice(0, 149)];
      });
    });
    return unsub;
  }, [on]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['transactions', filter],
    queryFn: () => txApi.getAll({ flagged: filter.flagged || undefined, fraud_type: filter.fraud_type !== 'ALL' ? filter.fraud_type : undefined, limit: 100 }),
  });

  useEffect(() => {
    const baseTxs = data?.transactions || [];
    const live = liveTransactions.slice(0, 50);
    const combined = [...live, ...baseTxs.filter(t => !live.find(l => l.tx_id === t.tx_id))];
    setAllTxs(combined.slice(0, 150));
  }, [data, liveTransactions]);

  useEffect(() => {
    if (liveTransactions.length > 0) {
      const latest = liveTransactions[0];
      setNewIds(prev => new Set([...prev, latest.tx_id]));
      setTimeout(() => setNewIds(prev => { const n = new Set(prev); n.delete(latest.tx_id); return n; }), 2000);

      if (latest.anomaly_flag) {
        toast.custom(() => (
          <div className="toast-fraud">
            <AlertTriangle size={18} color="var(--danger-2)" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Transaction Flagged</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{latest.fraud_type?.replace(/_/g,' ')} • ₹{Number(latest.amount).toLocaleString('en-IN', {maximumFractionDigits:0})}</div>
            </div>
          </div>
        ), { duration: 5000 });
      }
    }
  }, [liveTransactions]);

  const displayed = allTxs.filter(tx => {
    if (filter.flagged && !tx.anomaly_flag) return false;
    if (filter.fraud_type !== 'ALL' && tx.fraud_type !== filter.fraud_type) return false;
    return true;
  });

  return (
    <div style={{ padding: 24 }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-1)' }}>Live Transaction Monitor</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <div className="pulse-dot" style={{ width: 6, height: 6, background: connected ? 'var(--success-2)' : 'var(--danger-2)' }} />
            <span style={{ fontSize: 12, color: connected ? 'var(--success-2)' : 'var(--danger-2)', fontWeight: 600 }}>
              {connected ? 'Real-time stream active' : 'Connecting...'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>• {displayed.length} transactions</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => refetch()} className="btn-ghost">
            <RefreshCw size={14} />Refresh
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="glass-card" style={{ padding: '14px 18px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Filter size={15} color="var(--text-3)" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-2)', fontWeight: 500 }}>
          <input
            type="checkbox"
            checked={filter.flagged}
            onChange={e => setFilter(f => ({ ...f, flagged: e.target.checked }))}
            style={{ accentColor: 'var(--danger-2)' }}
          />
          Flagged Only
        </label>
        <select
          value={filter.fraud_type}
          onChange={e => setFilter(f => ({ ...f, fraud_type: e.target.value }))}
          className="cyber-input"
          style={{ width: 180 }}
        >
          <option value="ALL">All Fraud Types</option>
          <option value="STRUCTURING">Structuring</option>
          <option value="LAYERING">Layering</option>
          <option value="FAN_OUT">Fan-Out</option>
          <option value="DORMANT_ACTIVATION">Dormant Activation</option>
          <option value="MULE_TRANSFER">Mule Transfer</option>
          <option value="HIGH_VELOCITY">High Velocity</option>
          <option value="NONE">Clean</option>
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <span style={{ fontSize: 11.5, color: 'var(--danger-2)', fontWeight: 700, padding: '4px 10px', borderRadius: 6, background: 'rgba(200,40,40,0.1)', border: '1px solid rgba(200,40,40,0.25)' }}>
            {displayed.filter(t => t.anomaly_flag).length} Flagged
          </span>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="glass-card card-gold-top" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }} ref={tableRef}>
          <table className="cyber-table">
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 5 }}>
              <tr>
                <th>Transaction ID</th>
                <th>Sender</th>
                <th>Receiver</th>
                <th>Amount (INR)</th>
                <th>Type</th>
                <th>Risk Score</th>
                <th>Fraud Type</th>
                <th>Status</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && displayed.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40 }}>
                  <div className="spinner" style={{ margin: '0 auto' }} />
                </td></tr>
              ) : displayed.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                  No transactions yet. Simulator starting...
                </td></tr>
              ) : displayed.map((tx, i) => (
                <tr
                  key={tx.tx_id || i}
                  className={tx.anomaly_flag ? 'flagged' : ''}
                  style={{
                    animation: newIds.has(tx.tx_id) ? 'slideInRow 0.5s ease-out' : undefined,
                    borderLeft: tx.anomaly_flag ? '3px solid var(--danger-2)' : '3px solid transparent'
                  }}
                >
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--blue-2)' }}>{tx.tx_id?.slice(0, 16)}</td>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-2)' }}>{tx.sender}</td>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-2)' }}>{tx.receiver}</td>
                  <td style={{ fontWeight: 700, color: 'var(--text-1)' }}>
                    ₹{Number(tx.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </td>
                  <td><TxBadge label={tx.transaction_type} /></td>
                  <td><RiskBar score={tx.risk_score || 0} /></td>
                  <td>
                    <TxBadge type="fraud" label={tx.fraud_type || 'NONE'} />
                  </td>
                  <td>
                    {tx.anomaly_flag
                      ? <span className="badge badge-critical">FLAGGED</span>
                      : <span className="badge badge-success">CLEAN</span>
                    }
                  </td>
                  <td style={{ color: 'var(--text-3)', fontSize: 11 }}>
                    {tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString('en-IN') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
