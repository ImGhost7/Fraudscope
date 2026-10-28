import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GnnPanel from '../GnnPanel';
import DetectorBreakdown from '../DetectorBreakdown';

const ready = { gnn: { ready: true, model_version: '1.0.0', analysed_accounts: 1234, high_risk_accounts: 3, alerts_with_gnn_evidence: 7, last_analysis_at: '2026-01-01T10:00:00Z' } };
const findings = [
  { account_id: 'ACC000042', risk_score: 91.2, risk_level: 'CRITICAL', flagged: true, topological_evidence: ['3 transfers forwarded within 5 minutes'] },
  { account_id: 'ACC000043', risk_score: 20, risk_level: 'LOW', flagged: false },
];

describe('GnnPanel', () => {
  it('shows a loading state', () => {
    render(<GnnPanel isLoading />);
    expect(screen.getByTestId('gnn-loading')).toBeInTheDocument();
  });

  it('shows an API failure state without crashing', () => {
    render(<GnnPanel isError />);
    expect(screen.getByTestId('gnn-error')).toHaveTextContent(/could not be loaded/i);
    render(<GnnPanel status={undefined} />);
  });

  it('is honest when the model is unavailable and says other layers keep running', () => {
    render(<GnnPanel status={{ gnn: { ready: false, reason: 'missing model artifacts: model.pt' } }} />);
    const el = screen.getByTestId('gnn-unavailable');
    expect(el).toHaveTextContent(/model unavailable/i);
    expect(el).toHaveTextContent(/missing model artifacts/);
    expect(el).toHaveTextContent(/continue to run/i);
  });

  it('renders real metrics and only the flagged findings', () => {
    render(<GnnPanel status={ready} accounts={findings} />);
    expect(screen.getByTestId('gnn-analysed')).toHaveTextContent('1,234');
    expect(screen.getByTestId('gnn-high')).toHaveTextContent('3');
    expect(screen.getByTestId('gnn-alerts')).toHaveTextContent('7');
    expect(screen.getAllByTestId('gnn-finding')).toHaveLength(1);
    expect(screen.getByText('ACC000042')).toBeInTheDocument();
    expect(screen.getByText(/not a transaction fraud probability/i)).toBeInTheDocument();
  });

  it('handles the empty-findings state and missing optional fields', () => {
    render(<GnnPanel status={{ gnn: { ready: true } }} accounts={[]} />);
    expect(screen.getByTestId('gnn-empty')).toBeInTheDocument();
    expect(screen.getByTestId('gnn-analysed')).toHaveTextContent('0');
  });
});

describe('DetectorBreakdown', () => {
  it('explains when only the rule engine result exists (legacy transactions)', () => {
    render(<DetectorBreakdown detectors={undefined} />);
    expect(screen.getByTestId('detectors-none')).toBeInTheDocument();
  });

  it('shows every detector, account scope, evidence and the fusion inputs', () => {
    const d = {
      rules: { available: true, score: 70, level: 'HIGH', flags: ['LAYERING_CHAIN_DETECTED'] },
      isolation_forest: { available: true, score: 55, risk_level: 'MEDIUM', is_anomaly: false },
      gnn: { available: true, scope: 'account', score: 88, risk_level: 'CRITICAL', model_version: '1.0.0', sender: { topological_evidence: ['Circular fund flow: member of a strongly connected group of 4 accounts'], model_evidence: [] } },
      fusion: { score: 77.5, level: 'HIGH', used: ['rules', 'isolation_forest', 'gnn'], missing: [], floor_applied: false },
    };
    render(<DetectorBreakdown detectors={d} finalScore={77.5} finalLevel="HIGH" />);
    expect(screen.getByText(/GNN \(account scope\)/)).toBeInTheDocument();
    expect(screen.getByText(/Circular fund flow/)).toBeInTheDocument();
    expect(screen.getByText(/from rules \+ isolation_forest \+ gnn/)).toBeInTheDocument();
    expect(screen.getByText(/not calibrated fraud probabilities/i)).toBeInTheDocument();
  });

  it('degrades gracefully when IF and GNN are unavailable', () => {
    const d = { rules: { available: true, score: 35, level: 'MEDIUM', flags: [] }, isolation_forest: { available: false }, gnn: { available: false, note: 'GNN unavailable: ML service unreachable' }, fusion: { score: 35, level: 'MEDIUM', used: ['rules'], missing: ['isolation_forest', 'gnn'] } };
    render(<DetectorBreakdown detectors={d} />);
    expect(screen.getByTestId('iso-unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('gnn-detector-unavailable')).toHaveTextContent(/unreachable/);
    expect(screen.getByText(/missing: isolation_forest, gnn/)).toBeInTheDocument();
  });
});
