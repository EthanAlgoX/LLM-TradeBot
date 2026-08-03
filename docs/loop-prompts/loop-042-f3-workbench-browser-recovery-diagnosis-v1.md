# LOOP-042 — F3 Workbench browser recovery diagnosis V1

```text
Loop ID: LOOP-042
Milestone: F3 Workbench restart recovery closure
Mode: IMPLEMENT_AND_AGENT_CHROME_VERIFY
Safety: Strategy Draft only / no Preflight / no Backtest / no Runtime Apply / Paper Only / exchangeWriteAllowed=false
Git: commit and push main; no PR
```

LOOP-041 reproduced the F3 same-actor recovery failure in real Chrome. The local Paper SQLite workspace still contains the `local:operator` Agent and Workbench facts, but after a Chrome reload or a Web/API restart the rendered Agent Center falls back to its sole pre-existing Input Agent and Workbench is empty. A minimal v2 name migration for the existing HttpOnly loopback cookie and a stale-v1-cookie regression test were added, but Chrome recovery still failed after a clean `npm run dev:paper` restart. Console errors were zero; browser Network capability was unavailable. Do not inspect, expose, copy, log, or persist the HttpOnly cookie/token.

Read `PRODUCT.md`, the three progress/handoff documents, LOOP-035 through LOOP-041, and every changed F3/local-Paper startup source. Preserve all workspace facts and dirty changes. Diagnose from the existing browser-to-loopback request path and the existing local Paper/operator identity handoff only. Prove, without reading the credential, that the restarted Web/API receives the same authorized `local:operator` and opens the existing `data/local-paper-workspace/orchestration.sqlite` facts. Do not introduce an alternate identity, cookie/token transport, authority, catalog, validator, registry, conversation store, or database/workspace.

Repair only the demonstrated break in the existing handoff or hydration path. Add a narrow automated regression that covers the exact restart/browser-equivalent failure, without printing secrets. Then run from a clean observable state: Published Input/Analysis/Decision/Reflection catalog only through normal Agent Center lifecycle; Chinese clarification -> catalog-backed Recommendation -> Apply -> modification; reload; Web/API restart; same actor recovers all catalog and conversation/Draft facts. Verify English at 820x760, visible keyboard focus, no horizontal overflow, fresh Console errors, and Network method/path/status where capability permits.

Run `npm run check`, `npm run test:ts` to its natural TAP summary, `npm run build:web`, and `git diff --check`. Mark F3 COMPLETE only if every chain passes; otherwise create LOOP-043. Do not run Preflight, Backtest, Runtime Apply, Account, Order, Fill, Position, Shadow, deployment, or exchange write.
