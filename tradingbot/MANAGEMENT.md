# Management playbook

This file is the operating manual for the automated manager — a Claude
routine that runs every weekday after the close. The routine must follow
this playbook exactly.

## Daily review procedure

1. `git checkout main && git pull`. If `tradingbot/` does not exist on main
   yet, the setup PR is unmerged — report that and stop.
2. Read the newest files in `tradingbot/journal/` and
   `tradingbot/state/performance.json`.
3. Check the last runs of the "Trading Bot" GitHub Actions workflow. If runs
   are failing or produced no journal entries, diagnose (most common cause:
   `ALPACA_API_KEY`/`ALPACA_SECRET_KEY` repo secrets missing) and report it.
4. Compare performance against `GOAL.md`: total return vs SPY, drawdown vs
   the 15% limit.
5. Write a short review to `tradingbot/journal/YYYY-MM-DD-review.md`:
   what happened, whether the goal is on track, and any action taken.
6. Commit journal/param changes to `main` and push. Never commit code
   changes directly — see "Escalation".

## Allowed parameter tuning (config/params.json only)

Tune at most **one** parameter per day, only with a written rationale in the
daily review, and never outside these bounds:

| Parameter | Bounds |
|---|---|
| `top_n` | 2–4 |
| `trend_filter_sma` | 50–200 |
| `momentum_weights` | keys from {21, 63, 126, 252}, weights sum to 1.0 |
| `cash_buffer_pct` | 2–10 |
| `rebalance_threshold_pct` | 2–10 |
| `max_position_pct` | 20–40 |
| `max_drawdown_pct` | 10–15 (never raise above 15) |
| `universe` | liquid US ETFs only; 6–15 symbols |

Do not tune reactively on a single bad day. Only adjust when at least 10
trading days of evidence point the same way.

## Circuit breaker

- The bot halts itself (`state.halted = true`) if drawdown exceeds
  `max_drawdown_pct`; while halted it holds 100% cash.
- To clear a halt: only after writing a review explaining what changed,
  set `halted` to `false` and `halted_reason` to `null` in
  `state/performance.json`. Consider tightening parameters first.

## Escalation — open a PR instead of committing when

- Any change to Python code or the workflow file.
- Adding non-ETF instruments or changing the strategy's character.
- Anything this playbook does not explicitly allow.

## Hard rules

- Paper trading only. Never switch the client off `paper=True`.
- Never disable the circuit breaker or raise `max_drawdown_pct` above 15.
- Never store API keys in the repo.
