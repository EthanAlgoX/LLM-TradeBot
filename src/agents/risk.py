from __future__ import annotations

from agents.base import BaseAgent
from config import RuntimeConfig
from contracts import ProposedAction, RiskDecision, SCHEMA_V2
from state import RuntimeState


class RiskAuditAgent(BaseAgent):
    name = "risk_audit_agent"

    def __init__(self, cfg: RuntimeConfig) -> None:
        self.cfg = cfg

    def _compute_equity(self, state: RuntimeState) -> float:
        """Compute mark-to-market equity: cash + locked margin + leveraged unrealized PnL."""
        equity = state.cash
        for symbol, pos in state.positions.items():
            current_price = state.prices.get(symbol, pos.entry_price)
            sign = 1.0 if pos.side == "long" else -1.0
            margin = abs(pos.entry_price * pos.qty) / pos.leverage if pos.leverage > 0 else abs(pos.entry_price * pos.qty)
            unrealized_pnl = (current_price - pos.entry_price) * pos.qty * sign
            equity += margin + unrealized_pnl
        return equity

    def _get_position_notional(self, symbol: str, entry: float, qty: float, leverage: float) -> float:
        return abs(entry * qty)  # Position notional is simply asset value; leverage dictates margin requirement

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

        # Account-level drawdown circuit breaker (based on equity, not cash)
        equity = self._compute_equity(state)
        drawdown_pct = (self.cfg.initial_cash - equity) / self.cfg.initial_cash * 100.0 if self.cfg.initial_cash > 0 else 0.0
        if drawdown_pct >= self.cfg.risk.max_drawdown_pct:
            return RiskDecision(
                SCHEMA_V2, trace_id, symbol, False, "fatal",
                f"account drawdown {drawdown_pct:.2f}% >= {self.cfg.risk.max_drawdown_pct}% circuit breaker",
            )

        corrections: dict[str, float] = {}
        warnings: list[str] = []

        lev = float(params.get("leverage", 1.0) or 1.0)
        if lev > self.cfg.risk.max_leverage:
            return RiskDecision(SCHEMA_V2, trace_id, symbol, False, "fatal", f"leverage {lev} > {self.cfg.risk.max_leverage}")

        entry = float(params.get("entry_price", 0) or 0)
        stop = float(params.get("stop_loss", 0) or 0)
        take = float(params.get("take_profit", 0) or 0)
        notional = float(self.cfg.per_trade_notional)

        # Compute leveraged position notional for the new position
        qty = notional / entry if entry > 0 else 0
        position_notional = self._get_position_notional(symbol, entry, qty, lev)
        required_margin = position_notional / lev if lev > 0 else position_notional

        # state.cash is the *unlocked* free cash (margin has already been deducted for existing trades).
        # We only need to check if the newly required margin exceeds the remaining unlocked cash.
        if required_margin > state.cash:
            return RiskDecision(
                SCHEMA_V2, trace_id, symbol, False, "fatal",
                f"insufficient margin: required {required_margin:.2f}, available {state.cash:.2f}",
            )

        # Check individual position notional limit (leveraged notional)
        if position_notional > self.cfg.risk.max_position_notional:
            return RiskDecision(
                SCHEMA_V2, trace_id, symbol, False, "fatal",
                f"position notional {position_notional:.2f} exceeds max {self.cfg.risk.max_position_notional}",
            )

        # Check total portfolio notional exposure
        total_notional = sum(abs(pos.entry_price * pos.qty) for pos in state.positions.values())
        total_notional += position_notional
        max_total_notional = self.cfg.risk.max_concurrent_positions * self.cfg.risk.max_position_notional
        if total_notional > max_total_notional:
            warnings.append(f"total notional {total_notional:.2f} approaching limit {max_total_notional}")

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

        # Per-trade max loss guard: worst-case loss at stop must not exceed max_loss_per_trade_pct of equity
        worst_case_loss = risk * qty
        max_allowed_loss = equity * self.cfg.risk.max_loss_per_trade_pct / 100.0
        if worst_case_loss > max_allowed_loss:
            if self.cfg.risk.hard_block_max_loss:
                # OPT-5: hard block — reject the trade outright
                return RiskDecision(
                    SCHEMA_V2, trace_id, symbol, False, "danger",
                    f"worst-case loss {worst_case_loss:.2f} exceeds {self.cfg.risk.max_loss_per_trade_pct}% equity limit {max_allowed_loss:.2f}",
                )
            warnings.append(
                f"worst-case loss {worst_case_loss:.2f} exceeds {self.cfg.risk.max_loss_per_trade_pct}% equity limit {max_allowed_loss:.2f}"
            )

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
