from __future__ import annotations

import pytest

from agents.decision import DecisionRouterAgent
from config import RuntimeConfig
from contracts import ConsensusSignal, SCHEMA_V2
from state import RuntimeState, Position


def _consensus(
    *,
    symbol: str = "BTCUSDT",
    trend_score: float = 0.0,
    osc_score: float = 0.0,
    sentiment_score: float = 0.0,
    predict_up_prob: float = 0.5,
    alignment_ok: bool = True,
    trigger_stance: str = "CONFIRMED",
    momentum_short_pct: float = 0.0,
) -> ConsensusSignal:
    return ConsensusSignal(
        schema_version=SCHEMA_V2,
        trace_id="t1",
        symbol=symbol,
        trend_score=trend_score,
        osc_score=osc_score,
        sentiment_score=sentiment_score,
        predict_up_prob=predict_up_prob,
        alignment_bias="BULLISH" if trend_score > 0 else "BEARISH" if trend_score < 0 else "NEUTRAL",
        alignment_ok=alignment_ok,
        semantic={"trend_stance": "UPTREND", "setup_stance": "MONITOR", "trigger_stance": trigger_stance},
        context={"market_rank": 1, "reflection_hint": "none"},
        momentum_short_pct=momentum_short_pct,
    )


def test_decision_fast_trend_long_requires_prob_alignment():
    cfg = RuntimeConfig()
    agent = DecisionRouterAgent(cfg)
    state = RuntimeState(cycle=1, cash=100_000.0)
    # trend_score=36 / 12 = 3.0 meets threshold 2.5; momentum_short_pct > 0 confirms
    c = _consensus(trend_score=36.0, predict_up_prob=0.68, alignment_ok=True, momentum_short_pct=1.0)
    out = agent.route(trace_id="t1", consensus=c, price=100.0, state=state)
    assert out.action == "open_long"
    assert out.source == "fast_trend"


def test_decision_fast_trend_short_requires_strict_confirmation():
    cfg = RuntimeConfig()
    cfg.decision.fast_trend_short_threshold = 3.5
    cfg.decision.fast_trend_short_max_sentiment = 0.0
    cfg.decision.fast_trend_short_max_predict_up_prob = 0.40
    agent = DecisionRouterAgent(cfg)
    state = RuntimeState(cycle=1, cash=100_000.0)
    # Weak signal: trend_score / 12 = -2.67 doesn't meet -3.5 threshold
    weak = _consensus(trend_score=-32.0, sentiment_score=10.0, predict_up_prob=0.45, trigger_stance="WAITING", momentum_short_pct=-1.0)
    out = agent.route(trace_id="t1", consensus=weak, price=100.0, state=state)
    assert out.action == "wait"

    # Strong signal: trend_score / 12 = -4.0 >= -3.5 threshold; momentum_short_pct < 0 confirms
    strong = _consensus(trend_score=-48.0, sentiment_score=-12.0, predict_up_prob=0.30, trigger_stance="CONFIRMED", momentum_short_pct=-2.0)
    out2 = agent.route(trace_id="t2", consensus=strong, price=100.0, state=state)
    assert out2.action == "open_short"
    assert out2.source == "fast_trend"
    # Confidence = min(90, 70 + abs(-4.0)*5) = 90.0 → dynamic leverage: 4.0
    assert out2.order_params["leverage"] == 4.0
    # Volatility-adaptive stops: default vol=1.0, vol_stop=1.0/100*1.5=0.015, max(0.02, 0.015)=0.02
    assert out2.order_params["stop_loss"] == pytest.approx(100.0 * 1.02, rel=1e-9)
    assert out2.order_params["take_profit"] == pytest.approx(100.0 * (1.0 - 0.02 * 2.0), rel=1e-9)


def test_decision_close_action_has_zero_stop_take():
    """Close actions should set stop_loss and take_profit to 0 to avoid R:R checks."""
    cfg = RuntimeConfig()
    cfg.decision.max_holding_cycles = 20
    agent = DecisionRouterAgent(cfg)
    # max_holding_cycles is mocked to 20, so cycle 16 - opened 1 = 15 < 20 → no forced exit yet
    # Need cycle 21 for forced exit: 21 - 1 = 20 >= 20
    state = RuntimeState(cycle=21, cash=100_000.0)
    state.positions["BTCUSDT"] = Position(symbol="BTCUSDT", side="long", qty=1.0, entry_price=100.0, leverage=3.0, opened_cycle=1)
    c = _consensus(symbol="BTCUSDT", trend_score=0.0, predict_up_prob=0.5)
    out = agent.route(trace_id="t1", consensus=c, price=100.0, state=state)
    assert out.action == "close_long"
    assert out.order_params["stop_loss"] == 0.0
    assert out.order_params["take_profit"] == 0.0


def test_decision_loss_cooldown_raises_threshold():
    """When reflection_hint indicates negative PnL, the open threshold should be boosted."""
    cfg = RuntimeConfig()
    agent = DecisionRouterAgent(cfg)
    state = RuntimeState(cycle=5, cash=100_000.0)
    state.reflection_hint = "recent pnl negative: reduce leverage and require stronger confirmation"

    c = _consensus(trend_score=0.0, osc_score=0.0, sentiment_score=0.0, predict_up_prob=0.5)
    out = agent.route(trace_id="t1", consensus=c, price=100.0, state=state)
    assert out.action == "wait"


def test_decision_symbol_cooldown_skips_reentry():
    """When a symbol is on cooldown, new opens should be skipped."""
    cfg = RuntimeConfig()
    agent = DecisionRouterAgent(cfg)
    state = RuntimeState(cycle=5, cash=100_000.0)
    state.set_cooldown("SOLUSDT", 8)  # cooldown until cycle 8

    c = _consensus(symbol="SOLUSDT", trend_score=36.0, predict_up_prob=0.68, alignment_ok=True, momentum_short_pct=1.0)
    out = agent.route(trace_id="t1", consensus=c, price=100.0, state=state)
    assert out.action == "wait"
    assert out.source == "cooldown"

    # After cooldown expires
    state.cycle = 9
    out2 = agent.route(trace_id="t2", consensus=c, price=100.0, state=state)
    assert out2.action == "open_long"


def test_decision_volatility_adaptive_stops():
    """High volatility should widen stops beyond config defaults."""
    cfg = RuntimeConfig()
    agent = DecisionRouterAgent(cfg)
    state = RuntimeState(cycle=1, cash=100_000.0)
    c = _consensus(trend_score=36.0, predict_up_prob=0.68, alignment_ok=True, momentum_short_pct=1.0)
    # High volatility: 5% — vol_stop = 5/100 * 1.3 = 0.065 > config 0.04
    out = agent.route(trace_id="t1", consensus=c, price=100.0, state=state, volatility_pct=5.0)
    assert out.action == "open_long"
    assert out.order_params["stop_loss"] == pytest.approx(100.0 * (1.0 - 0.065), rel=1e-9)
    assert out.order_params["take_profit"] == pytest.approx(100.0 * (1.0 + 0.065 * 2.0), rel=1e-9)
