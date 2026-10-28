import { useQuery } from '@tanstack/react-query';
import { accountApi } from '../services/api';
import { useState } from 'react';
import { Filter, AlertTriangle, CheckCircle } from 'lucide-react';

const TYPE_COLOR = { SAVINGS: 'var(--blue-2)', CURRENT: 'var(--blue-2)', SHELL: 'var(--warning-2)', MULE: 'var(--danger-2)' };
const STATUS_COLOR = { ACTIVE: 'var(--success-2)', DORMANT: 'var(--gold)', FROZEN: 'var(--border-2)', SUSPICIOUS: 'var(--danger-2)' };

function RiskBar({ score }) {
  const color = score >= 70 ? 'var(--danger-2)' : score >= 40 ? 'var(--warning-2)' : 'var(--success-2)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="risk-bar" style={{ width: 50, height: 5, borderRadius: 2.5, background: 'var(--surface)' }}>
        <div className="risk-bar-fill" style={{ width: `${Math.min(score, 100)}%`, background: color, borderRadius: 2.5 }} />
      </div>
      <span style={{ fontSize: 11, color, fontWeight: 700, minWidth: 24 }}>{score}</span>
    </div>
  );
}

export default function AccountsPage() {
  const [filter, setFilter] = useState({ flagged: false, type: '', status: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['accounts', filter],
    queryFn: () => accountApi.getAll({
      flagged: filter.flagged || undefined,
      type: filter.type || undefined,
      status: filter.status || undefined,
      limit: 200
    }),
    refetchInterval: 15000,
  });

  const { data: stats } = useQuery({ queryKey: ['account-stats'], queryFn: accountApi.getStats });

  const accounts = data?.accounts || [];

  return (
    <div style={{ padding: 24 }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-1)' }}>Account Registry</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
            {stats?.total || 0} total • <span style={{ color: 'var(--danger-2)', fontWeight: 600 }}>{stats?.flagged || 0} flagged</span> • {stats?.dormant || 0} dormant • {stats?.suspicious || 0} suspicious
          </p>
        </div>
      </div>

      {/* ── Stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Total Accounts', value: stats?.total || 0, color: 'var(--blue-2)' },
          { label: 'Flagged', value: stats?.flagged || 0, color: 'var(--danger-2)' },
          { label: 'Dormant', value: stats?.dormant || 0, color: 'var(--text-3)' },
          { label: 'Suspicious', value: stats?.suspicious || 0, color: 'var(--warning-2)' },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-card">
            <div style={{ fontSize: 26, fontWeight: 800, color, marginBottom: 6 }}>{value}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', fontWeight: 500 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="glass-card" style={{ padding: '14px 18px', marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter size={15} color="var(--text-3)" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-2)', fontWeight: 500 }}>
          <input type="checkbox" checked={filter.flagged} onChange={e => setFilter(f => ({...f, flagged: e.target.checked}))} style={{ accentColor: 'var(--danger-2)' }} />
          Flagged Only
        </label>
        <select className="cyber-input" style={{ width: 160 }} value={filter.type} onChange={e => setFilter(f => ({...f, type: e.target.value}))}>
          <option value="">All Types</option>
          {['SAVINGS','CURRENT','SHELL','MULE'].map(t => <option key={t}>{t}</option>)}
        </select>
        <select className="cyber-input" style={{ width: 160 }} value={filter.status} onChange={e => setFilter(f => ({...f, status: e.target.value}))}>
          <option value="">All Statuses</option>
          {['ACTIVE','DORMANT','FROZEN','SUSPICIOUS'].map(s => <option key={s}>{s}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>{accounts.length} accounts</span>
      </div>

      {/* ── Table ── */}
      <div className="glass-card card-gold-top" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
          <table className="cyber-table">
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 5 }}>
              <tr>
                <th>Account ID</th>
                <th>Customer Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>KYC</th>
                <th>Branch</th>
                <th>Balance (INR)</th>
                <th>Risk Score</th>
                <th title="Graph neural network account risk">GNN Risk</th>
                <th>Flag</th>
                <th>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 40 }}>
                  <div className="spinner" style={{ margin: '0 auto' }} />
                </td></tr>
              ) : accounts.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>No accounts found</td></tr>
              ) : accounts.map(acc => (
                <tr key={acc.account_id} className={acc.is_flagged ? 'flagged' : ''} style={{ borderLeft: acc.is_flagged ? '3px solid var(--danger-2)' : '3px solid transparent' }}>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--blue-2)' }}>{acc.account_id}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text-1)' }}>{acc.customer_name}</td>
                  <td>
                    <span style={{ fontSize: 10.5, color: TYPE_COLOR[acc.account_type] || 'var(--text-3)', fontWeight: 700, background: `rgba(26,108,188,0.1)`, border: `1px solid rgba(26,108,188,0.25)`, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.04em' }}>
                      {acc.account_type}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: 11, color: STATUS_COLOR[acc.status] || 'var(--text-3)', fontWeight: 700 }}>
                      {acc.status}
                    </span>
                  </td>
                  <td>
                    <span className={`badge badge-${acc.kyc_level === 'HIGH' ? 'success' : acc.kyc_level === 'MEDIUM' ? 'medium' : 'critical'}`} style={{fontSize:9}}>
                      {acc.kyc_level}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-2)' }}>{acc.branch}</td>
                  <td style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: 12.5 }}>
                    ₹{Number(acc.balance || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </td>
                  <td><RiskBar score={Math.min(acc.risk_score || 0, 100)} /></td>
                  <td data-testid="gnn-risk-cell" title={acc.gnn_updated_at ? `GNN analysis ${new Date(acc.gnn_updated_at).toLocaleTimeString('en-IN')}` : 'No GNN analysis yet'}>
                    {typeof acc.gnn_risk_score === 'number'
                      ? <span style={{ fontWeight: 800, fontSize: 12, color: acc.gnn_flagged ? 'var(--danger-2)' : 'var(--text-2)' }}>{Math.round(acc.gnn_risk_score)}<span style={{ fontSize: 9.5, marginLeft: 5, color: 'var(--text-3)' }}>{acc.gnn_risk_level}</span></span>
                      : <span style={{ fontSize: 11, color: 'var(--text-3)' }}>—</span>}
                  </td>
                  <td>
                    {acc.is_flagged
                      ? <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--danger-2)', fontWeight: 600 }}><AlertTriangle size={13} />Flagged</span>
                      : <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--success-2)', fontWeight: 600 }}><CheckCircle size={13} />Clear</span>
                    }
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {acc.last_active ? new Date(acc.last_active).toLocaleDateString('en-IN') : '-'}
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
