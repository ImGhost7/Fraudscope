import { useQuery } from '@tanstack/react-query';
import { txApi, accountApi } from '../services/api';
import { useSocket } from '../contexts/SocketContext';
import { useState, useEffect } from 'react';
import { MapPin, AlertTriangle } from 'lucide-react';

const CITY_COORDS = {
  'Mumbai': { lat: 19.076, lng: 72.877 },
  'Delhi': { lat: 28.704, lng: 77.102 },
  'Bangalore': { lat: 12.971, lng: 77.594 },
  'Chennai': { lat: 13.082, lng: 80.270 },
  'Hyderabad': { lat: 17.385, lng: 78.486 },
  'Pune': { lat: 18.520, lng: 73.856 },
  'Kolkata': { lat: 22.572, lng: 88.363 },
  'Ahmedabad': { lat: 23.022, lng: 72.571 },
  'Jaipur': { lat: 26.912, lng: 75.787 },
  'Surat': { lat: 21.170, lng: 72.831 },
};

// Map coordinate to SVG position (India bounding box approx)
const toSVG = (lat, lng, w = 600, h = 500) => {
  const minLat = 8, maxLat = 37, minLng = 68, maxLng = 97;
  const x = ((lng - minLng) / (maxLng - minLng)) * w;
  const y = h - ((lat - minLat) / (maxLat - minLat)) * h;
  return { x, y };
};

function GeoNode({ city, count, maxCount, isSuspicious, onClick }) {
  const coords = CITY_COORDS[city];
  if (!coords) return null;
  const pos = toSVG(coords.lat, coords.lng);
  const radius = Math.max(8, Math.min(28, (count / maxCount) * 28));
  const color = isSuspicious ? 'var(--danger-2)' : 'var(--blue-2)';

  return (
    <g onClick={() => onClick(city)} style={{ cursor: 'pointer' }}>
      {isSuspicious && (
        <circle cx={pos.x} cy={pos.y} r={radius + 8} fill="rgba(200,40,40,0.15)">
          <animate attributeName="r" values={`${radius + 4};${radius + 14};${radius + 4}`} dur="2s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx={pos.x} cy={pos.y} r={radius} fill={color} stroke={color} strokeWidth="1.5" opacity="0.8" />
      <circle cx={pos.x} cy={pos.y} r={radius * 0.4} fill="#fff" opacity="0.9" />
      <text x={pos.x} y={pos.y + radius + 14} textAnchor="middle" fontSize="10" fill="var(--text-3)" fontWeight="600" fontFamily="Inter">{city}</text>
      <text x={pos.x} y={pos.y + 4} textAnchor="middle" fontSize="9" fill="#000" fontWeight="800">{count}</text>
    </g>
  );
}

export default function GeoMapPage() {
  const [selectedCity, setSelectedCity] = useState(null);
  const [cityData, setCityData] = useState({});
  const [suspiciousCities, setSuspiciousCities] = useState(new Set());
  const { liveTransactions } = useSocket();

  const { data: txData } = useQuery({
    queryKey: ['transactions-geo'],
    queryFn: () => txApi.getAll({ limit: 500 }),
    refetchInterval: 15000,
  });

  const { data: accountData } = useQuery({
    queryKey: ['accounts-geo'],
    queryFn: () => accountApi.getAll({ limit: 200 }),
  });

  useEffect(() => {
    const allTxs = [...liveTransactions, ...(txData?.transactions || [])];
    const counts = {};
    const suspicious = new Set();

    allTxs.forEach(tx => {
      const city = tx.geo_origin?.city;
      if (!city) return;
      counts[city] = (counts[city] || 0) + 1;
      if (tx.anomaly_flag) suspicious.add(city);
    });

    // Also from accounts
    (accountData?.accounts || []).forEach(acc => {
      const city = acc.geo_location?.city;
      if (!city) return;
      if (!counts[city]) counts[city] = 0;
      counts[city]++;
      if (acc.is_flagged) suspicious.add(city);
    });

    setCityData(counts);
    setSuspiciousCities(suspicious);
  }, [liveTransactions, txData, accountData]);

  const maxCount = Math.max(1, ...Object.values(cityData));
  const cityList = Object.entries(cityData).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{ padding: 24, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 20, flexShrink: 0 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-1)' }}>Geo Fraud Intelligence Map</h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
          Transaction hotspots across India • <span style={{ color: 'var(--danger-2)', fontWeight: 600 }}>{suspiciousCities.size} suspicious regions</span>
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, flex: 1, minHeight: 0 }}>

        {/* ── SVG India Map ── */}
        <div className="glass-card" style={{ padding: 20, overflow: 'hidden', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--blue-2)' }} />Clean Activity
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--danger-2)' }} />Suspicious Activity
            </div>
          </div>

          <svg viewBox="0 0 600 500" style={{ width: '100%', height: '100%' }}>
            {/* Background grid */}
            <rect width="600" height="500" fill="transparent" />

            {/* Grid lines */}
            {[...Array(6)].map((_, i) => (
              <line key={`h${i}`} x1="0" y1={i * 83} x2="600" y2={i * 83} stroke="var(--border)" strokeWidth="1" />
            ))}
            {[...Array(7)].map((_, i) => (
              <line key={`v${i}`} x1={i * 100} y1="0" x2={i * 100} y2="500" stroke="var(--border)" strokeWidth="1" />
            ))}

            {/* Connection lines between suspicious cities */}
            {[...suspiciousCities].slice(0, 3).map((city, i) => {
              const otherCities = [...suspiciousCities].filter(c => c !== city);
              if (i >= otherCities.length) return null;
              const from = CITY_COORDS[city];
              const to = CITY_COORDS[otherCities[i]];
              if (!from || !to) return null;
              const p1 = toSVG(from.lat, from.lng);
              const p2 = toSVG(to.lat, to.lng);
              return (
                <line key={`conn-${i}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                  stroke="var(--danger-2)" strokeWidth="1" strokeDasharray="4,4" opacity="0.5">
                  <animate attributeName="stroke-dashoffset" from="0" to="8" dur="1s" repeatCount="indefinite" />
                </line>
              );
            })}

            {/* City nodes */}
            {cityList.map(([city, count]) => (
              <GeoNode
                key={city}
                city={city}
                count={count}
                maxCount={maxCount}
                isSuspicious={suspiciousCities.has(city)}
                onClick={setSelectedCity}
              />
            ))}

            {/* Empty state */}
            {cityList.length === 0 && (
              <text x="300" y="250" textAnchor="middle" fill="var(--text-3)" fontSize="14" fontFamily="Inter">
                Waiting for transaction data...
              </text>
            )}
          </svg>
        </div>

        {/* ── Right panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>

          {/* Selected city detail */}
          {selectedCity && (
            <div className="glass-card card-gold-top" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <MapPin size={16} color="var(--gold)" />
                <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{selectedCity}</h3>
                {suspiciousCities.has(selectedCity) && (
                  <span className="badge badge-critical" style={{ fontSize: 9 }}>SUSPICIOUS</span>
                )}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                <div style={{ marginBottom: 6 }}>Transactions: <strong style={{ color: 'var(--text-1)' }}>{cityData[selectedCity] || 0}</strong></div>
                <div style={{ marginBottom: 6 }}>Activity Share: <strong style={{ color: 'var(--blue-2)' }}>{((cityData[selectedCity] || 0) / Math.max(1, Object.values(cityData).reduce((a, b) => a + b, 0)) * 100).toFixed(1)}%</strong></div>
                <div>Status: <strong style={{ color: suspiciousCities.has(selectedCity) ? 'var(--danger-2)' : 'var(--success-2)' }}>
                  {suspiciousCities.has(selectedCity) ? 'SUSPICIOUS' : 'NORMAL'}
                </strong></div>
              </div>
            </div>
          )}

          {/* City leaderboard */}
          <div className="glass-card" style={{ padding: 16, flex: 1 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', marginBottom: 14 }}>
              Transaction Hotspots
            </h3>
            {cityList.slice(0, 10).map(([city, count], i) => (
              <div
                key={city}
                onClick={() => setSelectedCity(city)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 0', borderBottom: '1px solid var(--border)',
                  cursor: 'pointer'
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--text-3)', width: 16 }}>#{i + 1}</span>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: suspiciousCities.has(city) ? 'var(--danger-2)' : 'var(--blue-2)',
                  boxShadow: `0 0 6px ${suspiciousCities.has(city) ? 'var(--danger-2)' : 'var(--blue-2)'}`
                }} />
                <span style={{ fontSize: 13, color: 'var(--text-1)', flex: 1 }}>{city}</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>{count}</span>
                  {suspiciousCities.has(city) && (
                    <AlertTriangle size={10} color="var(--danger-2)" />
                  )}
                </div>
              </div>
            ))}
            {cityList.length === 0 && (
              <p style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: 20 }}>
                Collecting geo data...
              </p>
            )}
          </div>

          {/* Stats */}
          <div className="glass-card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', marginBottom: 12 }}>
              Risk Summary
            </h3>
            {[
              { label: 'Cities Monitored', value: cityList.length, color: 'var(--blue-2)' },
              { label: 'Suspicious Regions', value: suspiciousCities.size, color: 'var(--danger-2)' },
              { label: 'Total Events', value: Object.values(cityData).reduce((a, b) => a + b, 0), color: 'var(--gold)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--text-2)' }}>{label}</span>
                <span style={{ color, fontWeight: 700 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
