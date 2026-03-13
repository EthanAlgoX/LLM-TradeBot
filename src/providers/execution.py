from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from providers.binance_rules import (
    BinanceFuturesRulesProvider,
    BinanceSymbolRules,
    format_quantity,
    quantize_quantity,
)
from contracts import ExecutionResult, ProposedAction, SCHEMA_V2
from state import (
    ExchangeOrderRecord,
    ExecutionReportRecord,
    FillRecord,
    OrderIntentRecord,
    Position,
    ReconciliationReportRecord,
    RuntimeState,
    TradeRecord,
)


class ExecutionProvider:
    def execute(self, *, trace_id: str, planned: ProposedAction, state: RuntimeState) -> ExecutionResult:
        raise NotImplementedError

    def reconcile(self, *, trace_id: str, state: RuntimeState) -> ReconciliationReportRecord:
        raise NotImplementedError

    def repair(self, *, trace_id: str, state: RuntimeState, reconciliation: ReconciliationReportRecord) -> ReconciliationReportRecord:
        return reconciliation


def _build_position_from_proposal(planned: ProposedAction, *, side: str, qty: float, entry_price: float, leverage: float, opened_cycle: int) -> Position:
    return Position(
        symbol=planned.symbol,
        side=side,
        qty=qty,
        entry_price=entry_price,
        leverage=leverage,
        opened_cycle=opened_cycle,
        stop_loss=float(planned.order_params.get("stop_loss", 0.0) or 0.0),
        take_profit=float(planned.order_params.get("take_profit", 0.0) or 0.0),
        entry_source=planned.source,
        entry_confidence=float(planned.confidence),
        entry_reason=planned.reason,
    )


def append_execution_report(
    *,
    state: RuntimeState,
    trace_id: str,
    planned: ProposedAction,
    status: str,
    provider: str,
    requested_qty: float,
    filled_qty: float,
    requested_price: float,
    fill_price: float | None,
    message: str,
    reduce_only: bool = False,
    exchange_order_id: str = "",
) -> None:
    state.execution_reports.append(
        ExecutionReportRecord(
            trace_id=trace_id,
            cycle=state.cycle,
            symbol=planned.symbol,
            action=planned.action,
            requested_qty=requested_qty,
            filled_qty=filled_qty,
            requested_price=requested_price,
            fill_price=fill_price,
            status=status,
            provider=provider,
            reduce_only=reduce_only,
            exchange_order_id=exchange_order_id,
            message=message,
            source=planned.source,
            confidence=planned.confidence,
            reason=planned.reason,
        )
    )


def append_exchange_order(
    *,
    state: RuntimeState,
    trace_id: str,
    planned: ProposedAction,
    status: str,
    provider: str,
    requested_qty: float,
    executed_qty: float,
    requested_price: float,
    avg_price: float | None,
    side: str,
    order_type: str = "MARKET",
    reduce_only: bool = False,
    is_active: bool = False,
    exchange_order_id: str = "",
    message: str = "",
) -> str:
    order_id = exchange_order_id or f"{provider}:{trace_id}:{state.cycle}:{len(state.exchange_orders)}"
    history = [status] if status else []
    state.exchange_orders.append(
        ExchangeOrderRecord(
            trace_id=trace_id,
            cycle=state.cycle,
            symbol=planned.symbol,
            action=planned.action,
            requested_qty=requested_qty,
            executed_qty=executed_qty,
            requested_price=requested_price,
            avg_price=avg_price,
            status=status,
            provider=provider,
            reduce_only=reduce_only,
            is_active=is_active,
            exchange_order_id=order_id,
            side=side,
            order_type=order_type,
            message=message,
            status_history=history,
            source=planned.source,
            confidence=planned.confidence,
            reason=planned.reason,
        )
    )
    return order_id


def update_exchange_order(
    *,
    state: RuntimeState,
    exchange_order_id: str,
    status: str | None = None,
    executed_qty: float | None = None,
    avg_price: float | None = None,
    message: str | None = None,
    is_active: bool | None = None,
    exchange_order_id_override: str | None = None,
) -> str:
    for order in reversed(state.exchange_orders):
        if order.exchange_order_id != exchange_order_id:
            continue
        if status is not None:
            order.status = status
            if not order.status_history or order.status_history[-1] != status:
                order.status_history.append(status)
        if executed_qty is not None:
            order.executed_qty = executed_qty
        if avg_price is not None:
            order.avg_price = avg_price
        if message is not None:
            order.message = message
        if is_active is not None:
            order.is_active = is_active
        if exchange_order_id_override and exchange_order_id_override != order.exchange_order_id:
            order.exchange_order_id = exchange_order_id_override
            return exchange_order_id_override
        return order.exchange_order_id
    raise KeyError(f"exchange order not found: {exchange_order_id}")


def append_order_intent(
    *,
    state: RuntimeState,
    trace_id: str,
    planned: ProposedAction,
    provider: str,
    requested_qty: float,
    requested_price: float,
    leverage: float,
    reduce_only: bool = False,
) -> None:
    state.order_intents.append(
        OrderIntentRecord(
            trace_id=trace_id,
            cycle=state.cycle,
            symbol=planned.symbol,
            action=planned.action,
            requested_qty=requested_qty,
            requested_price=requested_price,
            leverage=leverage,
            reduce_only=reduce_only,
            provider=provider,
            source=planned.source,
            confidence=planned.confidence,
            reason=planned.reason,
        )
    )


def append_fill(
    *,
    state: RuntimeState,
    trace_id: str,
    symbol: str,
    action: str,
    qty: float,
    price: float,
    fee: float,
    provider: str,
    exchange_order_id: str = "",
    liquidity: str = "",
    reduce_only: bool = False,
    message: str = "",
) -> None:
    state.fills.append(
        FillRecord(
            trace_id=trace_id,
            cycle=state.cycle,
            symbol=symbol,
            action=action,
            qty=qty,
            price=price,
            fee=fee,
            provider=provider,
            exchange_order_id=exchange_order_id,
            liquidity=liquidity,
            reduce_only=reduce_only,
            message=message,
        )
    )


def _position_qty_map(state: RuntimeState) -> dict[str, float]:
    out: dict[str, float] = {}
    for symbol, pos in state.positions.items():
        signed_qty = float(pos.qty) if pos.side == "long" else -float(pos.qty)
        out[symbol] = signed_qty
    return out


def _local_order_status_map(state: RuntimeState, *, provider: str) -> dict[str, str]:
    statuses: dict[str, str] = {}
    for order in state.exchange_orders:
        if order.provider != provider or not order.exchange_order_id:
            continue
        statuses[order.exchange_order_id] = order.status
    return statuses


def _find_active_exchange_order(
    state: RuntimeState,
    *,
    symbol: str,
    provider: str,
    exchange_order_id: str = "",
) -> ExchangeOrderRecord | None:
    for order in reversed(state.exchange_orders):
        if order.provider != provider or order.symbol != symbol or not order.is_active:
            continue
        if exchange_order_id and order.exchange_order_id != exchange_order_id:
            continue
        return order
    return None


def _synthetic_exchange_order_id(*, provider: str, trace_id: str, state: RuntimeState) -> str:
    return f"{provider}:{trace_id}:{state.cycle}:{len(state.exchange_orders)}"


def append_reconciliation_report(state: RuntimeState, report: ReconciliationReportRecord) -> ReconciliationReportRecord:
    state.reconciliation_reports.append(report)
    return report


class SimExecutionProvider(ExecutionProvider):
    FEE_BPS = 3.0
    PROVIDER_NAME = "sim"

    def execute(self, *, trace_id: str, planned: ProposedAction, state: RuntimeState) -> ExecutionResult:
        symbol = planned.symbol
        action = planned.action
        price = float(planned.order_params.get("entry_price", 0) or 0)
        qty = float(planned.order_params.get("quantity", 0) or 0)
        lev = float(planned.order_params.get("leverage", 1.0) or 1.0)
        append_order_intent(
            state=state,
            trace_id=trace_id,
            planned=planned,
            provider=self.PROVIDER_NAME,
            requested_qty=qty,
            requested_price=price,
            leverage=lev,
            reduce_only=action in {"close_long", "close_short"},
        )

        if action == "cancel_order":
            requested_order_id = str(planned.order_params.get("exchange_order_id", "") or "")
            active_order = _find_active_exchange_order(
                state,
                symbol=symbol,
                provider=self.PROVIDER_NAME,
                exchange_order_id=requested_order_id,
            )
            if active_order is None:
                message = "no active order"
                append_execution_report(
                    state=state,
                    trace_id=trace_id,
                    planned=planned,
                    status="failed",
                    provider=self.PROVIDER_NAME,
                    requested_qty=0.0,
                    filled_qty=0.0,
                    requested_price=price,
                    fill_price=None,
                    message=message,
                    exchange_order_id=requested_order_id,
                )
                return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", message)
            update_exchange_order(
                state=state,
                exchange_order_id=active_order.exchange_order_id,
                status="CANCELED",
                message="local active order canceled",
                is_active=False,
            )
            message = "active order canceled"
            append_execution_report(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="success",
                provider=self.PROVIDER_NAME,
                requested_qty=active_order.requested_qty,
                filled_qty=active_order.executed_qty,
                requested_price=active_order.requested_price,
                fill_price=active_order.avg_price,
                message=message,
                exchange_order_id=active_order.exchange_order_id,
            )
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", message, active_order.avg_price)

        if action in {"wait", "hold"}:
            message = "passive action"
            append_execution_report(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="skipped",
                provider=self.PROVIDER_NAME,
                requested_qty=qty,
                filled_qty=0.0,
                requested_price=price,
                fill_price=None,
                message=message,
                reduce_only=action in {"close_long", "close_short"},
            )
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "skipped", message)

        if action == "open_long":
            margin_required = abs(price * qty) / lev if lev > 0 else abs(price * qty)
            fee = abs(price * qty) * self.FEE_BPS / 10_000.0
            total_required = margin_required + fee
            if total_required > state.cash:
                message = f"insufficient margin: need {total_required:.2f}, have {state.cash:.2f}"
                append_execution_report(
                    state=state,
                    trace_id=trace_id,
                    planned=planned,
                    status="failed",
                    provider=self.PROVIDER_NAME,
                    requested_qty=qty,
                    filled_qty=0.0,
                    requested_price=price,
                    fill_price=None,
                    message=message,
                )
                return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", message, price)
            state.cash -= margin_required
            state.positions[symbol] = _build_position_from_proposal(
                planned,
                side="long",
                qty=qty,
                entry_price=price,
                leverage=lev,
                opened_cycle=state.cycle,
            )
            state.cash -= fee
            state.trades.append(
                TradeRecord(
                    cycle=state.cycle,
                    symbol=symbol,
                    action=action,
                    qty=qty,
                    price=price,
                    pnl=0.0,
                    realized_pnl=0.0,
                    fee=fee,
                    event_type="open",
                    source=planned.source,
                    confidence=planned.confidence,
                    reason=planned.reason,
                )
            )
            exchange_order_id = append_exchange_order(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="SUBMITTED",
                provider=self.PROVIDER_NAME,
                requested_qty=qty,
                executed_qty=0.0,
                requested_price=price,
                avg_price=None,
                side="BUY",
                is_active=True,
                message="sim market order submitted",
            )
            update_exchange_order(
                state=state,
                exchange_order_id=exchange_order_id,
                status="FILLED",
                executed_qty=qty,
                avg_price=price,
                message="sim market order filled",
                is_active=False,
            )
            append_fill(
                state=state,
                trace_id=trace_id,
                symbol=symbol,
                action=action,
                qty=qty,
                price=price,
                fee=fee,
                provider=self.PROVIDER_NAME,
                exchange_order_id=exchange_order_id,
                liquidity="taker",
                message="sim open fill",
            )
            message = f"long opened margin={margin_required:.2f}"
            append_execution_report(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="success",
                provider=self.PROVIDER_NAME,
                requested_qty=qty,
                filled_qty=qty,
                requested_price=price,
                fill_price=price,
                message=message,
                exchange_order_id=exchange_order_id,
            )
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", message, price)

        if action == "open_short":
            margin_required = abs(price * qty) / lev if lev > 0 else abs(price * qty)
            fee = abs(price * qty) * self.FEE_BPS / 10_000.0
            total_required = margin_required + fee
            if total_required > state.cash:
                message = f"insufficient margin: need {total_required:.2f}, have {state.cash:.2f}"
                append_execution_report(
                    state=state,
                    trace_id=trace_id,
                    planned=planned,
                    status="failed",
                    provider=self.PROVIDER_NAME,
                    requested_qty=qty,
                    filled_qty=0.0,
                    requested_price=price,
                    fill_price=None,
                    message=message,
                )
                return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", message, price)
            state.cash -= margin_required
            state.positions[symbol] = _build_position_from_proposal(
                planned,
                side="short",
                qty=qty,
                entry_price=price,
                leverage=lev,
                opened_cycle=state.cycle,
            )
            state.cash -= fee
            state.trades.append(
                TradeRecord(
                    cycle=state.cycle,
                    symbol=symbol,
                    action=action,
                    qty=qty,
                    price=price,
                    pnl=0.0,
                    realized_pnl=0.0,
                    fee=fee,
                    event_type="open",
                    source=planned.source,
                    confidence=planned.confidence,
                    reason=planned.reason,
                )
            )
            exchange_order_id = append_exchange_order(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="SUBMITTED",
                provider=self.PROVIDER_NAME,
                requested_qty=qty,
                executed_qty=0.0,
                requested_price=price,
                avg_price=None,
                side="SELL",
                is_active=True,
                message="sim market order submitted",
            )
            update_exchange_order(
                state=state,
                exchange_order_id=exchange_order_id,
                status="FILLED",
                executed_qty=qty,
                avg_price=price,
                message="sim market order filled",
                is_active=False,
            )
            append_fill(
                state=state,
                trace_id=trace_id,
                symbol=symbol,
                action=action,
                qty=qty,
                price=price,
                fee=fee,
                provider=self.PROVIDER_NAME,
                exchange_order_id=exchange_order_id,
                liquidity="taker",
                message="sim open fill",
            )
            message = f"short opened margin={margin_required:.2f}"
            append_execution_report(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="success",
                provider=self.PROVIDER_NAME,
                requested_qty=qty,
                filled_qty=qty,
                requested_price=price,
                fill_price=price,
                message=message,
                exchange_order_id=exchange_order_id,
            )
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", message, price)

        if action in {"close_long", "close_short"}:
            pos = state.positions.get(symbol)
            if not pos:
                message = "no position"
                append_execution_report(
                    state=state,
                    trace_id=trace_id,
                    planned=planned,
                    status="failed",
                    provider=self.PROVIDER_NAME,
                    requested_qty=qty,
                    filled_qty=0.0,
                    requested_price=price,
                    fill_price=None,
                    message=message,
                    reduce_only=True,
                )
                return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", message, price)
            margin_released = abs(pos.entry_price * pos.qty) / pos.leverage if pos.leverage > 0 else abs(pos.entry_price * pos.qty)
            sign = 1.0 if pos.side == "long" else -1.0
            # PnL derivation: price_delta * qty * direction
            gross_pnl = (price - pos.entry_price) * pos.qty * sign
            close_fee = abs(price * pos.qty) * self.FEE_BPS / 10_000.0
            net_pnl = gross_pnl - close_fee
            # Ensure cash never goes negative from a catastrophic loss
            new_cash = state.cash + margin_released + net_pnl
            if new_cash < 0:
                net_pnl = -(state.cash + margin_released)
                new_cash = 0.0
            state.cash = new_cash
            state.trades.append(
                TradeRecord(
                    cycle=state.cycle,
                    symbol=symbol,
                    action=action,
                    qty=pos.qty,
                    price=price,
                    pnl=net_pnl,
                    realized_pnl=gross_pnl,
                    fee=close_fee,
                    event_type="close",
                    source=pos.entry_source,
                    confidence=pos.entry_confidence,
                    reason=pos.entry_reason,
                )
            )
            exchange_order_id = append_exchange_order(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="SUBMITTED",
                provider=self.PROVIDER_NAME,
                requested_qty=pos.qty,
                executed_qty=0.0,
                requested_price=price,
                avg_price=None,
                side="SELL" if pos.side == "long" else "BUY",
                reduce_only=True,
                is_active=True,
                message="sim reduce-only market order submitted",
            )
            update_exchange_order(
                state=state,
                exchange_order_id=exchange_order_id,
                status="FILLED",
                executed_qty=pos.qty,
                avg_price=price,
                message="sim reduce-only market order filled",
                is_active=False,
            )
            append_fill(
                state=state,
                trace_id=trace_id,
                symbol=symbol,
                action=action,
                qty=pos.qty,
                price=price,
                fee=close_fee,
                provider=self.PROVIDER_NAME,
                exchange_order_id=exchange_order_id,
                liquidity="taker",
                reduce_only=True,
                message="sim close fill",
            )
            del state.positions[symbol]
            message = f"position closed pnl={net_pnl:.2f} margin_released={margin_released:.2f}"
            append_execution_report(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="success",
                provider=self.PROVIDER_NAME,
                requested_qty=pos.qty,
                filled_qty=pos.qty,
                requested_price=price,
                fill_price=price,
                message=message,
                reduce_only=True,
                exchange_order_id=exchange_order_id,
            )
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", message, price)

        message = "unknown action"
        append_execution_report(
            state=state,
            trace_id=trace_id,
            planned=planned,
            status="failed",
            provider=self.PROVIDER_NAME,
            requested_qty=qty,
            filled_qty=0.0,
            requested_price=price,
            fill_price=None,
            message=message,
        )
        return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", message, price)

    def reconcile(self, *, trace_id: str, state: RuntimeState) -> ReconciliationReportRecord:
        return append_reconciliation_report(
            state,
            ReconciliationReportRecord(
                trace_id=trace_id,
                cycle=state.cycle,
                provider=self.PROVIDER_NAME,
                status="synced",
                local_cash=float(state.cash),
                remote_cash=float(state.cash),
                local_positions=_position_qty_map(state),
                remote_positions=_position_qty_map(state),
                local_order_statuses=_local_order_status_map(state, provider=self.PROVIDER_NAME),
                remote_order_statuses=_local_order_status_map(state, provider=self.PROVIDER_NAME),
                message="local execution provider reconciliation",
            ),
        )

    def repair(self, *, trace_id: str, state: RuntimeState, reconciliation: ReconciliationReportRecord) -> ReconciliationReportRecord:
        report = ReconciliationReportRecord(
            trace_id=trace_id,
            cycle=state.cycle,
            provider=self.PROVIDER_NAME,
            status="synced",
            local_cash=float(state.cash),
            remote_cash=float(state.cash),
            local_positions=_position_qty_map(state),
            remote_positions=_position_qty_map(state),
            local_order_statuses=_local_order_status_map(state, provider=self.PROVIDER_NAME),
            remote_order_statuses=_local_order_status_map(state, provider=self.PROVIDER_NAME),
            message="local provider does not require repair",
            repaired=False,
            repair_actions=[],
        )
        return append_reconciliation_report(state, report)


class PaperExecutionProvider(SimExecutionProvider):
    """Paper provider keeps local portfolio accounting but tags execution as paper."""
    PROVIDER_NAME = "paper"

    def execute(self, *, trace_id: str, planned: ProposedAction, state: RuntimeState) -> ExecutionResult:
        result = super().execute(trace_id=trace_id, planned=planned, state=state)
        if result.status == "success":
            result.message = f"paper:{result.message}"
        return result


@dataclass
class BinanceCredentials:
    api_key: str
    api_secret: str


class BinanceFuturesExecutionProvider(ExecutionProvider):
    """Real order placement to Binance Futures.

    Safety gate: requires live_confirm_token == "YES".
    """
    PROVIDER_NAME = "binance_futures"

    def __init__(
        self,
        *,
        credentials: BinanceCredentials,
        base_url: str = "https://fapi.binance.com",
        timeout_sec: float = 6.0,
        live_confirm_token: str = "NO",
        auto_cancel_remote_only_orders: bool = False,
        remote_only_cancel_min_cycle_age: int = 0,
        auto_cancel_remote_only_conflicts_only: bool = False,
        rules_provider: BinanceFuturesRulesProvider | None = None,
    ) -> None:
        self.creds = credentials
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec
        self.live_confirm_token = live_confirm_token
        self.auto_cancel_remote_only_orders = auto_cancel_remote_only_orders
        self.remote_only_cancel_min_cycle_age = max(0, int(remote_only_cancel_min_cycle_age))
        self.auto_cancel_remote_only_conflicts_only = auto_cancel_remote_only_conflicts_only
        self.rules_provider = rules_provider or BinanceFuturesRulesProvider(base_url=self.base_url, timeout_sec=self.timeout_sec)
        self._last_account_payload: dict[str, object] | None = None
        self._last_order_payloads: dict[str, dict[str, object]] = {}
        self._last_open_orders_payloads: dict[str, list[dict[str, object]]] = {}

    def _signed_post(self, path: str, params: dict[str, str]) -> dict[str, object]:
        params["timestamp"] = str(int(time.time() * 1000))
        params["recvWindow"] = "5000"
        query = urllib.parse.urlencode(params)
        signature = hmac.new(self.creds.api_secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()
        body = f"{query}&signature={signature}".encode("utf-8")

        req = urllib.request.Request(
            url=f"{self.base_url}{path}",
            data=body,
            method="POST",
            headers={
                "X-MBX-APIKEY": self.creds.api_key,
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "TradeBot/0.1",
            },
        )
        with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("invalid order response")
        order_id = str(payload.get("orderId", "") or "")
        if order_id:
            self._last_order_payloads[order_id] = payload
        return payload

    def _signed_delete(self, path: str, params: dict[str, str]) -> dict[str, object]:
        params["timestamp"] = str(int(time.time() * 1000))
        params["recvWindow"] = "5000"
        query = urllib.parse.urlencode(params)
        signature = hmac.new(self.creds.api_secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()
        body = f"{query}&signature={signature}".encode("utf-8")

        req = urllib.request.Request(
            url=f"{self.base_url}{path}",
            data=body,
            method="DELETE",
            headers={
                "X-MBX-APIKEY": self.creds.api_key,
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "TradeBot/0.1",
            },
        )
        with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("invalid cancel response")
        order_id = str(payload.get("orderId", "") or params.get("orderId", ""))
        if order_id:
            self._last_order_payloads[order_id] = payload
        return payload

    def _signed_get(self, path: str, params: dict[str, str] | None = None) -> dict[str, object]:
        query_params = dict(params or {})
        query_params["timestamp"] = str(int(time.time() * 1000))
        query_params["recvWindow"] = "5000"
        query = urllib.parse.urlencode(query_params)
        signature = hmac.new(self.creds.api_secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()
        url = f"{self.base_url}{path}?{query}&signature={signature}"
        req = urllib.request.Request(
            url=url,
            method="GET",
            headers={
                "X-MBX-APIKEY": self.creds.api_key,
                "User-Agent": "TradeBot/0.1",
            },
        )
        with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("invalid account response")
        if path == "/fapi/v2/account":
            self._last_account_payload = payload
        order_id = str(payload.get("orderId", "") or query_params.get("orderId", ""))
        if path == "/fapi/v1/order" and order_id:
            self._last_order_payloads[order_id] = payload
        return payload

    def _signed_get_list(self, path: str, params: dict[str, str] | None = None) -> list[dict[str, object]]:
        query_params = dict(params or {})
        query_params["timestamp"] = str(int(time.time() * 1000))
        query_params["recvWindow"] = "5000"
        query = urllib.parse.urlencode(query_params)
        signature = hmac.new(self.creds.api_secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()
        url = f"{self.base_url}{path}?{query}&signature={signature}"
        req = urllib.request.Request(
            url=url,
            method="GET",
            headers={
                "X-MBX-APIKEY": self.creds.api_key,
                "User-Agent": "TradeBot/0.1",
            },
        )
        with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        if not isinstance(payload, list):
            raise ValueError("invalid list response")
        rows = [row for row in payload if isinstance(row, dict)]
        symbol = str(query_params.get("symbol", "") or "")
        if path == "/fapi/v1/openOrders":
            self._last_open_orders_payloads[symbol or "*"] = rows
        return rows

    def _is_synthetic_order_id(self, order_id: str) -> bool:
        return order_id.startswith(f"{self.PROVIDER_NAME}:")

    def _fetch_remote_order_statuses(self, state: RuntimeState) -> tuple[dict[str, str], list[str]]:
        remote_statuses: dict[str, str] = {}
        warnings: list[str] = []
        seen: set[tuple[str, str]] = set()
        for order in state.exchange_orders:
            if order.provider != self.PROVIDER_NAME or not order.exchange_order_id or self._is_synthetic_order_id(order.exchange_order_id):
                continue
            key = (order.symbol, order.exchange_order_id)
            if key in seen:
                continue
            seen.add(key)
            cached = self._last_order_payloads.get(order.exchange_order_id)
            payload = cached
            if payload is None:
                try:
                    payload = self._signed_get("/fapi/v1/order", {"symbol": order.symbol, "orderId": order.exchange_order_id})
                except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
                    warnings.append(f"remote order fetch failed {order.exchange_order_id}: {exc}")
                    continue
            status = str(payload.get("status", "") or "").upper()
            if status:
                remote_statuses[order.exchange_order_id] = status
                self._last_order_payloads[order.exchange_order_id] = payload
        return remote_statuses, warnings

    def _fetch_remote_open_orders(self, state: RuntimeState) -> tuple[dict[str, dict[str, object]], list[str]]:
        remote_open_orders: dict[str, dict[str, object]] = {}
        warnings: list[str] = []
        rows = self._last_open_orders_payloads.get("*")
        if rows is None:
            try:
                rows = self._signed_get_list("/fapi/v1/openOrders")
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
                warnings.append(f"remote open orders fetch failed: {exc}")
                return remote_open_orders, warnings
            self._last_open_orders_payloads["*"] = rows
        for row in rows:
            order_id = str(row.get("orderId", "") or "")
            status = str(row.get("status", "") or "").upper()
            if not order_id:
                continue
            remote_open_orders[order_id] = row
            if status:
                self._last_order_payloads[order_id] = row
        return remote_open_orders, warnings

    @staticmethod
    def _action_from_remote_order(*, side: str, reduce_only: bool) -> str:
        if side == "BUY" and not reduce_only:
            return "open_long"
        if side == "SELL" and not reduce_only:
            return "open_short"
        if side == "SELL" and reduce_only:
            return "close_long"
        if side == "BUY" and reduce_only:
            return "close_short"
        return "hold"

    @staticmethod
    def _remote_open_order_conflicts(*, state: RuntimeState, symbol: str, side: str, reduce_only: bool) -> bool:
        pos = state.positions.get(symbol)
        if reduce_only:
            if pos is None:
                return True
            if side == "SELL":
                return pos.side != "long"
            if side == "BUY":
                return pos.side != "short"
            return True
        if pos is None:
            return False
        if side == "BUY":
            return pos.side == "short"
        if side == "SELL":
            return pos.side == "long"
        return False

    def _to_order(self, action: str) -> tuple[str, bool]:
        if action == "open_long":
            return "BUY", False
        if action == "open_short":
            return "SELL", False
        if action == "close_long":
            return "SELL", True
        if action == "close_short":
            return "BUY", True
        raise ValueError(f"unsupported action={action}")

    def _adjust_quantity(self, *, action: str, qty: float, price: float, rules: BinanceSymbolRules | None) -> tuple[float, str | None]:
        if rules is None:
            return qty, None
        adjusted = quantize_quantity(qty, rules)
        if adjusted <= 0:
            return 0.0, f"quantity below min rule (min_qty={rules.min_qty}, step={rules.step_size})"
        if action in {"open_long", "open_short"} and rules.min_notional > 0 and adjusted * max(0.0, price) < rules.min_notional:
            return 0.0, f"notional below min rule (min_notional={rules.min_notional})"
        return adjusted, None

    def _format_qty(self, qty: float, rules: BinanceSymbolRules | None) -> str:
        if rules is None:
            return f"{qty:.6f}"
        return format_quantity(qty, rules.qty_precision)

    def execute(self, *, trace_id: str, planned: ProposedAction, state: RuntimeState) -> ExecutionResult:
        symbol = planned.symbol
        action = planned.action
        requested_qty = float(planned.order_params.get("quantity", 0) or 0)
        requested_price = float(planned.order_params.get("entry_price", 0) or 0)
        if action in {"wait", "hold"}:
            message = "passive action"
            append_execution_report(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="skipped",
                provider=self.PROVIDER_NAME,
                requested_qty=requested_qty,
                filled_qty=0.0,
                requested_price=requested_price,
                fill_price=None,
                message=message,
                reduce_only=action in {"close_long", "close_short"},
            )
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "skipped", message)

        if self.live_confirm_token != "YES":
            message = "live execution blocked: set TRADEBOT_LIVE_CONFIRM=YES"
            append_execution_report(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="failed",
                provider=self.PROVIDER_NAME,
                requested_qty=requested_qty,
                filled_qty=0.0,
                requested_price=requested_price,
                fill_price=None,
                message=message,
                reduce_only=action in {"close_long", "close_short"},
            )
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", message)

        if action == "cancel_order":
            requested_order_id = str(planned.order_params.get("exchange_order_id", "") or "")
            active_order = _find_active_exchange_order(
                state,
                symbol=symbol,
                provider=self.PROVIDER_NAME,
                exchange_order_id=requested_order_id,
            )
            if active_order is None:
                message = "no active order"
                append_execution_report(
                    state=state,
                    trace_id=trace_id,
                    planned=planned,
                    status="failed",
                    provider=self.PROVIDER_NAME,
                    requested_qty=0.0,
                    filled_qty=0.0,
                    requested_price=requested_price,
                    fill_price=None,
                    message=message,
                    exchange_order_id=requested_order_id,
                )
                return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", message)
            if self._is_synthetic_order_id(active_order.exchange_order_id):
                message = "cannot live-cancel synthetic local order id"
                append_execution_report(
                    state=state,
                    trace_id=trace_id,
                    planned=planned,
                    status="failed",
                    provider=self.PROVIDER_NAME,
                    requested_qty=active_order.requested_qty,
                    filled_qty=active_order.executed_qty,
                    requested_price=active_order.requested_price,
                    fill_price=active_order.avg_price,
                    message=message,
                    exchange_order_id=active_order.exchange_order_id,
                )
                return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", message, active_order.avg_price)
            try:
                resp = self._signed_delete("/fapi/v1/order", {"symbol": symbol, "orderId": active_order.exchange_order_id})
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
                message = f"live cancel failed: {exc}"
                append_execution_report(
                    state=state,
                    trace_id=trace_id,
                    planned=planned,
                    status="failed",
                    provider=self.PROVIDER_NAME,
                    requested_qty=active_order.requested_qty,
                    filled_qty=active_order.executed_qty,
                    requested_price=active_order.requested_price,
                    fill_price=active_order.avg_price,
                    message=message,
                    exchange_order_id=active_order.exchange_order_id,
                )
                return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", message, active_order.avg_price)
            cancel_status = str(resp.get("status", "") or "CANCELED").upper()
            update_exchange_order(
                state=state,
                exchange_order_id=active_order.exchange_order_id,
                status=cancel_status,
                message=f"live order canceled: {cancel_status}",
                is_active=False,
            )
            message = f"active order canceled: {cancel_status}"
            append_execution_report(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="success",
                provider=self.PROVIDER_NAME,
                requested_qty=active_order.requested_qty,
                filled_qty=active_order.executed_qty,
                requested_price=active_order.requested_price,
                fill_price=active_order.avg_price,
                message=message,
                exchange_order_id=active_order.exchange_order_id,
            )
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", message, active_order.avg_price)

        qty = float(planned.order_params.get("quantity", 0) or 0)
        if action in {"close_long", "close_short"} and symbol in state.positions:
            qty = state.positions[symbol].qty
        lev = float(planned.order_params.get("leverage", 1.0) or 1.0)
        append_order_intent(
            state=state,
            trace_id=trace_id,
            planned=planned,
            provider=self.PROVIDER_NAME,
            requested_qty=qty,
            requested_price=requested_price,
            leverage=lev,
            reduce_only=action in {"close_long", "close_short"},
        )
        if qty <= 0:
            message = "invalid quantity"
            append_execution_report(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="failed",
                provider=self.PROVIDER_NAME,
                requested_qty=qty,
                filled_qty=0.0,
                requested_price=float(planned.order_params.get("entry_price", 0) or 0),
                fill_price=None,
                message=message,
                reduce_only=action in {"close_long", "close_short"},
            )
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", message)
        price = requested_price
        rules = self.rules_provider.get_symbol_rules(symbol)

        adjusted_qty, blocked_reason = self._adjust_quantity(action=action, qty=qty, price=price, rules=rules)
        if blocked_reason:
            append_execution_report(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="failed",
                provider=self.PROVIDER_NAME,
                requested_qty=qty,
                filled_qty=0.0,
                requested_price=price,
                fill_price=None,
                message=blocked_reason,
                reduce_only=action in {"close_long", "close_short"},
            )
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", blocked_reason)
        qty = adjusted_qty

        side, reduce_only = self._to_order(action)
        params = {
            "symbol": symbol,
            "side": side,
            "type": "MARKET",
            "quantity": self._format_qty(qty, rules),
            "reduceOnly": "true" if reduce_only else "false",
            "newOrderRespType": "RESULT",
        }
        local_exchange_order_id = append_exchange_order(
            state=state,
            trace_id=trace_id,
            planned=planned,
            status="SUBMITTED",
            provider=self.PROVIDER_NAME,
            requested_qty=qty,
            executed_qty=0.0,
            requested_price=price,
            avg_price=None,
            side=side,
            reduce_only=reduce_only,
            is_active=True,
            exchange_order_id=_synthetic_exchange_order_id(provider=self.PROVIDER_NAME, trace_id=trace_id, state=state),
            message="live order submitted",
        )

        try:
            resp = self._signed_post("/fapi/v1/order", params)
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            message = f"live order failed: {exc}"
            update_exchange_order(
                state=state,
                exchange_order_id=local_exchange_order_id,
                status="REJECTED",
                message=message,
                is_active=False,
            )
            append_execution_report(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="failed",
                provider=self.PROVIDER_NAME,
                requested_qty=qty,
                filled_qty=0.0,
                requested_price=price,
                fill_price=None,
                message=message,
                reduce_only=reduce_only,
                exchange_order_id=local_exchange_order_id,
            )
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", message)

        avg_price = float(resp.get("avgPrice", 0.0) or planned.order_params.get("entry_price", 0.0) or 0.0)
        exchange_order_id = str(resp.get("orderId", "") or local_exchange_order_id)
        executed_qty = float(resp.get("executedQty", qty) or qty)
        order_status = str(resp.get("status", "") or ("PARTIALLY_FILLED" if executed_qty + 1e-12 < qty else "FILLED"))
        exchange_order_id = update_exchange_order(
            state=state,
            exchange_order_id=local_exchange_order_id,
            status=order_status,
            executed_qty=executed_qty,
            avg_price=avg_price,
            message=f"live order {order_status.lower()}",
            is_active=False,
            exchange_order_id_override=exchange_order_id,
        )

        if action == "open_long":
            margin_required = abs(avg_price * executed_qty) / lev if lev > 0 else abs(avg_price * executed_qty)
            state.cash -= margin_required
            state.positions[symbol] = _build_position_from_proposal(
                planned,
                side="long",
                qty=executed_qty,
                entry_price=avg_price,
                leverage=lev,
                opened_cycle=state.cycle,
            )
            state.trades.append(
                TradeRecord(
                    cycle=state.cycle,
                    symbol=symbol,
                    action=action,
                    qty=executed_qty,
                    price=avg_price,
                    pnl=0.0,
                    realized_pnl=0.0,
                    fee=0.0,
                    event_type="open",
                    source=planned.source,
                    confidence=planned.confidence,
                    reason=planned.reason,
                )
            )
            append_fill(
                state=state,
                trace_id=trace_id,
                symbol=symbol,
                action=action,
                qty=executed_qty,
                price=avg_price,
                fee=0.0,
                provider=self.PROVIDER_NAME,
                exchange_order_id=exchange_order_id,
                liquidity="taker",
                message="live open fill",
            )
            message = f"live long opened margin={margin_required:.2f}"
            append_execution_report(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="success",
                provider=self.PROVIDER_NAME,
                requested_qty=qty,
                filled_qty=executed_qty,
                requested_price=price,
                fill_price=avg_price,
                message=message,
                reduce_only=False,
                exchange_order_id=exchange_order_id,
            )
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", message, avg_price)

        if action == "open_short":
            margin_required = abs(avg_price * executed_qty) / lev if lev > 0 else abs(avg_price * executed_qty)
            state.cash -= margin_required
            state.positions[symbol] = _build_position_from_proposal(
                planned,
                side="short",
                qty=executed_qty,
                entry_price=avg_price,
                leverage=lev,
                opened_cycle=state.cycle,
            )
            state.trades.append(
                TradeRecord(
                    cycle=state.cycle,
                    symbol=symbol,
                    action=action,
                    qty=executed_qty,
                    price=avg_price,
                    pnl=0.0,
                    realized_pnl=0.0,
                    fee=0.0,
                    event_type="open",
                    source=planned.source,
                    confidence=planned.confidence,
                    reason=planned.reason,
                )
            )
            append_fill(
                state=state,
                trace_id=trace_id,
                symbol=symbol,
                action=action,
                qty=executed_qty,
                price=avg_price,
                fee=0.0,
                provider=self.PROVIDER_NAME,
                exchange_order_id=exchange_order_id,
                liquidity="taker",
                message="live open fill",
            )
            message = f"live short opened margin={margin_required:.2f}"
            append_execution_report(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="success",
                provider=self.PROVIDER_NAME,
                requested_qty=qty,
                filled_qty=executed_qty,
                requested_price=price,
                fill_price=avg_price,
                message=message,
                reduce_only=False,
                exchange_order_id=exchange_order_id,
            )
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", message, avg_price)

        if action in {"close_long", "close_short"}:
            pos = state.positions.get(symbol)
            if not pos:
                message = "no local position"
                append_execution_report(
                    state=state,
                    trace_id=trace_id,
                    planned=planned,
                    status="failed",
                    provider=self.PROVIDER_NAME,
                    requested_qty=qty,
                    filled_qty=0.0,
                    requested_price=price,
                    fill_price=None,
                    message=message,
                    reduce_only=True,
                    exchange_order_id=exchange_order_id,
                )
                return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", message)
            margin_released = abs(pos.entry_price * pos.qty) / pos.leverage if pos.leverage > 0 else abs(pos.entry_price * pos.qty)
            sign = 1.0 if pos.side == "long" else -1.0
            # PnL derivation: price_delta * qty * direction
            pnl = (avg_price - pos.entry_price) * pos.qty * sign
            # Ensure cash never goes negative
            new_cash = state.cash + margin_released + pnl
            if new_cash < 0:
                pnl = -(state.cash + margin_released)
                new_cash = 0.0
            state.cash = new_cash
            state.trades.append(
                TradeRecord(
                    cycle=state.cycle,
                    symbol=symbol,
                    action=action,
                    qty=pos.qty,
                    price=avg_price,
                    pnl=pnl,
                    realized_pnl=pnl,
                    fee=0.0,
                    event_type="close",
                    source=pos.entry_source,
                    confidence=pos.entry_confidence,
                    reason=pos.entry_reason,
                )
            )
            append_fill(
                state=state,
                trace_id=trace_id,
                symbol=symbol,
                action=action,
                qty=pos.qty,
                price=avg_price,
                fee=0.0,
                provider=self.PROVIDER_NAME,
                exchange_order_id=exchange_order_id,
                liquidity="taker",
                reduce_only=True,
                message="live close fill",
            )
            del state.positions[symbol]
            message = f"live position closed pnl={pnl:.2f} margin_released={margin_released:.2f}"
            append_execution_report(
                state=state,
                trace_id=trace_id,
                planned=planned,
                status="success",
                provider=self.PROVIDER_NAME,
                requested_qty=qty,
                filled_qty=pos.qty,
                requested_price=price,
                fill_price=avg_price,
                message=message,
                reduce_only=True,
                exchange_order_id=exchange_order_id,
            )
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", message, avg_price)

        message = "unknown action"
        append_execution_report(
            state=state,
            trace_id=trace_id,
            planned=planned,
            status="failed",
            provider=self.PROVIDER_NAME,
            requested_qty=qty,
            filled_qty=0.0,
            requested_price=price,
            fill_price=None,
            message=message,
            reduce_only=reduce_only,
            exchange_order_id=exchange_order_id,
        )
        return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", message)

    def reconcile(self, *, trace_id: str, state: RuntimeState) -> ReconciliationReportRecord:
        local_positions = _position_qty_map(state)
        local_order_statuses = _local_order_status_map(state, provider=self.PROVIDER_NAME)
        if self.live_confirm_token != "YES":
            return append_reconciliation_report(
                state,
                ReconciliationReportRecord(
                    trace_id=trace_id,
                    cycle=state.cycle,
                    provider=self.PROVIDER_NAME,
                    status="unavailable",
                    local_cash=float(state.cash),
                    remote_cash=None,
                    local_positions=local_positions,
                    remote_positions={},
                    local_order_statuses=local_order_statuses,
                    remote_order_statuses={},
                    warnings=["live confirmation disabled"],
                    message="skipped remote reconciliation because live execution is disabled",
                ),
            )

        try:
            payload = self._signed_get("/fapi/v2/account")
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            return append_reconciliation_report(
                state,
                ReconciliationReportRecord(
                    trace_id=trace_id,
                    cycle=state.cycle,
                    provider=self.PROVIDER_NAME,
                    status="error",
                    local_cash=float(state.cash),
                    remote_cash=None,
                    local_positions=local_positions,
                    remote_positions={},
                    local_order_statuses=local_order_statuses,
                    remote_order_statuses={},
                    warnings=[f"remote account fetch failed: {exc}"],
                    message="remote reconciliation failed",
                ),
            )

        assets = payload.get("assets", [])
        positions = payload.get("positions", [])
        remote_cash: float | None = None
        if isinstance(assets, list):
            for row in assets:
                if not isinstance(row, dict):
                    continue
                if str(row.get("asset", "")).upper() == "USDT":
                    remote_cash = float(row.get("availableBalance", row.get("walletBalance", 0.0)) or 0.0)
                    break

        remote_positions: dict[str, float] = {}
        if isinstance(positions, list):
            for row in positions:
                if not isinstance(row, dict):
                    continue
                symbol = str(row.get("symbol", ""))
                qty = float(row.get("positionAmt", 0.0) or 0.0)
                if symbol and abs(qty) > 1e-12:
                    remote_positions[symbol] = qty

        warnings: list[str] = []
        remote_order_statuses, order_fetch_warnings = self._fetch_remote_order_statuses(state)
        remote_open_orders, open_order_warnings = self._fetch_remote_open_orders(state)
        warnings.extend(order_fetch_warnings)
        warnings.extend(open_order_warnings)
        for order_id, row in remote_open_orders.items():
            status = str(row.get("status", "") or "").upper()
            if status:
                remote_order_statuses[order_id] = status
        all_symbols = sorted(set(local_positions) | set(remote_positions))
        for symbol in all_symbols:
            local_qty = float(local_positions.get(symbol, 0.0))
            remote_qty = float(remote_positions.get(symbol, 0.0))
            if abs(local_qty - remote_qty) > 1e-9:
                warnings.append(f"position mismatch {symbol}: local={local_qty:.8f}, remote={remote_qty:.8f}")
        if remote_cash is not None and abs(float(state.cash) - remote_cash) > 1e-6:
            warnings.append(f"cash mismatch: local={float(state.cash):.8f}, remote={remote_cash:.8f}")
        for order_id, local_status in local_order_statuses.items():
            remote_status = remote_order_statuses.get(order_id)
            if remote_status and local_status != remote_status:
                warnings.append(f"order mismatch {order_id}: local={local_status}, remote={remote_status}")
        for order_id, row in remote_open_orders.items():
            if order_id not in local_order_statuses:
                warnings.append(
                    f"remote-only open order {order_id}: symbol={row.get('symbol', '')}, status={str(row.get('status', '')).upper()}"
                )

        status = "warning" if warnings else "synced"
        message = "remote reconciliation completed"
        return append_reconciliation_report(
            state,
            ReconciliationReportRecord(
                trace_id=trace_id,
                cycle=state.cycle,
                provider=self.PROVIDER_NAME,
                status=status,
                local_cash=float(state.cash),
                remote_cash=remote_cash,
                local_positions=local_positions,
                remote_positions=remote_positions,
                local_order_statuses=local_order_statuses,
                remote_order_statuses=remote_order_statuses,
                warnings=warnings,
                message=message,
            ),
        )

    def repair(self, *, trace_id: str, state: RuntimeState, reconciliation: ReconciliationReportRecord) -> ReconciliationReportRecord:
        if self.live_confirm_token != "YES":
            report = ReconciliationReportRecord(
                trace_id=trace_id,
                cycle=state.cycle,
                provider=self.PROVIDER_NAME,
                status="unavailable",
                local_cash=float(state.cash),
                remote_cash=None,
                local_positions=_position_qty_map(state),
                remote_positions={},
                local_order_statuses=_local_order_status_map(state, provider=self.PROVIDER_NAME),
                remote_order_statuses={},
                warnings=["live confirmation disabled"],
                message="repair skipped because live execution is disabled",
                repaired=False,
            )
            return append_reconciliation_report(state, report)

        payload = self._last_account_payload
        if payload is None:
            try:
                payload = self._signed_get("/fapi/v2/account")
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
                report = ReconciliationReportRecord(
                    trace_id=trace_id,
                    cycle=state.cycle,
                    provider=self.PROVIDER_NAME,
                    status="error",
                    local_cash=float(state.cash),
                    remote_cash=None,
                    local_positions=_position_qty_map(state),
                    remote_positions={},
                    local_order_statuses=_local_order_status_map(state, provider=self.PROVIDER_NAME),
                    remote_order_statuses={},
                    warnings=[f"repair fetch failed: {exc}"],
                    message="repair failed while fetching remote state",
                    repaired=False,
                )
                return append_reconciliation_report(state, report)

        assets = payload.get("assets", [])
        positions = payload.get("positions", [])
        remote_cash = float(state.cash)
        if isinstance(assets, list):
            for row in assets:
                if not isinstance(row, dict):
                    continue
                if str(row.get("asset", "")).upper() == "USDT":
                    remote_cash = float(row.get("availableBalance", row.get("walletBalance", 0.0)) or 0.0)
                    break

        remote_positions: dict[str, float] = {}
        new_positions: dict[str, Position] = {}
        remote_order_statuses, order_fetch_warnings = self._fetch_remote_order_statuses(state)
        remote_open_orders, open_order_warnings = self._fetch_remote_open_orders(state)
        order_fetch_warnings.extend(open_order_warnings)
        for order_id, row in remote_open_orders.items():
            status = str(row.get("status", "") or "").upper()
            if status:
                remote_order_statuses[order_id] = status
        if isinstance(positions, list):
            for row in positions:
                if not isinstance(row, dict):
                    continue
                symbol = str(row.get("symbol", ""))
                raw_qty = float(row.get("positionAmt", 0.0) or 0.0)
                if not symbol or abs(raw_qty) <= 1e-12:
                    continue
                remote_positions[symbol] = raw_qty
                side = "long" if raw_qty > 0 else "short"
                qty = abs(raw_qty)
                new_positions[symbol] = Position(
                    symbol=symbol,
                    side=side,
                    qty=qty,
                    entry_price=float(row.get("entryPrice", 0.0) or 0.0),
                    leverage=float(row.get("leverage", 1.0) or 1.0),
                    opened_cycle=state.cycle,
                    entry_source="reconciled_remote",
                    entry_reason="remote reconciliation repair",
                )

        repair_actions: list[str] = []
        if abs(float(state.cash) - remote_cash) > 1e-6:
            repair_actions.append(f"cash synced {float(state.cash):.8f} -> {remote_cash:.8f}")
        old_positions = _position_qty_map(state)
        all_symbols = sorted(set(old_positions) | set(remote_positions))
        for symbol in all_symbols:
            local_qty = float(old_positions.get(symbol, 0.0))
            remote_qty = float(remote_positions.get(symbol, 0.0))
            if abs(local_qty - remote_qty) > 1e-9:
                repair_actions.append(f"position synced {symbol}: {local_qty:.8f} -> {remote_qty:.8f}")
        for order in state.exchange_orders:
            if order.provider != self.PROVIDER_NAME or not order.exchange_order_id:
                continue
            remote_status = remote_order_statuses.get(order.exchange_order_id)
            if remote_status and order.status != remote_status:
                old_status = order.status
                update_exchange_order(
                    state=state,
                    exchange_order_id=order.exchange_order_id,
                    status=remote_status,
                    message=f"status synced from remote: {remote_status}",
                    is_active=order.exchange_order_id in remote_open_orders,
                )
                repair_actions.append(f"order status synced {order.exchange_order_id}: {old_status} -> {remote_status}")
            elif order.exchange_order_id in remote_open_orders and not order.is_active:
                update_exchange_order(
                    state=state,
                    exchange_order_id=order.exchange_order_id,
                    is_active=True,
                    message="order marked active from remote open orders",
                )
                repair_actions.append(f"order re-activated {order.exchange_order_id}")
            elif order.exchange_order_id not in remote_open_orders and order.is_active and remote_status:
                update_exchange_order(
                    state=state,
                    exchange_order_id=order.exchange_order_id,
                    is_active=False,
                    message=f"order marked inactive from remote status: {remote_status}",
                )
                repair_actions.append(f"order marked inactive {order.exchange_order_id}")
        known_orders_by_id = {
            order.exchange_order_id: order
            for order in state.exchange_orders
            if order.provider == self.PROVIDER_NAME and order.exchange_order_id
        }
        known_order_ids = set(known_orders_by_id)
        for order_id, row in remote_open_orders.items():
            existing_order = known_orders_by_id.get(order_id)
            side = str(row.get("side", "") or "").upper()
            reduce_only = bool(row.get("reduceOnly", False))
            action = self._action_from_remote_order(side=side, reduce_only=reduce_only)
            status = str(row.get("status", "") or "NEW").upper()
            symbol = str(row.get("symbol", "") or "")
            age_cycles = state.cycle - existing_order.cycle if existing_order is not None else 0
            eligible_by_age = (
                existing_order is not None and age_cycles >= self.remote_only_cancel_min_cycle_age
                or existing_order is None and self.remote_only_cancel_min_cycle_age <= 0
            )
            eligible_by_conflict = (
                not self.auto_cancel_remote_only_conflicts_only
                or self._remote_open_order_conflicts(
                    state=state,
                    symbol=symbol,
                    side=side,
                    reduce_only=reduce_only,
                )
            )
            should_auto_cancel = self.auto_cancel_remote_only_orders and (
                eligible_by_age and eligible_by_conflict
            )
            if should_auto_cancel:
                try:
                    cancel_resp = self._signed_delete("/fapi/v1/order", {"symbol": symbol, "orderId": order_id})
                    cancel_status = str(cancel_resp.get("status", "") or "CANCELED").upper()
                    if existing_order is not None:
                        update_exchange_order(
                            state=state,
                            exchange_order_id=order_id,
                            status=cancel_status,
                            message="remote-only open order auto-canceled during reconciliation",
                            is_active=False,
                        )
                    else:
                        state.exchange_orders.append(
                            ExchangeOrderRecord(
                                trace_id=trace_id,
                                cycle=state.cycle,
                                symbol=symbol,
                                action="cancel_order",
                                requested_qty=float(row.get("origQty", 0.0) or 0.0),
                                executed_qty=float(row.get("executedQty", 0.0) or 0.0),
                                requested_price=float(row.get("price", 0.0) or 0.0),
                                avg_price=float(row.get("avgPrice", 0.0) or 0.0) or None,
                                status=cancel_status,
                                provider=self.PROVIDER_NAME,
                                reduce_only=reduce_only,
                                is_active=False,
                                exchange_order_id=order_id,
                                side=side,
                                order_type=str(row.get("type", "MARKET") or "MARKET"),
                                message="remote-only open order auto-canceled during reconciliation",
                                status_history=[status, cancel_status] if status != cancel_status else [cancel_status],
                                source="reconciled_remote",
                                reason="remote-only open order auto-canceled during reconciliation",
                            )
                        )
                    repair_actions.append(f"remote open order canceled {order_id}")
                    continue
                except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
                    repair_actions.append(f"remote open order cancel failed {order_id}: {exc}")
            if existing_order is not None:
                continue
            state.exchange_orders.append(
                ExchangeOrderRecord(
                    trace_id=trace_id,
                    cycle=state.cycle,
                    symbol=symbol,
                    action=action,
                    requested_qty=float(row.get("origQty", 0.0) or 0.0),
                    executed_qty=float(row.get("executedQty", 0.0) or 0.0),
                    requested_price=float(row.get("price", 0.0) or 0.0),
                    avg_price=float(row.get("avgPrice", 0.0) or 0.0) or None,
                    status=status,
                    provider=self.PROVIDER_NAME,
                    reduce_only=reduce_only,
                    is_active=True,
                    exchange_order_id=order_id,
                    side=side,
                    order_type=str(row.get("type", "MARKET") or "MARKET"),
                    message="imported from remote open orders",
                    status_history=[status],
                    source="reconciled_remote",
                    reason="remote-only open order detected during reconciliation",
                )
            )
            repair_actions.append(f"remote open order imported {order_id}")

        state.cash = remote_cash
        state.positions = new_positions

        report = ReconciliationReportRecord(
            trace_id=trace_id,
            cycle=state.cycle,
            provider=self.PROVIDER_NAME,
            status="synced",
            local_cash=float(state.cash),
            remote_cash=remote_cash,
            local_positions=_position_qty_map(state),
            remote_positions=remote_positions,
            local_order_statuses=_local_order_status_map(state, provider=self.PROVIDER_NAME),
            remote_order_statuses=remote_order_statuses,
            warnings=order_fetch_warnings,
            message="local state repaired from remote account snapshot",
            repaired=bool(repair_actions),
            repair_actions=repair_actions,
        )
        return append_reconciliation_report(state, report)
