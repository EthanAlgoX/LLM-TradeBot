# LOOP-052 — F4 remaining evidence closeout

```text
Loop ID: LOOP-052
Milestone: F4 Preflight / Backtest / Walk-Forward V1 remaining closeout
Mode: DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
Safety: validation/evidence only; stop at APPROVAL REQUIRED; no Approval, Paper Plan, Runtime, Simulation or trade writes
Git: commit and push main for every code/document change; no PR
```

LOOP-051 established in Agent-operated Chrome that a current immutable Workbench v1 can complete `Preflight → Backtest → Walk-Forward → approval_required` using the existing registered CSV Graph Evidence authority. The previous Backtest locked symptom was an old controlled server process that had loaded pre-build code.

Complete only the remaining F4 requirements: focused authority/UI/reload regression coverage; readable version/fingerprint/dataset/profile/binding/job/artifact lineage; normal-Workbench immutable v1→v2 stale/recovery proof; Chinese 1440×900 and English 820×760 accessibility/layout; cleared Console and Network capability report; and natural complete `npm run test:ts` TAP, `npm run check`, `npm run build:web`, `git diff --check`.

Keep F4 `IN_PROGRESS` unless every requirement passes. Do not introduce a second authority or invoke Approval or later lifecycle actions.
