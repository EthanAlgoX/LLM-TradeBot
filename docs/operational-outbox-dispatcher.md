# TradeBot Operational Outbox Dispatcher

## Scope

This slice delivers operational events only through backend-registered delivery
templates. It does not add an exchange write path, a generic webhook client, a
dynamic module loader, or a client-controlled target.

The immutable `paper_runtime_operational_events` journal remains the source of
truth. Delivery state is stored separately:

- `operational_dispatcher_lease`
- `operational_delivery_attempts`
- `operational_delivery_dead_letters`
- `operational_delivery_replays`

An event and template pair is unique. Repeated dispatch calls therefore cannot
create duplicate attempts or re-deliver an already delivered pair.

## Registration boundary

`RegisteredOperationalDeliveryRegistry` accepts a strict public template and a
server-owned sink implementation. The public template contains no URL, host,
headers, credentials, provider, module, file path, Prompt, or executable code.
The sink kind must match the template.

Available implementations are deliberately bounded:

- `InMemoryOperationalDeliverySink` is for tests and local fixtures.
- `LocalJsonlOperationalAuditSink` writes the fixed
  `tradebot-operational-audit.jsonl` filename inside a directory supplied by
  server composition.

The current TradeBot composition registers no delivery template. As a result,
startup produces no file write and no network request. Slack, email, and webhook
delivery are not implemented.

## Lease, retry, and recovery

`dispatchAvailable` acquires the global dispatcher lease with a monotonically
increasing fencing token. A second owner is rejected while the lease is live.
Each attempt moves through:

`queued -> delivering -> delivered`

or:

`queued -> delivering -> retry_wait -> ... -> dead_letter`

Backoff is exponential and capped by the registered template. Time is
injectable for deterministic tests. On process restart, an attempt left in
`delivering` is recovered to `retry_wait`; the event is not discarded.

At `maxAttempts`, a durable dead letter is created with incident type
`delivery_failure`. Operator replay is authenticated and idempotent. It reuses
the original event ID, fingerprint, and registered template, and accepts no
replacement payload or target.

## Controlled HTTP

The current orchestration server mounts:

- `GET /api/orchestration/operational-outbox`
- `POST /api/orchestration/operational-outbox/dispatch`
- `POST /api/orchestration/operational-outbox/dead-letters/:id/replay`

All routes require the existing server authenticator. Dispatch and replay
require the `operator` role. Actor and dispatcher owner are derived on the
server. Strict bodies reject actor, URL, provider, headers, path, code, and other
unrecognized fields.

## Web

The Web application includes a collapsed Operational Outbox drawer. It shows
registered template count, dispatcher lease owner, recent attempts, retry or
dead-letter state, and explicit not-configured status for external channels.
The token is held only in component memory. Dispatch and replay require explicit
operator actions.

## Deferred

- Scheduled/background polling is not enabled by default.
- Slack, email, webhook, and any other network sink are not implemented.
- Retention, immutable audit export manifests, and confirmed cleanup are a
  separate controlled lifecycle.
