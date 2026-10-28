/**
 * Risk fusion — combines independent detector outputs into ONE bounded, explainable score.
 *
 * Inputs (each 0-100 or null/undefined when that detector is unavailable):
 *   rules              existing rule-engine composite score (authoritative for high-confidence hits)
 *   isolation_forest   existing Isolation Forest "fraud_probability" (a heuristic anomaly score, NOT a calibrated probability)
 *   gnn                GraphSAGE account-risk score (sigmoid output scaled to 0-100; uncalibrated risk indicator)
 *
 * Policy (deterministic, documented in docs/GNN.md):
 *   1. weighted mean of the AVAILABLE detectors; weights are renormalised so a missing detector
 *      never silently lowers the score;
 *   2. authoritative-rule floor: a rule score >= rule_floor can never be reduced by weaker evidence;
 *   3. result clamped to [0, 100] and mapped to the engine's existing LOW/MEDIUM/HIGH/CRITICAL bands.
 * Weights are configuration, not fitted optima; override with FUSION_WEIGHTS='{"rules":0.5,...}'.
 */
const DEFAULTS = Object.freeze({
  weights: { rules: 0.5, isolation_forest: 0.2, gnn: 0.3 },
  rule_floor: 60,
});

const LEVELS = [
  { min: 80, label: 'CRITICAL' },
  { min: 60, label: 'HIGH' },
  { min: 30, label: 'MEDIUM' },
  { min: 0, label: 'LOW' },
];

function levelFor(score) {
  return LEVELS.find((l) => score >= l.min).label;
}

function loadConfig(env = process.env) {
  const cfg = { weights: { ...DEFAULTS.weights }, rule_floor: DEFAULTS.rule_floor };
  if (env.FUSION_WEIGHTS) {
    try {
      const w = JSON.parse(env.FUSION_WEIGHTS);
      for (const k of Object.keys(cfg.weights)) if (Number.isFinite(w[k]) && w[k] >= 0) cfg.weights[k] = w[k];
    } catch { /* keep defaults on malformed config */ }
  }
  if (Number.isFinite(Number(env.FUSION_RULE_FLOOR))) cfg.rule_floor = Number(env.FUSION_RULE_FLOOR);
  return cfg;
}

const valid = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v) => Math.max(0, Math.min(100, v));

function fuse(detectors = {}, config = loadConfig()) {
  const used = [], missing = [], contributions = {};
  let wsum = 0, acc = 0;
  for (const [name, w] of Object.entries(config.weights)) {
    const v = detectors[name];
    if (valid(v) && w > 0) { used.push(name); wsum += w; acc += w * clamp(v); }
    else missing.push(name);
  }
  let score = wsum > 0 ? acc / wsum : 0;
  for (const name of used) contributions[name] = Number(((config.weights[name] / wsum) * clamp(detectors[name])).toFixed(2));
  let floorApplied = false;
  if (valid(detectors.rules) && detectors.rules >= config.rule_floor && score < detectors.rules) {
    score = detectors.rules; floorApplied = true;
  }
  score = Math.round(clamp(score) * 10) / 10;
  return {
    score, level: levelFor(score), used, missing, contributions, floor_applied: floorApplied,
    weights: Object.fromEntries(used.map((n) => [n, Number((config.weights[n] / wsum).toFixed(3))])),
    scale: 'normalised risk indicator (0-100), not a calibrated fraud probability',
  };
}

module.exports = { fuse, loadConfig, levelFor, DEFAULTS, LEVELS };
