"""Measure end-to-end /gnn/predict latency (graph build + features + GraphSAGE forward + evidence) for several window sizes.
   python -m fraud_gnn.bench [--artifacts DIR] [--repeats 5]
Reports hardware, graph sizes and median/p95 wall time in ms; nothing is estimated."""
from __future__ import annotations

import argparse
import os
import platform
import time

import numpy as np

from .config import ARTIFACT_DIR
from .inference import GNNService, GraphStore


def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument("--artifacts", default=str(ARTIFACT_DIR)); ap.add_argument("--repeats", type=int, default=5)
    a = ap.parse_args(argv)
    svc = GNNService(a.artifacts)
    if not svc.ready:
        raise SystemExit(f"model not ready: {svc.error}")
    import torch
    print(f"CPU: {platform.processor() or platform.machine()}, cores: {os.cpu_count()}, torch {torch.__version__} (threads {torch.get_num_threads()}), python {platform.python_version()}")
    rng = np.random.default_rng(0)
    print(f"{'transactions':>13}{'accounts':>10}{'explain':>9}{'flagged':>9}{'median ms':>11}{'p95 ms':>9}")
    for n_tx, n_acc in [(1_000, 400), (5_000, 1_500), (20_000, 3_000), (50_000, 6_000)]:
        st = GraphStore(svc.loaded.window_hours * 3600.0)
        s = rng.integers(0, n_acc, n_tx); r = (s + 1 + rng.integers(0, n_acc - 1, n_tx)) % n_acc
        st.ingest([dict(tx_id=f"b{i}", sender=f"A{s[i]}", receiver=f"A{r[i]}", amount=float(rng.lognormal(7.6, 1.1)), ts=1.8e9 - float(rng.uniform(0, 80_000)), channel="MOBILE") for i in range(n_tx)])
        svc.predict(store=st, explain=True)            # warm-up (imports, allocator)
        for explain in (False, True):
            times = []
            for _ in range(a.repeats):
                t = time.perf_counter(); res = svc.predict(store=st, explain=explain); times.append((time.perf_counter() - t) * 1000)
            nfl = sum(r["flagged"] for r in res["results"])
            print(f"{n_tx:>13,}{n_acc:>10,}{str(explain):>9}{nfl:>9}{np.median(times):>11.0f}{np.percentile(times, 95):>9.0f}")


if __name__ == "__main__":
    main()
