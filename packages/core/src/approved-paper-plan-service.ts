import { createHash, randomUUID } from "node:crypto";
import {
  ApprovedPaperPlanRequestSchema,
  ApprovedPaperPlanSchema,
  PaperActivationRecordSchema,
  PaperActivationRequestSchema,
  PaperRuntimeControlRequestSchema,
  PaperRuntimeResumeRequestSchema,
  PaperRuntimeControlStateSchema,
  type ApprovedPaperEvidenceRef,
  type ApprovedPaperPlan,
  type OrchestrationActor,
  type PaperActivationRecord,
  type PaperRuntimeControlState,
  type PipelineApprovalAudit,
  type PipelineEvidence,
} from "../../contracts/src/index.js";
import {
  PipelinePromotionStage,
  type PipelineOrchestrationService,
  type StoredPipelineDraft,
} from "./pipeline-orchestration.js";

export interface VerifiedPaperPlanEvidence {
  approval: PipelineApprovalAudit;
  backtest: PipelineEvidence;
  walkForward: PipelineEvidence;
}

export interface ApprovedPaperEvidenceVerifier {
  verify(
    draft: StoredPipelineDraft,
    approvalId: string,
  ): VerifiedPaperPlanEvidence;
}

export interface ApprovedPaperPlanPolicy {
  planVersion: string;
  marketPackRefs: readonly string[];
  paperAccountRef: string;
  candidateSymbols: readonly string[];
  riskPolicyRefs: readonly string[];
  planTtlMs?: number;
}

export interface ApprovedPaperPlanRepository {
  findPlanByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): ApprovedPaperPlan | undefined;
  findPlanByDraftId(draftId: string): ApprovedPaperPlan | undefined;
  savePlan(
    plan: ApprovedPaperPlan,
    actorId: string,
    idempotencyKey: string,
  ): ApprovedPaperPlan;
  getPlan(planId: string): ApprovedPaperPlan;
  findActivationByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): PaperActivationRecord | undefined;
  findActivationByPlanId(planId: string): PaperActivationRecord | undefined;
  findLatestActivation(): PaperActivationRecord | undefined;
  saveActivation(
    activation: PaperActivationRecord,
    actorId: string,
    idempotencyKey: string,
  ): PaperActivationRecord;
  findControlByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimeControlState | undefined;
  getCurrentControl(planId: string): PaperRuntimeControlState | undefined;
  saveControl(
    control: PaperRuntimeControlState,
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimeControlState;
}

export class ApprovedPaperPlanError extends Error {
  constructor(
    readonly code:
      | "PAPER_ACTOR_ROLE_REQUIRED"
      | "PAPER_PLAN_REQUEST_INVALID"
      | "PAPER_PLAN_OUT_OF_ORDER"
      | "PAPER_PLAN_NOT_FOUND"
      | "PAPER_PLAN_CONFLICT"
      | "PAPER_PLAN_EVIDENCE_MISSING"
      | "PAPER_PLAN_EVIDENCE_MISMATCH"
      | "PAPER_PLAN_ARTIFACT_INTEGRITY_FAILED"
      | "PAPER_PLAN_EXPIRED"
      | "PAPER_ACTIVATION_REQUEST_INVALID"
      | "PAPER_PLAN_ALREADY_ACTIVATED"
      | "PAPER_PLAN_NOT_ACTIVATED"
      | "PAPER_CONTROL_REQUEST_INVALID",
    message: string,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "ApprovedPaperPlanError";
  }
}

function requireRole(
  actor: OrchestrationActor,
  role: "operator" | "approver",
): void {
  if (!actor.roles.includes(role)) {
    throw new ApprovedPaperPlanError(
      "PAPER_ACTOR_ROLE_REQUIRED",
      `Actor requires the ${role} role.`,
      { actorId: actor.actorId, role },
    );
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function planFingerprint(plan: Omit<ApprovedPaperPlan, "fingerprint">): string {
  return sha256(plan);
}

function assertPlanIntegrity(plan: ApprovedPaperPlan): void {
  const { fingerprint, ...unsigned } = plan;
  if (planFingerprint(unsigned) !== fingerprint) {
    throw new ApprovedPaperPlanError(
      "PAPER_PLAN_CONFLICT",
      "Approved Paper Plan fingerprint does not match its immutable content.",
      { planId: plan.planId },
    );
  }
}

function evidenceRef<K extends "backtest" | "walk_forward">(
  evidence: PipelineEvidence,
  expectedKind: K,
): Omit<ApprovedPaperEvidenceRef, "kind"> & { kind: K } {
  if (
    evidence.kind !== expectedKind ||
    !evidence.artifactSha256 ||
    !evidence.lineage
  ) {
    throw new ApprovedPaperPlanError(
      "PAPER_PLAN_EVIDENCE_MISSING",
      "Server evidence is missing immutable artifact lineage.",
      { evidenceId: evidence.evidenceId, expectedKind },
    );
  }
  return {
    kind: expectedKind,
    evidenceId: evidence.evidenceId,
    jobId: evidence.jobId,
    artifactId: evidence.lineage.artifactId,
    artifactRef: evidence.artifactRef,
    artifactSha256: evidence.artifactSha256,
    manifestSha256: evidence.lineage.manifestSha256,
    resultSha256: evidence.lineage.resultSha256,
  };
}

function approvalRef(draft: StoredPipelineDraft): string {
  const entry = draft.promotionEvidence.find(
    (candidate) =>
      candidate.stage === PipelinePromotionStage.humanApproved,
  );
  if (!entry) {
    throw new ApprovedPaperPlanError(
      "PAPER_PLAN_EVIDENCE_MISSING",
      "Human approval audit reference is missing.",
      { draftId: draft.draftId },
    );
  }
  return entry.evidenceRef;
}

export class ApprovedPaperPlanService {
  constructor(
    private readonly orchestration: PipelineOrchestrationService,
    private readonly verifier: ApprovedPaperEvidenceVerifier,
    private readonly repository: ApprovedPaperPlanRepository,
    private readonly policy: ApprovedPaperPlanPolicy,
  ) {}

  createPlan(
    draftId: string,
    rawRequest: unknown,
    actor: OrchestrationActor,
  ): ApprovedPaperPlan {
    requireRole(actor, "approver");
    const parsed = ApprovedPaperPlanRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_REQUEST_INVALID",
        "Approved Paper Plan request does not satisfy its contract.",
        { zodIssueCount: String(parsed.error.issues.length) },
      );
    }
    const idempotent = this.repository.findPlanByIdempotency(
      actor.actorId,
      parsed.data.idempotencyKey,
    );
    if (idempotent) {
      return idempotent;
    }
    const existing = this.repository.findPlanByDraftId(draftId);
    if (existing) {
      return existing;
    }
    const draft = this.orchestration.getDraft(draftId);
    if (draft.promotionStage !== PipelinePromotionStage.humanApproved) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_OUT_OF_ORDER",
        "Approved Paper Plan requires a human-approved Graph.",
        { draftId, currentStage: draft.promotionStage },
      );
    }
    const verified = this.verifier.verify(draft, approvalRef(draft));
    if (
      verified.approval.draftId !== draft.draftId ||
      verified.approval.graphId !== draft.graphId ||
      verified.approval.graphFingerprint !== draft.contentFingerprint
    ) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_EVIDENCE_MISMATCH",
        "Approval audit does not match the immutable Graph version.",
        { draftId },
      );
    }
    const backtest = evidenceRef(verified.backtest, "backtest");
    const walkForward = evidenceRef(verified.walkForward, "walk_forward");
    const backtestLineage = verified.backtest.lineage;
    const walkForwardLineage = verified.walkForward.lineage;
    if (
      !backtestLineage ||
      !walkForwardLineage ||
      backtestLineage.strategyProfileRef !==
        walkForwardLineage.strategyProfileRef ||
      backtestLineage.dataSourceRef !== walkForwardLineage.dataSourceRef ||
      backtestLineage.dataFingerprint !== walkForwardLineage.dataFingerprint
    ) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_EVIDENCE_MISMATCH",
        "Backtest and Walk-Forward lineage must bind the same Profile and data.",
        { draftId },
      );
    }
    const compiled = this.orchestration.compileDraft(draftId);
    if (
      compiled.graphId !== draft.graphId ||
      compiled.graphFingerprint !== draft.contentFingerprint ||
      compiled.runtimeApplied !== false
    ) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_EVIDENCE_MISMATCH",
        "Compiled Graph plan does not match the approved draft.",
        { draftId },
      );
    }
    const createdAt = new Date().toISOString();
    const planId = `approved-paper-plan:${randomUUID()}`;
    const unsigned: Omit<ApprovedPaperPlan, "fingerprint"> = {
      schemaVersion: "1.0.0",
      planId,
      planVersion: this.policy.planVersion,
      lifecycleStatus: "approved_ready",
      draftId,
      graphId: draft.graphId,
      graphVersion: draft.humanVersion,
      graphFingerprint: draft.contentFingerprint,
      marketPackRefs: [...this.policy.marketPackRefs],
      dataSourceRef: backtestLineage.dataSourceRef,
      strategyProfileRef: backtestLineage.strategyProfileRef,
      dataFingerprint: backtestLineage.dataFingerprint,
      paperAccountRef: this.policy.paperAccountRef,
      candidateSymbols: [...this.policy.candidateSymbols],
      riskPolicyRefs: [...this.policy.riskPolicyRefs],
      approvalId: verified.approval.approvalId,
      approvedByActorId: verified.approval.actorId,
      evidence: { backtest, walkForward },
      compiledStepCount: compiled.steps.length,
      createdAt,
      ...(this.policy.planTtlMs
        ? {
            expiresAt: new Date(
              Date.parse(createdAt) + this.policy.planTtlMs,
            ).toISOString(),
          }
        : {}),
      createdBy: "tradebot-server",
      runtimeApplied: false,
    };
    const plan = ApprovedPaperPlanSchema.parse({
      ...unsigned,
      fingerprint: planFingerprint(unsigned),
    });
    return this.repository.savePlan(
      plan,
      actor.actorId,
      parsed.data.idempotencyKey,
    );
  }

  getPlan(planId: string): ApprovedPaperPlan {
    const plan = this.repository.getPlan(planId);
    assertPlanIntegrity(plan);
    return plan;
  }

  activate(
    planId: string,
    rawRequest: unknown,
    actor: OrchestrationActor,
  ): PaperActivationRecord {
    requireRole(actor, "approver");
    const parsed = PaperActivationRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new ApprovedPaperPlanError(
        "PAPER_ACTIVATION_REQUEST_INVALID",
        "Paper activation request does not satisfy its contract.",
        { zodIssueCount: String(parsed.error.issues.length) },
      );
    }
    const idempotent = this.repository.findActivationByIdempotency(
      actor.actorId,
      parsed.data.idempotencyKey,
    );
    if (idempotent) {
      return idempotent;
    }
    const existing = this.repository.findActivationByPlanId(planId);
    if (existing) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_ALREADY_ACTIVATED",
        "Paper Plan already has an activation audit.",
        { planId, activationId: existing.activationId },
      );
    }
    const plan = this.getPlan(planId);
    if (plan.expiresAt && Date.parse(plan.expiresAt) <= Date.now()) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_EXPIRED",
        "Approved Paper Plan has expired.",
        { planId, expiresAt: plan.expiresAt },
      );
    }
    const draft = this.orchestration.getDraft(plan.draftId);
    if (draft.promotionStage !== PipelinePromotionStage.humanApproved) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_OUT_OF_ORDER",
        "Activation requires the Graph to remain human approved.",
        { planId, currentStage: draft.promotionStage },
      );
    }
    const verified = this.verifier.verify(draft, plan.approvalId);
    if (
      verified.approval.graphFingerprint !== plan.graphFingerprint ||
      verified.backtest.evidenceId !== plan.evidence.backtest.evidenceId ||
      verified.walkForward.evidenceId !==
        plan.evidence.walkForward.evidenceId
    ) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_EVIDENCE_MISMATCH",
        "Activation evidence no longer matches the Approved Paper Plan.",
        { planId },
      );
    }
    const activation = PaperActivationRecordSchema.parse({
      schemaVersion: "1.0.0",
      activationId: `paper-activation:${randomUUID()}`,
      planId,
      planFingerprint: plan.fingerprint,
      draftId: plan.draftId,
      graphFingerprint: plan.graphFingerprint,
      actorId: actor.actorId,
      actorDisplayName: actor.displayName,
      status: "activated_not_applied",
      activatedAt: new Date().toISOString(),
      runtimeApplied: false,
    });
    return this.repository.saveActivation(
      activation,
      actor.actorId,
      parsed.data.idempotencyKey,
    );
  }

  getActivation(planId: string): PaperActivationRecord {
    const activation = this.repository.findActivationByPlanId(planId);
    if (!activation) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_NOT_ACTIVATED",
        "Paper Plan has no activation audit.",
        { planId },
      );
    }
    return activation;
  }

  findLatestActivatedPlan(): {
    plan: ApprovedPaperPlan;
    activation: PaperActivationRecord;
  } | undefined {
    const activation = this.repository.findLatestActivation();
    if (!activation) return undefined;
    return {
      plan: this.getPlan(activation.planId),
      activation,
    };
  }

  recordCloseOnly(
    planId: string,
    rawRequest: unknown,
    actor: OrchestrationActor,
  ): PaperRuntimeControlState {
    requireRole(actor, "operator");
    const parsed = PaperRuntimeControlRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new ApprovedPaperPlanError(
        "PAPER_CONTROL_REQUEST_INVALID",
        "Runtime control request does not satisfy its contract.",
        { zodIssueCount: String(parsed.error.issues.length) },
      );
    }
    const idempotent = this.repository.findControlByIdempotency(
      actor.actorId,
      parsed.data.idempotencyKey,
    );
    if (idempotent) {
      return idempotent;
    }
    const activation = this.repository.findActivationByPlanId(planId);
    if (!activation) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_NOT_ACTIVATED",
        "Close-only control requires an activated Paper Plan.",
        { planId },
      );
    }
    const control = PaperRuntimeControlStateSchema.parse({
      schemaVersion: "1.0.0",
      controlId: `paper-runtime-control:${randomUUID()}`,
      planId,
      activationId: activation.activationId,
      mode: "pause_new_openings_close_only",
      actorId: actor.actorId,
      actorDisplayName: actor.displayName,
      recordedAt: new Date().toISOString(),
      controlPlaneRecorded: true,
      runtimeApplied: false,
    });
    return this.repository.saveControl(
      control,
      actor.actorId,
      parsed.data.idempotencyKey,
    );
  }

  getCurrentControl(planId: string): PaperRuntimeControlState {
    const control = this.repository.getCurrentControl(planId);
    if (!control) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_NOT_ACTIVATED",
        "Paper Plan has no runtime control audit.",
        { planId },
      );
    }
    return control;
  }

  findCurrentControl(
    planId: string,
  ): PaperRuntimeControlState | undefined {
    return this.repository.getCurrentControl(planId);
  }

  recordNormal(
    planId: string,
    rawRequest: unknown,
    actor: OrchestrationActor,
  ): PaperRuntimeControlState {
    requireRole(actor, "approver");
    const parsed = PaperRuntimeResumeRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new ApprovedPaperPlanError(
        "PAPER_CONTROL_REQUEST_INVALID",
        "Runtime resume request does not satisfy its contract.",
        { zodIssueCount: String(parsed.error.issues.length) },
      );
    }
    const idempotent = this.repository.findControlByIdempotency(
      actor.actorId,
      parsed.data.idempotencyKey,
    );
    if (idempotent) {
      return idempotent;
    }
    const activation = this.repository.findActivationByPlanId(planId);
    if (!activation) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_NOT_ACTIVATED",
        "Normal control requires an activated Paper Plan.",
        { planId },
      );
    }
    const control = PaperRuntimeControlStateSchema.parse({
      schemaVersion: "1.0.0",
      controlId: `paper-runtime-control:${randomUUID()}`,
      planId,
      activationId: activation.activationId,
      mode: "normal",
      actorId: actor.actorId,
      actorDisplayName: actor.displayName,
      recordedAt: new Date().toISOString(),
      controlPlaneRecorded: true,
      runtimeApplied: false,
    });
    return this.repository.saveControl(
      control,
      actor.actorId,
      parsed.data.idempotencyKey,
    );
  }

  assertReadyForRuntime(planId: string): {
    plan: ApprovedPaperPlan;
    activation: PaperActivationRecord;
  } {
    const plan = this.getPlan(planId);
    const activation = this.getActivation(planId);
    if (
      activation.planFingerprint !== plan.fingerprint ||
      activation.graphFingerprint !== plan.graphFingerprint ||
      activation.runtimeApplied !== false
    ) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_EVIDENCE_MISMATCH",
        "Activation audit does not match the immutable Paper Plan.",
        { planId },
      );
    }
    const draft = this.orchestration.getDraft(plan.draftId);
    if (
      draft.promotionStage !== PipelinePromotionStage.humanApproved ||
      draft.contentFingerprint !== plan.graphFingerprint
    ) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_OUT_OF_ORDER",
        "Paper Runtime requires the Graph to remain human approved.",
        { planId, currentStage: draft.promotionStage },
      );
    }
    const verified = this.verifier.verify(draft, plan.approvalId);
    if (
      verified.approval.approvalId !== plan.approvalId ||
      verified.backtest.evidenceId !== plan.evidence.backtest.evidenceId ||
      verified.backtest.artifactSha256 !==
        plan.evidence.backtest.artifactSha256 ||
      verified.walkForward.evidenceId !==
        plan.evidence.walkForward.evidenceId ||
      verified.walkForward.artifactSha256 !==
        plan.evidence.walkForward.artifactSha256
    ) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_EVIDENCE_MISMATCH",
        "Paper Runtime evidence no longer matches the Approved Paper Plan.",
        { planId },
      );
    }
    return { plan, activation };
  }
}
