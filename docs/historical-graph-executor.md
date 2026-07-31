# Historical Graph Executor

## Scope

The Historical Graph Executor runs one registered historical `asOf` cycle. It does not replace the current `DecisionPipeline`, create a multi-point Backtest Job, or activate Paper Runtime.

## Trust boundary

A run request contains only:

- `planId`
- `idempotencyKey`
- `asOf`

The Plan Registry compiles a backend-registered Preset with backend-registered Agent Template to Node Executor bindings. The Executor retrieves the immutable plan by ID and verifies its fingerprint. There is no request surface for a module, Provider, Prompt executor, code, URL, SQL, file path, actor or raw plan.

## Typed Artifact execution

Every Artifact payload is parsed by an artifact-type-specific registered Zod Schema. The immutable envelope records:

- Artifact ID and type.
- Schema reference.
- Fingerprint.
- Producer node.
- Historical `asOf`.
- Source Artifact references.
- Lineage fingerprints.

Outputs with future timestamps, missing lineage, unrelated lineage, changed source fingerprints, undeclared types or incompatible payloads fail closed.

## Node execution

Nodes run in deterministic DAG order. Required inputs block a node when absent. Optional inputs may be absent. A Fallback input is used only when its declared primary edge has no output and the fallback produces the same Artifact type.

Each NodeRun records input and output refs, executor ID, status, used fallback edges, timestamps, duration and stable error fields.

## Current Crypto binding

`createRegisteredSemanticHistoricalExecution` binds the current semantic Crypto Preset through explicit server ports for:

- Candidate selection.
- Observation loading.
- Window analysis.
- Bull and Bear research.
- Current Position Monitor.
- Decision Context and Decision.
- Portfolio action.
- Risk evaluation.
- Simulated execution.
- Reflection Lesson Candidate.

The ports are the integration seam for the existing implementations. This module does not copy weaker Portfolio or Risk rules. Runtime composition remains unchanged until a later approved integration stage.

## Deferred

- Multiple historical `asOf` Backtest orchestration.
- Durable Graph Run repository and HTTP Job endpoints.
- Existing `CompiledPipelinePlan` to Historical Plan adapter for arbitrary user Drafts.
- Generic Graph Paper Runtime.
