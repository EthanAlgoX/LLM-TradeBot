# LOOP-061 — F4 runner terminal-contract continuation

F4 remains `IN_PROGRESS`.

LOOP-060 Agent Chrome evidence established the first failure point: the exact-version Walk-Forward control enters scoped `running` and removes its old action, but `StrategyWorkbenchHttpHandler → StrategyWorkbenchService.f4 → StrategyEvidenceApprovalService.runWalkForward → DurableGraphEvidenceJobService.run` awaits a CPU-active runner without an execution deadline. The POST therefore has no terminal response and the original page cannot merge or render terminal authority.

Implement the smallest durable fix. A Walk-Forward execution must have a server-declared finite deadline and persist one terminal outcome (`succeeded`, `failed`, or `timed_out`) that the exact immutable version can project. Do not create a second job, Evidence authority, Draft, or polling loop. A timeout/failure must be visible and retry-safe; a late result must not overwrite a durable terminal fact. Cover success, explicit failure, timeout/abort, idempotency, route/version isolation, hydration interleaving, and original-page action-to-terminal rendering.

Then use Agent Chrome only to create a fresh v1 through the normal Workbench lifecycle and verify original-page Preflight → Backtest → Walk-Forward → `EVIDENCE READY / APPROVAL REQUIRED`; only after that create same-Draft v2, verify v1 stale/read-only and independent v2 Evidence, then reload/restart and responsive/console checks. Do not use reload, API reads, historical cards, Approval, Runtime, Simulation, or trading actions as substitutes. Keep `runtimeApplied=false`, Paper Only, and `exchangeWriteAllowed=false`. Run `npm run check`, natural `npm run test:ts`, `npm run build:web`, and `git diff --check`; commit and push to `main` without a PR.
