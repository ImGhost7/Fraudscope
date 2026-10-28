#!/usr/bin/env node
/** Batch wrapper over services/riskFusion.js so offline evaluation uses the exact production code.
 *  usage: node scripts/fuse_scores.js in.json out.json   (in = [{rules, isolation_forest, gnn}, ...]) */
const fs = require('fs');
const path = require('path');
const { fuse, loadConfig } = require(path.join(__dirname, '..', 'services', 'riskFusion'));
const [, , inFile, outFile] = process.argv;
const rows = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const cfg = loadConfig();
fs.writeFileSync(outFile, JSON.stringify(rows.map((r) => fuse(r, cfg).score)));
