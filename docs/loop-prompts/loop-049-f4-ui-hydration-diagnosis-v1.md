# LOOP-049 — F4 UI hydration diagnosis and fixture completion

```text
Loop ID: LOOP-049
Milestone: F4 Preflight / Backtest / Walk-Forward V1 completion
Mode: DIAGNOSE_THEN_IMPLEMENT_AND_AGENT_CHROME_VERIFY
Safety: validation/evidence only; no Human Approval, Paper Plan, Runtime Apply, Simulation Slot, account/order/fill or exchange write
Git: commit and push main for every code/document change; no PR
```

LOOP-048 proved a new real F3 Draft resolves directly to `preflight: pending` and `nextAction: preflight` through the registered CSV historical fixture, but real Chrome still shows F4 loading for the mixed legacy history. Diagnose the UI hydration from server response to visible card; preserve legacy readable Drafts and isolate their errors. Then complete the real Draft path: `Preflight passed → Backtest succeeded → Walk-Forward succeeded → EVIDENCE READY / APPROVAL REQUIRED` without invoking Approval. Verify v1/v2 stale separation, prior evidence readability, idempotency replay/conflict, actor isolation, malformed IDs and restart recovery. Use Agent-operated real Chrome only in Chinese 1440×900 and English 820×760, reload and controlled `npm run dev:paper` restart. Report Network as `TOOL_UNAVAILABLE` if inaccessible. Run check, test:ts natural TAP exit 0, build:web and diff-check; update documents, commit and push main without touching `data/local-paper-workspace*`.
