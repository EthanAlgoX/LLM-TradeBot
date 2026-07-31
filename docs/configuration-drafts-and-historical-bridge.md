# Configuration Drafts and Historical Compiler Bridge

## Scope

This milestone connects a validated, compiled `PipelineGraphVersion` to the registered historical graph executor without changing the live `DecisionPipeline`. It also introduces immutable drafts for market, Agent, prompt/policy, and strategy configuration.

The bridge is deliberately one-way:

`PipelineGraphVersion`
→ existing graph validation
→ `CompiledPipelinePlan`
→ registered implementation and artifact checks
→ `HistoricalGraphExecutionPlan`

The result always has `runtimeApplied: false`. Compilation does not start paper trading, mutate a running Pipeline, or bypass backtest, walk-forward, approval, Risk, or Execution gates.

## Compiler Bridge

`PipelineGraphHistoricalBridge` checks:

- graph ID, human version, fingerprint, and compiled node set;
- immutable Market Pack, Agent Config, Agent Template, and implementation bindings;
- Agent Template version and semantic-role mapping;
- registered historical node executors and their input/output artifact declarations;
- graph port Schema references against the historical artifact registry;
- required, optional, and fallback input policies;
- observation windows and required capability kinds;
- feedback edges, which are not accepted for a finite historical execution plan;
- the final `HistoricalGraphExecutionPlan` contract and fingerprint before registration.

The registered plan preserves graph identity and lineage through `presetRef`, `compiledGraphRef`, Market Pack reference, observation-window IDs, edge IDs, and artifact Schema IDs.

## Immutable Configuration Drafts

The configuration contract supports four strict payload kinds:

- `market`;
- `agent`;
- `prompt_policy`;
- `strategy`.

Every stored version contains a stable draft ID, immutable version ID, monotonic version index, parent fingerprint, human version, lifecycle status, content fingerprint, actor, evidence state, creation time, and `runtimeApplied: false`.

`ConfigurationDraftService` validates references only against injected catalogs and compiler ports. Prompt/policy drafts can select registered tool IDs but cannot submit provider modules, executable code, filesystem paths, actor identity, or runtime flags. Strategy drafts can reference an existing Pipeline draft, Agent configuration drafts, and prompt/policy drafts; they cannot directly select a runtime executor.

When configuration changes after evidence is recorded, the new version marks that evidence `stale` with `configuration_changed`. Prior versions remain unchanged.

## Persistence and HTTP Boundary

`SqliteConfigurationDraftRepository` stores append-only JSON versions and installs update/delete rejection triggers.

`ConfigurationDraftHttpHandler` is a mountable, currently unmounted HTTP boundary. It:

- uses the existing Bearer authenticator;
- derives actor identity server-side;
- caps request bodies;
- validates strict request Schemas;
- exposes catalog, create-version, read, validate, and historical-compile operations;
- never reports a configuration draft as applied to Runtime.

The handler is not mounted into the current Runtime server in this milestone. This avoids changing current CLI, paper account, Risk, Execution, or runtime safety behavior before an explicit integration milestone.

## Remaining Work

- Mount the handler behind the main Runtime API and operational configuration.
- Add a durable Pipeline draft repository shared by the HTTP compiler port.
- Connect configuration drafts to backtest and walk-forward evidence jobs.
- Add human approval and approved-paper-plan generation for compiled strategy versions.
- Build the Web configuration workspace against these contracts; until the Runtime API is mounted, any Web catalog remains explicitly mock data.
