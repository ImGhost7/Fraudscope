import json, textwrap, numpy as np, pandas as pd
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pygments import highlight
from pygments.lexers import PythonLexer
from pygments.formatters import ImageFormatter
from gen_data import WINDOWS
from explain import reasons
F = "results/figs"
tx = pd.read_csv("results/transactions.csv"); sc = pd.read_csv("results/test_scores.csv"); thr = json.load(open("results/threshold.json"))["threshold"]
R = json.load(open("results/results.json"))

# dataset sample rows + class counts
h = tx.head(0)
samp = pd.concat([tx[tx.fraud == 0].sample(5, random_state=1), tx[tx.fraud == 1].sample(5, random_state=1)]).sort_values("ts")
samp = samp.assign(sender=samp.sender.map(lambda x: f"ACC{x:06d}"), receiver=samp.receiver.map(lambda x: f"ACC{x:06d}"), amount=samp.amount.map(lambda x: f"{x:,.0f}"), ts=samp.ts.map(lambda x: f"day {int(x//86400)}, {int(x%86400//3600):02d}:{int(x%3600//60):02d}:{int(x%60):02d}"))
fig, a = plt.subplots(figsize=(9.2, 3.1)); a.axis("off")
t = a.table(cellText=samp[["ts", "sender", "receiver", "amount", "fraud", "window"]].values, colLabels=["timestamp", "sender", "receiver", "amount (INR)", "fraud", "split"], loc="center", cellLoc="center")
t.auto_set_font_size(False); t.set_fontsize(9.5); t.scale(1, 1.45)
for (i, j), c in t.get_celld().items():
    if i == 0: c.set_facecolor("#223"); c.set_text_props(color="w", weight="bold")
    elif i > 0 and samp.iloc[i - 1].fraud == 1: c.set_facecolor("#fde8e8")
plt.savefig(f"{F}/data_sample.png", dpi=170, bbox_inches="tight"); plt.close()

# split counts figure
S = R["summary"]
fig, a = plt.subplots(figsize=(4.2, 3.1)); a.axis("off")
rows = [[n.capitalize(), f"{S[n]['tx']:,}", f"{S[n]['fraud_tx']}", f"{S[n]['fraud_accounts']}"] for n in ["train", "val", "test"]]
t = a.table(cellText=rows, colLabels=["Split", "Transactions", "Fraud tx", "Fraud accts"], loc="center", cellLoc="center"); t.auto_set_font_size(False); t.set_fontsize(10); t.scale(1, 1.7)
for (i, j), c in t.get_celld().items():
    if i == 0: c.set_facecolor("#223"); c.set_text_props(color="w", weight="bold")
plt.savefig(f"{F}/split_table.png", dpi=170, bbox_inches="tight"); plt.close()

# code snippet image
src = open("train.py").read()
a0 = src.index("class TemporalConv"); a1 = src.index("class SAGE")
b0 = src.index("    for ep in range(EPOCHS):"); b1 = src.index("    m.load_state_dict(state)")
snip = src[a0:a1].rstrip() + "\n\n# ... training loop (full batch, early stopping on validation PR-AUC)\n" + src[b0:b1].rstrip() + "\n"
open(f"{F}/code_snippet.png", "wb").write(highlight(snip, PythonLexer(), ImageFormatter(font_size=17, line_numbers=False, style="friendly", image_pad=14, font_name="DejaVu Sans Mono")))

# correct / incorrect examples (test window, Temporal GNN)
t0, t1 = WINDOWS["test"]; w = tx[(tx.ts >= t0) & (tx.ts < t1)].sort_values("ts")
sc["pred"] = (sc.score >= thr).astype(int)
def pick(mask, n, asc=False):
    return sc[mask].sort_values("score", ascending=asc).head(n)
tp = sc[(sc.label == 1) & (sc.pred == 1)].sort_values("score", ascending=False)
good = []
for _, r in tp.iterrows():
    kind = reasons(int(r.account), w)[0].split(":")[0]
    if not kind.startswith("No single") and kind not in [reasons(int(g.account), w)[0].split(":")[0] for g in good]: good.append(r)
    if len(good) == 3: break
ex = [("Correct: fraud caught", pd.DataFrame(good)), ("Correct: normal", pick((sc.label == 0) & (sc.pred == 0) & (sc.account < 4300), 1, True)),
      ("Wrong: false alarm", pick((sc.label == 0) & (sc.pred == 1), 1)), ("Wrong: fraud missed", pick((sc.label == 1) & (sc.pred == 0), 1))]
rows = []
for name, d in ex:
    for _, r in d.iterrows():
        txt = reasons(int(r.account), w)[0] if name != "Correct: normal" else "Ordinary payments, no burst or fast pass-through"
        rows.append([name, f"ACC{int(r.account):06d}", "Fraud" if r.label else "Normal", "Fraud" if r.pred else "Normal", f"{r.score:.6f}", "\n".join(textwrap.wrap(txt, 33))])
fig, a = plt.subplots(figsize=(8.4, 4.2)); a.axis("off")
t = a.table(cellText=rows, colLabels=["Outcome", "Account", "Actual", "Pred.", "Score", "Evidence"], loc="center", cellLoc="left", colWidths=[.22, .13, .08, .09, .12, .36])
t.auto_set_font_size(False); t.set_fontsize(7.5); t.scale(1, 2.7)
for (i, j), c in t.get_celld().items():
    if i == 0: c.set_facecolor("#223"); c.set_text_props(color="w", weight="bold")
    elif rows[i - 1][0].startswith("Wrong"): c.set_facecolor("#fde8e8")
    else: c.set_facecolor("#e8f5e9")
plt.savefig(f"{F}/examples.png", dpi=170, bbox_inches="tight"); plt.close()
print(rows)
