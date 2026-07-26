# Semantic Agent Artifacts and Presets

## Scope

This module establishes the semantic handoff contract for TradeBot without replacing the current fixed `DecisionPipeline` or Paper Runtime.

## Artifact boundary

Each Agent can retain a natural-language thesis, but the thesis is carried inside a strict artifact with:

- Version and stable identity.
- Schema and Market Pack references.
- Fingerprint and lineage.
- Observation Window identity.
- Direction, confidence and regime.
- Evidence references.
- Invalidation conditions.
- Risk flags.
- Source Artifact references.

`SemanticDecisionArtifact` is an intent, not an order. It always declares that Portfolio and Risk processing are required.

## Reflection boundary

Reflection creates `ReflectionLessonCandidate`. The Candidate cannot be placed in `DecisionSemanticContext` because the context is strict and accepts only `ApprovedReflectionLesson`.

Approval preserves the Candidate reference, evidence, failed trade, human actor and approval time. Reflection does not change Prompt, Agent weight, position or Risk parameters.

## Compatibility mapping

`mapLegacyMultiTimeframeSnapshotToObservations` maps a fixed multi-timeframe OHLCV snapshot into one `MarketObservationArtifact` per configured window. The caller supplies the real fingerprint function; the mapper does not fabricate a cryptographic fingerprint.

This compatibility boundary is additive. Existing `MultiTimeframeSnapshot`, Adapter and `DecisionPipeline` behavior is unchanged.

## Registered Presets

| Preset | Availability | Meaning |
| --- | --- | --- |
| `preset.current-crypto-multi-agent` | Registered available | Semantic behavior baseline for the current fixed Crypto pipeline; 5m/15m/1h are current defaults only |
| `preset.single-window-daily` | Capability required | Contract template proving a single daily window is expressible; it does not claim a daily Adapter is registered |
| `preset.event-only-research` | Capability required | Research-only template using events and no K-line or execution authority |

The Catalog has no runtime registration method. Presets are created by backend code and returned as parsed copies. Client-provided modules, Providers, URLs, paths, SQL, Prompt executors or code are outside this boundary.

## Deferred

- Historical Graph Executor.
- Arbitrary Graph Backtest and Walk-Forward.
- Preset Catalog HTTP endpoints.
- Copilot tools.
- Generic Graph Paper Runtime.
- Real daily or event Data Source Adapter registration.
