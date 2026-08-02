import { createHash } from "node:crypto";
import {
  GraphBacktestCycleEvidenceSchema,
  GraphBacktestJobRequestSchema,
  GraphBacktestRunSchema,
  GraphEvidenceArtifactSchema,
  GraphEvidenceVerificationResultSchema,
  GraphHistoricalDatasetDefinitionSchema,
  GraphStrategyProfileCandidateSetSchema,
  GraphStrategyProfileDefinitionSchema,
  GraphWalkForwardJobRequestSchema,
  GraphWalkForwardPlanDefinitionSchema,
  GraphWalkForwardRunSchema,
  type GraphBacktestJobRequest,
  type GraphBacktestMetrics,
  type GraphBacktestRun,
  type GraphCycleOutcome,
  type GraphEvidenceArtifact,
  type GraphEvidenceVerificationResult,
  type GraphHistoricalDatasetDefinition,
  type GraphStrategyProfileCandidateSet,
  type GraphStrategyProfileDefinition,
  type GraphWalkForwardJobRequest,
  type GraphWalkForwardPlanDefinition,
  type GraphWalkForwardRun,
  type HistoricalGraphExecutionPlan,
  type HistoricalGraphExecutionResult,
} from "../../contracts/src/index.js";

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

export function graphEvidenceFingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function withCalculatedFingerprint<T extends { fingerprint: string }>(raw: T): T {
  const { fingerprint: _ignored, ...content } = raw;
  return { ...raw, fingerprint: graphEvidenceFingerprint(content) };
}

export function createGraphHistoricalDatasetDefinition(
  raw: Omit<GraphHistoricalDatasetDefinition, "fingerprint">,
): GraphHistoricalDatasetDefinition {
  return GraphHistoricalDatasetDefinitionSchema.parse(
    withCalculatedFingerprint({ ...raw, fingerprint: graphEvidenceFingerprint(raw) }),
  );
}

export function createGraphStrategyProfileDefinition(
  raw: Omit<GraphStrategyProfileDefinition, "fingerprint">,
): GraphStrategyProfileDefinition {
  return GraphStrategyProfileDefinitionSchema.parse(
    withCalculatedFingerprint({ ...raw, fingerprint: graphEvidenceFingerprint(raw) }),
  );
}

export function createGraphStrategyProfileCandidateSet(
  raw: Omit<GraphStrategyProfileCandidateSet, "fingerprint">,
): GraphStrategyProfileCandidateSet {
  return GraphStrategyProfileCandidateSetSchema.parse(
    withCalculatedFingerprint({ ...raw, fingerprint: graphEvidenceFingerprint(raw) }),
  );
}

export function createGraphWalkForwardPlanDefinition(
  raw: Omit<GraphWalkForwardPlanDefinition, "fingerprint">,
): GraphWalkForwardPlanDefinition {
  return GraphWalkForwardPlanDefinitionSchema.parse(
    withCalculatedFingerprint({ ...raw, fingerprint: graphEvidenceFingerprint(raw) }),
  );
}

export class GraphEvidenceError extends Error {
  constructor(
    readonly code:
      | "DATASET_NOT_REGISTERED"
      | "DATASET_FINGERPRINT_MISMATCH"
      | "PROFILE_NOT_REGISTERED"
      | "PROFILE_FINGERPRINT_MISMATCH"
      | "PROFILE_INCOMPATIBLE"
      | "CANDIDATE_SET_NOT_REGISTERED"
      | "WALK_FORWARD_PLAN_NOT_REGISTERED"
      | "HISTORICAL_RANGE_EMPTY"
      | "GRAPH_SESSION_PLAN_MISMATCH"
      | "GRAPH_CYCLE_FAILED"
      | "CYCLE_OUTCOME_MODE_MISMATCH"
      | "WALK_FORWARD_INSUFFICIENT_DATA"
      | "WALK_FORWARD_OBJECTIVE_INCOMPATIBLE"
      | "IDEMPOTENCY_CONFLICT",
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(code);
    this.name = "GraphEvidenceError";
  }
}

function verifyDefinitionFingerprint<T extends { fingerprint: string }>(definition: T): boolean {
  const { fingerprint, ...content } = definition;
  return graphEvidenceFingerprint(content) === fingerprint;
}

export class RegisteredGraphHistoricalDatasetRegistry {
  private readonly definitions = new Map<string, GraphHistoricalDatasetDefinition>();

  constructor(definitions: readonly GraphHistoricalDatasetDefinition[]) {
    for (const raw of definitions) {
      const definition = GraphHistoricalDatasetDefinitionSchema.parse(raw);
      if (!verifyDefinitionFingerprint(definition)) {
        throw new GraphEvidenceError("DATASET_FINGERPRINT_MISMATCH", { datasetId: definition.id });
      }
      if (this.definitions.has(definition.id)) {
        throw new GraphEvidenceError("DATASET_FINGERPRINT_MISMATCH", { datasetId: definition.id, reason: "duplicate" });
      }
      this.definitions.set(definition.id, definition);
    }
  }

  require(datasetId: string): GraphHistoricalDatasetDefinition {
    const definition = this.definitions.get(datasetId);
    if (!definition) throw new GraphEvidenceError("DATASET_NOT_REGISTERED", { datasetId });
    if (!verifyDefinitionFingerprint(definition)) {
      throw new GraphEvidenceError("DATASET_FINGERPRINT_MISMATCH", { datasetId });
    }
    return GraphHistoricalDatasetDefinitionSchema.parse(definition);
  }

  list(): GraphHistoricalDatasetDefinition[] { return [...this.definitions.values()].map((item) => GraphHistoricalDatasetDefinitionSchema.parse(item)); }

  schedule(datasetId: string, startAt: string, endAt: string): string[] {
    const dataset = this.require(datasetId);
    const sequence = dataset.asOfSequence.filter(
      (asOf) => Date.parse(asOf) >= Date.parse(startAt) && Date.parse(asOf) <= Date.parse(endAt),
    );
    if (sequence.length === 0) {
      throw new GraphEvidenceError("HISTORICAL_RANGE_EMPTY", { datasetId, startAt, endAt });
    }
    return sequence;
  }
}

export class RegisteredGraphStrategyProfileRegistry {
  private readonly profiles = new Map<string, GraphStrategyProfileDefinition>();
  private readonly candidateSets = new Map<string, GraphStrategyProfileCandidateSet>();

  constructor(
    profiles: readonly GraphStrategyProfileDefinition[],
    candidateSets: readonly GraphStrategyProfileCandidateSet[] = [],
  ) {
    for (const raw of profiles) this.registerProfile(raw);
    for (const raw of candidateSets) this.registerCandidateSet(raw);
  }

  registerProfile(
    raw: GraphStrategyProfileDefinition,
  ): GraphStrategyProfileDefinition {
    const profile = GraphStrategyProfileDefinitionSchema.parse(raw);
    if (!verifyDefinitionFingerprint(profile)) {
      throw new GraphEvidenceError("PROFILE_FINGERPRINT_MISMATCH", {
        profileId: profile.id,
      });
    }
    const existing = this.profiles.get(profile.id);
    if (existing && existing.fingerprint !== profile.fingerprint) {
      throw new GraphEvidenceError("PROFILE_FINGERPRINT_MISMATCH", {
        profileId: profile.id,
        reason: "immutable_version_conflict",
      });
    }
    this.profiles.set(profile.id, profile);
    return GraphStrategyProfileDefinitionSchema.parse(profile);
  }

  registerCandidateSet(
    raw: GraphStrategyProfileCandidateSet,
  ): GraphStrategyProfileCandidateSet {
    const candidateSet =
      GraphStrategyProfileCandidateSetSchema.parse(raw);
    if (!verifyDefinitionFingerprint(candidateSet)) {
      throw new GraphEvidenceError("PROFILE_FINGERPRINT_MISMATCH", {
        candidateSetId: candidateSet.id,
      });
    }
    for (const profileId of candidateSet.profileIds) {
      this.require(profileId);
    }
    const existing = this.candidateSets.get(candidateSet.id);
    if (
      existing &&
      existing.fingerprint !== candidateSet.fingerprint
    ) {
      throw new GraphEvidenceError("PROFILE_FINGERPRINT_MISMATCH", {
        candidateSetId: candidateSet.id,
        reason: "immutable_version_conflict",
      });
    }
    this.candidateSets.set(candidateSet.id, candidateSet);
    return GraphStrategyProfileCandidateSetSchema.parse(candidateSet);
  }

  require(profileId: string, presetId?: string): GraphStrategyProfileDefinition {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new GraphEvidenceError("PROFILE_NOT_REGISTERED", { profileId });
    if (!verifyDefinitionFingerprint(profile)) {
      throw new GraphEvidenceError("PROFILE_FINGERPRINT_MISMATCH", { profileId });
    }
    if (presetId && !profile.compatiblePresetIds.includes(presetId)) {
      throw new GraphEvidenceError("PROFILE_INCOMPATIBLE", { profileId, presetId });
    }
    return GraphStrategyProfileDefinitionSchema.parse(profile);
  }

  requireCandidateSet(candidateSetId: string): GraphStrategyProfileCandidateSet {
    const candidateSet = this.candidateSets.get(candidateSetId);
    if (!candidateSet) throw new GraphEvidenceError("CANDIDATE_SET_NOT_REGISTERED", { candidateSetId });
    if (!verifyDefinitionFingerprint(candidateSet)) {
      throw new GraphEvidenceError("PROFILE_FINGERPRINT_MISMATCH", { candidateSetId });
    }
    return GraphStrategyProfileCandidateSetSchema.parse(candidateSet);
  }
}

export class RegisteredGraphWalkForwardPlanRegistry {
  private readonly plans = new Map<string, GraphWalkForwardPlanDefinition>();

  constructor(plans: readonly GraphWalkForwardPlanDefinition[]) {
    for (const raw of plans) {
      const plan = GraphWalkForwardPlanDefinitionSchema.parse(raw);
      if (!verifyDefinitionFingerprint(plan)) {
        throw new GraphEvidenceError("PROFILE_FINGERPRINT_MISMATCH", { walkForwardPlanId: plan.id });
      }
      this.plans.set(plan.id, plan);
    }
  }

  require(planId: string): GraphWalkForwardPlanDefinition {
    const plan = this.plans.get(planId);
    if (!plan) throw new GraphEvidenceError("WALK_FORWARD_PLAN_NOT_REGISTERED", { planId });
    return GraphWalkForwardPlanDefinitionSchema.parse(plan);
  }
  list(): GraphWalkForwardPlanDefinition[] { return [...this.plans.values()].map((item) => GraphWalkForwardPlanDefinitionSchema.parse(item)); }
}

export interface GraphBacktestSession {
  plan: HistoricalGraphExecutionPlan;
  execute(asOf: string, idempotencyKey: string): Promise<HistoricalGraphExecutionResult>;
  captureCycleOutcome(
    asOf: string,
    result: HistoricalGraphExecutionResult,
  ): Promise<GraphCycleOutcome>;
  close(): Promise<void>;
}

export interface GraphBacktestSessionFactory {
  create(input: {
    sessionId: string;
    planId: string;
    dataset: GraphHistoricalDatasetDefinition;
    profile: GraphStrategyProfileDefinition;
  }): Promise<GraphBacktestSession>;
}

function definitionRef(definition: { id: string; version: string; fingerprint: string }) {
  return { id: definition.id, version: definition.version, fingerprint: definition.fingerprint };
}

function calculateTradingMetrics(outcomes: readonly GraphCycleOutcome[]): GraphBacktestMetrics {
  const trading = outcomes.filter((outcome) => outcome.mode === "trading");
  if (trading.length !== outcomes.length || trading.length === 0) {
    throw new GraphEvidenceError("CYCLE_OUTCOME_MODE_MISMATCH");
  }
  const initialEquity = trading[0]!.equity;
  const finalEquity = trading.at(-1)!.equity;
  let peak = initialEquity;
  let maxDrawdownPct = 0;
  for (const outcome of trading) {
    peak = Math.max(peak, outcome.equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - outcome.equity) / peak) * 100);
  }
  return {
    mode: "trading",
    initialEquity,
    finalEquity,
    totalReturnPct: initialEquity === 0 ? 0 : ((finalEquity - initialEquity) / initialEquity) * 100,
    maxDrawdownPct,
    tradeCount: trading.at(-1)!.tradeCount,
    fillCount: trading.at(-1)!.fillCount,
    riskRejectionCount: trading.at(-1)!.riskRejectionCount,
    cycleCount: trading.length,
  };
}

function calculateResearchMetrics(outcomes: readonly GraphCycleOutcome[]): GraphBacktestMetrics {
  const research = outcomes.filter((outcome) => outcome.mode === "research");
  if (research.length !== outcomes.length || research.length === 0) {
    throw new GraphEvidenceError("CYCLE_OUTCOME_MODE_MISMATCH");
  }
  return {
    mode: "research",
    cycleCount: research.length,
    succeededCycleCount: research.length,
    assessmentArtifactCount: research.reduce((sum, outcome) => sum + outcome.assessmentArtifactCount, 0),
    researchSuccessRate: 1,
  };
}

export class GraphBacktestRunner {
  private readonly cache = new Map<string, { requestFingerprint: string; run: GraphBacktestRun }>();

  constructor(
    private readonly datasets: RegisteredGraphHistoricalDatasetRegistry,
    private readonly profiles: RegisteredGraphStrategyProfileRegistry,
    private readonly sessions: GraphBacktestSessionFactory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(rawRequest: unknown): Promise<GraphBacktestRun> {
    const request = GraphBacktestJobRequestSchema.parse(rawRequest);
    const requestFingerprint = graphEvidenceFingerprint(request);
    const cacheKey = `${request.planId}:${request.idempotencyKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (cached.requestFingerprint !== requestFingerprint) {
        throw new GraphEvidenceError("IDEMPOTENCY_CONFLICT", { idempotencyKey: request.idempotencyKey });
      }
      return GraphBacktestRunSchema.parse(cached.run);
    }
    const dataset = this.datasets.require(request.datasetId);
    const schedule = this.datasets.schedule(request.datasetId, request.startAt, request.endAt);
    const sessionId = `graph-session:${graphEvidenceFingerprint({ request, scope: "backtest" }).slice(7, 31)}`;
    const profile = this.profiles.require(request.profileId);
    const session = await this.sessions.create({ sessionId, planId: request.planId, dataset, profile });
    try {
      if (session.plan.planId !== request.planId) {
        throw new GraphEvidenceError("GRAPH_SESSION_PLAN_MISMATCH", { expected: request.planId, actual: session.plan.planId });
      }
      this.profiles.require(request.profileId, session.plan.presetRef.id);
      const cycles = [];
      const outcomes: GraphCycleOutcome[] = [];
      for (const [index, asOf] of schedule.entries()) {
        const result = await session.execute(asOf, `${request.idempotencyKey}:cycle:${index}`);
        if (result.run.status === "failed") {
          throw new GraphEvidenceError("GRAPH_CYCLE_FAILED", { asOf, graphRunId: result.run.runId });
        }
        const outcome = await session.captureCycleOutcome(asOf, result);
        if (
          (session.plan.executionMode === "research_only" && outcome.mode !== "research") ||
          (session.plan.executionMode === "paper_capable" && outcome.mode !== "trading")
        ) {
          throw new GraphEvidenceError("CYCLE_OUTCOME_MODE_MISMATCH", { asOf });
        }
        outcomes.push(outcome);
        const cycleWithoutFingerprint = {
          cycleId: `${sessionId}:cycle:${index}`,
          asOf,
          graphRunId: result.run.runId,
          graphPlanRef: result.run.planRef,
          graphRunStatus: result.run.status,
          nodeRunCount: result.run.nodeRuns.length,
          artifactFingerprints: result.artifacts.map((artifact) => artifact.fingerprint),
          lineageFingerprints: [...new Set(result.artifacts.flatMap((artifact) => artifact.lineageFingerprints))],
          outcome,
        };
        cycles.push(GraphBacktestCycleEvidenceSchema.parse({
          ...cycleWithoutFingerprint,
          fingerprint: graphEvidenceFingerprint(cycleWithoutFingerprint),
        }));
      }
      const metrics = session.plan.executionMode === "research_only"
        ? calculateResearchMetrics(outcomes)
        : calculateTradingMetrics(outcomes);
      const withoutFingerprint = {
        schemaVersion: "1.0.0" as const,
        runId: `graph-backtest:${graphEvidenceFingerprint({ request, cycles }).slice(7, 31)}`,
        version: "1.0.0",
        lifecycleStatus: "succeeded" as const,
        createdAt: this.now().toISOString(),
        planRef: { id: session.plan.planId, version: session.plan.version, fingerprint: session.plan.fingerprint },
        datasetRef: definitionRef(dataset),
        profileRef: definitionRef(profile),
        startAt: schedule[0]!,
        endAt: schedule.at(-1)!,
        cycles,
        metrics,
        promotionEligible: metrics.mode === "trading",
        runtimeApplied: false as const,
      };
      const run = GraphBacktestRunSchema.parse({
        ...withoutFingerprint,
        fingerprint: graphEvidenceFingerprint(withoutFingerprint),
      });
      this.cache.set(cacheKey, { requestFingerprint, run });
      return GraphBacktestRunSchema.parse(run);
    } finally {
      await session.close();
    }
  }
}

function objectiveValue(metrics: GraphBacktestMetrics, objective: GraphWalkForwardPlanDefinition["objective"]): number {
  if (objective === "total_return_pct" && metrics.mode === "trading") return metrics.totalReturnPct;
  if (objective === "max_drawdown_pct" && metrics.mode === "trading") return -metrics.maxDrawdownPct;
  if (objective === "research_success_rate" && metrics.mode === "research") return metrics.researchSuccessRate;
  throw new GraphEvidenceError("WALK_FORWARD_OBJECTIVE_INCOMPATIBLE", { objective, mode: metrics.mode });
}

export class GraphWalkForwardRunner {
  constructor(
    private readonly datasets: RegisteredGraphHistoricalDatasetRegistry,
    private readonly profiles: RegisteredGraphStrategyProfileRegistry,
    private readonly plans: RegisteredGraphWalkForwardPlanRegistry,
    private readonly backtests: GraphBacktestRunner,
    private readonly resolvePlan: (planId: string) => HistoricalGraphExecutionPlan,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(rawRequest: unknown): Promise<GraphWalkForwardRun> {
    const request = GraphWalkForwardJobRequestSchema.parse(rawRequest);
    const dataset = this.datasets.require(request.datasetId);
    const schedule = this.datasets.schedule(request.datasetId, request.startAt, request.endAt);
    const candidateSet = this.profiles.requireCandidateSet(request.profileCandidateSetId);
    const walkPlan = this.plans.require(request.walkForwardPlanId);
    const graphPlan = this.resolvePlan(request.planId);
    const folds = [];
    let foldIndex = 0;
    for (
      let trainingStart = 0;
      trainingStart + walkPlan.trainingCycles + walkPlan.validationCycles <= schedule.length;
      trainingStart += walkPlan.stepCycles
    ) {
      const training = schedule.slice(trainingStart, trainingStart + walkPlan.trainingCycles);
      const validation = schedule.slice(
        trainingStart + walkPlan.trainingCycles,
        trainingStart + walkPlan.trainingCycles + walkPlan.validationCycles,
      );
      const candidates = [];
      for (const profileId of candidateSet.profileIds) {
        const profile = this.profiles.require(profileId, graphPlan.presetRef.id);
        const trainingRun = await this.backtests.run({
          schemaVersion: "1.0.0",
          planId: request.planId,
          datasetId: request.datasetId,
          profileId,
          startAt: training[0]!,
          endAt: training.at(-1)!,
          idempotencyKey: `${request.idempotencyKey}:fold:${foldIndex}:training:${profileId}`,
        });
        candidates.push({
          profileRef: definitionRef(profile),
          trainingRunRef: { id: trainingRun.runId, version: trainingRun.version, fingerprint: trainingRun.fingerprint },
          metrics: trainingRun.metrics,
        });
      }
      candidates.sort((left, right) =>
        objectiveValue(right.metrics, walkPlan.objective) - objectiveValue(left.metrics, walkPlan.objective) ||
        left.profileRef.id.localeCompare(right.profileRef.id),
      );
      const selected = candidates[0];
      if (!selected) throw new GraphEvidenceError("WALK_FORWARD_INSUFFICIENT_DATA");
      const validationRun = await this.backtests.run({
        schemaVersion: "1.0.0",
        planId: request.planId,
        datasetId: request.datasetId,
        profileId: selected.profileRef.id,
        startAt: validation[0]!,
        endAt: validation.at(-1)!,
        idempotencyKey: `${request.idempotencyKey}:fold:${foldIndex}:validation:${selected.profileRef.id}`,
      });
      const foldWithoutFingerprint = {
        foldId: `graph-walk-forward:${request.idempotencyKey}:fold:${foldIndex}`,
        trainingStartAt: training[0]!,
        trainingEndAt: training.at(-1)!,
        validationStartAt: validation[0]!,
        validationEndAt: validation.at(-1)!,
        candidates,
        selectedProfileRef: selected.profileRef,
        validationRunRef: { id: validationRun.runId, version: validationRun.version, fingerprint: validationRun.fingerprint },
        validationMetrics: validationRun.metrics,
      };
      folds.push({ ...foldWithoutFingerprint, fingerprint: graphEvidenceFingerprint(foldWithoutFingerprint) });
      foldIndex += 1;
    }
    if (folds.length === 0) throw new GraphEvidenceError("WALK_FORWARD_INSUFFICIENT_DATA");
    const withoutFingerprint = {
      schemaVersion: "1.0.0" as const,
      runId: `graph-walk-forward:${graphEvidenceFingerprint({ request, folds }).slice(7, 31)}`,
      version: "1.0.0",
      lifecycleStatus: "succeeded" as const,
      createdAt: this.now().toISOString(),
      planRef: { id: graphPlan.planId, version: graphPlan.version, fingerprint: graphPlan.fingerprint },
      datasetRef: definitionRef(dataset),
      candidateSetRef: definitionRef(candidateSet),
      walkForwardPlanRef: definitionRef(walkPlan),
      folds,
      promotionEligible: folds.every((fold) => fold.validationMetrics.mode === "trading"),
      runtimeApplied: false as const,
    };
    return GraphWalkForwardRunSchema.parse({
      ...withoutFingerprint,
      fingerprint: graphEvidenceFingerprint(withoutFingerprint),
    });
  }
}

export function createGraphEvidenceArtifact(input: {
  kind: "graph_backtest" | "graph_walk_forward";
  result: GraphBacktestRun | GraphWalkForwardRun;
  profileScopeRef: { id: string; version: string; fingerprint: string };
  createdAt: string;
}): GraphEvidenceArtifact {
  const resultFingerprint = graphEvidenceFingerprint(input.result);
  const artifactId = `graph-evidence:${resultFingerprint.slice(7, 31)}`;
  const manifestContent = {
    schemaVersion: "1.0.0" as const,
    artifactId,
    kind: input.kind,
    planRef: input.result.planRef,
    datasetRef: input.result.datasetRef,
    profileScopeRef: input.profileScopeRef,
    resultFingerprint,
    promotionEligible: input.result.promotionEligible,
    createdAt: input.createdAt,
    generatedBy: "tradebot-server" as const,
  };
  const manifestFingerprint = graphEvidenceFingerprint(manifestContent);
  return GraphEvidenceArtifactSchema.parse({
    ...manifestContent,
    evidenceRef: `${artifactId}:${manifestFingerprint}`,
    result: input.result,
    manifestFingerprint,
  });
}

export function verifyGraphEvidenceArtifact(
  artifact: GraphEvidenceArtifact,
  current: {
    planFingerprint: string;
    datasetFingerprint: string;
    profileScopeFingerprint: string;
  },
): GraphEvidenceVerificationResult {
  const issueCodes: GraphEvidenceVerificationResult["issueCodes"] = [];
  const resultFingerprint = graphEvidenceFingerprint(artifact.result);
  if (resultFingerprint !== artifact.resultFingerprint) issueCodes.push("RESULT_FINGERPRINT_MISMATCH");
  const manifestContent = {
    schemaVersion: artifact.schemaVersion,
    artifactId: artifact.artifactId,
    kind: artifact.kind,
    planRef: artifact.planRef,
    datasetRef: artifact.datasetRef,
    profileScopeRef: artifact.profileScopeRef,
    resultFingerprint: artifact.resultFingerprint,
    promotionEligible: artifact.promotionEligible,
    createdAt: artifact.createdAt,
    generatedBy: artifact.generatedBy,
  };
  const manifestFingerprint = graphEvidenceFingerprint(manifestContent);
  if (manifestFingerprint !== artifact.manifestFingerprint) issueCodes.push("MANIFEST_FINGERPRINT_MISMATCH");
  if (artifact.evidenceRef !== `${artifact.artifactId}:${artifact.manifestFingerprint}`) issueCodes.push("EVIDENCE_REF_MISMATCH");
  if (artifact.planRef.fingerprint !== current.planFingerprint) issueCodes.push("PLAN_FINGERPRINT_MISMATCH");
  if (artifact.datasetRef.fingerprint !== current.datasetFingerprint) issueCodes.push("DATASET_FINGERPRINT_MISMATCH");
  if (artifact.profileScopeRef.fingerprint !== current.profileScopeFingerprint) issueCodes.push("PROFILE_SCOPE_FINGERPRINT_MISMATCH");
  return GraphEvidenceVerificationResultSchema.parse({ valid: issueCodes.length === 0, issueCodes });
}
