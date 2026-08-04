# LOOP-048 — F4 continuation: registered fixture and Chrome completion

```text
Loop ID: LOOP-048
Milestone: F4 Preflight / Backtest / Walk-Forward V1 continuation
Mode: IMPLEMENT_AND_AGENT_CHROME_VERIFY
Safety: validation/evidence only; no Human Approval, Paper Plan, Runtime Apply, Simulation Slot, account/order/fill or exchange write
Git: commit and push main for every code/document change; no PR
```

LOOP-047 introduced an actor-scoped Workbench F4 projection over the existing Configuration/Pipeline validators and `StrategyEvidenceApprovalService`. Continue only from those authorities; do not create a validator, runner, evidence store, artifact format, approval model, or runtime authority.

Complete the registered historical fixture end-to-end path for a real F3 Draft: `Preflight passed → Backtest succeeded → Walk-Forward succeeded → EVIDENCE READY / APPROVAL REQUIRED`. Verify v1/v2 stale separation, immutable readable prior evidence, idempotency replay/conflict, actor isolation, malformed IDs and restart recovery. Then use Agent-operated real Chrome only: Chinese 1440×900 and English 820×760, reload and controlled `npm run dev:paper` restart. Confirm no simulation/runtime/approval side effect; report Chrome Network capability as `TOOL_UNAVAILABLE` if inaccessible. Run and report `npm run check`, `npm run test:ts`, `npm run build:web`, and `git diff --check` (natural TAP final summary, exit 0). Update the progress, roadmap, handoff and next-loop documents, commit and push `main` without touching `data/local-paper-workspace*`.
