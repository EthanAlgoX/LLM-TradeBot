from __future__ import annotations

import asyncio
import json
import re
import sqlite3

from config import RuntimeConfig
from contracts import CycleResult
from events import RuntimeEvent
from orchestrator import MultiAgentTradeBot
from state import ExchangeOrderRecord, ExecutionReportRecord, FillRecord, OrderIntentRecord, Position, ReconciliationReportRecord, RuntimeState, TradeRecord
from storage import SQLiteStateStore


def test_sqlite_state_store_roundtrip(tmp_path):
    db = tmp_path / "tradebot.db"
    store = SQLiteStateStore(str(db))

    state = RuntimeState(cycle=3, cash=12345.6, peak_equity=13000.0, reflection_hint="keep risk low")
    state.positions["BTCUSDT"] = Position(
        symbol="BTCUSDT",
        side="long",
        qty=0.12,
        entry_price=45000.0,
        leverage=2.0,
        opened_cycle=2,
        stop_loss=44000.0,
        take_profit=47000.0,
        entry_source="rule",
        entry_confidence=82.5,
        entry_reason="trend continuation",
    )
    state.prices["BTCUSDT"] = 46000.0
    state.trades.append(
        TradeRecord(
            cycle=2,
            symbol="BTCUSDT",
            action="open_long",
            qty=0.12,
            price=45000.0,
            pnl=0.0,
            realized_pnl=0.0,
            fee=12.5,
            event_type="open",
            source="rule",
            confidence=82.5,
            reason="trend continuation",
        )
    )
    state.order_intents.append(
        OrderIntentRecord(
            trace_id="cycle:3:test",
            cycle=3,
            symbol="BTCUSDT",
            action="open_long",
            requested_qty=0.12,
            requested_price=45000.0,
            leverage=2.0,
            provider="sim",
            source="rule",
            confidence=82.5,
            reason="trend continuation",
        )
    )
    state.exchange_orders.append(
        ExchangeOrderRecord(
            trace_id="cycle:3:test",
            cycle=3,
            symbol="BTCUSDT",
            action="open_long",
            requested_qty=0.12,
            executed_qty=0.12,
            requested_price=45000.0,
            avg_price=45010.0,
            status="FILLED",
            provider="sim",
            is_active=False,
            exchange_order_id="sim:cycle:3:test:0",
            side="BUY",
            order_type="MARKET",
            message="sim market order filled",
            status_history=["SUBMITTED", "FILLED"],
            source="rule",
            confidence=82.5,
            reason="trend continuation",
        )
    )
    state.fills.append(
        FillRecord(
            trace_id="cycle:3:test",
            cycle=3,
            symbol="BTCUSDT",
            action="open_long",
            qty=0.12,
            price=45010.0,
            fee=12.5,
            provider="sim",
            liquidity="taker",
            message="sim open fill",
        )
    )
    state.execution_reports.append(
        ExecutionReportRecord(
            trace_id="cycle:3:test",
            cycle=3,
            symbol="BTCUSDT",
            action="open_long",
            requested_qty=0.12,
            filled_qty=0.12,
            requested_price=45000.0,
            fill_price=45010.0,
            status="success",
            provider="sim",
            message="long opened",
            source="rule",
            confidence=82.5,
            reason="trend continuation",
        )
    )
    state.reconciliation_reports.append(
        ReconciliationReportRecord(
            trace_id="cycle:3:test",
            cycle=3,
            provider="sim",
            status="synced",
            local_cash=12345.6,
            remote_cash=12345.6,
            local_positions={"BTCUSDT": 0.12},
            remote_positions={"BTCUSDT": 0.12},
            local_order_statuses={"sim:cycle:3:test:0": "FILLED"},
            remote_order_statuses={"sim:cycle:3:test:0": "FILLED"},
            message="local reconciliation",
        )
    )
    state.set_cooldown("BTCUSDT", 6)

    cycle_result = CycleResult(
        schema_version="v2",
        cycle=3,
        trace_id="cycle:3:test",
        selected_symbols=["BTCUSDT", "ETHUSDT"],
        action="hold",
        status="wait",
        details={"cash": state.cash},
    )

    events = [
        RuntimeEvent(trace_id="cycle:3:test", stage="selector", phase="start", agent="selector", data={}, ts="2026-03-05T00:00:00Z"),
        RuntimeEvent(trace_id="cycle:3:test", stage="selector", phase="end", agent="selector", data={"top_n": 10}, ts="2026-03-05T00:00:01Z"),
    ]
    store.persist(state=state, cycle_result=cycle_result, events=events)
    loaded = store.load_runtime_state(initial_cash=100_000.0)

    assert loaded.cycle == 3
    assert loaded.cash == 12345.6
    assert loaded.peak_equity == 13000.0
    assert loaded.reflection_hint == "keep risk low"
    assert "BTCUSDT" in loaded.positions
    assert loaded.positions["BTCUSDT"].entry_source == "rule"
    assert loaded.positions["BTCUSDT"].stop_loss == 44000.0
    assert loaded.prices["BTCUSDT"] == 46000.0
    assert len(loaded.trades) == 1
    assert loaded.trades[0].fee == 12.5
    assert loaded.trades[0].event_type == "open"
    assert len(loaded.order_intents) == 1
    assert loaded.order_intents[0].provider == "sim"
    assert len(loaded.exchange_orders) == 1
    assert loaded.exchange_orders[0].status == "FILLED"
    assert loaded.exchange_orders[0].is_active is False
    assert loaded.exchange_orders[0].exchange_order_id == "sim:cycle:3:test:0"
    assert loaded.exchange_orders[0].status_history == ["SUBMITTED", "FILLED"]
    assert len(loaded.fills) == 1
    assert loaded.fills[0].price == 45010.0
    assert len(loaded.execution_reports) == 1
    assert loaded.execution_reports[0].provider == "sim"
    assert loaded.execution_reports[0].fill_price == 45010.0
    assert len(loaded.reconciliation_reports) == 1
    assert loaded.reconciliation_reports[0].status == "synced"
    assert loaded.reconciliation_reports[0].local_order_statuses == {"sim:cycle:3:test:0": "FILLED"}
    assert loaded.symbol_cooldowns["BTCUSDT"] == 6

    with sqlite3.connect(str(db)) as conn:
        row = conn.execute("SELECT count(*) FROM cycles").fetchone()
        erow = conn.execute("SELECT count(*) FROM events").fetchone()
    assert row is not None
    assert int(row[0]) == 1
    assert erow is not None
    assert int(erow[0]) == 2

    latest = store.latest_trace_id()
    assert latest == "cycle:3:test"
    summary = store.load_cycle_summary("cycle:3:test")
    assert summary is not None
    assert summary["cycle"] == 3
    assert summary["status"] == "wait"
    loaded_events = store.load_events("cycle:3:test")
    assert len(loaded_events) == 2
    assert loaded_events[1]["stage"] == "selector"
    assert loaded_events[1]["phase"] == "end"
    assert len(store.load_events("cycle:3:test", stage="selector")) == 2
    assert len(store.load_events("cycle:3:test", stage="analysis")) == 0
    assert len(store.load_events("cycle:3:test", limit=1)) == 1
    assert store.load_events("cycle:3:test", limit=1)[0]["seq"] == 1
    assert len(store.load_events("cycle:3:test", stage="selector", limit=1)) == 1
    assert store.load_events("cycle:3:test", stage="selector", limit=1)[0]["phase"] == "end"


def test_bot_persistence_recovers_cycle(tmp_path):
    db = tmp_path / "tradebot.db"
    cfg = RuntimeConfig(persistence_enabled=True, persistence_path=str(db))

    bot1 = MultiAgentTradeBot(cfg=cfg)
    result1 = asyncio.run(bot1.run_cycle())
    assert result1.cycle == 1

    bot2 = MultiAgentTradeBot(cfg=cfg)
    assert bot2.state.cycle == 1

    result2 = asyncio.run(bot2.run_cycle())
    assert result2.cycle == 2


def test_store_reset_clears_all_tables(tmp_path):
    db = tmp_path / "tradebot.db"
    cfg = RuntimeConfig(persistence_enabled=True, persistence_path=str(db))

    bot1 = MultiAgentTradeBot(cfg=cfg)
    _ = asyncio.run(bot1.run_cycle())
    store = SQLiteStateStore(str(db))
    store.reset()

    bot2 = MultiAgentTradeBot(cfg=cfg)
    assert bot2.state.cycle == 0
    result = asyncio.run(bot2.run_cycle())
    assert result.cycle == 1


def test_persist_writes_trace_files(tmp_path):
    db = tmp_path / "tradebot.db"
    cfg = RuntimeConfig(persistence_enabled=True, persistence_path=str(db))

    bot = MultiAgentTradeBot(cfg=cfg)
    result = asyncio.run(bot.run_cycle())

    safe_trace = re.sub(r"[^A-Za-z0-9._-]+", "_", result.trace_id)
    trace_dir = tmp_path / "traces" / safe_trace
    assert trace_dir.exists()

    inputs = trace_dir / "inputs.json"
    agent_io = trace_dir / "agent_io.jsonl"
    trades = trace_dir / "trades.json"
    cycle_result = trace_dir / "cycle_result.json"
    state_snapshot = trace_dir / "state_snapshot.json"
    latest_trace = tmp_path / "traces" / "latest_trace_id.txt"

    assert inputs.exists()
    assert agent_io.exists()
    assert trades.exists()
    assert cycle_result.exists()
    assert state_snapshot.exists()
    assert latest_trace.exists()
    assert latest_trace.read_text(encoding="utf-8") == result.trace_id

    inputs_data = json.loads(inputs.read_text(encoding="utf-8"))
    assert inputs_data["trace_id"] == result.trace_id
    assert inputs_data["cycle"] == result.cycle
    assert isinstance(inputs_data["selected_symbols"], list)
    assert isinstance(inputs_data["market_snapshots"], list)

    lines = [x for x in agent_io.read_text(encoding="utf-8").splitlines() if x.strip()]
    assert lines
    first_event = json.loads(lines[0])
    assert first_event["trace_id"] == result.trace_id
    assert "stage" in first_event
    assert "phase" in first_event

    trades_data = json.loads(trades.read_text(encoding="utf-8"))
    assert trades_data["trace_id"] == result.trace_id
    assert trades_data["cycle"] == result.cycle
    assert "all_trades" in trades_data
    assert "cycle_trades" in trades_data
    assert "all_order_intents" in trades_data
    assert "cycle_order_intents" in trades_data
    assert "all_exchange_orders" in trades_data
    assert "cycle_exchange_orders" in trades_data
    assert "all_fills" in trades_data
    assert "cycle_fills" in trades_data
    assert "all_execution_reports" in trades_data
    assert "cycle_execution_reports" in trades_data
    assert "all_reconciliation_reports" in trades_data
    assert "cycle_reconciliation_reports" in trades_data

    state_snapshot_data = json.loads(state_snapshot.read_text(encoding="utf-8"))
    assert "peak_equity" in state_snapshot_data
    assert state_snapshot_data["peak_equity"] >= state_snapshot_data["cash"]
    assert "order_intents" in state_snapshot_data
    assert "exchange_orders" in state_snapshot_data
    assert "fills" in state_snapshot_data
    assert "execution_reports" in state_snapshot_data
    assert "reconciliation_reports" in state_snapshot_data
    assert "symbol_cooldowns" in state_snapshot_data
