import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Shield, Eye, EyeOff, UserPlus, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('ANALYST');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await signup(name, email, password, role);
      toast.success('Account created! Welcome to Fraudscope AI.');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const labelStyle = {
    display: 'block', fontSize: 12, fontWeight: 600,
    color: '#64748b', marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase'
  };

  const eyeBtnStyle = {
    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
    background: 'none', border: 'none', cursor: 'pointer', color: '#475569'
  };

  return (
    <div className="min-h-screen cyber-grid flex items-center justify-center p-4" style={{ background: '#060b14' }}>
      {/* Animated background orbs */}
      <div style={{
        position: 'fixed', top: '10%', left: '10%', width: 400, height: 400,
        background: 'radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 70%)',
        borderRadius: '50%', pointerEvents: 'none', animation: 'pulse 4s ease-in-out infinite'
      }} />
      <div style={{
        position: 'fixed', bottom: '10%', right: '10%', width: 500, height: 500,
        background: 'radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 70%)',
        borderRadius: '50%', pointerEvents: 'none', animation: 'pulse 5s ease-in-out infinite reverse'
      }} />

      <div className="w-full max-w-md animate-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div style={{
            width: 64, height: 64, borderRadius: 16, margin: '0 auto 16px',
            background: 'linear-gradient(135deg, #00d4ff, #7c3aed)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 40px rgba(0,212,255,0.4)'
          }}>
            <Shield size={32} color="#fff" />
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 6 }}>
            <span className="text-gradient-accent">Fraudscope AI</span>
          </h1>
          <p style={{ color: '#475569', fontSize: 14 }}>Create your investigator account</p>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10,
            padding: '4px 12px', borderRadius: 20,
            background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)'
          }}>
            <UserPlus size={12} style={{ color: '#a78bfa' }} />
            <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 600 }}>NEW ACCOUNT REGISTRATION</span>
          </div>
        </div>

        {/* Signup Form */}
        <div className="glass-card p-8">
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>Create Account</h2>
            <p style={{ fontSize: 13, color: '#475569' }}>Fill in your details to get started</p>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Full Name */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Full Name</label>
              <input
                type="text"
                className="cyber-input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="John Doe"
                required
              />
            </div>

            {/* Email */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Email Address</label>
              <input
                type="email"
                className="cyber-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="investigator@fraudscope.ai"
                required
              />
            </div>

            {/* Role */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Role</label>
              <div style={{ position: 'relative' }}>
                <select
                  className="cyber-input"
                  value={role}
                  onChange={e => setRole(e.target.value)}
                  style={{
                    appearance: 'none', cursor: 'pointer', paddingRight: 36,
                  }}
                >
                  <option value="ANALYST">Analyst</option>
                  <option value="INVESTIGATOR">Investigator</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <ChevronDown size={16} style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  color: '#475569', pointerEvents: 'none'
                }} />
              </div>
            </div>

            {/* Password */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  className="cyber-input"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  required
                  minLength={6}
                  style={{ paddingRight: 44 }}
                />
                <button type="button" onClick={() => setShowPass(!showPass)} style={eyeBtnStyle}>
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showConfirm ? 'text' : 'password'}
                  className="cyber-input"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  minLength={6}
                  style={{ paddingRight: 44 }}
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} style={eyeBtnStyle}>
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p style={{ fontSize: 11, color: '#ef4444', marginTop: 6 }}>Passwords do not match</p>
              )}
            </div>

            <button
              type="submit"
              className="btn-primary w-full justify-center"
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center', padding: '12px 20px', fontSize: 15 }}
            >
              {loading ? (
                <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />Creating Account...</>
              ) : (
                <><UserPlus size={16} />Create Account</>
              )}
            </button>
          </form>

          {/* Link to Login */}
          <div style={{ marginTop: 20, textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: '#475569' }}>
              Already have an account?{' '}
              <Link to="/login" style={{ color: '#00d4ff', fontWeight: 600, textDecoration: 'none' }}>
                Sign In
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: '#334155' }}>
          RBI AML Compliance Platform • Version 1.0 • Hackathon Demo
        </p>
      </div>
    </div>
  );
}
