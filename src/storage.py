from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import TYPE_CHECKING, Any

from contracts import CycleResult
from state import ExchangeOrderRecord, ExecutionReportRecord, FillRecord, OrderIntentRecord, Position, ReconciliationReportRecord, RuntimeState, TradeRecord

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

    @staticmethod
    def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return any(str(row["name"]) == column for row in rows)

    def _ensure_schema(self, conn: sqlite3.Connection) -> None:
        if self._initialized:
            return
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS runtime_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                cycle INTEGER NOT NULL,
                cash REAL NOT NULL,
                peak_equity REAL NOT NULL DEFAULT 0,
                reflection_hint TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS positions (
                symbol TEXT PRIMARY KEY,
                side TEXT NOT NULL,
                qty REAL NOT NULL,
                entry_price REAL NOT NULL,
                leverage REAL NOT NULL,
                opened_cycle INTEGER NOT NULL,
                stop_loss REAL NOT NULL DEFAULT 0,
                take_profit REAL NOT NULL DEFAULT 0,
                entry_source TEXT NOT NULL DEFAULT '',
                entry_confidence REAL NOT NULL DEFAULT 0,
                entry_reason TEXT NOT NULL DEFAULT ''
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
                pnl REAL NOT NULL,
                realized_pnl REAL NOT NULL DEFAULT 0,
                fee REAL NOT NULL DEFAULT 0,
                funding REAL NOT NULL DEFAULT 0,
                event_type TEXT NOT NULL DEFAULT 'trade',
                source TEXT NOT NULL DEFAULT '',
                confidence REAL NOT NULL DEFAULT 0,
                reason TEXT NOT NULL DEFAULT ''
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

            CREATE TABLE IF NOT EXISTS order_intents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seq INTEGER NOT NULL,
                trace_id TEXT NOT NULL,
                cycle INTEGER NOT NULL,
                symbol TEXT NOT NULL,
                action TEXT NOT NULL,
                requested_qty REAL NOT NULL,
                requested_price REAL NOT NULL,
                leverage REAL NOT NULL,
                reduce_only INTEGER NOT NULL,
                provider TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT '',
                confidence REAL NOT NULL DEFAULT 0,
                reason TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS exchange_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seq INTEGER NOT NULL,
                trace_id TEXT NOT NULL,
                cycle INTEGER NOT NULL,
                symbol TEXT NOT NULL,
                action TEXT NOT NULL,
                requested_qty REAL NOT NULL,
                executed_qty REAL NOT NULL,
                requested_price REAL NOT NULL,
                avg_price REAL,
                status TEXT NOT NULL,
                provider TEXT NOT NULL,
                reduce_only INTEGER NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                exchange_order_id TEXT NOT NULL DEFAULT '',
                side TEXT NOT NULL DEFAULT '',
                order_type TEXT NOT NULL DEFAULT 'MARKET',
                message TEXT NOT NULL DEFAULT '',
                status_history_json TEXT NOT NULL DEFAULT '[]',
                source TEXT NOT NULL DEFAULT '',
                confidence REAL NOT NULL DEFAULT 0,
                reason TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS fills (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seq INTEGER NOT NULL,
                trace_id TEXT NOT NULL,
                cycle INTEGER NOT NULL,
                symbol TEXT NOT NULL,
                action TEXT NOT NULL,
                qty REAL NOT NULL,
                price REAL NOT NULL,
                fee REAL NOT NULL DEFAULT 0,
                provider TEXT NOT NULL,
                exchange_order_id TEXT NOT NULL DEFAULT '',
                liquidity TEXT NOT NULL DEFAULT '',
                reduce_only INTEGER NOT NULL,
                message TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS execution_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seq INTEGER NOT NULL,
                trace_id TEXT NOT NULL,
                cycle INTEGER NOT NULL,
                symbol TEXT NOT NULL,
                action TEXT NOT NULL,
                requested_qty REAL NOT NULL,
                filled_qty REAL NOT NULL,
                requested_price REAL NOT NULL,
                fill_price REAL,
                status TEXT NOT NULL,
                provider TEXT NOT NULL,
                reduce_only INTEGER NOT NULL,
                exchange_order_id TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT '',
                confidence REAL NOT NULL DEFAULT 0,
                reason TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS reconciliation_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seq INTEGER NOT NULL,
                trace_id TEXT NOT NULL,
                cycle INTEGER NOT NULL,
                provider TEXT NOT NULL,
                status TEXT NOT NULL,
                local_cash REAL NOT NULL,
                remote_cash REAL,
                local_positions_json TEXT NOT NULL,
                remote_positions_json TEXT NOT NULL,
                local_order_statuses_json TEXT NOT NULL DEFAULT '{}',
                remote_order_statuses_json TEXT NOT NULL DEFAULT '{}',
                warnings_json TEXT NOT NULL,
                message TEXT NOT NULL DEFAULT '',
                repaired INTEGER NOT NULL DEFAULT 0,
                repair_actions_json TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS symbol_cooldowns (
                symbol TEXT PRIMARY KEY,
                until_cycle INTEGER NOT NULL
            );
            """
        )
        if not self._has_column(conn, "runtime_state", "peak_equity"):
            conn.execute("ALTER TABLE runtime_state ADD COLUMN peak_equity REAL NOT NULL DEFAULT 0")
        for column_sql in (
            "ALTER TABLE positions ADD COLUMN stop_loss REAL NOT NULL DEFAULT 0",
            "ALTER TABLE positions ADD COLUMN take_profit REAL NOT NULL DEFAULT 0",
            "ALTER TABLE positions ADD COLUMN entry_source TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE positions ADD COLUMN entry_confidence REAL NOT NULL DEFAULT 0",
            "ALTER TABLE positions ADD COLUMN entry_reason TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE trades ADD COLUMN realized_pnl REAL NOT NULL DEFAULT 0",
            "ALTER TABLE trades ADD COLUMN fee REAL NOT NULL DEFAULT 0",
            "ALTER TABLE trades ADD COLUMN funding REAL NOT NULL DEFAULT 0",
            "ALTER TABLE trades ADD COLUMN event_type TEXT NOT NULL DEFAULT 'trade'",
            "ALTER TABLE trades ADD COLUMN source TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE trades ADD COLUMN confidence REAL NOT NULL DEFAULT 0",
            "ALTER TABLE trades ADD COLUMN reason TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE reconciliation_reports ADD COLUMN repaired INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE reconciliation_reports ADD COLUMN repair_actions_json TEXT NOT NULL DEFAULT '[]'",
            "ALTER TABLE exchange_orders ADD COLUMN status_history_json TEXT NOT NULL DEFAULT '[]'",
            "ALTER TABLE exchange_orders ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE reconciliation_reports ADD COLUMN local_order_statuses_json TEXT NOT NULL DEFAULT '{}'",
            "ALTER TABLE reconciliation_reports ADD COLUMN remote_order_statuses_json TEXT NOT NULL DEFAULT '{}'",
        ):
            table_name = column_sql.split()[2]
            column_name = column_sql.split()[5]
            if not self._has_column(conn, table_name, column_name):
                conn.execute(column_sql)
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
                "stop_loss": p.stop_loss,
                "take_profit": p.take_profit,
                "entry_source": p.entry_source,
                "entry_confidence": p.entry_confidence,
                "entry_reason": p.entry_reason,
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
                "realized_pnl": tr.realized_pnl,
                "fee": tr.fee,
                "funding": tr.funding,
                "event_type": tr.event_type,
                "source": tr.source,
                "confidence": tr.confidence,
                "reason": tr.reason,
            }
            for tr in state.trades
        ]
        cycle_trades = [tr for tr in all_trades if int(tr["cycle"]) == cycle_result.cycle]
        all_order_intents = [
            {
                "trace_id": intent.trace_id,
                "cycle": intent.cycle,
                "symbol": intent.symbol,
                "action": intent.action,
                "requested_qty": intent.requested_qty,
                "requested_price": intent.requested_price,
                "leverage": intent.leverage,
                "reduce_only": intent.reduce_only,
                "provider": intent.provider,
                "source": intent.source,
                "confidence": intent.confidence,
                "reason": intent.reason,
            }
            for intent in state.order_intents
        ]
        cycle_order_intents = [intent for intent in all_order_intents if int(intent["cycle"]) == cycle_result.cycle]
        all_exchange_orders = [
            {
                "trace_id": order.trace_id,
                "cycle": order.cycle,
                "symbol": order.symbol,
                "action": order.action,
                "requested_qty": order.requested_qty,
                "executed_qty": order.executed_qty,
                "requested_price": order.requested_price,
                "avg_price": order.avg_price,
                "status": order.status,
                "provider": order.provider,
                "reduce_only": order.reduce_only,
                "is_active": order.is_active,
                "exchange_order_id": order.exchange_order_id,
                "side": order.side,
                "order_type": order.order_type,
                "message": order.message,
                "status_history": order.status_history,
                "source": order.source,
                "confidence": order.confidence,
                "reason": order.reason,
            }
            for order in state.exchange_orders
        ]
        cycle_exchange_orders = [order for order in all_exchange_orders if int(order["cycle"]) == cycle_result.cycle]
        all_fills = [
            {
                "trace_id": fill.trace_id,
                "cycle": fill.cycle,
                "symbol": fill.symbol,
                "action": fill.action,
                "qty": fill.qty,
                "price": fill.price,
                "fee": fill.fee,
                "provider": fill.provider,
                "exchange_order_id": fill.exchange_order_id,
                "liquidity": fill.liquidity,
                "reduce_only": fill.reduce_only,
                "message": fill.message,
            }
            for fill in state.fills
        ]
        cycle_fills = [fill for fill in all_fills if int(fill["cycle"]) == cycle_result.cycle]
        all_execution_reports = [
            {
                "trace_id": report.trace_id,
                "cycle": report.cycle,
                "symbol": report.symbol,
                "action": report.action,
                "requested_qty": report.requested_qty,
                "filled_qty": report.filled_qty,
                "requested_price": report.requested_price,
                "fill_price": report.fill_price,
                "status": report.status,
                "provider": report.provider,
                "reduce_only": report.reduce_only,
                "exchange_order_id": report.exchange_order_id,
                "message": report.message,
                "source": report.source,
                "confidence": report.confidence,
                "reason": report.reason,
            }
            for report in state.execution_reports
        ]
        cycle_execution_reports = [report for report in all_execution_reports if int(report["cycle"]) == cycle_result.cycle]
        all_reconciliation_reports = [
            {
                "trace_id": report.trace_id,
                "cycle": report.cycle,
                "provider": report.provider,
                "status": report.status,
                "local_cash": report.local_cash,
                "remote_cash": report.remote_cash,
                "local_positions": report.local_positions,
                "remote_positions": report.remote_positions,
                "local_order_statuses": report.local_order_statuses,
                "remote_order_statuses": report.remote_order_statuses,
                "warnings": report.warnings,
                "message": report.message,
                "repaired": report.repaired,
                "repair_actions": report.repair_actions,
            }
            for report in state.reconciliation_reports
        ]
        cycle_reconciliation_reports = [report for report in all_reconciliation_reports if int(report["cycle"]) == cycle_result.cycle]

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
                "cycle_order_intents": cycle_order_intents,
                "all_order_intents": all_order_intents,
                "cycle_exchange_orders": cycle_exchange_orders,
                "all_exchange_orders": all_exchange_orders,
                "cycle_fills": cycle_fills,
                "all_fills": all_fills,
                "cycle_execution_reports": cycle_execution_reports,
                "all_execution_reports": all_execution_reports,
                "cycle_reconciliation_reports": cycle_reconciliation_reports,
                "all_reconciliation_reports": all_reconciliation_reports,
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
                "peak_equity": state.peak_equity,
                "reflection_hint": state.reflection_hint,
                "positions": positions,
                "prices": state.prices,
                "trades": all_trades,
                "order_intents": all_order_intents,
                "exchange_orders": all_exchange_orders,
                "fills": all_fills,
                "execution_reports": all_execution_reports,
                "reconciliation_reports": all_reconciliation_reports,
                "symbol_cooldowns": state.symbol_cooldowns,
            },
        )
        (traces_root / "latest_trace_id.txt").write_text(cycle_result.trace_id, encoding="utf-8")

    def load_runtime_state(self, *, initial_cash: float) -> RuntimeState:
        with self._connect() as conn:
            self._ensure_schema(conn)
            row = conn.execute("SELECT cycle, cash, peak_equity, reflection_hint FROM runtime_state WHERE id = 1").fetchone()
            if row is None:
                return RuntimeState(cash=initial_cash)

            peak_equity = float(row["peak_equity"] or row["cash"])
            state = RuntimeState(
                cycle=int(row["cycle"]),
                cash=float(row["cash"]),
                peak_equity=peak_equity,
                reflection_hint=str(row["reflection_hint"] or ""),
            )

            for pos in conn.execute(
                "SELECT symbol, side, qty, entry_price, leverage, opened_cycle, stop_loss, take_profit, entry_source, entry_confidence, entry_reason FROM positions"
            ):
                state.positions[str(pos["symbol"])] = Position(
                    symbol=str(pos["symbol"]),
                    side=str(pos["side"]),
                    qty=float(pos["qty"]),
                    entry_price=float(pos["entry_price"]),
                    leverage=float(pos["leverage"]),
                    opened_cycle=int(pos["opened_cycle"]),
                    stop_loss=float(pos["stop_loss"] or 0.0),
                    take_profit=float(pos["take_profit"] or 0.0),
                    entry_source=str(pos["entry_source"] or ""),
                    entry_confidence=float(pos["entry_confidence"] or 0.0),
                    entry_reason=str(pos["entry_reason"] or ""),
                )

            for px in conn.execute("SELECT symbol, price FROM prices"):
                state.prices[str(px["symbol"])] = float(px["price"])

            for tr in conn.execute(
                "SELECT cycle, symbol, action, qty, price, pnl, realized_pnl, fee, funding, event_type, source, confidence, reason FROM trades ORDER BY seq ASC"
            ):
                state.trades.append(
                    TradeRecord(
                        cycle=int(tr["cycle"]),
                        symbol=str(tr["symbol"]),
                        action=str(tr["action"]),
                        qty=float(tr["qty"]),
                        price=float(tr["price"]),
                        pnl=float(tr["pnl"]),
                        realized_pnl=float(tr["realized_pnl"] or 0.0),
                        fee=float(tr["fee"] or 0.0),
                        funding=float(tr["funding"] or 0.0),
                        event_type=str(tr["event_type"] or "trade"),
                        source=str(tr["source"] or ""),
                        confidence=float(tr["confidence"] or 0.0),
                        reason=str(tr["reason"] or ""),
                    )
                )

            for row in conn.execute(
                """
                SELECT trace_id, cycle, symbol, action, requested_qty, requested_price, leverage, reduce_only,
                       provider, source, confidence, reason
                FROM order_intents
                ORDER BY seq ASC
                """
            ):
                state.order_intents.append(
                    OrderIntentRecord(
                        trace_id=str(row["trace_id"]),
                        cycle=int(row["cycle"]),
                        symbol=str(row["symbol"]),
                        action=str(row["action"]),
                        requested_qty=float(row["requested_qty"]),
                        requested_price=float(row["requested_price"]),
                        leverage=float(row["leverage"]),
                        reduce_only=bool(int(row["reduce_only"])),
                        provider=str(row["provider"]),
                        source=str(row["source"] or ""),
                        confidence=float(row["confidence"] or 0.0),
                        reason=str(row["reason"] or ""),
                    )
                )

            for row in conn.execute(
                """
                SELECT trace_id, cycle, symbol, action, requested_qty, executed_qty, requested_price, avg_price,
                       status, provider, reduce_only, is_active, exchange_order_id, side, order_type, message, status_history_json,
                       source, confidence, reason
                FROM exchange_orders
                ORDER BY seq ASC
                """
            ):
                state.exchange_orders.append(
                    ExchangeOrderRecord(
                        trace_id=str(row["trace_id"]),
                        cycle=int(row["cycle"]),
                        symbol=str(row["symbol"]),
                        action=str(row["action"]),
                        requested_qty=float(row["requested_qty"]),
                        executed_qty=float(row["executed_qty"]),
                        requested_price=float(row["requested_price"]),
                        avg_price=float(row["avg_price"]) if row["avg_price"] is not None else None,
                        status=str(row["status"]),
                        provider=str(row["provider"]),
                        reduce_only=bool(int(row["reduce_only"])),
                        is_active=bool(int(row["is_active"])),
                        exchange_order_id=str(row["exchange_order_id"] or ""),
                        side=str(row["side"] or ""),
                        order_type=str(row["order_type"] or "MARKET"),
                        message=str(row["message"] or ""),
                        status_history=json.loads(str(row["status_history_json"] or "[]")),
                        source=str(row["source"] or ""),
                        confidence=float(row["confidence"] or 0.0),
                        reason=str(row["reason"] or ""),
                    )
                )

            for row in conn.execute(
                """
                SELECT trace_id, cycle, symbol, action, qty, price, fee, provider, exchange_order_id, liquidity, reduce_only, message
                FROM fills
                ORDER BY seq ASC
                """
            ):
                state.fills.append(
                    FillRecord(
                        trace_id=str(row["trace_id"]),
                        cycle=int(row["cycle"]),
                        symbol=str(row["symbol"]),
                        action=str(row["action"]),
                        qty=float(row["qty"]),
                        price=float(row["price"]),
                        fee=float(row["fee"] or 0.0),
                        provider=str(row["provider"]),
                        exchange_order_id=str(row["exchange_order_id"] or ""),
                        liquidity=str(row["liquidity"] or ""),
                        reduce_only=bool(int(row["reduce_only"])),
                        message=str(row["message"] or ""),
                    )
                )

            for row in conn.execute(
                """
                SELECT trace_id, cycle, symbol, action, requested_qty, filled_qty, requested_price, fill_price,
                       status, provider, reduce_only, exchange_order_id, message, source, confidence, reason
                FROM execution_reports
                ORDER BY seq ASC
                """
            ):
                state.execution_reports.append(
                    ExecutionReportRecord(
                        trace_id=str(row["trace_id"]),
                        cycle=int(row["cycle"]),
                        symbol=str(row["symbol"]),
                        action=str(row["action"]),
                        requested_qty=float(row["requested_qty"]),
                        filled_qty=float(row["filled_qty"]),
                        requested_price=float(row["requested_price"]),
                        fill_price=float(row["fill_price"]) if row["fill_price"] is not None else None,
                        status=str(row["status"]),
                        provider=str(row["provider"]),
                        reduce_only=bool(int(row["reduce_only"])),
                        exchange_order_id=str(row["exchange_order_id"] or ""),
                        message=str(row["message"] or ""),
                        source=str(row["source"] or ""),
                        confidence=float(row["confidence"] or 0.0),
                        reason=str(row["reason"] or ""),
                    )
                )

            for row in conn.execute(
                """
                SELECT trace_id, cycle, provider, status, local_cash, remote_cash,
                       local_positions_json, remote_positions_json, local_order_statuses_json, remote_order_statuses_json,
                       warnings_json, message, repaired, repair_actions_json
                FROM reconciliation_reports
                ORDER BY seq ASC
                """
            ):
                state.reconciliation_reports.append(
                    ReconciliationReportRecord(
                        trace_id=str(row["trace_id"]),
                        cycle=int(row["cycle"]),
                        provider=str(row["provider"]),
                        status=str(row["status"]),
                        local_cash=float(row["local_cash"]),
                        remote_cash=float(row["remote_cash"]) if row["remote_cash"] is not None else None,
                        local_positions=json.loads(str(row["local_positions_json"] or "{}")),
                        remote_positions=json.loads(str(row["remote_positions_json"] or "{}")),
                        local_order_statuses=json.loads(str(row["local_order_statuses_json"] or "{}")),
                        remote_order_statuses=json.loads(str(row["remote_order_statuses_json"] or "{}")),
                        warnings=json.loads(str(row["warnings_json"] or "[]")),
                        message=str(row["message"] or ""),
                        repaired=bool(int(row["repaired"])),
                        repair_actions=json.loads(str(row["repair_actions_json"] or "[]")),
                    )
                )

            for row in conn.execute("SELECT symbol, until_cycle FROM symbol_cooldowns"):
                state.symbol_cooldowns[str(row["symbol"])] = int(row["until_cycle"])

            return state

    def persist(self, *, state: RuntimeState, cycle_result: CycleResult, events: list["RuntimeEvent"] | None = None) -> None:
        with self._connect() as conn:
            self._ensure_schema(conn)
            conn.execute(
                """
                INSERT INTO runtime_state (id, cycle, cash, peak_equity, reflection_hint)
                VALUES (1, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    cycle=excluded.cycle,
                    cash=excluded.cash,
                    peak_equity=excluded.peak_equity,
                    reflection_hint=excluded.reflection_hint
                """,
                (state.cycle, state.cash, float(state.peak_equity or state.cash), state.reflection_hint),
            )

            conn.execute("DELETE FROM positions")
            conn.executemany(
                """
                INSERT INTO positions (
                    symbol, side, qty, entry_price, leverage, opened_cycle,
                    stop_loss, take_profit, entry_source, entry_confidence, entry_reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        p.symbol,
                        p.side,
                        p.qty,
                        p.entry_price,
                        p.leverage,
                        p.opened_cycle,
                        p.stop_loss,
                        p.take_profit,
                        p.entry_source,
                        p.entry_confidence,
                        p.entry_reason,
                    )
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
                """
                INSERT INTO trades (
                    seq, cycle, symbol, action, qty, price, pnl,
                    realized_pnl, fee, funding, event_type, source, confidence, reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        idx,
                        tr.cycle,
                        tr.symbol,
                        tr.action,
                        tr.qty,
                        tr.price,
                        tr.pnl,
                        tr.realized_pnl,
                        tr.fee,
                        tr.funding,
                        tr.event_type,
                        tr.source,
                        tr.confidence,
                        tr.reason,
                    )
                    for idx, tr in enumerate(state.trades)
                ],
            )

            conn.execute("DELETE FROM order_intents")
            conn.executemany(
                """
                INSERT INTO order_intents (
                    seq, trace_id, cycle, symbol, action, requested_qty, requested_price, leverage,
                    reduce_only, provider, source, confidence, reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        idx,
                        intent.trace_id,
                        intent.cycle,
                        intent.symbol,
                        intent.action,
                        intent.requested_qty,
                        intent.requested_price,
                        intent.leverage,
                        1 if intent.reduce_only else 0,
                        intent.provider,
                        intent.source,
                        intent.confidence,
                        intent.reason,
                    )
                    for idx, intent in enumerate(state.order_intents)
                ],
            )

            conn.execute("DELETE FROM exchange_orders")
            conn.executemany(
                """
                INSERT INTO exchange_orders (
                    seq, trace_id, cycle, symbol, action, requested_qty, executed_qty, requested_price, avg_price,
                    status, provider, reduce_only, is_active, exchange_order_id, side, order_type, message, status_history_json,
                    source, confidence, reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        idx,
                        order.trace_id,
                        order.cycle,
                        order.symbol,
                        order.action,
                        order.requested_qty,
                        order.executed_qty,
                        order.requested_price,
                        order.avg_price,
                        order.status,
                        order.provider,
                        1 if order.reduce_only else 0,
                        1 if order.is_active else 0,
                        order.exchange_order_id,
                        order.side,
                        order.order_type,
                        order.message,
                        json.dumps(order.status_history, ensure_ascii=False),
                        order.source,
                        order.confidence,
                        order.reason,
                    )
                    for idx, order in enumerate(state.exchange_orders)
                ],
            )

            conn.execute("DELETE FROM fills")
            conn.executemany(
                """
                INSERT INTO fills (
                    seq, trace_id, cycle, symbol, action, qty, price, fee, provider, exchange_order_id,
                    liquidity, reduce_only, message
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        idx,
                        fill.trace_id,
                        fill.cycle,
                        fill.symbol,
                        fill.action,
                        fill.qty,
                        fill.price,
                        fill.fee,
                        fill.provider,
                        fill.exchange_order_id,
                        fill.liquidity,
                        1 if fill.reduce_only else 0,
                        fill.message,
                    )
                    for idx, fill in enumerate(state.fills)
                ],
            )

            conn.execute("DELETE FROM execution_reports")
            conn.executemany(
                """
                INSERT INTO execution_reports (
                    seq, trace_id, cycle, symbol, action, requested_qty, filled_qty, requested_price, fill_price,
                    status, provider, reduce_only, exchange_order_id, message, source, confidence, reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        idx,
                        report.trace_id,
                        report.cycle,
                        report.symbol,
                        report.action,
                        report.requested_qty,
                        report.filled_qty,
                        report.requested_price,
                        report.fill_price,
                        report.status,
                        report.provider,
                        1 if report.reduce_only else 0,
                        report.exchange_order_id,
                        report.message,
                        report.source,
                        report.confidence,
                        report.reason,
                    )
                    for idx, report in enumerate(state.execution_reports)
                ],
            )

            conn.execute("DELETE FROM reconciliation_reports")
            conn.executemany(
                """
                INSERT INTO reconciliation_reports (
                    seq, trace_id, cycle, provider, status, local_cash, remote_cash,
                    local_positions_json, remote_positions_json, local_order_statuses_json, remote_order_statuses_json,
                    warnings_json, message, repaired, repair_actions_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        idx,
                        report.trace_id,
                        report.cycle,
                        report.provider,
                        report.status,
                        report.local_cash,
                        report.remote_cash,
                        json.dumps(report.local_positions, ensure_ascii=False),
                        json.dumps(report.remote_positions, ensure_ascii=False),
                        json.dumps(report.local_order_statuses, ensure_ascii=False),
                        json.dumps(report.remote_order_statuses, ensure_ascii=False),
                        json.dumps(report.warnings, ensure_ascii=False),
                        report.message,
                        1 if report.repaired else 0,
                        json.dumps(report.repair_actions, ensure_ascii=False),
                    )
                    for idx, report in enumerate(state.reconciliation_reports)
                ],
            )

            conn.execute("DELETE FROM symbol_cooldowns")
            conn.executemany(
                "INSERT INTO symbol_cooldowns (symbol, until_cycle) VALUES (?, ?)",
                [(symbol, until_cycle) for symbol, until_cycle in state.symbol_cooldowns.items()],
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
            conn.execute("DELETE FROM order_intents")
            conn.execute("DELETE FROM exchange_orders")
            conn.execute("DELETE FROM fills")
            conn.execute("DELETE FROM execution_reports")
            conn.execute("DELETE FROM reconciliation_reports")
            conn.execute("DELETE FROM symbol_cooldowns")
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
