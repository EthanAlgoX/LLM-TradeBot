# LOOP-051 — F4 Backtest runner closeout

```text
Loop ID: LOOP-051
Milestone: F4 Preflight / Backtest / Walk-Forward V1 continuation
Mode: FIX_REMAINING_UI_BACKTEST_GATE_AND_COMPLETE_AGENT_CHROME_VERIFY
Browser requirement: REQUIRED; Agent-operated real Chrome only
Safety: validation/evidence only; stop at APPROVAL REQUIRED; no Approval, Runtime, Simulation Slot or exchange write
Git: commit and push main; no PR
```

LOOP-050 confirmed in real Chrome that a new Workbench Draft hydrates an F4 gate and Preflight passes, but its Backtest action remains locked after the click. Diagnose the existing registered CSV Historical runner integration using UI evidence first; API/logs only diagnose failures. Reuse only Configuration/Pipeline validation, registered CSV graph/runner, `StrategyEvidenceApprovalService`, existing artifacts and stale authority. Do not create a second authority or inspect/change `data/local-paper-workspace*`.

Complete the UI chain `Preflight → Backtest → Walk-Forward → EVIDENCE READY / APPROVAL REQUIRED`, then verify immutable v1/v2 stale separation, reload/restart recovery, legacy error isolation, fail-closed/idempotency, Chinese 1440×900, English 820×760, Console/Network and runtime safety. Run `npm run check`, `npm run test:ts`, `npm run build:web`, `git diff --check`; mark F4 COMPLETE only if every required item passes. Otherwise keep F4 IN_PROGRESS and create the next unique F4-only continuation. Commit and push main, no PR.
