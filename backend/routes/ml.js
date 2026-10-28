/**
 * ML status + GNN result endpoints (read-only; training is a CLI operation, never an HTTP one).
 *   GET  /api/ml/status               service/GNN/IF/fusion status for the dashboard
 *   GET  /api/ml/gnn/accounts         latest GNN account risks (sorted)   ?limit=&min_score=
 *   GET  /api/ml/gnn/accounts/:id     GNN result + neighbourhood facts for one account
 *   POST /api/ml/gnn/refresh          run an analysis cycle now
 */
module.exports = function mountMlRoutes(app, pipeline, db) {
  app.get('/api/ml/status', async (req, res) => {
    if (req.query.refresh === 'true') await pipeline.refreshHealth().catch(() => {});
    res.json(pipeline.status());
  });

  app.get('/api/ml/gnn/accounts', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const minScore = Number(req.query.min_score) || 0;
    const accounts = pipeline.listAccounts({ limit, minScore }).map((a) => {
      const acc = db.accounts.find((x) => x.account_id === a.account_id);
      return { ...a, customer_name: acc?.customer_name, account_type: acc?.account_type, rule_risk_score: acc?.risk_score };
    });
    res.json({ accounts, total: accounts.length, summary: pipeline.summary() });
  });

  app.get('/api/ml/gnn/accounts/:id', (req, res) => {
    const r = pipeline.state.accounts.get(req.params.id);
    if (!r) return res.status(404).json({ error: 'No GNN result for this account (no recent activity or model unavailable)' });
    res.json(r);
  });

  app.post('/api/ml/gnn/refresh', async (req, res) => {
    await pipeline.flush();
    const data = await pipeline.predict(true);
    res.json({ refreshed: !!data, summary: pipeline.summary() });
  });
};
