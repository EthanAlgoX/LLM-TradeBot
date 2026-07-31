# Strategy Evidence and Approval Bridge

## Purpose

M5 binds an immutable Strategy Configuration version to the real M3 historical evidence scope:

`Strategy Configuration`
→ `HistoricalGraphExecutionPlan`
→ registered Dataset and Profile scope
→ durable Graph Backtest
→ durable Graph Walk-Forward
→ human approval
→ `ApprovedPaperPlan`

The bridge does not activate or run the Paper Runtime. Every Strategy Evidence Binding and generated Paper Plan has `runtimeApplied: false`.

## Immutable Evidence Scope

A binding records:

- Strategy draft ID, configuration version ID, version fingerprint, and payload fingerprint;
- Historical Plan, compiled Graph, and Market Pack references;
- Dataset and Data Source references;
- Backtest Profile;
- Walk-Forward candidate set and plan;
- historical start and end timestamps;
- Backtest and Walk-Forward job/evidence references;
- approval and generated Paper Plan references.

Binding versions are append-only in SQLite. Update and delete triggers reject mutation. Creation, evidence jobs, and approval use server-side idempotency.

Evidence metadata can create a newer configuration version without invalidating the binding because the Strategy payload is unchanged. Any actual Strategy payload change marks the binding stale and blocks approval. Dataset, Profile, candidate-set, Walk-Forward-plan, or Historical-plan fingerprint drift also fails closed.

## Evidence Gates

The service delegates job execution through `RegisteredStrategyGraphEvidenceJobPort`, which wraps the existing `DurableGraphEvidenceJobService` and `SqliteGraphEvidenceJobRepository`.

Both evidence artifacts must:

- be terminal and successful;
- have the expected Graph evidence kind;
- match Historical Plan, Dataset, and Profile-scope fingerprints;
- pass `verifyGraphEvidenceArtifact`;
- be explicitly `promotionEligible`.

Backtest alone is insufficient. Walk-Forward alone is insufficient.

## Human Approval and Paper Plan

Only an actor with the `approver` role can approve an evidence-ready binding. The generated `ApprovedPaperPlan` uses:

- server-owned Paper Account;
- server-owned candidate symbols;
- server-owned Risk Policy references;
- server-derived actor identity;
- verified evidence fingerprints;
- the compiled Graph and Strategy scope fixed by the binding.

The client cannot submit a Historical Plan ID, evidence payload, Actor ID, Paper Account, symbols, Risk Policy, executor, or Runtime flag.

An approved plan is not an activation. Existing activation, preflight, lease, Safety, close-only, Risk, and Execution controls remain unchanged.

## HTTP Boundary

`StrategyEvidenceHttpHandler` exposes a mountable strict boundary:

- create a Strategy Evidence Binding;
- read the latest binding;
- run Backtest;
- run Walk-Forward;
- approve an evidence-ready binding.

The handler derives actors from the existing Bearer authenticator, caps bodies at 64 KiB, and uses strict request contracts. It is exported but not mounted into the current Runtime server in M5.

## Remaining Integration

- construct the production service composition with registered datasets, profiles, the real Historical Plan compiler, and the durable Graph job service;
- mount configuration and Strategy Evidence handlers into the loopback Runtime API;
- expose binding status and approval gates in the Web orchestration workspace;
- require existing Paper Runtime preflight and explicit activation after plan approval.
