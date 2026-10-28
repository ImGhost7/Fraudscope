/**
 * Simulation Studio — Transaction Console
 * Submit transactions manually through the full fraud-detection pipeline.
 */
import { useState, useEffect } from 'react';
import { simulatorApi } from '../../services/api';
import { Send, RefreshCw, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';

const RISK_COLOR = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#f97316', CRITICAL: '#ef4444' };
const FRAUD_TYPES = {
  STRUCTURING: '#f59e0b', FAN_OUT: '#f97316', DORMANT_ACTIVATION: '#ef4444',
  MULE_TRANSFER: '#ef4444', HIGH_VELOCITY: '#f97316', NONE: '#22c55e',
};

export default function TransactionConsole({ refreshTrigger }) {
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [form, setForm] = useState({ sender: '', receiver: '', amount: '', transaction_type: 'UPI', channel: 'MOBILE' });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  const loadAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const data = await simulatorApi.getAccounts();
      setAccounts(data.accounts || []);
    } catch { toast.error('Failed to load accounts'); }
    finally { setLoadingAccounts(false); }
  };

  useEffect(() => { loadAccounts(); }, [refreshTrigger]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.sender) { toast.error('Select a sender account'); return; }
    if (!form.receiver) { toast.error('Select a receiver account'); return; }
    if (!form.amount || Number(form.amount) <= 0) { toast.error('Enter a valid amount'); return; }

    setSubmitting(true);
    setResult(null);
    try {
      const tx = await simulatorApi.submitTransaction({ ...form, amount: Number(form.amount) });
      setResult(tx);
      setHistory(h => [tx, ...h].slice(0, 20));
      if (tx.anomaly_flag) {
        toast.error(`🚨 FRAUD DETECTED: ${tx.fraud_type} — Risk ${tx.risk_score}`);
      } else {
        toast.success(`✅ Transaction ${tx.tx_id} submitted successfully`);
      }
      setForm(p => ({ ...p, amount: '' }));
    } catch (err) {
      toast.error(err?.error || 'Transaction failed');
    } finally {
      setSubmitting(false);
    }
  };

  const senderAcc = accounts.find(a => a.account_id === form.sender);
  const receiverAcc = accounts.find(a => a.account_id === form.receiver);

  const AccountOption = ({ acc }) => `${acc.account_id} — ${acc.customer_name} [${acc.account_type}] ₹${Number(acc.balance).toLocaleString('en-IN')}`;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(26,108,188,0.12)', border: '1px solid rgba(26,108,188,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Send size={17} color="var(--blue-2)" />
        </div>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>Transaction Console</h2>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Submit transactions — routes through the same Isolation Forest + Rule Engine pipeline</p>
        </div>
        <button onClick={loadAccounts} disabled={loadingAccounts} style={{ marginLeft: 'auto', background: 'rgba(26,108,188,0.1)', border: '1px solid rgba(26,108,188,0.25)', borderRadius: 7, padding: '6px 12px', color: 'var(--blue-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
          <RefreshCw size={13} className={loadingAccounts ? 'spin' : ''} /> Refresh Accounts
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Left — Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Sender */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 6 }}>
                Sender Account {senderAcc && <span style={{ color: 'var(--text-1)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· Balance ₹{Number(senderAcc.balance).toLocaleString('en-IN')}</span>}
              </label>
              <select id="tx-sender" className="cyber-input" value={form.sender} onChange={e => set('sender', e.target.value)} style={{ cursor: 'pointer' }} required>
                <option value="">Select sender...</option>
                {accounts.filter(a => a.account_id !== form.receiver).map(a => (
                  <option key={a.account_id} value={a.account_id}>{AccountOption({ acc: a })}</option>
                ))}
              </select>
            </div>

            {/* Receiver */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 6 }}>Receiver Account</label>
              <select id="tx-receiver" className="cyber-input" value={form.receiver} onChange={e => set('receiver', e.target.value)} style={{ cursor: 'pointer' }} required>
                <option value="">Select receiver...</option>
                {accounts.filter(a => a.account_id !== form.sender).map(a => (
                  <option key={a.account_id} value={a.account_id}>{AccountOption({ acc: a })}</option>
                ))}
              </select>
            </div>

            {/* Transfer preview arrow */}
            {senderAcc && receiverAcc && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: 'rgba(26,108,188,0.06)', border: '1px solid rgba(26,108,188,0.18)' }}>
                <span style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{senderAcc.account_id}</span>
                <ArrowRight size={14} color="var(--blue-2)" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{receiverAcc.account_id}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10.5, padding: '2px 7px', borderRadius: 4, background: receiverAcc.account_type === 'SAVINGS' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: receiverAcc.account_type === 'SAVINGS' ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{receiverAcc.account_type}</span>
              </div>
            )}

            {/* Amount */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 6 }}>
                Amount (₹)
                {Number(form.amount) >= 43000 && Number(form.amount) < 50000 && (
                  <span style={{ marginLeft: 8, color: '#f59e0b', fontWeight: 600, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>⚠ Near ₹50k threshold — structuring risk</span>
                )}
                {Number(form.amount) >= 100000 && (
                  <span style={{ marginLeft: 8, color: '#ef4444', fontWeight: 600, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>🚨 High-value — will trigger ML scoring</span>
                )}
              </label>
              <input id="tx-amount" className="cyber-input" type="number" min="1" value={form.amount}
                onChange={e => set('amount', e.target.value)} placeholder="e.g. 45000" required />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {/* Type */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 6 }}>Transaction Type</label>
                <select id="tx-type" className="cyber-input" value={form.transaction_type} onChange={e => set('transaction_type', e.target.value)} style={{ cursor: 'pointer' }}>
                  {['UPI', 'IMPS', 'NEFT', 'WIRE'].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              {/* Channel */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 6 }}>Channel</label>
                <select id="tx-channel" className="cyber-input" value={form.channel} onChange={e => set('channel', e.target.value)} style={{ cursor: 'pointer' }}>
                  {['MOBILE', 'NET_BANKING', 'API'].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>

            <button id="btn-submit-tx" type="submit" disabled={submitting} className="btn-primary"
              style={{ justifyContent: 'center', padding: '12px 20px', fontSize: 14, borderRadius: 8 }}>
              {submitting
                ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Processing...</>
                : <><Send size={16} /> Submit Transaction</>
              }
            </button>
          </form>
        </div>

        {/* Right — Result + History */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Result card */}
          {result && (
            <div style={{
              padding: 16, borderRadius: 10,
              background: result.anomaly_flag ? 'rgba(239,68,68,0.07)' : 'rgba(34,197,94,0.07)',
              border: `1px solid ${result.anomaly_flag ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.25)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {result.anomaly_flag
                  ? <AlertTriangle size={16} color="#ef4444" />
                  : <CheckCircle2 size={16} color="#22c55e" />
                }
                <span style={{ fontSize: 13, fontWeight: 700, color: result.anomaly_flag ? '#ef4444' : '#22c55e' }}>
                  {result.anomaly_flag ? `FRAUD DETECTED: ${result.fraud_type}` : 'Transaction Processed Clean'}
                </span>
              </div>
              {[
                ['TX ID', result.tx_id],
                ['Status', result.status],
                ['Risk Score', result.risk_score],
                ['Fraud Type', result.fraud_type],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{k}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: k === 'Risk Score' ? (RISK_COLOR[result.risk_level] || 'var(--text-1)') : FRAUD_TYPES[v] || 'var(--text-1)', fontFamily: k === 'TX ID' ? 'JetBrains Mono, monospace' : 'inherit', }}>{String(v)}</span>
                </div>
              ))}
              {result.rule_flags?.length > 0 && (
                <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.08)' }}>
                  <p style={{ fontSize: 10.5, color: '#fca5a5', fontWeight: 600 }}>Rule flags: {result.rule_flags.join(', ')}</p>
                </div>
              )}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="glass-card" style={{ padding: 16, flex: 1 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 12 }}>Transaction History ({history.length})</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
                {history.map((tx, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7, background: tx.anomaly_flag ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${tx.anomaly_flag ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)'}` }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: tx.anomaly_flag ? '#ef4444' : '#22c55e', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 10.5, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.tx_id}</p>
                      <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>{tx.sender} → {tx.receiver}</p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>₹{Number(tx.amount).toLocaleString('en-IN')}</p>
                      {tx.anomaly_flag && <p style={{ fontSize: 9.5, color: '#ef4444', fontWeight: 700 }}>{tx.fraud_type}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
