import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [liveTransactions, setLiveTransactions] = useState([]);
  const [liveAlerts, setLiveAlerts] = useState([]);
  const listenersRef = useRef({});

  useEffect(() => {
    const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
    const s = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    s.on('connect', () => { setConnected(true); console.log('🔌 Socket connected'); });
    s.on('disconnect', () => { setConnected(false); console.log('🔌 Socket disconnected'); });

    s.on('new_transaction', (tx) => {
      setLiveTransactions(prev => [tx, ...prev.slice(0, 99)]);
      listenersRef.current['new_transaction']?.forEach(fn => fn(tx));
    });

    s.on('transaction_flagged', (tx) => {
      setLiveTransactions(prev => {
        const exists = prev.some(t => t.tx_id === tx.tx_id);
        if (exists) {
          // Update in place — fraud engine has enriched the tx
          return prev.map(t => t.tx_id === tx.tx_id ? tx : t);
        } else {
          // Transaction was not in the live buffer — prepend it so it's visible
          return [tx, ...prev.slice(0, 99)];
        }
      });
      listenersRef.current['transaction_flagged']?.forEach(fn => fn(tx));
    });

    s.on('new_alert', (alert) => {
      setLiveAlerts(prev => [alert, ...prev.slice(0, 49)]);
      listenersRef.current['new_alert']?.forEach(fn => fn(alert));
    });

    s.on('transaction_updated', (tx) => {
      // Fired after fraud engine completes — contains final anomaly_flag, fraud_type, risk_score
      setLiveTransactions(prev => {
        const exists = prev.some(t => t.tx_id === tx.tx_id);
        if (exists) {
          return prev.map(t => t.tx_id === tx.tx_id ? tx : t);
        } else {
          return [tx, ...prev.slice(0, 99)];
        }
      });
      listenersRef.current['transaction_updated']?.forEach(fn => fn(tx));
    });

    s.on('account_created', (account) => {
      listenersRef.current['account_created']?.forEach(fn => fn(account));
    });

    setSocket(s);
    return () => s.disconnect();
  }, []);

  const on = (event, fn) => {
    if (!listenersRef.current[event]) listenersRef.current[event] = new Set();
    listenersRef.current[event].add(fn);
    return () => listenersRef.current[event]?.delete(fn);
  };

  const emit = (event, data) => socket?.emit(event, data);

  return (
    <SocketContext.Provider value={{ socket, connected, liveTransactions, liveAlerts, on, emit }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
