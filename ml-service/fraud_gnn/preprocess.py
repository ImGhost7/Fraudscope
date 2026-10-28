"""Feature scaling fitted on TRAINING snapshots only; persisted as JSON and reused at inference."""
from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np

from .features import NODE_FEATURES


@dataclass
class NodeScaler:
    mean: np.ndarray
    std: np.ndarray
    clip: float = 6.0

    @classmethod
    def fit(cls, x_list):
        x = np.vstack([np.nan_to_num(v, nan=0.0, posinf=0.0, neginf=0.0) for v in x_list])
        return cls(x.mean(0), np.maximum(x.std(0), 1e-6))

    def transform(self, x: np.ndarray) -> np.ndarray:
        x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)
        return np.clip((x - self.mean) / self.std, -self.clip, self.clip).astype(np.float32)

    def to_dict(self):
        return {"features": NODE_FEATURES, "mean": self.mean.tolist(), "std": self.std.tolist(), "clip": self.clip}

    @classmethod
    def from_dict(cls, d):
        if d["features"] != NODE_FEATURES:
            raise ValueError("feature schema mismatch between scaler and code")
        return cls(np.array(d["mean"]), np.array(d["std"]), d.get("clip", 6.0))
