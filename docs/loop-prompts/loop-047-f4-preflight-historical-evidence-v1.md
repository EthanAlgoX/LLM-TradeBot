# LOOP-047 — F4 Preflight and historical evidence V1

```text
Loop ID: LOOP-047
Milestone: F4 Preflight / Backtest / Walk-Forward V1
Mode: IMPLEMENT_AND_AGENT_CHROME_VERIFY
Browser requirement: REQUIRED after implementation — Agent-operated real Chrome; no user manual verification
Safety: validation/evidence only / no Human Approval / no Approved Paper Plan / no Simulation Slot / no Runtime Apply / Paper Only / exchangeWriteAllowed=false
Git: commit and push main for every code or documentation change; no PR
```

LOOP-046 completed F3. A fresh Workbench recommendation can now create immutable Configuration Draft v1, and a valid modification appends v2 to the same Draft with exact `parentVersionId + parentFingerprint`; v1 remains immutable and readable. The same HttpOnly loopback actor, four-kind Published Catalog, Conversation Turns, Recommendation provenance, DAG and Draft lineage recover across reload and controlled Web/API restarts. Start F4 from these real F3 facts.

The goal of this loop is to make the Workbench plan card a real pre-launch validation surface. Reuse the repository's existing Configuration/Pipeline Draft validation, registered Historical Graph executor, Strategy Evidence binding, Backtest, Walk-Forward, Experiment Evidence and stale rules. Do not create a second validator, Backtest engine, Evidence repository, Artifact format, approval model or Runtime authority.

## 1. Authority and contracts

1. Trace the existing F3 Workbench Apply references into the authoritative Configuration Draft and Pipeline Draft. Bind F4 to the exact current `draftId`, `versionId`, version fingerprint, payload/graph fingerprint, Published Agent versions, Dataset snapshot, Model/Connection references, Prompt fingerprints and Execution Model scope. The browser must never submit implementation code, arbitrary URLs, evidence, actor identity or trusted fingerprints.
2. Add the smallest actor-scoped server projection/API needed for the Workbench to create, read and recover the current validation/evidence state. Reuse `StrategyEvidenceApprovalService`, `PipelineEvidenceWorkflow`, registered graph jobs and SQLite repositories. If an existing endpoint lacks actor isolation, close that boundary rather than adding a parallel Web-only store.
3. Keep records immutable and append-only. All write requests require a bounded opaque idempotency key; an exact replay returns the original result, while the same key with a different payload fails closed. IDs, cursor kinds/scopes and request bodies must be strictly parsed and bounded.

## 2. Preflight gate

1. Expose one real Preflight action for the current Strategy Draft. It must validate Agent version lifecycle/provenance, DAG and Artifact Schema compatibility, Dataset/Connection/Model reachability and capability, Prompt/tool permissions, observation windows, concurrency/token/cost budgets, and the locked `Portfolio -> Risk Gate -> Paper Execution` chain.
2. A failed Preflight returns stable issue codes, the affected node/reference when known, and a concise repair suggestion. It must remain visibly failed/blocked; never silently remove nodes, select substitutes, fabricate data, or downgrade the failure into a runnable state.
3. A passing Preflight records exact input fingerprints and only unlocks Backtest. Walk-Forward remains locked until Backtest succeeds. No validation action may create an approval, Paper plan, Deployment, Run, account, order, fill or exchange write.

## 3. Historical evidence sequence

1. Reuse the registered historical Dataset/Profile/Plan derived from the current Strategy configuration. Run Backtest and then Walk-Forward in strict order through the existing server-owned job path. Client-supplied evidence/artifact references, runner names, implementation parameters or output metrics must be rejected.
2. Project real job status, bounded summary metrics, time range, Dataset/version/fingerprint, graph/configuration fingerprints, Artifact/Evidence references and explicit lineage into the Workbench plan card. Label unavailable data honestly; do not render Sample/Mock results as real.
3. When both jobs pass and all fingerprints remain current, show `EVIDENCE READY` and `APPROVAL REQUIRED`. Do not execute Human Approval in this loop. The user will separately choose whether to approve/enrol the strategy in F5.
4. Prompt, Agent, Dataset, Connection/Model, Graph, Configuration or Execution Model drift must make old validation/evidence visibly `STALE`, disable onward actions and require a fresh F4 chain for the new version. In particular, evidence bound to v1 must not authorize v2.

## 4. Workbench experience

1. Extend the real server-backed recommendation/Draft card, not the old Prototype/Sample card. Show a compact ordered gate strip: `Draft -> Preflight -> Backtest -> Walk-Forward -> Approval required`, with current status, actionable failure details, evidence lineage and v1/v2 Diff context.
2. Buttons must be derived from server authority: only the next legal action is enabled. Loading, empty, failed, stale, unavailable and retry states must be distinct and survive reload plus controlled `npm run dev:paper` Web/API restart under the same HttpOnly actor.
3. Keep the four-page navigation and existing F3 conversation/DAG interaction intact. F4 must not add a fifth top-level page. Narrow screens may stack gate/evidence cards but must preserve the causal order and readable node/reference labels.

## 5. Automated verification

Add focused tests for at least:

- valid F3 Draft -> Preflight passed -> Backtest succeeded -> Walk-Forward succeeded -> `evidence_ready / approval_required`;
- stable issue code/node/suggestion for invalid graph, missing or incompatible Dataset/Model/Agent capability and broken locked safety chain;
- strict stage order, registered runner only, bounded payload/idempotency, exact replay and replay conflict;
- actor isolation, unknown/malformed IDs, cross-scope cursor or reference, unsupported mutation methods and client-forged actor/evidence/fingerprint rejection;
- v1 evidence becoming stale after same-Draft v2, while v1 evidence remains immutable/readable and cannot authorize v2;
- SQLite reload and full Web/API restart recovery without duplicate jobs or facts;
- `runtimeApplied=false`, no approval/plan/deployment/run/account/order/fill mutation and `exchangeWriteAllowed=false` throughout.

Run and report:

```text
npm run check
npm run test:ts
npm run build:web
git diff --check
```

`npm run test:ts` must print its natural final TAP summary and exit 0. Do not treat a partial list of passing subtests as a pass.

## 6. Agent-operated Chrome verification

After implementation, start or cleanly reuse the single `npm run dev:paper` chain and use real Chrome directly. Do not request user-assisted checking and do not substitute API/log inspection for required UI evidence.

1. Chinese, 1440x900: use a real F3 Draft and verify the ordered gates, exact Draft/version/fingerprints, successful Preflight, Backtest, Walk-Forward, real metrics/lineage and final `APPROVAL REQUIRED`. Confirm the action order is enforced and no simulation starts.
2. Create or select the same Draft's newer immutable version and verify the previous version's evidence becomes visibly stale and cannot advance the new version. Run the required fresh chain for the current version if the registered local fixture supports it.
3. Reload, then controlled-restart Web/API. Verify the same actor recovers Conversation, DAG, Draft lineage, gate statuses, jobs, Evidence references and stale boundary without duplicate jobs.
4. English, 820x760: verify `scrollWidth === clientWidth === 820`, no clipping/overlay, readable stacked gates/evidence and visible keyboard focus. Rapid conversation/version changes must not render stale asynchronous responses into the selected Draft.
5. Inspect Console and Network only when Chrome exposes those capabilities. Report `TOOL_UNAVAILABLE` precisely when unavailable. Never expose headers, cookies, tokens, request/response bodies, Secret references or Secret values. Isolate known Chrome extension `channel-closed` messages from TradeBot application errors.

## 7. Completion and handoff

Mark F4 `COMPLETE` only when the authority chain, stale semantics, recovery, automated gates and both Chrome sizes all pass. Otherwise keep F4 `IN_PROGRESS`, state the exact remaining blocker and create a uniquely named `LOOP-048` F4 continuation Prompt.

Update at minimum:

- `docs/product-optimization-plan-and-progress.md`;
- `docs/product-roadmap-and-progress.md`;
- `docs/project-status-and-handoff.md`;
- `docs/next-loop-prompt.md`.

Commit and push every code/document change to `main`; report commit SHA and push result. Do not create a PR. Do not modify, delete or commit `data/local-paper-workspace*` runtime data. Do not enter F5 or resume LOOP-025/M6 in this loop.
