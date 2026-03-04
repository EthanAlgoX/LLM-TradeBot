from __future__ import annotations

import asyncio
import json
import re
import sqlite3

from config import RuntimeConfig
from contracts import CycleResult
from events import RuntimeEvent
from orchestrator import MultiAgentTradeBot
from state import Position, RuntimeState, TradeRecord
from storage import SQLiteStateStore


def test_sqlite_state_store_roundtrip(tmp_path):
    db = tmp_path / "tradebot.db"
    store = SQLiteStateStore(str(db))

    state = RuntimeState(cycle=3, cash=12345.6, reflection_hint="keep risk low")
    state.positions["BTCUSDT"] = Position(symbol="BTCUSDT", side="long", qty=0.12, entry_price=45000.0, leverage=2.0, opened_cycle=2)
    state.prices["BTCUSDT"] = 46000.0
    state.trades.append(TradeRecord(cycle=2, symbol="BTCUSDT", action="open_long", qty=0.12, price=45000.0, pnl=0.0))

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
    assert loaded.reflection_hint == "keep risk low"
    assert "BTCUSDT" in loaded.positions
    assert loaded.prices["BTCUSDT"] == 46000.0
    assert len(loaded.trades) == 1

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
