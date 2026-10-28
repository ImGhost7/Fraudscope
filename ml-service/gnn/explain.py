"""Rule-style reasons for an account, derived from its test-window transactions."""


def reasons(a, w):
    r = []; i = w[w.receiver == a]; o = w[w.sender == a]
    if len(o) >= 6 and o.ts.max() - o.ts.min() < 1800: r.append(f"Fan-out: {o.receiver.nunique()} receivers within {int((o.ts.max()-o.ts.min())/60)+1} min")
    if len(i) >= 5 and len(o) and 0.9 * i.amount.sum() < o.amount.sum() <= 1.05 * i.amount.sum(): r.append(f"Mule behaviour: forwards {o.amount.sum()/i.amount.sum():.0%} of {len(i)} inflows")
    if ((o.amount >= 45000) & (o.amount < 50000)).sum() >= 3: r.append(f"Structuring: {((o.amount>=45000)&(o.amount<50000)).sum()} transfers just under the ₹50,000 threshold")
    for _, t in o.iterrows():
        prev = i[i.ts < t.ts]
        if len(prev) and t.ts - prev.ts.max() < 300 and t.amount > .8 * prev.iloc[-1].amount and t.amount > 100000:
            r.append(f"Layering hop: forwarded ₹{t.amount:,.0f} only {int(t.ts-prev.ts.max())}s after receiving funds"); break
    return r or ["No single rule fired; score driven by the account's neighbourhood and timing pattern"]
