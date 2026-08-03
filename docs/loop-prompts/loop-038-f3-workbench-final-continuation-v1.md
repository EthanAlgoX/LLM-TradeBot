# LOOP-038 — F3 Workbench final continuation V1

```text
Loop ID: LOOP-038
Milestone: F3 Workbench V2 final continuation
Mode: IMPLEMENT_AND_AGENT_CHROME_VERIFY
Safety: Strategy Draft only / no Preflight / no Backtest / no Runtime Apply / Paper Only / exchangeWriteAllowed=false
Git: commit and push main; no PR
```

LOOP-037 compiled Apply through the existing Pipeline Draft validator and Configuration Draft authority, added command replay conflict checks, and verified in real Chrome: Chinese clarification, four Agent Center lifecycle-published test Agents, validated recommendation, locked safety chain, Apply to a Configuration Draft, and console error 0. F3 remains incomplete.

Read PRODUCT.md, the three progress/handoff documents, LOOP-035 through LOOP-037, and all changed F3 sources. Preserve user changes. Do not reset, checkout, clean, create a parallel Conversation, Agent Catalog, Strategy Draft authority, graph validator, or data/model registry.

Complete exact Recommendation-to-graph provenance, actor-scoped cursor APIs, restart/actor-isolation/concurrency/negative tests, and the entire LOOP-035 Chrome script: Chinese modification then reload and Web/API restart recovery; English 820×760 responsive/focus/no overflow; console/network evidence. Run `npm run check`, `npm run test:ts` to its natural summary, `npm run build:web`, and `git diff --check`. Mark F3 COMPLETE only when every chain passes; otherwise create LOOP-039.

No Preflight, Backtest, deployment, Account, Order, Fill, Position, Shadow, Runtime Apply, or exchange write is authorized.
