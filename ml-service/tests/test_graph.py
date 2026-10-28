import numpy as np
import pandas as pd

from fraud_gnn.features import NODE_FEATURES, build_window_graph, clean_transactions, to_model_inputs

H = 3600.0
W = 24 * H


def tx(rows):
    return pd.DataFrame(rows, columns=["tx_id", "sender", "receiver", "amount", "ts", "channel"])


def test_clean_handles_bad_records():
    df = tx([("a", "A", "B", 100, 1, "MOBILE"), ("a", "A", "B", 100, 1, "MOBILE"),      # duplicate id
             ("b", "A", "A", 50, 2, "API"),                                             # self transfer
             ("c", "A", "B", -5, 3, "API"), ("d", "A", "B", "x", 4, "API"),             # invalid amounts
             ("e", None, "B", 10, 5, "API"), ("f", "A", "B", 10, None, "API"),         # missing id / time
             ("g", "B", "C", 20, 6, "NET_BANKING")])
    out, rep = clean_transactions(df)
    assert list(out.tx_id) == ["a", "g"]
    assert (rep.duplicates, rep.self_transfers, rep.invalid_amount, rep.missing_time_or_ids) == (1, 1, 2, 2)


def test_direction_indexing_and_multi_edges():
    c, _ = clean_transactions(tx([("1", "A", "B", 100, 10, "MOBILE"), ("2", "A", "B", 200, 20, "MOBILE"), ("3", "C", "A", 50, 30, "MOBILE")]))
    g = build_window_graph(c, None, 100, W)
    assert g.node_ids == ["A", "B", "C"] and g.index["B"] == 1
    s, r = g.edge_index
    assert [(g.node_ids[i], g.node_ids[j]) for i, j in zip(s, r)] == [("A", "B"), ("A", "B"), ("C", "A")]   # direction kept, 2 parallel edges kept
    f = dict(zip(NODE_FEATURES, g.x_raw[g.index["A"]]))
    assert np.isclose(f["out_cnt"], np.log1p(2)) and np.isclose(f["in_cnt"], np.log1p(1)) and np.isclose(f["out_uniq"], np.log1p(1))


def test_reverse_edges_flagged_not_real():
    c, _ = clean_transactions(tx([("1", "A", "B", 100, 10, "MOBILE")]))
    g = build_window_graph(c, None, 100, W)
    x, ei, ea = to_model_inputs(g, g.x_raw)
    assert ei.shape == (2, 2) and ea[0, -1] == 0 and ea[1, -1] == 1 and tuple(ei[:, 1]) == (1, 0)


def test_window_boundaries_and_no_future_leakage():
    base = [("1", "A", "B", 100, 100.0, "MOBILE"), ("2", "B", "C", 90, 200.0, "MOBILE")]
    c1, _ = clean_transactions(tx(base))
    c2, _ = clean_transactions(tx(base + [("3", "C", "D", 5000, 300.0, "MOBILE")]))       # a FUTURE transaction
    g1 = build_window_graph(c1, None, 250.0, W); g2 = build_window_graph(c2, None, 250.0, W)
    assert g1.node_ids == g2.node_ids and np.allclose(g1.x_raw, g2.x_raw) and g1.tx_ids == g2.tx_ids   # asof=250 ignores ts=300
    g3 = build_window_graph(c1, None, 100.0 + W, W)                                       # ts=100 sits exactly on the open boundary (asof-W)
    assert g3.tx_ids == ["2"]


def test_temporal_edge_features_pass_through():
    c, _ = clean_transactions(tx([("1", "S", "M", 1000, 100, "API"), ("2", "M", "T", 950, 130, "API")]))
    g = build_window_graph(c, None, 200, W)
    ea2 = g.edge_attr[1]
    assert ea2[4] == 1.0                                   # has previous incoming
    assert np.isclose(ea2[3], 0.95 / 2.0)                  # forwarded fraction 0.95 (scaled /2)
    f = dict(zip(NODE_FEATURES, g.x_raw[g.index["M"]]))
    assert f["fast_forward_frac"] == 1.0


def test_empty_unknown_and_new_accounts():
    empty = build_window_graph(pd.DataFrame(columns=["tx_id", "sender", "receiver", "amount", "ts", "channel"]), None, 10, W)
    assert empty.node_ids == [] and empty.x_raw.shape == (0, len(NODE_FEATURES))
    c, _ = clean_transactions(tx([("1", "A", "B", 10, 5, "MOBILE")]))
    acc = pd.DataFrame([dict(account_id="A", kyc_level="LOW", status="DORMANT", balance=100.0, opened_ts=-86400.0)])
    g = build_window_graph(c, acc, 10, W)              # B is not in the accounts table -> neutral defaults, no crash
    fa, fb = dict(zip(NODE_FEATURES, g.x_raw[0])), dict(zip(NODE_FEATURES, g.x_raw[1]))
    assert fa["kyc_level"] == 0.0 and fa["status_dormant"] == 1.0 and fb["kyc_level"] == 0.5 and np.isfinite(g.x_raw).all()


def test_dormancy_uses_only_prior_activity():
    c, _ = clean_transactions(tx([("1", "A", "B", 10, 100 * 86400.0, "MOBILE")]))
    g = build_window_graph(c, None, 100 * 86400.0 + 10, W, prior_last_active={"B": 0.0})
    assert np.isclose(dict(zip(NODE_FEATURES, g.x_raw[g.index["B"]]))["log_dormancy_days"], np.log1p(100.0))
