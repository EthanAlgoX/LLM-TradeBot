# LOOP-037 — F3 Workbench authority continuation V1

```text
Loop ID: LOOP-037
Milestone: F3 Workbench V2 continuation
Mode: IMPLEMENT_AND_AGENT_CHROME_VERIFY
Safety: Strategy Draft only / no Preflight / no Backtest / no Runtime Apply / Paper Only / exchangeWriteAllowed=false
Git: commit and push main; no PR
```

LOOP-036 partially integrated Workbench turns with append-only Conversation Replay and added server history hydration. It also verified the clarification-only flow in real Chrome and materialized one Input Agent through the normal Agent Center lifecycle. F3 remains incomplete.

Read `PRODUCT.md`, the three progress/handoff documents, LOOP-035 through LOOP-036, and all changed F3 sources. Preserve user changes. Do not reset, checkout, clean, create a parallel Conversation, Agent Catalog, Strategy Draft authority, graph validator, or data/model registry.

Complete the remaining authority integration: use the existing Configuration/Pipeline Draft authority for Apply; compile Recommendations into the existing graph validator so topology, ports/schema, capability, catalog fingerprint and budgets are validated before persistence and Apply; add durable idempotency/conflict semantics and all required negative, actor-isolation, cursor and restart tests. Do not claim completion from the current thin Workbench tables alone.

Materialize Analysis, Decision and Reflection test Agents only via normal Agent Center lifecycle, then complete the full LOOP-035 Chrome script in real Chrome: Chinese 1440×900 clarification → recommendation → Apply → modification → reload/restart; English 820×760 responsive validation. Run `npm run check`, `npm run test:ts` to its natural final summary, `npm run build:web`, and `git diff --check`. Mark F3 COMPLETE only if the entire chain passes; otherwise create LOOP-038.

No Preflight, Backtest, deployment, Account, Order, Fill, Position, Shadow, Runtime Apply, or exchange write is authorized.
