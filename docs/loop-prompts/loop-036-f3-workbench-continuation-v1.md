# LOOP-036 — F3 Workbench Structured DAG continuation V1

```text
Loop ID: LOOP-036
Milestone: F3 Workbench V2 continuation
Mode: IMPLEMENT_AND_AGENT_CHROME_VERIFY
Safety: Strategy Draft only / no Preflight / no Backtest / no Runtime Apply / Paper Only / exchangeWriteAllowed=false
Git: commit and push main; no PR
```

LOOP-035 introduced strict F3 command/intent/recommendation/draft contracts, immutable SQLite records, a deterministic structured server adapter, Published Catalog-only selection, locked Portfolio/Risk/Paper nodes, and a REAL SERVER web surface explicitly separate from legacy Sample. It remains incomplete.

Read `PRODUCT.md`, all three progress/handoff documents, LOOP-035, and the changed F3 sources. Preserve user changes. Do not reset, checkout, clean, create a parallel Conversation, Agent Catalog, Strategy Draft authority, graph validator, or data/model registry.

Complete: integrate F3 turns with existing append-only Conversation Replay and cursor/restart recovery; reuse the existing graph validator for full topology/schema/capability/budget validation; bind Apply to existing Configuration/Pipeline Draft authority; add all required negative/idempotency/restart tests; and conduct the full LOOP-035 Chrome script in real Chrome. Materialize any test agents only by normal Agent Center lifecycle. Never invent agents or call Runtime.

Run check, test:ts to its natural final summary, build:web, diff-check. Mark F3 complete only when the full chain passes; otherwise create a new unique continuation. No Preflight, Backtest, deployment, Account, Order, Fill, Position, Shadow, Runtime Apply, or exchange write is authorized.
