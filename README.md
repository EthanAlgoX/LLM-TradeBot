# TradeBot

A multi-agent cryptocurrency trading scaffold built from the V2 pipeline:

`Selector -> Data -> Signal/Prediction/Context/Semantic -> Fusion -> Decision -> Portfolio -> Risk -> Execution -> Post-Trade`

## Quick start

```bash
python -m pip install -e .[dev]
tradebot --cycles 3
pytest
```

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

Reset persisted state and start from cycle 1:

```bash
tradebot --cycles 1 --persistence-path data/tradebot.db --reset-state --pretty
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

## Live execution safeguards

- For `binance_live`, TradeBot fetches Binance Futures `exchangeInfo` and applies symbol rules before submit:
  - quantity `stepSize` rounding
  - `minQty`/`maxQty` checks
  - `minNotional` checks (for open actions)
- `close_long` / `close_short` use current local position quantity by default.
- When persistence is enabled, each cycle's runtime events are stored in SQLite `events` table for trace replay.
