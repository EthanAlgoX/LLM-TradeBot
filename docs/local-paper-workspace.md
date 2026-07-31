# TradeBot Local Paper Workspace

## Purpose

`npm run dev:paper` starts a loopback-only TradeBot workspace with:

- the real orchestration HTTP API;
- the real Draft, validation, evidence, approval and Paper Plan gates;
- the current Crypto Paper Runtime Binding;
- the real DecisionPipeline, Portfolio, Risk, Paper Execution, Position Monitor and Reflection chain;
- the Web runtime control surface.

It does not add an exchange write adapter.

## Data provenance

The local workspace intentionally separates two sources:

- `CSV SYNTHETIC FIXTURE` supplies reproducible Backtest and Walk-Forward evidence;
- `LOCAL BACKEND FIXTURE` supplies fresh deterministic bars to the bounded Paper Runtime.

Both labels are visible in the Web interface. Neither source is represented as Binance live data.

The normal orchestration CLI still defaults to `binance_public`. The fixture is selected only when the server-owned environment contains:

```text
TRADEBOT_PAPER_MARKET_DATA_MODE=local_fixture
```

## Local state

Generated profiles, fixtures, evidence artifacts and SQLite databases are stored below:

```text
data/local-paper-workspace/
```

The directory is ignored by Git. The local Operator Token exists only in process memory and is injected into the loopback-only Vite development process.

## Operator flow

The current strategy still follows:

```text
Draft
→ Contract Validation
→ Backtest
→ Walk-Forward
→ Human Approval
→ Approved Paper Plan
→ Explicit Activation
→ Preflight
→ Start Paper Run
```

Pause switches the plan to `pause_new_openings_close_only`. Safe stop rejects future cycles and drains after the current cycle. Existing positions remain subject to Position Monitor and Risk.
