from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from backtest import BacktestRunner, render_backtest_markdown
from config import RuntimeConfig
from orchestrator import MultiAgentTradeBot
from storage import SQLiteStateStore


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="TradeBot multi-agent runner")
    p.add_argument("--cycles", type=int, default=1, help="Number of cycles to run")
    p.add_argument("--backtest-csv", help="Run historical backtest from csv file")
    p.add_argument("--backtest-start", help="Backtest start datetime (ISO8601)")
    p.add_argument("--backtest-end", help="Backtest end datetime (ISO8601)")
    p.add_argument("--backtest-symbols", help="Comma separated symbols filter for backtest")
    p.add_argument("--backtest-max-steps", type=int, help="Maximum aligned steps for backtest")
    p.add_argument("--backtest-fee-bps", type=float, help="Per-side fee in bps for backtest execution")
    p.add_argument("--backtest-slippage-bps", type=float, help="Per-fill slippage in bps for backtest execution")
    p.add_argument(
        "--backtest-max-open-notional-share",
        type=float,
        help="Max notional share of one bar quote volume allowed for a single open order (0 disables liquidity cap)",
    )
    p.add_argument(
        "--backtest-max-open-retries",
        type=int,
        help="Maximum retries for open order fills on subsequent bars when liquidity is insufficient",
    )
    p.add_argument(
        "--backtest-funding-rate-bps-per-cycle",
        type=float,
        help="Funding rate (bps) applied per cycle on open positions; positive means longs pay shorts",
    )
    p.add_argument("--backtest-fee-grid", help="Comma separated fee bps grid for parameter sweep")
    p.add_argument("--backtest-slippage-grid", help="Comma separated slippage bps grid for parameter sweep")
    p.add_argument("--backtest-funding-grid", help="Comma separated funding-rate bps-per-cycle grid for parameter sweep")
    p.add_argument("--backtest-top-n", type=int, help="Top N results to include in grid analysis")
    p.add_argument(
        "--backtest-rank-by",
        choices=["final_cash", "total_return_pct", "sharpe", "profit_factor", "win_rate", "max_drawdown_pct"],
        help="Grid ranking metric",
    )
    p.add_argument("--backtest-max-drawdown-pct", type=float, help="Grid constraint: max drawdown percent")
    p.add_argument("--backtest-min-closed-trades", type=int, help="Grid constraint: min closed trades")
    p.add_argument("--backtest-output", help="Write backtest JSON result to this file path")
    p.add_argument("--backtest-summary-output", help="Write backtest markdown summary to this file path")
    p.add_argument("--backtest-include-trades", action="store_true", help="Include full trade list in backtest output")
    p.add_argument("--data-provider", choices=["sim", "binance"], help="Market data provider")
    p.add_argument("--market-rank-provider", choices=["mock", "binance"], help="Market-rank provider")
    p.add_argument("--execution-provider", choices=["sim", "paper", "binance_live"], help="Execution provider")
    p.add_argument("--live-confirm", choices=["YES", "NO"], help="Safety switch for live execution")
    p.add_argument("--persistence-path", help="Enable SQLite persistence and write state to this DB path")
    p.add_argument("--no-persistence", action="store_true", help="Disable persistence even if enabled by env")
    p.add_argument("--reset-state", action="store_true", help="Reset persisted state before running")
    p.add_argument("--replay-trace", help="Replay stored runtime events by trace_id")
    p.add_argument("--replay-latest", action="store_true", help="Replay stored runtime events from latest cycle")
    p.add_argument("--replay-stage", help="Filter replay events by stage (e.g. selector, analysis, risk)")
    p.add_argument("--replay-max-events", type=int, help="Return at most N latest events after replay filter")
    p.add_argument("--replay-summary-only", action="store_true", help="Replay only stage summary instead of full events")
    p.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    return p


def _dump(payload: dict[str, Any], *, pretty: bool) -> None:
    if pretty:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(payload, ensure_ascii=False))


def _parse_ts(ts: str) -> datetime | None:
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def _build_stage_summary(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    summary_map: dict[str, dict[str, Any]] = {}
    for ev in events:
        stage = str(ev.get("stage", "unknown"))
        phase = str(ev.get("phase", "unknown"))
        seq = int(ev.get("seq", 0))
        ts = str(ev.get("ts", ""))

        row = summary_map.get(stage)
        if row is None:
            row = {
                "stage": stage,
                "event_count": 0,
                "start_count": 0,
                "end_count": 0,
                "first_seq": seq,
                "first_ts": ts,
                "last_ts": ts,
                "duration_ms": None,
            }
            summary_map[stage] = row

        row["event_count"] += 1
        if phase == "start":
            row["start_count"] += 1
        if phase == "end":
            row["end_count"] += 1
        if seq < int(row["first_seq"]):
            row["first_seq"] = seq
            row["first_ts"] = ts
        row["last_ts"] = ts

    out = sorted(summary_map.values(), key=lambda x: int(x["first_seq"]))
    for row in out:
        t0 = _parse_ts(str(row["first_ts"]))
        t1 = _parse_ts(str(row["last_ts"]))
        if t0 is not None and t1 is not None:
            row["duration_ms"] = max(0, int((t1 - t0).total_seconds() * 1000))
        del row["first_seq"]
    return out


def _parse_float_grid(raw: str) -> list[float]:
    out: list[float] = []
    for item in raw.split(","):
        part = item.strip()
        if not part:
            continue
        out.append(float(part))
    if not out:
        raise ValueError("empty grid")
    return out


def _replay(args: argparse.Namespace, cfg: RuntimeConfig) -> None:
    if args.reset_state:
        raise SystemExit("configuration error: --reset-state cannot be used with replay options")
    store = SQLiteStateStore(cfg.persistence_path)
    trace_id = args.replay_trace
    if args.replay_latest:
        trace_id = store.latest_trace_id()
    if not trace_id:
        raise SystemExit("replay error: no cycle found in persistence store")

    summary = store.load_cycle_summary(trace_id)
    if summary is None:
        raise SystemExit(f"replay error: trace_id not found: {trace_id}")
    all_events = store.load_events(trace_id)
    events = store.load_events(trace_id, stage=args.replay_stage, limit=args.replay_max_events)

    _dump(
        {
            "trace_id": trace_id,
            "summary": summary,
            "filters": {
                "stage": args.replay_stage,
                "max_events": args.replay_max_events,
                "summary_only": args.replay_summary_only,
            },
            "total_event_count": len(all_events),
            "event_count": len(events),
            "stage_summary": _build_stage_summary(events),
            "events": [] if args.replay_summary_only else events,
        },
        pretty=args.pretty,
    )


def main() -> None:
    args = build_parser().parse_args()
    cfg = RuntimeConfig.from_env()
    if args.data_provider:
        cfg.data_provider = args.data_provider
    if args.market_rank_provider:
        cfg.market_rank_provider = args.market_rank_provider
    if args.execution_provider:
        cfg.execution_provider = args.execution_provider
    if args.live_confirm:
        cfg.live_confirm_token = args.live_confirm
    if args.persistence_path:
        cfg.persistence_enabled = True
        cfg.persistence_path = args.persistence_path
    if args.reset_state:
        cfg.persistence_enabled = True
    if args.no_persistence:
        if args.reset_state:
            raise SystemExit("configuration error: --reset-state cannot be used with --no-persistence")
        cfg.persistence_enabled = False
    if args.replay_trace and args.replay_latest:
        raise SystemExit("configuration error: use only one of --replay-trace or --replay-latest")
    if args.backtest_max_steps is not None and args.backtest_max_steps <= 0:
        raise SystemExit("configuration error: --backtest-max-steps must be > 0")
    if args.backtest_fee_bps is not None and args.backtest_fee_bps < 0:
        raise SystemExit("configuration error: --backtest-fee-bps must be >= 0")
    if args.backtest_slippage_bps is not None and args.backtest_slippage_bps < 0:
        raise SystemExit("configuration error: --backtest-slippage-bps must be >= 0")
    if args.backtest_max_open_notional_share is not None and args.backtest_max_open_notional_share < 0:
        raise SystemExit("configuration error: --backtest-max-open-notional-share must be >= 0")
    if args.backtest_max_open_retries is not None and args.backtest_max_open_retries < 0:
        raise SystemExit("configuration error: --backtest-max-open-retries must be >= 0")
    if args.backtest_top_n is not None and args.backtest_top_n <= 0:
        raise SystemExit("configuration error: --backtest-top-n must be > 0")
    if args.backtest_max_drawdown_pct is not None and args.backtest_max_drawdown_pct < 0:
        raise SystemExit("configuration error: --backtest-max-drawdown-pct must be >= 0")
    if args.backtest_min_closed_trades is not None and args.backtest_min_closed_trades < 0:
        raise SystemExit("configuration error: --backtest-min-closed-trades must be >= 0")
    if (
        args.backtest_start
        or args.backtest_end
        or args.backtest_symbols
        or args.backtest_max_steps is not None
        or args.backtest_fee_bps is not None
        or args.backtest_slippage_bps is not None
        or args.backtest_max_open_notional_share is not None
        or args.backtest_max_open_retries is not None
        or args.backtest_funding_rate_bps_per_cycle is not None
        or args.backtest_funding_grid is not None
        or args.backtest_top_n is not None
        or args.backtest_rank_by is not None
        or args.backtest_max_drawdown_pct is not None
        or args.backtest_min_closed_trades is not None
        or args.backtest_output
        or args.backtest_summary_output
        or args.backtest_include_trades
    ) and not args.backtest_csv:
        raise SystemExit("configuration error: --backtest-* filters require --backtest-csv")
    if args.backtest_csv and (args.replay_trace or args.replay_latest):
        raise SystemExit("configuration error: backtest mode cannot be combined with replay mode")
    if args.backtest_csv and args.reset_state:
        raise SystemExit("configuration error: backtest mode cannot be combined with --reset-state")
    fee_grid: list[float] | None = None
    slippage_grid: list[float] | None = None
    funding_grid: list[float] | None = None
    if args.backtest_fee_grid is not None:
        try:
            fee_grid = _parse_float_grid(args.backtest_fee_grid)
        except ValueError as exc:
            raise SystemExit(f"configuration error: invalid --backtest-fee-grid ({exc})") from exc
    if args.backtest_slippage_grid is not None:
        try:
            slippage_grid = _parse_float_grid(args.backtest_slippage_grid)
        except ValueError as exc:
            raise SystemExit(f"configuration error: invalid --backtest-slippage-grid ({exc})") from exc
    if args.backtest_funding_grid is not None:
        try:
            funding_grid = _parse_float_grid(args.backtest_funding_grid)
        except ValueError as exc:
            raise SystemExit(f"configuration error: invalid --backtest-funding-grid ({exc})") from exc
    if fee_grid is not None and any(x < 0 for x in fee_grid):
        raise SystemExit("configuration error: --backtest-fee-grid values must be >= 0")
    if slippage_grid is not None and any(x < 0 for x in slippage_grid):
        raise SystemExit("configuration error: --backtest-slippage-grid values must be >= 0")
    if (fee_grid is not None) != (slippage_grid is not None):
        raise SystemExit("configuration error: --backtest-fee-grid and --backtest-slippage-grid must be used together")
    if funding_grid is not None and fee_grid is None:
        raise SystemExit("configuration error: --backtest-funding-grid requires fee/slippage grid mode")
    if fee_grid is not None and args.backtest_include_trades:
        raise SystemExit("configuration error: --backtest-include-trades is not supported in grid mode")
    if fee_grid is None and args.backtest_top_n is not None:
        raise SystemExit("configuration error: --backtest-top-n is only supported in grid mode")
    if fee_grid is None and args.backtest_rank_by is not None:
        raise SystemExit("configuration error: --backtest-rank-by is only supported in grid mode")
    if fee_grid is None and args.backtest_max_drawdown_pct is not None:
        raise SystemExit("configuration error: --backtest-max-drawdown-pct is only supported in grid mode")
    if fee_grid is None and args.backtest_min_closed_trades is not None:
        raise SystemExit("configuration error: --backtest-min-closed-trades is only supported in grid mode")
    if args.replay_max_events is not None and args.replay_max_events <= 0:
        raise SystemExit("configuration error: --replay-max-events must be > 0")
    if (args.replay_stage or args.replay_max_events is not None or args.replay_summary_only) and not (args.replay_trace or args.replay_latest):
        raise SystemExit("configuration error: replay filters require --replay-trace or --replay-latest")
    if args.replay_trace or args.replay_latest:
        _replay(args, cfg)
        return
    if args.backtest_csv:
        symbol_filter = [x.strip() for x in (args.backtest_symbols or "").split(",") if x.strip()]
        runner = BacktestRunner(
            cfg=cfg,
            csv_path=args.backtest_csv,
            start=args.backtest_start,
            end=args.backtest_end,
            symbols=symbol_filter or None,
            max_steps=args.backtest_max_steps,
            fee_bps=args.backtest_fee_bps,
            slippage_bps=args.backtest_slippage_bps,
            max_open_notional_share_of_bar=args.backtest_max_open_notional_share,
            max_open_retries=args.backtest_max_open_retries,
            funding_rate_bps_per_cycle=args.backtest_funding_rate_bps_per_cycle,
        )
        if fee_grid is not None and slippage_grid is not None:
            payload = runner.run_grid(
                fee_bps_grid=fee_grid,
                slippage_bps_grid=slippage_grid,
                funding_rate_bps_grid=funding_grid,
                top_n=args.backtest_top_n or 5,
                rank_by=args.backtest_rank_by or "final_cash",
                max_drawdown_pct=args.backtest_max_drawdown_pct,
                min_closed_trades=args.backtest_min_closed_trades,
            )
        else:
            payload = runner.run(include_trades=args.backtest_include_trades)
        if args.backtest_output:
            out_path = Path(args.backtest_output)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        if args.backtest_summary_output:
            md_path = Path(args.backtest_summary_output)
            md_path.parent.mkdir(parents=True, exist_ok=True)
            md_path.write_text(render_backtest_markdown(payload, top_n=args.backtest_top_n or 5), encoding="utf-8")
        _dump(payload, pretty=args.pretty)
        return
    try:
        bot = MultiAgentTradeBot(cfg=cfg, reset_state=args.reset_state)
    except ValueError as exc:
        raise SystemExit(f"configuration error: {exc}") from exc

    for _ in range(max(1, args.cycles)):
        result = asyncio.run(bot.run_cycle())
        _dump(
            {
                "cycle": result.cycle,
                "trace_id": result.trace_id,
                "status": result.status,
                "action": result.action,
                "selected_symbols": result.selected_symbols,
                "details": result.details,
            },
            pretty=args.pretty,
        )


if __name__ == "__main__":
    main()
