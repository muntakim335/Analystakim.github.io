"""Momentum ETF-rotation strategy.

Score each asset with a blend of 1/3/6-month momentum. An asset is eligible
only if its blended momentum is positive AND price is above its long-term
moving average (trend filter). Hold the top N eligible assets, equally
weighted with a cash buffer; anything else stays in cash. Fully rules-based,
long-only, no leverage.
"""

import pandas as pd


def momentum_scores(closes: pd.DataFrame, weights: dict[str, float]) -> pd.Series:
    scores = pd.Series(0.0, index=closes.columns)
    last = closes.iloc[-1]
    for lookback, w in weights.items():
        lb = int(lookback)
        if len(closes) <= lb:
            raise ValueError(f"Not enough history for {lb}-day momentum")
        scores += w * (last / closes.iloc[-1 - lb] - 1.0)
    return scores


def target_weights(closes: pd.DataFrame, params: dict) -> tuple[dict[str, float], pd.DataFrame]:
    """Return ({symbol: weight_pct}, diagnostics table)."""
    scores = momentum_scores(closes, params["momentum_weights"])
    sma = closes.rolling(params["trend_filter_sma"]).mean().iloc[-1]
    last = closes.iloc[-1]
    above_trend = last > sma

    diag = pd.DataFrame(
        {
            "close": last.round(2),
            f"sma{params['trend_filter_sma']}": sma.round(2),
            "momentum": scores.round(4),
            "above_trend": above_trend,
        }
    ).sort_values("momentum", ascending=False)

    eligible = scores[(scores > 0) & above_trend].sort_values(ascending=False)
    picks = list(eligible.index[: params["top_n"]])

    targets: dict[str, float] = {}
    if picks:
        investable = 100.0 - params["cash_buffer_pct"]
        w = min(investable / len(picks), params["max_position_pct"])
        targets = {sym: round(w, 2) for sym in picks}
    return targets, diag
