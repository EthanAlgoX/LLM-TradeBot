from __future__ import annotations

import asyncio
import sqlite3

from tradebot.config import RuntimeConfig
from tradebot.contracts import CycleResult
from tradebot.events import RuntimeEvent
from tradebot.orchestrator import MultiAgentTradeBot
from tradebot.state import Position, RuntimeState, TradeRecord
from tradebot.storage import SQLiteStateStore


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
