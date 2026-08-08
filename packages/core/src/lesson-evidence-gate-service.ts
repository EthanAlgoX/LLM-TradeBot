import { createHash } from "node:crypto";

import {
  LessonEvidenceGateCommandSchema,
  LessonEvidenceGateProjectionSchema,
  type LessonCandidateReviewContext,
  type LessonCandidateValidationBinding,
  type LessonEvidenceGateCommand,
  type LessonEvidenceGateIssueCode,
  type LessonEvidenceGateProjection,
  type OrchestrationActor,
  type StrategyEvidenceBinding,
} from "../../contracts/src/index.js";
import { graphEvidenceFingerprint } from "./graph-backtest-evidence.js";
import {
  StrategyEvidenceApprovalError,
  type StrategyEvidenceApprovalService,
} from "./strategy-evidence-approval-service.js";

export type LessonEvidenceValidationEligibility =
  | { status: "missing" }
  | { status: "not_passed"; binding: LessonCandidateValidationBinding }
  | { status: "stale"; binding: LessonCandidateValidationBinding }
  | { status: "current"; binding: LessonCandidateValidationBinding };

export interface LessonEvidenceValidationBindingPort {
  resolveEvidenceEligibility(
    selectedTradeId: string,
  ): Promise<LessonEvidenceValidationEligibility>;
}

export interface LessonEvidenceScope {
  datasetId: string;
  backtestProfileId: string;
  walkForwardCandidateSetId: string;
  walkForwardPlanId: string;
  startAt: string;
  endAt: string;
}

export interface LessonEvidenceScopeResolver {
  resolve(configurationVersionId: string): readonly LessonEvidenceScope[];
}

export type LessonStrategyEvidencePort = Pick<
  StrategyEvidenceApprovalService,
  | "createBinding"
  | "findCurrentForConfiguration"
  | "runBacktest"
  | "runWalkForward"
>;

export class LessonEvidenceGateProjectionError extends Error {
  public constructor(
    readonly code:
      | "LESSON_EVIDENCE_VALIDATION_NOT_PASSED"
      | "LESSON_EVIDENCE_BACKTEST_REQUIRED"
      | "LESSON_EVIDENCE_ACTION_NOT_ALLOWED",
  ) {
    super(code);
    this.name = "LessonEvidenceGateProjectionError";
  }
}

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function validationRef(binding: LessonCandidateValidationBinding) {
  return {
    bindingId: binding.bindingId,
    versionId: binding.versionId,
    versionIndex: binding.versionIndex,
    fingerprint: binding.fingerprint,
    lifecycleStatus: "validation_passed" as const,
    configurationVersionId: binding.configurationRef.versionId,
    configurationFingerprint: binding.configurationRef.versionFingerprint,
    pipelineGraphRef: binding.pipelineGraphRef,
    candidateRef: binding.candidateRef,
    reviewRef: binding.reviewRef,
    comparativeEvidenceRef: binding.comparativeEvidenceRef,
  };
}

function evidenceRef(binding: StrategyEvidenceBinding) {
  return {
    bindingId: binding.bindingId,
    versionId: binding.versionId,
    versionIndex: binding.versionIndex,
    fingerprint: binding.fingerprint,
    lifecycleStatus: binding.lifecycleStatus,
    configurationRef: {
      versionId: binding.configurationRef.versionId,
      versionFingerprint: binding.configurationRef.versionFingerprint,
      payloadFingerprint: binding.configurationRef.payloadFingerprint,
    },
    datasetRef: binding.datasetRef,
    backtestProfileRef: binding.backtestProfileRef,
    walkForwardCandidateSetRef: binding.walkForwardCandidateSetRef,
    walkForwardPlanRef: binding.walkForwardPlanRef,
    marketPackRef: binding.marketPackRef,
    dataSourceRef: binding.dataSourceRef,
    startAt: binding.startAt,
    endAt: binding.endAt,
  };
}

export class LessonEvidenceGateProjectionService {
  public constructor(
    private readonly validationBindings: LessonEvidenceValidationBindingPort,
    private readonly strategyEvidence: LessonStrategyEvidencePort,
    private readonly scopes: LessonEvidenceScopeResolver,
    private readonly deriveActor: (
      context: LessonCandidateReviewContext,
    ) => OrchestrationActor,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  public async execute(
    rawCommand: LessonEvidenceGateCommand,
    context: LessonCandidateReviewContext,
  ): Promise<LessonEvidenceGateProjection> {
    const command = LessonEvidenceGateCommandSchema.parse(rawCommand);
    const eligibility = await this.validationBindings.resolveEvidenceEligibility(
      command.selectedTradeId,
    );
    if (eligibility.status === "missing") {
      return this.project(command.selectedTradeId, {
        lifecycleStatus: "binding_required",
        issueCodes: ["LESSON_EVIDENCE_VALIDATION_BINDING_REQUIRED"],
        createdAt: this.clock(),
      });
    }
    if (eligibility.status === "not_passed") {
      throw new LessonEvidenceGateProjectionError(
        "LESSON_EVIDENCE_VALIDATION_NOT_PASSED",
      );
    }
    if (eligibility.status === "stale") {
      return this.project(command.selectedTradeId, {
        lifecycleStatus: "stale",
        issueCodes: ["LESSON_EVIDENCE_SCOPE_STALE"],
        validationBinding: eligibility.binding,
        createdAt: eligibility.binding.createdAt,
      });
    }

    const validationBinding = eligibility.binding;
    const actor = this.deriveActor(context);
    let binding: StrategyEvidenceBinding | undefined;
    try {
      binding = this.strategyEvidence.findCurrentForConfiguration(
        validationBinding.configurationRef.versionId,
      );
    } catch (error) {
      if (
        error instanceof StrategyEvidenceApprovalError &&
        (error.code === "STRATEGY_CONFIGURATION_CHANGED" ||
          error.code === "STRATEGY_EVIDENCE_SCOPE_CHANGED")
      ) {
        return this.project(command.selectedTradeId, {
          lifecycleStatus: "stale",
          issueCodes: ["LESSON_EVIDENCE_SCOPE_STALE"],
          validationBinding,
          createdAt: validationBinding.createdAt,
        });
      }
      throw error;
    }

    if (!binding) {
      const matches = this.scopes.resolve(
        validationBinding.configurationRef.versionId,
      );
      if (matches.length !== 1) {
        return this.project(command.selectedTradeId, {
          lifecycleStatus: "evidence_unavailable",
          issueCodes: [
            matches.length === 0
              ? "LESSON_EVIDENCE_SCOPE_UNAVAILABLE"
              : "LESSON_EVIDENCE_SCOPE_AMBIGUOUS",
          ],
          validationBinding,
          createdAt: validationBinding.createdAt,
        });
      }
      const scope = matches[0]!;
      try {
        binding = this.strategyEvidence.createBinding(
          {
            schemaVersion: "1.0.0",
            strategyConfigurationVersionId:
              validationBinding.configurationRef.versionId,
            ...scope,
            idempotencyKey: `${command.idempotencyKey}:binding`,
          },
          actor,
        );
      } catch (error) {
        if (
          error instanceof StrategyEvidenceApprovalError &&
          (error.code === "STRATEGY_CONFIGURATION_CHANGED" ||
            error.code === "STRATEGY_EVIDENCE_SCOPE_CHANGED")
        ) {
          return this.project(command.selectedTradeId, {
            lifecycleStatus: "stale",
            issueCodes: ["LESSON_EVIDENCE_SCOPE_STALE"],
            validationBinding,
            createdAt: validationBinding.createdAt,
          });
        }
        if (
          error instanceof StrategyEvidenceApprovalError &&
          (error.code === "STRATEGY_EVIDENCE_SCOPE_INVALID" ||
            error.code === "STRATEGY_CONFIGURATION_INVALID" ||
            error.code === "STRATEGY_CONFIGURATION_REQUIRED")
        ) {
          return this.project(command.selectedTradeId, {
            lifecycleStatus: "evidence_unavailable",
            issueCodes: ["LESSON_EVIDENCE_SCOPE_UNAVAILABLE"],
            validationBinding,
            createdAt: validationBinding.createdAt,
          });
        }
        throw error;
      }
    }

    if (
      binding.configurationRef.versionId !==
        validationBinding.configurationRef.versionId ||
      binding.configurationRef.versionFingerprint !==
        validationBinding.configurationRef.versionFingerprint ||
      binding.configurationRef.payloadFingerprint !==
        validationBinding.configurationRef.payloadFingerprint ||
      binding.compiledGraphRef.id !== validationBinding.pipelineGraphRef.id ||
      binding.compiledGraphRef.version !==
        validationBinding.pipelineGraphRef.version ||
      binding.compiledGraphRef.fingerprint !==
        validationBinding.pipelineGraphRef.fingerprint
    ) {
      return this.project(command.selectedTradeId, {
        lifecycleStatus: "stale",
        issueCodes: ["LESSON_EVIDENCE_SCOPE_STALE"],
        validationBinding,
        evidenceBinding: binding,
        createdAt: binding.updatedAt,
      });
    }

    if (command.action === "run_backtest" && !binding.backtestJob) {
      binding = await this.strategyEvidence.runBacktest(
        binding.bindingId,
        {
          schemaVersion: "1.0.0",
          idempotencyKey: `${command.idempotencyKey}:backtest`,
        },
        actor,
      );
    } else if (command.action === "run_walk_forward") {
      if (!binding.backtestJob) {
        throw new LessonEvidenceGateProjectionError(
          "LESSON_EVIDENCE_BACKTEST_REQUIRED",
        );
      }
      if (!binding.walkForwardJob) {
        binding = await this.strategyEvidence.runWalkForward(
          binding.bindingId,
          {
            schemaVersion: "1.0.0",
            idempotencyKey: `${command.idempotencyKey}:walk-forward`,
          },
          actor,
        );
      }
    }

    return this.project(command.selectedTradeId, {
      validationBinding,
      evidenceBinding: binding,
      createdAt: binding.updatedAt,
    });
  }

  private project(
    selectedTradeId: string,
    input: {
      lifecycleStatus?: LessonEvidenceGateProjection["lifecycleStatus"];
      issueCodes?: LessonEvidenceGateIssueCode[];
      validationBinding?: LessonCandidateValidationBinding;
      evidenceBinding?: StrategyEvidenceBinding;
      createdAt: string;
    },
  ): LessonEvidenceGateProjection {
    const binding = input.evidenceBinding;
    const lifecycleStatus = input.lifecycleStatus ?? (
      binding?.backtestJob && binding.walkForwardJob
        ? "approval_required"
        : binding?.backtestJob
          ? "walk_forward_required"
          : "backtest_required"
    );
    const projectionId = `lesson-evidence-gate:${fingerprint({ selectedTradeId }).slice(7, 31)}`;
    const versionSeed = binding?.versionId ?? input.validationBinding?.versionId ?? lifecycleStatus;
    const withoutFingerprint = {
      schemaVersion: "1.0.0" as const,
      id: projectionId,
      versionId: `${projectionId}:version:${fingerprint(versionSeed).slice(7, 19)}`,
      humanVersion: "1.0.0" as const,
      createdAt: input.createdAt,
      lifecycleStatus,
      selectedTradeId,
      ...(input.validationBinding && input.validationBinding.lifecycleStatus === "validation_passed"
        ? { validationBindingRef: validationRef(input.validationBinding) }
        : {}),
      ...(binding ? { strategyEvidenceBindingRef: evidenceRef(binding) } : {}),
      backtest: {
        gate: "backtest" as const,
        status: lifecycleStatus === "stale"
          ? "stale" as const
          : lifecycleStatus === "evidence_unavailable"
            ? "unavailable" as const
            : binding?.backtestJob?.status === "succeeded"
              ? "passed" as const
              : lifecycleStatus === "binding_required"
                ? "blocked" as const
                : "required" as const,
        ...(binding?.backtestJob?.status === "succeeded"
          ? {
              jobId: binding.backtestJob.jobId,
              evidenceFingerprint: binding.backtestJob.evidenceFingerprint,
            }
          : {}),
      },
      walkForward: {
        gate: "walk_forward" as const,
        status: lifecycleStatus === "stale"
          ? "stale" as const
          : lifecycleStatus === "evidence_unavailable"
            ? "unavailable" as const
            : binding?.walkForwardJob?.status === "succeeded"
              ? "passed" as const
            : binding?.backtestJob?.status === "succeeded"
                ? "required" as const
                : "blocked" as const,
        ...(binding?.walkForwardJob?.status === "succeeded"
          ? {
              jobId: binding.walkForwardJob.jobId,
              evidenceFingerprint: binding.walkForwardJob.evidenceFingerprint,
            }
          : {}),
      },
      approval: {
        gate: "human_approval" as const,
        status: lifecycleStatus === "stale"
          ? "stale" as const
          : lifecycleStatus === "evidence_unavailable"
            ? "unavailable" as const
            : lifecycleStatus === "approval_required"
              ? "ready" as const
              : "blocked" as const,
        approvalExecuted: false as const,
      },
      issueCodes: input.issueCodes ?? [],
      nextGate: lifecycleStatus === "binding_required"
        ? "validation_binding" as const
        : lifecycleStatus === "evidence_unavailable"
          ? "evidence_scope" as const
          : lifecycleStatus === "backtest_required"
            ? "backtest" as const
            : lifecycleStatus === "walk_forward_required"
              ? "walk_forward" as const
              : lifecycleStatus === "approval_required"
                ? "human_approval" as const
                : "none" as const,
      allowedAction: lifecycleStatus === "backtest_required"
        ? "run_backtest" as const
        : lifecycleStatus === "walk_forward_required"
          ? "run_walk_forward" as const
          : "none" as const,
      readOnlyProjection: true as const,
      approvedLessonCreated: false as const,
      strategyMutationCreated: false as const,
      runtimeApplied: false as const,
      exchangeWriteAllowed: false as const,
    };
    return LessonEvidenceGateProjectionSchema.parse({
      ...withoutFingerprint,
      fingerprint: graphEvidenceFingerprint(withoutFingerprint),
    });
  }
}
