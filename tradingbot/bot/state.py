"""Persistent bot state: equity history, peak equity, circuit-breaker flag.

Stored as JSON in the repo so every run (and the dashboard) can read it.
"""

import json

from .config import STATE_PATH


def load_state() -> dict:
    if STATE_PATH.exists():
        with open(STATE_PATH) as f:
            return json.load(f)
    return {
        "start_date": None,
        "starting_equity": None,
        "peak_equity": None,
        "halted": False,
        "halted_reason": None,
        "history": [],
    }


def save_state(state: dict):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_PATH, "w") as f:
        json.dump(state, f, indent=2)
        f.write("\n")


def drawdown_pct(state: dict, equity: float) -> float:
    peak = state.get("peak_equity") or equity
    if peak <= 0:
        return 0.0
    return max(0.0, (peak - equity) / peak * 100.0)
