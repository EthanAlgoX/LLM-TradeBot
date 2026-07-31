import { createHash } from "node:crypto";
import {
  LessonCandidateValidationHandoffRequestSchema,
  LessonCandidateValidationHandoffResponseSchema,
  type LessonCandidateReviewRecord,
  type LessonCandidateContractValidationResult,
  type LessonCandidateValidationBindingReference,
  type LessonCandidateValidationHandoffRequest,
  type LessonCandidateValidationHandoffResponse,
  type PipelineValidationResult,
} from "../../contracts/src/index.js";
import type {
  LessonCandidateReviewHistoryPort,
  ReflectionCandidateReviewCatalogPort,
} from "./comparative-trade-review-service.js";

export interface CurrentComparativeTradeEvidencePort {
  create(selectedTradeId: string): Promise<{
    id: string;
    fingerprint: string;
  }>;
}

export interface LessonCandidateContractValidationFact {
  binding: LessonCandidateValidationBindingReference;
  validation?: PipelineValidationResult;
  contractValidation?: LessonCandidateContractValidationResult;
  scopeCurrent?: boolean;
  validatedAt: string;
}

export interface LessonCandidateContractValidationBindingPort {
  findForAcceptedReview(
    review: LessonCandidateReviewRecord,
  ): Promise<LessonCandidateContractValidationFact | undefined>;
}

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export class LessonCandidateValidationHandoffService {
  public constructor(
    private readonly candidates: ReflectionCandidateReviewCatalogPort,
    private readonly reviews: LessonCandidateReviewHistoryPort,
    private readonly comparativeEvidence: CurrentComparativeTradeEvidencePort,
    private readonly validationBindings?: LessonCandidateContractValidationBindingPort,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  public async inspect(
    rawRequest: LessonCandidateValidationHandoffRequest,
  ): Promise<LessonCandidateValidationHandoffResponse> {
    const request = LessonCandidateValidationHandoffRequestSchema.parse(rawRequest);
    const candidate = await this.candidates.findBySourceTradeId(
      request.selectedTradeId,
    );
    if (!candidate) throw new Error("LESSON_CANDIDATE_NOT_AVAILABLE");
    const page = await this.reviews.listByCandidateId({
      candidateId: candidate.candidateId,
      limit: 20,
    });
    const review = page.records[0];
    const base = {
      schemaVersion: "1.0.0" as const,
      humanVersion: "1.0.0" as const,
      createdAt: this.clock(),
      selectedTradeId: request.selectedTradeId,
      candidateRef: {
        id: candidate.candidateId,
        fingerprint: candidate.fingerprint as `sha256:${string}`,
      },
      readOnly: true as const,
      approvedLessonCreated: false as const,
      strategyMutationCreated: false as const,
      runtimeApplied: false as const,
      exchangeWriteAllowed: false as const,
    };
    if (!review) {
      return this.response(base, {
        lifecycleStatus: "not_reviewed",
        contractValidation: {
          gate: "contract_validation",
          status: "not_started",
          issueCodes: ["LESSON_CANDIDATE_REVIEW_REQUIRED"],
          errorCount: 0,
          warningCount: 0,
        },
        nextGate: "human_review",
      });
    }
    const reviewRef = { id: review.id, fingerprint: review.fingerprint };
    if (review.candidateFingerprint !== candidate.fingerprint) {
      return this.response(base, {
        lifecycleStatus: "stale",
        reviewRef,
        contractValidation: {
          gate: "contract_validation",
          status: "stale",
          issueCodes: ["LESSON_CANDIDATE_FINGERPRINT_CHANGED"],
          errorCount: 1,
          warningCount: 0,
        },
        nextGate: "human_review",
      });
    }
    if (review.lifecycleStatus === "rejected") {
      return this.response(base, {
        lifecycleStatus: "candidate_closed",
        reviewRef,
        contractValidation: {
          gate: "contract_validation",
          status: "closed",
          issueCodes: ["LESSON_CANDIDATE_REJECTED"],
          errorCount: 0,
          warningCount: 0,
        },
        nextGate: "candidate_closed",
      });
    }
    let currentEvidence: { id: string; fingerprint: string };
    try {
      currentEvidence = await this.comparativeEvidence.create(
        request.selectedTradeId,
      );
    } catch {
      return this.response(base, {
        lifecycleStatus: "validation_unavailable",
        reviewRef,
        contractValidation: {
          gate: "contract_validation",
          status: "unavailable",
          issueCodes: ["COMPARATIVE_EVIDENCE_NOT_AVAILABLE"],
          errorCount: 1,
          warningCount: 0,
        },
        nextGate: "contract_validation",
      });
    }
    const comparativeEvidenceRef = {
      id: currentEvidence.id,
      fingerprint: currentEvidence.fingerprint as `sha256:${string}`,
    };
    if (
      review.comparativeEvidenceId !== currentEvidence.id ||
      review.comparativeEvidenceFingerprint !== currentEvidence.fingerprint
    ) {
      return this.response(base, {
        lifecycleStatus: "stale",
        reviewRef,
        comparativeEvidenceRef,
        contractValidation: {
          gate: "contract_validation",
          status: "stale",
          issueCodes: ["COMPARATIVE_EVIDENCE_FINGERPRINT_CHANGED"],
          errorCount: 1,
          warningCount: 0,
        },
        nextGate: "human_review",
      });
    }
    const fact = await this.validationBindings?.findForAcceptedReview(review);
    if (!fact) {
      return this.response(base, {
        lifecycleStatus: "validation_unavailable",
        reviewRef,
        comparativeEvidenceRef,
        contractValidation: {
          gate: "contract_validation",
          status: "unavailable",
          issueCodes: ["VALIDATION_DRAFT_BINDING_NOT_AVAILABLE"],
          errorCount: 0,
          warningCount: 1,
        },
        nextGate: "draft_binding_required",
      });
    }
    const scopeMatches =
      fact.binding.reviewFingerprint === review.fingerprint &&
      fact.binding.candidateFingerprint === candidate.fingerprint &&
      fact.binding.comparativeEvidenceFingerprint === currentEvidence.fingerprint &&
      fact.scopeCurrent !== false &&
      (!fact.validation || (
        fact.binding.pipelineGraphRef.id === fact.validation.pipelineGraphId &&
        fact.binding.pipelineGraphRef.version === fact.validation.graphVersion
      ));
    if (!scopeMatches) {
      return this.response(base, {
        lifecycleStatus: "stale",
        reviewRef,
        comparativeEvidenceRef,
        binding: fact.binding,
        contractValidation: {
          gate: "contract_validation",
          status: "stale",
          issueCodes: ["VALIDATION_BINDING_SCOPE_MISMATCH"],
          errorCount: 1,
          warningCount: 0,
        },
        nextGate: "contract_validation",
      });
    }
    const configurationValid = fact.contractValidation?.configuration.valid ?? true;
    const pipelineValid =
      fact.contractValidation?.pipeline.valid ?? fact.validation?.valid ?? false;
    const issueCodes = fact.contractValidation
      ? [
          ...fact.contractValidation.configuration.issueCodes,
          ...fact.contractValidation.pipeline.issueCodes,
        ]
      : fact.validation?.issues.map((issue) => issue.code) ?? [];
    const valid = configurationValid && pipelineValid;
    return this.response(base, {
      lifecycleStatus: valid
        ? "validation_passed"
        : "validation_failed",
      reviewRef,
      comparativeEvidenceRef,
      binding: fact.binding,
      contractValidation: {
        gate: "contract_validation",
        status: valid ? "passed" : "failed",
        issueCodes,
        errorCount: fact.contractValidation
          ? fact.contractValidation.configuration.issueCodes.length +
            fact.contractValidation.pipeline.errorCount
          : fact.validation?.summary.errorCount ?? 1,
        warningCount: fact.contractValidation?.pipeline.warningCount ??
          fact.validation?.summary.warningCount ?? 0,
        validatedAt: fact.validatedAt,
      },
      nextGate: valid ? "backtest" : "contract_validation",
    });
  }

  private response(
    base: {
      schemaVersion: "1.0.0";
      humanVersion: "1.0.0";
      createdAt: string;
      selectedTradeId: string;
      candidateRef: { id: string; fingerprint: `sha256:${string}` };
      readOnly: true;
      approvedLessonCreated: false;
      strategyMutationCreated: false;
      runtimeApplied: false;
      exchangeWriteAllowed: false;
    },
    state: Omit<
      LessonCandidateValidationHandoffResponse,
      | "schemaVersion"
      | "id"
      | "humanVersion"
      | "fingerprint"
      | "createdAt"
      | "selectedTradeId"
      | "candidateRef"
      | "readOnly"
      | "approvedLessonCreated"
      | "strategyMutationCreated"
      | "runtimeApplied"
      | "exchangeWriteAllowed"
    >,
  ): LessonCandidateValidationHandoffResponse {
    const identity = {
      selectedTradeId: base.selectedTradeId,
      candidateRef: base.candidateRef,
      state,
    };
    const resultFingerprint = fingerprint(identity);
    return LessonCandidateValidationHandoffResponseSchema.parse({
      ...base,
      ...state,
      id: `lesson-validation-handoff:${resultFingerprint.slice(7, 31)}`,
      fingerprint: resultFingerprint,
    });
  }
}
