import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../services/api';
import { useSocket } from '../contexts/SocketContext';
import { useEffect } from 'react';
import {
  Activity, AlertTriangle, Shield, Users, Zap,
  ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';

// Banking-grade palette for charts
const PIE_COLORS = ['#c82828', '#c98520', '#1a6cbc', '#0f7a52', '#c9a84c'];

const FRAUD_TYPE_LABELS = {
  STRUCTURING: 'Structuring',
  LAYERING: 'Layering',
  ROUND_TRIP: 'Round Trip',
  DORMANT_ACTIVATION: 'Dormant Acct',
  FAN_OUT: 'Fan-Out',
  MULE: 'Mule Acct',
  NONE: 'Clean',
};

const SEVERITY_COLOR = {
  CRITICAL: '#e03434',
  HIGH: '#e09a28',
  MEDIUM: '#2d85d8',
  LOW: '#16a870',
};

function StatCard({ label, value, icon: Icon, color, subLabel, change }) {
  return (
    <div className="stat-card animate-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 9,
          background: `${color}1a`, border: `1px solid ${color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Icon size={18} color={color} />
        </div>
        {change !== undefined && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 3,
            color: change >= 0 ? 'var(--danger-2)' : 'var(--success-2)',
            fontSize: 11.5, fontWeight: 700,
            background: change >= 0 ? 'rgba(200,40,40,0.1)' : 'rgba(15,122,82,0.1)',
            padding: '2px 7px', borderRadius: 4,
          }}>
            {change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(change)}%
          </div>
        )}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.04em', marginBottom: 4, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-2)', fontWeight: 500 }}>{label}</div>
      {subLabel && (
        <div style={{ fontSize: 11, color, marginTop: 6, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
          {subLabel}
        </div>
      )}
    </div>
  );
}

function AlertRow({ alert }) {
  const color = SEVERITY_COLOR[alert.severity] || 'var(--text-3)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
      borderBottom: '1px solid rgba(20,50,79,0.5)'
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: color, boxShadow: `0 0 6px ${color}`
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 500 }}>
          {alert.alert_type?.replace(/_/g, ' ')}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
          {alert.description?.slice(0, 60)}...
        </div>
      </div>
      <span className={`badge badge-${alert.severity?.toLowerCase()}`}>{alert.severity}</span>
    </div>
  );
}

function TxRow({ tx }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
      borderBottom: '1px solid rgba(20,50,79,0.5)',
      ...(tx.anomaly_flag ? { background: 'rgba(200,40,40,0.03)', borderLeft: '2px solid var(--danger)' } : {})
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
          {tx.sender?.slice(0, 10)} → {tx.receiver?.slice(0, 10)}
        </div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
        ₹{Number(tx.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </div>
      {tx.anomaly_flag && <span className="badge badge-critical" style={{ fontSize: 9 }}>FLAGGED</span>}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="cyber-tooltip">
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--blue-2)' }}>{payload[0]?.value} txns</div>
    </div>
  );
};

export default function DashboardPage() {
  const { data, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: dashboardApi.getStats });
  const { liveTransactions, liveAlerts, connected } = useSocket();

  useEffect(() => {
    const timer = setTimeout(() => refetch(), 3000);
    return () => clearTimeout(timer);
  }, [liveTransactions.length]);

  const stats = data || {};
  const txByHour = (stats.tx_by_hour || []).map(d => ({
    hour: `${d._id}:00`, count: d.count, amount: d.total_amount
  }));

  const fraudPieData = (stats.tx?.fraud_types || []).map((d) => ({
    name: FRAUD_TYPE_LABELS[d._id] || d._id, value: d.count
  }));

  const recentAlerts = liveAlerts.length > 0 ? liveAlerts.slice(0, 5) : (stats.recent_alerts || []);
  const recentTxs = liveTransactions.length > 0 ? liveTransactions.slice(0, 8) : (stats.recent_transactions || []);

  return (
    <div style={{ padding: 24, maxWidth: 1400 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 23, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.02em' }}>
            Intelligence Dashboard
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 5 }}>
            Real-time AML monitoring · {new Date().toLocaleDateString('en-IN', { dateStyle: 'full' })}
          </p>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8,
          background: connected ? 'rgba(15,122,82,0.1)' : 'rgba(200,40,40,0.1)',
          border: `1px solid ${connected ? 'rgba(15,122,82,0.25)' : 'rgba(200,40,40,0.25)'}`,
        }}>
          <div className="pulse-dot" style={{ width: 7, height: 7, background: connected ? 'var(--success-2)' : 'var(--danger-2)' }} />
          <span style={{ fontSize: 12, color: connected ? 'var(--success-2)' : 'var(--danger-2)', fontWeight: 700, letterSpacing: '0.06em' }}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 22 }}>
        <StatCard label="Total Transactions" value={((stats.tx?.total || 0) + liveTransactions.length).toLocaleString()} icon={Activity} color="#2d85d8" subLabel={`+${stats.tx?.today || 0} today`} change={12} />
        <StatCard label="Flagged Transactions" value={stats.tx?.flagged || 0} icon={AlertTriangle} color="#e03434" subLabel="Requires investigation" change={8} />
        <StatCard label="Open Alerts" value={stats.alerts?.open || 0} icon={Zap} color="#c98520" subLabel={`${stats.alerts?.critical || 0} critical`} />
        <StatCard label="Flagged Accounts" value={stats.accounts?.flagged || 0} icon={Users} color="#c9a84c" subLabel="Under monitoring" />
        <StatCard label="Active Cases" value={stats.cases?.open || 0} icon={Shield} color="#16a870" subLabel="Investigations open" />
      </div>

      {/* ── Charts row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 22 }}>

        {/* Transaction volume */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>Transaction Volume (24h)</h3>
              <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 3 }}>Hourly transaction flow</p>
            </div>
            <span className="badge badge-medium">LIVE</span>
          </div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={txByHour.length ? txByHour : Array.from({ length: 12 }, (_, i) => ({ hour: `${i * 2}:00`, count: 0 }))}>
                <defs>
                  <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1a6cbc" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#1a6cbc" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(20,50,79,0.7)" />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="count" stroke="#2d85d8" fill="url(#txGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Fraud type pie */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>Fraud Distribution</h3>
            <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 3 }}>Detected patterns</p>
          </div>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={fraudPieData.length ? fraudPieData : [
                    { name: 'Layering', value: 35 }, { name: 'Structuring', value: 25 },
                    { name: 'Fan-Out', value: 20 }, { name: 'Dormant', value: 12 }, { name: 'Mule', value: 8 }
                  ]}
                  cx="50%" cy="50%" innerRadius={44} outerRadius={68}
                  dataKey="value" paddingAngle={3}
                >
                  {(fraudPieData.length ? fraudPieData : [{}, {}, {}, {}, {}]).map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-1)' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {['Layering', 'Structuring', 'Fan-Out', 'Dormant', 'Mule'].map((label, i) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text-3)' }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: PIE_COLORS[i] }} />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bottom row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Recent alerts */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>Recent Alerts</h3>
            <span style={{ fontSize: 11, color: 'var(--danger-2)', fontWeight: 700, background: 'rgba(200,40,40,0.1)', padding: '2px 8px', borderRadius: 4 }}>
              {recentAlerts.filter(a => a.severity === 'CRITICAL').length} CRITICAL
            </span>
          </div>
          {recentAlerts.length === 0
            ? <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: 20 }}>No alerts yet. System is monitoring...</p>
            : recentAlerts.map((a, i) => <AlertRow key={a._id || i} alert={a} />)
          }
        </div>

        {/* Live transactions */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>Live Transactions</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="pulse-dot" style={{ width: 6, height: 6 }} />
              <span style={{ fontSize: 10.5, color: 'var(--success-2)', fontWeight: 700, letterSpacing: '0.06em' }}>STREAMING</span>
            </div>
          </div>
          {recentTxs.length === 0
            ? <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: 20 }}>Waiting for transactions...</p>
            : recentTxs.map((tx, i) => <TxRow key={tx._id || i} tx={tx} />)
          }
        </div>
      </div>
    </div>
  );
}
