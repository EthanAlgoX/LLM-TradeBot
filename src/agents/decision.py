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

    def _adaptive_stop_take(
        self, *, action: str, price: float, volatility_pct: float
    ) -> tuple[float, float]:
        """Compute volatility-adaptive stop-loss and take-profit distances.

        The stop distance is the larger of:
          - the configured pct (e.g. 2.5%)
          - volatility × stop_multiplier (e.g. 3% vol × 1.5 = 4.5%)
        Take-profit = stop_distance × RR ratio.
        """
        cfg_d = self.cfg.decision
        vol_stop = volatility_pct / 100.0 * cfg_d.stop_volatility_multiplier

        if action == "open_long":
            stop_dist = max(cfg_d.long_stop_loss_pct, vol_stop)
            take_dist = stop_dist * cfg_d.take_profit_rr_ratio
            stop_loss = price * (1.0 - stop_dist)
            take_profit = price * (1.0 + take_dist)
        elif action == "open_short":
            stop_dist = max(cfg_d.short_stop_loss_pct, vol_stop)
            take_dist = stop_dist * cfg_d.take_profit_rr_ratio
            stop_loss = price * (1.0 + stop_dist)
            take_profit = price * (1.0 - take_dist)
        else:
            stop_loss = 0.0
            take_profit = 0.0

        return stop_loss, take_profit

    def _confidence_leverage(self, confidence: float, state: RuntimeState) -> float:
        """Scale leverage based on signal confidence.

        OPT-4: If reflection hint indicates losses, cap leverage at reflection_leverage_cap.
        """
        hint = (state.reflection_hint or "").lower()
        reduce_leverage = "negative" in hint or "reduce" in hint

        if confidence >= 40.0:
            lev = min(4.0, self.cfg.risk.max_leverage)
        else:
            lev = min(3.0, self.cfg.risk.max_leverage)

        if reduce_leverage:
            lev = min(lev, self.cfg.decision.reflection_leverage_cap)

        return lev

    def _short_momentum_confirms(self, consensus: ConsensusSignal, action: str) -> bool:
        """OPT-2: Check that short-lookback momentum agrees with trade direction."""
        if not self.cfg.decision.require_short_momentum_confirm:
            return True
        if action == "open_long":
            return consensus.momentum_short_pct > 0.0
        if action == "open_short":
            return consensus.momentum_short_pct < 0.0
        return True

    def route(
        self,
        *,
        trace_id: str,
        consensus: ConsensusSignal,
        price: float,
        state: RuntimeState,
        volatility_pct: float = 1.0,
    ) -> ProposedAction:
        symbol = consensus.symbol
        has_position = state.has_position(symbol)

        # forced exit: stale holding
        if has_position:
            pos = state.positions[symbol]
            if state.cycle - pos.opened_cycle >= self.cfg.decision.max_holding_cycles:
                return self._build(
                    trace_id, symbol, "forced_exit",
                    "close_long" if pos.side == "long" else "close_short",
                    90.0, "max holding cycles reached", price, volatility_pct, state,
                )

        # Per-symbol cooldown: skip new opens on recently-lost symbols
        if not has_position and state.is_on_cooldown(symbol):
            return self._build(
                trace_id, symbol, "cooldown", "wait", 0.0,
                f"symbol cooldown until cycle {state.symbol_cooldowns.get(symbol, 0)}",
                price, volatility_pct, state,
            )

        # OPT-7: minimum volatility filter — skip opens in choppy low-vol markets
        min_vol = self.cfg.decision.min_volatility_pct_to_open

        # fast trend
        momentum = consensus.trend_score / 12.0
        effective_threshold = self._effective_open_threshold(state)
        if not has_position:
            open_long = (
                momentum >= self.cfg.decision.fast_trend_threshold
                and consensus.predict_up_prob >= self.cfg.decision.fast_trend_long_min_predict_up_prob
                and consensus.alignment_ok
                and volatility_pct >= min_vol  # OPT-7: vol filter
                and self._short_momentum_confirms(consensus, "open_long")  # OPT-2
            )
            open_short = (
                momentum <= -self.cfg.decision.fast_trend_short_threshold
                and consensus.predict_up_prob <= self.cfg.decision.fast_trend_short_max_predict_up_prob
                and consensus.sentiment_score <= self.cfg.decision.fast_trend_short_max_sentiment
                and consensus.alignment_ok
                and consensus.semantic.get("trigger_stance") == "CONFIRMED"
                and volatility_pct >= min_vol  # OPT-7: vol filter
                and self._short_momentum_confirms(consensus, "open_short")  # OPT-2
            )
            if open_long:
                conf = min(92.0, 72.0 + abs(momentum) * 5.0)
                return self._build(
                    trace_id, symbol, "fast_trend", "open_long", conf,
                    f"fast momentum {momentum:+.2f}", price, volatility_pct, state,
                )
            if open_short:
                conf = min(90.0, 70.0 + abs(momentum) * 5.0)
                return self._build(
                    trace_id, symbol, "fast_trend", "open_short", conf,
                    f"fast momentum {momentum:+.2f}", price, volatility_pct, state,
                )

        # rule / llm (llm placeholder)
        score = (
            consensus.trend_score * 0.45
            + consensus.osc_score * 0.15
            + consensus.sentiment_score * 0.20
            + (consensus.predict_up_prob - 0.5) * 100 * 0.20
        )

        if not has_position:
            if score >= effective_threshold and volatility_pct >= min_vol:
                if self._short_momentum_confirms(consensus, "open_long"):
                    return self._build(
                        trace_id, symbol, "rule", "open_long",
                        min(88.0, 60.0 + score * 0.3),
                        f"composite score {score:.2f}", price, volatility_pct, state,
                    )
            if score <= -100.0 and volatility_pct >= min_vol:
                # Extra guards for rule-based shorts: require negative sentiment and low predict_up
                if (consensus.sentiment_score <= self.cfg.decision.fast_trend_short_max_sentiment
                        and consensus.predict_up_prob <= self.cfg.decision.fast_trend_short_max_predict_up_prob
                        and self._short_momentum_confirms(consensus, "open_short")):
                    return self._build(
                        trace_id, symbol, "rule", "open_short",
                        min(88.0, 60.0 + abs(score) * 0.3),
                        f"composite score {score:.2f}", price, volatility_pct, state,
                    )
            return self._build(
                trace_id, symbol, "rule", "wait", 0.0,
                f"no edge score={score:.2f}", price, volatility_pct, state,
            )

        # has position: optional close on hard reversal
        pos = state.positions[symbol]
        if pos.side == "long" and score < self.cfg.decision.long_reversal_close_score:
            return self._build(
                trace_id, symbol, "rule", "close_long", 72.0,
                f"reversal score={score:.2f}", price, volatility_pct, state,
            )
        if pos.side == "short" and score > self.cfg.decision.short_reversal_close_score:
            return self._build(
                trace_id, symbol, "rule", "close_short", 72.0,
                f"reversal score={score:.2f}", price, volatility_pct, state,
            )
        return self._build(
            trace_id, symbol, "rule", "hold", 0.0,
            f"hold score={score:.2f}", price, volatility_pct, state,
        )

    def _build(
        self,
        trace_id: str,
        symbol: str,
        source: str,
        action: str,
        confidence: float,
        reason: str,
        price: float,
        volatility_pct: float = 1.0,
        state: RuntimeState | None = None,
    ) -> ProposedAction:
        if action in {"open_long", "open_short"}:
            stop_loss, take_profit = self._adaptive_stop_take(
                action=action, price=price, volatility_pct=volatility_pct,
            )
            leverage = self._confidence_leverage(confidence, state) if state else self._confidence_leverage(confidence, RuntimeState())
        elif action in {"close_long", "close_short"}:
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
                "volatility_pct": volatility_pct,  # OPT-6: pass vol for adaptive sizing
            },
        )
