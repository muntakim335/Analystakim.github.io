"""Execution: rebalance the paper account toward the strategy targets."""

import time
from datetime import datetime
from zoneinfo import ZoneInfo

from alpaca.trading.enums import OrderSide

from .broker import Broker
from .config import JOURNAL_DIR, MARKET_TZ, load_params
from .state import drawdown_pct, load_state, save_state


def run():
    params = load_params()
    broker = Broker()
    today = datetime.now(ZoneInfo(MARKET_TZ)).date()

    if not broker.market_open_now():
        print(f"{today}: market is closed — no trading.")
        return

    from .strategy import target_weights

    state = load_state()
    equity = broker.equity()

    # Circuit breaker: trip if drawdown from peak exceeds the limit.
    if state.get("peak_equity") and drawdown_pct(state, equity) >= params["max_drawdown_pct"]:
        if not state.get("halted"):
            state["halted"] = True
            state["halted_reason"] = (
                f"Drawdown {drawdown_pct(state, equity):.2f}% breached "
                f"{params['max_drawdown_pct']}% limit on {today}"
            )
            save_state(state)

    if state.get("halted"):
        targets = {}
        note = "CIRCUIT BREAKER ACTIVE — liquidating to cash."
    else:
        closes = broker.daily_closes(params["universe"])
        targets, _ = target_weights(closes, params)
        note = None

    positions = broker.positions()
    threshold = params["rebalance_threshold_pct"] / 100.0 * equity
    target_dollars = {sym: w / 100.0 * equity for sym, w in targets.items()}

    actions = []

    # 1) Full exits and trims first — they free up cash for the buys.
    sell_ids = []
    for sym, pos in positions.items():
        tgt = target_dollars.get(sym, 0.0)
        diff = pos["market_value"] - tgt
        if tgt == 0.0 and pos["market_value"] > 1:
            broker.close_all_of(sym)
            actions.append(f"SELL ALL {sym} (~${pos['market_value']:,.2f})")
        elif diff > threshold:
            sell_ids.append(broker.market_order_notional(sym, diff, OrderSide.SELL))
            actions.append(f"TRIM {sym} by ~${diff:,.2f}")

    if sell_ids:
        broker.wait_for_orders(sell_ids)
    if actions:
        time.sleep(10)  # let paper cash balance settle before sizing the buys

    # 2) Buys, capped by available cash.
    cash = float(broker.account().cash)
    buy_ids = []
    for sym, tgt in target_dollars.items():
        held = broker.positions().get(sym, {}).get("market_value", 0.0)
        diff = tgt - held
        if diff > threshold:
            notional = min(diff, max(0.0, cash * 0.98))
            if notional > 1:
                buy_ids.append(broker.market_order_notional(sym, notional, OrderSide.BUY))
                actions.append(f"BUY {sym} for ~${notional:,.2f}")
                cash -= notional
    if buy_ids:
        broker.wait_for_orders(buy_ids)

    # Journal the executions.
    lines = [f"# Trade log — {today}", ""]
    if note:
        lines += [f"**{note}**", ""]
    if actions:
        lines += [f"- {a}" for a in actions]
    else:
        lines.append("- No rebalancing needed: portfolio already within "
                     f"{params['rebalance_threshold_pct']}% of targets.")
    lines += ["", "## Positions after execution", ""]
    for sym, p in broker.positions().items():
        lines.append(f"- {sym}: ${p['market_value']:,.2f}")
    if not broker.positions():
        lines.append("- none (all cash)")
    lines.append("")

    JOURNAL_DIR.mkdir(parents=True, exist_ok=True)
    path = JOURNAL_DIR / f"{today}-trades.md"
    path.write_text("\n".join(lines))
    print(f"Executed {len(actions)} action(s); log written to {path}")
