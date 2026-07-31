# Graph Backtest and Walk-Forward Evidence

## Scope

M3 executes multiple registered historical `asOf` cycles through the M2 Historical Graph Executor. It produces immutable, verifiable evidence but does not promote, approve or activate a Pipeline.

## Registered inputs

A request can reference only:

- Registered Historical Plan ID.
- Registered Dataset ID.
- Registered Strategy Profile or Profile Candidate Set ID.
- Registered Walk-Forward Plan ID.
- Start and end timestamps.
- Idempotency key.

Datasets own the monotonic `asOf` sequence. A request cannot submit bars, events, CSV paths, URLs, Providers, modules, code, Prompt executors or actor identity.

## Backtest Sessions

Every Backtest Run creates an isolated Graph Session. Every Walk-Forward candidate training run and validation run creates another isolated Session. Portfolio, Agent memory, Lesson Candidate and execution state are therefore not reused across candidates or validation boundaries.

Each cycle records the M2 Graph Run reference, NodeRun count, Artifact fingerprints, lineage fingerprints and a typed outcome.

## Trading and research evidence

Trading Graphs record equity, return, drawdown, trade/fill counts and Risk rejections. Research-only Graphs record research success and assessment Artifact counts only. Research evidence has no return field and is never promotion eligible.

## Walk-Forward

Training ends strictly before validation starts. Selection reads only registered candidate training metrics. Validation runs with the selected Profile in a fresh Session. Fold fingerprints bind all candidate evidence and the validation result.

## Durable Jobs

SQLite stores strict requests, request fingerprints, idempotency, status, lease owner/expiry and immutable evidence JSON. Expired running jobs become orphaned and can be explicitly reacquired. A successful evidence result cannot be overwritten.

## Promotion boundary

Evidence exposes an `evidenceRef` compatible with the existing promotion workflow's evidence reference field. M3 does not call `promote`, create Human Approval or start Paper Runtime.
