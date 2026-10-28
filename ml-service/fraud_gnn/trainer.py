"""Training loop and snapshot inference helpers."""
from __future__ import annotations

import copy
import random
import time
from typing import Dict, List

import numpy as np
import torch
import torch.nn.functional as F
from sklearn.metrics import average_precision_score

from .dataset import Snapshot
from .features import N_EDGE, N_NODE, to_model_inputs
from .model import GraphSAGEClassifier
from .preprocess import NodeScaler

DEFAULT_HP = dict(hidden=64, layers=2, dropout=0.3, lr=3e-3, weight_decay=1e-4, epochs=60, patience=10, max_pos_weight=20.0)


def set_seed(seed: int):
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)


def tensors(s: Snapshot, scaler: NodeScaler):
    x, ei, ea = to_model_inputs(s.graph, scaler.transform(s.graph.x_raw))
    return torch.from_numpy(x), torch.from_numpy(ei), torch.from_numpy(ea), torch.from_numpy(s.y)


@torch.no_grad()
def predict_snapshots(model, scaler, snaps: List[Snapshot]) -> List[np.ndarray]:
    model.eval()
    out = []
    for s in snaps:
        x, ei, ea, _ = tensors(s, scaler)
        out.append(torch.sigmoid(model(x, ei, ea)).numpy())
    return out


def train(snaps_train: List[Snapshot], snaps_val: List[Snapshot], scaler: NodeScaler, hp: Dict, seed: int, verbose=False):
    set_seed(seed)
    hp = {**DEFAULT_HP, **hp}
    model = GraphSAGEClassifier(N_NODE, N_EDGE + 1, hp["hidden"], hp["layers"], hp["dropout"])
    opt = torch.optim.Adam(model.parameters(), lr=hp["lr"], weight_decay=hp["weight_decay"])
    tr = [tensors(s, scaler) for s in snaps_train]
    pos = sum(float(t[3].sum()) for t in tr); neg = sum(float((1 - t[3]).sum()) for t in tr)
    pw = torch.tensor(min(neg / max(pos, 1.0), hp["max_pos_weight"]))
    best, best_state, bad, hist, best_ep = -1.0, None, 0, [], 0
    t0 = time.time()
    for ep in range(hp["epochs"]):
        model.train(); random.shuffle(tr); tl = 0.0
        for x, ei, ea, y in tr:
            opt.zero_grad()
            loss = F.binary_cross_entropy_with_logits(model(x, ei, ea), y, pos_weight=pw)
            loss.backward(); opt.step(); tl += loss.item()
        pv = predict_snapshots(model, scaler, snaps_val)
        yv = np.concatenate([s.y for s in snaps_val]); sv = np.concatenate(pv)
        ap = average_precision_score(yv, sv)
        hist.append(dict(epoch=ep + 1, train_loss=tl / len(tr), val_pr_auc=float(ap)))
        if verbose: print(f"  ep{ep+1:3d} loss {tl/len(tr):.4f} val PR-AUC {ap:.4f}")
        if ap > best:
            best, best_state, bad, best_ep = ap, copy.deepcopy(model.state_dict()), 0, ep + 1
        else:
            bad += 1
            if bad >= hp["patience"]: break
    model.load_state_dict(best_state)
    return model, dict(history=hist, best_epoch=best_ep, best_val_pr_auc=float(best), seconds=time.time() - t0, hp=hp,
                       pos_weight=float(pw), train_pos_nodes=int(pos), train_neg_nodes=int(neg))
