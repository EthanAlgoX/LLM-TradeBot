# TradeBot

A multi-agent cryptocurrency trading scaffold built from the V2 pipeline:

`Selector -> Data -> Signal/Prediction/Context/Semantic -> Fusion -> Decision -> Portfolio -> Risk -> Execution -> Post-Trade`

## Quick start

```bash
python -m pip install -e .[dev]
tradebot --cycles 3
pytest
```

## Architecture Map (Important Files)

### 1) Entry / Runtime

- `src/tradebot/cli.py`
  - CLI entrypoint.
  - Routes to runtime mode (`run cycles`), replay mode (`--replay-*`), or backtest mode (`--backtest-*`).
- `src/tradebot/config.py`
  - Central runtime config + `from_env()` environment loader.
  - Includes provider selection, live safeguards, persistence config, and backtest defaults.

### 2) Pipeline Orchestration

- `src/tradebot/orchestrator.py`
  - Core multi-agent scheduler for pipeline:
    - `Selector -> Data -> Signal/Prediction/Context/Semantic -> Fusion -> Decision -> Portfolio -> Risk -> Execution -> Post-Trade`
  - Builds/holds all agents.
  - Emits runtime events.
  - Integrates persistence store when enabled.

### 3) Contracts / State / Events

- `src/tradebot/contracts.py`
  - Typed data contracts (`UniverseSet`, `MarketSnapshot`, `ProposedAction`, `CycleResult`, etc.).
- `src/tradebot/state.py`
  - Runtime state model (`RuntimeState`, positions, trade ledger, prices, reflection hint).
- `src/tradebot/events.py`
  - Event bus model for stage start/end events (`RuntimeEvent`, `EventBus`).

### 4) Agent Layer

- `src/tradebot/agents/selector.py`
  - Unified selector (`ai500 + market rank + feedback`) and Top-N universe output.
- `src/tradebot/agents/data.py`
  - Converts market data provider output into `MarketSnapshot`.
- `src/tradebot/agents/analysis.py`
  - Signal / Prediction / Context / Semantic / Fusion agents.
- `src/tradebot/agents/decision.py`
  - Decision routing (fast trend / rule path / reversal close / hold/wait).
- `src/tradebot/agents/portfolio.py`
  - Opportunity ranking and action selection policy.
- `src/tradebot/agents/risk.py`
  - Risk audit (leverage, RR, caps, correction checks).
- `src/tradebot/agents/execution.py`
  - Execution planner + execution entry.
- `src/tradebot/agents/post_trade.py`
  - Position monitor and reflection feedback loop.

### 5) Provider Layer (Pluggable Adapters)

- `src/tradebot/providers/factory.py`
  - Provider factory wiring from config.
- `src/tradebot/providers/data.py`
  - Market data providers (`sim`, `binance`, fallback wrapper).
- `src/tradebot/providers/ranking.py`
  - Market rank providers (`mock`, `binance`).
- `src/tradebot/providers/execution.py`
  - Execution providers (`sim`, `paper`, `binance_live`).
- `src/tradebot/providers/binance_rules.py`
  - Binance futures symbol rules (`exchangeInfo`) parser and quantity formatting/quantization.

### 6) Persistence / Replay

- `src/tradebot/storage.py`
  - SQLite persistence store:
    - runtime state
    - positions/prices/trades
    - cycle outputs
    - stage events
  - Supports reset and replay querying APIs.

### 7) Backtest

- `src/tradebot/backtest.py`
  - CSV dataset loader.
  - Backtest market data/rank providers.
  - Backtest execution model with fee/slippage.
  - Single-run and grid backtest engine.
  - Grid analysis, recommendations, and markdown summary rendering.

### 8) Tests

- `tests/test_pipeline.py` / `tests/test_risk.py`
  - Core pipeline and risk behavior checks.
- `tests/test_config_and_factory.py`
  - Config/env and provider factory tests.
- `tests/test_storage.py`
  - Persistence + replay + reset tests.
- `tests/test_backtest.py` / `tests/test_cli_replay.py`
  - Backtest and replay analytics tests.

## Backtest (CSV)

Run historical replay backtest from CSV:

```bash
tradebot --backtest-csv data/bars.csv --backtest-symbols BTCUSDT,ETHUSDT,SOLUSDT --backtest-max-steps 500 --pretty
```

Configure execution cost model and write report:

```bash
tradebot --backtest-csv data/bars.csv --backtest-fee-bps 3 --backtest-slippage-bps 1 --backtest-output reports/backtest.json --backtest-summary-output reports/backtest.md --pretty
```

Run parameter sweep (grid backtest):

```bash
tradebot --backtest-csv data/bars.csv --backtest-fee-grid 0,1,3,5 --backtest-slippage-grid 0,1,2 --backtest-output reports/backtest_grid.json --pretty
```

Control analysis output size:

```bash
tradebot --backtest-csv data/bars.csv --backtest-fee-grid 0,1,3,5 --backtest-slippage-grid 0,1,2 --backtest-top-n 5 --pretty
```

Grid output includes `analysis.recommendations` with suggested params and cost tolerance.
It also includes `analysis.recommendations.command_templates` for directly runnable commands.

Rank grid by risk metric instead of cash:

```bash
tradebot --backtest-csv data/bars.csv --backtest-fee-grid 0,1,3,5 --backtest-slippage-grid 0,1,2 --backtest-rank-by max_drawdown_pct --pretty
```

Add grid constraints (pick best under risk/trade constraints):

```bash
tradebot --backtest-csv data/bars.csv --backtest-fee-grid 0,1,3,5 --backtest-slippage-grid 0,1,2 --backtest-max-drawdown-pct 5 --backtest-min-closed-trades 10 --pretty
```

Required CSV columns:

- `ts` (ISO8601 datetime)
- `symbol`
- `close`

Optional CSV columns:

- `quote_volume` (defaults to `0` if omitted)

Automated real-data audit (3 days, 1h):

```bash
python scripts/run_real_data_audit.py
```

This command fetches Binance Futures real klines for `BTCUSDT,ETHUSDT,SOLUSDT`,
writes `data/real_3d_1h_binance.csv`, then runs:

- single-run audit report (fee `3`, slippage `1`)
- grid audit report (fee `0,1,3,5`, slippage `0,1,2`)

Outputs:

- `reports/audit_real_3d_1h_single.json`
- `reports/audit_real_3d_1h_single.md`
- `reports/audit_real_3d_1h_grid.json`
- `reports/audit_real_3d_1h_grid.md`

## Runtime modes

- `sim` (default): fully deterministic local simulation
- `paper`: local portfolio accounting with paper execution labels
- `binance_live`: submit live futures market orders (safety gate required)

## Provider switches

```bash
# Use real Binance market data + Binance rank, but keep paper execution.
tradebot --cycles 2 --data-provider binance --market-rank-provider binance --execution-provider paper --pretty
```

Enable persistence (restart recovery):

```bash
tradebot --cycles 5 --persistence-path data/tradebot.db --pretty
```

With persistence enabled, each cycle also writes trace files under `data/traces/<trace_id>/`:

- `inputs.json`: selector output + market snapshot inputs
- `agent_io.jsonl`: full multi-agent stage events (start/end + payload)
- `trades.json`: cycle trades + full trade ledger + open positions
- `cycle_result.json`: final cycle decision/output
- `state_snapshot.json`: full runtime state snapshot after cycle

And `data/traces/latest_trace_id.txt` points to the latest trace id.

Reset persisted state and start from cycle 1:

```bash
tradebot --cycles 1 --persistence-path data/tradebot.db --reset-state --pretty
```

Replay persisted agent runtime events:

```bash
# Replay latest cycle
tradebot --persistence-path data/tradebot.db --replay-latest --pretty

# Replay a specific trace
tradebot --persistence-path data/tradebot.db --replay-trace "cycle:12:20260305T010203Z" --pretty

# Replay only risk stage and keep last 20 events
tradebot --persistence-path data/tradebot.db --replay-latest --replay-stage risk --replay-max-events 20 --pretty

# Replay only aggregated stage stats (no raw events)
tradebot --persistence-path data/tradebot.db --replay-latest --replay-summary-only --pretty
```

Environment variables:

- `TRADEBOT_DATA_PROVIDER=sim|binance`
- `TRADEBOT_MARKET_RANK_PROVIDER=mock|binance`
- `TRADEBOT_EXECUTION_PROVIDER=sim|paper|binance_live`
- `TRADEBOT_BINANCE_API_KEY=...`
- `TRADEBOT_BINANCE_API_SECRET=...`
- `TRADEBOT_LIVE_CONFIRM=YES` (required for `binance_live`, default `NO`)
- `TRADEBOT_PERSISTENCE_ENABLED=1`
- `TRADEBOT_PERSISTENCE_PATH=data/tradebot.db`
- `TRADEBOT_BACKTEST_FEE_BPS=3`
- `TRADEBOT_BACKTEST_SLIPPAGE_BPS=1`

## Live execution safeguards

- For `binance_live`, TradeBot fetches Binance Futures `exchangeInfo` and applies symbol rules before submit:
  - quantity `stepSize` rounding
  - `minQty`/`maxQty` checks
  - `minNotional` checks (for open actions)
- `close_long` / `close_short` use current local position quantity by default.
- When persistence is enabled, each cycle's runtime events are stored in SQLite `events` table for trace replay.
