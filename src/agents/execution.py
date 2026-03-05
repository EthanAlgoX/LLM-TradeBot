from __future__ import annotations

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
        planned = proposal
        if risk.corrections:
            planned.order_params.update(risk.corrections)

        leverage = float(planned.order_params.get("leverage", 1.0) or 1.0)

        if planned.action in {"close_long", "close_short"} and planned.symbol in state.positions:
            qty = state.positions[planned.symbol].qty
        elif planned.action in {"open_long", "open_short"}:
            entry = float(planned.order_params.get("entry_price", 0) or 0)
            notional = float(cfg.per_trade_notional)
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
        return self.provider.execute(trace_id=trace_id, planned=planned, state=state)
