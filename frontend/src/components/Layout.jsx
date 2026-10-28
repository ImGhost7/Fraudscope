import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import {
  LayoutDashboard, Activity, GitBranch, Bell, Search, Shield,
  Users, LogOut, Wifi, WifiOff, Menu, X, MapPin, Beaker
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { path: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/transactions',  icon: Activity,         label: 'Live Transactions' },
  { path: '/graph',         icon: GitBranch,        label: 'Fund Flow Graph' },
  { path: '/alerts',        icon: Bell,             label: 'Alert Center' },
  { path: '/investigations',icon: Search,           label: 'Investigations' },
  { path: '/accounts',      icon: Users,            label: 'Accounts' },
  { path: '/geomap',        icon: MapPin,           label: 'Geo Intel Map' },
  { path: '/rules',         icon: Shield,           label: 'AML Rule Engine' },
  { path: '/simulation',    icon: Beaker,           label: 'Simulation Studio', accent: true },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { connected, liveAlerts } = useSocket();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const openAlerts = liveAlerts.filter(a => a.status === 'OPEN' || !a.status).length;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* ── Sidebar ── */}
      <aside
        className="flex flex-col transition-all duration-300"
        style={{
          width: sidebarOpen ? '240px' : '64px',
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {/* Logo */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
          borderBottom: '1px solid var(--border)', minHeight: 64,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
            background: 'linear-gradient(135deg, #1a6cbc, #c9a84c)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(26,108,188,0.35)',
          }}>
            <Shield size={20} color="#fff" />
          </div>
          {sidebarOpen && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.02em', lineHeight: 1 }}>
                Fraudscope
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--gold)', letterSpacing: '0.12em', fontWeight: 700, marginTop: 2 }}>
                AML INTELLIGENCE
              </div>
            </div>
          )}
        </div>

        {/* Nav section label */}
        {sidebarOpen && (
          <div style={{ padding: '16px 16px 6px', fontSize: 9.5, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Navigation
          </div>
        )}

        {/* Nav links */}
        <nav style={{ flex: 1, padding: '4px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {navItems.map(({ path, icon: Icon, label, accent }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              title={!sidebarOpen ? label : ''}
              style={accent ? { color: 'var(--gold)', borderTop: '1px solid rgba(201,168,76,0.15)', marginTop: 6, paddingTop: 8 } : {}}
            >
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <Icon size={17} />
                {path === '/alerts' && openAlerts > 0 && (
                  <span style={{
                    position: 'absolute', top: -5, right: -5,
                    background: 'var(--danger-2)', borderRadius: '50%',
                    width: 14, height: 14, fontSize: 8.5, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                    border: '1.5px solid var(--surface)',
                  }}>{Math.min(openAlerts, 9)}</span>
                )}
              </div>
              {sidebarOpen && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom section — user + status */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 10px 12px' }}>

          {/* Connection status */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 6, marginBottom: 8,
            background: connected ? 'rgba(15,122,82,0.08)' : 'rgba(200,40,40,0.08)',
            border: `1px solid ${connected ? 'rgba(15,122,82,0.2)' : 'rgba(200,40,40,0.2)'}`,
          }}>
            {connected
              ? <><Wifi size={12} color="var(--success-2)" />{sidebarOpen && <span style={{ fontSize: 11, color: 'var(--success-2)', fontWeight: 600 }}>Live Stream Active</span>}</>
              : <><WifiOff size={12} color="var(--danger-2)" />{sidebarOpen && <span style={{ fontSize: 11, color: 'var(--danger-2)', fontWeight: 600 }}>Disconnected</span>}</>
            }
          </div>

          {/* User info */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 7, marginBottom: 8,
            background: 'rgba(26,108,188,0.07)', border: '1px solid rgba(26,108,188,0.15)',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, rgba(26,108,188,0.4), rgba(201,168,76,0.3))',
              border: '1.5px solid rgba(201,168,76,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: 'var(--gold)',
            }}>
              {user?.name?.[0]?.toUpperCase() || 'A'}
            </div>
            {sidebarOpen && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.04em' }}>{user?.role}</div>
              </div>
            )}
          </div>

          <button onClick={logout} className="sidebar-link" style={{ width: '100%', color: 'var(--text-3)' }}>
            <LogOut size={15} />
            {sidebarOpen && <span>Sign Out</span>}
          </button>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{
            position: 'absolute', top: 20, left: sidebarOpen ? 222 : 46,
            width: 22, height: 22, borderRadius: '50%',
            background: 'var(--card)', border: '1px solid var(--border-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text-3)', transition: 'left 0.3s', zIndex: 10,
          }}
        >
          {sidebarOpen ? <X size={11} /> : <Menu size={11} />}
        </button>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-auto cyber-grid">
        <Outlet />
      </main>
    </div>
  );
}
