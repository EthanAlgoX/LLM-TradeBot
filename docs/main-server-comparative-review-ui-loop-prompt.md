# TradeBot Main Server Comparative Review Mount and Causal Review UI Loop

## Objective

Mount the existing production comparative trade review composition in the main
loopback orchestration server and expose it through the existing Causal Review
experience. Do not create a second comparison, evidence, reflection, lesson,
approval, or runtime model.

## Required backend work

1. Reuse `ProductionComparativeTradeReviewComposition`.
2. Mount these Bearer-authenticated routes in the main HTTP dispatcher:
   - `POST /api/orchestration/trade-reviews/comparisons`
   - `POST /api/orchestration/lesson-candidates/inspect`
   - `POST /api/orchestration/lesson-candidates/reviews`
3. Derive actor, approver role, account, database paths, Market Pack, Data
   Source, Pipeline Graph, and Schema references on the server.
4. Close all comparative review SQLite resources during runtime shutdown.
5. Preserve strict request contracts and reject client actor, runner, code,
   SQL, URL, path, Runtime, execution, Risk bypass, and exchange-write
   injection.
6. Keep every response `runtimeApplied=false` and
   `exchangeWriteAllowed=false`.

## Required Web work

1. Extend the existing Causal Review instead of adding a new page.
2. Only allow comparison for an explicitly selected closed trade.
3. Show the server-selected most recent prior same-scope baseline.
4. Show raw realized PnL, fees, holding duration, and deltas.
5. State clearly that the comparison is descriptive evidence, not a causal
   claim.
6. Show candidate unavailable, candidate, rejected, and
   accepted-for-validation states.
7. Allow only `accept_for_validation` and `reject`, with rationale.
8. Never expose Start, Pause, Apply, order, execution, Risk bypass, or exchange
   controls.
9. Keep Chinese and English complete and readable at desktop and compact
   widths.

## Required tests

1. Main server Bearer authentication and server-derived approver identity.
2. Strict injection rejection on mounted routes.
3. Real Paper Account comparison and real Reflection candidate inspection.
4. Idempotent accept/reject review behavior.
5. Web states for loading, comparison, insufficient evidence, candidate,
   reviewed, and unavailable.
6. Existing trading and runtime safety tests remain green.

## Validation

Run:

- `npm run check`
- `npm run test:ts`
- `npm run build:web`
- `git diff --check`

Start `npm run dev:paper` and inspect:

- 1440x900 Chinese
- 1440x900 English
- 820x760 Chinese
- 820x760 English
- closed-trade comparison or honest unavailable state
- Draft/Runtime and Lesson/Runtime isolation
- no horizontal overflow, clipping, unreadable text, console errors, or
  warnings

## Non-goals

- No DecisionPipeline rewrite.
- No Selector, Position Monitor, Risk, Execution, Paper Account, or Runtime
  Safety behavior changes.
- No Approved Lesson creation.
- No strategy mutation.
- No Runtime apply.
- No exchange write interface.

