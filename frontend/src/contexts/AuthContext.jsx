import { createContext, useContext, useState, useEffect } from 'react';
import { authApi } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('fraudscope_token');
    const userData = localStorage.getItem('fraudscope_user');
    if (token && userData) {
      try { setUser(JSON.parse(userData)); } catch { localStorage.removeItem("fraudscope_user"); }
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    const data = await authApi.login({ email, password });
    localStorage.setItem('fraudscope_token', data.token);
    localStorage.setItem('fraudscope_user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  };

  const signup = async (name, email, password, role) => {
    const data = await authApi.register({ name, email, password, role });
    localStorage.setItem('fraudscope_token', data.token);
    localStorage.setItem('fraudscope_user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('fraudscope_token');
    localStorage.removeItem('fraudscope_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, signup, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
