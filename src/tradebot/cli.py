from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime
from typing import Any

from tradebot.config import RuntimeConfig
from tradebot.orchestrator import MultiAgentTradeBot
from tradebot.storage import SQLiteStateStore


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="TradeBot multi-agent runner")
    p.add_argument("--cycles", type=int, default=1, help="Number of cycles to run")
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
    if args.replay_max_events is not None and args.replay_max_events <= 0:
        raise SystemExit("configuration error: --replay-max-events must be > 0")
    if (args.replay_stage or args.replay_max_events is not None or args.replay_summary_only) and not (args.replay_trace or args.replay_latest):
        raise SystemExit("configuration error: replay filters require --replay-trace or --replay-latest")
    if args.replay_trace or args.replay_latest:
        _replay(args, cfg)
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
