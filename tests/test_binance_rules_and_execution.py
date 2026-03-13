from __future__ import annotations

from agents.execution import ExecutionPlannerAgent
from config import RuntimeConfig
from contracts import ProposedAction, RiskDecision
from providers.binance_rules import BinanceSymbolRules, format_quantity, quantize_quantity
from providers.execution import BinanceCredentials, BinanceFuturesExecutionProvider
from state import ExchangeOrderRecord, Position, RuntimeState


class StaticRulesProvider:
    def __init__(self, rules: BinanceSymbolRules | None) -> None:
        self.rules = rules

    def get_symbol_rules(self, symbol: str) -> BinanceSymbolRules | None:  # noqa: ARG002
        return self.rules


class DummyLiveProvider(BinanceFuturesExecutionProvider):
    def __init__(self, rules: BinanceSymbolRules) -> None:
        super().__init__(
            credentials=BinanceCredentials(api_key="k", api_secret="s"),
            live_confirm_token="YES",
            rules_provider=StaticRulesProvider(rules),
        )
        self.last_order_params: dict[str, str] | None = None
        self.last_cancel_params: dict[str, str] | None = None

    def _signed_post(self, path: str, params: dict[str, str]) -> dict[str, object]:  # noqa: ARG002
        self.last_order_params = params
        return {"avgPrice": "100", "orderId": "oid-1", "executedQty": params["quantity"], "status": "FILLED"}

    def _signed_delete(self, path: str, params: dict[str, str]) -> dict[str, object]:  # noqa: ARG002
        self.last_cancel_params = params
        return {"orderId": params["orderId"], "status": "CANCELED"}


class DummyFailingLiveProvider(DummyLiveProvider):
    def _signed_post(self, path: str, params: dict[str, str]) -> dict[str, object]:  # noqa: ARG002
        self.last_order_params = params
        raise OSError("boom")


def _proposal(action: str, qty: float, price: float = 100.0) -> ProposedAction:
    return ProposedAction(
        schema_version="v2",
        trace_id="t1",
        symbol="BTCUSDT",
        source="rule",
        action=action,
        confidence=80.0,
        reason="test",
        order_params={
            "entry_price": price,
            "stop_loss": price * 0.98,
            "take_profit": price * 1.02,
            "leverage": 2.0,
            "quantity": qty,
        },
    )


def test_quantize_quantity_and_format():
    rules = BinanceSymbolRules(symbol="BTCUSDT", step_size=0.001, min_qty=0.01, max_qty=100.0, min_notional=5.0, qty_precision=3)

    assert quantize_quantity(0.01994, rules) == 0.019
    assert quantize_quantity(0.0099, rules) == 0.0
    assert format_quantity(0.019, 3) == "0.019"


def test_execution_planner_close_uses_position_qty():
    cfg = RuntimeConfig()
    planner = ExecutionPlannerAgent()
    state = RuntimeState(cash=10_000)
    state.positions["BTCUSDT"] = Position(symbol="BTCUSDT", side="long", qty=0.1234, entry_price=100.0, leverage=2.0, opened_cycle=1)

    proposal = _proposal("close_long", qty=0.001)
    risk = RiskDecision(schema_version="v2", trace_id="t1", symbol="BTCUSDT", passed=True, risk_level="safe", blocked_reason=None)
    planned = planner.plan(proposal, risk=risk, cfg=cfg, state=state)

    assert planned.order_params["quantity"] == 0.1234


def test_live_provider_adjusts_qty_with_symbol_rules():
    rules = BinanceSymbolRules(symbol="BTCUSDT", step_size=0.001, min_qty=0.01, max_qty=100.0, min_notional=5.0, qty_precision=3)
    provider = DummyLiveProvider(rules)
    state = RuntimeState(cycle=2, cash=10_000)

    result = provider.execute(trace_id="t1", planned=_proposal("open_long", qty=0.01994, price=300.0), state=state)

    assert result.status == "success"
    assert provider.last_order_params is not None
    assert provider.last_order_params["quantity"] == "0.019"
    assert len(state.exchange_orders) == 1
    assert state.exchange_orders[0].exchange_order_id == "oid-1"
    assert state.execution_reports[0].exchange_order_id == "oid-1"


def test_live_provider_blocks_below_min_notional():
    rules = BinanceSymbolRules(symbol="BTCUSDT", step_size=0.001, min_qty=0.01, max_qty=100.0, min_notional=5.0, qty_precision=3)
    provider = DummyLiveProvider(rules)
    state = RuntimeState(cycle=2, cash=10_000)

    result = provider.execute(trace_id="t1", planned=_proposal("open_long", qty=0.02, price=100.0), state=state)

    assert result.status == "failed"
    assert "notional below min rule" in result.message


def test_live_provider_marks_submitted_order_rejected_on_post_failure():
    rules = BinanceSymbolRules(symbol="BTCUSDT", step_size=0.001, min_qty=0.01, max_qty=100.0, min_notional=5.0, qty_precision=3)
    provider = DummyFailingLiveProvider(rules)
    state = RuntimeState(cycle=2, cash=10_000)

    result = provider.execute(trace_id="t1", planned=_proposal("open_long", qty=0.02, price=300.0), state=state)

    assert result.status == "failed"
    assert len(state.exchange_orders) == 1
    assert state.exchange_orders[0].status == "REJECTED"
    assert state.exchange_orders[0].status_history == ["SUBMITTED", "REJECTED"]
    assert state.execution_reports[0].exchange_order_id == state.exchange_orders[0].exchange_order_id


def test_live_provider_can_cancel_active_order():
    rules = BinanceSymbolRules(symbol="BTCUSDT", step_size=0.001, min_qty=0.01, max_qty=100.0, min_notional=5.0, qty_precision=3)
    provider = DummyLiveProvider(rules)
    state = RuntimeState(cycle=2, cash=10_000)
    state.exchange_orders.append(
        ExchangeOrderRecord(
            trace_id="t-pending",
            cycle=2,
            symbol="BTCUSDT",
            action="open_long",
            requested_qty=0.02,
            executed_qty=0.0,
            requested_price=300.0,
            status="NEW",
            provider="binance_futures",
            is_active=True,
            exchange_order_id="oid-active",
            side="BUY",
            order_type="LIMIT",
            message="pending remote order",
            status_history=["NEW"],
        )
    )

    result = provider.execute(trace_id="t-cancel", planned=_proposal("cancel_order", qty=0.0, price=300.0), state=state)

    assert result.status == "success"
    assert provider.last_cancel_params == {"symbol": "BTCUSDT", "orderId": "oid-active"}
    assert state.exchange_orders[0].status == "CANCELED"
    assert state.exchange_orders[0].is_active is False
    assert state.exchange_orders[0].status_history == ["NEW", "CANCELED"]
