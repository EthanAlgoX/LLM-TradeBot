import { randomUUID } from "node:crypto";
import {
  HumanApprovalRequestSchema,
  PipelineApprovalAuditSchema,
  PipelineEvidenceJobRequestSchema,
  PipelineEvidenceJobSchema,
  PipelineEvidenceSchema,
  type HumanApprovalRequest,
  type OrchestrationActor,
  type PipelineApprovalAudit,
  type PipelineEvidence,
  type PipelineEvidenceJob,
  type PipelineEvidenceJobKind,
  type PipelineEvidenceJobRequest,
  type PipelineValidationResult,
} from "../../contracts/src/index.js";
import {
  PipelineOrchestrationError,
  PipelinePromotionStage,
  type PipelineOrchestrationService,
  type StoredPipelineDraft,
} from "./pipeline-orchestration.js";

export interface PipelineEvidenceExecutionOutput {
  artifactRef: string;
  artifactSha256?: string;
  lineage?: PipelineEvidence["lineage"];
  metrics: Readonly<Record<string, number>>;
  summary: string;
}

export interface PipelineEvidenceExecutor {
  execute(input: {
    kind: PipelineEvidenceJobKind;
    draft: StoredPipelineDraft;
    request: PipelineEvidenceJobRequest;
    jobId: string;
    requestedByActorId: string;
  }): Promise<PipelineEvidenceExecutionOutput>;
}

export interface PipelineEvidenceRepository {
  createJob(job: PipelineEvidenceJob): PipelineEvidenceJob;
  replaceJob(job: PipelineEvidenceJob): PipelineEvidenceJob;
  getJob(jobId: string): PipelineEvidenceJob;
  findJobByIdempotency(
    draftId: string,
    kind: PipelineEvidenceJobKind,
    idempotencyKey: string,
  ): PipelineEvidenceJob | undefined;
  findActiveJob(
    draftId: string,
    kind: PipelineEvidenceJobKind,
  ): PipelineEvidenceJob | undefined;
  saveApproval(audit: PipelineApprovalAudit): PipelineApprovalAudit;
  getApproval(approvalId: string): PipelineApprovalAudit;
}

export class PipelineEvidenceWorkflowError extends Error {
  constructor(
    readonly code:
      | "ACTOR_ROLE_REQUIRED"
      | "EVIDENCE_JOB_OUT_OF_ORDER"
      | "EVIDENCE_JOB_REQUEST_INVALID"
      | "EVIDENCE_EXECUTION_FAILED"
      | "EVIDENCE_JOB_IN_PROGRESS"
      | "RUNNER_NOT_REGISTERED"
      | "RUNNER_PARAMETER_NOT_ALLOWED"
      | "ARTIFACT_INTEGRITY_FAILED"
      | "EVIDENCE_JOB_NOT_FOUND"
      | "EVIDENCE_RECORD_CONFLICT"
      | "APPROVAL_OUT_OF_ORDER"
      | "APPROVAL_REQUEST_INVALID"
      | "APPROVAL_NOT_FOUND",
    message: string,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "PipelineEvidenceWorkflowError";
  }
}

function requireRole(
  actor: OrchestrationActor,
  role: "operator" | "approver",
): void {
  if (!actor.roles.includes(role)) {
    throw new PipelineEvidenceWorkflowError(
      "ACTOR_ROLE_REQUIRED",
      `Actor requires the ${role} role.`,
      { actorId: actor.actorId, role },
    );
  }
}

function expectedStage(kind: PipelineEvidenceJobKind) {
  return kind === "backtest"
    ? PipelinePromotionStage.contractValidated
    : PipelinePromotionStage.backtested;
}

function promotedStage(kind: PipelineEvidenceJobKind) {
  return kind === "backtest"
    ? PipelinePromotionStage.backtested
    : PipelinePromotionStage.walkForwardValidated;
}

export class PipelineEvidenceWorkflow {
  constructor(
    private readonly orchestration: PipelineOrchestrationService,
    private readonly repository: PipelineEvidenceRepository,
    private readonly executor: PipelineEvidenceExecutor,
  ) {}

  validateContract(
    draftId: string,
    actor: OrchestrationActor,
  ): {
    validation: PipelineValidationResult;
    draft: StoredPipelineDraft;
  } {
    requireRole(actor, "operator");
    const current = this.orchestration.getDraft(draftId);
    const validation = this.orchestration.validateDraft(draftId);
    if (!validation.valid) {
      throw new PipelineOrchestrationError(
        "PIPELINE_VALIDATION_FAILED",
        "Contract validation must pass before promotion.",
        { issueCount: String(validation.issues.length) },
      );
    }
    if (current.promotionStage !== PipelinePromotionStage.draft) {
      return { validation, draft: current };
    }
    const draft = this.orchestration.promote(
      draftId,
      PipelinePromotionStage.contractValidated,
      `contract-validation:${current.contentFingerprint}`,
      new Date().toISOString(),
      actor.actorId,
    );
    return { validation, draft };
  }

  async runEvidenceJob(
    draftId: string,
    kind: PipelineEvidenceJobKind,
    rawRequest: unknown,
    actor: OrchestrationActor,
  ): Promise<PipelineEvidenceJob> {
    requireRole(actor, "operator");
    const parsedRequest = PipelineEvidenceJobRequestSchema.safeParse(rawRequest);
    if (!parsedRequest.success) {
      throw new PipelineEvidenceWorkflowError(
        "EVIDENCE_JOB_REQUEST_INVALID",
        "Evidence job request does not satisfy its contract.",
        { zodIssueCount: String(parsedRequest.error.issues.length) },
      );
    }

    if (parsedRequest.data.idempotencyKey) {
      const existing = this.repository.findJobByIdempotency(
        draftId,
        kind,
        parsedRequest.data.idempotencyKey,
      );
      if (existing) {
        return existing;
      }
    }
    const activeJob = this.repository.findActiveJob(draftId, kind);
    if (activeJob) {
      throw new PipelineEvidenceWorkflowError(
        "EVIDENCE_JOB_IN_PROGRESS",
        "An evidence job of this kind is already active for the draft.",
        { draftId, kind, activeJobId: activeJob.jobId },
      );
    }

    const draft = this.orchestration.getDraft(draftId);
    const requiredStage = expectedStage(kind);
    if (draft.promotionStage !== requiredStage) {
      throw new PipelineEvidenceWorkflowError(
        "EVIDENCE_JOB_OUT_OF_ORDER",
        `Evidence job ${kind} requires stage ${requiredStage}.`,
        {
          draftId,
          currentStage: draft.promotionStage,
          requiredStage,
        },
      );
    }

    const now = new Date().toISOString();
    let job = PipelineEvidenceJobSchema.parse({
      schemaVersion: "1.0.0",
      jobId: `pipeline-job:${randomUUID()}`,
      draftId,
      graphId: draft.graphId,
      graphFingerprint: draft.contentFingerprint,
      kind,
      status: "queued",
      request: parsedRequest.data,
      requestedByActorId: actor.actorId,
      requestedAt: now,
    });
    job = this.repository.createJob(job);
    job = this.repository.replaceJob({
      ...job,
      status: "running",
      startedAt: new Date().toISOString(),
    });

    try {
      const output = await this.executor.execute({
        kind,
        draft,
        request: parsedRequest.data,
        jobId: job.jobId,
        requestedByActorId: actor.actorId,
      });
      const completedAt = new Date().toISOString();
      const evidence = PipelineEvidenceSchema.parse({
        schemaVersion: "1.0.0",
        evidenceId: `pipeline-evidence:${randomUUID()}`,
        jobId: job.jobId,
        draftId,
        graphId: draft.graphId,
        graphFingerprint: draft.contentFingerprint,
        kind,
        artifactRef: output.artifactRef,
        ...(output.artifactSha256
          ? { artifactSha256: output.artifactSha256 }
          : {}),
        ...(output.lineage ? { lineage: output.lineage } : {}),
        metrics: output.metrics,
        summary: output.summary,
        completedAt,
        generatedBy: "tradebot-server",
      });
      job = this.repository.replaceJob({
        ...job,
        status: "succeeded",
        completedAt,
        evidence,
      });
      this.orchestration.promote(
        draftId,
        promotedStage(kind),
        evidence.evidenceId,
        completedAt,
        "system:evidence-runner",
      );
      return job;
    } catch (error) {
      const failureCode =
        error instanceof PipelineEvidenceWorkflowError
          ? error.code
          : "EVIDENCE_EXECUTION_FAILED";
      return this.repository.replaceJob({
        ...job,
        status: "failed",
        completedAt: new Date().toISOString(),
        failureCode,
      });
    }
  }

  approve(
    draftId: string,
    rawRequest: unknown,
    actor: OrchestrationActor,
  ): {
    audit: PipelineApprovalAudit;
    draft: StoredPipelineDraft;
  } {
    requireRole(actor, "approver");
    const parsedRequest = HumanApprovalRequestSchema.safeParse(rawRequest);
    if (!parsedRequest.success) {
      throw new PipelineEvidenceWorkflowError(
        "APPROVAL_REQUEST_INVALID",
        "Human approval request does not satisfy its contract.",
        { zodIssueCount: String(parsedRequest.error.issues.length) },
      );
    }
    const current = this.orchestration.getDraft(draftId);
    if (
      current.promotionStage !== PipelinePromotionStage.walkForwardValidated
    ) {
      throw new PipelineEvidenceWorkflowError(
        "APPROVAL_OUT_OF_ORDER",
        "Human approval requires successful walk-forward evidence.",
        { draftId, currentStage: current.promotionStage },
      );
    }
    const evidenceRefs = current.promotionEvidence
      .filter(
        (entry) =>
          entry.stage === PipelinePromotionStage.backtested ||
          entry.stage === PipelinePromotionStage.walkForwardValidated,
      )
      .map((entry) => entry.evidenceRef);
    const approvedAt = new Date().toISOString();
    const approvalId = `pipeline-approval:${randomUUID()}`;
    const audit = PipelineApprovalAuditSchema.parse({
      schemaVersion: "1.0.0",
      approvalId,
      draftId,
      graphId: current.graphId,
      graphFingerprint: current.contentFingerprint,
      actorId: actor.actorId,
      actorDisplayName: actor.displayName,
      decision: "approve",
      ...(parsedRequest.data.note
        ? { note: parsedRequest.data.note }
        : {}),
      evidenceRefs,
      approvedAt,
    });
    const draft = this.orchestration.promote(
      draftId,
      PipelinePromotionStage.humanApproved,
      approvalId,
      approvedAt,
      actor.actorId,
    );
    return {
      audit: this.repository.saveApproval(audit),
      draft,
    };
  }

  getJob(jobId: string): PipelineEvidenceJob {
    return this.repository.getJob(jobId);
  }

  getApproval(approvalId: string): PipelineApprovalAudit {
    return this.repository.getApproval(approvalId);
  }
}

export class UnavailablePipelineEvidenceExecutor
  implements PipelineEvidenceExecutor
{
  async execute(): Promise<PipelineEvidenceExecutionOutput> {
    throw new PipelineEvidenceWorkflowError(
      "EVIDENCE_EXECUTION_FAILED",
      "No registered evidence executor is configured.",
      { runner: "unavailable" },
    );
  }
}
