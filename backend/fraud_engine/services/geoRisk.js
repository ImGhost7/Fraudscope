/**
 * GeoRisk Service
 *
 * Evaluates transactions for geographic anomalies:
 *   - Funds moving to high-risk or sanctioned jurisdictions
 *   - New country / city never used before by this account
 *   - Impossible travel (same account, 2 cities that are far apart, short time gap)
 *
 * In the current in-memory mode, geo is stored as { city, state, lat, lng } on
 * each transaction. We use that for impossible travel detection.
 */

const { MODIFIERS, BEHAVIOUR } = require('../config/riskWeights');

// ── Known sanctioned / high-risk countries (simplified FATF grey/blacklist) ──
const SANCTIONED_COUNTRIES = new Set([
  'North Korea', 'Iran', 'Syria', 'Myanmar', 'Cuba',
]);

const HIGH_RISK_COUNTRIES = new Set([
  'Pakistan', 'Afghanistan', 'Yemen', 'Libya', 'Somalia',
  'South Sudan', 'Sudan', 'Haiti', 'Panama', 'Cayman Islands',
  'British Virgin Islands', 'Vanuatu',
]);

// Low-risk / trusted international jurisdictions — common for NRI remittances,
// IT corridor, and legitimate business payments. Flag lightly, not heavily.
const TRUSTED_COUNTRIES = new Set([
  'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany',
  'France', 'Netherlands', 'Singapore', 'Japan', 'UAE',
  'New Zealand', 'Switzerland', 'Sweden', 'Norway', 'Denmark',
]);

/** Haversine distance in KM between two lat/lng points */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * @param {Object} tx              - current transaction
 * @param {Object[]} recentFromSender - last few transactions from sender
 * @param {Set<string>} knownCities   - cities from historical baseline
 * @returns {{ riskContribution: number, flags: string[], reasons: string[] }}
 */
function evaluateGeoRisk(tx, recentFromSender, knownCities) {
  const flags = [];
  const reasons = [];
  let contribution = 0;

  const origin = tx.geo_origin || {};
  const country = origin.country || 'India';
  const city = origin.city || 'Unknown';

  // ── Sanctioned Country ───────────────────────────────────────────────────────
  if (SANCTIONED_COUNTRIES.has(country)) {
    contribution += MODIFIERS.SANCTIONED_COUNTRY;
    flags.push('SANCTIONED_COUNTRY');
    reasons.push(`Transaction originating from sanctioned country: ${country}`);
  }

  // ── High-Risk Country ────────────────────────────────────────────────────────
  if (!SANCTIONED_COUNTRIES.has(country) && HIGH_RISK_COUNTRIES.has(country)) {
    contribution += MODIFIERS.HIGH_RISK_COUNTRY;
    flags.push('HIGH_RISK_COUNTRY');
    reasons.push(`Transaction from FATF high-risk jurisdiction: ${country}`);
  }

  // ── Non-India transaction ────────────────────────────────────────────────────
  if (country !== 'India' && !SANCTIONED_COUNTRIES.has(country) && !HIGH_RISK_COUNTRIES.has(country)) {
    if (TRUSTED_COUNTRIES.has(country)) {
      // Trusted jurisdiction — low flag, not a strong signal
      contribution += 4;
      flags.push('INTERNATIONAL_TRUSTED_COUNTRY');
      reasons.push(`International transaction to trusted jurisdiction: ${country}. Mild geo flag.`);
    } else {
      // Unknown / unlisted jurisdiction — treat as suspicious
      contribution += MODIFIERS.NEW_COUNTRY;
      flags.push('NEW_COUNTRY');
      reasons.push(`International transaction to unlisted/unusual jurisdiction: ${country}.`);
    }
  }

  // Only flag city-as-new when there's enough geo history to draw conclusions.
  // Require at least 3 known cities before flagging a new one — otherwise
  // nearly every early transaction fires this in the simulator.
  if (knownCities && knownCities.size >= 3 && !knownCities.has(city) && country === 'India') {
    contribution += MODIFIERS.NEW_CITY_FIRST_TIME;
    flags.push('NEW_CITY_FIRST_TIME');
    reasons.push(`First transaction ever from city: ${city}`);
  }


  // ── Impossible Travel ────────────────────────────────────────────────────────
  if (origin.lat && origin.lng && recentFromSender.length > 0) {
    const prev = recentFromSender[0]; // most recent prior tx
    const prevGeo = prev.geo_origin || {};
    if (prevGeo.lat && prevGeo.lng) {
      const distKm = haversineKm(prevGeo.lat, prevGeo.lng, origin.lat, origin.lng);
      const timeDiffMin = (new Date(tx.timestamp) - new Date(prev.timestamp)) / 60000;
      if (
        distKm >= BEHAVIOUR.GEO_IMPOSSIBLE_TRAVEL_KM &&
        timeDiffMin <= BEHAVIOUR.GEO_IMPOSSIBLE_TRAVEL_MIN
      ) {
        contribution += MODIFIERS.IMPOSSIBLE_TRAVEL;
        flags.push('IMPOSSIBLE_TRAVEL');
        reasons.push(
          `Impossible travel: ${Math.round(distKm)}km in ${Math.round(timeDiffMin)} min ` +
          `(${prevGeo.city || '?'} → ${city})`
        );
      }
    }
  }

  return { riskContribution: contribution, flags, reasons };
}

module.exports = { evaluateGeoRisk };
