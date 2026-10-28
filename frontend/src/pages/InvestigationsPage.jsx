import { useQuery } from '@tanstack/react-query';
import { investigationApi } from '../services/api';
import { useState } from 'react';
import { Shield, Plus, FileText, Clock, CheckCircle, X, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';

const STATUS_CONFIG = {
  OPEN: { color: '#f59e0b', label: 'Open' },
  IN_PROGRESS: { color: '#00d4ff', label: 'In Progress' },
  RESOLVED: { color: '#10b981', label: 'Resolved' },
  ESCALATED: { color: '#ef4444', label: 'Escalated' },
};

const SEVERITY_COLOR = { CRITICAL: '#ef4444', HIGH: '#f59e0b', MEDIUM: '#00d4ff', LOW: '#10b981' };

function CreateCaseModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    title: '', description: '', investigator: 'Admin Investigator',
    severity: 'HIGH', fraud_type: 'LAYERING'
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const inv = await investigationApi.create(form);
      toast.success(`Case ${inv.case_id} created`);
      onCreated();
      onClose();
    } catch {
      toast.error('Failed to create case');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div style={{ width: 500, background: '#0d1b2a', border: '1px solid #1a3a52', borderRadius: 16, padding: 28 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>New Investigation Case</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          {[
            { label: 'Case Title', key: 'title', placeholder: 'e.g., Layering Chain Investigation' },
            { label: 'Investigator', key: 'investigator', placeholder: 'Investigator name' },
          ].map(({ label, key, placeholder }) => (
            <div key={key} style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
              <input className="cyber-input" placeholder={placeholder} value={form[key]} onChange={e => setForm(f => ({...f, [key]: e.target.value}))} required />
            </div>
          ))}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description</label>
            <textarea className="cyber-input" style={{ resize: 'vertical', minHeight: 80 }} placeholder="Investigation details..." value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Severity</label>
              <select className="cyber-input" value={form.severity} onChange={e => setForm(f => ({...f, severity: e.target.value}))}>
                {['CRITICAL','HIGH','MEDIUM','LOW'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fraud Type</label>
              <select className="cyber-input" value={form.fraud_type} onChange={e => setForm(f => ({...f, fraud_type: e.target.value}))}>
                {['LAYERING','STRUCTURING','ROUND_TRIP','FAN_OUT','DORMANT_ACTIVATION','MULE'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating...' : <><Shield size={14} />Create Case</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CaseDetail({ caseData, onClose, onUpdated }) {
  const [noteText, setNoteText] = useState('');
  const [loading, setLoading] = useState(false);

  const addNote = async () => {
    if (!noteText.trim()) return;
    try {
      await investigationApi.addNote(caseData.case_id, { author: 'Admin Investigator', content: noteText });
      setNoteText('');
      onUpdated();
      toast.success('Note added');
    } catch {
      toast.error('Failed to add note');
    }
  };

  const generateSTR = async () => {
    setLoading(true);
    try {
      await investigationApi.generateSTR(caseData.case_id);
      
      // Generate PDF
      const doc = new jsPDF();
      const pageW = doc.internal.pageSize.getWidth();
      
      // Header
      doc.setFillColor(6, 11, 20);
      doc.rect(0, 0, pageW, 40, 'F');
      doc.setTextColor(0, 212, 255);
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('SUSPICIOUS TRANSACTION REPORT (STR)', 14, 18);
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text('Fraudscope AI • AML Compliance Division • Confidential', 14, 28);
      doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 14, 36);
      
      doc.setTextColor(30, 30, 30);
      let y = 55;
      
      const section = (title) => {
        doc.setFillColor(240, 245, 255);
        doc.rect(10, y - 5, pageW - 20, 10, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(0, 100, 150);
        doc.text(title, 14, y + 2);
        y += 14;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(50, 50, 50);
      };

      const row = (label, value) => {
        doc.setFont('helvetica', 'bold');
        doc.text(`${label}:`, 14, y);
        doc.setFont('helvetica', 'normal');
        doc.text(String(value || 'N/A'), 70, y);
        y += 8;
      };

      section('CASE INFORMATION');
      row('Case ID', caseData.case_id);
      row('Title', caseData.title);
      row('Fraud Type', caseData.fraud_type?.replace(/_/g, ' '));
      row('Severity', caseData.severity);
      row('Status', caseData.status);
      row('Investigator', caseData.investigator);
      row('Created At', new Date(caseData.createdAt).toLocaleString('en-IN'));
      row('Total Amount', `INR ${Number(caseData.total_amount_involved || 0).toLocaleString('en-IN')}`);
      y += 5;

      section('SUSPICIOUS ACCOUNTS');
      (caseData.linked_accounts || []).forEach((acc, i) => {
        doc.text(`${i + 1}. ${acc}`, 14, y);
        y += 7;
      });
      y += 5;

      section('FLAGGED TRANSACTIONS');
      (caseData.linked_transactions || []).forEach((tx, i) => {
        doc.text(`${i + 1}. ${tx}`, 14, y);
        y += 7;
      });
      y += 5;

      section('INVESTIGATION NOTES');
      (caseData.notes || []).forEach((note) => {
        doc.setFont('helvetica', 'bold');
        doc.text(`[${new Date(note.timestamp).toLocaleString('en-IN')}] ${note.author}:`, 14, y);
        y += 7;
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(note.content, pageW - 28);
        doc.text(lines, 14, y);
        y += lines.length * 6 + 4;
      });
      y += 5;

      section('RISK ASSESSMENT');
      doc.text('Fraud Pattern: Consistent with known money laundering typologies.', 14, y); y += 7;
      doc.text('Recommended Action: Report to FIU-IND within 7 working days.', 14, y); y += 7;
      doc.text('Priority: ESCALATE to Senior Compliance Officer.', 14, y); y += 14;

      // Footer
      doc.setFillColor(6, 11, 20);
      doc.rect(0, doc.internal.pageSize.getHeight() - 20, pageW, 20, 'F');
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(9);
      doc.text('STRICTLY CONFIDENTIAL — For authorized personnel only — Fraudscope AI AML Platform', 14, doc.internal.pageSize.getHeight() - 7);

      doc.save(`STR_${caseData.case_id}_${Date.now()}.pdf`);
      toast.success('STR Report downloaded!');
      onUpdated();
    } catch {
      toast.error('Failed to generate STR');
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (status) => {
    try {
      await investigationApi.update(caseData.case_id, { status });
      onUpdated();
      toast.success(`Case status updated to ${status}`);
    } catch {
      toast.error('Failed to update status');
    }
  };

  const sc = STATUS_CONFIG[caseData.status] || STATUS_CONFIG.OPEN;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div style={{ width: 700, maxHeight: '85vh', background: '#0d1b2a', border: '1px solid #1a3a52', borderRadius: 16, overflow: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding: '24px 28px', borderBottom: '1px solid #1a3a52', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: '#0d1b2a', zIndex: 5 }}>
          <div>
            <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace', marginBottom: 4 }}>{caseData.case_id}</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>{caseData.title}</h2>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: sc.color, background: `${sc.color}18`, padding: '4px 12px', borderRadius: 6, border: `1px solid ${sc.color}44`, fontWeight: 600 }}>
              {sc.label}
            </span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}><X size={18} /></button>
          </div>
        </div>

        <div style={{ padding: 28 }}>
          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
            {[
              ['Severity', caseData.severity, SEVERITY_COLOR[caseData.severity]],
              ['Fraud Type', caseData.fraud_type?.replace(/_/g,' '), '#00d4ff'],
              ['Investigator', caseData.investigator, '#10b981'],
            ].map(([label, value, color]) => (
              <div key={label} style={{ padding: 12, background: '#111f2e', borderRadius: 8, border: '1px solid #1a3a52' }}>
                <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 13, color, fontWeight: 600 }}>{value || '-'}</div>
              </div>
            ))}
          </div>

          {/* Description */}
          {caseData.description && (
            <div style={{ marginBottom: 20, padding: 14, background: '#111f2e', borderRadius: 8, border: '1px solid #1a3a52' }}>
              <p style={{ fontSize: 13, color: '#94a3b8' }}>{caseData.description}</p>
            </div>
          )}

          {/* Accounts */}
          {caseData.linked_accounts?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h4 style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Linked Accounts</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {caseData.linked_accounts.map(acc => (
                  <span key={acc} style={{ fontSize: 12, fontFamily: 'monospace', color: '#e2e8f0', background: 'rgba(0,212,255,0.08)', padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(0,212,255,0.2)' }}>{acc}</span>
                ))}
              </div>
            </div>
          )}

          {/* Timeline / Notes */}
          <div style={{ marginBottom: 20 }}>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Investigation Timeline</h4>
            {(caseData.notes || []).length === 0 ? (
              <p style={{ fontSize: 13, color: '#475569' }}>No notes yet. Add your first observation.</p>
            ) : (
              (caseData.notes || []).map((note, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                  <div style={{ width: 2, background: '#1a3a52', borderRadius: 1, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 11, color: '#475569', marginBottom: 4 }}>
                      <span style={{ color: '#00d4ff', fontWeight: 600 }}>{note.author}</span> •{' '}
                      {new Date(note.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                    <p style={{ fontSize: 13, color: '#cbd5e1' }}>{note.content}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Add note */}
          <div style={{ marginBottom: 24 }}>
            <textarea
              className="cyber-input"
              style={{ resize: 'vertical', minHeight: 80 }}
              placeholder="Add investigation note..."
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
            />
            <button onClick={addNote} className="btn-ghost" style={{ marginTop: 8 }}>
              <FileText size={14} />Add Note
            </button>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, borderTop: '1px solid #1a3a52', paddingTop: 20, flexWrap: 'wrap' }}>
            {caseData.status === 'OPEN' && (
              <button onClick={() => updateStatus('IN_PROGRESS')} className="btn-ghost">
                <Clock size={14} />Mark In Progress
              </button>
            )}
            {caseData.status !== 'RESOLVED' && (
              <button onClick={() => updateStatus('RESOLVED')} className="btn-ghost">
                <CheckCircle size={14} />Mark Resolved
              </button>
            )}
            <button
              onClick={generateSTR}
              className="btn-danger"
              disabled={loading}
              style={{ marginLeft: 'auto' }}
            >
              <FileText size={14} />
              {loading ? 'Generating...' : 'Generate STR Report'}
            </button>
          </div>
          {caseData.str_generated && (
            <div style={{ marginTop: 12, padding: '8px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', fontSize: 12, color: '#ef4444' }}>
              ✓ STR filed on {new Date(caseData.str_generated_at).toLocaleString('en-IN')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InvestigationsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);

  const { data, refetch } = useQuery({
    queryKey: ['investigations'],
    queryFn: () => investigationApi.getAll(),
  });

  const cases = data?.cases || [];
  const handleUpdated = () => {
    refetch();
    if (selectedCase) {
      investigationApi.getOne(selectedCase.case_id).then(setSelectedCase).catch(() => {});
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0' }}>Investigation Workspace</h1>
          <p style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>{cases.length} total cases</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={16} />New Case
        </button>
      </div>

      {/* Cases list */}
      {cases.length === 0 ? (
        <div className="glass-card" style={{ padding: 60, textAlign: 'center' }}>
          <Shield size={40} color="#1a3a52" style={{ margin: '0 auto 12px' }} />
          <p style={{ color: '#475569', fontSize: 14 }}>No investigations yet. Create one from an alert.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {cases.map(inv => {
            const sc = STATUS_CONFIG[inv.status] || STATUS_CONFIG.OPEN;
            const sev = SEVERITY_COLOR[inv.severity] || '#64748b';
            return (
              <div
                key={inv.case_id}
                className="glass-card animate-in"
                style={{ padding: 20, cursor: 'pointer', transition: 'all 0.2s' }}
                onClick={() => setSelectedCase(inv)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10,
                    background: `${sev}18`, border: `1px solid ${sev}33`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                  }}>
                    <Shield size={20} color={sev} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>{inv.case_id}</span>
                      <span style={{ fontSize: 11, color: sc.color, fontWeight: 600, background: `${sc.color}18`, padding: '2px 8px', borderRadius: 4 }}>{sc.label}</span>
                      <span className={`badge badge-${inv.severity?.toLowerCase()}`}>{inv.severity}</span>
                      {inv.str_generated && <span className="badge badge-critical" style={{ fontSize: 9 }}>STR FILED</span>}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>{inv.title}</div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#475569' }}>
                      <span>👤 {inv.investigator}</span>
                      <span>🔍 {inv.fraud_type?.replace(/_/g,' ')}</span>
                      <span>📋 {inv.notes?.length || 0} notes</span>
                      <span>📅 {new Date(inv.createdAt).toLocaleDateString('en-IN')}</span>
                    </div>
                  </div>
                  <ChevronRight size={18} color="#475569" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && <CreateCaseModal onClose={() => setShowCreate(false)} onCreated={refetch} />}
      {selectedCase && <CaseDetail caseData={selectedCase} onClose={() => setSelectedCase(null)} onUpdated={handleUpdated} />}
    </div>
  );
}
