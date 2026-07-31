# Binance Futures Public Paper Workspace

## Purpose

`npm run dev:paper:live` starts the TradeBot loopback-only Web and
orchestration API with the current fixed Crypto Paper Runtime Binding.
Paper cycles read Binance Futures public market data. TradeBot does not
load Binance credentials and cannot submit exchange orders.

The existing `npm run dev:paper` command remains the deterministic local
fixture workspace.

## Data provenance

- Release evidence: `CSV SYNTHETIC FIXTURE`
- Paper cycle market data: `BINANCE FUTURES PUBLIC READ ONLY`
- Candidate symbols: server-owned `BTCUSDT`
- Selector behavior: server-owned `topN=1`
- Exchange write capability: `false`

Synthetic release evidence and live public Paper observations are
intentionally labeled separately. The live workspace is a development
mode, not proof that the strategy is production-ready.

## Controlled start

The operator must still complete:

`Draft -> Contract Validation -> Backtest -> Walk-Forward -> Human Approval
-> Paper Plan Activation -> Preflight -> Start`

Preflight checks the registered Binding, Profile fingerprint, local Paper
and Safety databases, and current public market bars. Missing, invalid, or
stale public data blocks Start.

Pause changes the running application to close-only. Safe Stop drains the
current cycle. Existing positions remain under Position Monitor. Neither
control bypasses Portfolio, Risk, Execution, or Runtime Safety.
