from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import TYPE_CHECKING, Any

from contracts import CycleResult
from state import Position, RuntimeState, TradeRecord

if TYPE_CHECKING:
    from events import RuntimeEvent


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

    def _safe_trace_id(self, trace_id: str) -> str:
        return re.sub(r"[^A-Za-z0-9._-]+", "_", trace_id)

    def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _write_trace_files(self, *, state: RuntimeState, cycle_result: CycleResult, events: list["RuntimeEvent"]) -> None:
        traces_root = self.db_path.parent / "traces"
        trace_dir = traces_root / self._safe_trace_id(cycle_result.trace_id)
        trace_dir.mkdir(parents=True, exist_ok=True)

        positions = [
            {
                "symbol": p.symbol,
                "side": p.side,
                "qty": p.qty,
                "entry_price": p.entry_price,
                "leverage": p.leverage,
                "opened_cycle": p.opened_cycle,
            }
            for p in state.positions.values()
        ]
        all_trades = [
            {
                "cycle": tr.cycle,
                "symbol": tr.symbol,
                "action": tr.action,
                "qty": tr.qty,
                "price": tr.price,
                "pnl": tr.pnl,
            }
            for tr in state.trades
        ]
        cycle_trades = [tr for tr in all_trades if int(tr["cycle"]) == cycle_result.cycle]

        selector_payload: dict[str, Any] | None = None
        market_snapshots: list[dict[str, Any]] = []
        for ev in events:
            if ev.stage == "selector" and ev.phase == "end":
                selector_payload = ev.data
            if ev.stage == "data" and ev.phase == "end":
                snap = ev.data.get("snapshot")
                if isinstance(snap, dict):
                    market_snapshots.append(snap)

        self._write_json(
            trace_dir / "inputs.json",
            {
                "trace_id": cycle_result.trace_id,
                "cycle": cycle_result.cycle,
                "selected_symbols": cycle_result.selected_symbols,
                "selector": selector_payload or {},
                "market_snapshots": market_snapshots,
            },
        )
        with (trace_dir / "agent_io.jsonl").open("w", encoding="utf-8") as f:
            for idx, ev in enumerate(events):
                f.write(
                    json.dumps(
                        {
                            "seq": idx,
                            "trace_id": ev.trace_id,
                            "ts": ev.ts,
                            "stage": ev.stage,
                            "phase": ev.phase,
                            "agent": ev.agent,
                            "data": ev.data,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
        self._write_json(
            trace_dir / "trades.json",
            {
                "trace_id": cycle_result.trace_id,
                "cycle": cycle_result.cycle,
                "cash": state.cash,
                "cycle_trades": cycle_trades,
                "all_trades": all_trades,
                "open_positions": positions,
            },
        )
        self._write_json(
            trace_dir / "cycle_result.json",
            {
                "schema_version": cycle_result.schema_version,
                "cycle": cycle_result.cycle,
                "trace_id": cycle_result.trace_id,
                "selected_symbols": cycle_result.selected_symbols,
                "action": cycle_result.action,
                "status": cycle_result.status,
                "details": cycle_result.details,
            },
        )
        self._write_json(
            trace_dir / "state_snapshot.json",
            {
                "cycle": state.cycle,
                "cash": state.cash,
                "reflection_hint": state.reflection_hint,
                "positions": positions,
                "prices": state.prices,
                "trades": all_trades,
            },
        )
        (traces_root / "latest_trace_id.txt").write_text(cycle_result.trace_id, encoding="utf-8")

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
        self._write_trace_files(state=state, cycle_result=cycle_result, events=events or [])

    def reset(self) -> None:
        with self._connect() as conn:
            self._ensure_schema(conn)
            conn.execute("DELETE FROM runtime_state")
            conn.execute("DELETE FROM positions")
            conn.execute("DELETE FROM prices")
            conn.execute("DELETE FROM trades")
            conn.execute("DELETE FROM cycles")
            conn.execute("DELETE FROM events")

    def latest_trace_id(self) -> str | None:
        with self._connect() as conn:
            self._ensure_schema(conn)
            row = conn.execute("SELECT trace_id FROM cycles ORDER BY cycle DESC, id DESC LIMIT 1").fetchone()
            if row is None:
                return None
            return str(row["trace_id"])

    def load_cycle_summary(self, trace_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            self._ensure_schema(conn)
            row = conn.execute(
                """
                SELECT cycle, trace_id, status, action, selected_symbols_json, details_json, created_at
                FROM cycles
                WHERE trace_id = ?
                LIMIT 1
                """,
                (trace_id,),
            ).fetchone()
            if row is None:
                return None
            return {
                "cycle": int(row["cycle"]),
                "trace_id": str(row["trace_id"]),
                "status": str(row["status"]),
                "action": str(row["action"]),
                "selected_symbols": json.loads(str(row["selected_symbols_json"])),
                "details": json.loads(str(row["details_json"])),
                "created_at": str(row["created_at"]),
            }

    def load_events(self, trace_id: str, *, stage: str | None = None, limit: int | None = None) -> list[dict[str, Any]]:
        with self._connect() as conn:
            self._ensure_schema(conn)
            sql = """
                SELECT seq, ts, stage, phase, agent, data_json
                FROM events
                WHERE trace_id = ?
            """
            params: list[Any] = [trace_id]
            if stage:
                sql += " AND stage = ?"
                params.append(stage)
            sql += " ORDER BY seq ASC"
            rows = conn.execute(sql, tuple(params)).fetchall()
            if limit is not None and limit > 0:
                rows = rows[-limit:]
            out = [
                {
                    "seq": int(row["seq"]),
                    "ts": str(row["ts"]),
                    "stage": str(row["stage"]),
                    "phase": str(row["phase"]),
                    "agent": str(row["agent"]),
                    "data": json.loads(str(row["data_json"])),
                }
                for row in rows
            ]
            return out
