"""Edge-aware GraphSAGE.

Each layer follows the GraphSAGE recipe (aggregate neighbour messages, concatenate with the node's
own state, apply a learned update) but the neighbour message is MLP([h_neighbour, edge_attr]) so the
transaction attributes (amount, timing gaps, forwarded fraction, direction flag) take part in message
passing instead of being discarded.  Aggregation = mean ‖ max.
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import MessagePassing


class EdgeSAGELayer(MessagePassing):
    def __init__(self, in_dim: int, out_dim: int, edge_dim: int):
        super().__init__(aggr=["mean", "max"])
        self.msg = nn.Sequential(nn.Linear(in_dim + edge_dim, out_dim), nn.ReLU())
        self.upd = nn.Linear(in_dim + 2 * out_dim, out_dim)

    def forward(self, x, edge_index, edge_attr):
        agg = self.propagate(edge_index, x=x, edge_attr=edge_attr)
        return F.relu(self.upd(torch.cat([x, agg], dim=1)))

    def message(self, x_j, edge_attr):
        return self.msg(torch.cat([x_j, edge_attr], dim=1))


class GraphSAGEClassifier(nn.Module):
    """Node classifier: P(account is involved in a suspicious scenario in the current window)."""

    def __init__(self, in_dim: int, edge_dim: int, hidden: int = 64, layers: int = 2, dropout: float = 0.3):
        super().__init__()
        self.config = dict(in_dim=in_dim, edge_dim=edge_dim, hidden=hidden, layers=layers, dropout=dropout)
        self.layers = nn.ModuleList([EdgeSAGELayer(in_dim if i == 0 else hidden, hidden, edge_dim) for i in range(layers)])
        self.dropout = dropout
        self.out = nn.Linear(hidden, 1)

    def forward(self, x, edge_index, edge_attr):
        for layer in self.layers:
            x = F.dropout(layer(x, edge_index, edge_attr), self.dropout, self.training)
        return self.out(x).squeeze(-1)           # logits
