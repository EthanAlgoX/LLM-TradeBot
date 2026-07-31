import { createHash } from "node:crypto";

import {
  HistoricalSemanticEvaluationCommandSchema,
  HistoricalSemanticEvaluationResponseSchema,
  type HistoricalSemanticEvaluationResponse,
  type OrchestrationActor,
  type SemanticPipelineExecutionRecord,
  type StrategyEvidenceBinding,
} from "../../contracts/src/index.js";
import type { SemanticPipelineExecutionRepository } from "./configurable-semantic-pipeline-execution-service.js";

export interface HistoricalSemanticEvaluationScope {
  datasetId: string;
  dataSourceId: string;
  backtestProfileId: string;
  walkForwardCandidateSetId: string;
  walkForwardPlanId: string;
  startAt: string;
  endAt: string;
}

export interface HistoricalSemanticEvaluationScopeResolver {
  resolve(execution: SemanticPipelineExecutionRecord): HistoricalSemanticEvaluationScope;
}

export interface HistoricalSemanticExecutionVerifier {
  verify(execution: SemanticPipelineExecutionRecord): readonly string[];
}

export interface ExistingStrategyEvidenceGateway {
  findByConfigurationVersionId(configurationVersionId: string): StrategyEvidenceBinding | undefined;
  createBinding(request: unknown, actor: OrchestrationActor): StrategyEvidenceBinding;
  runBacktest(bindingId: string, request: unknown, actor: OrchestrationActor): Promise<StrategyEvidenceBinding>;
  runWalkForward(bindingId: string, request: unknown, actor: OrchestrationActor): Promise<StrategyEvidenceBinding>;
  approve(bindingId: string, request: unknown, actor: OrchestrationActor): unknown;
  get(bindingId: string): StrategyEvidenceBinding;
}

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export class HistoricalSemanticEvaluationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export class HistoricalSemanticEvaluationService {
  constructor(
    private readonly executions: SemanticPipelineExecutionRepository,
    private readonly verifier: HistoricalSemanticExecutionVerifier,
    private readonly scopes: HistoricalSemanticEvaluationScopeResolver,
    private readonly evidence: ExistingStrategyEvidenceGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(rawCommand: unknown, actor: OrchestrationActor): Promise<HistoricalSemanticEvaluationResponse> {
    const command = HistoricalSemanticEvaluationCommandSchema.parse(rawCommand);
    const execution = this.executions.get(command.executionId);
    if (execution.lifecycleStatus === "stale") {
      return this.stale(execution, ["SEMANTIC_EXECUTION_STALE"]);
    }
    const nowMs = this.now().getTime();
    if (execution.observations.some((item) => Date.parse(item.availableAt) > nowMs || Date.parse(item.asOf) > nowMs)) {
      return this.stale(execution, ["SEMANTIC_EXECUTION_FUTURE_DATA"]);
    }
    const scope = this.scopes.resolve(execution);
    if (execution.observations.some((item) => item.lineage.sourceDefinitionId !== scope.dataSourceId)) {
      return this.stale(execution, ["SEMANTIC_EXECUTION_CAPABILITY_SCOPE_MISMATCH"]);
    }
    const artifactIndex = new Map(execution.observations.map((item) => [item.id, item]));
    const lineageInvalid = execution.assessments.some((assessment) =>
      assessment.sourceArtifactRefs.some((reference) => {
        const source = artifactIndex.get(reference.artifactId);
        return !source || source.fingerprint !== reference.fingerprint || source.lineage.fingerprint !== assessment.lineageFingerprint;
      }),
    );
    if (lineageInvalid) return this.stale(execution, ["SEMANTIC_EXECUTION_LINEAGE_INVALID"]);
    const verificationIssues = [...this.verifier.verify(execution)];
    if (verificationIssues.length > 0) return this.stale(execution, verificationIssues);

    let binding = this.evidence.findByConfigurationVersionId(execution.configurationRef.id);
    if (!binding) {
      if (command.action === "submit_approval") {
        throw new HistoricalSemanticEvaluationError("SEMANTIC_EVIDENCE_BINDING_REQUIRED");
      }
      binding = this.evidence.createBinding({
        schemaVersion: "1.0.0",
        strategyConfigurationVersionId: execution.configurationRef.id,
        datasetId: scope.datasetId,
        backtestProfileId: scope.backtestProfileId,
        walkForwardCandidateSetId: scope.walkForwardCandidateSetId,
        walkForwardPlanId: scope.walkForwardPlanId,
        startAt: scope.startAt,
        endAt: scope.endAt,
        idempotencyKey: `semantic-binding:${execution.executionId}`,
      }, actor);
    }
    if (command.action === "run_backtest") {
      binding = await this.evidence.runBacktest(binding.bindingId, { schemaVersion: "1.0.0", idempotencyKey: command.idempotencyKey }, actor);
    } else if (command.action === "run_walk_forward") {
      binding = await this.evidence.runWalkForward(binding.bindingId, { schemaVersion: "1.0.0", idempotencyKey: command.idempotencyKey }, actor);
    } else if (command.action === "submit_approval") {
      this.evidence.approve(binding.bindingId, { schemaVersion: "1.0.0", idempotencyKey: command.idempotencyKey }, actor);
      binding = this.evidence.get(binding.bindingId);
    }
    return this.project(execution, binding);
  }

  private stale(execution: SemanticPipelineExecutionRecord, issueCodes: string[]): HistoricalSemanticEvaluationResponse {
    const identity = { executionId: execution.executionId, executionFingerprint: execution.fingerprint, issueCodes };
    return HistoricalSemanticEvaluationResponseSchema.parse({
      schemaVersion: "1.0.0",
      evaluationId: `semantic-evaluation:${fingerprint(identity).slice(7, 39)}`,
      fingerprint: fingerprint(identity),
      createdAt: this.now().toISOString(),
      lifecycleStatus: "stale",
      semanticExecutionRef: { id: execution.executionId, fingerprint: execution.fingerprint },
      inputKinds: [...new Set(execution.observations.map((item) => item.payload.kind))],
      lineageFingerprints: [...new Set(execution.observations.map((item) => item.lineage.fingerprint))],
      issueCodes,
      gates: { contractValidation: "blocked", backtest: "blocked", walkForward: "blocked", humanApproval: "blocked" },
      historicalEngine: "existing_graph_evidence",
      runtimeApplied: false,
      exchangeWriteAllowed: false,
    });
  }

  private project(execution: SemanticPipelineExecutionRecord, binding: StrategyEvidenceBinding): HistoricalSemanticEvaluationResponse {
    const backtestPassed = Boolean(binding.backtestJob);
    const walkForwardPassed = Boolean(binding.walkForwardJob);
    const approved = Boolean(binding.approval && binding.approvedPaperPlanId);
    const lifecycleStatus = approved
      ? "approved_not_applied"
      : backtestPassed && walkForwardPassed
        ? "approval_ready"
        : walkForwardPassed
          ? "walk_forward_passed"
          : backtestPassed
            ? "backtest_passed"
            : "contract_validated";
    const identity = { executionId: execution.executionId, bindingFingerprint: binding.fingerprint, lifecycleStatus };
    return HistoricalSemanticEvaluationResponseSchema.parse({
      schemaVersion: "1.0.0",
      evaluationId: `semantic-evaluation:${fingerprint(identity).slice(7, 39)}`,
      fingerprint: fingerprint(identity),
      createdAt: this.now().toISOString(),
      lifecycleStatus,
      semanticExecutionRef: { id: execution.executionId, fingerprint: execution.fingerprint },
      strategyEvidenceBindingRef: { id: binding.bindingId, versionId: binding.versionId, fingerprint: binding.fingerprint },
      inputKinds: [...new Set(execution.observations.map((item) => item.payload.kind))],
      lineageFingerprints: [...new Set([
        ...execution.observations.map((item) => item.lineage.fingerprint),
        ...execution.assessments.map((item) => item.lineageFingerprint),
      ])],
      issueCodes: [],
      gates: {
        contractValidation: "passed",
        backtest: backtestPassed ? "passed" : "required",
        walkForward: walkForwardPassed ? "passed" : backtestPassed ? "required" : "blocked",
        humanApproval: approved ? "passed" : backtestPassed && walkForwardPassed ? "required" : "blocked",
      },
      historicalEngine: "existing_graph_evidence",
      runtimeApplied: false,
      exchangeWriteAllowed: false,
    });
  }
}
