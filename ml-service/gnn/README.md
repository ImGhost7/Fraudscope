# Fraudscope temporal GNN experiments

```bash
pip install -r requirements.txt
python gen_data.py          # synthetic transactions (about 97.8k, 1% fraud)
python train.py results     # Isolation Forest, Random Forest, GraphSAGE, Temporal GNN (3 seeds)
python report.py            # figures + per-account scores
streamlit run dashboard.py  # risk score, reasons, suspicious subgraph
```

Leakage-free temporal split: days 1-18 train, 19-24 validation, 25-30 test. Every window is its own graph,
so no feature or edge from the future reaches training. Data is synthetic, so absolute scores are optimistic.
