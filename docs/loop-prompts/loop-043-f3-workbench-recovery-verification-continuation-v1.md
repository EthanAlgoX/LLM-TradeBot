# LOOP-043 — F3 Workbench recovery verification continuation V1

```text
Loop ID: LOOP-043
Milestone: F3 Workbench restart recovery verification closure
Mode: IMPLEMENT_AND_AGENT_CHROME_VERIFY
Safety: Strategy Draft only / no Preflight / no Backtest / no Runtime Apply / Paper Only / exchangeWriteAllowed=false
Git: commit and push main; no PR
```

LOOP-042 repaired restart hydration without changing the local Paper/operator credential, workspace, or authority. Historical Recommendations that predate mandatory provenance now render as `PROVENANCE_UNAVAILABLE` and cannot be applied; the Published Catalog retains the newest immutable Published version. Real Chrome verified same-actor Workbench/Draft and four-category catalog recovery after `dev:paper` restart.

F3 remains `IN_PROGRESS`: obtain a clean natural final TAP summary for `npm run test:ts`, then rerun the full real-Chrome sequence, including fresh TradeBot Console and Network evidence where supported. Do not inspect or expose HttpOnly credentials, and do not create alternate identity, authority, catalog, validator, registry, conversation store, or workspace.

Run `npm run check`, `npm run test:ts`, `npm run build:web`, and `git diff --check`. Mark F3 COMPLETE only if every chain passes. No Preflight, Backtest, Runtime Apply, Account, Order, Fill, Position, Shadow, deployment, or exchange write.
