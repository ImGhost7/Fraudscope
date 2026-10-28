import { Network, AlertTriangle, CheckCircle2, WifiOff, Loader2 } from 'lucide-react';

import { gnnColor } from './colors';

const box = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 };
const muted = { fontSize: 12, color: 'var(--text-3)' };

function Stat({ label, value, testId }) {
  return (
    <div style={{ minWidth: 110 }}>
      <div data-testid={testId} style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-1)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.04em' }}>{label}</div>
    </div>
  );
}

/**
 * Dashboard card for the GNN detection layer.
 * Props come straight from GET /api/ml/status and GET /api/ml/gnn/accounts; every optional field may be missing.
 */
export default function GnnPanel({ status, accounts = [], isLoading = false, isError = false }) {
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <Network size={18} color="var(--blue-2)" />
      <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>Graph Neural Network (GraphSAGE)</h3>
    </div>
  );

  if (isLoading) {
    return <div style={box} data-testid="gnn-loading">{header}<div style={{ ...muted, display: 'flex', gap: 8, alignItems: 'center' }}><Loader2 size={14} className="spin" />Loading GNN status…</div></div>;
  }
  if (isError || !status) {
    return <div style={box} data-testid="gnn-error">{header}<div style={{ ...muted, color: 'var(--danger-2)' }}><WifiOff size={14} style={{ marginRight: 6, verticalAlign: -2 }} />GNN status could not be loaded from the backend.</div></div>;
  }

  const gnn = status.gnn || {};
  if (!gnn.ready) {
    return (
      <div style={box} data-testid="gnn-unavailable">
        {header}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e0a84a', fontSize: 13, fontWeight: 600 }}>
          <AlertTriangle size={15} />Model unavailable
        </div>
        <p style={{ ...muted, marginTop: 8, lineHeight: 1.5 }}>{gnn.reason || 'The GNN model is not ready.'}</p>
        <p style={{ ...muted, marginTop: 6 }}>Rule-based detection and the Isolation Forest continue to run.</p>
      </div>
    );
  }

  const top = accounts.filter((a) => a.flagged).slice(0, 5);
  return (
    <div style={box} data-testid="gnn-ready">
      {header}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 12, color: 'var(--success-2)', fontWeight: 700 }}>
        <CheckCircle2 size={14} />Model ready · v{gnn.model_version}
        <span style={{ ...muted, marginLeft: 'auto' }}>{gnn.last_analysis_at ? `last analysis ${new Date(gnn.last_analysis_at).toLocaleTimeString('en-IN')}` : 'awaiting first analysis'}</span>
      </div>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 16 }}>
        <Stat label="ACCOUNTS ANALYSED" value={(gnn.analysed_accounts ?? 0).toLocaleString()} testId="gnn-analysed" />
        <Stat label="HIGH-RISK FINDINGS" value={gnn.high_risk_accounts ?? 0} testId="gnn-high" />
        <Stat label="ALERTS WITH GNN EVIDENCE" value={gnn.alerts_with_gnn_evidence ?? 0} testId="gnn-alerts" />
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>RECENT GNN FINDINGS</div>
      {top.length === 0 ? (
        <div style={muted} data-testid="gnn-empty">No accounts currently flagged by the GNN.</div>
      ) : top.map((a) => (
        <div key={a.account_id} data-testid="gnn-finding" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, color: 'var(--blue-2)' }}>{a.account_id}</span>
          <span style={{ ...muted, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.topological_evidence?.[0] || a.model_evidence?.[0] || 'graph-neighbourhood pattern'}</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: gnnColor(a.risk_level) }}>{Math.round(a.risk_score)}</span>
        </div>
      ))}
      <p style={{ ...muted, marginTop: 10, fontSize: 10.5 }}>Account-level risk indicator, not a transaction fraud probability.</p>
    </div>
  );
}
