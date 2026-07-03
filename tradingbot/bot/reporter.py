"""Post-close reporter: snapshots equity, updates history + peak, writes the
daily report, and tracks progress against GOAL.md."""

from datetime import datetime
from zoneinfo import ZoneInfo

from .broker import Broker
from .config import JOURNAL_DIR, MARKET_TZ, load_params
from .state import drawdown_pct, load_state, save_state


def run():
    params = load_params()
    broker = Broker()
    today = datetime.now(ZoneInfo(MARKET_TZ)).date()

    if not broker.is_trading_day(today):
        print(f"{today}: market holiday/weekend — no report.")
        return

    state = load_state()
    equity = broker.equity()
    account = broker.account()
    positions = broker.positions()
    spy_close = float(broker.daily_closes(["SPY"], lookback_days=10)["SPY"].iloc[-1])

    if state["start_date"] is None:
        state["start_date"] = str(today)
        state["starting_equity"] = equity
        state["peak_equity"] = equity
    state["peak_equity"] = max(state["peak_equity"], equity)

    entry = {
        "date": str(today),
        "equity": round(equity, 2),
        "cash": round(float(account.cash), 2),
        "spy_close": round(spy_close, 2),
        "positions": {s: round(p["market_value"], 2) for s, p in positions.items()},
    }
    state["history"] = [h for h in state["history"] if h["date"] != str(today)]
    state["history"].append(entry)
    state["history"].sort(key=lambda h: h["date"])
    save_state(state)

    # Performance vs. goal
    start_eq = state["starting_equity"]
    bot_ret = (equity / start_eq - 1.0) * 100.0
    first_spy = state["history"][0]["spy_close"]
    spy_ret = (spy_close / first_spy - 1.0) * 100.0
    dd = drawdown_pct(state, equity)

    lines = [
        f"# Daily report — {today}",
        "",
        f"- Equity: ${equity:,.2f} (start ${start_eq:,.2f})",
        f"- Total return: {bot_ret:+.2f}%",
        f"- SPY benchmark over same period: {spy_ret:+.2f}%",
        f"- Alpha vs SPY: {bot_ret - spy_ret:+.2f} pp (goal: +3 pp over 12 months)",
        f"- Drawdown from peak: {dd:.2f}% (limit {params['max_drawdown_pct']}%)",
        f"- Circuit breaker: {'HALTED — ' + str(state.get('halted_reason')) if state.get('halted') else 'normal'}",
        "",
        "## Positions at close",
        "",
    ]
    if positions:
        for sym, p in positions.items():
            lines.append(f"- {sym}: ${p['market_value']:,.2f} "
                         f"(unrealized P&L ${p['unrealized_pl']:,.2f})")
    else:
        lines.append("- none (all cash)")
    lines += ["", f"History length: {len(state['history'])} trading day(s).", ""]

    JOURNAL_DIR.mkdir(parents=True, exist_ok=True)
    path = JOURNAL_DIR / f"{today}-report.md"
    path.write_text("\n".join(lines))
    print(f"Report written to {path}; equity ${equity:,.2f} ({bot_ret:+.2f}%)")
