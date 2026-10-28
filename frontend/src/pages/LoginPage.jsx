import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Shield, Eye, EyeOff, Lock, LogIn, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [email, setEmail] = useState('admin@fraudscope.ai');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success('Access granted. Welcome to Fraudscope AI.');
      navigate('/dashboard');
    } catch (err) {
      const msg = err?.error || err?.message || 'Authentication failed. Check credentials and try again.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const labelStyle = {
    display: 'block', fontSize: 11, fontWeight: 700,
    color: 'var(--text-3)', marginBottom: 7,
    letterSpacing: '0.09em', textTransform: 'uppercase'
  };

  return (
    <div className="min-h-screen cyber-grid flex items-center justify-center p-4">

      {/* Background ambient orbs */}
      <div style={{
        position: 'fixed', top: '8%', left: '8%', width: 450, height: 450,
        background: 'radial-gradient(circle, rgba(26,108,188,0.09) 0%, transparent 70%)',
        borderRadius: '50%', pointerEvents: 'none', animation: 'pulse 5s ease-in-out infinite'
      }} />
      <div style={{
        position: 'fixed', bottom: '8%', right: '8%', width: 520, height: 520,
        background: 'radial-gradient(circle, rgba(201,168,76,0.07) 0%, transparent 70%)',
        borderRadius: '50%', pointerEvents: 'none', animation: 'pulse 6s ease-in-out infinite reverse'
      }} />

      <div className="w-full max-w-md animate-in">

        {/* Branding */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 68, height: 68, borderRadius: 18, margin: '0 auto 18px',
            background: 'linear-gradient(135deg, #1a6cbc 0%, #c9a84c 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 40px rgba(26,108,188,0.4), 0 0 80px rgba(201,168,76,0.15)',
          }}>
            <Shield size={34} color="#fff" />
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 6 }}>
            <span className="text-gradient-accent">Fraudscope AI</span>
          </h1>
          <p style={{ color: 'var(--text-3)', fontSize: 13.5, letterSpacing: '0.01em' }}>
            Anti-Money Laundering Intelligence Platform
          </p>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 12,
            padding: '5px 14px', borderRadius: 20,
            background: 'rgba(26,108,188,0.1)', border: '1px solid rgba(26,108,188,0.25)'
          }}>
            <div className="pulse-dot" style={{ width: 6, height: 6 }} />
            <span style={{ fontSize: 10.5, color: 'var(--blue-2)', fontWeight: 700, letterSpacing: '0.1em' }}>
              LIVE MONITORING ACTIVE
            </span>
          </div>
        </div>

        {/* Card */}
        <div className="glass-card cyber-border-animated" style={{ padding: '32px 28px' }}>

          {/* Card header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              background: 'rgba(26,108,188,0.12)', border: '1px solid rgba(26,108,188,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Lock size={16} color="var(--blue-2)" />
            </div>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1 }}>Secure Sign In</h2>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>Authorized personnel only</p>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
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

            {/* Password */}
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  className="cyber-input"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  style={{ paddingRight: 44 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)'
                  }}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="btn-primary"
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center', padding: '12px 20px', fontSize: 14.5, borderRadius: 8 }}
            >
              {loading
                ? <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />Authenticating...</>
                : <><LogIn size={17} />Access Intelligence Platform</>
              }
            </button>
          </form>

          {/* Demo credentials box */}
          <div style={{
            marginTop: 20, padding: '11px 14px', borderRadius: 8,
            background: 'rgba(201,168,76,0.07)', border: '1px solid rgba(201,168,76,0.25)'
          }}>
            <p style={{ fontSize: 10.5, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>
              Demo Credentials
            </p>
            <p style={{ fontSize: 12.5, color: 'var(--gold)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 500 }}>
              admin@fraudscope.ai
            </p>
            <p style={{ fontSize: 12.5, color: 'var(--gold-2)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 500 }}>
              Fraudscope@2024
            </p>
          </div>

          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
              New investigator?
            </p>
            <Link
              to="/signup"
              className="btn-primary"
              style={{
                marginTop: 10,
                width: '100%',
                justifyContent: 'center',
                textDecoration: 'none',
                padding: '11px 16px',
                borderRadius: 8,
              }}
            >
              <UserPlus size={16} />
              Request Access
            </Link>
          </div>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: 'var(--text-3)' }}>
          RBI AML Compliance Platform · Fraudscope AI · v1.0 · Hackathon Demo
        </p>
      </div>
    </div>
  );
}
