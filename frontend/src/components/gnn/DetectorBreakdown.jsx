import { gnnColor } from './colors';

const row = { display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', borderTop: '1px solid var(--border)' };
const label = { width: 150, fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', textTransform: 'uppercase', flexShrink: 0 };

function Score({ v, level }) {
  return <span style={{ fontWeight: 800, fontSize: 13, color: gnnColor(level) }}>{typeof v === 'number' ? Math.round(v * 10) / 10 : '—'}{level ? <span style={{ fontSize: 10, marginLeft: 6, opacity: 0.8 }}>{level}</span> : null}</span>;
}

/** Shows what each independent detector said and how the final score was formed. Tolerates missing parts. */
export default function DetectorBreakdown({ detectors, finalScore, finalLevel }) {
  if (!detectors) {
    return <div data-testid="detectors-none" style={{ fontSize: 12, color: 'var(--text-3)' }}>No multi-detector analysis is available for this item (rule engine result only).</div>;
  }
  const { rules, isolation_forest: iso, gnn, fusion } = detectors;
  const gnnEvidence = [...(gnn?.sender?.topological_evidence || []), ...(gnn?.receiver?.topological_evidence || []), ...(gnn?.topological_evidence || [])];
  const modelEvidence = [...(gnn?.sender?.model_evidence || []), ...(gnn?.receiver?.model_evidence || []), ...(gnn?.model_evidence || [])];
  return (
    <div data-testid="detector-breakdown">
      <div style={row}><span style={label}>Rule engine</span>{rules?.available ? <><Score v={rules.score} level={rules.level} /><span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{(rules.flags || []).slice(0, 4).join(', ')}</span></> : <span style={{ fontSize: 12, color: 'var(--text-3)' }}>not available</span>}</div>
      <div style={row}><span style={label}>Isolation Forest</span>{iso?.available ? <><Score v={iso.score} level={iso.risk_level} /><span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{iso.is_anomaly ? 'anomaly' : 'not an anomaly by its own threshold'}</span></> : <span data-testid="iso-unavailable" style={{ fontSize: 12, color: 'var(--text-3)' }}>unavailable</span>}</div>
      <div style={row}><span style={label}>GNN (account scope)</span>{gnn?.available ? <><Score v={gnn.score ?? gnn.risk_score} level={gnn.risk_level} /><span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>risk of the transaction's accounts{gnn.model_version ? ` · model v${gnn.model_version}` : ''}</span></> : <span data-testid="gnn-detector-unavailable" style={{ fontSize: 12, color: 'var(--text-3)' }}>{gnn?.note || 'unavailable'}</span>}</div>
      {gnnEvidence.length > 0 && (
        <div style={{ ...row, alignItems: 'flex-start' }}><span style={label}>Structural evidence</span><ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>{[...new Set(gnnEvidence)].slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul></div>
      )}
      {modelEvidence.length > 0 && (
        <div style={{ ...row, alignItems: 'flex-start' }}><span style={label}>Model evidence</span><ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>{[...new Set(modelEvidence)].slice(0, 4).map((e) => <li key={e}>{e}</li>)}</ul></div>
      )}
      <div style={{ ...row, borderTop: '2px solid var(--border)' }}>
        <span style={{ ...label, color: 'var(--text-1)' }}>Final fused risk</span>
        <Score v={finalScore ?? fusion?.score} level={finalLevel ?? fusion?.level} />
        {fusion && <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>from {fusion.used?.join(' + ')}{fusion.missing?.length ? ` (missing: ${fusion.missing.join(', ')})` : ''}{fusion.floor_applied ? ' · rule floor applied' : ''}</span>}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 6 }}>Normalised risk indicators from independent detectors, not calibrated fraud probabilities. Evidence is supporting context, not proof of laundering.</div>
    </div>
  );
}
