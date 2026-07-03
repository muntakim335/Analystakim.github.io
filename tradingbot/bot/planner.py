"""Pre-market planner: computes today's signals and writes the daily plan."""

from datetime import datetime
from zoneinfo import ZoneInfo

from .broker import Broker
from .config import JOURNAL_DIR, MARKET_TZ, load_params
from .state import drawdown_pct, load_state


def run():
    params = load_params()
    broker = Broker()
    today = datetime.now(ZoneInfo(MARKET_TZ)).date()

    if not broker.is_trading_day(today):
        print(f"{today}: market holiday/weekend — no plan.")
        return

    from .strategy import target_weights

    closes = broker.daily_closes(params["universe"])
    targets, diag = target_weights(closes, params)

    state = load_state()
    equity = broker.equity()
    positions = broker.positions()
    dd = drawdown_pct(state, equity)
    halted = state.get("halted", False)

    lines = [
        f"# Trading plan — {today}",
        "",
        f"- Account equity: ${equity:,.2f}",
        f"- Drawdown from peak: {dd:.2f}% (circuit breaker at {params['max_drawdown_pct']}%)",
        f"- Circuit breaker: {'HALTED — will move to cash' if halted else 'normal'}",
        "",
        "## Signals",
        "",
        diag.to_markdown(),
        "",
        "## Target allocation",
        "",
    ]
    if halted:
        lines.append("Circuit breaker active: target is 100% cash until the "
                     "manager reviews and clears the halt.")
    elif targets:
        for sym, w in targets.items():
            lines.append(f"- {sym}: {w:.1f}%")
        lines.append(f"- Cash: {100 - sum(targets.values()):.1f}%")
    else:
        lines.append("No asset passes the momentum + trend filters: 100% cash (defensive).")

    lines += ["", "## Current positions", ""]
    if positions:
        for sym, p in positions.items():
            lines.append(f"- {sym}: ${p['market_value']:,.2f} "
                         f"(unrealized P&L ${p['unrealized_pl']:,.2f})")
    else:
        lines.append("- none (all cash)")
    lines.append("")
    lines.append(f"Execution scheduled for ~14:45 UTC. Rebalance only where the "
                 f"target differs from the current weight by more than "
                 f"{params['rebalance_threshold_pct']}% of equity.")
    lines.append("")

    JOURNAL_DIR.mkdir(parents=True, exist_ok=True)
    path = JOURNAL_DIR / f"{today}-plan.md"
    path.write_text("\n".join(lines))
    print(f"Plan written to {path}")
