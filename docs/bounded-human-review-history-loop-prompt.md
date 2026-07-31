# TradeBot Bounded Human Review History and Continuity Loop

## Objective

Add a bounded, authenticated, read-only history projection for the existing
immutable Lesson Candidate review records, and restore that state in the
existing Causal Review after reload. Do not create a second Review, Lesson,
Evidence, Approval, or Runtime model.

## Backend requirements

1. Reuse `LessonCandidateReviewRecord` and
   `SQLiteLessonCandidateReviewRepository`.
2. Add strict contracts for a history request and response.
3. Accept only `selectedTradeId`, optional opaque `cursor`, and optional
   bounded `limit`.
4. Resolve the candidate from the server-owned Reflection catalog.
5. Return records newest-first with a deterministic opaque cursor and a hard
   maximum of 20 records per page.
6. Mount the history route under the existing Bearer-authenticated main
   server:
   `POST /api/orchestration/lesson-candidates/reviews/history`.
7. Reject actor, role, candidate, evidence, SQL, URL, path, code, Runtime,
   execution, Risk bypass, and exchange-write injection.
8. Every response remains read-only, `runtimeApplied=false`, and
   `exchangeWriteAllowed=false`.

## Web requirements

1. Extend the existing comparative section in Causal Review.
2. Restore an existing accepted or rejected review after reload.
3. Show a compact bounded history, not a new page or dense dashboard.
4. Keep Chinese and English complete.
5. Do not expose Start, Pause, Apply, order, execution, Risk bypass, Approved
   Lesson, or exchange-write controls.

## Tests

1. Strict history contracts reject unknown fields and oversized limits.
2. SQLite history is newest-first, bounded, cursor-paginated, and persistent.
3. HTTP history requires Bearer auth and rejects selector injection.
4. The main server exposes history after a real review.
5. Web state restores reviewed status without representing Runtime apply.
6. Existing trading and Runtime Safety tests remain green.

## Validation

- `npm run check`
- `npm run test:ts`
- `npm run build:web`
- `git diff --check`
- `npm run dev:paper`
- Browser checks at 1440x900 and 820x760 in Chinese and English when a browser
  control instance is available.

## Non-goals

- No DecisionPipeline or trading behavior change.
- No Approved Lesson creation.
- No strategy mutation.
- No Runtime apply.
- No exchange write interface.

