# TradeBot Production Historical Evidence Runtime

## M7 scope

M7 closes the production historical evidence path for the registered Current
Crypto semantic CSV pipeline:

`Pipeline Draft -> Configuration Validation -> Historical Compile -> Graph Backtest -> Walk-Forward -> Human Approval -> Approved Ready`

It does not activate Paper Runtime and does not add an exchange write adapter.

## Registered historical pipeline

The M7 pipeline is a separate, immutable historical graph. It preserves the
current fixed runtime and represents the semantic handoff explicitly:

- CSV closed bars are emitted as lineage-bearing Market Observation artifacts;
- 5m, 15m, and 1h analysis nodes emit semantic assessments;
- Bull, Bear, and Position Monitor assessments enter Decision;
- Decision can only create semantic intent;
- Portfolio, Risk, and simulated Execution remain the only action path;
- Reflection can only emit a Lesson Candidate.

The 5m, 15m, and 1h windows are the native capability of the current CSV
adapter, not a framework-wide restriction.

## Production registration

`createCsvProductionGraphEvidenceRegistration` performs startup-time
registration and fails closed when:

- CSV headers, rows, timeframes, OHLC bounds, or duplicate bars are invalid;
- a configured symbol lacks required 5m, 15m, or 1h history;
- the closed schedule cannot satisfy the Walk-Forward definition;
- the resolved strategy enables an LLM;
- the CSV content fingerprint changes after registration;
- Dataset, Market Pack, Data Source, Profile, Graph Plan, or capability scope
  does not match.

The registration contributes immutable Agent Templates, Agent Configs,
implementation bindings, the semantic Pipeline Graph, Dataset, Profile,
Candidate Set, Walk-Forward Plan, Historical Graph Compiler, and an isolated
Graph Backtest Session Factory.

## Runtime behavior

The CLI uses the existing historical CSV/profile/symbol configuration to
enable both the legacy fixed DecisionPipeline evidence runner and the M7 Graph
Evidence path. The two paths remain distinguishable and independently
auditable.

Every Graph Backtest or Walk-Forward trial creates a fresh session. Sessions
reload and fingerprint the CSV before execution, use only bars closed at the
requested `asOf`, and never reuse mutable portfolio state across trials.

Human approval creates an `ApprovedPaperPlan` with
`lifecycleStatus=approved_ready` and `runtimeApplied=false`. Applying that plan
to Paper Runtime remains a separate controlled operation.

