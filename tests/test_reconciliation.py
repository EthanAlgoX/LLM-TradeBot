from __future__ import annotations

import asyncio

from orchestrator import MultiAgentTradeBot
from config import RuntimeConfig
from backtest import BacktestExecutionProvider
from providers.execution import BinanceCredentials, BinanceFuturesExecutionProvider, SimExecutionProvider
from providers.execution import append_reconciliation_report
from state import ExchangeOrderRecord, Position, ReconciliationReportRecord, RuntimeState


class DummyBinanceProvider(BinanceFuturesExecutionProvider):
    def __init__(
        self,
        payload: dict[str, object],
        order_payloads: dict[tuple[str, str], dict[str, object]] | None = None,
        open_order_payloads: dict[str, list[dict[str, object]]] | None = None,
        auto_cancel_remote_only_orders: bool = False,
        remote_only_cancel_min_cycle_age: int = 0,
        auto_cancel_remote_only_conflicts_only: bool = False,
    ) -> None:
        super().__init__(
            credentials=BinanceCredentials(api_key="k", api_secret="s"),
            live_confirm_token="YES",
            auto_cancel_remote_only_orders=auto_cancel_remote_only_orders,
            remote_only_cancel_min_cycle_age=remote_only_cancel_min_cycle_age,
            auto_cancel_remote_only_conflicts_only=auto_cancel_remote_only_conflicts_only,
        )
        self._payload = payload
        self._order_payloads = order_payloads or {}
        self._open_order_payloads = open_order_payloads or {}
        self.canceled_order_ids: list[str] = []

    def _signed_get(self, path: str, params: dict[str, str] | None = None) -> dict[str, object]:  # noqa: ARG002
        if path == "/fapi/v2/account":
            return self._payload
        if path == "/fapi/v1/order" and params is not None:
            key = (str(params["symbol"]), str(params["orderId"]))
            if key in self._order_payloads:
                return self._order_payloads[key]
            for rows in self._open_order_payloads.values():
                for row in rows:
                    if str(row.get("symbol", "")) == key[0] and str(row.get("orderId", "")) == key[1]:
                        return row
        raise AssertionError(path)

    def _signed_get_list(self, path: str, params: dict[str, str] | None = None) -> list[dict[str, object]]:  # noqa: ARG002
        if path == "/fapi/v1/openOrders":
            if params is None or "symbol" not in params:
                merged: list[dict[str, object]] = []
                for rows in self._open_order_payloads.values():
                    merged.extend(rows)
                return merged
            return self._open_order_payloads.get(str(params["symbol"]), [])
        raise AssertionError(path)

    def _signed_delete(self, path: str, params: dict[str, str]) -> dict[str, object]:  # noqa: ARG002
        assert path == "/fapi/v1/order"
        self.canceled_order_ids.append(str(params["orderId"]))
        return {"orderId": params["orderId"], "status": "CANCELED"}


class MismatchRepairProvider(SimExecutionProvider):
    def reconcile(self, *, trace_id: str, state: RuntimeState) -> ReconciliationReportRecord:
        return append_reconciliation_report(
            state,
            ReconciliationReportRecord(
                trace_id=trace_id,
                cycle=state.cycle,
                provider=self.PROVIDER_NAME,
                status="warning",
                local_cash=float(state.cash),
                remote_cash=500.0,
                local_positions={"LOCAL": 1.0},
                remote_positions={},
                warnings=["cash mismatch"],
                message="repair needed",
            ),
        )

    def repair(self, *, trace_id: str, state: RuntimeState, reconciliation: ReconciliationReportRecord) -> ReconciliationReportRecord:
        state.cash = 500.0
        state.positions.clear()
        return append_reconciliation_report(
            state,
            ReconciliationReportRecord(
                trace_id=trace_id,
                cycle=state.cycle,
                provider=self.PROVIDER_NAME,
                status="synced",
                local_cash=500.0,
                remote_cash=500.0,
                local_positions={},
                remote_positions={},
                message="repair applied",
                repaired=True,
                repair_actions=["cash synced", "positions cleared"],
            ),
        )


def test_sim_reconciliation_reports_synced_local_state():
    provider = SimExecutionProvider()
    state = RuntimeState(cycle=3, cash=9_500.0)
    state.positions["BTCUSDT"] = Position(symbol="BTCUSDT", side="long", qty=0.2, entry_price=100.0, leverage=2.0, opened_cycle=1)

    report = provider.reconcile(trace_id="cycle:3:test", state=state)

    assert report.status == "synced"
    assert report.local_cash == 9500.0
    assert report.remote_positions == {"BTCUSDT": 0.2}
    assert state.reconciliation_reports[-1] == report


def test_backtest_reconciliation_reports_synced_local_state():
    provider = BacktestExecutionProvider(fee_bps=0.0, slippage_bps=0.0)
    state = RuntimeState(cycle=4, cash=8_000.0)
    state.positions["ETHUSDT"] = Position(symbol="ETHUSDT", side="short", qty=1.5, entry_price=2000.0, leverage=3.0, opened_cycle=2)

    report = provider.reconcile(trace_id="cycle:4:test", state=state)

    assert report.status == "synced"
    assert report.remote_positions == {"ETHUSDT": -1.5}


def test_binance_reconciliation_flags_position_mismatch():
    provider = DummyBinanceProvider(
        payload={
            "assets": [{"asset": "USDT", "availableBalance": "1000.0"}],
            "positions": [{"symbol": "BTCUSDT", "positionAmt": "0.1000"}],
        },
        order_payloads={("BTCUSDT", "oid-1"): {"status": "FILLED"}},
    )
    state = RuntimeState(cycle=5, cash=1000.0)
    state.positions["BTCUSDT"] = Position(symbol="BTCUSDT", side="long", qty=0.2, entry_price=100.0, leverage=2.0, opened_cycle=1)
    state.exchange_orders.append(
        ExchangeOrderRecord(
            trace_id="cycle:5:test",
            cycle=5,
            symbol="BTCUSDT",
            action="open_long",
            requested_qty=0.2,
            executed_qty=0.1,
            requested_price=100.0,
            avg_price=100.0,
            status="PARTIALLY_FILLED",
            provider="binance_futures",
            exchange_order_id="oid-1",
            side="BUY",
            order_type="MARKET",
            message="local snapshot",
            status_history=["SUBMITTED", "PARTIALLY_FILLED"],
        )
    )

    report = provider.reconcile(trace_id="cycle:5:test", state=state)

    assert report.status == "warning"
    assert any("position mismatch BTCUSDT" in warning for warning in report.warnings)
    assert any("order mismatch oid-1" in warning for warning in report.warnings)
    assert report.local_order_statuses == {"oid-1": "PARTIALLY_FILLED"}
    assert report.remote_order_statuses == {"oid-1": "FILLED"}


def test_binance_repair_syncs_local_state_to_remote_snapshot():
    provider = DummyBinanceProvider(
        payload={
            "assets": [{"asset": "USDT", "availableBalance": "800.0"}],
            "positions": [{"symbol": "BTCUSDT", "positionAmt": "-0.1500", "entryPrice": "102.5", "leverage": "3"}],
        },
        order_payloads={("BTCUSDT", "oid-1"): {"status": "FILLED"}},
    )
    state = RuntimeState(cycle=6, cash=1000.0)
    state.positions["BTCUSDT"] = Position(symbol="BTCUSDT", side="long", qty=0.2, entry_price=100.0, leverage=2.0, opened_cycle=1)
    state.exchange_orders.append(
        ExchangeOrderRecord(
            trace_id="cycle:6:test",
            cycle=6,
            symbol="BTCUSDT",
            action="open_long",
            requested_qty=0.2,
            executed_qty=0.15,
            requested_price=100.0,
            avg_price=100.0,
            status="PARTIALLY_FILLED",
            provider="binance_futures",
            exchange_order_id="oid-1",
            side="BUY",
            order_type="MARKET",
            message="local snapshot",
            status_history=["SUBMITTED", "PARTIALLY_FILLED"],
        )
    )

    reconciliation = provider.reconcile(trace_id="cycle:6:test", state=state)
    repaired = provider.repair(trace_id="cycle:6:test", state=state, reconciliation=reconciliation)

    assert repaired.repaired is True
    assert repaired.status == "synced"
    assert state.cash == 800.0
    assert state.positions["BTCUSDT"].side == "short"
    assert state.positions["BTCUSDT"].qty == 0.15
    assert state.positions["BTCUSDT"].entry_source == "reconciled_remote"
    assert state.exchange_orders[0].status == "FILLED"
    assert state.exchange_orders[0].status_history == ["SUBMITTED", "PARTIALLY_FILLED", "FILLED"]
    assert state.exchange_orders[0].is_active is False
    assert any("cash synced" in action for action in repaired.repair_actions)
    assert any("position synced BTCUSDT" in action for action in repaired.repair_actions)
    assert any("order status synced oid-1" in action for action in repaired.repair_actions)


def test_binance_repair_imports_remote_only_open_order():
    provider = DummyBinanceProvider(
        payload={
            "assets": [{"asset": "USDT", "availableBalance": "900.0"}],
            "positions": [],
        },
        open_order_payloads={
            "ETHUSDT": [
                {
                    "symbol": "ETHUSDT",
                    "orderId": "oid-remote",
                    "status": "NEW",
                    "side": "BUY",
                    "type": "LIMIT",
                    "reduceOnly": False,
                    "origQty": "1.25",
                    "executedQty": "0",
                    "price": "2100.0",
                    "avgPrice": "0",
                }
            ]
        },
    )
    state = RuntimeState(cycle=7, cash=900.0)

    report = provider.reconcile(trace_id="cycle:7:test", state=state)
    repaired = provider.repair(trace_id="cycle:7:test", state=state, reconciliation=report)

    assert any("remote-only open order oid-remote" in warning for warning in report.warnings)
    assert repaired.repaired is True
    assert any("remote open order imported oid-remote" in action for action in repaired.repair_actions)
    assert any(order.exchange_order_id == "oid-remote" for order in state.exchange_orders)
    imported = next(order for order in state.exchange_orders if order.exchange_order_id == "oid-remote")
    assert imported.symbol == "ETHUSDT"
    assert imported.action == "open_long"
    assert imported.status == "NEW"
    assert imported.is_active is True
    assert imported.order_type == "LIMIT"
    assert imported.source == "reconciled_remote"


def test_binance_repair_auto_cancels_remote_only_open_order_when_enabled():
    provider = DummyBinanceProvider(
        payload={
            "assets": [{"asset": "USDT", "availableBalance": "900.0"}],
            "positions": [],
        },
        open_order_payloads={
            "ETHUSDT": [
                {
                    "symbol": "ETHUSDT",
                    "orderId": "oid-cancel-me",
                    "status": "NEW",
                    "side": "BUY",
                    "type": "LIMIT",
                    "reduceOnly": False,
                    "origQty": "1.25",
                    "executedQty": "0",
                    "price": "2100.0",
                    "avgPrice": "0",
                }
            ]
        },
        auto_cancel_remote_only_orders=True,
    )
    state = RuntimeState(cycle=8, cash=900.0)

    report = provider.reconcile(trace_id="cycle:8:test", state=state)
    repaired = provider.repair(trace_id="cycle:8:test", state=state, reconciliation=report)

    assert any("remote-only open order oid-cancel-me" in warning for warning in report.warnings)
    assert provider.canceled_order_ids == ["oid-cancel-me"]
    assert any("remote open order canceled oid-cancel-me" in action for action in repaired.repair_actions)
    canceled = next(order for order in state.exchange_orders if order.exchange_order_id == "oid-cancel-me")
    assert canceled.action == "cancel_order"
    assert canceled.status == "CANCELED"
    assert canceled.is_active is False
    assert canceled.status_history == ["NEW", "CANCELED"]


def test_binance_repair_respects_remote_only_cancel_min_cycle_age():
    provider = DummyBinanceProvider(
        payload={
            "assets": [{"asset": "USDT", "availableBalance": "900.0"}],
            "positions": [],
        },
        open_order_payloads={
            "ETHUSDT": [
                {
                    "symbol": "ETHUSDT",
                    "orderId": "oid-aged",
                    "status": "NEW",
                    "side": "BUY",
                    "type": "LIMIT",
                    "reduceOnly": False,
                    "origQty": "1.25",
                    "executedQty": "0",
                    "price": "2100.0",
                    "avgPrice": "0",
                }
            ]
        },
        auto_cancel_remote_only_orders=True,
        remote_only_cancel_min_cycle_age=2,
    )
    state = RuntimeState(cycle=6, cash=900.0)
    state.exchange_orders.append(
        ExchangeOrderRecord(
            trace_id="cycle:5:test",
            cycle=5,
            symbol="ETHUSDT",
            action="open_long",
            requested_qty=1.25,
            executed_qty=0.0,
            requested_price=2100.0,
            avg_price=None,
            status="NEW",
            provider="binance_futures",
            is_active=True,
            exchange_order_id="oid-aged",
            side="BUY",
            order_type="LIMIT",
            message="imported remote order",
            status_history=["NEW"],
            source="reconciled_remote",
        )
    )

    report1 = provider.reconcile(trace_id="cycle:6:test", state=state)
    repaired1 = provider.repair(trace_id="cycle:6:test", state=state, reconciliation=report1)

    assert provider.canceled_order_ids == []
    assert not any("remote open order canceled oid-aged" in action for action in repaired1.repair_actions)
    assert state.exchange_orders[0].status == "NEW"
    assert state.exchange_orders[0].is_active is True

    state.cycle = 7
    report2 = provider.reconcile(trace_id="cycle:7:test", state=state)
    repaired2 = provider.repair(trace_id="cycle:7:test", state=state, reconciliation=report2)

    assert provider.canceled_order_ids == ["oid-aged"]
    assert any("remote open order canceled oid-aged" in action for action in repaired2.repair_actions)
    assert state.exchange_orders[0].status == "CANCELED"
    assert state.exchange_orders[0].is_active is False


def test_binance_repair_auto_cancel_conflicts_only_cancels_conflicting_order():
    provider = DummyBinanceProvider(
        payload={
            "assets": [{"asset": "USDT", "availableBalance": "900.0"}],
            "positions": [],
        },
        open_order_payloads={
            "BTCUSDT": [
                {
                    "symbol": "BTCUSDT",
                    "orderId": "oid-conflict",
                    "status": "NEW",
                    "side": "BUY",
                    "type": "LIMIT",
                    "reduceOnly": False,
                    "origQty": "1.0",
                    "executedQty": "0",
                    "price": "100.0",
                    "avgPrice": "0",
                }
            ]
        },
        auto_cancel_remote_only_orders=True,
        auto_cancel_remote_only_conflicts_only=True,
    )
    state = RuntimeState(cycle=9, cash=900.0)
    state.positions["BTCUSDT"] = Position(symbol="BTCUSDT", side="short", qty=1.0, entry_price=101.0, leverage=2.0, opened_cycle=7)

    report = provider.reconcile(trace_id="cycle:9:test", state=state)
    repaired = provider.repair(trace_id="cycle:9:test", state=state, reconciliation=report)

    assert any("remote-only open order oid-conflict" in warning for warning in report.warnings)
    assert provider.canceled_order_ids == ["oid-conflict"]
    assert any("remote open order canceled oid-conflict" in action for action in repaired.repair_actions)
    canceled = next(order for order in state.exchange_orders if order.exchange_order_id == "oid-conflict")
    assert canceled.status == "CANCELED"
    assert canceled.is_active is False


def test_binance_repair_auto_cancel_conflicts_only_keeps_non_conflicting_order():
    provider = DummyBinanceProvider(
        payload={
            "assets": [{"asset": "USDT", "availableBalance": "900.0"}],
            "positions": [],
        },
        open_order_payloads={
            "BTCUSDT": [
                {
                    "symbol": "BTCUSDT",
                    "orderId": "oid-same-side",
                    "status": "NEW",
                    "side": "BUY",
                    "type": "LIMIT",
                    "reduceOnly": False,
                    "origQty": "1.0",
                    "executedQty": "0",
                    "price": "100.0",
                    "avgPrice": "0",
                }
            ]
        },
        auto_cancel_remote_only_orders=True,
        auto_cancel_remote_only_conflicts_only=True,
    )
    state = RuntimeState(cycle=10, cash=900.0)
    state.positions["BTCUSDT"] = Position(symbol="BTCUSDT", side="long", qty=1.0, entry_price=99.0, leverage=2.0, opened_cycle=8)

    report = provider.reconcile(trace_id="cycle:10:test", state=state)
    repaired = provider.repair(trace_id="cycle:10:test", state=state, reconciliation=report)

    assert any("remote-only open order oid-same-side" in warning for warning in report.warnings)
    assert provider.canceled_order_ids == []
    assert not any("remote open order canceled oid-same-side" in action for action in repaired.repair_actions)
    imported = next(order for order in state.exchange_orders if order.exchange_order_id == "oid-same-side")
    assert imported.status == "NEW"
    assert imported.is_active is True


def test_orchestrator_auto_sync_applies_repair_when_enabled():
    cfg = RuntimeConfig(reconciliation_auto_sync=True)
    bot = MultiAgentTradeBot(cfg=cfg, execution_provider=MismatchRepairProvider())

    result = asyncio.run(bot.run_cycle())

    assert result.details["reconciliation"]["repaired"] is True
    assert bot.state.cash == 500.0
    assert bot.state.positions == {}
