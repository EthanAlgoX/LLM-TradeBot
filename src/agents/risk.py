from __future__ import annotations

from agents.base import BaseAgent
from config import RuntimeConfig
from contracts import ProposedAction, RiskDecision, SCHEMA_V2
from state import RuntimeState


class RiskAuditAgent(BaseAgent):
    name = "risk_audit_agent"

    def __init__(self, cfg: RuntimeConfig) -> None:
        self.cfg = cfg

    def audit(self, *, trace_id: str, proposal: ProposedAction, state: RuntimeState) -> RiskDecision:
        action = proposal.action
        params = proposal.order_params
        symbol = proposal.symbol

        if action in {"wait", "hold"}:
            return RiskDecision(SCHEMA_V2, trace_id, symbol, True, "safe", None)

        if action in {"close_long", "close_short"}:
            if symbol not in state.positions:
                return RiskDecision(SCHEMA_V2, trace_id, symbol, False, "fatal", "close requested but no position")
            return RiskDecision(SCHEMA_V2, trace_id, symbol, True, "safe", None)

        # --- Open action checks below ---

        # Max concurrent positions check
        if len(state.positions) >= self.cfg.risk.max_concurrent_positions:
            return RiskDecision(
                SCHEMA_V2, trace_id, symbol, False, "fatal",
                f"concurrent positions {len(state.positions)} >= {self.cfg.risk.max_concurrent_positions}",
            )

        # Account-level drawdown circuit breaker
        drawdown_pct = (self.cfg.initial_cash - state.cash) / self.cfg.initial_cash * 100.0 if self.cfg.initial_cash > 0 else 0.0
        if drawdown_pct >= self.cfg.risk.max_drawdown_pct:
            return RiskDecision(
                SCHEMA_V2, trace_id, symbol, False, "fatal",
                f"account drawdown {drawdown_pct:.2f}% >= {self.cfg.risk.max_drawdown_pct}% circuit breaker",
            )

        lev = float(params.get("leverage", 1.0) or 1.0)
        if lev > self.cfg.risk.max_leverage:
            return RiskDecision(SCHEMA_V2, trace_id, symbol, False, "fatal", f"leverage {lev} > {self.cfg.risk.max_leverage}")

        entry = float(params.get("entry_price", 0) or 0)
        stop = float(params.get("stop_loss", 0) or 0)
        take = float(params.get("take_profit", 0) or 0)
        notional = float(self.cfg.per_trade_notional)

        if notional > self.cfg.risk.max_position_notional:
            return RiskDecision(SCHEMA_V2, trace_id, symbol, False, "fatal", "position notional exceeds cap")

        corrections: dict[str, float] = {}
        warnings: list[str] = []

        if action == "open_long" and stop >= entry:
            corrected = entry * 0.985
            corrections["stop_loss"] = corrected
            stop = corrected
            warnings.append("stop loss corrected for long")
        if action == "open_short" and stop <= entry:
            corrected = entry * 1.015
            corrections["stop_loss"] = corrected
            stop = corrected
            warnings.append("stop loss corrected for short")

        risk = abs(entry - stop)
        reward = abs(take - entry)
        if risk <= 0:
            return RiskDecision(SCHEMA_V2, trace_id, symbol, False, "fatal", "invalid stop loss distance")
        rr = reward / risk
        if rr < self.cfg.risk.min_rr:
            return RiskDecision(SCHEMA_V2, trace_id, symbol, False, "danger", f"rr {rr:.2f} < {self.cfg.risk.min_rr}")

        return RiskDecision(
            schema_version=SCHEMA_V2,
            trace_id=trace_id,
            symbol=symbol,
            passed=True,
            risk_level="warning" if warnings else "safe",
            blocked_reason=None,
            corrections=corrections,
            warnings=warnings,
        )
