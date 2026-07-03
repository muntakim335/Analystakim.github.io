# Automated paper-trading bot

A fully automated, self-journaling trading bot that manages a **paper-money**
(fake money, real market data) portfolio on Alpaca. It plans every morning,
trades after the open, reports after the close, and is reviewed daily by an
automated Claude manager. Live dashboard: **`/trading/`** on this site.

## How it works

| Time (UTC, weekdays) | Job | Output |
|---|---|---|
| 13:00 | Pre-market plan: compute signals, publish intended allocation | `journal/YYYY-MM-DD-plan.md` |
| 14:45 | Execute: rebalance the paper account toward targets | `journal/YYYY-MM-DD-trades.md` |
| 21:15 | Report: snapshot equity, update history, compare vs goal | `journal/YYYY-MM-DD-report.md`, `state/performance.json` |
| ~22:00 | Claude manager reviews the day, tunes params per `MANAGEMENT.md` | `journal/YYYY-MM-DD-review.md` |

Strategy: momentum ETF rotation — hold the top 3 ETFs by blended 1/3/6-month
momentum, only while they trade above their 100-day average; otherwise cash.
A circuit breaker liquidates to cash if drawdown exceeds 15%. Details in
`bot/strategy.py`, tunables in `config/params.json`, goal in `GOAL.md`.

## One-time setup (required — ~5 minutes)

The bot cannot trade until you give it paper-trading API keys:

1. Create a free account at <https://alpaca.markets> (no funding needed).
2. In the dashboard, switch to **Paper Trading** and generate an API key
   pair. Paper keys start with `PK…`.
3. In this GitHub repo: **Settings → Secrets and variables → Actions →
   New repository secret**, add:
   - `ALPACA_API_KEY` — the paper API key ID
   - `ALPACA_SECRET_KEY` — the paper secret
4. Merge the bot's PR into `main` (scheduled workflows only run from the
   default branch).
5. Optional: trigger a first run manually — **Actions → Trading Bot →
   Run workflow** → mode `report` — to seed the dashboard.

Until the secrets exist, scheduled runs skip with a warning instead of
trading.

## Safety

- **Paper account only** (`paper=True` hard-coded). No real money can move.
- Long-only liquid ETFs, no leverage, max 35% per position, 15% max
  drawdown circuit breaker.
- The Claude manager may only tune parameters within the bounds in
  `MANAGEMENT.md`; code changes require a pull request.

## Running locally

```bash
cd tradingbot
pip install -r requirements.txt
export ALPACA_API_KEY=PK... ALPACA_SECRET_KEY=...
python -m bot.main --mode plan    # or trade / report
```
