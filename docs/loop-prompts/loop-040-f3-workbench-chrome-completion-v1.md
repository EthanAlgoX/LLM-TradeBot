# LOOP-040 — F3 Workbench Chrome completion V1

```text
Loop ID: LOOP-040
Milestone: F3 Workbench Chrome completion after local identity handoff
Mode: IMPLEMENT_AND_AGENT_CHROME_VERIFY
Safety: Strategy Draft only / no Preflight / no Backtest / no Runtime Apply / Paper Only / exchangeWriteAllowed=false
Git: commit and push main; no PR
```

LOOP-039 established a persistent local Paper/operator credential and an HttpOnly loopback cookie handoff. The same browser cookie recovered `local:operator` with HTTP 200 after a Web/API restart; no token is injected into Vite by the local workspace launchers. `npm run check`, `npm run test:ts`, `npm run build:web`, and `git diff --check` passed.

F3 remains incomplete because the full Chrome workflow was not run: use only normal Agent Center lifecycle to ensure a Published Input, Analysis, Decision, and Reflection catalog, then run Chinese clarification -> catalog-backed Recommendation -> Apply -> modification. Reload and restart Web/API and verify the same actor recovers all server facts. Also verify the English 820x760 responsive layout, visible keyboard focus, no horizontal overflow, fresh Console errors, and Network method/path/status where available. Preserve existing workspace facts. Do not create any parallel identity, authority, catalog, validator, registry, or conversation store.

Do not run Preflight, Backtest, Runtime Apply, Account, Order, Fill, Position, Shadow, deployment, or exchange write. Mark F3 COMPLETE only if every chain passes; otherwise create LOOP-041.
