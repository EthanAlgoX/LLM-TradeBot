from agents.post_trade import ReflectionWriterAgent
from agents.selector import UnifiedSelectorAgent
from config import RuntimeConfig
from state import RuntimeState, TradeRecord


def test_reflection_ignores_open_trade_fees():
    state = RuntimeState(cycle=2, cash=9_999.0)
    state.trades.append(TradeRecord(cycle=1, symbol="BTCUSDT", action="open_long", qty=1.0, price=100.0, pnl=0.0, fee=0.03, event_type="open"))

    hint = ReflectionWriterAgent().reflect(state)

    assert hint == "no reflection yet"


def test_selector_feedback_uses_closed_trade_outcomes_only():
    cfg = RuntimeConfig()
    agent = UnifiedSelectorAgent(cfg)
    state = RuntimeState(cycle=5, cash=10_000.0)
    state.trades.extend(
        [
            TradeRecord(cycle=1, symbol="BTCUSDT", action="open_long", qty=1.0, price=100.0, pnl=0.0, fee=0.03, event_type="open"),
            TradeRecord(cycle=2, symbol="BTCUSDT", action="close_long", qty=1.0, price=102.0, pnl=2.0),
        ]
    )

    score = agent._feedback_score("BTCUSDT", state)

    assert score > 50.0
