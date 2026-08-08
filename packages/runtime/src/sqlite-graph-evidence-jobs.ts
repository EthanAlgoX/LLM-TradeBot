import { DatabaseSync } from "node:sqlite";
import {
  GraphBacktestJobRequestSchema,
  GraphEvidenceArtifactSchema,
  GraphEvidenceJobSchema,
  GraphWalkForwardJobRequestSchema,
  type GraphBacktestJobRequest,
  type GraphEvidenceArtifact,
  type GraphEvidenceJob,
  type GraphStrategyProfileCandidateSet,
  type GraphStrategyProfileDefinition,
  type GraphWalkForwardJobRequest,
} from "../../contracts/src/index.js";
import {
  GraphBacktestRunner,
  GraphWalkForwardRunner,
  type GraphEvidenceExecutionContext,
  createGraphEvidenceArtifact,
  graphEvidenceFingerprint,
} from "../../core/src/graph-backtest-evidence.js";

export class GraphEvidenceJobError extends Error {
  constructor(
    readonly code:
      | "GRAPH_JOB_NOT_FOUND"
      | "GRAPH_JOB_IDEMPOTENCY_CONFLICT"
      | "GRAPH_JOB_LEASE_HELD"
      | "GRAPH_JOB_TERMINAL"
      | "GRAPH_JOB_RESULT_IMMUTABLE",
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(code);
    this.name = "GraphEvidenceJobError";
  }
}

interface GraphEvidenceJobRow {
  job_id: string;
  kind: "backtest" | "walk_forward";
  request_json: string;
  request_fingerprint: string;
  status: "queued" | "running" | "succeeded" | "failed" | "orphaned";
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  lease_owner_id: string | null;
  lease_expires_at: string | null;
  evidence_json: string | null;
  failure_code: string | null;
}

function parseRequest(kind: GraphEvidenceJobRow["kind"], value: unknown) {
  return kind === "backtest"
    ? GraphBacktestJobRequestSchema.parse(value)
    : GraphWalkForwardJobRequestSchema.parse(value);
}

function rowToJob(row: GraphEvidenceJobRow): GraphEvidenceJob {
  return GraphEvidenceJobSchema.parse({
    schemaVersion: "1.0.0",
    jobId: row.job_id,
    kind: row.kind,
    request: parseRequest(row.kind, JSON.parse(row.request_json)),
    requestFingerprint: row.request_fingerprint,
    status: row.status,
    requestedAt: row.requested_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    leaseOwnerId: row.lease_owner_id ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    evidence: row.evidence_json ? JSON.parse(row.evidence_json) : undefined,
    failureCode: row.failure_code ?? undefined,
  });
}

export class SqliteGraphEvidenceJobRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS graph_evidence_jobs (
        job_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('backtest', 'walk_forward')),
        idempotency_key TEXT NOT NULL,
        request_json TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'orphaned')),
        requested_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        lease_owner_id TEXT,
        lease_expires_at TEXT,
        evidence_json TEXT,
        failure_code TEXT,
        UNIQUE(kind, idempotency_key)
      );
      CREATE TRIGGER IF NOT EXISTS graph_evidence_result_immutable
      BEFORE UPDATE OF evidence_json ON graph_evidence_jobs
      WHEN OLD.evidence_json IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'GRAPH_JOB_RESULT_IMMUTABLE');
      END;
      CREATE TRIGGER IF NOT EXISTS graph_evidence_success_immutable
      BEFORE UPDATE ON graph_evidence_jobs
      WHEN OLD.status = 'succeeded'
      BEGIN
        SELECT RAISE(ABORT, 'GRAPH_JOB_RESULT_IMMUTABLE');
      END;
    `);
  }

  submit(
    kind: "backtest" | "walk_forward",
    rawRequest: unknown,
    requestedAt: string,
  ): GraphEvidenceJob {
    const request = parseRequest(kind, rawRequest);
    const requestFingerprint = graphEvidenceFingerprint(request);
    const jobId = `graph-job:${graphEvidenceFingerprint({ kind, idempotencyKey: request.idempotencyKey }).slice(7, 31)}`;
    this.database.prepare(`
      INSERT OR IGNORE INTO graph_evidence_jobs (
        job_id, kind, idempotency_key, request_json, request_fingerprint, status, requested_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', ?)
    `).run(jobId, kind, request.idempotencyKey, JSON.stringify(request), requestFingerprint, requestedAt);
    const stored = this.get(jobId);
    if (stored.requestFingerprint !== requestFingerprint) {
      throw new GraphEvidenceJobError("GRAPH_JOB_IDEMPOTENCY_CONFLICT", {
        idempotencyKey: request.idempotencyKey,
      });
    }
    return stored;
  }

  get(jobId: string): GraphEvidenceJob {
    const row = this.database
      .prepare("SELECT * FROM graph_evidence_jobs WHERE job_id = ?")
      .get(jobId) as unknown as GraphEvidenceJobRow | undefined;
    if (!row) throw new GraphEvidenceJobError("GRAPH_JOB_NOT_FOUND", { jobId });
    return rowToJob(row);
  }

  acquire(jobId: string, ownerId: string, now: string, leaseExpiresAt: string): GraphEvidenceJob {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(jobId);
      if (current.status === "succeeded" || current.status === "failed") {
        throw new GraphEvidenceJobError("GRAPH_JOB_TERMINAL", { jobId, status: current.status });
      }
      if (
        current.status === "running" &&
        current.leaseExpiresAt &&
        Date.parse(current.leaseExpiresAt) > Date.parse(now) &&
        current.leaseOwnerId !== ownerId
      ) {
        throw new GraphEvidenceJobError("GRAPH_JOB_LEASE_HELD", {
          jobId,
          leaseOwnerId: current.leaseOwnerId ?? "unknown",
        });
      }
      this.database.prepare(`
        UPDATE graph_evidence_jobs
        SET status = 'running', started_at = COALESCE(started_at, ?),
            lease_owner_id = ?, lease_expires_at = ?, failure_code = NULL
        WHERE job_id = ?
      `).run(now, ownerId, leaseExpiresAt, jobId);
      this.database.exec("COMMIT");
      return this.get(jobId);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  complete(jobId: string, ownerId: string, evidence: GraphEvidenceArtifact, completedAt: string): GraphEvidenceJob {
    const parsed = GraphEvidenceArtifactSchema.parse(evidence);
    const result = this.database.prepare(`
      UPDATE graph_evidence_jobs
      SET status = 'succeeded', completed_at = ?, evidence_json = ?,
          lease_owner_id = NULL, lease_expires_at = NULL
      WHERE job_id = ? AND status = 'running' AND lease_owner_id = ? AND lease_expires_at > ?
    `).run(completedAt, JSON.stringify(parsed), jobId, ownerId, completedAt);
    if (Number(result.changes) !== 1) {
      throw new GraphEvidenceJobError("GRAPH_JOB_LEASE_HELD", { jobId, ownerId });
    }
    return this.get(jobId);
  }

  fail(jobId: string, ownerId: string, failureCode: string, completedAt: string): GraphEvidenceJob {
    const result = this.database.prepare(`
      UPDATE graph_evidence_jobs
      SET status = 'failed', completed_at = ?, failure_code = ?,
          lease_owner_id = NULL, lease_expires_at = NULL
      WHERE job_id = ? AND status = 'running' AND lease_owner_id = ? AND lease_expires_at > ?
    `).run(completedAt, failureCode, jobId, ownerId, completedAt);
    if (Number(result.changes) !== 1) {
      throw new GraphEvidenceJobError("GRAPH_JOB_LEASE_HELD", { jobId, ownerId });
    }
    return this.get(jobId);
  }

  recoverExpired(now: string): number {
    const result = this.database.prepare(`
      UPDATE graph_evidence_jobs
      SET status = 'orphaned', lease_owner_id = NULL, lease_expires_at = NULL,
          failure_code = 'GRAPH_JOB_LEASE_EXPIRED'
      WHERE status = 'running' AND lease_expires_at <= ?
    `).run(now);
    return Number(result.changes);
  }
}

export interface GraphEvidenceProfileScopeResolver {
  backtest(profileId: string): GraphStrategyProfileDefinition;
  walkForward(candidateSetId: string): GraphStrategyProfileCandidateSet;
}

export class DurableGraphEvidenceJobService {
  constructor(
    private readonly repository: SqliteGraphEvidenceJobRepository,
    private readonly backtests: GraphBacktestRunner,
    private readonly walkForwards: GraphWalkForwardRunner,
    private readonly profileScopes: GraphEvidenceProfileScopeResolver,
    private readonly now: () => Date = () => new Date(),
    private readonly leaseMs = 60_000,
    private readonly executionDeadlineMs = Math.floor(leaseMs * 0.75),
    private readonly maxWalkForwardCycles = 300,
  ) {}

  submitBacktest(rawRequest: unknown): GraphEvidenceJob {
    return this.repository.submit("backtest", rawRequest, this.now().toISOString());
  }

  submitWalkForward(rawRequest: unknown): GraphEvidenceJob {
    return this.repository.submit("walk_forward", rawRequest, this.now().toISOString());
  }

  /** Read-only lookup used by durable consumers such as Experiment Replay. */
  get(jobId: string): GraphEvidenceJob {
    return this.repository.get(jobId);
  }

  async run(jobId: string, ownerId: string): Promise<GraphEvidenceJob> {
    const existing = this.repository.get(jobId);
    if (existing.status === "succeeded") return existing;
    const now = this.now();
    const job = this.repository.acquire(
      jobId,
      ownerId,
      now.toISOString(),
      new Date(now.getTime() + this.leaseMs).toISOString(),
    );
    if (this.executionDeadlineMs >= this.leaseMs) {
      throw new Error("GRAPH_JOB_DEADLINE_MUST_PRECEDE_LEASE");
    }
    const controller = new AbortController();
    const deadlineAt = now.getTime() + this.executionDeadlineMs;
    const timeout = setTimeout(() => controller.abort(), this.executionDeadlineMs);
    const context: GraphEvidenceExecutionContext = {
      signal: controller.signal,
      deadlineAt,
      checkpoint: () => {
        if (controller.signal.aborted || this.now().getTime() >= deadlineAt) {
          controller.abort();
          throw new Error("GRAPH_JOB_EXECUTION_DEADLINE_EXCEEDED");
        }
      },
    };
    try {
      if (job.kind === "backtest") {
        const request = GraphBacktestJobRequestSchema.parse(job.request) as GraphBacktestJobRequest;
        context.checkpoint();
        const run = await this.backtests.run(request, context);
        context.checkpoint();
        const scope = this.profileScopes.backtest(request.profileId);
        const evidence = createGraphEvidenceArtifact({
          kind: "graph_backtest",
          result: run,
          profileScopeRef: { id: scope.id, version: scope.version, fingerprint: scope.fingerprint },
          createdAt: this.now().toISOString(),
        });
        return this.repository.complete(jobId, ownerId, evidence, this.now().toISOString());
      }
      const request = GraphWalkForwardJobRequestSchema.parse(job.request) as GraphWalkForwardJobRequest;
      const workload = this.walkForwards.workload(request);
      if (workload.cycles > this.maxWalkForwardCycles) {
        throw new Error("GRAPH_WORK_BUDGET_EXCEEDED");
      }
      context.checkpoint();
      const run = await this.walkForwards.run(request, context);
      context.checkpoint();
      const scope = this.profileScopes.walkForward(request.profileCandidateSetId);
      const evidence = createGraphEvidenceArtifact({
        kind: "graph_walk_forward",
        result: run,
        profileScopeRef: { id: scope.id, version: scope.version, fingerprint: scope.fingerprint },
        createdAt: this.now().toISOString(),
      });
      return this.repository.complete(jobId, ownerId, evidence, this.now().toISOString());
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 160) : "GRAPH_EVIDENCE_JOB_FAILED";
      try {
        this.repository.fail(jobId, ownerId, code, this.now().toISOString());
      } catch (failure) {
        if (!(failure instanceof GraphEvidenceJobError) || failure.code !== "GRAPH_JOB_LEASE_HELD") throw failure;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
