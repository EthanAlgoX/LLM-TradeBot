from __future__ import annotations

import pytest

from agents.decision import DecisionRouterAgent
from config import RuntimeConfig
from contracts import ConsensusSignal, SCHEMA_V2
from state import RuntimeState


def _consensus(
    *,
    symbol: str = "BTCUSDT",
    trend_score: float = 0.0,
    osc_score: float = 0.0,
    sentiment_score: float = 0.0,
    predict_up_prob: float = 0.5,
    alignment_ok: bool = True,
    trigger_stance: str = "CONFIRMED",
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
    )


def test_decision_fast_trend_long_requires_prob_alignment():
    cfg = RuntimeConfig()
    agent = DecisionRouterAgent(cfg)
    state = RuntimeState(cycle=1, cash=100_000.0)
    c = _consensus(trend_score=30.0, predict_up_prob=0.68, alignment_ok=True)
    out = agent.route(trace_id="t1", consensus=c, price=100.0, state=state)
    assert out.action == "open_long"
    assert out.source == "fast_trend"


def test_decision_fast_trend_short_requires_strict_confirmation():
    cfg = RuntimeConfig()
    agent = DecisionRouterAgent(cfg)
    state = RuntimeState(cycle=1, cash=100_000.0)
    weak = _consensus(trend_score=-32.0, sentiment_score=10.0, predict_up_prob=0.45, trigger_stance="WAITING")
    out = agent.route(trace_id="t1", consensus=weak, price=100.0, state=state)
    assert out.action == "wait"

    strong = _consensus(trend_score=-48.0, sentiment_score=-12.0, predict_up_prob=0.30, trigger_stance="CONFIRMED")
    out2 = agent.route(trace_id="t2", consensus=strong, price=100.0, state=state)
    assert out2.action == "open_short"
    assert out2.source == "fast_trend"
    assert out2.order_params["leverage"] == 2.5
    assert out2.order_params["stop_loss"] == pytest.approx(101.2, rel=0, abs=1e-9)
    assert out2.order_params["take_profit"] == pytest.approx(97.6, rel=0, abs=1e-9)
