#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BINANCE_FAPI_KLINES = "https://fapi.binance.com/fapi/v1/klines"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch real Binance klines and run TradeBot audit flow.")
    p.add_argument("--symbols", default="BTCUSDT,ETHUSDT,SOLUSDT", help="Comma separated symbols")
    p.add_argument("--interval", default="1h", help="Binance kline interval")
    p.add_argument("--hours", type=int, default=72, help="Number of bars per symbol (3 days * 24h = 72)")
    p.add_argument("--max-steps", type=int, help="Backtest max steps, defaults to --hours")
    p.add_argument("--single-fee-bps", type=float, default=3.0)
    p.add_argument("--single-slippage-bps", type=float, default=1.0)
    p.add_argument("--max-open-notional-share", type=float, default=0.02)
    p.add_argument("--max-open-retries", type=int, default=2)
    p.add_argument("--grid-fees", default="0,1,3,5")
    p.add_argument("--grid-slippages", default="0,1,2")
    p.add_argument("--grid-top-n", type=int, default=5)
    p.add_argument("--grid-rank-by", default="max_drawdown_pct")
    p.add_argument("--csv-output", default="data/real_3d_1h_binance.csv")
    p.add_argument("--single-json-output", default="reports/audit_real_3d_1h_single.json")
    p.add_argument("--single-md-output", default="reports/audit_real_3d_1h_single.md")
    p.add_argument("--grid-json-output", default="reports/audit_real_3d_1h_grid.json")
    p.add_argument("--grid-md-output", default="reports/audit_real_3d_1h_grid.md")
    p.add_argument("--skip-fetch", action="store_true", help="Skip fetching klines and reuse existing csv")
    return p.parse_args()


def fetch_symbol_klines(*, symbol: str, interval: str, limit: int) -> list[list[object]]:
    query = urllib.parse.urlencode({"symbol": symbol, "interval": interval, "limit": limit})
    url = f"{BINANCE_FAPI_KLINES}?{query}"
    with urllib.request.urlopen(url, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not isinstance(data, list):
        raise RuntimeError(f"unexpected response for {symbol}: {data}")
    if len(data) < limit:
        raise RuntimeError(f"insufficient bars for {symbol}: got {len(data)}, want {limit}")
    return data[-limit:]


def write_csv(*, path: Path, symbols: list[str], interval: str, limit: int) -> tuple[str, str]:
    rows: list[tuple[str, str, float, float]] = []
    for symbol in symbols:
        klines = fetch_symbol_klines(symbol=symbol, interval=interval, limit=limit)
        for item in klines:
            open_ms = int(item[0])
            ts = datetime.fromtimestamp(open_ms / 1000, tz=timezone.utc).isoformat(timespec="seconds")
            close = float(item[4])
            quote_volume = float(item[7])
            rows.append((ts, symbol, close, quote_volume))

    rows.sort(key=lambda x: (x[0], x[1]))
    if not rows:
        raise RuntimeError("no rows generated from exchange response")

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["ts", "symbol", "close", "quote_volume"])
        writer.writerows(rows)
    return rows[0][0], rows[-1][0]


def run_cmd(cmd: list[str], *, env: dict[str, str]) -> None:
    print("$", " ".join(cmd))
    subprocess.run(cmd, check=True, env=env)


def main() -> None:
    args = parse_args()
    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    if not symbols:
        raise SystemExit("no symbols provided")
    if args.hours <= 1:
        raise SystemExit("--hours must be > 1")
    if args.max_open_notional_share < 0:
        raise SystemExit("--max-open-notional-share must be >= 0")
    if args.max_open_retries < 0:
        raise SystemExit("--max-open-retries must be >= 0")

    csv_output = Path(args.csv_output)
    if args.skip_fetch:
        if not csv_output.exists():
            raise SystemExit(f"--skip-fetch set but csv not found: {csv_output}")
        print(f"reuse csv: {csv_output}")
    else:
        start_ts, end_ts = write_csv(path=csv_output, symbols=symbols, interval=args.interval, limit=args.hours)
        print(f"csv written: {csv_output}")
        print(f"range_utc: {start_ts} -> {end_ts}")

    Path(args.single_json_output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.grid_json_output).parent.mkdir(parents=True, exist_ok=True)

    max_steps = args.max_steps if args.max_steps and args.max_steps > 0 else args.hours
    symbol_arg = ",".join(symbols)

    env = os.environ.copy()
    py_path = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = f"src{os.pathsep}{py_path}" if py_path else "src"

    base = [
        sys.executable,
        "-m",
        "cli",
        "--backtest-csv",
        str(csv_output),
        "--backtest-symbols",
        symbol_arg,
        "--backtest-max-steps",
        str(max_steps),
        "--backtest-max-open-notional-share",
        str(args.max_open_notional_share),
        "--backtest-max-open-retries",
        str(args.max_open_retries),
    ]

    run_cmd(
        base
        + [
            "--backtest-fee-bps",
            str(args.single_fee_bps),
            "--backtest-slippage-bps",
            str(args.single_slippage_bps),
            "--backtest-include-trades",
            "--backtest-output",
            args.single_json_output,
            "--backtest-summary-output",
            args.single_md_output,
            "--pretty",
        ],
        env=env,
    )

    run_cmd(
        base
        + [
            "--backtest-fee-grid",
            args.grid_fees,
            "--backtest-slippage-grid",
            args.grid_slippages,
            "--backtest-top-n",
            str(args.grid_top_n),
            "--backtest-rank-by",
            args.grid_rank_by,
            "--backtest-output",
            args.grid_json_output,
            "--backtest-summary-output",
            args.grid_md_output,
            "--pretty",
        ],
        env=env,
    )

    single_report = json.loads(Path(args.single_json_output).read_text(encoding="utf-8"))
    grid_report = json.loads(Path(args.grid_json_output).read_text(encoding="utf-8"))
    single = single_report.get("report", {})
    best = grid_report.get("best", {})

    print("single:", {k: single.get(k) for k in ("final_cash", "total_return_pct", "max_drawdown_pct", "win_rate")})
    print("grid_best:", {k: best.get(k) for k in ("fee_bps", "slippage_bps", "final_cash", "max_drawdown_pct")})
    print("outputs:", args.single_json_output, args.single_md_output, args.grid_json_output, args.grid_md_output)


if __name__ == "__main__":
    main()
