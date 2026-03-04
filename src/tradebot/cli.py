from __future__ import annotations

import argparse
import asyncio
import json

from tradebot.config import RuntimeConfig
from tradebot.orchestrator import MultiAgentTradeBot


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="TradeBot multi-agent runner")
    p.add_argument("--cycles", type=int, default=1, help="Number of cycles to run")
    p.add_argument("--data-provider", choices=["sim", "binance"], help="Market data provider")
    p.add_argument("--market-rank-provider", choices=["mock", "binance"], help="Market-rank provider")
    p.add_argument("--execution-provider", choices=["sim", "paper", "binance_live"], help="Execution provider")
    p.add_argument("--live-confirm", choices=["YES", "NO"], help="Safety switch for live execution")
    p.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    return p


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
    try:
        bot = MultiAgentTradeBot(cfg=cfg)
    except ValueError as exc:
        raise SystemExit(f"configuration error: {exc}") from exc

    for _ in range(max(1, args.cycles)):
        result = asyncio.run(bot.run_cycle())
        payload = {
            "cycle": result.cycle,
            "trace_id": result.trace_id,
            "status": result.status,
            "action": result.action,
            "selected_symbols": result.selected_symbols,
            "details": result.details,
        }
        if args.pretty:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
