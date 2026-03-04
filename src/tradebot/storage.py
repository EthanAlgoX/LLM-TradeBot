from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import TYPE_CHECKING

from tradebot.contracts import CycleResult
from tradebot.state import Position, RuntimeState, TradeRecord

if TYPE_CHECKING:
    from tradebot.events import RuntimeEvent


class SQLiteStateStore:
    """Persist runtime state and cycle outputs for restart recovery."""

    def __init__(self, db_path: str) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialized = False

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self, conn: sqlite3.Connection) -> None:
        if self._initialized:
            return
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS runtime_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                cycle INTEGER NOT NULL,
                cash REAL NOT NULL,
                reflection_hint TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS positions (
                symbol TEXT PRIMARY KEY,
                side TEXT NOT NULL,
                qty REAL NOT NULL,
                entry_price REAL NOT NULL,
                leverage REAL NOT NULL,
                opened_cycle INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS prices (
                symbol TEXT PRIMARY KEY,
                price REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seq INTEGER NOT NULL,
                cycle INTEGER NOT NULL,
                symbol TEXT NOT NULL,
                action TEXT NOT NULL,
                qty REAL NOT NULL,
                price REAL NOT NULL,
                pnl REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cycles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cycle INTEGER NOT NULL,
                trace_id TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                action TEXT NOT NULL,
                selected_symbols_json TEXT NOT NULL,
                details_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                ts TEXT NOT NULL,
                stage TEXT NOT NULL,
                phase TEXT NOT NULL,
                agent TEXT NOT NULL,
                data_json TEXT NOT NULL
            );
            """
        )
        self._initialized = True

    def load_runtime_state(self, *, initial_cash: float) -> RuntimeState:
        with self._connect() as conn:
            self._ensure_schema(conn)
            row = conn.execute("SELECT cycle, cash, reflection_hint FROM runtime_state WHERE id = 1").fetchone()
            if row is None:
                return RuntimeState(cash=initial_cash)

            state = RuntimeState(cycle=int(row["cycle"]), cash=float(row["cash"]), reflection_hint=str(row["reflection_hint"] or ""))

            for pos in conn.execute("SELECT symbol, side, qty, entry_price, leverage, opened_cycle FROM positions"):
                state.positions[str(pos["symbol"])] = Position(
                    symbol=str(pos["symbol"]),
                    side=str(pos["side"]),
                    qty=float(pos["qty"]),
                    entry_price=float(pos["entry_price"]),
                    leverage=float(pos["leverage"]),
                    opened_cycle=int(pos["opened_cycle"]),
                )

            for px in conn.execute("SELECT symbol, price FROM prices"):
                state.prices[str(px["symbol"])] = float(px["price"])

            for tr in conn.execute("SELECT cycle, symbol, action, qty, price, pnl FROM trades ORDER BY seq ASC"):
                state.trades.append(
                    TradeRecord(
                        cycle=int(tr["cycle"]),
                        symbol=str(tr["symbol"]),
                        action=str(tr["action"]),
                        qty=float(tr["qty"]),
                        price=float(tr["price"]),
                        pnl=float(tr["pnl"]),
                    )
                )

            return state

    def persist(self, *, state: RuntimeState, cycle_result: CycleResult, events: list["RuntimeEvent"] | None = None) -> None:
        with self._connect() as conn:
            self._ensure_schema(conn)
            conn.execute(
                """
                INSERT INTO runtime_state (id, cycle, cash, reflection_hint)
                VALUES (1, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET cycle=excluded.cycle, cash=excluded.cash, reflection_hint=excluded.reflection_hint
                """,
                (state.cycle, state.cash, state.reflection_hint),
            )

            conn.execute("DELETE FROM positions")
            conn.executemany(
                "INSERT INTO positions (symbol, side, qty, entry_price, leverage, opened_cycle) VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (p.symbol, p.side, p.qty, p.entry_price, p.leverage, p.opened_cycle)
                    for p in state.positions.values()
                ],
            )

            conn.execute("DELETE FROM prices")
            conn.executemany(
                "INSERT INTO prices (symbol, price) VALUES (?, ?)",
                [(sym, price) for sym, price in state.prices.items()],
            )

            conn.execute("DELETE FROM trades")
            conn.executemany(
                "INSERT INTO trades (seq, cycle, symbol, action, qty, price, pnl) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    (idx, tr.cycle, tr.symbol, tr.action, tr.qty, tr.price, tr.pnl)
                    for idx, tr in enumerate(state.trades)
                ],
            )

            conn.execute(
                """
                INSERT INTO cycles (cycle, trace_id, status, action, selected_symbols_json, details_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(trace_id) DO UPDATE SET
                    cycle=excluded.cycle,
                    status=excluded.status,
                    action=excluded.action,
                    selected_symbols_json=excluded.selected_symbols_json,
                    details_json=excluded.details_json
                """,
                (
                    cycle_result.cycle,
                    cycle_result.trace_id,
                    cycle_result.status,
                    cycle_result.action,
                    json.dumps(cycle_result.selected_symbols, ensure_ascii=False),
                    json.dumps(cycle_result.details, ensure_ascii=False),
                ),
            )

            if events:
                conn.executemany(
                    """
                    INSERT INTO events (trace_id, seq, ts, stage, phase, agent, data_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            ev.trace_id,
                            idx,
                            ev.ts,
                            ev.stage,
                            ev.phase,
                            ev.agent,
                            json.dumps(ev.data, ensure_ascii=False),
                        )
                        for idx, ev in enumerate(events)
                    ],
                )

    def reset(self) -> None:
        with self._connect() as conn:
            self._ensure_schema(conn)
            conn.execute("DELETE FROM runtime_state")
            conn.execute("DELETE FROM positions")
            conn.execute("DELETE FROM prices")
            conn.execute("DELETE FROM trades")
            conn.execute("DELETE FROM cycles")
            conn.execute("DELETE FROM events")
