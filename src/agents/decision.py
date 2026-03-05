from __future__ import annotations

from agents.base import BaseAgent
from config import RuntimeConfig
from contracts import ConsensusSignal, ProposedAction, SCHEMA_V2
from state import RuntimeState


class DecisionRouterAgent(BaseAgent):
    name = "decision_router_agent"

    def __init__(self, cfg: RuntimeConfig) -> None:
        self.cfg = cfg

    def _effective_open_threshold(self, state: RuntimeState) -> float:
        """Raise the open threshold when recent reflection indicates losses."""
        base = self.cfg.decision.open_threshold
        hint = (state.reflection_hint or "").lower()
        if "negative" in hint or "reduce" in hint:
            return base + self.cfg.decision.loss_cooldown_threshold_boost
        return base

    def route(self, *, trace_id: str, consensus: ConsensusSignal, price: float, state: RuntimeState) -> ProposedAction:
        symbol = consensus.symbol
        has_position = state.has_position(symbol)

        # forced exit: stale holding
        if has_position:
            pos = state.positions[symbol]
            if state.cycle - pos.opened_cycle >= self.cfg.decision.max_holding_cycles:
                return self._build(trace_id, symbol, "forced_exit", "close_long" if pos.side == "long" else "close_short", 90.0, "max holding cycles reached", price)

        # fast trend
        momentum = consensus.trend_score / 12.0
        effective_threshold = self._effective_open_threshold(state)
        if not has_position:
            open_long = (
                momentum >= self.cfg.decision.fast_trend_threshold
                and consensus.predict_up_prob >= self.cfg.decision.fast_trend_long_min_predict_up_prob
                and consensus.alignment_ok
            )
            open_short = (
                momentum <= -self.cfg.decision.fast_trend_short_threshold
                and consensus.predict_up_prob <= self.cfg.decision.fast_trend_short_max_predict_up_prob
                and consensus.sentiment_score <= self.cfg.decision.fast_trend_short_max_sentiment
                and consensus.alignment_ok
                and consensus.semantic.get("trigger_stance") == "CONFIRMED"
            )
            if open_long:
                conf = min(92.0, 72.0 + abs(momentum) * 4.0)
                return self._build(trace_id, symbol, "fast_trend", "open_long", conf, f"fast momentum {momentum:+.2f}", price)
            if open_short:
                conf = min(90.0, 70.0 + abs(momentum) * 4.0)
                return self._build(trace_id, symbol, "fast_trend", "open_short", conf, f"fast momentum {momentum:+.2f}", price)

        # rule / llm (llm placeholder)
        score = (
            consensus.trend_score * 0.45
            + consensus.osc_score * 0.15
            + consensus.sentiment_score * 0.20
            + (consensus.predict_up_prob - 0.5) * 100 * 0.20
        )

        if not has_position:
            if score >= effective_threshold:
                return self._build(trace_id, symbol, "rule", "open_long", min(88.0, 60.0 + score * 0.3), f"composite score {score:.2f}", price)
            if score <= -effective_threshold:
                return self._build(trace_id, symbol, "rule", "open_short", min(88.0, 60.0 + abs(score) * 0.3), f"composite score {score:.2f}", price)
            return self._build(trace_id, symbol, "rule", "wait", 0.0, f"no edge score={score:.2f}", price)

        # has position: optional close on hard reversal
        pos = state.positions[symbol]
        if pos.side == "long" and score < self.cfg.decision.long_reversal_close_score:
            return self._build(trace_id, symbol, "rule", "close_long", 72.0, f"reversal score={score:.2f}", price)
        if pos.side == "short" and score > self.cfg.decision.short_reversal_close_score:
            return self._build(trace_id, symbol, "rule", "close_short", 72.0, f"reversal score={score:.2f}", price)
        return self._build(trace_id, symbol, "rule", "hold", 0.0, f"hold score={score:.2f}", price)

    def _build(self, trace_id: str, symbol: str, source: str, action: str, confidence: float, reason: str, price: float) -> ProposedAction:
        cfg_d = self.cfg.decision

        if action == "open_long":
            stop_loss = price * (1.0 - cfg_d.long_stop_loss_pct)
            take_profit = price * (1.0 + cfg_d.long_take_profit_pct)
            leverage = 3.0
        elif action == "open_short":
            stop_loss = price * (1.0 + cfg_d.short_stop_loss_pct)
            take_profit = price * (1.0 - cfg_d.short_take_profit_pct)
            leverage = 2.5
        elif action in {"close_long", "close_short"}:
            # Close actions do not need stop/take; set to 0 to skip R:R checks.
            stop_loss = 0.0
            take_profit = 0.0
            leverage = 1.0
        else:
            stop_loss = 0.0
            take_profit = 0.0
            leverage = 1.0

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
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "leverage": leverage,
                "quantity": 0.0,
            },
        )
