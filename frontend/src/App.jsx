import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import DashboardPage from './pages/DashboardPage';
import TransactionsPage from './pages/TransactionsPage';
import GraphPage from './pages/GraphPage';
import AlertsPage from './pages/AlertsPage';
import InvestigationsPage from './pages/InvestigationsPage';
import AccountsPage from './pages/AccountsPage';
import GeoMapPage from './pages/GeoMapPage';
import RuleSettingsPage from './pages/RuleSettingsPage';
import SimulationStudio from './pages/SimulationStudio';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000, refetchInterval: 10000 } }
});

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center h-screen" style={{background:'#060b14'}}>
      <div className="spinner" />
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SocketProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/" element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="transactions" element={<TransactionsPage />} />
                <Route path="graph" element={<GraphPage />} />
                <Route path="alerts" element={<AlertsPage />} />
                <Route path="investigations" element={<InvestigationsPage />} />
                <Route path="accounts" element={<AccountsPage />} />
                <Route path="geomap" element={<GeoMapPage />} />
                <Route path="rules" element={<RuleSettingsPage />} />
                <Route path="simulation" element={<SimulationStudio />} />
              </Route>
            </Routes>
          </BrowserRouter>
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: '#0d1b2a',
                color: '#e2e8f0',
                border: '1px solid #1a3a52',
                borderRadius: '10px',
                fontSize: '13px',
              },
              duration: 4000,
            }}
          />
        </SocketProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
