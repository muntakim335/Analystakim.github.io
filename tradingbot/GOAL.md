# Goal

**Primary goal:** Over the 12 months starting from the first trading day,
grow the $100,000 paper portfolio so that it **beats the SPY total return by
at least 3 percentage points**, while keeping the **maximum drawdown under
15%**.

## Constraints

- Paper money only (Alpaca paper account). Never real funds.
- Long-only, no leverage, no shorting, no options.
- Universe restricted to highly liquid US-listed ETFs.
- 100% automated: every decision is made by the rules in `bot/strategy.py`
  with the parameters in `config/params.json`.

## Process goals (checked daily by the manager)

1. A plan is published every trading morning (`journal/YYYY-MM-DD-plan.md`).
2. Trades execute automatically and are logged (`journal/YYYY-MM-DD-trades.md`).
3. A report is published after every close (`journal/YYYY-MM-DD-report.md`).
4. The manager (Claude daily routine) reviews performance every weekday and
   tunes parameters within the bounds in `MANAGEMENT.md`.

## Milestones

| When | Check |
|---|---|
| Month 1 | Pipeline runs clean every trading day; no missed runs |
| Month 3 | Drawdown < 15%; strategy behaving as designed |
| Month 6 | Tracking within 3 pp of SPY or better |
| Month 12 | Beat SPY by ≥ 3 pp with max drawdown < 15% |
