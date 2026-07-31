import { createHash } from "node:crypto";

import {
  ApprovedLessonMaterializationCommandSchema,
  ApprovedLessonMaterializationResponseSchema,
  ApprovedReflectionLessonSchema,
  DecisionSemanticContextSchema,
  LessonCandidateReviewContextSchema,
  ReflectionLessonCandidateSchema,
  type ApprovedLessonMaterializationCommand,
  type ApprovedLessonMaterializationResponse,
  type ApprovedReflectionLesson,
  type DecisionSemanticContext,
  type LessonCandidateReviewContext,
  type LessonEvidenceGateProjection,
  type LessonHumanApprovalResponse,
  type ReflectionLessonCandidate,
  type ShadowReplayAuditAppendInput,
  type ShadowReplayAuditRecord,
} from "../../contracts/src/index.js";
import { graphEvidenceFingerprint } from "./graph-backtest-evidence.js";

export interface ApprovedLessonApprovalPort {
  inspect(selectedTradeId: string): LessonHumanApprovalResponse | undefined;
}

export interface ReflectionSemanticLessonCandidatePort {
  findBySourceTradeId(
    selectedTradeId: string,
  ): Promise<ReflectionLessonCandidate | undefined>;
}

export interface MaterializationEvidenceGatePort {
  execute(
    command: {
      selectedTradeId: string;
      idempotencyKey: string;
      action: "inspect";
    },
    context: LessonCandidateReviewContext,
  ): Promise<LessonEvidenceGateProjection>;
}

export interface ShadowDecisionContextBasePort {
  load(
    selectedTradeId: string,
    candidate: ReflectionLessonCandidate,
  ): Promise<Omit<DecisionSemanticContext, "approvedLessons"> | undefined>;
}

export interface ShadowReplayAuditPort {
  append(input: ShadowReplayAuditAppendInput): Promise<ShadowReplayAuditRecord>;
}

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export class ApprovedLessonMaterializationService {
  private readonly replay = new Map<
    string,
    { selectedTradeId: string; response: ApprovedLessonMaterializationResponse }
  >();

  public constructor(
    private readonly approvals: ApprovedLessonApprovalPort,
    private readonly evidenceGate: MaterializationEvidenceGatePort,
    private readonly semanticCandidates: ReflectionSemanticLessonCandidatePort,
    private readonly shadowBase?: ShadowDecisionContextBasePort,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly audit?: ShadowReplayAuditPort,
  ) {}

  public async materialize(
    rawCommand: ApprovedLessonMaterializationCommand,
    rawContext: LessonCandidateReviewContext,
  ): Promise<ApprovedLessonMaterializationResponse> {
    const command = ApprovedLessonMaterializationCommandSchema.parse(rawCommand);
    const context = LessonCandidateReviewContextSchema.parse(rawContext);
    const replayKey = `${context.actorId}:${command.idempotencyKey}`;
    const replay = this.replay.get(replayKey);
    if (replay) {
      if (replay.selectedTradeId !== command.selectedTradeId) {
        throw new Error("APPROVED_LESSON_MATERIALIZATION_IDEMPOTENCY_CONFLICT");
      }
      return replay.response;
    }

    const approval = this.approvals.inspect(command.selectedTradeId);
    if (!approval) {
      return this.unavailable(command, context, "not_approved", [
        "APPROVED_LESSON_NOT_AVAILABLE",
      ]);
    }
    if (
      approval.approval.lifecycleStatus !== "approved" ||
      !approval.approvedLesson
    ) {
      return this.unavailable(command, context, "not_approved", [
        "APPROVED_LESSON_REJECTED",
      ], approval.approval.createdAt);
    }
    const artifact = approval.approvedLesson;
    if (artifact.scope.revocationStatus === "revoked") {
      return this.unavailable(command, context, "revoked", [
        "APPROVED_LESSON_REVOKED",
      ], artifact.createdAt);
    }
    if (Date.parse(artifact.scope.expiresAt) <= Date.parse(this.clock())) {
      return this.unavailable(command, context, "expired", [
        "APPROVED_LESSON_EXPIRED",
      ], artifact.createdAt);
    }

    let currentGate: LessonEvidenceGateProjection;
    try {
      currentGate = await this.evidenceGate.execute(
        {
          selectedTradeId: command.selectedTradeId,
          idempotencyKey: `${command.idempotencyKey}:scope`,
          action: "inspect",
        },
        context,
      );
    } catch {
      return this.unavailable(command, context, "stale", [
        "APPROVED_LESSON_SCOPE_STALE",
      ], artifact.createdAt);
    }
    if (
      currentGate.lifecycleStatus !== "approval_required" ||
      currentGate.fingerprint !== approval.approval.evidenceGateRef.fingerprint ||
      currentGate.validationBindingRef?.fingerprint !==
        artifact.validationBindingRef.fingerprint ||
      currentGate.strategyEvidenceBindingRef?.fingerprint !==
        artifact.strategyEvidenceBindingRef.fingerprint
    ) {
      return this.unavailable(command, context, "stale", [
        "APPROVED_LESSON_SCOPE_STALE",
      ], artifact.createdAt);
    }

    const rawCandidate = await this.semanticCandidates.findBySourceTradeId(
      command.selectedTradeId,
    );
    if (!rawCandidate) {
      return this.unavailable(command, context, "semantic_facts_unavailable", [
        "REFLECTION_SEMANTIC_CANDIDATE_UNAVAILABLE",
      ], artifact.createdAt);
    }
    const candidateResult = ReflectionLessonCandidateSchema.safeParse(rawCandidate);
    if (!candidateResult.success) {
      return this.unavailable(command, context, "semantic_facts_unavailable", [
        "REFLECTION_SEMANTIC_CANDIDATE_UNAVAILABLE",
      ], artifact.createdAt);
    }
    const candidate = candidateResult.data;
    if (
      candidate.id !== artifact.candidateRef.id ||
      candidate.fingerprint !== artifact.candidateRef.fingerprint ||
      candidate.failedTradeRef.tradeId !== command.selectedTradeId ||
      candidate.marketPackRef.id !== artifact.scope.marketPackRef.id ||
      candidate.marketPackRef.fingerprint !== artifact.scope.marketPackRef.fingerprint
    ) {
      return this.unavailable(command, context, "stale", [
        "REFLECTION_SEMANTIC_CANDIDATE_STALE",
      ], artifact.createdAt);
    }

    const lesson = this.approvedLesson(candidate, approval);
    const shadowResult = await this.shadowProjection(command.selectedTradeId, candidate, lesson);
    const shadow = shadowResult.projection;
    const issueCodes = shadowResult.issueCode ? [shadowResult.issueCode] : [];
    const withoutFingerprint = {
      schemaVersion: "1.0.0" as const,
      id: `approved-lesson-materialization:${fingerprint({
        approvalFingerprint: approval.approval.fingerprint,
        candidateFingerprint: candidate.fingerprint,
      }).slice(7, 31)}`,
      versionId: `approved-lesson-materialization:${fingerprint({
        lessonFingerprint: lesson.fingerprint,
      }).slice(7, 31)}:version:1`,
      humanVersion: "1.0.0" as const,
      createdAt: artifact.createdAt,
      lifecycleStatus: "materialized" as const,
      selectedTradeId: command.selectedTradeId,
      approvedLesson: lesson,
      shadowDecisionContext: shadow,
      issueCodes,
      materializedByActorId: context.actorId,
      readOnlyProjection: true as const,
      decisionContextApplied: false as const,
      strategyMutationCreated: false as const,
      runtimeApplied: false as const,
      exchangeWriteAllowed: false as const,
    };
    const response = ApprovedLessonMaterializationResponseSchema.parse({
      ...withoutFingerprint,
      fingerprint: graphEvidenceFingerprint(withoutFingerprint),
    });
    if (
      response.shadowDecisionContext.lifecycleStatus === "validated" &&
      response.shadowDecisionContext.context
    ) {
      await this.audit?.append({
        selectedTradeId: response.selectedTradeId,
        createdAt: response.createdAt,
        actorId: context.actorId,
        idempotencyKey: command.idempotencyKey,
        materializationRef: {
          id: response.id,
          versionId: response.versionId,
          fingerprint: response.fingerprint,
        },
        approvalRef: {
          id: approval.approval.approvalId,
          versionId: approval.approval.versionId,
          fingerprint: approval.approval.fingerprint,
        },
        candidateRef: {
          id: candidate.id,
          fingerprint: candidate.fingerprint,
        },
        approvedLessonRef: {
          id: lesson.id,
          version: lesson.version,
          fingerprint: lesson.fingerprint,
        },
        shadowProjectionRef: {
          id: response.shadowDecisionContext.projectionId,
          versionId: response.shadowDecisionContext.versionId,
          fingerprint: response.shadowDecisionContext.fingerprint,
        },
        decisionContextRef: {
          id: response.shadowDecisionContext.context.id,
          version: response.shadowDecisionContext.context.version,
          fingerprint: response.shadowDecisionContext.context.fingerprint,
        },
        historicalLineageFingerprints: [
          ...new Set(response.shadowDecisionContext.context.lineageFingerprints),
        ],
        lifecycleStatus: "validated",
        readOnly: true,
        decisionContextApplied: false,
        strategyMutationCreated: false,
        runtimeApplied: false,
        exchangeWriteAllowed: false,
      });
    }
    this.replay.set(replayKey, {
      selectedTradeId: command.selectedTradeId,
      response,
    });
    return response;
  }

  private approvedLesson(
    candidate: ReflectionLessonCandidate,
    approval: LessonHumanApprovalResponse,
  ): ApprovedReflectionLesson {
    const approved = approval.approvedLesson!;
    const withoutFingerprint = {
      schemaVersion: "1.0.0" as const,
      id: `semantic-${approved.lessonId}`,
      version: "1.0.0",
      lifecycleStatus: "approved" as const,
      createdAt: approved.createdAt,
      marketPackRef: candidate.marketPackRef,
      schemaRef: {
        schemaId: "tradebot.semantic.approved_reflection_lesson.v1",
        schemaVersion: "1.0.0",
      },
      artifactType: "approved_reflection_lesson" as const,
      candidateRef: {
        artifactId: candidate.id,
        artifactType: "reflection_lesson_candidate",
        fingerprint: candidate.fingerprint,
      },
      approval: {
        approvalId: approval.approval.approvalId,
        approvedBy: approval.approval.approver.actorId,
        approvedAt: approval.approval.createdAt,
      },
      failedTradeRef: candidate.failedTradeRef,
      semanticLesson: candidate.semanticLesson,
      failurePattern: candidate.failurePattern,
      applicableMarketPackIds: candidate.applicableMarketPackIds,
      applicableRegimes: candidate.applicableRegimes,
      confidence: candidate.confidence,
      supportingEvidence: candidate.supportingEvidence,
    };
    return ApprovedReflectionLessonSchema.parse({
      ...withoutFingerprint,
      fingerprint: graphEvidenceFingerprint(withoutFingerprint),
    });
  }

  private async shadowProjection(
    selectedTradeId: string,
    candidate: ReflectionLessonCandidate,
    lesson: ApprovedReflectionLesson,
  ) {
    let context: DecisionSemanticContext | undefined;
    let lifecycleStatus: "unavailable" | "stale" | "validated" = "unavailable";
    let issueCode: ApprovedLessonMaterializationResponse["issueCodes"][number] | undefined = "SHADOW_DECISION_CONTEXT_BASE_UNAVAILABLE";
    if (this.shadowBase) {
      try {
        const base = await this.shadowBase.load(selectedTradeId, candidate);
        if (base) {
          context = DecisionSemanticContextSchema.parse({
            ...base,
            approvedLessons: [lesson],
          });
          lifecycleStatus = "validated";
          issueCode = undefined;
        }
      } catch (error) {
        context = undefined;
        const code = error instanceof Error ? error.message : "";
        if (code === "SHADOW_DECISION_CONTEXT_ARTIFACT_STALE") {
          lifecycleStatus = "stale";
          issueCode = "SHADOW_DECISION_CONTEXT_ARTIFACT_STALE";
        } else if (code === "SHADOW_DECISION_CONTEXT_MARKET_STALE") {
          lifecycleStatus = "stale";
          issueCode = "SHADOW_DECISION_CONTEXT_MARKET_STALE";
        } else {
          issueCode = "SHADOW_DECISION_CONTEXT_FACTS_UNAVAILABLE";
        }
      }
    }
    const projectionId = `shadow-decision-context:${fingerprint({
      selectedTradeId,
      lessonFingerprint: lesson.fingerprint,
    }).slice(7, 31)}`;
    const withoutFingerprint = {
      schemaVersion: "1.0.0" as const,
      projectionId,
      versionId: `${projectionId}:version:1`,
      lifecycleStatus,
      targetSchemaRef: {
        schemaId: "tradebot.semantic.decision_semantic_context.v1" as const,
        schemaVersion: "1.0.0" as const,
      },
      approvedLessonRefs: [{
        id: lesson.id,
        version: lesson.version,
        fingerprint: lesson.fingerprint,
      }],
      ...(context ? { context } : {}),
      decisionContextApplied: false as const,
      runtimeApplied: false as const,
    };
    return {
      projection: {
        ...withoutFingerprint,
        fingerprint: graphEvidenceFingerprint(withoutFingerprint),
      },
      issueCode,
    };
  }

  private unavailable(
    command: ApprovedLessonMaterializationCommand,
    context: LessonCandidateReviewContext,
    lifecycleStatus: Exclude<
      ApprovedLessonMaterializationResponse["lifecycleStatus"],
      "materialized"
    >,
    issueCodes: ApprovedLessonMaterializationResponse["issueCodes"],
    createdAt = "1970-01-01T00:00:00.000Z",
  ): ApprovedLessonMaterializationResponse {
    const projectionId = `shadow-decision-context:${fingerprint({
      selectedTradeId: command.selectedTradeId,
      lifecycleStatus,
    }).slice(7, 31)}`;
    const shadowWithoutFingerprint = {
      schemaVersion: "1.0.0" as const,
      projectionId,
      versionId: `${projectionId}:version:1`,
      lifecycleStatus: "unavailable" as const,
      targetSchemaRef: {
        schemaId: "tradebot.semantic.decision_semantic_context.v1" as const,
        schemaVersion: "1.0.0" as const,
      },
      approvedLessonRefs: [],
      decisionContextApplied: false as const,
      runtimeApplied: false as const,
    };
    const shadowDecisionContext = {
      ...shadowWithoutFingerprint,
      fingerprint: graphEvidenceFingerprint(shadowWithoutFingerprint),
    };
    const withoutFingerprint = {
      schemaVersion: "1.0.0" as const,
      id: `approved-lesson-materialization:${fingerprint({
        selectedTradeId: command.selectedTradeId,
      }).slice(7, 31)}`,
      versionId: `approved-lesson-materialization:${fingerprint({
        selectedTradeId: command.selectedTradeId,
        lifecycleStatus,
      }).slice(7, 31)}:version:1`,
      humanVersion: "1.0.0" as const,
      createdAt,
      lifecycleStatus,
      selectedTradeId: command.selectedTradeId,
      shadowDecisionContext,
      issueCodes,
      materializedByActorId: context.actorId,
      readOnlyProjection: true as const,
      decisionContextApplied: false as const,
      strategyMutationCreated: false as const,
      runtimeApplied: false as const,
      exchangeWriteAllowed: false as const,
    };
    return ApprovedLessonMaterializationResponseSchema.parse({
      ...withoutFingerprint,
      fingerprint: graphEvidenceFingerprint(withoutFingerprint),
    });
  }
}
