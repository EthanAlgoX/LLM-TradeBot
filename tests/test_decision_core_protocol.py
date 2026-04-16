"""
Unit tests for DecisionCore action protocol behavior.
"""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.agents.decision_core.decision_core_agent import DecisionCoreAgent, OvertradingGuard, VoteResult


def test_overtrading_guard_counts_only_open_actions():
    guard = OvertradingGuard()
    guard.MAX_POSITIONS_6H = 1
    guard.record_trade("BTCUSDT", "close_long")
    allowed, _ = guard.can_open_position("ETHUSDT", current_cycle=10)
    assert allowed

    guard.record_trade("ETHUSDT", "open_long")
    allowed, reason = guard.can_open_position("SOLUSDT", current_cycle=20)
    assert not allowed
    assert "6小时内已开" in reason


def test_decision_core_statistics_normalize_legacy_alias():
    agent = DecisionCoreAgent()
    agent.history = [
        VoteResult(
            action="long",
            confidence=70.0,
            weighted_score=20.0,
            vote_details={},
            multi_period_aligned=True,
            reason="legacy alias",
        ),
        VoteResult(
            action="open_short",
            confidence=72.0,
            weighted_score=-22.0,
            vote_details={},
            multi_period_aligned=False,
            reason="canonical",
        ),
    ]
    stats = agent.get_statistics()
    assert stats["action_distribution"]["open_long"] == 1
    assert stats["action_distribution"]["open_short"] == 1
