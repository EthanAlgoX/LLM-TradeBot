from __future__ import annotations

import copy
from dataclasses import asdict
from typing import Any

from agents.base import BaseAgent
from config import RuntimeConfig
from contracts import ExecutionResult, ProposedAction, RiskDecision, SCHEMA_V2
from providers.execution import ExecutionProvider, SimExecutionProvider
from state import ReconciliationReportRecord, RuntimeState


class ExecutionPlannerAgent(BaseAgent):
    name = "execution_planner_agent"

    def _calculate_position_size(self, notional: float, entry_price: float, leverage: float, available_cash: float) -> float:
        if entry_price <= 0 or leverage <= 0:
            return 0.0
        # The target position nominal value is simply 'notional'.
        # We must ensure we have enough margin to support this notional at the given leverage.
        max_possible_notional_from_cash = available_cash * leverage
        actual_notional = min(notional, max_possible_notional_from_cash)
        return actual_notional / entry_price

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
        self._last_resolution_records: list[dict[str, Any]] = []

    @staticmethod
    def _desired_order_profile(action: str) -> tuple[str | None, bool | None]:
        if action == "open_long":
            return "BUY", False
        if action == "open_short":
            return "SELL", False
        if action == "close_long":
            return "SELL", True
        if action == "close_short":
            return "BUY", True
        return None, None

    def conflicts_with_active_order(self, *, planned: ProposedAction, state: RuntimeState) -> bool:
        active_order = state.get_active_order(planned.symbol)
        if active_order is None:
            return False
        desired_side, desired_reduce_only = self._desired_order_profile(planned.action)
        if desired_side is None:
            return False
        return desired_side != active_order.side or desired_reduce_only != active_order.reduce_only

    def _build_cancel_order_action(self, *, trace_id: str, planned: ProposedAction, state: RuntimeState) -> ProposedAction | None:
        active_order = state.get_active_order(planned.symbol)
        if active_order is None:
            return None
        return ProposedAction(
            schema_version=SCHEMA_V2,
            trace_id=trace_id,
            symbol=planned.symbol,
            source="pending_order_guard",
            action="cancel_order",
            confidence=100.0,
            reason=f"cancel conflicting active order {active_order.exchange_order_id}",
            order_params={
                "entry_price": active_order.requested_price,
                "quantity": 0.0,
                "leverage": 1.0,
                "exchange_order_id": active_order.exchange_order_id,
            },
        )

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
        if planned.action not in {"wait", "hold", "cancel_order"} and state.has_pending_order(planned.symbol):
            return ExecutionResult(
                schema_version="v2",
                trace_id=trace_id,
                symbol=planned.symbol,
                action=planned.action,
                status="failed",
                message="pending exchange order exists for symbol",
            )
        return self.provider.execute(trace_id=trace_id, planned=planned, state=state)

    def execute_with_pending_order_resolution(
        self,
        *,
        trace_id: str,
        planned: ProposedAction,
        state: RuntimeState,
        cfg: RuntimeConfig,
    ) -> ExecutionResult:
        self._last_resolution_records = []
        if (
            planned.action not in {"wait", "hold", "cancel_order"}
            and cfg.execution_auto_cancel_conflicting_pending_orders
            and self.conflicts_with_active_order(planned=planned, state=state)
        ):
            cancel_action = self._build_cancel_order_action(trace_id=trace_id, planned=planned, state=state)
            if cancel_action is not None:
                cancel_result = self.execute(trace_id=trace_id, planned=cancel_action, state=state)
                self._last_resolution_records.append(
                    {
                        "kind": "cancel_conflicting_pending_order",
                        "symbol": planned.symbol,
                        "planned_action": planned.action,
                        "resolution_action": asdict(cancel_action),
                        "resolution_result": asdict(cancel_result),
                    }
                )
                if cancel_result.status != "success":
                    return ExecutionResult(
                        schema_version=SCHEMA_V2,
                        trace_id=trace_id,
                        symbol=planned.symbol,
                        action=planned.action,
                        status="failed",
                        message=f"failed to cancel conflicting pending order: {cancel_result.message}",
                    )
        return self.execute(trace_id=trace_id, planned=planned, state=state)

    def consume_resolution_records(self) -> list[dict[str, Any]]:
        records = list(self._last_resolution_records)
        self._last_resolution_records = []
        return records

    def reconcile(self, *, trace_id: str, state: RuntimeState) -> ReconciliationReportRecord:
        return self.provider.reconcile(trace_id=trace_id, state=state)

    def repair(self, *, trace_id: str, state: RuntimeState, reconciliation: ReconciliationReportRecord) -> ReconciliationReportRecord:
        return self.provider.repair(trace_id=trace_id, state=state, reconciliation=reconciliation)
