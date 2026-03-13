from __future__ import annotations

from agents.execution import ExecutionAgent
from backtest import BacktestExecutionProvider
from config import RuntimeConfig
from contracts import ProposedAction
from providers.execution import SimExecutionProvider
from state import ExchangeOrderRecord, RuntimeState


def _proposal(action: str, *, qty: float = 1.0, price: float = 100.0, leverage: float = 2.0) -> ProposedAction:
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
            "leverage": leverage,
            "quantity": qty,
        },
    )


def test_sim_execution_records_report_for_successful_open_and_close():
    provider = SimExecutionProvider()
    state = RuntimeState(cycle=1, cash=10_000.0)

    open_result = provider.execute(trace_id="t-open", planned=_proposal("open_long"), state=state)
    assert open_result.status == "success"
    assert len(state.order_intents) == 1
    assert len(state.exchange_orders) == 1
    assert len(state.fills) == 1
    assert state.order_intents[0].action == "open_long"
    assert state.exchange_orders[0].status == "FILLED"
    assert state.exchange_orders[0].status_history == ["SUBMITTED", "FILLED"]
    assert state.exchange_orders[0].is_active is False
    assert state.fills[0].qty == 1.0
    assert state.fills[0].exchange_order_id == state.exchange_orders[0].exchange_order_id
    assert len(state.execution_reports) == 1
    assert state.execution_reports[0].provider == "sim"
    assert state.execution_reports[0].status == "success"
    assert state.execution_reports[0].filled_qty == 1.0
    assert state.execution_reports[0].exchange_order_id == state.exchange_orders[0].exchange_order_id

    state.cycle = 2
    close_result = provider.execute(trace_id="t-close", planned=_proposal("close_long"), state=state)
    assert close_result.status == "success"
    assert len(state.order_intents) == 2
    assert len(state.exchange_orders) == 2
    assert len(state.fills) == 2
    assert len(state.execution_reports) == 2
    assert state.execution_reports[-1].reduce_only is True
    assert state.execution_reports[-1].fill_price == 100.0
    assert state.exchange_orders[-1].reduce_only is True
    assert state.exchange_orders[-1].status_history == ["SUBMITTED", "FILLED"]
    assert state.exchange_orders[-1].is_active is False


def test_backtest_execution_records_failed_report_on_invalid_quantity():
    provider = BacktestExecutionProvider(fee_bps=0.0, slippage_bps=0.0)
    state = RuntimeState(cycle=1, cash=10_000.0)

    result = provider.execute(trace_id="t-fail", planned=_proposal("open_long", qty=0.0), state=state)

    assert result.status == "failed"
    assert len(state.order_intents) == 1
    assert len(state.exchange_orders) == 0
    assert len(state.fills) == 0
    assert len(state.execution_reports) == 1
    report = state.execution_reports[0]
    assert report.provider == "backtest"
    assert report.status == "failed"
    assert report.message == "invalid quantity"


def test_execution_agent_blocks_new_action_when_active_order_exists():
    agent = ExecutionAgent(provider=SimExecutionProvider())
    state = RuntimeState(cycle=1, cash=10_000.0)
    state.exchange_orders.append(
        ExchangeOrderRecord(
            trace_id="t-pending",
            cycle=1,
            symbol="BTCUSDT",
            action="open_long",
            requested_qty=1.0,
            executed_qty=0.5,
            requested_price=100.0,
            avg_price=100.0,
            status="NEW",
            provider="binance_futures",
            is_active=True,
            exchange_order_id="oid-pending",
            side="BUY",
            order_type="LIMIT",
            message="pending remote order",
            status_history=["NEW"],
        )
    )

    result = agent.execute(trace_id="t-block", planned=_proposal("open_long"), state=state)

    assert result.status == "failed"
    assert result.message == "pending exchange order exists for symbol"


def test_sim_provider_can_cancel_active_order():
    provider = SimExecutionProvider()
    state = RuntimeState(cycle=1, cash=10_000.0)
    state.exchange_orders.append(
        ExchangeOrderRecord(
            trace_id="t-pending",
            cycle=1,
            symbol="BTCUSDT",
            action="open_long",
            requested_qty=1.0,
            executed_qty=0.0,
            requested_price=100.0,
            status="NEW",
            provider="sim",
            is_active=True,
            exchange_order_id="sim-pending-1",
            side="BUY",
            order_type="LIMIT",
            message="pending local order",
            status_history=["NEW"],
        )
    )

    result = provider.execute(trace_id="t-cancel", planned=_proposal("cancel_order"), state=state)

    assert result.status == "success"
    assert state.exchange_orders[0].status == "CANCELED"
    assert state.exchange_orders[0].is_active is False
    assert state.exchange_orders[0].status_history == ["NEW", "CANCELED"]
    assert state.execution_reports[-1].exchange_order_id == "sim-pending-1"


def test_execution_agent_allows_cancel_order_when_active_order_exists():
    agent = ExecutionAgent(provider=SimExecutionProvider())
    state = RuntimeState(cycle=1, cash=10_000.0)
    state.exchange_orders.append(
        ExchangeOrderRecord(
            trace_id="t-pending",
            cycle=1,
            symbol="BTCUSDT",
            action="open_long",
            requested_qty=1.0,
            executed_qty=0.0,
            requested_price=100.0,
            status="NEW",
            provider="sim",
            is_active=True,
            exchange_order_id="sim-pending-2",
            side="BUY",
            order_type="LIMIT",
            message="pending local order",
            status_history=["NEW"],
        )
    )

    result = agent.execute(trace_id="t-cancel", planned=_proposal("cancel_order"), state=state)

    assert result.status == "success"
    assert state.exchange_orders[0].status == "CANCELED"


def test_execution_agent_auto_cancels_conflicting_pending_order_before_execute():
    agent = ExecutionAgent(provider=SimExecutionProvider())
    cfg = RuntimeConfig(execution_auto_cancel_conflicting_pending_orders=True)
    state = RuntimeState(cycle=1, cash=10_000.0)
    state.exchange_orders.append(
        ExchangeOrderRecord(
            trace_id="t-pending",
            cycle=1,
            symbol="BTCUSDT",
            action="open_short",
            requested_qty=1.0,
            executed_qty=0.0,
            requested_price=100.0,
            status="NEW",
            provider="sim",
            reduce_only=False,
            is_active=True,
            exchange_order_id="sim-pending-3",
            side="SELL",
            order_type="LIMIT",
            message="pending short order",
            status_history=["NEW"],
        )
    )

    result = agent.execute_with_pending_order_resolution(
        trace_id="t-auto-cancel",
        planned=_proposal("open_long"),
        state=state,
        cfg=cfg,
    )

    assert result.status == "success"
    assert state.exchange_orders[0].status == "CANCELED"
    assert state.exchange_orders[0].is_active is False
    assert state.exchange_orders[-1].action == "open_long"
    assert state.positions["BTCUSDT"].side == "long"
    resolutions = agent.consume_resolution_records()
    assert len(resolutions) == 1
    assert resolutions[0]["kind"] == "cancel_conflicting_pending_order"
    assert resolutions[0]["resolution_result"]["status"] == "success"


def test_execution_agent_does_not_auto_cancel_same_side_pending_order():
    agent = ExecutionAgent(provider=SimExecutionProvider())
    cfg = RuntimeConfig(execution_auto_cancel_conflicting_pending_orders=True)
    state = RuntimeState(cycle=1, cash=10_000.0)
    state.exchange_orders.append(
        ExchangeOrderRecord(
            trace_id="t-pending",
            cycle=1,
            symbol="BTCUSDT",
            action="open_long",
            requested_qty=1.0,
            executed_qty=0.0,
            requested_price=100.0,
            status="NEW",
            provider="sim",
            reduce_only=False,
            is_active=True,
            exchange_order_id="sim-pending-4",
            side="BUY",
            order_type="LIMIT",
            message="pending long order",
            status_history=["NEW"],
        )
    )

    result = agent.execute_with_pending_order_resolution(
        trace_id="t-no-auto-cancel",
        planned=_proposal("open_long"),
        state=state,
        cfg=cfg,
    )

    assert result.status == "failed"
    assert result.message == "pending exchange order exists for symbol"
    assert state.exchange_orders[0].status == "NEW"
    assert state.exchange_orders[0].is_active is True
    assert agent.consume_resolution_records() == []
