# TradeBot Comparative Trade Evidence and Human Lesson Review Loop

## Mission

Continue TradeBot from the explicit Trade lineage and Single Trade Review slice. Build a real, bounded comparative evidence and human Lesson Candidate review loop by reusing the existing Paper Account, Artifact Ledger, Trade lineage, Reflection Candidate, Bearer authentication, and immutable evidence patterns.

This is an implementation loop. Inspect the dirty workspace first, preserve every existing user change, implement the slice, run the required tests, and deliver runnable code. Do not reset, clean, revert, or commit.

## Product boundaries

1. Selector remains `topN=1`; symbols remain only a candidate pool.
2. Existing positions continue through Position Monitor.
3. The only action chain remains Decision -> Portfolio -> Risk -> Execution.
4. Reflection can only create a Lesson Candidate.
5. A human review may reject a candidate or accept it for further validation. It must not create an Approved Reflection Lesson that is immediately usable by Decision.
6. Accepted candidates still require Contract Validation, Backtest, Walk-Forward, Human Approval, and Paper Running before any strategy effect.
7. Comparative evidence is descriptive, not causal. Never infer causality from outcome similarity or temporal proximity.
8. The server selects comparison trades. The client cannot provide SQL, filters, code, paths, URLs, runners, actor identity, Runtime parameters, or exchange account data.
9. All review responses remain read-only, `runtimeApplied=false`, and `exchangeWriteAllowed=false`.
10. Do not change Paper Account PnL, fee, Risk, Execution, or Runtime Safety behavior.

## Required contracts

Add strict Zod contracts for:

- `TradeOutcomeEvidence`
- `TradeComparisonPolicy`
- `ComparativeTradeEvidence`
- `ComparativeTradeEvidenceRequest`
- `LessonCandidateReviewCommand`
- `LessonCandidateReviewContext`
- `LessonCandidateReviewRecord`
- `LessonCandidateReviewResponse`

Contracts must carry stable IDs, `schemaVersion`, `humanVersion`, fingerprints, timestamps, lifecycle state, Trade/Market/Data Source/Graph/Schema references, stable issue codes, and explicit runtime isolation flags.

## Required backend behavior

1. Build comparative evidence only from registered server-side Trade facts.
2. Select bounded prior comparators with the same Pipeline Graph fingerprint, Market Pack, and symbol.
3. Use the most recent matching prior closed trade as the baseline.
4. Return raw Paper Account outcome values and deterministic deltas; do not rewrite or reinterpret PnL and fees.
5. Return `insufficient_evidence` when no valid comparator exists.
6. Reject unknown Trade IDs and any client-owned comparison policy.
7. Require Bearer authentication for Lesson Candidate review.
8. Derive actor and role on the server.
9. Persist immutable review records with idempotency.
10. Fail closed on candidate or comparative-evidence fingerprint drift.
11. Allow only `accept_for_validation` and `reject`.
12. `accept_for_validation` must not create an Approved Reflection Lesson, strategy mutation, Runtime apply, order, or exchange write.

## Required tests

Cover:

1. Strict contracts reject unknown and executable fields.
2. Comparator selection is server-owned and same Graph/Market/Symbol only.
3. Missing comparators return `insufficient_evidence`.
4. Raw PnL and fees are preserved and deltas are deterministic.
5. Bearer authentication derives actor and role.
6. Actor, role, SQL, code, path, URL, runner, Runtime, Risk bypass, and exchange injection are rejected.
7. Candidate fingerprint drift fails closed.
8. Comparative evidence fingerprint drift fails closed.
9. The same idempotency key does not create a second review.
10. Reusing an idempotency key for a different command fails closed.
11. Rejected candidates remain rejected records only.
12. Accepted candidates remain `accepted_for_validation`, with `runtimeApplied=false`, no Approved Lesson, and no strategy mutation.
13. Existing DecisionPipeline, Selector, Position Monitor, Risk, Execution, Paper Account, and Runtime Safety tests continue to pass.

## Validation

Run:

```sh
npm run check
npm run test:ts
npm run build:web
git diff --check
```

Update the roadmap and handoff documents with implemented versus unavailable boundaries, final test totals, and the next recommended loop.

