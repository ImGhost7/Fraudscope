"""Train / evaluate Random Forest, GraphSAGE and a temporal GNN on a leakage-free temporal split."""
import json, time, sys
import numpy as np, pandas as pd, torch, torch.nn as nn, torch.nn.functional as F
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score, average_precision_score, confusion_matrix, roc_curve
from torch_geometric.nn import SAGEConv, MessagePassing
from gen_data import generate, WINDOWS, N_ACC
from features import node_features, edge_features

OUT = sys.argv[1] if len(sys.argv) > 1 else "results"
import os; os.makedirs(OUT, exist_ok=True)
torch.set_num_threads(4)
HID, LAYERS, DROPOUT, LR, WD, EPOCHS, PATIENCE = 64, 2, 0.3, 5e-3, 1e-4, 200, 30
SEEDS = [0, 1, 2]


class TemporalConv(MessagePassing):
    """Message = MLP([h_src, edge attrs, Time2Vec(recency)]); mean+max aggregation; node update MLP."""
    def __init__(self, i, o, ed, tdim=8):
        super().__init__(aggr=["mean", "max"])
        self.w = nn.Parameter(torch.randn(tdim) * 3); self.b = nn.Parameter(torch.zeros(tdim))
        self.msg = nn.Sequential(nn.Linear(i + ed + tdim, o), nn.ReLU())
        self.upd = nn.Linear(i + 2 * o, o)
    def forward(self, x, ei, ea):
        return F.relu(self.upd(torch.cat([x, self.propagate(ei, x=x, ea=ea)], 1)))
    def message(self, x_j, ea):
        t = torch.sin(ea[:, 1:2] * self.w + self.b)  # time encoding of edge recency
        return self.msg(torch.cat([x_j, ea, t], 1))


class SAGE(nn.Module):
    def __init__(self, d):
        super().__init__()
        self.c = nn.ModuleList([SAGEConv(d if i == 0 else HID, HID) for i in range(LAYERS)]); self.out = nn.Linear(HID, 1)
    def forward(self, x, ei, ea=None):
        for c in self.c: x = F.dropout(F.relu(c(x, ei)), DROPOUT, self.training)
        return self.out(x).squeeze(-1)


class TGNN(nn.Module):
    def __init__(self, d, ed):
        super().__init__()
        self.c = nn.ModuleList([TemporalConv(d if i == 0 else HID, HID, ed) for i in range(LAYERS)]); self.out = nn.Linear(HID, 1)
    def forward(self, x, ei, ea):
        for c in self.c: x = F.dropout(c(x, ei, ea), DROPOUT, self.training)
        return self.out(x).squeeze(-1)


def build(df, name, mu=None, sd=None):
    t0, t1 = WINDOWS[name]
    w = df[(df.ts >= t0) & (df.ts < t1)]
    w, ea = edge_features(w, t1, t0)
    X = node_features(w, t0, t1)
    y = np.zeros(N_ACC, dtype=np.float32)
    fr = w[w.fraud == 1]
    y[np.unique(np.concatenate([fr.sender.values, fr.receiver.values]))] = 1
    if mu is None: mu, sd = X.mean(0), X.std(0) + 1e-6
    X = (X - mu) / sd
    s, r = torch.tensor(w.sender.values), torch.tensor(w.receiver.values)
    # temporal graph: every transaction is an edge, both directions, direction flag appended to edge attrs
    e = torch.tensor(ea)
    fwd = torch.cat([e, torch.zeros(len(e), 1)], 1); bwd = torch.cat([e, torch.ones(len(e), 1)], 1)
    g = dict(x=torch.tensor(X), y=torch.tensor(y),
             ei_t=torch.stack([torch.cat([s, r]), torch.cat([r, s])]), ea_t=torch.cat([fwd, bwd]),
             ei_s=torch.unique(torch.stack([torch.cat([s, r]), torch.cat([r, s])]), dim=1),  # static, deduplicated, no time
             tab=X, n_tx=len(w), n_fraud_tx=int(w.fraud.sum()))
    return g, mu, sd


def metrics(y, p, thr):
    pr, rc, f1, _ = precision_recall_fscore_support(y, p >= thr, average="binary", zero_division=0)
    return dict(precision=pr, recall=rc, f1=f1, roc_auc=roc_auc_score(y, p), pr_auc=average_precision_score(y, p))


def best_thr(y, p):
    from sklearn.metrics import precision_recall_curve
    pr, rc, th = precision_recall_curve(y, p)
    f1 = 2 * pr[:-1] * rc[:-1] / (pr[:-1] + rc[:-1] + 1e-12)
    return float(th[np.argmax(f1)])


def fit(kind, G, seed):
    torch.manual_seed(seed); np.random.seed(seed)
    tr, va, te = G["train"], G["val"], G["test"]
    d = tr["x"].shape[1]; ed = tr["ea_t"].shape[1]
    m = SAGE(d) if kind == "GraphSAGE" else TGNN(d, ed)
    opt = torch.optim.Adam(m.parameters(), lr=LR, weight_decay=WD)
    pw = torch.tensor((tr["y"] == 0).sum() / (tr["y"] == 1).sum())
    def run(g, train):
        m.train(train)
        ei, ea = (g["ei_s"], None) if kind == "GraphSAGE" else (g["ei_t"], g["ea_t"])
        return m(g["x"], ei, ea)
    hist, best, bad, state = [], -1, 0, None
    t_start = time.time()
    for ep in range(EPOCHS):
        opt.zero_grad(); loss = F.binary_cross_entropy_with_logits(run(tr, True), tr["y"], pos_weight=pw); loss.backward(); opt.step()
        with torch.no_grad():
            lv = run(va, False); vl = F.binary_cross_entropy_with_logits(lv, va["y"], pos_weight=pw).item()
            ap = average_precision_score(va["y"].numpy(), torch.sigmoid(lv).numpy())
        hist.append((loss.item(), vl))
        if ap > best: best, bad, state, bep = ap, 0, {k: v.clone() for k, v in m.state_dict().items()}, ep + 1
        else:
            bad += 1
            if bad >= PATIENCE: break
    m.load_state_dict(state)
    with torch.no_grad():
        pv = torch.sigmoid(run(va, False)).numpy(); pt = torch.sigmoid(run(te, False)).numpy()
    thr = best_thr(va["y"].numpy(), pv)
    return dict(val_ap=best, metrics=metrics(te["y"].numpy(), pt, thr), thr=thr, hist=hist, epochs=len(hist), best_epoch=bep,
                secs=time.time() - t_start, p_test=pt, nparams=sum(p.numel() for p in m.parameters()))


if __name__ == "__main__":
    df = generate(); df.to_csv(f"{OUT}/transactions.csv", index=False)
    G = {}; mu = sd = None
    for n in ["train", "val", "test"]:
        G[n], mu, sd = build(df, n, mu, sd)
    summary = {n: dict(tx=G[n]["n_tx"], fraud_tx=G[n]["n_fraud_tx"], fraud_accounts=int(G[n]["y"].sum()), accounts=N_ACC) for n in G}
    print(json.dumps(summary, indent=1))
    res = {}
    # Random Forest (tabular node features only)
    rr = []
    for s in SEEDS:
        t = time.time()
        rf = RandomForestClassifier(300, class_weight="balanced_subsample", min_samples_leaf=2, random_state=s, n_jobs=4).fit(G["train"]["tab"], G["train"]["y"].numpy())
        thr = best_thr(G["val"]["y"].numpy(), rf.predict_proba(G["val"]["tab"])[:, 1])
        pt = rf.predict_proba(G["test"]["tab"])[:, 1]
        rr.append(dict(metrics=metrics(G["test"]["y"].numpy(), pt, thr), thr=thr, secs=time.time() - t, p_test=pt))
    res["Random Forest"] = rr
    # Isolation Forest (unsupervised, non-deep reference): fit on train nodes, threshold picked on validation
    from sklearn.ensemble import IsolationForest
    ifs = []
    for s_ in SEEDS:
        iso = IsolationForest(n_estimators=300, contamination="auto", random_state=s_).fit(G["train"]["tab"])
        lo, hi = (-iso.score_samples(G["val"]["tab"])).min(), (-iso.score_samples(G["val"]["tab"])).max()
        pv = (-iso.score_samples(G["val"]["tab"]) - lo) / (hi - lo); pt = (-iso.score_samples(G["test"]["tab"]) - lo) / (hi - lo)
        thr = best_thr(G["val"]["y"].numpy(), pv)
        ifs.append(dict(metrics=metrics(G["test"]["y"].numpy(), pt, thr), thr=thr, secs=0.0, p_test=pt))
    res["Isolation Forest"] = ifs
    import itertools
    tuned = {}
    for kind in ["GraphSAGE", "Temporal GNN"]:
        # small grid search, selected on validation PR-AUC only (test window never used for tuning)
        best = None
        for hid, dr, lr, wd in itertools.product([32, 64], [0.3, 0.5], [5e-3, 2e-3], [1e-4, 1e-3]):
            HID, DROPOUT, LR, WD = hid, dr, lr, wd
            va = np.mean([fit(kind, G, s)["val_ap"] for s in SEEDS[:2]])
            if best is None or va > best[0]: best = (va, hid, dr, lr, wd)
        _, HID, DROPOUT, LR, WD = best
        tuned[kind] = dict(hidden=HID, dropout=DROPOUT, lr=LR, weight_decay=WD, val_pr_auc=float(best[0]))
        print(kind, "tuned", tuned[kind])
        res[kind] = [fit(kind, G, s) for s in SEEDS]
        print(kind, [round(r["metrics"]["f1"], 3) for r in res[kind]], "epochs", [r["epochs"] for r in res[kind]])
    agg = {}
    for k, rs in res.items():
        agg[k] = {m: (float(np.mean([r["metrics"][m] for r in rs])), float(np.std([r["metrics"][m] for r in rs]))) for m in rs[0]["metrics"]}
        agg[k]["secs"] = float(np.mean([r["secs"] for r in rs]))
    extra = dict(summary=summary, agg=agg, hyper=dict(tuned=tuned, layers=LAYERS, max_epochs=EPOCHS, patience=PATIENCE, seeds=SEEDS, optimizer="Adam"),
                 epochs={k: [r["epochs"] for r in res[k]] for k in ["GraphSAGE", "Temporal GNN"]},
                 best_epoch={k: [r["best_epoch"] for r in res[k]] for k in ["GraphSAGE", "Temporal GNN"]},
                 params={k: res[k][0]["nparams"] for k in ["GraphSAGE", "Temporal GNN"]},
                 node_feat_dim=int(G["train"]["x"].shape[1]), edge_feat_dim=int(G["train"]["ea_t"].shape[1]))
    json.dump(extra, open(f"{OUT}/results.json", "w"), indent=1)
    import pickle; pickle.dump(dict(res=res, y_test=G["test"]["y"].numpy(), hist={k: [r["hist"] for r in res[k]] for k in ["GraphSAGE", "Temporal GNN"]}), open(f"{OUT}/raw.pkl", "wb"))
    print(json.dumps(agg, indent=1))
