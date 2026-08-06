# LOOP-056 — F4 action-response DOM continuation

```text
Loop ID: LOOP-056
Milestone: F4 final closeout continuation
Mode: DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
Browser requirement: REQUIRED; Agent-operated real Chrome only
Safety: validation/evidence only; no Approval, Runtime Apply, Simulation, account/order/fill or exchange write
Git: commit and push main; no PR
```

LOOP-055 proved that a fresh v1 Preflight advances immediately and that Backtest POST persists the immutable binding and returns `succeeded → walk-forward`; one bounded GET of that exact version is also authoritative. Yet the same real Chrome card remains at the pre-action gate until reload. Diagnose only the client DOM/action listener/render ordering responsible for that divergence. Preserve the existing single authority, exact-version merge, epoch isolation and bounded reread. Add focused integration coverage that fails if a successful action response/read is not rendered. Then repeat fresh v1 Preflight → Backtest → Walk-Forward immediate gates, v1→5% same-Draft immutable v2, stale/readable isolation, reload, controlled restart, Chinese 1440×900, English 820×760 and Console/safety. If any item fails, retain F4 `IN_PROGRESS`; do not enter F5.
