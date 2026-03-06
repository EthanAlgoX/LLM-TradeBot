from __future__ import annotations

import copy

from agents.base import BaseAgent
from config import RuntimeConfig
from contracts import ExecutionResult, ProposedAction, RiskDecision
from providers.execution import ExecutionProvider, SimExecutionProvider
from state import RuntimeState


class ExecutionPlannerAgent(BaseAgent):
    name = "execution_planner_agent"

    def _calculate_position_size(self, notional: float, entry_price: float, leverage: float, available_cash: float) -> float:
        if entry_price <= 0 or leverage <= 0:
            return 0.0
        max_notional = min(notional, available_cash * leverage)
        return max_notional / entry_price

    def plan(self, proposal: ProposedAction, risk: RiskDecision, cfg: RuntimeConfig, state: RuntimeState) -> ProposedAction:
        # Deep copy to avoid mutating the original proposal that may be referenced upstream
        planned = copy.deepcopy(proposal)
        if risk.corrections:
            planned.order_params.update(risk.corrections)

        leverage = float(planned.order_params.get("leverage", 1.0) or 1.0)

        if planned.action in {"close_long", "close_short"} and planned.symbol in state.positions:
            qty = state.positions[planned.symbol].qty
        elif planned.action in {"open_long", "open_short"}:
            entry = float(planned.order_params.get("entry_price", 0) or 0)
            notional = float(cfg.per_trade_notional)

            # OPT-6: volatility-adaptive sizing — scale notional down when vol is high
            if cfg.backtest.vol_adaptive_sizing_enabled:
                vol_pct = float(planned.order_params.get("volatility_pct", 0) or 0)
                base_vol = cfg.backtest.vol_adaptive_base_vol_pct
                if vol_pct > base_vol and base_vol > 0:
                    scale = base_vol / vol_pct  # e.g. 2% / 4% = 0.5x
                    notional *= max(0.3, scale)  # floor at 30% of normal notional

            available_margin = state.cash
            qty = self._calculate_position_size(notional, entry, leverage, available_margin)
        else:
            qty = 0.0

        planned.order_params["quantity"] = qty
        return planned


class ExecutionAgent(BaseAgent):
    name = "execution_agent"

    def __init__(self, provider: ExecutionProvider | None = None) -> None:
        self.provider = provider or SimExecutionProvider()

    def execute(self, *, trace_id: str, planned: ProposedAction, state: RuntimeState) -> ExecutionResult:
        # Pre-execution cash guard: reject if cash is already depleted
        if state.cash <= 0 and planned.action in {"open_long", "open_short"}:
            return ExecutionResult(
                schema_version="v2",
                trace_id=trace_id,
                symbol=planned.symbol,
                action=planned.action,
                status="failed",
                message="cash depleted, cannot open new position",
            )
        return self.provider.execute(trace_id=trace_id, planned=planned, state=state)
