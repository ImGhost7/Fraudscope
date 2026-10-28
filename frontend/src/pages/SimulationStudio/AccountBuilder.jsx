/**
 * Simulation Studio — Account Builder
 * Create accounts manually with the same schema as seeded accounts.
 */
import { useState } from 'react';
import { simulatorApi } from '../../services/api';
import { UserPlus, Building2, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';

const sel = {
  accountType: ['SAVINGS', 'MULE', 'SHELL'],
  status:      ['ACTIVE', 'DORMANT'],
  kyc:         ['LOW', 'MEDIUM', 'HIGH'],
  city:        ['Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Hyderabad', 'Pune', 'Kolkata', 'Ahmedabad'],
};

const DEFAULTS = { customer_name: '', account_type: 'SAVINGS', status: 'ACTIVE', opening_balance: 10000, kyc_level: 'MEDIUM', city: 'Mumbai' };

const TYPE_INFO = {
  SAVINGS: { color: '#22c55e', desc: 'Standard legitimate account' },
  MULE:    { color: '#f97316', desc: 'Money-mule recipient account' },
  SHELL:   { color: '#ef4444', desc: 'Shell company / pass-through' },
};

export default function AccountBuilder({ onAccountCreated }) {
  const [form, setForm] = useState(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [lastCreated, setLastCreated] = useState(null);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer_name.trim()) { toast.error('Customer name is required'); return; }
    setLoading(true);
    try {
      const result = await simulatorApi.createAccount({ ...form, opening_balance: Number(form.opening_balance) });
      setLastCreated(result);
      toast.success(`Account ${result.account_id} created successfully`);
      setForm(DEFAULTS);
      onAccountCreated?.();
    } catch (err) {
      toast.error(err?.error || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const typeInfo = TYPE_INFO[form.account_type];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(26,108,188,0.12)', border: '1px solid rgba(26,108,188,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <UserPlus size={17} color="var(--blue-2)" />
        </div>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>Account Builder</h2>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Create a new bank account to use in simulations</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Customer Name */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 6 }}>Customer / Company Name</label>
            <input id="acc-name" className="cyber-input" value={form.customer_name} onChange={e => set('customer_name', e.target.value)}
              placeholder="e.g. Rahul Sharma or Apex Holdings Ltd" required />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Account Type */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 6 }}>Account Type</label>
              <select id="acc-type" className="cyber-input" value={form.account_type} onChange={e => set('account_type', e.target.value)} style={{ cursor: 'pointer' }}>
                {sel.accountType.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>

            {/* Status */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 6 }}>Account Status</label>
              <select id="acc-status" className="cyber-input" value={form.status} onChange={e => set('status', e.target.value)} style={{ cursor: 'pointer' }}>
                {sel.status.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>

            {/* KYC */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 6 }}>KYC Level</label>
              <select id="acc-kyc" className="cyber-input" value={form.kyc_level} onChange={e => set('kyc_level', e.target.value)} style={{ cursor: 'pointer' }}>
                {sel.kyc.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>

            {/* City */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 6 }}>City</label>
              <select id="acc-city" className="cyber-input" value={form.city} onChange={e => set('city', e.target.value)} style={{ cursor: 'pointer' }}>
                {sel.city.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>

          {/* Opening Balance */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 6 }}>Opening Balance (₹)</label>
            <input id="acc-balance" className="cyber-input" type="number" min="0" value={form.opening_balance}
              onChange={e => set('opening_balance', e.target.value)} placeholder="10000" />
          </div>

          {/* Account type hint */}
          <div style={{ padding: '10px 14px', borderRadius: 8, background: `${typeInfo.color}0d`, border: `1px solid ${typeInfo.color}33`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Building2 size={14} color={typeInfo.color} />
            <span style={{ fontSize: 12, color: typeInfo.color, fontWeight: 600 }}>{form.account_type}</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>— {typeInfo.desc}</span>
          </div>

          <button id="btn-create-account" type="submit" disabled={loading} className="btn-primary"
            style={{ justifyContent: 'center', padding: '12px 20px', fontSize: 14, borderRadius: 8, marginTop: 4 }}>
            {loading
              ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Creating Account...</>
              : <><UserPlus size={16} /> Create Account</>
            }
          </button>
        </form>

        {/* Preview + last created */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Preview card */}
          <div className="glass-card" style={{ padding: 18 }}>
            <p style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Preview</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                ['Name', form.customer_name || '—'],
                ['Type', form.account_type],
                ['Status', form.status],
                ['KYC', form.kyc_level],
                ['City', form.city],
                ['Balance', `₹${Number(form.opening_balance || 0).toLocaleString('en-IN')}`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{k}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Last created */}
          {lastCreated && (
            <div style={{ padding: 16, borderRadius: 10, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                <CheckCircle2 size={15} color="#22c55e" />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>Account Created</span>
              </div>
              {[['ID', lastCreated.account_id], ['Name', lastCreated.customer_name], ['Balance', `₹${Number(lastCreated.balance).toLocaleString('en-IN')}`]].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{k}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', fontFamily: k === 'ID' ? 'JetBrains Mono, monospace' : 'inherit' }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
