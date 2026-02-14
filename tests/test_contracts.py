"""
Unit tests for analysis->execution contracts.
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.agents.contracts import SuggestedTrade


def test_suggested_trade_from_cycle_result_open_alias():
    result = {
        "status": "suggested",
        "action": "long",
        "confidence": 78,
        "current_price": 100.5,
        "order_params": {
            "action": "long",
            "quantity": 1.2,
        },
    }
    trade = SuggestedTrade.from_cycle_result("BTCUSDT", result)
    assert trade is not None
    assert trade.symbol == "BTCUSDT"
    assert trade.action == "open_long"
    assert trade.order_params["action"] == "open_long"
    assert trade.confidence == 78


def test_suggested_trade_rejects_non_suggested_status():
    result = {
        "status": "wait",
        "action": "wait",
        "order_params": {"action": "wait"},
    }
    assert SuggestedTrade.from_cycle_result("ETHUSDT", result) is None


def test_suggested_trade_rejects_non_open_action():
    result = {
        "status": "suggested",
        "action": "wait",
        "order_params": {"action": "wait"},
    }
    assert SuggestedTrade.from_cycle_result("SOLUSDT", result) is None
