"""
Unit tests for RiskManager action protocol behavior.
"""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.risk.manager import RiskManager


def test_validate_format_accepts_generic_close_action():
    manager = RiskManager()
    decision = {
        "symbol": "BTCUSDT",
        "action": "close_position",
        "reasoning": "Trend reversed.",
    }
    ok, _ = manager.validate_format(decision)
    assert ok
    assert decision["action"] == "close_position"


def test_validate_decision_close_bypasses_open_risk_checks():
    manager = RiskManager()
    decision = {
        "symbol": "ETHUSDT",
        "action": "close_position",
        "reasoning": "Risk-off exit.",
    }
    account_info = {"available_balance": 0, "total_wallet_balance": 0}
    position_info = {"position_amt": 0.3}
    ok, normalized, _ = manager.validate_decision(
        decision=decision,
        account_info=account_info,
        position_info=position_info,
        market_snapshot={},
    )
    assert ok
    assert normalized["action"] == "close_long"


def test_validate_decision_normalizes_open_alias():
    manager = RiskManager()
    decision = {
        "symbol": "SOLUSDT",
        "action": "long",
        "reasoning": "Momentum aligned.",
        "confidence": 85,
        "leverage": 2,
        "position_size_usd": 200.0,
        "position_size_pct": 10.0,
        "current_price": 100.0,
        "stop_loss": 99.0,
        "take_profit": 102.0,
        "stop_loss_pct": 1.0,
    }
    account_info = {"available_balance": 1000.0, "total_wallet_balance": 1000.0}
    ok, normalized, _ = manager.validate_decision(
        decision=decision,
        account_info=account_info,
        position_info=None,
        market_snapshot={},
    )
    assert ok
    assert normalized["action"] == "open_long"
