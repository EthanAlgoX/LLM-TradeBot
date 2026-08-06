# LOOP-057 — F4 Action Response DOM Continuation

```text
Loop ID：LOOP-057
Milestone：F4 pre-launch verification
Mode：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
Browser：Required; Agent-operated real Chrome only
Safety：Evidence only. No Approval, Approved Paper Plan, Simulation, Runtime Apply, deployment, account/order/fill, or exchange write.
Git：Commit and push main; no PR.
```

LOOP-056 reproduced the remaining defect in real Chrome: Preflight updates its v1 card in place, but Backtest and Walk-Forward can persist evidence while the visible card remains at the preceding gate. A three-read, same-version reconciliation now has terminal/failure/timeout semantics, but did not close the Chrome defect.

First prove the exact event lifecycle: handler invocation count, immutable version/action attributes, POST result, exact GET result, state merge, render, rebound button, and any late hydration/render. Do not use reload as a fix. Repair only the smallest authority/render coordination defect; preserve immutable-version ownership and stale-response isolation. Add focused tests for the proven root cause, then rerun the complete LOOP-056 Chrome matrix: fresh v1 in-place Preflight → Backtest → Walk-Forward, same-Draft 5% v2, stale v1/read-only lineage, fresh v2/no inherited Evidence, reload and controlled restart recovery, Chinese 1440×900, English 820×760, Console, Network if available, and safety flags. F4 remains `IN_PROGRESS` unless every required item passes.
