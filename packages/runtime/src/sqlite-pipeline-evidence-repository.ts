import { DatabaseSync } from "node:sqlite";
import {
  PipelineApprovalAuditSchema,
  PipelineEvidenceJobSchema,
  type PipelineApprovalAudit,
  type PipelineEvidenceJob,
  type PipelineEvidenceJobKind,
} from "../../contracts/src/index.js";
import {
  PipelineEvidenceWorkflowError,
  type PipelineEvidenceRepository,
} from "../../core/src/pipeline-evidence-workflow.js";

interface JsonRow {
  record_json: string;
}

export class SqlitePipelineEvidenceRepository
  implements PipelineEvidenceRepository
{
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_evidence_jobs (
        job_id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        graph_fingerprint TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pipeline_approval_audits (
        approval_id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        graph_fingerprint TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        approved_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pipeline_evidence_idempotency (
        draft_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        job_id TEXT NOT NULL UNIQUE,
        PRIMARY KEY (draft_id, kind, idempotency_key)
      ) STRICT;
    `);
  }

  createJob(job: PipelineEvidenceJob): PipelineEvidenceJob {
    const parsed = PipelineEvidenceJobSchema.parse(job);
    if (this.findJob(parsed.jobId)) {
      throw new PipelineEvidenceWorkflowError(
        "EVIDENCE_RECORD_CONFLICT",
        "Evidence job ID already exists.",
        { jobId: parsed.jobId },
      );
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
        INSERT INTO pipeline_evidence_jobs (
          job_id,
          draft_id,
          graph_fingerprint,
          kind,
          status,
          record_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          parsed.jobId,
          parsed.draftId,
          parsed.graphFingerprint,
          parsed.kind,
          parsed.status,
          JSON.stringify(parsed),
          parsed.requestedAt,
          parsed.requestedAt,
        );
      if (parsed.request.idempotencyKey) {
        this.database
          .prepare(`
            INSERT INTO pipeline_evidence_idempotency (
              draft_id,
              kind,
              idempotency_key,
              job_id
            ) VALUES (?, ?, ?, ?)
          `)
          .run(
            parsed.draftId,
            parsed.kind,
            parsed.request.idempotencyKey,
            parsed.jobId,
          );
      }
      this.database.exec("COMMIT");
    } catch {
      this.database.exec("ROLLBACK");
      throw new PipelineEvidenceWorkflowError(
        "EVIDENCE_RECORD_CONFLICT",
        "Evidence job or idempotency key already exists.",
        { jobId: parsed.jobId },
      );
    }
    return this.getJob(parsed.jobId);
  }

  replaceJob(job: PipelineEvidenceJob): PipelineEvidenceJob {
    const parsed = PipelineEvidenceJobSchema.parse(job);
    this.getJob(parsed.jobId);
    this.database
      .prepare(`
        UPDATE pipeline_evidence_jobs
        SET status = ?,
            record_json = ?,
            updated_at = ?
        WHERE job_id = ?
      `)
      .run(
        parsed.status,
        JSON.stringify(parsed),
        parsed.completedAt ?? parsed.startedAt ?? parsed.requestedAt,
        parsed.jobId,
      );
    return this.getJob(parsed.jobId);
  }

  getJob(jobId: string): PipelineEvidenceJob {
    const job = this.findJob(jobId);
    if (!job) {
      throw new PipelineEvidenceWorkflowError(
        "EVIDENCE_JOB_NOT_FOUND",
        "Evidence job was not found.",
        { jobId },
      );
    }
    return job;
  }

  findJobByIdempotency(
    draftId: string,
    kind: PipelineEvidenceJobKind,
    idempotencyKey: string,
  ): PipelineEvidenceJob | undefined {
    const row = this.database
      .prepare(`
        SELECT job_id
        FROM pipeline_evidence_idempotency
        WHERE draft_id = ? AND kind = ? AND idempotency_key = ?
      `)
      .get(draftId, kind, idempotencyKey) as unknown as
      | { job_id: string }
      | undefined;
    return row ? this.getJob(row.job_id) : undefined;
  }

  findActiveJob(
    draftId: string,
    kind: PipelineEvidenceJobKind,
  ): PipelineEvidenceJob | undefined {
    const row = this.database
      .prepare(`
        SELECT record_json
        FROM pipeline_evidence_jobs
        WHERE draft_id = ?
          AND kind = ?
          AND status IN ('queued', 'running')
        ORDER BY created_at ASC
        LIMIT 1
      `)
      .get(draftId, kind) as unknown as JsonRow | undefined;
    return row
      ? PipelineEvidenceJobSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  saveApproval(audit: PipelineApprovalAudit): PipelineApprovalAudit {
    const parsed = PipelineApprovalAuditSchema.parse(audit);
    if (this.findApproval(parsed.approvalId)) {
      throw new PipelineEvidenceWorkflowError(
        "EVIDENCE_RECORD_CONFLICT",
        "Approval audit ID already exists.",
        { approvalId: parsed.approvalId },
      );
    }
    this.database
      .prepare(`
        INSERT INTO pipeline_approval_audits (
          approval_id,
          draft_id,
          graph_fingerprint,
          actor_id,
          record_json,
          approved_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        parsed.approvalId,
        parsed.draftId,
        parsed.graphFingerprint,
        parsed.actorId,
        JSON.stringify(parsed),
        parsed.approvedAt,
      );
    return this.getApproval(parsed.approvalId);
  }

  getApproval(approvalId: string): PipelineApprovalAudit {
    const audit = this.findApproval(approvalId);
    if (!audit) {
      throw new PipelineEvidenceWorkflowError(
        "APPROVAL_NOT_FOUND",
        "Approval audit was not found.",
        { approvalId },
      );
    }
    return audit;
  }

  private findJob(jobId: string): PipelineEvidenceJob | undefined {
    const row = this.database
      .prepare(
        "SELECT record_json FROM pipeline_evidence_jobs WHERE job_id = ?",
      )
      .get(jobId) as unknown as JsonRow | undefined;
    return row
      ? PipelineEvidenceJobSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }

  private findApproval(
    approvalId: string,
  ): PipelineApprovalAudit | undefined {
    const row = this.database
      .prepare(
        "SELECT record_json FROM pipeline_approval_audits WHERE approval_id = ?",
      )
      .get(approvalId) as unknown as JsonRow | undefined;
    return row
      ? PipelineApprovalAuditSchema.parse(JSON.parse(row.record_json))
      : undefined;
  }
}
