"""Thin wrapper around the Alpaca paper-trading and market-data APIs."""

import time
from datetime import datetime, timedelta, timezone

import pandas as pd
from alpaca.data.enums import DataFeed
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest
from alpaca.data.timeframe import TimeFrame
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.trading.requests import GetCalendarRequest, MarketOrderRequest

from .config import load_credentials

TERMINAL_ORDER_STATES = {"filled", "canceled", "expired", "rejected", "done_for_day"}


class Broker:
    def __init__(self):
        key, secret = load_credentials()
        self.trading = TradingClient(key, secret, paper=True)
        self.data = StockHistoricalDataClient(key, secret)

    # ---- account / market state -------------------------------------------

    def account(self):
        return self.trading.get_account()

    def equity(self) -> float:
        return float(self.account().equity)

    def positions(self) -> dict[str, dict]:
        out = {}
        for p in self.trading.get_all_positions():
            out[p.symbol] = {
                "qty": float(p.qty),
                "market_value": float(p.market_value),
                "unrealized_pl": float(p.unrealized_pl),
                "avg_entry_price": float(p.avg_entry_price),
            }
        return out

    def market_open_now(self) -> bool:
        return bool(self.trading.get_clock().is_open)

    def is_trading_day(self, day) -> bool:
        cal = self.trading.get_calendar(GetCalendarRequest(start=day, end=day))
        return any(c.date == day for c in cal)

    # ---- market data --------------------------------------------------------

    def daily_closes(self, symbols: list[str], lookback_days: int = 500) -> pd.DataFrame:
        """Daily close prices, one column per symbol (free IEX feed)."""
        start = datetime.now(timezone.utc) - timedelta(days=lookback_days)
        bars = self.data.get_stock_bars(
            StockBarsRequest(
                symbol_or_symbols=symbols,
                timeframe=TimeFrame.Day,
                start=start,
                feed=DataFeed.IEX,
            )
        )
        df = bars.df.reset_index()
        closes = df.pivot(index="timestamp", columns="symbol", values="close")
        return closes.sort_index().ffill()

    # ---- orders -------------------------------------------------------------

    def close_all_of(self, symbol: str):
        self.trading.close_position(symbol)

    def market_order_notional(self, symbol: str, notional: float, side: OrderSide):
        order = self.trading.submit_order(
            MarketOrderRequest(
                symbol=symbol,
                notional=round(abs(notional), 2),
                side=side,
                time_in_force=TimeInForce.DAY,
            )
        )
        return order.id

    def wait_for_orders(self, order_ids: list, timeout_s: int = 90):
        deadline = time.time() + timeout_s
        pending = set(order_ids)
        while pending and time.time() < deadline:
            for oid in list(pending):
                status = str(self.trading.get_order_by_id(oid).status)
                if status.split(".")[-1].lower() in TERMINAL_ORDER_STATES:
                    pending.discard(oid)
            if pending:
                time.sleep(3)
