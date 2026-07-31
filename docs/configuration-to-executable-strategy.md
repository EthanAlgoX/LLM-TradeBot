# TradeBot Configuration-to-Executable Strategy Compiler

## Milestone

M8 turns validated configuration Drafts into an immutable, auditable
`ExecutableStrategyConfiguration`. It does not modify a running Pipeline and
does not replace the current `DecisionPipeline`.

The materialization path is:

```text
Strategy Draft version
  -> exact Agent and Prompt Policy Draft versions
  -> catalog and allowlist validation
  -> immutable effective parameters
  -> derived Graph Strategy Profile
  -> derived Walk-Forward Candidate Set
  -> Strategy Evidence binding
```

All generated objects are fingerprinted. The generated Profile and Candidate
Set embed the source configuration fingerprint and are registered into the
existing Graph Evidence registries. Backtest and Walk-Forward therefore consume
the effective parameters instead of keeping configuration references as passive
metadata.

## Security and execution boundaries

- Only server-registered Agent Templates can be materialized.
- Agent, Strategy, and Prompt parameters use explicit numeric allowlists and
  bounded ranges.
- Unknown, non-numeric, or out-of-range parameters fail closed.
- Prompt Policies are stored as `semantic_only` inputs. They cannot contain or
  install code, modules, providers, arbitrary tools, Runtime mutations, or
  trading permissions.
- Client input cannot select a Profile or Candidate Set different from the
  configuration-derived objects.
- `Decision -> Portfolio -> Risk -> Execution` remains the only execution
  authority chain.
- Reflection remains a Lesson Candidate producer and cannot mutate effective
  parameters.
- Materialization and evidence approval keep `runtimeApplied=false`.

## Version and drift model

Materialization resolves the requested Strategy version exactly and resolves the
latest Agent and Prompt Policy versions referenced by that Strategy. The
resulting source fingerprint covers:

- Strategy version and payload;
- referenced Agent configuration versions;
- referenced Prompt Policy versions;
- compiled historical plan;
- Market Pack;
- base Graph Strategy Profile;
- materialization policy version.

`getCurrent` recalculates this scope. A new child Agent or Prompt Policy version,
a changed compiled plan, a changed base Profile, or a changed policy version
invalidates the executable configuration. Existing Strategy Evidence bindings
are marked stale and cannot be reused for Backtest, Walk-Forward, or approval.

## Persistence

`SqliteExecutableStrategyConfigurationRepository` stores the complete immutable
configuration, including its derived Profile and Candidate Set. SQLite triggers
reject updates and deletes. Re-loading a stored configuration re-registers the
derived definitions idempotently so process restarts do not loosen the evidence
scope.

## HTTP API

```http
POST /api/orchestration/configuration/strategies/:versionId/materialize
Authorization: Bearer <operator token>
Content-Type: application/json

{"schemaVersion":"1.0.0"}
```

The authenticated server actor is the materialization actor. Actor IDs,
fingerprints, Profile IDs, Candidate Set IDs, lifecycle state, and
`runtimeApplied` cannot be supplied by the client.

The route returns `201` with the immutable
`ExecutableStrategyConfiguration`. It returns `503` when executable strategy
materialization is not configured for that production composition.

## Production CSV vertical slice

The production CSV Graph Evidence registration enables M8 with the existing
registered CSV base Profile. Its session already reads:

- `minimumConfidence`;
- `perTradeNotional`;
- `maxNotional`;
- `initialCash`;
- `feeBps`.

Consequently, changing an allowlisted Draft parameter changes actual historical
execution behavior. For example, a materialized `perTradeNotional` above the
materialized `maxNotional` is rejected by the historical Risk gate and produces
no fill.

## Not implemented in M8

- Materialized configurations are not applied to the live or paper Runtime.
- The Web workspace does not yet call the materialization endpoint.
- Prompt text is not sent to an LLM by this compiler.
- No dynamic Agent code, connector installation, exchange write API, or
  arbitrary market integration is introduced.
- Human approval still produces an `approved_ready` Paper Plan; a separate
  controlled activation stage remains required.

The next milestone should expose materialization status and drift diagnostics in
the existing Web orchestration workspace, then add an explicit approved Paper
Plan activation boundary without granting Copilot or LLMs direct Runtime access.
