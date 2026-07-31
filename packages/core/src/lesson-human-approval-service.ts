import { createHash } from "node:crypto";

import {
  ApprovedLessonArtifactSchema,
  LessonCandidateReviewContextSchema,
  LessonHumanApprovalCommandSchema,
  LessonHumanApprovalResponseSchema,
  type LessonCandidateReviewContext,
  type LessonEvidenceGateProjection,
  type LessonHumanApprovalCommand,
  type LessonHumanApprovalResponse,
  type StrategyEvidenceBinding,
} from "../../contracts/src/index.js";
import { graphEvidenceFingerprint } from "./graph-backtest-evidence.js";

export interface LessonHumanApprovalRepository {
  append(
    response: LessonHumanApprovalResponse,
    identity: { actorId: string; idempotencyKey: string },
  ): void;
  findByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): LessonHumanApprovalResponse | undefined;
  findLatestBySelectedTradeId(
    selectedTradeId: string,
  ): LessonHumanApprovalResponse | undefined;
  get(approvalId: string): LessonHumanApprovalResponse;
  listVersions(approvalId: string): readonly LessonHumanApprovalResponse[];
}

export interface LessonApprovalEvidenceGatePort {
  execute(
    command: {
      selectedTradeId: string;
      idempotencyKey: string;
      action: "inspect";
    },
    context: LessonCandidateReviewContext,
  ): Promise<LessonEvidenceGateProjection>;
}

export interface LessonApprovalStrategyEvidencePort {
  findApprovalReadyForConfiguration(configurationVersionId: string): StrategyEvidenceBinding;
}

export class LessonHumanApprovalError extends Error {
  public constructor(
    readonly code:
      | "LESSON_APPROVAL_IDEMPOTENCY_CONFLICT"
      | "LESSON_APPROVAL_ALREADY_DECIDED"
      | "LESSON_APPROVAL_EVIDENCE_NOT_READY"
      | "LESSON_APPROVAL_SCOPE_STALE",
  ) {
    super(code);
    this.name = "LessonHumanApprovalError";
  }
}

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export class LessonHumanApprovalService {
  public constructor(
    private readonly evidenceGate: LessonApprovalEvidenceGatePort,
    private readonly strategyEvidence: LessonApprovalStrategyEvidencePort,
    private readonly repository: LessonHumanApprovalRepository,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly validityMs = 30 * 24 * 60 * 60 * 1_000,
  ) {}

  public inspect(selectedTradeId: string): LessonHumanApprovalResponse | undefined {
    return this.repository.findLatestBySelectedTradeId(selectedTradeId);
  }

  public async decide(
    rawCommand: LessonHumanApprovalCommand,
    rawContext: LessonCandidateReviewContext,
  ): Promise<LessonHumanApprovalResponse> {
    const command = LessonHumanApprovalCommandSchema.parse(rawCommand);
    const context = LessonCandidateReviewContextSchema.parse(rawContext);
    const replay = this.repository.findByIdempotency(
      context.actorId,
      command.idempotencyKey,
    );
    if (replay) {
      if (
        replay.approval.selectedTradeId !== command.selectedTradeId ||
        replay.approval.decision !== command.decision ||
        replay.approval.rationale !== command.rationale
      ) {
        throw new LessonHumanApprovalError(
          "LESSON_APPROVAL_IDEMPOTENCY_CONFLICT",
        );
      }
      return replay;
    }
    if (this.repository.findLatestBySelectedTradeId(command.selectedTradeId)) {
      throw new LessonHumanApprovalError("LESSON_APPROVAL_ALREADY_DECIDED");
    }

    const evidenceGate = await this.evidenceGate.execute(
      {
        selectedTradeId: command.selectedTradeId,
        idempotencyKey: `${command.idempotencyKey}:inspect`,
        action: "inspect",
      },
      context,
    );
    if (
      evidenceGate.lifecycleStatus !== "approval_required" ||
      evidenceGate.backtest.status !== "passed" ||
      evidenceGate.walkForward.status !== "passed" ||
      evidenceGate.approval.status !== "ready" ||
      !evidenceGate.validationBindingRef ||
      !evidenceGate.strategyEvidenceBindingRef ||
      !evidenceGate.backtest.jobId ||
      !evidenceGate.backtest.evidenceFingerprint ||
      !evidenceGate.walkForward.jobId ||
      !evidenceGate.walkForward.evidenceFingerprint
    ) {
      throw new LessonHumanApprovalError("LESSON_APPROVAL_EVIDENCE_NOT_READY");
    }

    let currentEvidence: StrategyEvidenceBinding;
    try {
      currentEvidence = this.strategyEvidence.findApprovalReadyForConfiguration(
        evidenceGate.validationBindingRef.configurationVersionId,
      );
    } catch {
      throw new LessonHumanApprovalError("LESSON_APPROVAL_SCOPE_STALE");
    }
    const evidenceRef = evidenceGate.strategyEvidenceBindingRef;
    if (
      currentEvidence.bindingId !== evidenceRef.bindingId ||
      currentEvidence.versionId !== evidenceRef.versionId ||
      currentEvidence.fingerprint !== evidenceRef.fingerprint ||
      currentEvidence.backtestJob?.jobId !== evidenceGate.backtest.jobId ||
      currentEvidence.backtestJob?.evidenceFingerprint !==
        evidenceGate.backtest.evidenceFingerprint ||
      currentEvidence.walkForwardJob?.jobId !== evidenceGate.walkForward.jobId ||
      currentEvidence.walkForwardJob?.evidenceFingerprint !==
        evidenceGate.walkForward.evidenceFingerprint
    ) {
      throw new LessonHumanApprovalError("LESSON_APPROVAL_SCOPE_STALE");
    }

    const createdAt = this.clock();
    const approvalId = `lesson-approval:${fingerprint({
      selectedTradeId: command.selectedTradeId,
      evidenceGateFingerprint: evidenceGate.fingerprint,
    }).slice(7, 31)}`;
    const lessonId = `approved-lesson:${fingerprint({ approvalId }).slice(7, 31)}`;
    const approvalFingerprint = fingerprint({
      approvalId,
      actorId: context.actorId,
      decision: command.decision,
      rationale: command.rationale,
      evidenceGateFingerprint: evidenceGate.fingerprint,
    });
    const approvedLesson = command.decision === "approve"
      ? ApprovedLessonArtifactSchema.parse({
          schemaVersion: "1.0.0",
          lessonId,
          versionId: `${lessonId}:version:1`,
          versionIndex: 1,
          humanVersion: "1.0.0",
          fingerprint: fingerprint({
            lessonId,
            approvalFingerprint,
            evidenceGateFingerprint: evidenceGate.fingerprint,
          }),
          lifecycleStatus: "approved",
          createdAt,
          sourceTradeId: command.selectedTradeId,
          candidateRef: evidenceGate.validationBindingRef.candidateRef,
          reviewRef: evidenceGate.validationBindingRef.reviewRef,
          comparativeEvidenceRef:
            evidenceGate.validationBindingRef.comparativeEvidenceRef,
          validationBindingRef: {
            id: evidenceGate.validationBindingRef.bindingId,
            versionId: evidenceGate.validationBindingRef.versionId,
            fingerprint: evidenceGate.validationBindingRef.fingerprint,
          },
          strategyEvidenceBindingRef: {
            id: evidenceRef.bindingId,
            versionId: evidenceRef.versionId,
            fingerprint: evidenceRef.fingerprint,
          },
          backtestEvidenceRef: {
            jobId: evidenceGate.backtest.jobId,
            fingerprint: evidenceGate.backtest.evidenceFingerprint,
          },
          walkForwardEvidenceRef: {
            jobId: evidenceGate.walkForward.jobId,
            fingerprint: evidenceGate.walkForward.evidenceFingerprint,
          },
          approvalRef: {
            approvalId,
            actorId: context.actorId,
            fingerprint: approvalFingerprint,
          },
          scope: {
            marketPackRef: evidenceRef.marketPackRef,
            pipelineGraphRef: evidenceGate.validationBindingRef.pipelineGraphRef,
            configurationRef: evidenceRef.configurationRef,
            dataSourceRef: evidenceRef.dataSourceRef,
            datasetRef: evidenceRef.datasetRef,
            backtestProfileRef: evidenceRef.backtestProfileRef,
            walkForwardCandidateSetRef: evidenceRef.walkForwardCandidateSetRef,
            walkForwardPlanRef: evidenceRef.walkForwardPlanRef,
            historicalRange: {
              startAt: evidenceRef.startAt,
              endAt: evidenceRef.endAt,
            },
            applicableRegimes: ["unclassified"],
            validFrom: createdAt,
            expiresAt: new Date(Date.parse(createdAt) + this.validityMs).toISOString(),
            revocationStatus: "active",
          },
          decisionContextMaterializationStatus: "pending",
          decisionContextApplied: false,
          strategyMutationCreated: false,
          runtimeApplied: false,
          exchangeWriteAllowed: false,
        })
      : undefined;
    const withoutApprovalFingerprint = {
      schemaVersion: "1.0.0" as const,
      approvalId,
      versionId: `${approvalId}:version:1`,
      versionIndex: 1 as const,
      humanVersion: "1.0.0" as const,
      createdAt,
      lifecycleStatus: command.decision === "approve"
        ? "approved" as const
        : "rejected" as const,
      selectedTradeId: command.selectedTradeId,
      decision: command.decision,
      rationale: command.rationale,
      approver: context,
      evidenceGateRef: {
        id: evidenceGate.id,
        versionId: evidenceGate.versionId,
        fingerprint: evidenceGate.fingerprint,
        lifecycleStatus: "approval_required" as const,
      },
      ...(approvedLesson
        ? {
            approvedLessonRef: {
              lessonId: approvedLesson.lessonId,
              versionId: approvedLesson.versionId,
              fingerprint: approvedLesson.fingerprint,
            },
          }
        : {}),
      idempotencyKey: command.idempotencyKey,
      decisionContextApplied: false as const,
      strategyMutationCreated: false as const,
      runtimeApplied: false as const,
      exchangeWriteAllowed: false as const,
    };
    const response = LessonHumanApprovalResponseSchema.parse({
      approval: {
        ...withoutApprovalFingerprint,
        fingerprint: graphEvidenceFingerprint(withoutApprovalFingerprint),
      },
      evidenceGate,
      ...(approvedLesson ? { approvedLesson } : {}),
      nextGate: approvedLesson
        ? "decision_context_materialization"
        : "candidate_closed",
      approvedLessonCreated: Boolean(approvedLesson),
      decisionContextApplied: false,
      strategyMutationCreated: false,
      runtimeApplied: false,
      exchangeWriteAllowed: false,
    });
    this.repository.append(response, {
      actorId: context.actorId,
      idempotencyKey: command.idempotencyKey,
    });
    return response;
  }
}
