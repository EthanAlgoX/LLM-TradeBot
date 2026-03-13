from __future__ import annotations

from datetime import datetime

from backtest import BacktestBar, BacktestExecutionProvider, CSVBacktestDataset
from contracts import ProposedAction
from state import RuntimeState


def _proposal(action: str, *, qty: float = 2.0, price: float = 100.0, leverage: float = 2.0) -> ProposedAction:
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


def test_backtest_records_partial_fill_chunks():
    bars = [
        BacktestBar(ts=datetime(2026, 1, 1, 0, 0, 0), symbol="BTCUSDT", close=100.0, quote_volume=100.0),
        BacktestBar(ts=datetime(2026, 1, 1, 1, 0, 0), symbol="BTCUSDT", close=100.0, quote_volume=100.0),
        BacktestBar(ts=datetime(2026, 1, 1, 2, 0, 0), symbol="BTCUSDT", close=100.0, quote_volume=100.0),
    ]
    dataset = CSVBacktestDataset(bars_by_symbol={"BTCUSDT": bars}, steps=3, source_path="synthetic.csv")
    provider = BacktestExecutionProvider(
        fee_bps=0.0,
        slippage_bps=0.0,
        dataset=dataset,
        max_open_notional_share_of_bar=0.5,
        max_open_retries=1,
    )
    state = RuntimeState(cycle=1, cash=1_000.0)

    result = provider.execute(trace_id="t-open", planned=_proposal("open_long", qty=1.2), state=state)

    assert result.status == "success"
    assert len(state.order_intents) == 1
    assert len(state.exchange_orders) == 1
    assert state.exchange_orders[0].status == "PARTIALLY_FILLED"
    assert state.exchange_orders[0].executed_qty == 1.0
    assert state.exchange_orders[0].status_history == ["SUBMITTED", "PARTIALLY_FILLED"]
    assert state.exchange_orders[0].is_active is False
    assert len(state.fills) == 2
    assert sum(fill.qty for fill in state.fills) == 1.0
    assert {fill.exchange_order_id for fill in state.fills} == {state.exchange_orders[0].exchange_order_id}
