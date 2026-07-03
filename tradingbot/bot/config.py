"""Configuration: environment credentials and tunable strategy parameters.

Strategy parameters live in config/params.json so the daily management
routine can tune them without touching code. Bounds for safe tuning are
documented in MANAGEMENT.md.
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARAMS_PATH = ROOT / "config" / "params.json"
STATE_PATH = ROOT / "state" / "performance.json"
JOURNAL_DIR = ROOT / "journal"

MARKET_TZ = "America/New_York"


def load_credentials() -> tuple[str, str]:
    key = os.environ.get("ALPACA_API_KEY", "").strip()
    secret = os.environ.get("ALPACA_SECRET_KEY", "").strip()
    if not key or not secret:
        sys.exit(
            "ALPACA_API_KEY / ALPACA_SECRET_KEY are not set. "
            "Create a free Alpaca account, generate PAPER trading keys, and "
            "add them as repository secrets (see tradingbot/README.md)."
        )
    return key, secret


def load_params() -> dict:
    with open(PARAMS_PATH) as f:
        return json.load(f)
