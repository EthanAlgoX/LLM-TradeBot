import { createHash } from "node:crypto";
import {
  ComparativeTradeEvidenceRequestSchema,
  CreateLessonCandidateValidationBindingCommandSchema,
  LessonEvidenceGateCommandSchema,
  LessonHumanApprovalCommandSchema,
  LessonHumanApprovalInspectionRequestSchema,
  ApprovedLessonMaterializationCommandSchema,
  LessonCandidateValidationHandoffRequestSchema,
  LessonCandidateReviewHistoryRequestSchema,
  LessonCandidateReviewHistoryResponseSchema,
  LessonCandidateReviewCommandSchema,
  ReflectionCandidateInspectionRequestSchema,
  ShadowReplayAuditHistoryRequestSchema,
  ShadowReplayAuditHistoryResponseSchema,
  type ComparativeTradeEvidence,
  type LessonCandidateReviewContext,
} from "../../contracts/src/index.js";
import type {
  LessonCandidateReviewHistoryPort,
  LessonCandidateReviewService,
  ReflectionCandidateReviewCatalogPort,
} from "../../core/src/comparative-trade-review-service.js";
import type {
  LessonCandidateValidationHandoffService,
} from "../../core/src/lesson-candidate-validation-handoff-service.js";
import type {
  LessonCandidateValidationBindingService,
} from "../../core/src/lesson-candidate-validation-binding-service.js";
import {
  LessonEvidenceGateProjectionError,
  type LessonEvidenceGateProjectionService,
} from "../../core/src/lesson-evidence-gate-service.js";
import {
  LessonHumanApprovalError,
  type LessonHumanApprovalService,
} from "../../core/src/lesson-human-approval-service.js";
import type { ApprovedLessonMaterializationService } from "../../core/src/approved-lesson-materialization-service.js";
import type { ShadowReplayAuditHistoryPort } from "./sqlite-shadow-replay-audit-repository.js";

export interface LessonReviewBearerAuthenticator {
  authenticate(authorization: string | null): Promise<LessonCandidateReviewContext>;
}

export interface ComparativeTradeEvidenceCreator {
  create(selectedTradeId: string): Promise<ComparativeTradeEvidence>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function strictJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 16_384) {
    throw new Error("REQUEST_BODY_TOO_LARGE");
  }
  return request.json();
}

export class ComparativeTradeReviewHttpHandler {
  public constructor(
    private readonly comparisons: ComparativeTradeEvidenceCreator,
    private readonly lessonReviews: LessonCandidateReviewService,
    private readonly authenticator: LessonReviewBearerAuthenticator,
    private readonly candidates?: ReflectionCandidateReviewCatalogPort & {
      inspectBySourceTradeId?: (tradeId: string) => Promise<unknown>;
    },
    private readonly reviewHistory?: LessonCandidateReviewHistoryPort,
    private readonly validationHandoff?: LessonCandidateValidationHandoffService,
    private readonly validationBindings?: LessonCandidateValidationBindingService,
    private readonly evidenceGate?: LessonEvidenceGateProjectionService,
    private readonly lessonApprovals?: LessonHumanApprovalService,
    private readonly materializations?: ApprovedLessonMaterializationService,
    private readonly shadowAuditHistory?: ShadowReplayAuditHistoryPort,
  ) {}

  public async handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/api/orchestration/lesson-candidates/materializations/history") {
        await this.authenticator.authenticate(request.headers.get("authorization"));
        const body = ShadowReplayAuditHistoryRequestSchema.parse(await strictJson(request));
        if (!this.shadowAuditHistory) return json(503, { code: "SHADOW_REPLAY_AUDIT_UNAVAILABLE" });
        const page = await this.shadowAuditHistory.listBySelectedTradeId({ selectedTradeId: body.selectedTradeId, ...(body.cursor ? { cursor: body.cursor } : {}), limit: body.limit });
        return json(200, ShadowReplayAuditHistoryResponseSchema.parse({
          schemaVersion: "1.0.0",
          selectedTradeId: body.selectedTradeId,
          lifecycleStatus: page.records.length > 0 ? "available" : "empty",
          records: page.records,
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          readOnly: true,
          decisionContextApplied: false,
          runtimeApplied: false,
          exchangeWriteAllowed: false,
        }));
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/orchestration/lesson-candidates/materializations"
      ) {
        const context = await this.authenticator.authenticate(
          request.headers.get("authorization"),
        );
        const body = ApprovedLessonMaterializationCommandSchema.parse(
          await strictJson(request),
        );
        if (!this.materializations) {
          return json(503, { code: "APPROVED_LESSON_MATERIALIZATION_UNAVAILABLE" });
        }
        return json(200, await this.materializations.materialize(body, context));
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/orchestration/lesson-candidates/approvals/status"
      ) {
        await this.authenticator.authenticate(request.headers.get("authorization"));
        const body = LessonHumanApprovalInspectionRequestSchema.parse(
          await strictJson(request),
        );
        if (!this.lessonApprovals) {
          return json(503, { code: "LESSON_HUMAN_APPROVAL_UNAVAILABLE" });
        }
        const response = this.lessonApprovals.inspect(body.selectedTradeId);
        return response
          ? json(200, response)
          : json(404, { code: "LESSON_HUMAN_APPROVAL_NOT_FOUND" });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/orchestration/lesson-candidates/approvals"
      ) {
        const context = await this.authenticator.authenticate(
          request.headers.get("authorization"),
        );
        const body = LessonHumanApprovalCommandSchema.parse(
          await strictJson(request),
        );
        if (!this.lessonApprovals) {
          return json(503, { code: "LESSON_HUMAN_APPROVAL_UNAVAILABLE" });
        }
        return json(200, await this.lessonApprovals.decide(body, context));
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/orchestration/lesson-candidates/evidence-gates"
      ) {
        const context = await this.authenticator.authenticate(
          request.headers.get("authorization"),
        );
        const body = LessonEvidenceGateCommandSchema.parse(
          await strictJson(request),
        );
        if (!this.evidenceGate) {
          return json(503, { code: "LESSON_EVIDENCE_GATE_UNAVAILABLE" });
        }
        return json(200, await this.evidenceGate.execute(body, context));
      }
      if (
        request.method === "POST" &&
        url.pathname ===
          "/api/orchestration/lesson-candidates/validation-bindings"
      ) {
        const context = await this.authenticator.authenticate(
          request.headers.get("authorization"),
        );
        const body = CreateLessonCandidateValidationBindingCommandSchema.parse(
          await strictJson(request),
        );
        if (!this.validationBindings) {
          return json(503, {
            code: "LESSON_CANDIDATE_VALIDATION_BINDING_UNAVAILABLE",
          });
        }
        return json(200, await this.validationBindings.create(body, context));
      }
      if (
        request.method === "POST" &&
        url.pathname ===
          "/api/orchestration/lesson-candidates/validation-handoff"
      ) {
        await this.authenticator.authenticate(
          request.headers.get("authorization"),
        );
        const body = LessonCandidateValidationHandoffRequestSchema.parse(
          await strictJson(request),
        );
        if (!this.validationHandoff) {
          return json(503, {
            code: "LESSON_CANDIDATE_VALIDATION_HANDOFF_UNAVAILABLE",
          });
        }
        return json(200, await this.validationHandoff.inspect(body));
      }
      if (
        request.method === "POST" &&
        url.pathname ===
          "/api/orchestration/lesson-candidates/reviews/history"
      ) {
        const context = await this.authenticator.authenticate(
          request.headers.get("authorization"),
        );
        const body = LessonCandidateReviewHistoryRequestSchema.parse(
          await strictJson(request),
        );
        if (!this.candidates || !this.reviewHistory) {
          return json(503, {
            code: "LESSON_REVIEW_HISTORY_UNAVAILABLE",
          });
        }
        const candidate = await this.candidates.findBySourceTradeId(
          body.selectedTradeId,
        );
        if (!candidate) {
          return json(404, { code: "LESSON_CANDIDATE_NOT_AVAILABLE" });
        }
        const page = await this.reviewHistory.listByCandidateId({
          candidateId: candidate.candidateId,
          ...(body.cursor ? { cursor: body.cursor } : {}),
          limit: body.limit,
        });
        const identity = {
          selectedTradeId: body.selectedTradeId,
          candidateId: candidate.candidateId,
          recordFingerprints: page.records.map((record) =>
            record.fingerprint),
          nextCursor: page.nextCursor,
        };
        return json(200, LessonCandidateReviewHistoryResponseSchema.parse({
          schemaVersion: "1.0.0",
          id: `lesson-review-history:${candidate.candidateId}`,
          humanVersion: "1.0.0",
          fingerprint: `sha256:${createHash("sha256")
            .update(JSON.stringify(identity))
            .digest("hex")}`,
          createdAt: page.records[0]?.createdAt ?? context.authenticatedAt,
          lifecycleStatus: page.records.length > 0 ? "available" : "empty",
          selectedTradeId: body.selectedTradeId,
          candidateId: candidate.candidateId,
          records: page.records,
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          readOnly: true,
          runtimeApplied: false,
          exchangeWriteAllowed: false,
        }));
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/orchestration/lesson-candidates/inspect"
      ) {
        await this.authenticator.authenticate(request.headers.get("authorization"));
        const body = ReflectionCandidateInspectionRequestSchema.parse(
          await strictJson(request),
        );
        if (!this.candidates?.inspectBySourceTradeId) {
          return json(503, { code: "LESSON_CANDIDATE_INSPECTION_UNAVAILABLE" });
        }
        const candidate = await this.candidates.inspectBySourceTradeId(
          body.selectedTradeId,
        );
        return candidate
          ? json(200, candidate)
          : json(404, { code: "LESSON_CANDIDATE_NOT_AVAILABLE" });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/orchestration/trade-reviews/comparisons"
      ) {
        await this.authenticator.authenticate(request.headers.get("authorization"));
        const body = ComparativeTradeEvidenceRequestSchema.parse(
          await strictJson(request),
        );
        return json(200, await this.comparisons.create(body.selectedTradeId));
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/orchestration/lesson-candidates/reviews"
      ) {
        const context = await this.authenticator.authenticate(
          request.headers.get("authorization"),
        );
        const command = LessonCandidateReviewCommandSchema.parse(
          await strictJson(request),
        );
        return json(200, await this.lessonReviews.review(command, context));
      }
      return json(404, { code: "NOT_FOUND" });
    } catch (error) {
      if (error instanceof LessonEvidenceGateProjectionError) {
        return json(409, { code: error.code });
      }
      if (error instanceof LessonHumanApprovalError) {
        return json(409, { code: error.code });
      }
      const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      const authenticationFailure =
        message === "UNAUTHENTICATED" || message === "FORBIDDEN";
      return json(authenticationFailure ? 401 : 400, {
        code: authenticationFailure ? "UNAUTHENTICATED" : "REQUEST_REJECTED",
      });
    }
  }
}
