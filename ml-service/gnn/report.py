"""Figures + per-account test scores from results/raw.pkl."""
import pickle, json, os, numpy as np, pandas as pd
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.metrics import roc_curve, roc_auc_score, confusion_matrix
OUT = "results"; FIG = f"{OUT}/figs"; os.makedirs(FIG, exist_ok=True)
raw = pickle.load(open(f"{OUT}/raw.pkl", "rb")); res, y = raw["res"], raw["y_test"]
R = json.load(open(f"{OUT}/results.json"))
C = {"Random Forest": "#7f7f7f", "GraphSAGE": "#1f77b4", "Temporal GNN": "#d62728"}
plt.rcParams.update({"font.size": 11, "axes.spines.top": False, "axes.spines.right": False})

# loss curves
fig, ax = plt.subplots(1, 2, figsize=(9, 3.6), sharey=False)
for a, k in zip(ax, ["GraphSAGE", "Temporal GNN"]):
    h = np.array(raw["hist"][k][0]); a.plot(h[:, 0], label="train loss", color=C[k]); a.plot(h[:, 1], "--", label="validation loss", color="k")
    a.axvline(res[k][0]["best_epoch"] - 1, color="gray", ls=":", lw=1); a.set_title(f"{k} (seed 0)"); a.set_xlabel("epoch"); a.set_ylabel("BCE loss"); a.legend()
plt.tight_layout(); plt.savefig(f"{FIG}/loss_curves.png", dpi=170); plt.close()

# ROC (seed 0)
fig, a = plt.subplots(figsize=(4.6, 4.2))
for k in C:
    p = res[k][0]["p_test"]; f, t, _ = roc_curve(y, p); a.plot(f, t, color=C[k], label=f"{k} (AUC {roc_auc_score(y, p):.3f})")
a.plot([0, 1], [0, 1], "k:", lw=1); a.set_xlabel("False positive rate"); a.set_ylabel("True positive rate"); a.set_title("ROC curve, future test window"); a.legend(loc="lower right", fontsize=9)
plt.tight_layout(); plt.savefig(f"{FIG}/roc.png", dpi=170); plt.close()

# confusion matrices
fig, ax = plt.subplots(1, 3, figsize=(10, 3.4))
for a, k in zip(ax, C):
    r = res[k][0]; cm = confusion_matrix(y, r["p_test"] >= r["thr"])
    a.imshow(cm, cmap="Blues"); a.set_title(k, fontsize=11)
    for i in range(2):
        for j in range(2): a.text(j, i, f"{cm[i, j]}", ha="center", va="center", color="white" if cm[i, j] > cm.max() / 2 else "black", fontsize=13)
    a.set_xticks([0, 1], ["Normal", "Fraud"]); a.set_yticks([0, 1], ["Normal", "Fraud"]); a.set_xlabel("Predicted"); a.set_ylabel("Actual")
plt.tight_layout(); plt.savefig(f"{FIG}/confusion.png", dpi=170); plt.close()

# results table image
rows = [[k] + [f"{R['agg'][k][m][0]:.3f} ± {R['agg'][k][m][1]:.3f}" for m in ["precision", "recall", "f1", "roc_auc"]] for k in ["Isolation Forest", "Random Forest", "GraphSAGE", "Temporal GNN"]]
fig, a = plt.subplots(figsize=(8.6, 2.3)); a.axis("off")
t = a.table(cellText=rows, colLabels=["Model", "Precision", "Recall", "F1", "ROC-AUC"], loc="center", cellLoc="center")
t.auto_set_font_size(False); t.set_fontsize(11); t.scale(1, 1.8)
for (i, j), c in t.get_celld().items():
    if i == 0: c.set_facecolor("#223"); c.set_text_props(color="w", weight="bold")
    elif i == 4: c.set_facecolor("#fde8e8")
plt.savefig(f"{FIG}/results_table.png", dpi=170, bbox_inches="tight"); plt.close()

# per-account test scores (mean of 3 seeds) for the dashboard
sc = np.mean([r["p_test"] for r in res["Temporal GNN"]], 0); thr = float(np.mean([r["thr"] for r in res["Temporal GNN"]]))
pd.DataFrame({"account": np.arange(len(sc)), "score": sc, "label": y.astype(int)}).to_csv(f"{OUT}/test_scores.csv", index=False)
json.dump({"threshold": thr}, open(f"{OUT}/threshold.json", "w"))
print("ok", thr)
