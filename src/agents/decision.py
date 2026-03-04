from __future__ import annotations

from agents.base import BaseAgent
from config import RuntimeConfig
from contracts import ConsensusSignal, ProposedAction, SCHEMA_V2
from state import RuntimeState


class DecisionRouterAgent(BaseAgent):
    name = "decision_router_agent"

    def __init__(self, cfg: RuntimeConfig) -> None:
        self.cfg = cfg

    def route(self, *, trace_id: str, consensus: ConsensusSignal, price: float, state: RuntimeState) -> ProposedAction:
        symbol = consensus.symbol
        has_position = state.has_position(symbol)

        # forced exit: stale holding
        if has_position:
            pos = state.positions[symbol]
            if state.cycle - pos.opened_cycle >= 10:
                return self._build(trace_id, symbol, "forced_exit", "close_long" if pos.side == "long" else "close_short", 90.0, "max holding cycles reached", price)

        # fast trend
        momentum = consensus.trend_score / 12.0
        if not has_position and abs(momentum) >= self.cfg.decision.fast_trend_threshold:
            action = "open_long" if momentum > 0 else "open_short"
            conf = min(92.0, 72.0 + abs(momentum) * 4.0)
            return self._build(trace_id, symbol, "fast_trend", action, conf, f"fast momentum {momentum:+.2f}", price)

        # rule / llm (llm placeholder)
        score = (
            consensus.trend_score * 0.45
            + consensus.osc_score * 0.15
            + consensus.sentiment_score * 0.20
            + (consensus.predict_up_prob - 0.5) * 100 * 0.20
        )

        if not has_position:
            if score >= self.cfg.decision.open_threshold:
                return self._build(trace_id, symbol, "rule", "open_long", min(88.0, 60.0 + score * 0.3), f"composite score {score:.2f}", price)
            if score <= -self.cfg.decision.open_threshold:
                return self._build(trace_id, symbol, "rule", "open_short", min(88.0, 60.0 + abs(score) * 0.3), f"composite score {score:.2f}", price)
            return self._build(trace_id, symbol, "rule", "wait", 0.0, f"no edge score={score:.2f}", price)

        # has position: optional close on hard reversal
        pos = state.positions[symbol]
        if pos.side == "long" and score < -35:
            return self._build(trace_id, symbol, "rule", "close_long", 72.0, f"reversal score={score:.2f}", price)
        if pos.side == "short" and score > 35:
            return self._build(trace_id, symbol, "rule", "close_short", 72.0, f"reversal score={score:.2f}", price)
        return self._build(trace_id, symbol, "rule", "hold", 0.0, f"hold score={score:.2f}", price)

    def _build(self, trace_id: str, symbol: str, source: str, action: str, confidence: float, reason: str, price: float) -> ProposedAction:
        return ProposedAction(
            schema_version=SCHEMA_V2,
            trace_id=trace_id,
            symbol=symbol,
            source=source,
            action=action,
            confidence=round(confidence, 4),
            reason=reason,
            order_params={
                "entry_price": price,
                "stop_loss": price * (0.98 if action == "open_long" else 1.02),
                "take_profit": price * (1.04 if action == "open_long" else 0.96),
                "leverage": 3.0,
                "quantity": 0.0,
            },
        )
