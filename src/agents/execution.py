from __future__ import annotations

from agents.base import BaseAgent
from config import RuntimeConfig
from contracts import ExecutionResult, ProposedAction, RiskDecision
from providers.execution import ExecutionProvider, SimExecutionProvider
from state import RuntimeState


class ExecutionPlannerAgent(BaseAgent):
    name = "execution_planner_agent"

    def plan(self, proposal: ProposedAction, risk: RiskDecision, cfg: RuntimeConfig, state: RuntimeState) -> ProposedAction:
        planned = proposal
        if risk.corrections:
            planned.order_params.update(risk.corrections)
        if planned.action in {"close_long", "close_short"} and planned.symbol in state.positions:
            qty = state.positions[planned.symbol].qty
        else:
            entry = float(planned.order_params.get("entry_price", 0) or 0)
            qty = cfg.per_trade_notional / entry if entry > 0 else 0.0
        planned.order_params["quantity"] = qty
        return planned


class ExecutionAgent(BaseAgent):
    name = "execution_agent"

    def __init__(self, provider: ExecutionProvider | None = None) -> None:
        self.provider = provider or SimExecutionProvider()

    def execute(self, *, trace_id: str, planned: ProposedAction, state: RuntimeState) -> ExecutionResult:
        return self.provider.execute(trace_id=trace_id, planned=planned, state=state)
