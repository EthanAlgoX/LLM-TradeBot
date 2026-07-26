# TradeBot Operational Worker and Retention

## Controlled Worker

`DurableOperationalOutboxWorker` is a server-owned scheduler around the
registered Operational Outbox Dispatcher. Its immutable schedule declares a
bounded interval and batch size. The schedule also fixes:

- `overlapAllowed: false`
- `clientMutable: false`
- `externalNetworkAllowed: false`

`start` is a no-op for a disabled schedule. An enabled worker schedules only the
next tick after the current tick settles, so ticks cannot overlap. `stop`
cancels the pending timer and prevents another tick. Dispatcher event/template
idempotency remains the delivery boundary.

The current composition registers a disabled schedule. HTTP and Copilot cannot
enable it or change its owner, interval, batch size, target, template, or
concurrency.

## Retention qualification

The retention policy is a strict, backend-registered contract. The current
composition registers a 90-day disabled policy with `cleanupAllowed: false`.
Dry-run previews remain available for visibility, but cleanup fails closed.

An operational event is eligible only when:

- it is older than the policy cutoff;
- at least one active delivery template is registered;
- every active registered template has one delivered attempt;
- no attempt is queued, delivering, waiting to retry, or dead-lettered;
- no open delivery-failure dead letter exists;
- no open Paper Runtime incident exists for its Run;
- the Run is not orphaned.

Candidate results are bounded by the policy candidate limit. A preview records
machine-readable protected-reason counts.

## Manifest and confirmed cleanup

Creating a dry run seals an immutable SQLite Audit Export Manifest. It contains
IDs, sequence range, counts, policy lineage, candidate fingerprint, and manifest
fingerprint. It explicitly excludes event payloads, paths, credentials, and
personal data. SQLite triggers reject manifest update or deletion.

Cleanup requires an authenticated operator and a strict request containing only
confirmation, manifest ID, manifest fingerprint, idempotency key, and reason.
Immediately before deletion the service recomputes the candidate set using the
sealed cutoff. Any candidate or lineage drift rejects the operation.

Successful cleanup removes only the eligible operational events and their
delivered attempts. It leaves an immutable execution tombstone with counts,
sequence range, actor, time, and original manifest fingerprint. Paper Account,
Risk, Execution, Runtime Safety, and exchange-write state are outside this
service.

## HTTP and Web

The controlled API provides:

- `POST /api/orchestration/operational-outbox/retention/previews`
- `POST /api/orchestration/operational-outbox/retention/manifests/:id/execute`

The existing outbox status response also includes Worker state, registered
policy, recent manifests, and execution tombstones. The Web Operational Outbox
drawer shows the same state. With the default disabled policy, the execute
control remains unavailable.

## Deferred

- No external Slack, email, or webhook sink exists.
- No filesystem audit-export writer is registered by the current composition;
  the sealed SQLite manifest is the durable audit export.
- Enabling the Worker or Retention requires a future server-owned deployment
  configuration and operational approval process.
