# TradeBot Production Orchestration API and Web Workspace

## Scope

M6 connects the immutable Configuration Draft and Strategy Evidence services to
the existing loopback-only orchestration server. It does not replace the fixed
`DecisionPipeline`, activate Paper Runtime, or permit exchange writes.

The production composition root now owns one SQLite boundary for:

- Pipeline Graph drafts and their existing promotion evidence;
- Market, Agent, Prompt Policy, and Strategy configuration versions;
- durable Graph Backtest and Walk-Forward jobs when registered;
- Strategy Evidence binding versions;
- approver-owned `ApprovedPaperPlan` records.

## Runtime registration

`createCurrentPipelineOrchestrationRuntime` always mounts the Configuration
Draft API. A caller may register:

- a `ProductionHistoricalGraphCompiler` backed by the M4
  `PipelineGraphHistoricalBridge`;
- immutable historical dataset definitions;
- immutable strategy profiles and candidate sets;
- immutable Walk-Forward plans;
- a registered `GraphBacktestSessionFactory`;
- a server-owned Approved Paper Plan policy.

If the historical compiler is absent, Strategy validation reports historical
compile failure. If Graph Evidence dependencies are absent,
`/api/orchestration/strategy-evidence/*` returns
`STRATEGY_EVIDENCE_NOT_CONFIGURED` with HTTP 503. Neither case falls back to
fabricated evidence.

The public orchestration Catalog reports only immutable capability metadata and
whether each production boundary is configured. It always reports
`runtimeApplied: false`.

## HTTP boundaries

The existing Node HTTP server adapts requests to the strict M4 and M5 Web
handlers:

- `/api/orchestration/configuration/*`
- `/api/orchestration/strategy-evidence/*`

Both use the same loopback CORS policy and the same Bearer authenticator as the
existing Pipeline API. Actor identity and roles are derived by the server.
Client-supplied Actor, Evidence, Executor, or Runtime fields are not accepted.

## Web behavior

The System Orchestration view retains the existing graph canvas and Runtime
Supervisor. A production strategy track now reads the real Catalog and exposes
the controlled sequence:

`Draft -> Contract Validation -> Historical Compile -> Backtest -> Walk-Forward -> Human Approval`

The Copilot control creates a structured Current Crypto recipe from registered
Market, Data Source, Agent Template, and Observation Window entries. It cannot
execute arbitrary code or mutate Runtime. Approved plans remain
`approved_ready` and `runtimeApplied: false`.

When the Runtime is offline or production evidence dependencies are not
registered, the workspace labels that state explicitly and disables the
affected actions.

## M7 production historical evidence

M7 supplies the previously optional production dependencies when a strict CSV
dataset and deterministic Strategy Profile are configured. The Composition
Root registers a semantic Current Crypto CSV Graph, a production
`PipelineGraphHistoricalBridge`, immutable Dataset/Profile/Walk-Forward
definitions, and an isolated CSV-backed `GraphBacktestSessionFactory`.

This enables the real Strategy Evidence controls without changing the safety
boundary: approval produces an `approved_ready` plan and still reports
`runtimeApplied: false`.
