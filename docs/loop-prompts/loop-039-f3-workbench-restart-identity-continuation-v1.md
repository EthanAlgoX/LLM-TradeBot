# LOOP-039 — F3 Workbench restart identity continuation V1

```text
Loop ID: LOOP-039
Milestone: F3 Workbench V2 restart identity continuation
Mode: IMPLEMENT_AND_AGENT_CHROME_VERIFY
Safety: Strategy Draft only / no Preflight / no Backtest / no Runtime Apply / Paper Only / exchangeWriteAllowed=false
Git: commit and push main; no PR
```

LOOP-038 added exact deterministic Recommendation provenance, actor/scope-bound cursor APIs, and restart/actor-isolation/negative authority tests. `npm run check`, `npm run test:ts` (natural TAP summary), `npm run build:web`, and `git diff --check` passed. Chrome created Analysis, Decision and Reflection test Agents only through normal Agent Center lifecycle; Input already existed.

F3 remains incomplete. In real Chrome the local Web/API restart issued a new local Bearer actor, so actor-scoped conversation and catalog recovery correctly showed no prior history. Establish a safe development identity handoff that permits the same authorized local actor to recover its server facts across a Web/API restart without storing or exposing the token in Web storage, the production bundle, logs, or docs. Reuse the existing local Paper/operator identity mechanism; do not create a parallel identity, conversation, Agent Catalog, Strategy Draft authority, graph validator, or registry.

Then complete the entire LOOP-035 Chrome script: Chinese clarification -> catalog-backed Recommendation -> Apply -> modification, reload and same-actor Web/API restart recovery; English 820x760 responsive layout, visible keyboard focus and no horizontal overflow; fresh Console error evidence and Network method/path/status when capability permits. Preserve prior user/workspace facts. Add only normal Agent Center lifecycle test Agents if necessary.

Run `npm run check`, `npm run test:ts` to its natural summary, `npm run build:web`, and `git diff --check`. Mark F3 COMPLETE only if all chains pass; otherwise create LOOP-040. No Preflight, Backtest, deployment, Account, Order, Fill, Position, Shadow, Runtime Apply, or exchange write is authorized.
