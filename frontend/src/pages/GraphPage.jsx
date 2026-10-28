import { useEffect, useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { txApi } from '../services/api';
import { useSocket } from '../contexts/SocketContext';
import ForceGraph2D from 'react-force-graph-2d';
import { GitBranch, ZoomIn, RefreshCw, Info, X, Lock, Unlock, Eye, EyeOff, Pause, Play } from 'lucide-react';

// Banking colors
const FRAUD_COLORS = {
  NONE:                '#16a870',
  STRUCTURING:         '#c98520',
  LAYERING:            '#c82828',
  ROUND_TRIP:          '#c82828',
  DORMANT_ACTIVATION:  '#c9a84c',
  FAN_OUT:             '#c98520',
  MULE_TRANSFER:       '#c82828',
  MULE:                '#c82828',
};

const NODE_TYPE_COLORS = {
  SAVINGS: '#1a6cbc',
  CURRENT: '#2d85d8',
  SHELL:   '#c98520',
  MULE:    '#c82828',
};

// ── Node Detail Panel ─────────────────────────────────────────────────────
function NodePanel({ node, onClose }) {
  if (!node) return null;
  const color = node.is_flagged ? '#e03434' : (NODE_TYPE_COLORS[node.type] || '#1a6cbc');
  return (
    <div style={{
      position: 'absolute', top: 16, right: 16, width: 280,
      background: 'var(--card)', border: `1px solid ${color}55`, borderRadius: 10,
      padding: 20, zIndex: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.6)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>Account Details</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
          <X size={16} />
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          ['Account ID', node.id, true],
          ['Name', node.name],
          ['Type', node.type],
          ['KYC Level', node.kyc_level],
          ['Status', node.status],
          ['Branch', node.branch],
          ['Risk Score', node.risk_score],
          ['Balance', node.balance ? `₹${Number(node.balance).toLocaleString('en-IN')}` : '-'],
        ].map(([label, value, mono]) => (
          <div key={label} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-1)', fontFamily: mono ? 'JetBrains Mono, monospace' : undefined }}>{value || '-'}</div>
          </div>
        ))}
      </div>
      {node.is_flagged && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: 'rgba(200,40,40,0.1)', border: '1px solid rgba(200,40,40,0.3)' }}>
          <span style={{ fontSize: 11, color: 'var(--danger-2)', fontWeight: 700 }}>⚠ FLAGGED FOR INVESTIGATION</span>
        </div>
      )}
    </div>
  );
}

// ── Edge Detail Panel ─────────────────────────────────────────────────────
function EdgePanel({ edge, onClose }) {
  if (!edge) return null;
  const color = FRAUD_COLORS[edge.fraud_type] || '#16a870';
  return (
    <div style={{
      position: 'absolute', bottom: 16, right: 16, width: 280,
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
      padding: 20, zIndex: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.6)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>Transaction Details</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
          <X size={16} />
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 12 }}>{edge.tx_id}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-1)', marginBottom: 12 }}>
        ₹{Number(edge.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 5 }}>FRAUD TYPE</div>
        <span style={{ fontSize: 11, color, fontWeight: 700, background: `${color}18`, padding: '4px 10px', borderRadius: 4, border: `1px solid ${color}40` }}>
          {edge.fraud_type?.replace(/_/g, ' ') || 'CLEAN'}
        </span>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 5 }}>RISK SCORE ({edge.risk_score})</div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--surface)' }}>
          <div style={{ width: `${edge.risk_score}%`, height: '100%', background: color, borderRadius: 3 }} />
        </div>
      </div>
      {edge.anomaly_flag && (
        <div style={{ marginTop: 14, padding: '8px 12px', borderRadius: 6, background: 'rgba(200,40,40,0.1)', border: '1px solid rgba(200,40,40,0.3)' }}>
          <span style={{ fontSize: 11, color: 'var(--danger-2)', fontWeight: 700 }}>FLAGGED TRANSACTION</span>
        </div>
      )}
    </div>
  );
}

// ── Main Graph Page ───────────────────────────────────────────────────────
export default function GraphPage() {
  const graphRef = useRef(null);
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);

  // ── Controls ──
  const [filter, setFilter] = useState({
    flaggedOnly: true,   // default: suspicious only — cleaner view
    hours: 1,            // default: last 1 hour — less data = less chaos
    maxNodes: 60,        // cap on nodes rendered
    fraudTypeFilter: 'ALL',
  });
  const [physicsLocked, setPhysicsLocked] = useState(false);  // freeze layout
  const [autoRefresh, setAutoRefresh]     = useState(false);   // manual refresh by default
  const [showCleanLinks, setShowCleanLinks] = useState(false); // hide clean edges by default
  const [pendingUpdate, setPendingUpdate] = useState(false);   // notification of new data

  const { liveTransactions, on } = useSocket();

  const { data, refetch, isLoading } = useQuery({
    queryKey: ['graph', filter.flaggedOnly, filter.hours],
    queryFn: () => txApi.getGraph({ flaggedOnly: filter.flaggedOnly, hours: filter.hours }),
    // No auto-refetch — user controls when to refresh
    refetchInterval: autoRefresh ? 30000 : false,
    staleTime: Infinity,
  });

  // Subscribe to transaction_updated events — fires after fraud engine enriches the tx
  // This is more reliable than watching liveTransactions because it fires even if the
  // transaction was already scrolled off the live buffer.
  useEffect(() => {
    const unsub = on('transaction_updated', (tx) => {
      if (tx.anomaly_flag) {
        setPendingUpdate(true);
        if (autoRefresh) refetch();
      }
    });
    return unsub;
  }, [on, autoRefresh, refetch]);

  // Apply client-side filters on top of server data
  useEffect(() => {
    if (!data) return;

    let links = [...(data.links || [])];

    // Fraud type filter
    if (filter.fraudTypeFilter !== 'ALL') {
      links = links.filter(l => l.fraud_type === filter.fraudTypeFilter);
    }

    // Hide clean links if toggled off
    if (!showCleanLinks) {
      links = links.filter(l => l.anomaly_flag);
    }

    // Cap links to avoid overwhelming graph
    links = links.slice(0, 200);

    // Only keep nodes that are referenced by filtered links
    const referencedIds = new Set(links.flatMap(l => [
      typeof l.source === 'object' ? l.source.id : l.source,
      typeof l.target === 'object' ? l.target.id : l.target,
    ]));

    let nodes = (data.nodes || []).filter(n => referencedIds.has(n.id));

    // Cap nodes
    if (nodes.length > filter.maxNodes) {
      // Prioritise flagged nodes
      const flagged = nodes.filter(n => n.is_flagged);
      const clean   = nodes.filter(n => !n.is_flagged);
      nodes = [...flagged, ...clean].slice(0, filter.maxNodes);
    }

    setGraphData({ nodes, links });
  }, [data, filter.fraudTypeFilter, showCleanLinks, filter.maxNodes]);

  // Notify user when new flagged transactions arrive — don't auto-refresh
  useEffect(() => {
    const flagged = liveTransactions.filter(t => t.anomaly_flag);
    if (flagged.length > 0 && !autoRefresh) {
      setPendingUpdate(true);
    }
  }, [liveTransactions, autoRefresh]);

  // Freeze physics after initial settle
  useEffect(() => {
    if (physicsLocked && graphRef.current) {
      graphRef.current.d3Force('charge', null);
      graphRef.current.d3Force('link', null);
      graphRef.current.d3Force('center', null);
    }
  }, [physicsLocked, graphData]);

  // ── Canvas Renderers ──
  const nodeCanvasObject = useCallback((node, ctx, globalScale) => {
    const isFlagged  = node.is_flagged;
    const isSelected = selectedNode?.id === node.id;
    const color  = isFlagged ? '#e03434' : (NODE_TYPE_COLORS[node.type] || '#1a6cbc');
    const radius = Math.max(4, (node.risk_score || 0) / 14) + (isSelected ? 3 : 0);

    if (isFlagged || isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 5, 0, 2 * Math.PI);
      ctx.fillStyle = `${color}22`;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = `${color}e6`;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 2.5 : 1;
    ctx.stroke();

    // Label — only when zoomed enough or node is flagged
    if (globalScale >= 1.5 || (isFlagged && globalScale >= 0.8)) {
      const label = node.id?.slice(0, 9) || '';
      ctx.font = `${Math.max(7, 9 / globalScale)}px Inter`;
      ctx.fillStyle = isFlagged ? '#fca5a5' : 'rgba(255,255,255,0.55)';
      ctx.textAlign = 'center';
      ctx.fillText(label, node.x, node.y + radius + 9);
    }
  }, [selectedNode]);

  const linkColor = useCallback((link) => {
    if (link.anomaly_flag) return FRAUD_COLORS[link.fraud_type] || '#e03434';
    return 'rgba(255,255,255,0.07)';
  }, []);

  const linkWidth = useCallback((link) => {
    if (!link.anomaly_flag) return 0.5;
    return Math.max(1.5, Math.min(4, link.amount / 150000));
  }, []);

  const handleNodeClick = useCallback((node) => {
    setSelectedNode(node);
    setSelectedEdge(null);
    graphRef.current?.centerAt(node.x, node.y, 500);
    graphRef.current?.zoom(2.5, 500);
  }, []);

  const handleLinkClick = useCallback((link) => {
    setSelectedEdge(link);
    setSelectedNode(null);
  }, []);

  const handleRefresh = () => {
    setPendingUpdate(false);
    refetch();
  };

  const fraudTypes = ['ALL', 'LAYERING', 'STRUCTURING', 'FAN_OUT', 'DORMANT_ACTIVATION', 'MULE_TRANSFER'];
  const flaggedLinkCount = graphData.links.filter(l => l.anomaly_flag).length;

  return (
    <div style={{ padding: '16px 20px', height: '100vh', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1 }}>Fund Flow Graph</h1>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 5 }}>
            <span style={{ color: 'var(--text-2)' }}>{graphData.nodes.length}</span> nodes ·{' '}
            <span style={{ color: 'var(--text-2)' }}>{graphData.links.length}</span> edges ·{' '}
            <span style={{ color: 'var(--danger-2)', fontWeight: 600 }}>{flaggedLinkCount} flagged</span>
          </p>
        </div>

        {/* Controls row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>

          {/* Pending update badge */}
          {pendingUpdate && (
            <button onClick={handleRefresh} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7,
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)',
              color: '#ef4444', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
              animation: 'pulse 2s infinite',
            }}>
              <RefreshCw size={12} /> New Alerts — Click to Refresh
            </button>
          )}

          {/* Flagged only toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-2)', cursor: 'pointer', padding: '6px 10px', borderRadius: 7, background: filter.flaggedOnly ? 'rgba(200,40,40,0.1)' : 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', fontWeight: 500 }}>
            <input type="checkbox" checked={filter.flaggedOnly} onChange={e => setFilter(f => ({ ...f, flaggedOnly: e.target.checked }))} style={{ accentColor: 'var(--danger-2)' }} />
            Suspicious Only
          </label>

          {/* Show clean links */}
          <button onClick={() => setShowCleanLinks(v => !v)} title="Toggle clean transactions" style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 7,
            background: showCleanLinks ? 'rgba(26,108,188,0.12)' : 'rgba(255,255,255,0.04)',
            border: '1px solid var(--border)', color: showCleanLinks ? 'var(--blue-2)' : 'var(--text-3)',
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
          }}>
            {showCleanLinks ? <Eye size={13} /> : <EyeOff size={13} />}
            Clean Txns
          </button>

          {/* Time window */}
          <select value={filter.hours} onChange={e => setFilter(f => ({ ...f, hours: Number(e.target.value) }))} className="cyber-input" style={{ width: 120, fontSize: 12 }}>
            <option value={1}>Last 1 Hour</option>
            <option value={6}>Last 6 Hours</option>
            <option value={24}>Last 24 Hours</option>
            <option value={168}>Last 7 Days</option>
          </select>

          {/* Fraud type filter */}
          <select value={filter.fraudTypeFilter} onChange={e => setFilter(f => ({ ...f, fraudTypeFilter: e.target.value }))} className="cyber-input" style={{ width: 150, fontSize: 12 }}>
            {fraudTypes.map(t => <option key={t} value={t}>{t === 'ALL' ? 'All Fraud Types' : t.replace(/_/g, ' ')}</option>)}
          </select>

          {/* Physics lock */}
          <button onClick={() => setPhysicsLocked(v => !v)} title={physicsLocked ? 'Unlock physics' : 'Lock layout (stop movement)'} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 7,
            background: physicsLocked ? 'rgba(201,168,76,0.12)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${physicsLocked ? 'rgba(201,168,76,0.4)' : 'var(--border)'}`,
            color: physicsLocked ? 'var(--gold)' : 'var(--text-3)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          }}>
            {physicsLocked ? <Lock size={13} /> : <Unlock size={13} />}
            {physicsLocked ? 'Locked' : 'Lock Layout'}
          </button>

          {/* Auto-refresh toggle */}
          <button onClick={() => setAutoRefresh(v => !v)} title="Toggle auto-refresh" style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 7,
            background: autoRefresh ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${autoRefresh ? 'rgba(34,197,94,0.35)' : 'var(--border)'}`,
            color: autoRefresh ? '#22c55e' : 'var(--text-3)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          }}>
            {autoRefresh ? <Play size={13} /> : <Pause size={13} />}
            {autoRefresh ? 'Auto' : 'Manual'}
          </button>

          {/* Manual refresh */}
          <button onClick={handleRefresh} className="btn-ghost" style={{ fontSize: 12 }}><RefreshCw size={13} />Refresh</button>

          {/* Fit */}
          <button onClick={() => graphRef.current?.zoomToFit(500, 40)} className="btn-ghost" style={{ fontSize: 12 }}><ZoomIn size={13} />Fit</button>
        </div>
      </div>

      {/* ── Legend ── */}
      <div style={{ display: 'flex', gap: 14, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { color: '#1a6cbc', label: 'Savings',   dot: true },
          { color: '#c98520', label: 'Shell',      dot: true },
          { color: '#e03434', label: 'Mule/Flagged', dot: true },
          { color: '#c82828', label: 'Layering',   line: true },
          { color: '#c98520', label: 'Structuring', line: true },
          { color: '#c9a84c', label: 'Dormant',    line: true },
          { color: '#16a870', label: 'Fan-Out',    line: true },
        ].map(({ color, label, dot, line }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {dot  && <div style={{ width: 9, height: 9, borderRadius: '50%', background: color }} />}
            {line && <div style={{ width: 18, height: 2.5, background: color, borderRadius: 2 }} />}
            <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>{label}</span>
          </div>
        ))}

        {/* Node count indicator */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>Max nodes:</span>
          {[30, 60, 100].map(n => (
            <button key={n} onClick={() => setFilter(f => ({ ...f, maxNodes: n }))} style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border)',
              background: filter.maxNodes === n ? 'rgba(26,108,188,0.2)' : 'transparent',
              color: filter.maxNodes === n ? 'var(--blue-2)' : 'var(--text-3)',
            }}>{n}</button>
          ))}
        </div>
      </div>

      {/* ── Graph Canvas ── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {isLoading && graphData.nodes.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div style={{ textAlign: 'center' }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Building fund flow graph...</p>
            </div>
          </div>
        ) : graphData.nodes.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 10 }}>
            <GitBranch size={36} color="var(--text-3)" />
            <p style={{ color: 'var(--text-3)', fontSize: 13 }}>No data for this filter — try a wider time window or uncheck "Suspicious Only"</p>
            <button onClick={handleRefresh} className="btn-ghost" style={{ fontSize: 12 }}><RefreshCw size={13} /> Refresh</button>
          </div>
        ) : (
          <ForceGraph2D
            ref={graphRef}
            graphData={graphData}
            nodeCanvasObject={nodeCanvasObject}
            nodeCanvasObjectMode={() => 'replace'}
            linkColor={linkColor}
            linkWidth={linkWidth}
            linkDirectionalArrowLength={5}
            linkDirectionalArrowRelPos={1}
            // Particles only on flagged links, and only when NOT locked
            linkDirectionalParticles={link => (!physicsLocked && link.anomaly_flag) ? 2 : 0}
            linkDirectionalParticleColor={link => FRAUD_COLORS[link.fraud_type] || '#e03434'}
            linkDirectionalParticleSpeed={0.004}
            linkDirectionalParticleWidth={2}
            backgroundColor="#030c18"
            onNodeClick={handleNodeClick}
            onLinkClick={handleLinkClick}
            // Physics: settle fast then stop — prevents perpetual jitter
            cooldownTicks={physicsLocked ? 0 : 120}
            cooldownTime={physicsLocked ? 0 : 4000}
            onEngineStop={() => {
              // After physics settle, auto-fit the view once
              graphRef.current?.zoomToFit(600, 40);
            }}
            // Damping — makes it settle much faster
            d3AlphaDecay={0.04}
            d3VelocityDecay={0.5}
            nodeRelSize={1}
          />
        )}

        <NodePanel node={selectedNode} onClose={() => setSelectedNode(null)} />
        <EdgePanel edge={selectedEdge} onClose={() => setSelectedEdge(null)} />

        {/* Hint */}
        {!selectedNode && !selectedEdge && graphData.nodes.length > 0 && (
          <div style={{
            position: 'absolute', bottom: 14, left: 14,
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--text-2)',
            background: 'rgba(3,12,24,0.88)', padding: '7px 13px', borderRadius: 8,
            border: '1px solid var(--border)', backdropFilter: 'blur(6px)'
          }}>
            <Info size={13} color="var(--blue-2)" />
            Click a node or edge to inspect · Scroll to zoom · Drag to pan
          </div>
        )}

        {/* Physics locked badge */}
        {physicsLocked && (
          <div style={{
            position: 'absolute', top: 14, left: 14,
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700,
            background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)',
            padding: '5px 11px', borderRadius: 6, color: 'var(--gold)',
          }}>
            <Lock size={11} /> Layout frozen
          </div>
        )}
      </div>
    </div>
  );
}
