# TradeBot Production Comparative Review Wiring Loop

## Mission

Wire the existing Comparative Trade Evidence and Human Lesson Review modules to TradeBot's real Paper Account and Reflection stores through a production composition. Keep all review behavior evidence-only and runtime-isolated.

Preserve the dirty workspace. Do not reset, clean, revert, or commit.

## Required behavior

1. Reuse `SQLitePaperAccountStore.load(accountId)` for closed Trade facts. Do not query or duplicate Paper Account tables.
2. Reuse `SQLiteReflectionStore.latest(accountId)` for Reflection facts.
3. A reviewable Lesson Candidate requires an explicit `sourceTradeIds` link from Reflection.
4. Market Pack, Data Source, Pipeline Graph, Schema, account ID, and store paths are server-owned composition options.
5. Convert Paper closed Trades into stable `TradeOutcomeEvidence` without changing PnL, fees, quantity, prices, or timestamps.
6. Preserve legacy gaps honestly. A missing Trade ID, trace, or Reflection link must fail closed or remain unavailable.
7. Expose authenticated endpoints for:
   - creating comparative Trade evidence;
   - inspecting a server-known Lesson Candidate by Trade ID;
   - accepting a candidate for validation or rejecting it.
8. Actor and role must continue to come from the existing Bearer authenticator.
9. Candidate inspection and review are read-only with respect to strategy and Runtime.
10. Do not create Approved Reflection Lessons, strategy mutations, orders, or exchange writes.

## Required tests

1. Real SQLite Paper Account closed Trades map without PnL/fee recomputation.
2. Server configuration supplies all Market/Data Source/Graph/Schema references.
3. Unknown and legacy-incomplete Trades fail closed.
4. Reflection without explicit `sourceTradeIds` is unavailable.
5. Explicit Reflection source Trade creates a stable candidate reference.
6. Candidate inspection requires Bearer authentication and rejects injected actor, role, SQL, code, path, URL, runner, and Runtime controls.
7. Review remains idempotent and runtime-not-applied.
8. Production composition closes all SQLite resources.
9. Existing trading and Runtime Safety tests remain green.

## Validation

Run:

```sh
npm run check
npm run test:ts
npm run build:web
git diff --check
```

Update roadmap and handoff documentation. State precisely whether the main orchestration server and Web UI are mounted or still unavailable.

