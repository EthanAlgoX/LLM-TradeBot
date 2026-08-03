# LOOP-045 — F3 final Chrome lifecycle continuation V1

```text
Loop ID: LOOP-045
Milestone: F3 Workbench V2 final Chrome closeout
Mode: AGENT_CHROME_VERIFY_ONLY
Browser requirement: REQUIRED — Agent-operated real Chrome
Safety: Strategy Draft only / no Preflight / no Backtest / no Runtime Apply / Paper Only / exchangeWriteAllowed=false
Git: commit and push main for every change; no PR
```

LOOP-044 fixed two verified defects: Agent Center category changes now hydrate their own existing actor/category Catalog, and tests close every runtime they create. `npm run test:ts` now naturally prints `1..376`, 376/376 PASS, exit 0. Real Chrome verified all four Published Catalog kinds after a controlled Web/API restart, Chinese clarification-only behavior, Published provenance/DAG, the locked Portfolio → Risk Gate → Paper Execution chain, and legacy `PROVENANCE_UNAVAILABLE` read-only history.

F3 remains `IN_PROGRESS`. Do not reseed, alter, inspect secrets from, or delete `data/local-paper-workspace*`; do not add fallback Catalog/identity/Conversation/Draft authority. Use the existing `npm run dev:paper` chain and the same HttpOnly local actor.

Complete with Agent-operated real Chrome:

1. In Chinese 1440×900, create a fresh complete request, verify exact Published provenance and a branching/converging DAG, Apply it, then submit a valid modification. Verify a new immutable Draft version has the exact parent/reference and the earlier version remains readable unchanged.
2. Reload Chrome then controlled-restart Web/API. Verify the same actor recovers all four Catalog kinds, Turns, provenance, DAG, both Draft references, and the version relationship. Reconfirm legacy no-provenance history is visible/read-only/non-applicable.
3. In English 820×760, verify `scrollWidth === clientWidth === 820`, no clipping/overlay, visible keyboard focus, and rapid kind/conversation switches cannot display stale data.
4. Inspect Console errors and Network only where Chrome exposes those capabilities; report `TOOL_UNAVAILABLE` precisely if unavailable. Never expose headers, cookies, tokens, request bodies, or secrets.
5. Run and report `npm run check`, `npm run test:ts`, `npm run build:web`, and `git diff --check`.

Mark F3 `COMPLETE` only if every item passes. Otherwise keep it `IN_PROGRESS`, update progress/handoff truthfully, and create LOOP-046 F3 continuation. In either case commit and push `main`; do not create a PR.
