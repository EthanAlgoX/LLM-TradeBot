# LOOP-044 — F3 Published Catalog recovery and test closeout V1

```text
Loop ID: LOOP-044
Milestone: F3 Workbench V2 final recovery and verification closeout
Mode: DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
Browser requirement: REQUIRED — the Agent must directly operate real Chrome; no user manual verification
Safety: Strategy Draft only / no Preflight / no Backtest / no Runtime Apply / Paper Only / exchangeWriteAllowed=false
Git: commit and push main for every code or documentation change; no PR
```

## 1. Current authoritative state

F3 remains `IN_PROGRESS`.

LOOP-043 proved that the same local operator can recover the Workbench and Draft after reload/restart, and that legacy Recommendations without provenance render read-only as `PROVENANCE_UNAVAILABLE`. It also repaired missing `runtime.close()` calls in `tests-ts/orchestration-copilot.test.ts`; the focused file now exits naturally with a final TAP summary of 21/21.

Two blockers remain:

1. the full `npm run test:ts` run reports 243 passing subtests but does not naturally emit its final TAP summary and exit;
2. after a controlled `dev:paper` restart, real Chrome shows only the published Input Agent, while Analysis, Decision, and Reflection show `No real Agents yet`.

Do not rely on the older LOOP-042 statement that all four catalog kinds recovered. Reproduce and resolve the latest observed state.

## 2. Non-negotiable boundaries

- Preserve the current repository, local Paper workspace, HttpOnly loopback identity, actor isolation, immutable Agent Version authority, Conversation Replay, Pipeline Draft, and Configuration Draft models.
- Do not delete, reset, replace, migrate away, or silently reseed `data/local-paper-workspace*` to make recovery pass.
- Do not inspect, print, copy, expose, or move Cookie/token/Secret values.
- Do not add browser-memory, Sample, fixture, latest-version, cross-actor, or cross-kind fallback to make missing Catalog entries appear.
- Only `Published` Agent Versions may appear in the Workbench Catalog. Archived, Draft, Validated-only, or stale versions must not be substituted.
- Do not add a parallel Agent Catalog, Conversation store, Draft authority, graph validator, or identity mechanism.
- Do not use `--forceExit`, unconditional `process.exit()`, arbitrary timeout completion, or killing unrelated processes to claim that the test suite exits cleanly.
- Do not execute or implement Preflight, Backtest, Walk-Forward, Runtime Apply, Paper Deployment, Shadow mutation, Live, Account/Order/Fill/Position mutation, or exchange writes.
- Keep `runtimeApplied=false`, Paper Only, and `exchangeWriteAllowed=false` throughout.

## 3. Phase A — establish a controlled baseline

1. Read the current F3 contracts, repositories, API composition, local Paper startup/identity code, Agent Center Catalog hydration, Workbench hydration, and the tests involved before editing.
2. Inspect the Git worktree and preserve all unrelated user changes. Never reset or clean the repository.
3. Resolve exact project-owned listeners/processes before restarting. Run only one controlled `npm run dev:paper` chain on Web `127.0.0.1:5174` and API `127.0.0.1:8787`; do not terminate unrelated processes.
4. Preserve the same local workspace path and same HttpOnly loopback actor across the controlled restart.

## 4. Phase B — make the full test suite exit naturally

1. Reproduce `npm run test:ts` without treating the 243 passing subtests as a final success when the parent process remains alive.
2. Identify the exact remaining owned handle and the test/service/repository that created it. Use deterministic isolation or bisecting if needed; do not guess from elapsed time alone.
3. Fix resource ownership at the narrowest correct lifecycle boundary. Close runtimes, HTTP servers, timers, workers, database handles, watchers, and subscriptions only where their owner has finished using them.
4. Add or strengthen a regression test when the leak is not already covered.
5. Acceptance requires the unmodified command `npm run test:ts` to emit its natural final TAP summary and exit code 0. A timeout wrapper, manual signal, or forced exit is a failure.

## 5. Phase C — diagnose four-kind Published Catalog restart recovery

Use the normal Agent Center lifecycle to ensure one real Published Agent Version exists for each kind: Input, Analysis, Decision, and Reflection. Do not insert rows directly and do not use Sample cards as evidence.

For the exact same actor and workspace, determine the first failing boundary:

1. Before restart, verify the authoritative repository/API Catalog contains all four kinds with stable definition ID, version ID, fingerprint, lifecycle state, and actor scope.
2. Perform a controlled Web/API restart without recreating Agent records.
3. After restart, verify the authoritative repository/API result again before interpreting the UI.
4. If the API is missing kinds, diagnose SQLite path/composition, actor scope, lifecycle event replay, latest-Published selection, kind filtering, pagination/cursor, ordering, or connection lifetime.
5. If the API contains all four but Chrome does not, diagnose front-end request fan-out, kind query construction, abort/epoch handling, stale-response overwrite, mount/unmount lifecycle, merge keys, and rendering state.
6. Fix the authority or hydration bug at its source. Do not merge unrelated actors or scopes, and do not select a non-Published version merely because it is newer.

Add automated coverage that creates and publishes all four kinds through the real service lifecycle, closes and reopens the SQLite/runtime composition, and proves:

- all four exact Published versions and fingerprints recover;
- pagination/cursor remains actor-, scope-, and kind-bound;
- Draft/Validated/Archived versions do not leak into the Published Catalog;
- another actor cannot read or inherit the catalog;
- repeated hydration/restart does not duplicate or reorder authority facts;
- database/runtime resources close naturally.

## 6. Phase D — complete the F3 real-Chrome lifecycle

Browser verification is mandatory and must be performed by the Agent in real Chrome. API, tests, logs, screenshots without interaction, or an in-app browser do not replace these checks.

### Chinese desktop — 1440×900

1. Open Agent Center and visibly confirm real Published Input, Analysis, Decision, and Reflection entries after restart.
2. Open Workbench and submit an incomplete strategy request. Confirm it returns bounded clarification questions only, with no Recommendation, Apply action, Draft, or runtime side effect.
3. Complete the request and confirm a structured Recommendation appears using exact Published Agent Versions, provenance, assumptions, gaps, and a dynamic DAG that supports branching and convergence.
4. Confirm the system-locked Portfolio → Risk Gate → Paper Execution safety chain cannot be removed or reordered.
5. Apply the Recommendation. Confirm it creates immutable Pipeline Draft and Configuration/Strategy Draft references only, with `runtimeApplied=false`.
6. Continue the same conversation with a valid strategy modification. Confirm a new immutable Draft version is created, its parent/reference is exact, and the prior version remains readable and unchanged.
7. Reload Chrome and then restart Web/API. Confirm the same actor recovers all four Published Catalog kinds, conversation Turns, Recommendation provenance, dynamic DAG, Apply result, Draft references, and version relationship.
8. Confirm a historical provenance-free Recommendation remains `PROVENANCE_UNAVAILABLE`, read-only, and cannot be Applied.

### English narrow viewport — 820×760

1. Switch to English and repeat enough of the recovered Workbench/Agent Center path to prove labels and interactions are real, not a static Sample.
2. Confirm `scrollWidth === clientWidth === 820`, no clipped controls or overlays, and visible keyboard focus for actionable controls.
3. Rapidly switch Agent kinds and Workbench conversations; no stale response may overwrite the selected actor/conversation/kind.

### Browser evidence

- Start from a fresh TradeBot tab/Console state where the Chrome capability permits it. Product Console errors or unhandled rejections fail the loop. A clearly isolated Chrome-extension asynchronous channel error must be reported separately and must not be relabeled as product evidence.
- Inspect Network only if the Agent Chrome capability exposes it. Report method/path/status only and never headers, Cookie values, tokens, request bodies, or sensitive values. If unavailable, record exactly `TOOL_UNAVAILABLE`; do not substitute API calls or server logs as Network evidence.
- Never use user-assisted or manual verification.

## 7. Required verification

Run and report the real results of:

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

Also confirm:

```text
runtimeApplied=false
Paper Only
exchangeWriteAllowed=false
Preflight/Backtest/Runtime/Exchange side effects = NONE
```

Do not commit local SQLite/workspace data, browser artifacts, logs, screenshots, tokens, Secrets, `.playwright-cli/`, or `output/`.

## 8. Completion and handoff rules

Mark F3 `COMPLETE` only when all of the following are true:

- full `npm run test:ts` naturally prints its final TAP summary and exits 0;
- all four real Published Agent kinds recover across reload and controlled Web/API restart for the same actor;
- the Chinese clarification → Recommendation → Apply → modification → immutable version → reload/restart recovery chain passes;
- English 820×760 responsive, focus, and stale-response checks pass;
- legacy no-provenance history remains visible but non-applicable;
- no product Console error is present, or an unavailable browser capability is recorded without invented evidence;
- all runtime and exchange safety boundaries remain unchanged.

If complete:

1. update the F3 checklist/status in `docs/product-optimization-plan-and-progress.md` and `docs/product-roadmap-and-progress.md` to `COMPLETE` with exact evidence;
2. update `docs/project-status-and-handoff.md`;
3. create a uniquely numbered `LOOP-045` Prompt for F4 Preflight / historical Evidence V1;
4. update `docs/next-loop-prompt.md` to that exact file.

If any item remains incomplete:

1. keep F3 `IN_PROGRESS` and state the exact failing boundary;
2. update the same progress/handoff documents truthfully;
3. create a uniquely numbered `LOOP-045` F3 continuation Prompt rather than entering F4;
4. update `docs/next-loop-prompt.md` to that exact file.

For every code or documentation change, create a scope-specific commit and push `main` to `origin` before the final report. Do not create a PR.

Use this final report template:

```text
Loop ID: LOOP-044
Mode: DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
Browser requirement: REQUIRED; Agent-operated real Chrome

Full test natural TAP exit: PASS / FAIL
Leaked handle root cause: <exact owner or NOT RESOLVED>
Four-kind Published Catalog before restart: PASS / FAIL
Four-kind Published Catalog after restart: PASS / FAIL
Catalog recovery root cause: <exact cause or NOT RESOLVED>
Chinese clarification/recommendation/DAG: PASS / FAIL
Apply -> immutable Draft authority: PASS / FAIL
Modification -> new immutable version: PASS / FAIL
Reload/restart Workbench recovery: PASS / FAIL
Legacy PROVENANCE_UNAVAILABLE boundary: PASS / FAIL
English 820×760 responsive/focus: PASS / FAIL
Console: PASS / FAIL / TOOL_UNAVAILABLE
Network: PASS / FAIL / TOOL_UNAVAILABLE
Runtime safety: runtimeApplied=false; Paper Only; exchangeWriteAllowed=false
Automation: check <result>; test:ts <natural final summary or FAIL>; build:web <result>; diff-check <result>
F3: COMPLETE / IN_PROGRESS
Next Loop: LOOP-045 (<F4 or F3 continuation>)
Git: commit <sha>; branch main; push <result>; PR not created
```
