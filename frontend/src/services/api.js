import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Auth token interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('fraudscope_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('fraudscope_token');
      // Only force-redirect to login if on a protected page (not already on login/signup)
      const onAuthPage = ['/login', '/signup'].some(p => window.location.pathname.startsWith(p));
      if (!onAuthPage) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err.response?.data || err);
  }
);

// Auth
export const authApi = {
  login: (data) => api.post('/auth/login', data),
  register: (data) => api.post('/auth/register', data),
};

// Dashboard
export const dashboardApi = {
  getStats: () => api.get('/dashboard/stats'),
};

// Transactions
export const txApi = {
  getAll: (params) => api.get('/transactions', { params }),
  getGraph: (params) => api.get('/transactions/graph', { params }),
  getOne: (txId) => api.get(`/transactions/${txId}`),
  getStats: () => api.get('/transactions/stats/summary'),
};

// Alerts
export const alertApi = {
  getAll: (params) => api.get('/alerts', { params }),
  getStats: () => api.get('/alerts/stats'),
  getOne: (alertId) => api.get(`/alerts/${alertId}`),
  updateStatus: (alertId, data) => api.patch(`/alerts/${alertId}/status`, data),
};

// Accounts
export const accountApi = {
  getAll: (params) => api.get('/accounts', { params }),
  getOne: (accountId) => api.get(`/accounts/${accountId}`),
  getStats: () => api.get('/accounts/stats/summary'),
};

// Investigations
export const investigationApi = {
  getAll: (params) => api.get('/investigations', { params }),
  getOne: (caseId) => api.get(`/investigations/${caseId}`),
  create: (data) => api.post('/investigations', data),
  update: (caseId, data) => api.patch(`/investigations/${caseId}`, data),
  addNote: (caseId, data) => api.post(`/investigations/${caseId}/notes`, data),
  generateSTR: (caseId) => api.post(`/investigations/${caseId}/str`),
};

// Simulator Studio
export const simulatorApi = {
  getAccounts: () => api.get('/simulator/accounts'),
  createAccount: (data) => api.post('/simulator/account', data),
  submitTransaction: (data) => api.post('/simulator/transaction', data),
  runScenario: (type) => api.post(`/simulator/scenario/${type}`),
};

// AML Rules & Dynamic Tuning API
export const rulesApi = {
  getConfig: () => api.get('/rules/config'),
  updateConfig: (data) => api.patch('/rules/config', data),
  dryRun: (data) => api.post('/rules/dry-run', data),
};

// ML layers (Isolation Forest + GNN + risk fusion)
export const mlApi = {
  getStatus: () => api.get('/ml/status'),
  getGnnAccounts: (params) => api.get('/ml/gnn/accounts', { params }),
  getGnnAccount: (id) => api.get(`/ml/gnn/accounts/${id}`),
};

export default api;
