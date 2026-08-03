# LOOP-041 — F3 Workbench restart recovery continuation V1

```text
Loop ID: LOOP-041
Milestone: F3 Workbench restart recovery closure
Mode: IMPLEMENT_AND_AGENT_CHROME_VERIFY
Safety: Strategy Draft only / no Preflight / no Backtest / no Runtime Apply / Paper Only / exchangeWriteAllowed=false
Git: commit and push main; no PR
```

LOOP-040 verified in real Chrome that normal Agent Center lifecycle can create, validate, and publish Analysis, Decision, and Reflection Agents; an Input Agent was already Published. It then completed Chinese clarification, a catalog-backed `VALIDATED_RECOMMENDATION`, Apply to a Configuration Draft, and a subsequent Chinese modification. The rendered recommendation retained `runtimeApplied=false`, `Paper Only`, `exchangeWriteAllowed=false`, and locked Portfolio, Risk Gate, and `Paper Execution · NOT_APPLIED` nodes. No prohibited runtime or trading action was invoked.

F3 remains incomplete. After reloading and restarting the current project's `npm run dev:paper` Web/API chain, Chrome recovered a catalog containing only the pre-existing Input Agent and showed an empty Workbench conversation. The same browser therefore did not recover the Analysis/Decision/Reflection catalog entries, conversation replay, or Configuration Draft created before restart. Console errors were zero. Treat this as a same-actor recovery failure until the actual persisted local-Paper identity and orchestration-workspace path are proved continuous; do not inspect or expose the HttpOnly cookie/token and do not add an alternate identity, authority, catalog, validator, registry, or conversation store.

Read `PRODUCT.md`, the three progress/handoff documents, LOOP-035 through LOOP-040, and all changed F3/local-Paper startup sources. Preserve all workspace facts and dirty changes. Diagnose and minimally repair only the existing local Paper/operator identity handoff or its current workspace persistence integration, with restart recovery tests. Then run the complete Chrome sequence from a clean, observable state: Published Input/Analysis/Decision/Reflection catalog through normal Agent Center lifecycle only; Chinese clarification -> catalog-backed Recommendation -> Apply -> modification; reload; Web/API restart; same actor recovers all server facts. Verify English at 820x760, visible keyboard focus, no horizontal overflow, fresh Console errors, and Network method/path/status where capability permits.

Run `npm run check`, `npm run test:ts` to its natural TAP summary, `npm run build:web`, and `git diff --check`. Mark F3 COMPLETE only when every chain passes; otherwise create LOOP-042. Do not run Preflight, Backtest, Runtime Apply, Account, Order, Fill, Position, Shadow, deployment, or exchange write.
