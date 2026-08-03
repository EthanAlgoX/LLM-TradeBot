# LOOP-046 — F3 Draft revision lineage continuation V1

```text
Loop ID: LOOP-046
Milestone: F3 Workbench V2 Draft revision lineage closeout
Mode: IMPLEMENT_AND_AGENT_CHROME_VERIFY
Browser requirement: REQUIRED — Agent-operated real Chrome
Safety: Strategy Draft only / no Preflight / no Backtest / no Runtime Apply / Paper Only / exchangeWriteAllowed=false
Git: commit and push main for every change; no PR
```

LOOP-045 verified in real Chrome that the same HttpOnly local actor survives reload and a controlled `npm run dev:paper` Web/API restart, recovers Input/Analysis/Decision/Reflection Published Catalog, Turns, legacy `PROVENANCE_UNAVAILABLE` read-only history, and Draft references. Chinese 1440×900 Published provenance, a branching/converging DAG, and the locked Portfolio → Risk Gate → Paper Execution chain passed. English 820×760 had `scrollWidth === clientWidth === 820` and visible keyboard focus; Network capability was `TOOL_UNAVAILABLE`.

F3 remains `IN_PROGRESS` because the exact Draft revision contract failed: applying a complete valid request created `configuration-draft:e581fa67ace0e7ce1f3a2d89:version:1`; applying its complete valid 5% maximum-position modification created a distinct `configuration-draft:afbaa56ae78a13948b9a263c:version:1`, not `e581...:version:2` with an exact parent/reference. Do not reseed, alter, inspect secrets from, or delete `data/local-paper-workspace*`; do not add fallback Catalog/identity/Conversation/Draft authority. Use the existing `npm run dev:paper` chain and the same HttpOnly local actor.

1. Diagnose the existing Conversation → Apply → Configuration Draft authority path. Repair only the demonstrated missing lineage/revision link; preserve append-only immutable versions and all existing actor/scope/replay protections. Add narrow automated regression coverage for valid initial apply, valid modification, exact same-Draft version 2 parent/reference, earlier-version immutability/readability, reload, and restart recovery.
2. In Chinese 1440×900 using Agent-operated real Chrome, create one fresh complete request and Apply it. Submit one complete valid modification, Apply it if required by the existing UI contract, and verify the same Draft gains `version:2`, exact parent/reference, and unchanged readable version 1. Reconfirm exact Published provenance, branching/converging DAG, and locked Paper-only chain.
3. Reload Chrome, then controlled-restart Web/API using `npm run dev:paper`. Verify the same actor recovers all four Catalog kinds, Turns, provenance, DAG, both Draft versions/references and their parent relationship. Reconfirm legacy `PROVENANCE_UNAVAILABLE` remains visible, read-only and non-applicable.
4. In English 820×760 reconfirm `scrollWidth === clientWidth === 820`, no clipping/overlay, visible keyboard focus, and rapid kind/conversation switches cannot show stale data. Inspect Console errors and Network only where Chrome exposes capabilities; report `TOOL_UNAVAILABLE` precisely if unavailable. Never expose headers, cookies, tokens, request bodies, or secrets.
5. Run and report `npm run check`, `npm run test:ts`, `npm run build:web`, and `git diff --check`.

Mark F3 `COMPLETE` only if every item passes. Otherwise keep it `IN_PROGRESS`, update progress/handoff truthfully, and create LOOP-047 F3 continuation. In either case commit and push `main`; do not create a PR.
