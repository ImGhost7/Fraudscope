const test = require('node:test');
const assert = require('node:assert/strict');
const { fuse, loadConfig, levelFor } = require('../services/riskFusion');

const cfg = loadConfig({});

test('weighted mean over all detectors, bounded 0-100, deterministic', () => {
  const r = fuse({ rules: 40, isolation_forest: 20, gnn: 60 }, cfg);
  assert.equal(r.score, 42);                        // .5*40 + .2*20 + .3*60
  assert.deepEqual(r.used, ['rules', 'isolation_forest', 'gnn']);
  assert.deepEqual(fuse({ rules: 40, isolation_forest: 20, gnn: 60 }, cfg), r);
  assert.equal(fuse({ rules: 500, isolation_forest: 500, gnn: 500 }, cfg).score, 100);
  assert.equal(fuse({ rules: -9, gnn: -9 }, cfg).score, 0);
});

test('missing detectors are renormalised, not treated as zero', () => {
  const r = fuse({ rules: 40, isolation_forest: null, gnn: undefined }, cfg);
  assert.equal(r.score, 40);
  assert.deepEqual(r.missing, ['isolation_forest', 'gnn']);
  assert.equal(r.weights.rules, 1);
  assert.equal(fuse({}, cfg).score, 0);
  assert.equal(fuse({ rules: NaN, gnn: 'x' }, cfg).used.length, 0);
});

test('authoritative rule floor: weak GNN/IF evidence can never lower a HIGH rule verdict', () => {
  const r = fuse({ rules: 78, isolation_forest: 0, gnn: 0 }, cfg);
  assert.equal(r.score, 78); assert.equal(r.floor_applied, true); assert.equal(r.level, 'HIGH');
  const below = fuse({ rules: 50, isolation_forest: 0, gnn: 0 }, cfg);       // MEDIUM rule: below the floor, fusion may lower it
  assert.equal(below.floor_applied, false); assert.ok(below.score < 50);
});

test('GNN evidence can raise a low rule score (but is bounded by its weight)', () => {
  const r = fuse({ rules: 10, isolation_forest: 10, gnn: 100 }, cfg);
  assert.ok(r.score > 10 && r.score < 100);
});

test('levels match the existing rule-engine bands', () => {
  assert.deepEqual([0, 29, 30, 59, 60, 79, 80, 100].map(levelFor), ['LOW', 'LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'CRITICAL', 'CRITICAL']);
});

test('weights are configurable and invalid config falls back to defaults', () => {
  const c = loadConfig({ FUSION_WEIGHTS: '{"rules":1,"gnn":0,"isolation_forest":0}', FUSION_RULE_FLOOR: '90' });
  assert.equal(fuse({ rules: 20, gnn: 100 }, c).score, 20); assert.equal(c.rule_floor, 90);
  assert.deepEqual(loadConfig({ FUSION_WEIGHTS: '{bad json' }).weights, cfg.weights);
});
