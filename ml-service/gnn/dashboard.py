"""Fraudscope Streamlit dashboard: account risk score, reasons and suspicious subgraph.
Run:  python train.py results && python report.py && streamlit run dashboard.py"""
import json, numpy as np, pandas as pd, streamlit as st, networkx as nx
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from gen_data import WINDOWS

st.set_page_config(page_title="Fraudscope", layout="wide")
tx = pd.read_csv("results/transactions.csv"); sc = pd.read_csv("results/test_scores.csv")
thr = json.load(open("results/threshold.json"))["threshold"]
t0, t1 = WINDOWS["test"]; w = tx[(tx.ts >= t0) & (tx.ts < t1)].sort_values("ts")

from explain import reasons as _reasons
reasons = lambda a: _reasons(a, w)

st.title("Fraudscope: temporal graph fraud scoring")
top = sc.sort_values("score", ascending=False).head(15)
c1, c2, c3 = st.columns(3)
c1.metric("Accounts scored (test window)", f"{len(sc):,}"); c2.metric("Flagged by Temporal GNN", int((sc.score >= thr).sum())); c3.metric("Transactions in window", f"{len(w):,}")
left, right = st.columns([1, 1.3])
with left:
    st.subheader("Highest-risk accounts")
    st.dataframe(top.assign(account=top.account.map(lambda x: f"ACC{x:06d}"), score=top.score.map(lambda v: f"{v:.4f}")).rename(columns={"label": "actual fraud"}), hide_index=True, use_container_width=True)
    pick = st.selectbox("Investigate account", list(top.account), format_func=lambda x: f"ACC{x:06d}")
    s = float(sc.loc[sc.account == pick, "score"].iloc[0])
    st.metric("Fraud risk score (0 to 1)", f"{s:.4f}", "FLAGGED" if s >= thr else "clear", delta_color="inverse")
    st.markdown("**Reasons**")
    for r in reasons(pick):
        st.write("• " + r)
with right:
    st.subheader("Suspicious subgraph (2 hops, test window)")
    ego = nx.ego_graph(nx.from_pandas_edgelist(w, "sender", "receiver", create_using=nx.DiGraph).to_undirected(), pick, radius=2)
    ego = nx.Graph(ego); nodes = list(ego.nodes)
    if len(nodes) > 40: nodes = [pick] + sorted(ego.neighbors(pick), key=lambda n: -sc.score[n])[:25]; ego = ego.subgraph(nodes)
    sub = w[w.sender.isin(ego.nodes) & w.receiver.isin(ego.nodes)]
    G = nx.DiGraph(); G.add_edges_from(zip(sub.sender, sub.receiver))
    fig, ax = plt.subplots(figsize=(6.5, 4.6)); pos = nx.spring_layout(G, seed=3, k=0.9)
    cols = ["#d62728" if sc.score[n] >= thr else "#1f77b4" for n in G.nodes]
    nx.draw_networkx(G, pos, node_color=cols, node_size=[520 if n == pick else 260 for n in G.nodes], labels={n: f"{n}" for n in G.nodes}, font_size=6, font_color="white", edge_color="#999", arrows=True, ax=ax)
    ax.axis("off"); st.pyplot(fig)
    st.caption("Red = flagged by the model, blue = normal. Larger node = selected account.")
