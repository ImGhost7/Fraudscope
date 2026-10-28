"""Reproducible synthetic AML transaction generator for GNN training and evaluation.

Design rules (see docs/GNN.md):
* Labels are produced by scenario generators only and are NEVER model inputs.
* Fraud actors are drawn from the whole account population (no fixed id range / id prefix /
  fraud-only categorical value); account ids are a random permutation.
* Account type (SHELL/MULE) is metadata for the rule-engine baseline only, never a GNN feature.
* Legitimate "look-alike" behaviour (payroll bursts, merchants, slow legit chains, traders,
  near-threshold one-offs, legit round trips, legit dormant reactivation) is generated so that
  no single behavioural feature separates the classes.
* Periods are contiguous in time; scenarios never start in the last hours of a period, so a
  scenario instance is never split across train/val/test.
* The test period uses shifted scenario parameters and one scenario family (round-trip) never
  seen in training, to measure generalisation honestly.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List

import numpy as np
import pandas as pd

DAY = 86_400.0
HOUR = 3_600.0


@dataclass
class SimConfig:
    seed: int = 7
    n_accounts: int = 3000
    train_days: int = 26
    val_days: int = 6
    test_days: int = 10
    normal_tx_per_day: int = 1100
    scenarios_per_day: Dict[str, float] = field(default_factory=lambda: {
        "layering": 1.2, "structuring": 1.2, "fan_out": 1.2, "mule": 1.0, "dormant": 0.9, "velocity": 1.0,
    })
    shifted_fraction_test: float = 0.5
    round_trip_per_day_test: float = 1.0
    guard_hours: float = 4.0          # no scenario starts in the last guard_hours of a period

    @property
    def days(self) -> int:
        return self.train_days + self.val_days + self.test_days

    def period_bounds(self) -> Dict[str, tuple]:
        a, b = self.train_days * DAY, (self.train_days + self.val_days) * DAY
        return {"train": (0.0, a), "val": (a, b), "test": (b, self.days * DAY)}


SCENARIOS = ["layering", "structuring", "fan_out", "mule", "dormant", "velocity"]


def _acc_ids(n: int, rng) -> np.ndarray:
    perm = rng.permutation(n) + 1
    return np.array([f"ACC{i:06d}" for i in perm])


def _hours_of_day(rng, n):
    return np.clip(rng.normal(14, 4.5, n), 0, 23.99)


class _Builder:
    def __init__(self):
        self.rows: List[tuple] = []
        self.sid = 0

    def add(self, ts, s, r, amt, channel, label=0, scen="normal", variant="none", s_actor=False, r_actor=False, sid=-1):
        self.rows.append((float(ts), s, r, float(amt), channel, int(label), scen, variant, bool(s_actor), bool(r_actor), int(sid)))

    def new_sid(self):
        self.sid += 1
        return self.sid


def generate(cfg: SimConfig | None = None):
    """Returns (transactions_df, accounts_df). Timestamps are seconds since simulation start."""
    cfg = cfg or SimConfig()
    rng = np.random.default_rng(cfg.seed)
    ids = _acc_ids(cfg.n_accounts, rng)
    n = cfg.n_accounts
    ch = np.array(["MOBILE", "NET_BANKING", "API"])

    # ── accounts (static attributes only; label-independent draws except the documented KYC prior)
    role = rng.choice(["person", "merchant", "payroll", "trader", "landlord"], n, p=[0.86, 0.06, 0.02, 0.03, 0.03])
    dormant0 = rng.random(n) < 0.08                      # inactive before the simulation starts
    accounts = pd.DataFrame({
        "account_id": ids,
        "role": role,
        "kyc_level": rng.choice(["LOW", "MEDIUM", "HIGH"], n, p=[0.30, 0.40, 0.30]),
        "opened_ts": -rng.uniform(30, 3000, n) * DAY,
        "initial_last_active": np.where(dormant0, -rng.uniform(100, 700, n) * DAY, -rng.uniform(0, 20, n) * DAY),
        "balance": np.exp(rng.normal(10.8, 1.0, n)),
        "status": np.where(dormant0, "DORMANT", "ACTIVE"),
        "account_type": rng.choice(["SAVINGS", "CURRENT", "SHELL", "MULE"], n, p=[0.88, 0.09, 0.015, 0.015]),
    })
    idx = {a: i for i, a in enumerate(ids)}
    b = _Builder()
    periods = cfg.period_bounds()
    total = cfg.days * DAY
    active_idx = np.where(~dormant0 & (role == "person"))[0]
    fav = {int(i): rng.choice(active_idx, 5, replace=False) for i in active_idx}
    merchants = np.where(role == "merchant")[0]
    payrolls = np.where(role == "payroll")[0]
    traders = np.where(role == "trader")[0]
    landlords = np.where(role == "landlord")[0]

    # ── normal background traffic
    n_bg = int(cfg.normal_tx_per_day * cfg.days * 0.88)
    s = rng.choice(active_idx, n_bg)
    r = np.array([fav[int(a)][rng.integers(0, 5)] if rng.random() < 0.7 else rng.choice(active_idx) for a in s])
    r = np.where(r == s, active_idx[(np.searchsorted(active_idx, r) + 1) % len(active_idx)], r)
    amt = np.clip(rng.lognormal(7.6, 1.1, n_bg), 50, 45_000)
    ts = rng.integers(0, cfg.days, n_bg) * DAY + _hours_of_day(rng, n_bg) * HOUR + rng.uniform(0, 60, n_bg)
    chn = rng.choice(ch, n_bg, p=[0.6, 0.3, 0.1])
    for k in range(n_bg):
        b.add(ts[k], ids[s[k]], ids[r[k]], amt[k], chn[k])
    # merchant payments
    n_m = int(cfg.normal_tx_per_day * cfg.days * 0.06)
    for k in range(n_m):
        b.add(rng.integers(0, cfg.days) * DAY + _hours_of_day(rng, 1)[0] * HOUR, ids[rng.choice(active_idx)], ids[rng.choice(merchants)],
              np.clip(rng.lognormal(6.3, 0.8), 20, 8000), rng.choice(ch, p=[0.7, 0.2, 0.1]))
    # legit look-alikes
    for d in range(0, cfg.days, 7):                       # payroll bursts (fan-out look-alike)
        for p in rng.choice(payrolls, min(len(payrolls), 4), replace=False):
            staff = rng.choice(active_idx, rng.integers(18, 40), replace=False)
            t0 = (d + rng.integers(0, 7)) * DAY + 10 * HOUR
            for j, a in enumerate(staff):
                b.add(t0 + j * rng.uniform(1, 25), ids[p], ids[a], rng.uniform(18_000, 70_000), "NET_BANKING")
    for _ in range(int(cfg.days * 25)):                    # near-threshold one-offs (structuring look-alike)
        s_, r_ = rng.choice(active_idx, 2, replace=False)
        b.add(rng.integers(0, cfg.days) * DAY + _hours_of_day(rng, 1)[0] * HOUR, ids[s_], ids[r_], rng.uniform(45_000, 49_900), "NET_BANKING")
    for _ in range(int(cfg.days * 15)):                    # slow legit chains (layering look-alike)
        a, b_, c = rng.choice(active_idx, 3, replace=False)
        t0 = rng.integers(0, cfg.days) * DAY + _hours_of_day(rng, 1)[0] * HOUR; v = rng.uniform(2_000, 30_000)
        b.add(t0, ids[a], ids[b_], v, "MOBILE"); b.add(t0 + rng.uniform(3 * HOUR, 11 * HOUR), ids[b_], ids[c], v * rng.uniform(0.3, 0.8), "MOBILE")
    for _ in range(int(cfg.days * 12)):                    # legit rent round trip (cycle look-alike): deposit then refund
        a, l = rng.choice(active_idx), rng.choice(landlords)
        t0 = rng.integers(0, cfg.days - 1) * DAY + 11 * HOUR; v = rng.uniform(20_000, 60_000)
        b.add(t0, ids[a], ids[l], v, "NET_BANKING"); b.add(t0 + rng.uniform(1 * DAY, 3 * DAY), ids[l], ids[a], v, "NET_BANKING")
    for _ in range(int(cfg.days * 10)):                    # legit high-velocity traders (velocity look-alike)
        t = rng.choice(traders); t0 = rng.integers(0, cfg.days) * DAY + rng.uniform(9, 15) * HOUR
        for j in range(rng.integers(12, 28)):
            b.add(t0 + j * rng.uniform(20, 120), ids[t], ids[rng.choice(active_idx)], rng.uniform(300, 4000), "API")
    dorm_ids = np.where(dormant0)[0]
    for _ in range(int(cfg.days * 4)):                     # legit dormant reactivation (small salary-like, then spending)
        a = rng.choice(dorm_ids); t0 = rng.integers(2, cfg.days) * DAY + 10 * HOUR; v = rng.uniform(20_000, 70_000)
        b.add(t0, ids[rng.choice(payrolls)], ids[a], v, "NET_BANKING")
        for j in range(rng.integers(2, 5)):
            b.add(t0 + rng.uniform(0.5, 3) * DAY, ids[a], ids[rng.choice(merchants)], v * rng.uniform(0.05, 0.2), "MOBILE")

    # ── scenarios
    def actor_pool(k):
        # 40% of actors are compromised, previously active accounts; 60% are drawn from everyone else
        pick = []
        for _ in range(k):
            pick.append(int(rng.choice(active_idx)) if rng.random() < 0.4 else int(rng.integers(0, n)))
        while len(set(pick)) < k:
            pick = [int(rng.integers(0, n)) for _ in range(k)]
        return pick

    def start_time(lo, hi):
        return rng.uniform(lo, hi - cfg.guard_hours * HOUR)

    def variant_for(period):
        return "shifted" if period == "test" and rng.random() < cfg.shifted_fraction_test else "base"

    def run(kind, t0, variant):
        sid = b.new_sid(); sh = variant == "shifted"; chan = rng.choice(ch)
        if kind == "layering":
            L = int(rng.choice([3, 7, 8])) if sh else int(rng.integers(4, 7))
            acc = actor_pool(L); t = t0; v = rng.uniform(150_000, 800_000)
            slow = rng.random() < 0.3
            for i in range(L - 1):
                v *= rng.uniform(0.7, 0.85) if sh else rng.uniform(0.85, 0.97)
                t += rng.uniform(1 * HOUR, 3 * HOUR) if sh else (rng.uniform(600, 3600) if slow else rng.uniform(5, 150))
                b.add(t, ids[acc[i]], ids[acc[i + 1]], v, "API", 1, kind, variant, True, True, sid)
        elif kind == "structuring":
            a = actor_pool(1)[0]; k = int(rng.integers(6, 10)) if sh else int(rng.integers(3, 7))
            rcv = rng.choice(active_idx, 2, replace=False); t = t0
            for _ in range(k):
                t += rng.uniform(0.5, 1.5) * HOUR if sh else rng.uniform(300, 7200)
                v = rng.uniform(40_000, 47_000) if sh else rng.uniform(45_000, 49_900)
                b.add(t, ids[a], ids[rcv[rng.integers(0, 2)]], v, chan, 1, kind, variant, True, False, sid)
        elif kind == "fan_out":
            a = actor_pool(1)[0]; k = int(rng.choice([4, 5, 14, 18, 20])) if sh else int(rng.integers(6, 13))
            span = 2 * HOUR if sh else 22 * 60
            base = rng.uniform(20_000, 150_000)
            for j, rc in enumerate(actor_pool(k + 1)[1:]):
                b.add(t0 + j * span / k, ids[a], ids[rc], base * rng.uniform(0.9, 1.1), "NET_BANKING", 1, kind, variant, True, True, sid)
        elif kind == "mule":
            m, out = actor_pool(2); k = int(rng.integers(3, 5)) if sh else int(rng.integers(5, 11)); t = t0; tot = 0
            for _ in range(k):
                v = rng.uniform(8_000, 40_000); tot += v; t += rng.uniform(60, 900)
                b.add(t, ids[rng.choice(active_idx)], ids[m], v, chan, 1, kind, variant, False, True, sid)
            b.add(t + rng.uniform(60, 1800), ids[m], ids[out], tot * (rng.uniform(0.85, 0.92) if sh else rng.uniform(0.93, 0.99)), "NET_BANKING", 1, kind, variant, True, True, sid)
        elif kind == "dormant":
            a, out = actor_pool(2); a = int(rng.choice(dorm_ids)) if rng.random() < 0.6 else a
            src = actor_pool(1)[0]; v = rng.uniform(80_000, 150_000) if sh else rng.uniform(200_000, 600_000)
            b.add(t0, ids[src], ids[a], v, "NET_BANKING", 1, kind, variant, True, True, sid)
            b.add(t0 + (rng.uniform(0.5, 2) * HOUR if sh else rng.uniform(30, 900)), ids[a], ids[out], v * rng.uniform(0.9, 0.99), "NET_BANKING", 1, kind, variant, True, True, sid)
        elif kind == "velocity":
            a = actor_pool(1)[0]; k = int(rng.integers(8, 12)) if sh else int(rng.integers(15, 40))
            span = 45 * 60 if sh else 20 * 60; rc = rng.choice(active_idx, 3, replace=False)
            for j in range(k):
                b.add(t0 + j * span / k, ids[a], ids[rc[rng.integers(0, 3)]], rng.uniform(900, 9000), "API", 1, kind, variant, True, False, sid)
        elif kind == "round_trip":
            L = int(rng.integers(3, 5)); acc = actor_pool(L); t = t0; v = rng.uniform(100_000, 300_000)
            for i in range(L):
                t += rng.uniform(0.3, 1.5) * HOUR; v *= rng.uniform(0.95, 0.99)
                b.add(t, ids[acc[i]], ids[acc[(i + 1) % L]], v, "NET_BANKING", 1, kind, "unseen_family", True, True, sid)

    for period, (lo, hi) in periods.items():
        dur_days = (hi - lo) / DAY
        for kind, rate in cfg.scenarios_per_day.items():
            for _ in range(rng.poisson(rate * dur_days)):
                run(kind, start_time(lo + 0.2 * DAY, hi), variant_for(period))
        if period == "test":
            for _ in range(rng.poisson(cfg.round_trip_per_day_test * dur_days)):
                run("round_trip", start_time(lo + 0.2 * DAY, hi), "unseen_family")

    tx = pd.DataFrame(b.rows, columns=["ts", "sender", "receiver", "amount", "channel", "fraud", "scenario", "variant", "s_actor", "r_actor", "scenario_id"])
    tx = tx[(tx.ts >= 0) & (tx.ts < total) & (tx.sender != tx.receiver)].sort_values("ts", kind="stable").reset_index(drop=True)
    # Known-bad register: a quarter of scenario actors are already typed SHELL/MULE in the accounts table.
    # This metadata is used ONLY by the rule-engine baseline (which reads account_type); the GNN never sees it.
    actors = set(tx[(tx.fraud == 1) & tx.s_actor].sender) | set(tx[(tx.fraud == 1) & tx.r_actor].receiver)
    mark = accounts.account_id.isin(actors) & (rng.random(len(accounts)) < 0.25)
    accounts.loc[mark, "account_type"] = rng.choice(["SHELL", "MULE"], int(mark.sum()))
    tx.insert(0, "tx_id", [f"SIM{i:07d}" for i in range(len(tx))])
    tx["period"] = np.select([tx.ts < periods["train"][1], tx.ts < periods["val"][1]], ["train", "val"], "test")
    return tx, accounts
