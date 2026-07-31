import { createHash } from "node:crypto";
import {
  CreateLessonCandidateValidationBindingCommandSchema,
  LessonCandidateReviewContextSchema,
  LessonCandidateValidationBindingResponseSchema,
  LessonCandidateValidationBindingSchema,
  type ComparativeTradeEvidence,
  type ConfigurationDraftVersion,
  type ConfigurationValidationResult,
  type CreateLessonCandidateValidationBindingCommand,
  type LessonCandidateContractValidationResult,
  type LessonCandidateReviewContext,
  type LessonCandidateReviewRecord,
  type LessonCandidateValidationBinding,
  type LessonCandidateValidationBindingReference,
  type LessonCandidateValidationBindingResponse,
  type PipelineValidationResult,
} from "../../contracts/src/index.js";
import { graphEvidenceFingerprint } from "./graph-backtest-evidence.js";
import type {
  LessonCandidateReviewHistoryPort,
  ReflectionCandidateReviewCatalogPort,
} from "./comparative-trade-review-service.js";
import type {
  LessonCandidateContractValidationBindingPort,
} from "./lesson-candidate-validation-handoff-service.js";

export interface LessonCandidateValidationBindingRepository {
  append(
    binding: LessonCandidateValidationBinding,
    identity: { actorId: string; idempotencyKey: string },
  ): void;
  findByCreationIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): LessonCandidateValidationBinding | undefined;
  findLatestByReviewId(reviewId: string): LessonCandidateValidationBinding | undefined;
  findLatestBySourceTradeId?(
    sourceTradeId: string,
  ): LessonCandidateValidationBinding | undefined;
  get(bindingId: string): LessonCandidateValidationBinding;
  listVersions(bindingId: string): readonly LessonCandidateValidationBinding[];
}

export interface LessonCandidateStrategyConfigurationResolver {
  findLatestStrategyVersionsByPipelineDraftId(
    pipelineDraftId: string,
  ): readonly ConfigurationDraftVersion[];
}

export interface LessonCandidateConfigurationValidationPort {
  get(versionId: string): ConfigurationDraftVersion;
  getLatest(draftId: string): ConfigurationDraftVersion;
  validate(versionId: string): ConfigurationValidationResult;
}

export interface LessonCandidatePipelineValidationPort {
  getDraft(draftId: string): {
    draftId: string;
    graphId: string;
    humanVersion: string;
    graph: {
      pipelineGraphId: string;
      humanReadableVersion: string;
      fingerprint: string;
      marketPackRef: string;
      dataSourceRefs: string[];
    };
  };
  validateDraft(draftId: string): PipelineValidationResult;
}

export interface LessonCandidateBindingComparativeEvidencePort {
  create(selectedTradeId: string): Promise<ComparativeTradeEvidence>;
}

export class LessonCandidateValidationBindingError extends Error {
  public constructor(
    readonly code:
      | "LESSON_VALIDATION_BINDING_IDEMPOTENCY_CONFLICT"
      | "LESSON_VALIDATION_REVIEW_REQUIRED"
      | "LESSON_VALIDATION_REVIEW_REJECTED"
      | "LESSON_VALIDATION_CANDIDATE_STALE"
      | "LESSON_VALIDATION_EVIDENCE_STALE"
      | "LESSON_VALIDATION_PIPELINE_NOT_AVAILABLE"
      | "LESSON_VALIDATION_PIPELINE_SCOPE_MISMATCH"
      | "LESSON_VALIDATION_CONFIGURATION_NOT_AVAILABLE"
      | "LESSON_VALIDATION_CONFIGURATION_AMBIGUOUS"
      | "LESSON_VALIDATION_CONFIGURATION_SCOPE_MISMATCH",
  ) {
    super(code);
    this.name = "LessonCandidateValidationBindingError";
  }
}

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function bindingReference(
  binding: LessonCandidateValidationBinding,
): LessonCandidateValidationBindingReference {
  return {
    bindingVersionRef: {
      bindingId: binding.bindingId,
      versionId: binding.versionId,
      versionIndex: binding.versionIndex,
      ...(binding.parentFingerprint
        ? { parentFingerprint: binding.parentFingerprint }
        : {}),
      fingerprint: binding.fingerprint,
      lifecycleStatus: binding.lifecycleStatus,
    },
    reviewFingerprint: binding.reviewRef.fingerprint,
    candidateFingerprint: binding.candidateRef.fingerprint,
    comparativeEvidenceFingerprint: binding.comparativeEvidenceRef.fingerprint,
    configurationRef: binding.configurationRef,
    pipelineGraphRef: binding.pipelineGraphRef,
  };
}

function validationProjection(input: {
  configuration: ConfigurationValidationResult;
  pipeline: PipelineValidationResult;
  graphFingerprint: string;
}): LessonCandidateContractValidationResult {
  return {
    configuration: {
      valid: input.configuration.valid,
      checkedFingerprint: input.configuration.checkedFingerprint,
      issueCodes: input.configuration.issues.map((issue) => issue.code),
    },
    pipeline: {
      valid: input.pipeline.valid,
      checkedFingerprint: input.graphFingerprint as `sha256:${string}`,
      issueCodes: input.pipeline.issues.map((issue) => issue.code),
      errorCount: input.pipeline.summary.errorCount,
      warningCount: input.pipeline.summary.warningCount,
    },
    valid: input.configuration.valid && input.pipeline.valid,
  };
}

export class LessonCandidateValidationBindingService
  implements LessonCandidateContractValidationBindingPort
{
  public constructor(
    private readonly candidates: ReflectionCandidateReviewCatalogPort,
    private readonly reviews: LessonCandidateReviewHistoryPort,
    private readonly comparativeEvidence: LessonCandidateBindingComparativeEvidencePort,
    private readonly configurations: LessonCandidateConfigurationValidationPort,
    private readonly configurationResolver: LessonCandidateStrategyConfigurationResolver,
    private readonly pipelines: LessonCandidatePipelineValidationPort,
    private readonly repository: LessonCandidateValidationBindingRepository,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  public async create(
    rawCommand: CreateLessonCandidateValidationBindingCommand,
    rawContext: LessonCandidateReviewContext,
  ): Promise<LessonCandidateValidationBindingResponse> {
    const command = CreateLessonCandidateValidationBindingCommandSchema.parse(rawCommand);
    const context = LessonCandidateReviewContextSchema.parse(rawContext);
    const replay = this.repository.findByCreationIdempotency(
      context.actorId,
      command.idempotencyKey,
    );
    if (replay) {
      if (replay.sourceTradeId !== command.selectedTradeId) {
        throw new LessonCandidateValidationBindingError(
          "LESSON_VALIDATION_BINDING_IDEMPOTENCY_CONFLICT",
        );
      }
      return this.response(replay);
    }

    const resolved = await this.resolve(command.selectedTradeId);
    const prior = this.repository.findLatestByReviewId(resolved.review.id);
    if (
      prior &&
      prior.candidateRef.fingerprint === resolved.candidate.fingerprint &&
      prior.comparativeEvidenceRef.fingerprint === resolved.evidence.fingerprint &&
      prior.configurationRef.versionFingerprint === resolved.configuration.fingerprint &&
      prior.pipelineGraphRef.fingerprint === resolved.pipeline.graph.fingerprint
    ) {
      return this.response(prior);
    }

    const configurationValidation = this.configurations.validate(
      resolved.configuration.versionId,
    );
    const pipelineValidation = this.pipelines.validateDraft(
      resolved.pipeline.draftId,
    );
    const contractValidation = validationProjection({
      configuration: configurationValidation,
      pipeline: pipelineValidation,
      graphFingerprint: resolved.pipeline.graph.fingerprint,
    });
    const versionIndex = (prior?.versionIndex ?? 0) + 1;
    const createdAt = this.clock();
    const bindingId = `lesson-validation-binding:${fingerprint({
      reviewFingerprint: resolved.review.fingerprint,
    }).slice(7, 31)}`;
    const withoutFingerprint = {
      schemaVersion: "1.0.0" as const,
      bindingId,
      versionId: `${bindingId}:version:${versionIndex}`,
      versionIndex,
      ...(prior ? { parentFingerprint: prior.fingerprint } : {}),
      humanVersion: "1.0.0" as const,
      createdAt,
      createdByActorId: context.actorId,
      lifecycleStatus: contractValidation.valid
        ? "validation_passed" as const
        : "validation_failed" as const,
      sourceTradeId: command.selectedTradeId,
      candidateRef: {
        id: resolved.candidate.candidateId,
        fingerprint: resolved.candidate.fingerprint as `sha256:${string}`,
      },
      reviewRef: {
        id: resolved.review.id,
        fingerprint: resolved.review.fingerprint,
      },
      comparativeEvidenceRef: {
        id: resolved.evidence.id,
        fingerprint: resolved.evidence.fingerprint,
      },
      configurationRef: {
        draftId: resolved.configuration.draftId,
        versionId: resolved.configuration.versionId,
        versionFingerprint: resolved.configuration.fingerprint,
        payloadFingerprint: graphEvidenceFingerprint(resolved.configuration.payload),
      },
      pipelineGraphRef: resolved.evidence.selectedTrade.pipelineGraphRef,
      contractValidation,
      readOnly: true as const,
      approvedLessonCreated: false as const,
      strategyMutationCreated: false as const,
      runtimeApplied: false as const,
      exchangeWriteAllowed: false as const,
    };
    const binding = LessonCandidateValidationBindingSchema.parse({
      ...withoutFingerprint,
      fingerprint: fingerprint(withoutFingerprint),
    });
    this.repository.append(binding, {
      actorId: context.actorId,
      idempotencyKey: command.idempotencyKey,
    });
    return this.response(binding);
  }

  public async findForAcceptedReview(review: LessonCandidateReviewRecord) {
    const binding = this.repository.findLatestByReviewId(review.id);
    if (!binding) return undefined;
    let scopeCurrent = true;
    try {
      const configuration = this.configurations.get(binding.configurationRef.versionId);
      const latest = this.configurations.getLatest(configuration.draftId);
      const pipelineDraftId = configuration.payload.kind === "strategy"
        ? configuration.payload.pipelineDraftId
        : "";
      const pipeline = this.pipelines.getDraft(pipelineDraftId);
      scopeCurrent =
        latest.fingerprint === binding.configurationRef.versionFingerprint &&
        configuration.fingerprint === binding.configurationRef.versionFingerprint &&
        graphEvidenceFingerprint(configuration.payload) ===
          binding.configurationRef.payloadFingerprint &&
        pipeline.graph.pipelineGraphId === binding.pipelineGraphRef.id &&
        pipeline.graph.humanReadableVersion === binding.pipelineGraphRef.version &&
        pipeline.graph.fingerprint === binding.pipelineGraphRef.fingerprint;
    } catch {
      scopeCurrent = false;
    }
    return {
      binding: bindingReference(binding),
      contractValidation: binding.contractValidation,
      scopeCurrent,
      validatedAt: binding.createdAt,
    };
  }

  public async resolveEvidenceEligibility(selectedTradeId: string) {
    const binding = this.repository.findLatestBySourceTradeId?.(selectedTradeId);
    if (!binding) return { status: "missing" as const };
    if (binding.lifecycleStatus !== "validation_passed") {
      return { status: "not_passed" as const, binding };
    }
    try {
      const resolved = await this.resolve(selectedTradeId);
      const current =
        binding.reviewRef.id === resolved.review.id &&
        binding.reviewRef.fingerprint === resolved.review.fingerprint &&
        binding.candidateRef.id === resolved.candidate.candidateId &&
        binding.candidateRef.fingerprint === resolved.candidate.fingerprint &&
        binding.comparativeEvidenceRef.id === resolved.evidence.id &&
        binding.comparativeEvidenceRef.fingerprint === resolved.evidence.fingerprint &&
        binding.configurationRef.versionId === resolved.configuration.versionId &&
        binding.configurationRef.versionFingerprint === resolved.configuration.fingerprint &&
        binding.configurationRef.payloadFingerprint ===
          graphEvidenceFingerprint(resolved.configuration.payload) &&
        binding.pipelineGraphRef.id === resolved.pipeline.graph.pipelineGraphId &&
        binding.pipelineGraphRef.version ===
          resolved.pipeline.graph.humanReadableVersion &&
        binding.pipelineGraphRef.fingerprint === resolved.pipeline.graph.fingerprint;
      return current
        ? { status: "current" as const, binding }
        : { status: "stale" as const, binding };
    } catch {
      return { status: "stale" as const, binding };
    }
  }

  private async resolve(selectedTradeId: string) {
    const candidate = await this.candidates.findBySourceTradeId(selectedTradeId);
    if (!candidate) {
      throw new LessonCandidateValidationBindingError(
        "LESSON_VALIDATION_REVIEW_REQUIRED",
      );
    }
    const history = await this.reviews.listByCandidateId({
      candidateId: candidate.candidateId,
      limit: 20,
    });
    const review = history.records[0];
    if (!review) {
      throw new LessonCandidateValidationBindingError(
        "LESSON_VALIDATION_REVIEW_REQUIRED",
      );
    }
    if (review.lifecycleStatus !== "accepted_for_validation") {
      throw new LessonCandidateValidationBindingError(
        "LESSON_VALIDATION_REVIEW_REJECTED",
      );
    }
    if (review.candidateFingerprint !== candidate.fingerprint) {
      throw new LessonCandidateValidationBindingError(
        "LESSON_VALIDATION_CANDIDATE_STALE",
      );
    }
    const evidence = await this.comparativeEvidence.create(selectedTradeId);
    if (
      evidence.id !== review.comparativeEvidenceId ||
      evidence.fingerprint !== review.comparativeEvidenceFingerprint
    ) {
      throw new LessonCandidateValidationBindingError(
        "LESSON_VALIDATION_EVIDENCE_STALE",
      );
    }
    const graphRef = evidence.selectedTrade.pipelineGraphRef;
    const pipelineDraftId = `${graphRef.id}@${graphRef.version}`;
    let pipeline: ReturnType<LessonCandidatePipelineValidationPort["getDraft"]>;
    try {
      pipeline = this.pipelines.getDraft(pipelineDraftId);
    } catch {
      throw new LessonCandidateValidationBindingError(
        "LESSON_VALIDATION_PIPELINE_NOT_AVAILABLE",
      );
    }
    if (
      pipeline.graph.pipelineGraphId !== graphRef.id ||
      pipeline.graph.humanReadableVersion !== graphRef.version ||
      pipeline.graph.fingerprint !== graphRef.fingerprint
    ) {
      throw new LessonCandidateValidationBindingError(
        "LESSON_VALIDATION_PIPELINE_SCOPE_MISMATCH",
      );
    }
    const matching = this.configurationResolver
      .findLatestStrategyVersionsByPipelineDraftId(pipelineDraftId);
    if (matching.length === 0) {
      throw new LessonCandidateValidationBindingError(
        "LESSON_VALIDATION_CONFIGURATION_NOT_AVAILABLE",
      );
    }
    if (matching.length !== 1) {
      throw new LessonCandidateValidationBindingError(
        "LESSON_VALIDATION_CONFIGURATION_AMBIGUOUS",
      );
    }
    const configuration = matching[0]!;
    if (
      configuration.payload.kind !== "strategy" ||
      configuration.payload.pipelineDraftId !== pipelineDraftId ||
      configuration.payload.marketPackId !== evidence.selectedTrade.marketPackRef.id ||
      pipeline.graph.marketPackRef !== evidence.selectedTrade.marketPackRef.id ||
      !pipeline.graph.dataSourceRefs.includes(evidence.selectedTrade.dataSourceRef.id)
    ) {
      throw new LessonCandidateValidationBindingError(
        "LESSON_VALIDATION_CONFIGURATION_SCOPE_MISMATCH",
      );
    }
    return { candidate, review, evidence, pipeline, configuration };
  }

  private response(
    binding: LessonCandidateValidationBinding,
  ): LessonCandidateValidationBindingResponse {
    return LessonCandidateValidationBindingResponseSchema.parse({
      binding,
      nextGate: binding.contractValidation.valid
        ? "backtest"
        : "contract_validation",
      approvedLessonCreated: false,
      strategyMutationCreated: false,
      runtimeApplied: false,
      exchangeWriteAllowed: false,
    });
  }
}
