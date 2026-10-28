"""Synthetic transaction generator for Fraudscope temporal graph experiments.

Fraud patterns mirror the rule engine / simulator in backend/ (layering,
structuring, fan-out, mule, dormant activation) and are injected into a
background of normal traffic that includes hard decoys (merchants, payroll
bursts, one-off near-threshold payments, slow multi-hop transfers).
"""
import numpy as np
import pandas as pd

DAY = 86400
N_DAYS = 30
N_ACC = 5000
THRESH = 50_000
# account id ranges (type is never used as a model feature)
NORMAL = np.arange(0, 4300)
MERCH = np.arange(4300, 4400)
PAYROLL = np.arange(4400, 4450)
FRAUD_POOL = np.arange(4450, N_ACC)  # shell / mule / dormant style accounts

WINDOWS = {"train": (0, 18 * DAY), "val": (18 * DAY, 24 * DAY), "test": (24 * DAY, 30 * DAY)}


def _tod(rng, n, day0, day1):
    """Timestamps weighted to daytime."""
    days = rng.integers(day0, day1, n)
    hours = np.clip(rng.normal(14, 4.5, n), 0, 23.99)
    return days * DAY + hours * 3600 + rng.uniform(0, 60, n)


def generate(seed=7, n_normal=99_000):
    rng = np.random.default_rng(seed)
    rows = []  # (ts, sender, receiver, amount, fraud)

    # --- normal traffic: each customer has a few favourite counterparties
    fav = {a: rng.choice(NORMAL, 5, replace=False) for a in NORMAL}
    n_bg = int(n_normal * 0.90)
    s = rng.choice(NORMAL, n_bg)
    r = np.array([fav[a][rng.integers(0, 5)] if rng.random() < 0.7 else rng.choice(NORMAL) for a in s])
    r = np.where(r == s, (r + 1) % len(NORMAL), r)
    amt = np.clip(rng.lognormal(7.6, 1.1, n_bg), 50, 45_000)
    ts = _tod(rng, n_bg, 0, N_DAYS)
    rows += list(zip(ts, s, r, amt, np.zeros(n_bg)))

    # decoys: merchants receive many small payments
    n_m = int(n_normal * 0.06)
    s = rng.choice(NORMAL, n_m); r = rng.choice(MERCH, n_m)
    rows += list(zip(_tod(rng, n_m, 0, N_DAYS), s, r, np.clip(rng.lognormal(6.2, 0.8, n_m), 20, 8000), np.zeros(n_m)))
    # decoys: payroll accounts pay 20-40 staff in a burst once per window
    for lo, hi in [(0, 18), (18, 24), (24, 30)]:
        for p in rng.choice(PAYROLL, 12, replace=False):
            staff = rng.choice(NORMAL, rng.integers(20, 40), replace=False)
            t0 = rng.integers(lo, hi) * DAY + 10 * 3600
            for k, a in enumerate(staff):
                rows.append((t0 + k * rng.uniform(1, 20), p, a, rng.uniform(20_000, 60_000), 0.0))
    # decoys: normal customers paying rent / big purchases just under the threshold (single event)
    n_t = int(n_normal * 0.004)
    s = rng.choice(NORMAL, n_t); r = rng.choice(NORMAL, n_t)
    rows += list(zip(_tod(rng, n_t, 0, N_DAYS), s, np.where(r == s, (r + 1) % 4300, r), rng.uniform(45_000, 49_900, n_t), np.zeros(n_t)))
    # decoys: slow legitimate multi-hop transfers (A pays B, B pays C hours later)
    for _ in range(int(n_normal * 0.002)):
        a, b, c = rng.choice(NORMAL, 3, replace=False)
        t0 = _tod(rng, 1, 0, N_DAYS)[0]; amt0 = rng.uniform(2_000, 30_000)
        rows.append((t0, a, b, amt0, 0.0)); rows.append((t0 + rng.uniform(3600, 40_000), b, c, amt0 * rng.uniform(0.3, 0.8), 0.0))

    # --- fraud (about 1,000 transactions, spread over the three windows)
    def pick(k, pool=FRAUD_POOL):
        return rng.choice(pool, k, replace=False)

    for (lo, hi), n_each in [((0, 18), 21), ((18, 24), 7), ((24, 30), 7)]:
        d0, d1 = lo, hi
        for _ in range(n_each):  # layering chains
            L = rng.integers(4, 7)
            chain = np.concatenate([rng.choice(NORMAL, 1), pick(L - 1)]) if rng.random() < 0.5 else pick(L)
            t = _tod(rng, 1, d0, d1)[0]; amt0 = rng.uniform(150_000, 800_000)
            slow = rng.random() < 0.25
            for i in range(L - 1):
                amt0 *= rng.uniform(0.85, 0.97)
                t += rng.uniform(600, 3600) if slow else rng.uniform(5, 150)
                rows.append((t, chain[i], chain[i + 1], amt0, 1.0))
        for _ in range(n_each):  # structuring
            a = pick(1)[0]; k = rng.integers(3, 7); t = _tod(rng, 1, d0, d1)[0]
            recv = rng.choice(NORMAL, 2, replace=False)
            for j in range(k):
                rows.append((t + j * rng.uniform(300, 7200), a, recv[rng.integers(0, 2)], rng.uniform(45_000, 49_900), 1.0))
        for _ in range(n_each):  # fan-out
            a = pick(1)[0]; k = rng.integers(6, 13); t = _tod(rng, 1, d0, d1)[0]
            base = rng.uniform(20_000, 150_000)
            for j, rcv in enumerate(pick(k)):
                rows.append((t + j * rng.uniform(5, 150), a, rcv, base * rng.uniform(0.9, 1.1), 1.0))
        for _ in range(n_each):  # mule collect-and-forward
            m, out = pick(2); k = rng.integers(5, 11); t = _tod(rng, 1, d0, d1)[0]
            tot = 0
            for j in range(k):
                v = rng.uniform(8_000, 40_000); tot += v
                rows.append((t + j * rng.uniform(60, 900), rng.choice(NORMAL), m, v, 1.0))
            rows.append((t + k * 900 + rng.uniform(60, 1800), m, out, tot * rng.uniform(0.93, 0.99), 1.0))
        for _ in range(n_each):  # dormant activation
            a, out = pick(2); t = _tod(rng, 1, max(d0, 1), d1)[0]
            v = rng.uniform(200_000, 600_000)
            rows.append((t, rng.choice(NORMAL), a, v, 1.0))
            rows.append((t + rng.uniform(30, 900), a, out, v * rng.uniform(0.9, 0.99), 1.0))

    df = pd.DataFrame(rows, columns=["ts", "sender", "receiver", "amount", "fraud"])
    df[["sender", "receiver"]] = df[["sender", "receiver"]].astype(int)
    df = df[df.ts < N_DAYS * DAY].sort_values("ts").reset_index(drop=True)
    df["fraud"] = df.fraud.astype(int)
    df["window"] = np.select([df.ts < WINDOWS["train"][1], df.ts < WINDOWS["val"][1]], ["train", "val"], "test")
    return df


if __name__ == "__main__":
    d = generate()
    print(d.groupby("window").fraud.agg(["size", "sum"]))
    print(len(d), d.fraud.sum())
