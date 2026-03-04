from __future__ import annotations

import asyncio
import copy
import csv
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from statistics import mean, pstdev
from typing import Any

from config import RuntimeConfig
from contracts import ExecutionResult, ProposedAction, SCHEMA_V2
from orchestrator import MultiAgentTradeBot
from providers.data import MarketDataProvider, ProviderSnapshot
from providers.execution import ExecutionProvider
from providers.ranking import MarketRankProvider, MarketRankRow
from state import Position, RuntimeState, TradeRecord


def render_backtest_markdown(payload: dict[str, object], *, top_n: int = 5) -> str:
    mode = str(payload.get("mode", "unknown"))
    lines: list[str] = [f"# Backtest Summary ({mode})", ""]

    if mode == "backtest_csv":
        report = payload.get("report", {})
        if not isinstance(report, dict):
            report = {}
        lines.extend(
            [
                "## Report",
                "",
                f"- Dataset: `{report.get('dataset_path', '')}`",
                f"- Symbols: `{','.join(report.get('symbols', [])) if isinstance(report.get('symbols'), list) else ''}`",
                f"- Steps: `{report.get('steps', 0)}`",
                f"- Return(%): `{report.get('total_return_pct', 0)}`",
                f"- Realized PnL: `{report.get('realized_pnl', 0)}`",
                f"- Funding PnL: `{report.get('total_funding_pnl', 0)}`",
                f"- Final Cash: `{report.get('final_cash', 0)}`",
                f"- Max Drawdown(%): `{report.get('max_drawdown_pct', 0)}`",
                f"- Sharpe: `{report.get('sharpe', 0)}`",
                f"- Profit Factor: `{report.get('profit_factor', 0)}`",
                "",
            ]
        )
        return "\n".join(lines).strip() + "\n"

    if mode == "backtest_grid":
        best = payload.get("best", {})
        if not isinstance(best, dict):
            best = {}
        analysis = payload.get("analysis", {})
        if not isinstance(analysis, dict):
            analysis = {}
        top = analysis.get("top_results", payload.get("results", []))
        if not isinstance(top, list):
            top = []
        top = top[: max(1, top_n)]

        lines.extend(
            [
                "## Best",
                "",
                f"- Rank By: `{payload.get('rank_by', 'final_cash')}`",
                f"- Fee/Slippage: `{best.get('fee_bps', 0)}` / `{best.get('slippage_bps', 0)}` bps",
                f"- Funding(bps/cycle): `{best.get('funding_rate_bps_per_cycle', 0)}`",
                f"- Final Cash: `{best.get('final_cash', 0)}`",
                f"- Return(%): `{best.get('total_return_pct', 0)}`",
                f"- Max Drawdown(%): `{best.get('max_drawdown_pct', 0)}`",
                "",
                "## Top Results",
                "",
                "| Rank | Fee(bps) | Slippage(bps) | Funding(bps/cycle) | Final Cash | Return(%) | MaxDD(%) | Sharpe |",
                "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            ]
        )
        for idx, row in enumerate(top, start=1):
            if not isinstance(row, dict):
                continue
            lines.append(
                f"| {idx} | {row.get('fee_bps', 0)} | {row.get('slippage_bps', 0)} | {row.get('funding_rate_bps_per_cycle', 0)} | {row.get('final_cash', 0)} | "
                f"{row.get('total_return_pct', 0)} | {row.get('max_drawdown_pct', 0)} | {row.get('sharpe', 0)} |"
            )

        rec = analysis.get("recommendations", {})
        if isinstance(rec, dict):
            notes = rec.get("notes", [])
            if isinstance(notes, list) and notes:
                lines.extend(["", "## Notes", ""])
                lines.extend([f"- {x}" for x in notes])
        lines.append("")
        return "\n".join(lines).strip() + "\n"

    lines.extend(["No summary available for mode.", ""])
    return "\n".join(lines).strip() + "\n"


def _to_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


@dataclass
class BacktestBar:
    ts: datetime
    symbol: str
    close: float
    quote_volume: float


@dataclass
class BacktestReport:
    dataset_path: str
    symbols: list[str]
    steps: int
    start_ts: str
    end_ts: str
    initial_cash: float
    final_cash: float
    total_return_pct: float
    realized_pnl: float
    total_funding_pnl: float
    fee_bps: float
    slippage_bps: float
    funding_rate_bps_per_cycle: float
    total_fees: float
    closed_trades: int
    wins: int
    losses: int
    win_rate: float
    avg_pnl_per_trade: float
    expectancy: float
    profit_factor: float
    sharpe: float
    max_drawdown_pct: float
    sharpe_equity: float
    max_drawdown_equity_pct: float
    unrealized_pnl: float
    final_equity: float
    open_positions_end: int
    forced_close_count: int
    auto_risk_close_count: int
    auto_risk_close_breakdown: dict[str, int]
    partial_open_count: int
    retried_open_count: int
    rejected_open_count: int
    cycle_status_counts: dict[str, int]

    def to_dict(self) -> dict[str, object]:
        return {
            "dataset_path": self.dataset_path,
            "symbols": self.symbols,
            "steps": self.steps,
            "start_ts": self.start_ts,
            "end_ts": self.end_ts,
            "initial_cash": round(self.initial_cash, 6),
            "final_cash": round(self.final_cash, 6),
            "total_return_pct": round(self.total_return_pct, 6),
            "realized_pnl": round(self.realized_pnl, 6),
            "total_funding_pnl": round(self.total_funding_pnl, 6),
            "fee_bps": round(self.fee_bps, 6),
            "slippage_bps": round(self.slippage_bps, 6),
            "funding_rate_bps_per_cycle": round(self.funding_rate_bps_per_cycle, 6),
            "total_fees": round(self.total_fees, 6),
            "closed_trades": self.closed_trades,
            "wins": self.wins,
            "losses": self.losses,
            "win_rate": round(self.win_rate, 6),
            "avg_pnl_per_trade": round(self.avg_pnl_per_trade, 6),
            "expectancy": round(self.expectancy, 6),
            "profit_factor": round(self.profit_factor, 6),
            "sharpe": round(self.sharpe, 6),
            "max_drawdown_pct": round(self.max_drawdown_pct, 6),
            "sharpe_equity": round(self.sharpe_equity, 6),
            "max_drawdown_equity_pct": round(self.max_drawdown_equity_pct, 6),
            "unrealized_pnl": round(self.unrealized_pnl, 6),
            "final_equity": round(self.final_equity, 6),
            "open_positions_end": self.open_positions_end,
            "forced_close_count": self.forced_close_count,
            "auto_risk_close_count": self.auto_risk_close_count,
            "auto_risk_close_breakdown": self.auto_risk_close_breakdown,
            "partial_open_count": self.partial_open_count,
            "retried_open_count": self.retried_open_count,
            "rejected_open_count": self.rejected_open_count,
            "cycle_status_counts": self.cycle_status_counts,
        }


class CSVBacktestDataset:
    def __init__(self, *, bars_by_symbol: dict[str, list[BacktestBar]], steps: int, source_path: str) -> None:
        self.bars_by_symbol = bars_by_symbol
        self.steps = steps
        self.source_path = source_path
        self.symbols = sorted(list(bars_by_symbol.keys()))

    @classmethod
    def from_csv(
        cls,
        path: str,
        *,
        start: str | None = None,
        end: str | None = None,
        symbols: list[str] | None = None,
        max_steps: int | None = None,
    ) -> "CSVBacktestDataset":
        p = Path(path)
        if not p.exists():
            raise ValueError(f"backtest csv not found: {path}")

        start_dt = datetime.fromisoformat(start) if start else None
        end_dt = datetime.fromisoformat(end) if end else None
        filter_symbols = set(symbols or [])

        parsed: dict[str, list[BacktestBar]] = {}
        with p.open("r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            required = {"ts", "symbol", "close"}
            missing = required - set(reader.fieldnames or [])
            if missing:
                raise ValueError(f"missing csv columns: {sorted(missing)}")

            for row in reader:
                sym = str(row.get("symbol", "")).strip()
                if not sym:
                    continue
                if filter_symbols and sym not in filter_symbols:
                    continue

                ts_raw = str(row.get("ts", "")).strip()
                ts = datetime.fromisoformat(ts_raw)
                if start_dt and ts < start_dt:
                    continue
                if end_dt and ts > end_dt:
                    continue

                close = float(row.get("close", 0.0) or 0.0)
                qv = float(row.get("quote_volume", 0.0) or 0.0)
                parsed.setdefault(sym, []).append(BacktestBar(ts=ts, symbol=sym, close=close, quote_volume=qv))

        parsed = {sym: sorted(rows, key=lambda x: x.ts) for sym, rows in parsed.items() if rows}
        if not parsed:
            raise ValueError("no bars loaded from csv after filters")

        # Align all symbols on timestamp intersection to avoid cross-symbol time skew.
        symbol_maps: dict[str, dict[datetime, BacktestBar]] = {}
        common_ts: set[datetime] | None = None
        for sym, rows in parsed.items():
            by_ts = {bar.ts: bar for bar in rows}
            symbol_maps[sym] = by_ts
            ts_set = set(by_ts.keys())
            common_ts = ts_set if common_ts is None else (common_ts & ts_set)

        aligned_ts = sorted(common_ts or [])
        if max_steps is not None and max_steps > 0:
            aligned_ts = aligned_ts[:max_steps]
        if len(aligned_ts) < 2:
            raise ValueError("backtest requires at least 2 aligned bars per symbol")

        trimmed = {sym: [symbol_maps[sym][ts] for ts in aligned_ts] for sym in parsed.keys()}
        return cls(bars_by_symbol=trimmed, steps=len(aligned_ts), source_path=str(p))

    def start_ts(self) -> datetime:
        return min(rows[0].ts for rows in self.bars_by_symbol.values())

    def end_ts(self) -> datetime:
        return max(rows[self.steps - 1].ts for rows in self.bars_by_symbol.values())


class BacktestMarketDataProvider(MarketDataProvider):
    def __init__(self, dataset: CSVBacktestDataset) -> None:
        self.dataset = dataset

    def fetch(self, *, symbol: str, state: RuntimeState) -> ProviderSnapshot:
        rows = self.dataset.bars_by_symbol.get(symbol)
        if not rows:
            raise ValueError(f"symbol not found in backtest dataset: {symbol}")
        idx = max(0, min(state.cycle - 1, self.dataset.steps - 1))

        row = rows[idx]
        lookback = rows[max(0, idx - 29) : idx + 1]
        first = lookback[0].close
        price = row.close
        momentum = (price / first - 1.0) * 100.0 if first > 0 else 0.0

        highs = [x.close for x in lookback]
        low = min(highs)
        high = max(highs)
        volatility = (high - low) / price * 100.0 if price > 0 else 0.0

        recent_vol = [x.quote_volume for x in rows[max(0, idx - 20) : idx]]
        baseline = mean(recent_vol) if recent_vol else max(1.0, row.quote_volume)
        volume_ratio = row.quote_volume / max(1e-9, baseline)

        return ProviderSnapshot(
            price=round(price, 5),
            momentum_30m_pct=round(momentum, 4),
            volatility_pct=round(max(0.01, volatility), 4),
            volume_ratio=round(max(0.01, volume_ratio), 4),
        )


class BacktestMarketRankProvider(MarketRankProvider):
    def __init__(self, dataset: CSVBacktestDataset) -> None:
        self.dataset = dataset

    def snapshot(self, symbols: list[str], cycle: int) -> dict[str, MarketRankRow]:
        out: dict[str, MarketRankRow] = {}
        # Keep rank snapshot aligned with market data provider at the same cycle.
        idx = max(0, min(cycle - 1, self.dataset.steps - 1))

        max_qv = 1.0
        for sym in symbols:
            rows = self.dataset.bars_by_symbol.get(sym)
            if rows:
                max_qv = max(max_qv, rows[idx].quote_volume)

        for sym in symbols:
            rows = self.dataset.bars_by_symbol.get(sym)
            if not rows:
                out[sym] = MarketRankRow(symbol=sym, score=40.0, reason="missing in backtest dataset")
                continue

            row = rows[idx]
            prev_idx = max(0, idx - 1)
            prev = rows[prev_idx].close
            trend = (row.close / prev - 1.0) * 100.0 if prev > 0 else 0.0
            trend_score = max(0.0, min(100.0, (trend + 5.0) * 10.0))
            vol_score = max(0.0, min(100.0, row.quote_volume / max_qv * 100.0))
            score = 0.55 * trend_score + 0.45 * vol_score
            out[sym] = MarketRankRow(symbol=sym, score=score, reason=f"backtest trend={trend:.2f}% qv={row.quote_volume:.0f}")

        return out


class BacktestExecutionProvider(ExecutionProvider):
    def __init__(
        self,
        *,
        fee_bps: float = 3.0,
        slippage_bps: float = 1.0,
        dataset: CSVBacktestDataset | None = None,
        max_open_notional_share_of_bar: float = 0.0,
        max_open_retries: int = 2,
    ) -> None:
        self.fee_bps = max(0.0, fee_bps)
        self.slippage_bps = max(0.0, slippage_bps)
        self.total_fees_paid = 0.0
        self.dataset = dataset
        self.max_open_notional_share_of_bar = max(0.0, max_open_notional_share_of_bar)
        self.max_open_retries = max(0, int(max_open_retries))
        self.position_risk_levels: dict[str, dict[str, float | None]] = {}
        self.partial_open_count = 0
        self.retried_open_count = 0
        self.rejected_open_count = 0

    def _fill_price(self, mark_price: float, action: str) -> float:
        slip = self.slippage_bps / 10_000.0
        if action in {"open_long", "close_short"}:  # buy side
            return mark_price * (1.0 + slip)
        if action in {"open_short", "close_long"}:  # sell side
            return mark_price * (1.0 - slip)
        return mark_price

    def _fee(self, fill_price: float, qty: float) -> float:
        return abs(fill_price * qty) * self.fee_bps / 10_000.0

    def _resolve_mark_price(self, *, symbol: str, cycle: int, fallback_price: float) -> float:
        # Fill on the next bar when dataset is available. For the last cycle, fallback to final bar.
        if not self.dataset:
            return fallback_price
        rows = self.dataset.bars_by_symbol.get(symbol)
        if not rows:
            return fallback_price
        idx = max(0, min(cycle, self.dataset.steps - 1))
        return float(rows[idx].close)

    def _resolve_quote_volume(self, *, symbol: str, cycle: int) -> float:
        if not self.dataset:
            return -1.0
        rows = self.dataset.bars_by_symbol.get(symbol)
        if not rows:
            return -1.0
        idx = max(0, min(cycle, self.dataset.steps - 1))
        return max(0.0, float(rows[idx].quote_volume))

    def _max_fill_qty_from_liquidity(self, *, fill_price: float, quote_volume: float) -> float:
        if self.max_open_notional_share_of_bar <= 0:
            return float("inf")
        if quote_volume < 0:
            return float("inf")
        if fill_price <= 0 or quote_volume <= 0:
            return 0.0
        max_notional = quote_volume * self.max_open_notional_share_of_bar
        return max_notional / fill_price

    def _execute_open(
        self,
        *,
        trace_id: str,
        action: str,
        symbol: str,
        qty: float,
        lev: float,
        planned_price: float,
        planned: ProposedAction,
        state: RuntimeState,
    ) -> ExecutionResult:
        if symbol in state.positions:
            self.rejected_open_count += 1
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", "position already open")

        remaining = qty
        fills: list[tuple[float, float]] = []
        retries_used = 0

        for attempt in range(self.max_open_retries + 1):
            cycle_for_fill = state.cycle + attempt
            mark_price = self._resolve_mark_price(symbol=symbol, cycle=cycle_for_fill, fallback_price=planned_price)
            fill_price = self._fill_price(mark_price, action)
            qv = self._resolve_quote_volume(symbol=symbol, cycle=cycle_for_fill)
            max_fill_qty = self._max_fill_qty_from_liquidity(fill_price=fill_price, quote_volume=qv)
            chunk = min(remaining, max_fill_qty)
            if chunk > 0:
                fills.append((chunk, fill_price))
                remaining -= chunk
                if attempt > 0:
                    retries_used += 1
            if remaining <= 1e-12:
                break

        filled_qty = sum(x[0] for x in fills)
        if filled_qty <= 0:
            self.rejected_open_count += 1
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", "insufficient liquidity")

        weighted_notional = sum(q * px for q, px in fills)
        avg_fill = weighted_notional / max(1e-12, filled_qty)
        fee_total = sum(self._fee(px, q) for q, px in fills)

        required_margin = abs(avg_fill * filled_qty) / max(1.0, lev)
        if required_margin + fee_total > state.cash:
            self.rejected_open_count += 1
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", "insufficient cash for margin")

        side = "long" if action == "open_long" else "short"
        state.positions[symbol] = Position(symbol=symbol, side=side, qty=filled_qty, entry_price=avg_fill, leverage=lev, opened_cycle=state.cycle)
        self._store_risk_levels(symbol=symbol, planned=planned)
        self.total_fees_paid += fee_total
        state.cash -= fee_total
        state.trades.append(TradeRecord(state.cycle, symbol, action, filled_qty, avg_fill, -fee_total))

        partial = filled_qty + 1e-12 < qty
        if partial:
            self.partial_open_count += 1
        if retries_used > 0:
            self.retried_open_count += 1

        side_name = "long" if action == "open_long" else "short"
        if partial:
            return ExecutionResult(
                SCHEMA_V2,
                trace_id,
                symbol,
                action,
                "success",
                f"backtest {side_name} opened partial qty={filled_qty:.6f}/{qty:.6f} retries={retries_used} fee={fee_total:.6f}",
                avg_fill,
            )
        if retries_used > 0:
            return ExecutionResult(
                SCHEMA_V2,
                trace_id,
                symbol,
                action,
                "success",
                f"backtest {side_name} opened retries={retries_used} fee={fee_total:.6f}",
                avg_fill,
            )
        return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", f"backtest {side_name} opened fee={fee_total:.6f}", avg_fill)

    def _store_risk_levels(self, *, symbol: str, planned: ProposedAction) -> None:
        stop = float(planned.order_params.get("stop_loss", 0.0) or 0.0)
        take = float(planned.order_params.get("take_profit", 0.0) or 0.0)
        self.position_risk_levels[symbol] = {
            "stop_loss": stop if stop > 0 else None,
            "take_profit": take if take > 0 else None,
        }

    def _clear_risk_levels(self, symbol: str) -> None:
        self.position_risk_levels.pop(symbol, None)

    def _close_position(
        self,
        *,
        trace_id: str,
        symbol: str,
        action: str,
        state: RuntimeState,
        mark_price: float,
        message_prefix: str = "backtest close",
    ) -> ExecutionResult:
        pos = state.positions.get(symbol)
        if not pos:
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", "no position")
        fill = self._fill_price(mark_price, action)
        fee = self._fee(fill, pos.qty)
        self.total_fees_paid += fee
        sign = 1.0 if pos.side == "long" else -1.0
        gross_pnl = (fill - pos.entry_price) * pos.qty * sign
        net_pnl = gross_pnl - fee
        state.cash += net_pnl
        state.trades.append(TradeRecord(state.cycle, symbol, action, pos.qty, fill, net_pnl))
        del state.positions[symbol]
        self._clear_risk_levels(symbol)
        return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", f"{message_prefix} net_pnl={net_pnl:.6f}", fill)

    def auto_close_triggered_positions(self, *, state: RuntimeState, cycle: int) -> list[dict[str, object]]:
        if not self.dataset:
            return []

        out: list[dict[str, object]] = []
        for symbol, pos in list(state.positions.items()):
            # Positions opened this cycle cannot be stopped/taken within the same bar in this model.
            if pos.opened_cycle >= cycle:
                continue

            levels = self.position_risk_levels.get(symbol, {})
            stop = levels.get("stop_loss")
            take = levels.get("take_profit")
            if stop is None and take is None:
                continue

            rows = self.dataset.bars_by_symbol.get(symbol)
            if not rows:
                continue
            idx = max(0, min(cycle - 1, self.dataset.steps - 1))
            mark = float(rows[idx].close)

            trigger: str | None = None
            if pos.side == "long":
                if stop is not None and mark <= float(stop):
                    trigger = "stop_loss"
                elif take is not None and mark >= float(take):
                    trigger = "take_profit"
            else:
                if stop is not None and mark >= float(stop):
                    trigger = "stop_loss"
                elif take is not None and mark <= float(take):
                    trigger = "take_profit"

            if trigger is None:
                continue

            action = "close_long" if pos.side == "long" else "close_short"
            result = self._close_position(
                trace_id=f"backtest:auto_risk:{cycle}:{symbol}:{trigger}",
                symbol=symbol,
                action=action,
                state=state,
                mark_price=mark,
                message_prefix=f"backtest {trigger}",
            )
            out.append(
                {
                    "symbol": symbol,
                    "action": action,
                    "trigger": trigger,
                    "status": result.status,
                    "message": result.message,
                    "price": mark,
                    "stop_loss": stop,
                    "take_profit": take,
                }
            )
        return out

    def execute(self, *, trace_id: str, planned: ProposedAction, state: RuntimeState) -> ExecutionResult:
        symbol = planned.symbol
        action = planned.action
        planned_price = float(planned.order_params.get("entry_price", 0) or 0)
        qty = float(planned.order_params.get("quantity", 0) or 0)
        lev = float(planned.order_params.get("leverage", 1.0) or 1.0)

        if action in {"wait", "hold"}:
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "skipped", "passive action")
        if qty <= 0:
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", "invalid quantity")

        if action == "open_long":
            return self._execute_open(
                trace_id=trace_id,
                action=action,
                symbol=symbol,
                qty=qty,
                lev=lev,
                planned_price=planned_price,
                planned=planned,
                state=state,
            )

        if action == "open_short":
            return self._execute_open(
                trace_id=trace_id,
                action=action,
                symbol=symbol,
                qty=qty,
                lev=lev,
                planned_price=planned_price,
                planned=planned,
                state=state,
            )

        if action in {"close_long", "close_short"}:
            mark_price = self._resolve_mark_price(symbol=symbol, cycle=state.cycle, fallback_price=planned_price)
            return self._close_position(trace_id=trace_id, symbol=symbol, action=action, state=state, mark_price=mark_price)

        mark_price = self._resolve_mark_price(symbol=symbol, cycle=state.cycle, fallback_price=planned_price)
        fill = self._fill_price(mark_price, action)
        return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", "unknown action", fill)


class BacktestRunner:
    def __init__(
        self,
        *,
        cfg: RuntimeConfig,
        csv_path: str,
        start: str | None = None,
        end: str | None = None,
        symbols: list[str] | None = None,
        max_steps: int | None = None,
        fee_bps: float | None = None,
        slippage_bps: float | None = None,
        max_open_notional_share_of_bar: float | None = None,
        max_open_retries: int | None = None,
        funding_rate_bps_per_cycle: float | None = None,
    ) -> None:
        self.cfg = cfg
        self.fee_bps = cfg.backtest_fee_bps if fee_bps is None else max(0.0, fee_bps)
        self.slippage_bps = cfg.backtest_slippage_bps if slippage_bps is None else max(0.0, slippage_bps)
        self.max_open_notional_share_of_bar = (
            cfg.backtest_max_open_notional_share_of_bar
            if max_open_notional_share_of_bar is None
            else max(0.0, max_open_notional_share_of_bar)
        )
        self.max_open_retries = cfg.backtest_max_open_retries if max_open_retries is None else max(0, int(max_open_retries))
        self.funding_rate_bps_per_cycle = (
            cfg.backtest_funding_rate_bps_per_cycle
            if funding_rate_bps_per_cycle is None
            else float(funding_rate_bps_per_cycle)
        )
        self.dataset = CSVBacktestDataset.from_csv(
            csv_path,
            start=start,
            end=end,
            symbols=symbols,
            max_steps=max_steps,
        )

    def _build_backtest_command(
        self,
        *,
        fee_bps: float,
        slippage_bps: float,
        funding_rate_bps_per_cycle: float | None = None,
        max_drawdown_pct: float | None = None,
        min_closed_trades: int | None = None,
    ) -> str:
        symbol_part = ",".join(self.dataset.symbols)
        funding_rate = self.funding_rate_bps_per_cycle if funding_rate_bps_per_cycle is None else float(funding_rate_bps_per_cycle)
        cmd = (
            f'tradebot --backtest-csv "{self.dataset.source_path}" '
            f"--backtest-symbols {symbol_part} "
            f"--backtest-max-steps {self.dataset.steps} "
            f"--backtest-fee-bps {round(fee_bps, 6)} "
            f"--backtest-slippage-bps {round(slippage_bps, 6)} "
            f"--backtest-funding-rate-bps-per-cycle {round(funding_rate, 6)} "
            f"--backtest-max-open-notional-share {round(self.max_open_notional_share_of_bar, 6)} "
            f"--backtest-max-open-retries {self.max_open_retries} --pretty"
        )
        if max_drawdown_pct is not None:
            cmd += f" --backtest-max-drawdown-pct {round(max_drawdown_pct, 6)}"
        if min_closed_trades is not None:
            cmd += f" --backtest-min-closed-trades {int(min_closed_trades)}"
        return cmd

    def _dataset_close(self, symbol: str, cycle: int) -> float:
        rows = self.dataset.bars_by_symbol.get(symbol)
        if not rows:
            return 0.0
        idx = max(0, min(cycle - 1, self.dataset.steps - 1))
        return float(rows[idx].close)

    def _mark_to_market_equity(self, *, state: RuntimeState, cycle: int) -> float:
        equity = float(state.cash)
        for symbol, pos in state.positions.items():
            px = self._dataset_close(symbol, cycle)
            if px <= 0:
                px = float(pos.entry_price)
            sign = 1.0 if pos.side == "long" else -1.0
            equity += (px - float(pos.entry_price)) * float(pos.qty) * sign
        return equity

    def _apply_funding(
        self,
        *,
        state: RuntimeState,
        cycle: int,
        funding_rate_bps: float,
        sink: list[dict[str, object]] | None = None,
    ) -> float:
        if abs(funding_rate_bps) <= 1e-12:
            return 0.0
        total = 0.0
        for symbol, pos in state.positions.items():
            px = self._dataset_close(symbol, cycle)
            if px <= 0:
                px = float(pos.entry_price)
            notional = abs(px * float(pos.qty))
            side_sign = 1.0 if pos.side == "long" else -1.0
            # Positive funding means longs pay shorts; negative does the opposite.
            pnl = -(side_sign * funding_rate_bps / 10_000.0) * notional
            state.cash += pnl
            total += pnl
            if sink is not None:
                sink.append(
                    {
                        "cycle": cycle,
                        "symbol": symbol,
                        "side": pos.side,
                        "price": px,
                        "qty": float(pos.qty),
                        "notional": notional,
                        "funding_rate_bps": funding_rate_bps,
                        "pnl": pnl,
                    }
                )
        return total

    def _force_close_open_positions(self, *, state: RuntimeState, exec_provider: BacktestExecutionProvider) -> list[dict[str, object]]:
        forced: list[dict[str, object]] = []
        for symbol, pos in list(state.positions.items()):
            final_price = self._dataset_close(symbol, self.dataset.steps)
            action = "close_long" if pos.side == "long" else "close_short"
            planned = ProposedAction(
                schema_version=SCHEMA_V2,
                trace_id=f"backtest:force_close:{state.cycle}:{symbol}",
                symbol=symbol,
                source="backtest_force_close",
                action=action,
                confidence=100.0,
                reason="force close remaining position at backtest end",
                order_params={
                    "entry_price": final_price,
                    "quantity": float(pos.qty),
                    "leverage": float(pos.leverage),
                },
            )
            result = exec_provider.execute(trace_id=planned.trace_id, planned=planned, state=state)
            forced.append(
                {
                    "symbol": symbol,
                    "action": action,
                    "status": result.status,
                    "message": result.message,
                    "price": final_price,
                }
            )
        return forced

    def _run_once(
        self,
        *,
        fee_bps: float,
        slippage_bps: float,
        funding_rate_bps_per_cycle: float,
        include_trades: bool,
    ) -> dict[str, object]:
        cfg = copy.deepcopy(self.cfg)
        cfg.ai500_candidates = list(self.dataset.symbols)
        cfg.selector.top_n = min(cfg.selector.top_n, len(self.dataset.symbols))
        cfg.persistence_enabled = False
        exec_provider = BacktestExecutionProvider(
            fee_bps=fee_bps,
            slippage_bps=slippage_bps,
            dataset=self.dataset,
            max_open_notional_share_of_bar=self.max_open_notional_share_of_bar,
            max_open_retries=self.max_open_retries,
        )

        bot = MultiAgentTradeBot(
            cfg=cfg,
            market_data_provider=BacktestMarketDataProvider(self.dataset),
            market_rank_provider=BacktestMarketRankProvider(self.dataset),
            execution_provider=exec_provider,
        )

        cycle_results: list[Any] = []
        cash_curve = [{"cycle": 0, "cash": bot.state.cash}]
        equity_curve = [{"cycle": 0, "equity": bot.state.cash}]
        status_counts: dict[str, int] = {}
        auto_risk_closes: list[dict[str, object]] = []
        funding_events: list[dict[str, object]] = []
        total_funding_pnl = 0.0

        for _ in range(self.dataset.steps):
            result = asyncio.run(bot.run_cycle())
            cycle_results.append(result)
            cycle_risk_closes = exec_provider.auto_close_triggered_positions(state=bot.state, cycle=bot.state.cycle)
            if cycle_risk_closes:
                auto_risk_closes.extend(cycle_risk_closes)
            total_funding_pnl += self._apply_funding(
                state=bot.state,
                cycle=bot.state.cycle,
                funding_rate_bps=funding_rate_bps_per_cycle,
                sink=funding_events,
            )

            cash = float(bot.state.cash)
            cash_curve.append({"cycle": result.cycle, "cash": cash})
            equity_curve.append({"cycle": result.cycle, "equity": self._mark_to_market_equity(state=bot.state, cycle=result.cycle)})
            status_counts[result.status] = status_counts.get(result.status, 0) + 1

        forced_closes = self._force_close_open_positions(state=bot.state, exec_provider=exec_provider)
        if cash_curve:
            cash_curve[-1]["cash"] = float(bot.state.cash)
        if equity_curve:
            equity_curve[-1]["equity"] = self._mark_to_market_equity(state=bot.state, cycle=bot.state.cycle)

        closed = [t for t in bot.state.trades if t.action in {"close_long", "close_short"}]
        wins = len([t for t in closed if t.pnl > 0])
        losses = len([t for t in closed if t.pnl < 0])
        final_cash = bot.state.cash
        initial_cash = cfg.initial_cash
        realized = final_cash - initial_cash
        win_rate = wins / len(closed) if closed else 0.0
        avg_pnl = mean([t.pnl for t in closed]) if closed else 0.0

        gross_profit = sum(t.pnl for t in closed if t.pnl > 0)
        gross_loss = abs(sum(t.pnl for t in closed if t.pnl < 0))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)

        # Per-cycle cash returns for Sharpe (unannualized).
        rets: list[float] = []
        for i in range(1, len(cash_curve)):
            prev_cash = float(cash_curve[i - 1]["cash"])
            now_cash = float(cash_curve[i]["cash"])
            if prev_cash > 0:
                rets.append((now_cash / prev_cash) - 1.0)
        sharpe = 0.0
        if rets:
            vol = pstdev(rets)
            if vol > 0:
                sharpe = mean(rets) / vol * (len(rets) ** 0.5)

        eq_rets: list[float] = []
        for i in range(1, len(equity_curve)):
            prev_eq = float(equity_curve[i - 1]["equity"])
            now_eq = float(equity_curve[i]["equity"])
            if prev_eq > 0:
                eq_rets.append((now_eq / prev_eq) - 1.0)
        sharpe_equity = 0.0
        if eq_rets:
            vol_eq = pstdev(eq_rets)
            if vol_eq > 0:
                sharpe_equity = mean(eq_rets) / vol_eq * (len(eq_rets) ** 0.5)

        peak = float(cash_curve[0]["cash"])
        max_dd = 0.0
        for point in cash_curve:
            x = float(point["cash"])
            peak = max(peak, x)
            if peak > 0:
                dd = (peak - x) / peak
                max_dd = max(max_dd, dd)

        peak_eq = float(equity_curve[0]["equity"])
        max_dd_eq = 0.0
        for point in equity_curve:
            x = float(point["equity"])
            peak_eq = max(peak_eq, x)
            if peak_eq > 0:
                dd_eq = (peak_eq - x) / peak_eq
                max_dd_eq = max(max_dd_eq, dd_eq)

        final_equity = self._mark_to_market_equity(state=bot.state, cycle=bot.state.cycle)
        unrealized = final_equity - final_cash
        auto_risk_breakdown: dict[str, int] = {}
        for row in auto_risk_closes:
            k = str(row.get("trigger", "unknown"))
            auto_risk_breakdown[k] = auto_risk_breakdown.get(k, 0) + 1

        report = BacktestReport(
            dataset_path=self.dataset.source_path,
            symbols=self.dataset.symbols,
            steps=self.dataset.steps,
            start_ts=self.dataset.start_ts().isoformat(),
            end_ts=self.dataset.end_ts().isoformat(),
            initial_cash=initial_cash,
            final_cash=final_cash,
            total_return_pct=((final_cash / initial_cash) - 1.0) * 100.0 if initial_cash else 0.0,
            realized_pnl=realized,
            total_funding_pnl=total_funding_pnl,
            fee_bps=fee_bps,
            slippage_bps=slippage_bps,
            funding_rate_bps_per_cycle=funding_rate_bps_per_cycle,
            total_fees=exec_provider.total_fees_paid,
            closed_trades=len(closed),
            wins=wins,
            losses=losses,
            win_rate=win_rate * 100.0,
            avg_pnl_per_trade=avg_pnl,
            expectancy=avg_pnl,
            profit_factor=profit_factor,
            sharpe=sharpe,
            max_drawdown_pct=max_dd * 100.0,
            sharpe_equity=sharpe_equity,
            max_drawdown_equity_pct=max_dd_eq * 100.0,
            unrealized_pnl=unrealized,
            final_equity=final_equity,
            open_positions_end=len(bot.state.positions),
            forced_close_count=len(forced_closes),
            auto_risk_close_count=len(auto_risk_closes),
            auto_risk_close_breakdown=auto_risk_breakdown,
            partial_open_count=exec_provider.partial_open_count,
            retried_open_count=exec_provider.retried_open_count,
            rejected_open_count=exec_provider.rejected_open_count,
            cycle_status_counts=status_counts,
        )

        payload: dict[str, object] = {
            "mode": "backtest_csv",
            "report": report.to_dict(),
            "equity_curve": cash_curve,
            "equity_curve_mtm": equity_curve,
            "last_cycle": {
                "cycle": cycle_results[-1].cycle if cycle_results else 0,
                "trace_id": cycle_results[-1].trace_id if cycle_results else "",
                "status": cycle_results[-1].status if cycle_results else "",
                "action": cycle_results[-1].action if cycle_results else "",
            },
            "forced_closes": forced_closes,
            "auto_risk_closes": auto_risk_closes,
            "funding_events": funding_events,
        }
        if include_trades:
            payload["trades"] = [
                {
                    "cycle": t.cycle,
                    "symbol": t.symbol,
                    "action": t.action,
                    "qty": t.qty,
                    "price": t.price,
                    "pnl": t.pnl,
                }
                for t in bot.state.trades
            ]
        return payload

    def run(self, *, include_trades: bool = False) -> dict[str, object]:
        return self._run_once(
            fee_bps=self.fee_bps,
            slippage_bps=self.slippage_bps,
            funding_rate_bps_per_cycle=self.funding_rate_bps_per_cycle,
            include_trades=include_trades,
        )

    def _analyze_grid_results(
        self,
        rows: list[dict[str, object]],
        *,
        top_n: int,
        rank_by: str,
        max_drawdown_pct: float | None = None,
        min_closed_trades: int | None = None,
    ) -> dict[str, object]:
        if not rows:
            return {
                "top_results": [],
                "best_result": None,
                "worst_result": None,
                "constraint": {
                    "max_drawdown_pct": max_drawdown_pct,
                    "min_closed_trades": min_closed_trades,
                },
                "ranking": {"rank_by": rank_by},
                "constrained_count": 0,
                "constrained_best_result": None,
                "spread_final_cash": 0.0,
                "fee_sensitivity": [],
                "slippage_sensitivity": [],
                "funding_sensitivity": [],
                "recommendations": {
                    "recommended_params": None,
                    "cost_tolerance": {"max_fee_bps_non_negative_return": None, "max_slippage_bps_non_negative_return": None},
                    "conservative_params": None,
                    "command_templates": [],
                    "notes": ["no grid results"],
                },
            }

        fee_map: dict[float, list[dict[str, object]]] = {}
        slippage_map: dict[float, list[dict[str, object]]] = {}
        funding_map: dict[float, list[dict[str, object]]] = {}
        for row in rows:
            fee = _to_float(row.get("fee_bps"))
            slip = _to_float(row.get("slippage_bps"))
            funding = _to_float(row.get("funding_rate_bps_per_cycle"))
            fee_map.setdefault(fee, []).append(row)
            slippage_map.setdefault(slip, []).append(row)
            funding_map.setdefault(funding, []).append(row)

        def _aggregate(grouped: dict[float, list[dict[str, object]]], field_name: str) -> list[dict[str, object]]:
            out: list[dict[str, object]] = []
            for key, items in grouped.items():
                finals = [_to_float(i.get("final_cash")) for i in items]
                rets = [_to_float(i.get("total_return_pct")) for i in items]
                dds = [_to_float(i.get("max_drawdown_pct")) for i in items]
                out.append(
                    {
                        field_name: key,
                        "runs": len(items),
                        "avg_final_cash": round(mean(finals), 6) if finals else 0.0,
                        "avg_return_pct": round(mean(rets), 6) if rets else 0.0,
                        "avg_max_drawdown_pct": round(mean(dds), 6) if dds else 0.0,
                    }
                )
            out.sort(key=lambda x: _to_float(x.get(field_name)))
            return out

        best = rows[0]
        worst = rows[-1]
        final_cash_values = [_to_float(r.get("final_cash")) for r in rows]
        spread = (max(final_cash_values) - min(final_cash_values)) if final_cash_values else 0.0
        fee_sensitivity = _aggregate(fee_map, "fee_bps")
        slippage_sensitivity = _aggregate(slippage_map, "slippage_bps")
        funding_sensitivity = _aggregate(funding_map, "funding_rate_bps_per_cycle")

        max_fee_ok: float | None = None
        for row in fee_sensitivity:
            if _to_float(row.get("avg_return_pct")) >= 0:
                max_fee_ok = _to_float(row.get("fee_bps"))

        max_slippage_ok: float | None = None
        for row in slippage_sensitivity:
            if _to_float(row.get("avg_return_pct")) >= 0:
                max_slippage_ok = _to_float(row.get("slippage_bps"))

        drawdown_cap = 1.0
        conservative = next((r for r in rows if _to_float(r.get("max_drawdown_pct")) <= drawdown_cap), None)
        notes: list[str] = [
            f"best final_cash spread versus worst is {round(spread, 6)}",
            f"drawdown cap for conservative candidate is {drawdown_cap}%",
        ]
        if max_fee_ok is not None:
            notes.append(f"average return stays non-negative up to fee={max_fee_ok} bps")
        else:
            notes.append("all fee buckets show negative average return")
        if max_slippage_ok is not None:
            notes.append(f"average return stays non-negative up to slippage={max_slippage_ok} bps")
        else:
            notes.append("all slippage buckets show negative average return")

        recommendations = {
            "recommended_params": {
                "fee_bps": _to_float(best.get("fee_bps")),
                "slippage_bps": _to_float(best.get("slippage_bps")),
                "funding_rate_bps_per_cycle": _to_float(best.get("funding_rate_bps_per_cycle")),
            },
            "cost_tolerance": {
                "max_fee_bps_non_negative_return": max_fee_ok,
                "max_slippage_bps_non_negative_return": max_slippage_ok,
            },
            "conservative_params": {
                "fee_bps": _to_float(conservative.get("fee_bps")),
                "slippage_bps": _to_float(conservative.get("slippage_bps")),
                "funding_rate_bps_per_cycle": _to_float(conservative.get("funding_rate_bps_per_cycle")),
            }
            if conservative
            else None,
            "command_templates": [],
            "notes": notes,
        }

        constrained_rows = rows
        if max_drawdown_pct is not None:
            constrained_rows = [r for r in constrained_rows if _to_float(r.get("max_drawdown_pct")) <= max_drawdown_pct]
        if min_closed_trades is not None:
            constrained_rows = [r for r in constrained_rows if int(_to_float(r.get("closed_trades"))) >= min_closed_trades]
        constrained_best = constrained_rows[0] if constrained_rows else None

        cmd_templates: list[dict[str, str]] = [
            {
                "name": "recommended_run",
                "command": self._build_backtest_command(
                    fee_bps=_to_float(best.get("fee_bps")),
                    slippage_bps=_to_float(best.get("slippage_bps")),
                    funding_rate_bps_per_cycle=_to_float(best.get("funding_rate_bps_per_cycle")),
                ),
            }
        ]
        if conservative is not None:
            cmd_templates.append(
                {
                    "name": "conservative_run",
                    "command": self._build_backtest_command(
                        fee_bps=_to_float(conservative.get("fee_bps")),
                        slippage_bps=_to_float(conservative.get("slippage_bps")),
                        funding_rate_bps_per_cycle=_to_float(conservative.get("funding_rate_bps_per_cycle")),
                    ),
                }
            )
        if constrained_best is not None and (max_drawdown_pct is not None or min_closed_trades is not None):
            cmd_templates.append(
                {
                    "name": "constrained_best_run",
                    "command": self._build_backtest_command(
                        fee_bps=_to_float(constrained_best.get("fee_bps")),
                        slippage_bps=_to_float(constrained_best.get("slippage_bps")),
                        funding_rate_bps_per_cycle=_to_float(constrained_best.get("funding_rate_bps_per_cycle")),
                        max_drawdown_pct=max_drawdown_pct,
                        min_closed_trades=min_closed_trades,
                    ),
                }
            )
        recommendations["command_templates"] = cmd_templates

        return {
            "top_results": rows[: max(1, top_n)],
            "best_result": best,
            "worst_result": worst,
            "constraint": {
                "max_drawdown_pct": max_drawdown_pct,
                "min_closed_trades": min_closed_trades,
            },
            "ranking": {"rank_by": rank_by},
            "constrained_count": len(constrained_rows),
            "constrained_best_result": constrained_best,
            "spread_final_cash": round(spread, 6),
            "fee_sensitivity": fee_sensitivity,
            "slippage_sensitivity": slippage_sensitivity,
            "funding_sensitivity": funding_sensitivity,
            "recommendations": recommendations,
        }

    def run_grid(
        self,
        *,
        fee_bps_grid: list[float],
        slippage_bps_grid: list[float],
        funding_rate_bps_grid: list[float] | None = None,
        top_n: int = 5,
        rank_by: str = "final_cash",
        max_drawdown_pct: float | None = None,
        min_closed_trades: int | None = None,
    ) -> dict[str, object]:
        grid_results: list[dict[str, object]] = []
        funding_grid = funding_rate_bps_grid if funding_rate_bps_grid is not None else [self.funding_rate_bps_per_cycle]
        for fee in fee_bps_grid:
            for slip in slippage_bps_grid:
                for funding in funding_grid:
                    result = self._run_once(
                        fee_bps=max(0.0, fee),
                        slippage_bps=max(0.0, slip),
                        funding_rate_bps_per_cycle=float(funding),
                        include_trades=False,
                    )
                    report = result["report"]
                    if not isinstance(report, dict):
                        continue
                    grid_results.append(
                        {
                            "fee_bps": fee,
                            "slippage_bps": slip,
                            "funding_rate_bps_per_cycle": funding,
                            "final_cash": report.get("final_cash"),
                            "total_return_pct": report.get("total_return_pct"),
                            "realized_pnl": report.get("realized_pnl"),
                            "total_funding_pnl": report.get("total_funding_pnl"),
                            "total_fees": report.get("total_fees"),
                            "closed_trades": report.get("closed_trades"),
                            "profit_factor": report.get("profit_factor"),
                            "sharpe": report.get("sharpe"),
                            "max_drawdown_pct": report.get("max_drawdown_pct"),
                            "win_rate": report.get("win_rate"),
                            "partial_open_count": report.get("partial_open_count"),
                            "retried_open_count": report.get("retried_open_count"),
                            "rejected_open_count": report.get("rejected_open_count"),
                        }
                    )
        sort_map: dict[str, tuple[str, bool]] = {
            "final_cash": ("final_cash", True),
            "total_return_pct": ("total_return_pct", True),
            "sharpe": ("sharpe", True),
            "profit_factor": ("profit_factor", True),
            "win_rate": ("win_rate", True),
            "max_drawdown_pct": ("max_drawdown_pct", False),
        }
        if rank_by not in sort_map:
            raise ValueError(f"unsupported rank_by={rank_by}")
        field, reverse = sort_map[rank_by]
        grid_results.sort(key=lambda x: _to_float(x.get(field)), reverse=reverse)
        analysis = self._analyze_grid_results(
            grid_results,
            top_n=max(1, top_n),
            rank_by=rank_by,
            max_drawdown_pct=max_drawdown_pct,
            min_closed_trades=min_closed_trades,
        )
        return {
            "mode": "backtest_grid",
            "dataset_path": self.dataset.source_path,
            "symbols": self.dataset.symbols,
            "steps": self.dataset.steps,
            "rank_by": rank_by,
            "rank_order": "desc" if reverse else "asc",
            "runs": len(grid_results),
            "results": grid_results,
            "best": grid_results[0] if grid_results else None,
            "analysis": analysis,
        }
