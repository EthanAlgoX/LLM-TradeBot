from __future__ import annotations

import asyncio
import copy
import csv
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from statistics import mean, pstdev
from typing import Any

from tradebot.config import RuntimeConfig
from tradebot.contracts import ExecutionResult, ProposedAction, SCHEMA_V2
from tradebot.orchestrator import MultiAgentTradeBot
from tradebot.providers.data import MarketDataProvider, ProviderSnapshot
from tradebot.providers.execution import ExecutionProvider
from tradebot.providers.ranking import MarketRankProvider, MarketRankRow
from tradebot.state import Position, RuntimeState, TradeRecord


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
                f"- Final Cash: `{best.get('final_cash', 0)}`",
                f"- Return(%): `{best.get('total_return_pct', 0)}`",
                f"- Max Drawdown(%): `{best.get('max_drawdown_pct', 0)}`",
                "",
                "## Top Results",
                "",
                "| Rank | Fee(bps) | Slippage(bps) | Final Cash | Return(%) | MaxDD(%) | Sharpe |",
                "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
            ]
        )
        for idx, row in enumerate(top, start=1):
            if not isinstance(row, dict):
                continue
            lines.append(
                f"| {idx} | {row.get('fee_bps', 0)} | {row.get('slippage_bps', 0)} | {row.get('final_cash', 0)} | "
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
    fee_bps: float
    slippage_bps: float
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
            "fee_bps": round(self.fee_bps, 6),
            "slippage_bps": round(self.slippage_bps, 6),
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

        min_steps = min(len(rows) for rows in parsed.values())
        if max_steps is not None and max_steps > 0:
            min_steps = min(min_steps, max_steps)
        if min_steps < 2:
            raise ValueError("backtest requires at least 2 aligned bars per symbol")

        trimmed = {sym: rows[:min_steps] for sym, rows in parsed.items()}
        return cls(bars_by_symbol=trimmed, steps=min_steps, source_path=str(p))

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
        idx = max(0, min(cycle, self.dataset.steps - 1))

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
    def __init__(self, *, fee_bps: float = 3.0, slippage_bps: float = 1.0) -> None:
        self.fee_bps = max(0.0, fee_bps)
        self.slippage_bps = max(0.0, slippage_bps)
        self.total_fees_paid = 0.0

    def _fill_price(self, mark_price: float, action: str) -> float:
        slip = self.slippage_bps / 10_000.0
        if action in {"open_long", "close_short"}:  # buy side
            return mark_price * (1.0 + slip)
        if action in {"open_short", "close_long"}:  # sell side
            return mark_price * (1.0 - slip)
        return mark_price

    def _fee(self, fill_price: float, qty: float) -> float:
        return abs(fill_price * qty) * self.fee_bps / 10_000.0

    def execute(self, *, trace_id: str, planned: ProposedAction, state: RuntimeState) -> ExecutionResult:
        symbol = planned.symbol
        action = planned.action
        mark_price = float(planned.order_params.get("entry_price", 0) or 0)
        qty = float(planned.order_params.get("quantity", 0) or 0)
        lev = float(planned.order_params.get("leverage", 1.0) or 1.0)

        if action in {"wait", "hold"}:
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "skipped", "passive action")
        if qty <= 0:
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", "invalid quantity")

        fill = self._fill_price(mark_price, action)
        fee = self._fee(fill, qty)
        self.total_fees_paid += fee

        if action == "open_long":
            state.positions[symbol] = Position(symbol=symbol, side="long", qty=qty, entry_price=fill, leverage=lev, opened_cycle=state.cycle)
            state.cash -= fee
            state.trades.append(TradeRecord(state.cycle, symbol, action, qty, fill, -fee))
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", f"backtest long opened fee={fee:.6f}", fill)

        if action == "open_short":
            state.positions[symbol] = Position(symbol=symbol, side="short", qty=qty, entry_price=fill, leverage=lev, opened_cycle=state.cycle)
            state.cash -= fee
            state.trades.append(TradeRecord(state.cycle, symbol, action, qty, fill, -fee))
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", f"backtest short opened fee={fee:.6f}", fill)

        if action in {"close_long", "close_short"}:
            pos = state.positions.get(symbol)
            if not pos:
                return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", "no position", fill)
            sign = 1.0 if pos.side == "long" else -1.0
            gross_pnl = (fill - pos.entry_price) * pos.qty * sign
            net_pnl = gross_pnl - fee
            state.cash += net_pnl
            state.trades.append(TradeRecord(state.cycle, symbol, action, pos.qty, fill, net_pnl))
            del state.positions[symbol]
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", f"backtest close net_pnl={net_pnl:.6f}", fill)

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
    ) -> None:
        self.cfg = cfg
        self.fee_bps = cfg.backtest_fee_bps if fee_bps is None else max(0.0, fee_bps)
        self.slippage_bps = cfg.backtest_slippage_bps if slippage_bps is None else max(0.0, slippage_bps)
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
        max_drawdown_pct: float | None = None,
        min_closed_trades: int | None = None,
    ) -> str:
        symbol_part = ",".join(self.dataset.symbols)
        cmd = (
            f'tradebot --backtest-csv "{self.dataset.source_path}" '
            f"--backtest-symbols {symbol_part} "
            f"--backtest-max-steps {self.dataset.steps} "
            f"--backtest-fee-bps {round(fee_bps, 6)} "
            f"--backtest-slippage-bps {round(slippage_bps, 6)} --pretty"
        )
        if max_drawdown_pct is not None:
            cmd += f" --backtest-max-drawdown-pct {round(max_drawdown_pct, 6)}"
        if min_closed_trades is not None:
            cmd += f" --backtest-min-closed-trades {int(min_closed_trades)}"
        return cmd

    def _run_once(self, *, fee_bps: float, slippage_bps: float, include_trades: bool) -> dict[str, object]:
        cfg = copy.deepcopy(self.cfg)
        cfg.ai500_candidates = list(self.dataset.symbols)
        cfg.selector.top_n = min(cfg.selector.top_n, len(self.dataset.symbols))
        cfg.persistence_enabled = False
        exec_provider = BacktestExecutionProvider(fee_bps=fee_bps, slippage_bps=slippage_bps)

        bot = MultiAgentTradeBot(
            cfg=cfg,
            market_data_provider=BacktestMarketDataProvider(self.dataset),
            market_rank_provider=BacktestMarketRankProvider(self.dataset),
            execution_provider=exec_provider,
        )

        cycle_results: list[Any] = []
        cash_curve = [{"cycle": 0, "cash": bot.state.cash}]
        status_counts: dict[str, int] = {}

        for _ in range(self.dataset.steps):
            result = asyncio.run(bot.run_cycle())
            cycle_results.append(result)
            cash = float(result.details.get("cash", bot.state.cash))
            cash_curve.append({"cycle": result.cycle, "cash": cash})
            status_counts[result.status] = status_counts.get(result.status, 0) + 1

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

        peak = float(cash_curve[0]["cash"])
        max_dd = 0.0
        for point in cash_curve:
            x = float(point["cash"])
            peak = max(peak, x)
            if peak > 0:
                dd = (peak - x) / peak
                max_dd = max(max_dd, dd)

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
            fee_bps=fee_bps,
            slippage_bps=slippage_bps,
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
            cycle_status_counts=status_counts,
        )

        payload: dict[str, object] = {
            "mode": "backtest_csv",
            "report": report.to_dict(),
            "equity_curve": cash_curve,
            "last_cycle": {
                "cycle": cycle_results[-1].cycle if cycle_results else 0,
                "trace_id": cycle_results[-1].trace_id if cycle_results else "",
                "status": cycle_results[-1].status if cycle_results else "",
                "action": cycle_results[-1].action if cycle_results else "",
            },
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
        return self._run_once(fee_bps=self.fee_bps, slippage_bps=self.slippage_bps, include_trades=include_trades)

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
        for row in rows:
            fee = _to_float(row.get("fee_bps"))
            slip = _to_float(row.get("slippage_bps"))
            fee_map.setdefault(fee, []).append(row)
            slippage_map.setdefault(slip, []).append(row)

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
            },
            "cost_tolerance": {
                "max_fee_bps_non_negative_return": max_fee_ok,
                "max_slippage_bps_non_negative_return": max_slippage_ok,
            },
            "conservative_params": {
                "fee_bps": _to_float(conservative.get("fee_bps")),
                "slippage_bps": _to_float(conservative.get("slippage_bps")),
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
            "recommendations": recommendations,
        }

    def run_grid(
        self,
        *,
        fee_bps_grid: list[float],
        slippage_bps_grid: list[float],
        top_n: int = 5,
        rank_by: str = "final_cash",
        max_drawdown_pct: float | None = None,
        min_closed_trades: int | None = None,
    ) -> dict[str, object]:
        grid_results: list[dict[str, object]] = []
        for fee in fee_bps_grid:
            for slip in slippage_bps_grid:
                result = self._run_once(fee_bps=max(0.0, fee), slippage_bps=max(0.0, slip), include_trades=False)
                report = result["report"]
                if not isinstance(report, dict):
                    continue
                grid_results.append(
                    {
                        "fee_bps": fee,
                        "slippage_bps": slip,
                        "final_cash": report.get("final_cash"),
                        "total_return_pct": report.get("total_return_pct"),
                        "realized_pnl": report.get("realized_pnl"),
                        "total_fees": report.get("total_fees"),
                        "closed_trades": report.get("closed_trades"),
                        "profit_factor": report.get("profit_factor"),
                        "sharpe": report.get("sharpe"),
                        "max_drawdown_pct": report.get("max_drawdown_pct"),
                        "win_rate": report.get("win_rate"),
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
