from __future__ import annotations

from math import exp

from tradebot.agents.base import BaseAgent
from tradebot.contracts import (
    ConsensusSignal,
    ContextOutput,
    MarketSnapshot,
    PredictionOutput,
    SCHEMA_V2,
    SemanticOutput,
    SignalOutput,
)
from tradebot.state import RuntimeState


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + exp(-x))


class SignalAgent(BaseAgent):
    name = "signal_agent"

    def analyze(self, *, trace_id: str, snapshot: MarketSnapshot) -> SignalOutput:
        trend = max(-100.0, min(100.0, snapshot.momentum_30m_pct * 12.0))
        oscillator = max(-100.0, min(100.0, -snapshot.momentum_30m_pct * 6.0))
        sentiment = max(-100.0, min(100.0, (snapshot.volume_ratio - 1.0) * 55.0))
        return SignalOutput(
            schema_version=SCHEMA_V2,
            trace_id=trace_id,
            symbol=snapshot.symbol,
            trend_score=round(trend, 4),
            oscillator_score=round(oscillator, 4),
            sentiment_score=round(sentiment, 4),
        )


class PredictionAgent(BaseAgent):
    name = "prediction_agent"

    def predict(self, *, trace_id: str, snapshot: MarketSnapshot, signal: SignalOutput) -> PredictionOutput:
        x = signal.trend_score / 45.0 + signal.sentiment_score / 90.0 - snapshot.volatility_pct / 5.0
        p_up = _sigmoid(x)
        confidence = min(1.0, abs(p_up - 0.5) * 2.2)
        return PredictionOutput(
            schema_version=SCHEMA_V2,
            trace_id=trace_id,
            symbol=snapshot.symbol,
            probability_up=round(p_up, 6),
            confidence=round(confidence, 6),
        )


class ContextAgent(BaseAgent):
    name = "context_agent"

    def build(self, *, trace_id: str, symbol: str, rank: int, state: RuntimeState) -> ContextOutput:
        hint = state.reflection_hint or "no reflection yet"
        return ContextOutput(
            schema_version=SCHEMA_V2,
            trace_id=trace_id,
            symbol=symbol,
            market_rank=rank,
            reflection_hint=hint,
        )


class SemanticAgent(BaseAgent):
    name = "semantic_agent"

    def summarize(self, *, trace_id: str, snapshot: MarketSnapshot, signal: SignalOutput) -> SemanticOutput:
        trend_stance = "UPTREND" if signal.trend_score > 15 else "DOWNTREND" if signal.trend_score < -15 else "NEUTRAL"
        setup_stance = "PULLBACK_ZONE" if signal.oscillator_score > 20 else "RALLY_ZONE" if signal.oscillator_score < -20 else "MONITOR"
        trigger_stance = "CONFIRMED" if snapshot.volume_ratio > 1.2 and abs(snapshot.momentum_30m_pct) > 1.0 else "WAITING"
        return SemanticOutput(
            schema_version=SCHEMA_V2,
            trace_id=trace_id,
            symbol=snapshot.symbol,
            trend_stance=trend_stance,
            setup_stance=setup_stance,
            trigger_stance=trigger_stance,
        )


class FusionAgent(BaseAgent):
    name = "fusion_agent"

    def fuse(
        self,
        *,
        trace_id: str,
        symbol: str,
        signal: SignalOutput,
        prediction: PredictionOutput,
        context: ContextOutput,
        semantic: SemanticOutput,
    ) -> ConsensusSignal:
        align = (signal.trend_score > 0 and prediction.probability_up >= 0.5) or (
            signal.trend_score < 0 and prediction.probability_up < 0.5
        )
        bias = "BULLISH" if signal.trend_score > 8 else "BEARISH" if signal.trend_score < -8 else "NEUTRAL"
        return ConsensusSignal(
            schema_version=SCHEMA_V2,
            trace_id=trace_id,
            symbol=symbol,
            trend_score=signal.trend_score,
            osc_score=signal.oscillator_score,
            sentiment_score=signal.sentiment_score,
            predict_up_prob=prediction.probability_up,
            alignment_bias=bias,
            alignment_ok=align,
            semantic={
                "trend_stance": semantic.trend_stance,
                "setup_stance": semantic.setup_stance,
                "trigger_stance": semantic.trigger_stance,
            },
            context={
                "market_rank": context.market_rank,
                "reflection_hint": context.reflection_hint,
            },
        )
