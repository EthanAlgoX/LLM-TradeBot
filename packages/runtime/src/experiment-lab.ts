import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  ExperimentCatalogSchema,
  ExperimentCreateRequestSchema,
  ExperimentListResponseSchema,
  ExperimentSchema,
  GraphBacktestJobRequestSchema,
  GraphEvidenceArtifactSchema,
  GraphWalkForwardJobRequestSchema,
  type Experiment,
  type ExperimentCatalog,
  type ExperimentConstraintResult,
  type ExperimentEvidence,
  type ExperimentParticipant,
  type GraphEvidenceArtifact,
  type GraphEvidenceJob,
} from "../../contracts/src/index.js";
import type { ConfigurationDraftService } from "../../core/src/configuration-draft-service.js";
import type { ExecutableStrategyConfigurationService } from "../../core/src/executable-strategy-configuration-service.js";
import {
  graphEvidenceFingerprint,
  verifyGraphEvidenceArtifact,
  type RegisteredGraphHistoricalDatasetRegistry,
  type RegisteredGraphWalkForwardPlanRegistry,
} from "../../core/src/graph-backtest-evidence.js";
import type { DurableGraphEvidenceJobService } from "./sqlite-graph-evidence-jobs.js";
import type { PipelineOrchestrationAuthenticator } from "./pipeline-orchestration-auth.js";

const StableIdSchema = z
  .string()
  .min(3)
  .max(240)
  .regex(/^[a-z0-9][a-z0-9._:@-]*$/u);
const CursorSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("experiments"),
    actor: StableIdSchema,
    createdAt: z.string().datetime({ offset: true }),
    id: StableIdSchema,
  })
  .strict();
const EmptyBodySchema = z.object({}).strict();

type ExperimentEventKind =
  | "backtest_recorded"
  | "walk_forward_recorded"
  | "replay_verified"
  | "candidate_created"
  | "state_changed";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const errorCode = (error: unknown): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_:.-]+$/u.test(error.code)
  ) {
    return error.code;
  }
  return error instanceof Error && /^[A-Z0-9_:.-]+$/u.test(error.message)
    ? error.message
    : "EXPERIMENT_REQUEST_INVALID";
};

function encodeCursor(actor: string, createdAt: string, id: string): string {
  return Buffer.from(
    JSON.stringify({ v: 1, kind: "experiments", actor, createdAt, id }),
  ).toString("base64url");
}

function decodeCursor(raw: string | undefined, actor: string) {
  if (!raw) return undefined;
  try {
    const parsed = CursorSchema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    if (parsed.actor !== actor) throw new Error();
    return parsed;
  } catch {
    throw new Error("EXPERIMENT_CURSOR_INVALID");
  }
}

function immutableParticipant(participant: ExperimentParticipant) {
  return {
    participantId: participant.participantId,
    label: participant.label,
    strategyVersionRef: participant.strategyVersionRef,
    strategyFingerprint: participant.strategyFingerprint,
    executableFingerprint: participant.executableFingerprint,
    historicalPlanRef: participant.historicalPlanRef,
    marketPackRef: participant.marketPackRef,
    baseProfileRef: participant.baseProfileRef,
    profileRef: participant.profileRef,
    candidateSetRef: participant.candidateSetRef,
    agentConfigurationRefs: participant.agentConfigurationRefs,
    promptPolicyRefs: participant.promptPolicyRefs,
    configProjection: participant.configProjection,
  };
}

function immutableProjection(experiment: Experiment) {
  return {
    schemaVersion: experiment.schemaVersion,
    experimentId: experiment.experimentId,
    fingerprint: experiment.fingerprint,
    createdAt: experiment.createdAt,
    actorId: experiment.actorId,
    comparability: experiment.comparability,
    lock: experiment.lock,
    participants: experiment.participants.map(immutableParticipant),
    configurationDiff: experiment.configurationDiff,
  };
}

function eventKind(current: Experiment, next: Experiment): ExperimentEventKind {
  if (!current.candidate && next.candidate) return "candidate_created";
  if (!current.replay && next.replay) return "replay_verified";
  if (
    current.participants.some((participant) => !participant.walkForwardEvidence) &&
    next.participants.some((participant) => participant.walkForwardEvidence)
  ) {
    return "walk_forward_recorded";
  }
  if (
    current.participants.some((participant) => !participant.backtestEvidence) &&
    next.participants.some((participant) => participant.backtestEvidence)
  ) {
    return "backtest_recorded";
  }
  return "state_changed";
}

const lifecycleRank: Record<Experiment["lifecycleStatus"], number> = {
  draft: 0,
  backtest_partial: 1,
  backtest_complete: 2,
  walk_forward_partial: 3,
  evidence_complete: 4,
  candidate_ready: 5,
  insufficient: 6,
  stale: 6,
  failed: 6,
};

export class SqliteExperimentRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS experiment_definitions (
        experiment_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(actor_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS experiment_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        experiment_id TEXT NOT NULL,
        event_kind TEXT NOT NULL DEFAULT 'state_changed',
        state_fingerprint TEXT,
        event_fingerprint TEXT,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS experiment_actor_created
      ON experiment_definitions(actor_id, created_at DESC, experiment_id DESC);
      CREATE TRIGGER IF NOT EXISTS experiment_definition_immutable
      BEFORE UPDATE ON experiment_definitions BEGIN
        SELECT RAISE(ABORT, 'EXPERIMENT_IMMUTABLE');
      END;
      CREATE TRIGGER IF NOT EXISTS experiment_definition_delete_forbidden
      BEFORE DELETE ON experiment_definitions BEGIN
        SELECT RAISE(ABORT, 'EXPERIMENT_IMMUTABLE');
      END;
      CREATE TRIGGER IF NOT EXISTS experiment_event_update_forbidden
      BEFORE UPDATE ON experiment_events BEGIN
        SELECT RAISE(ABORT, 'EXPERIMENT_IMMUTABLE');
      END;
      CREATE TRIGGER IF NOT EXISTS experiment_event_delete_forbidden
      BEFORE DELETE ON experiment_events BEGIN
        SELECT RAISE(ABORT, 'EXPERIMENT_IMMUTABLE');
      END;
    `);
    this.ensureEventColumn("event_kind", "TEXT NOT NULL DEFAULT 'state_changed'");
    this.ensureEventColumn("state_fingerprint", "TEXT");
    this.ensureEventColumn("event_fingerprint", "TEXT");
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS experiment_event_idempotency
      ON experiment_events(experiment_id, event_fingerprint)
      WHERE event_fingerprint IS NOT NULL;
    `);
  }

  private ensureEventColumn(name: string, declaration: string): void {
    const columns = this.database
      .prepare("PRAGMA table_info(experiment_events)")
      .all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === name)) {
      this.database.exec(
        `ALTER TABLE experiment_events ADD COLUMN ${name} ${declaration}`,
      );
    }
  }

  private parse(raw: string): Experiment {
    try {
      return ExperimentSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error("EXPERIMENT_RECORD_CORRUPT");
    }
  }

  save(experiment: Experiment, idempotencyKey: string): Experiment {
    const existing = this.database
      .prepare(`
        SELECT experiment_id, request_fingerprint
        FROM experiment_definitions
        WHERE actor_id = ? AND idempotency_key = ?
      `)
      .get(experiment.actorId, idempotencyKey) as
      | { experiment_id: string; request_fingerprint: string }
      | undefined;
    if (existing) {
      if (existing.request_fingerprint !== experiment.fingerprint) {
        throw new Error("EXPERIMENT_IDEMPOTENCY_CONFLICT");
      }
      return this.get(existing.experiment_id, experiment.actorId);
    }
    this.database
      .prepare(`
        INSERT INTO experiment_definitions(
          experiment_id, actor_id, idempotency_key, request_fingerprint,
          definition_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        experiment.experimentId,
        experiment.actorId,
        idempotencyKey,
        experiment.fingerprint,
        JSON.stringify(experiment),
        experiment.createdAt,
      );
    return experiment;
  }

  get(id: string, actor: string): Experiment {
    const row = this.database
      .prepare(`
        SELECT definition_json FROM experiment_definitions
        WHERE experiment_id = ? AND actor_id = ?
      `)
      .get(id, actor) as { definition_json: string } | undefined;
    if (!row) throw new Error("EXPERIMENT_NOT_FOUND");
    let current = this.parse(row.definition_json);
    const events = this.database
      .prepare(`
        SELECT event_json, state_fingerprint
        FROM experiment_events
        WHERE experiment_id = ? ORDER BY event_id ASC
      `)
      .all(id) as Array<{
      event_json: string;
      state_fingerprint: string | null;
    }>;
    for (const event of events) {
      const next = this.parse(event.event_json);
      if (
        next.experimentId !== id ||
        next.actorId !== actor ||
        next.fingerprint !== current.fingerprint ||
        graphEvidenceFingerprint(immutableProjection(next)) !==
          graphEvidenceFingerprint(immutableProjection(current)) ||
        (event.state_fingerprint !== null &&
          event.state_fingerprint !== graphEvidenceFingerprint(next))
      ) {
        throw new Error("EXPERIMENT_EVENT_CORRUPT");
      }
      current = next;
    }
    return current;
  }

  append(raw: Experiment): Experiment {
    const next = ExperimentSchema.parse(raw);
    const current = this.get(next.experimentId, next.actorId);
    if (
      graphEvidenceFingerprint(immutableProjection(next)) !==
      graphEvidenceFingerprint(immutableProjection(current))
    ) {
      throw new Error("EXPERIMENT_DEFINITION_CHANGED");
    }
    if (lifecycleRank[next.lifecycleStatus] < lifecycleRank[current.lifecycleStatus]) {
      throw new Error("EXPERIMENT_STATE_REGRESSION");
    }
    const stateFingerprint = graphEvidenceFingerprint(next);
    if (stateFingerprint === graphEvidenceFingerprint(current)) return current;
    const kind = eventKind(current, next);
    const eventFingerprint = graphEvidenceFingerprint({
      experimentId: next.experimentId,
      kind,
      stateFingerprint,
    });
    this.database
      .prepare(`
        INSERT OR IGNORE INTO experiment_events(
          experiment_id, event_kind, state_fingerprint, event_fingerprint,
          event_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        next.experimentId,
        kind,
        stateFingerprint,
        eventFingerprint,
        JSON.stringify(next),
        new Date().toISOString(),
      );
    return this.get(next.experimentId, next.actorId);
  }

  list(actor: string, limit: number, rawCursor?: string) {
    const after = decodeCursor(rawCursor, actor);
    const rows = this.database
      .prepare(`
        SELECT experiment_id, created_at
        FROM experiment_definitions
        WHERE actor_id = ?
        ${
          after
            ? "AND (created_at < ? OR (created_at = ? AND experiment_id < ?))"
            : ""
        }
        ORDER BY created_at DESC, experiment_id DESC
        LIMIT ?
      `)
      .all(
        ...(after
          ? [actor, after.createdAt, after.createdAt, after.id, limit + 1]
          : [actor, limit + 1]),
      ) as Array<{ experiment_id: string; created_at: string }>;
    const page = rows.slice(0, limit);
    return ExperimentListResponseSchema.parse({
      data: page.map((row) => this.get(row.experiment_id, actor)),
      nextCursor:
        rows.length > limit && page.at(-1)
          ? encodeCursor(
              actor,
              page.at(-1)!.created_at,
              page.at(-1)!.experiment_id,
            )
          : undefined,
    });
  }
}

function safeParameters(
  parameters: Readonly<Record<string, string | number | boolean | null>>,
  names: readonly string[],
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    names
      .filter((name) => Object.hasOwn(parameters, name))
      .map((name) => [name, parameters[name] ?? null]),
  );
}

function versionRef(reference: {
  versionId: string;
  fingerprint: string;
}) {
  return {
    id: reference.versionId,
    version: "immutable",
    fingerprint: reference.fingerprint,
  };
}

function valuesDiffer(values: readonly string[]): boolean {
  return new Set(values).size > 1;
}

function configurationDiff(participants: ExperimentParticipant[]) {
  const fields = new Set<string>([
    "strategyFingerprint",
    "graphFingerprint",
    "agentGraphFingerprint",
    "promptSetFingerprint",
    "riskFingerprint",
    "executionFingerprint",
  ]);
  for (const participant of participants) {
    for (const key of Object.keys(participant.configProjection.effectiveParameters)) {
      fields.add(`parameter.${key}`);
    }
  }
  return [...fields]
    .sort()
    .map((field) => ({
      field,
      values: participants.map((participant) => {
        const direct: Record<string, string> = {
          strategyFingerprint: participant.strategyFingerprint,
          graphFingerprint: participant.configProjection.graphFingerprint,
          agentGraphFingerprint:
            participant.configProjection.agentGraphFingerprint,
          promptSetFingerprint:
            participant.configProjection.promptSetFingerprint,
          riskFingerprint: participant.configProjection.riskFingerprint,
          executionFingerprint:
            participant.configProjection.executionFingerprint,
        };
        return {
          participantId: participant.participantId,
          value: field.startsWith("parameter.")
            ? (participant.configProjection.effectiveParameters[
                field.slice("parameter.".length)
              ] ?? null)
            : direct[field]!,
        };
      }),
    }))
    .filter(
      (entry) =>
        new Set(entry.values.map((value) => JSON.stringify(value.value))).size > 1,
    );
}

export function deriveExperimentComparability(
  requestedMode: Experiment["comparability"]["requestedMode"],
  participants: ExperimentParticipant[],
): Experiment["comparability"] {
  const changed = new Set<Experiment["comparability"]["changedDimensions"][number]>([
    "strategy",
  ]);
  const projection = participants.map((participant) => participant.configProjection);
  if (valuesDiffer(projection.map((item) => item.marketPackId))) changed.add("market");
  if (valuesDiffer(projection.map((item) => item.executionFingerprint))) {
    changed.add("execution");
  }
  if (valuesDiffer(projection.map((item) => item.riskFingerprint))) changed.add("risk");
  if (valuesDiffer(projection.map((item) => item.modelFingerprint))) changed.add("model");
  if (valuesDiffer(projection.map((item) => item.promptSetFingerprint))) {
    changed.add("prompt");
  }
  if (valuesDiffer(projection.map((item) => item.graphFingerprint))) changed.add("graph");
  if (valuesDiffer(projection.map((item) => item.agentGraphFingerprint))) {
    changed.add("agent_graph");
  }

  const allDimensions = [
    "dataset",
    "range",
    "market",
    "execution",
    "risk",
    "model",
    "prompt",
    "graph",
    "agent_graph",
  ] as const;
  const changedDimensions = [...changed].sort();
  const lockedDimensions = allDimensions.filter((item) => !changed.has(item));
  if (changed.has("market")) {
    return {
      status: "INCOMPATIBLE",
      requestedMode,
      changedDimensions,
      lockedDimensions,
      issueCodes: ["INCOMPATIBLE_MARKET_DRIFT"],
    };
  }
  if (requestedMode === "MODEL_COMPARISON") {
    return {
      status: "INCOMPATIBLE",
      requestedMode,
      changedDimensions,
      lockedDimensions,
      issueCodes: ["MODEL_COMPARISON_UNSUPPORTED"],
    };
  }
  if (requestedMode === "OPEN_CLASS") {
    return {
      status: "OPEN_CLASS",
      requestedMode,
      changedDimensions,
      lockedDimensions,
      issueCodes: ["OPEN_CLASS_REQUESTED"],
    };
  }
  const allowed =
    requestedMode === "STRATEGY_COMPARISON"
      ? new Set(["strategy", "prompt"])
      : new Set(["strategy", "graph", "agent_graph"]);
  const drift = changedDimensions.filter((dimension) => !allowed.has(dimension));
  const hasDeclaredVariation =
    requestedMode === "STRATEGY_COMPARISON"
      ? changed.has("strategy")
      : changed.has("graph") || changed.has("agent_graph");
  if (!hasDeclaredVariation && requestedMode === "AGENT_GRAPH_COMPARISON") {
    return {
      status: "INCOMPATIBLE",
      requestedMode,
      changedDimensions,
      lockedDimensions,
      issueCodes: ["AGENT_GRAPH_VARIATION_REQUIRED"],
    };
  }
  return drift.length === 0
    ? {
        status: "CONTROLLED",
        requestedMode,
        changedDimensions,
        lockedDimensions,
        issueCodes: [],
      }
    : {
        status: "OPEN_CLASS",
        requestedMode,
        changedDimensions,
        lockedDimensions,
        issueCodes: ["OPEN_CLASS_LOCK_DRIFT"],
      };
}

function projectArtifactEvidence(
  rawArtifact: unknown,
  expected: { plan: string; dataset: string; profile: string },
  runtimeFailureCount = 0,
): ExperimentEvidence {
  const artifact = GraphEvidenceArtifactSchema.parse(rawArtifact);
  const verified = verifyGraphEvidenceArtifact(artifact, {
    planFingerprint: expected.plan,
    datasetFingerprint: expected.dataset,
    profileScopeFingerprint: expected.profile,
  });
  if (!verified.valid) throw new Error("EXPERIMENT_EVIDENCE_INVALID");
  const common = {
    evidenceRef: artifact.evidenceRef,
    artifactId: artifact.artifactId,
    artifactFingerprint: artifact.manifestFingerprint,
    resultFingerprint: artifact.resultFingerprint,
    manifestFingerprint: artifact.manifestFingerprint,
    promotionEligible: artifact.promotionEligible,
    lineage: {
      planRef: artifact.planRef,
      datasetRef: artifact.datasetRef,
      profileScopeRef: artifact.profileScopeRef,
    },
  };
  if (artifact.result.lifecycleStatus === "succeeded" && "metrics" in artifact.result) {
    if (artifact.result.metrics.mode !== "trading") {
      throw new Error("EXPERIMENT_METRIC_MODE_INCOMPATIBLE");
    }
    if (artifact.result.cycles.some((cycle) => cycle.outcome.mode !== "trading")) {
      throw new Error("EXPERIMENT_METRIC_MODE_INCOMPATIBLE");
    }
    return {
      ...common,
      scorecard: {
        totalReturnPct: artifact.result.metrics.totalReturnPct,
        maxDrawdownPct: artifact.result.metrics.maxDrawdownPct,
        tradeCount: artifact.result.metrics.tradeCount,
        fillCount: artifact.result.metrics.fillCount,
        riskRejectionCount: artifact.result.metrics.riskRejectionCount,
        cycleCount: artifact.result.metrics.cycleCount,
        runtimeFailureCount,
        equityPoints: artifact.result.cycles.map((cycle) => ({
          asOf: cycle.asOf,
          equity:
            cycle.outcome.mode === "trading" ? cycle.outcome.equity : 0,
        })),
        unavailableMetrics: ["sharpe", "sortino", "profit_factor"],
      },
    };
  }
  if (!("folds" in artifact.result)) {
    throw new Error("EXPERIMENT_EVIDENCE_KIND_INVALID");
  }
  const returns = artifact.result.folds.map((fold) => {
    if (fold.validationMetrics.mode !== "trading") {
      throw new Error("EXPERIMENT_METRIC_MODE_INCOMPATIBLE");
    }
    return fold.validationMetrics.totalReturnPct;
  });
  return {
    ...common,
    walkForward: {
      foldCount: artifact.result.folds.length,
      positiveValidation: returns.every((value) => value > 0),
      promotionEligible: artifact.result.promotionEligible,
      runtimeFailureCount,
      validationReturnsPct: returns,
    },
  };
}

function evaluateConstraints(
  experiment: Experiment,
  participant: ExperimentParticipant,
): ExperimentConstraintResult[] {
  const backtest = participant.backtestEvidence?.scorecard;
  const walkForward = participant.walkForwardEvidence?.walkForward;
  if (!backtest || !walkForward) return [];
  const configured = experiment.lock.constraints;
  const results: ExperimentConstraintResult[] = [];
  if (configured.maxDrawdownPctLte !== undefined) {
    results.push({
      key: "maxDrawdownPctLte",
      actual: backtest.maxDrawdownPct,
      expected: configured.maxDrawdownPctLte,
      status:
        backtest.maxDrawdownPct <= configured.maxDrawdownPctLte
          ? "PASS"
          : "FAIL",
    });
  }
  if (configured.minimumTradeCount !== undefined) {
    results.push({
      key: "minimumTradeCount",
      actual: backtest.tradeCount,
      expected: configured.minimumTradeCount,
      status:
        backtest.tradeCount >= configured.minimumTradeCount ? "PASS" : "FAIL",
    });
  }
  if (configured.walkForwardPositive !== undefined) {
    results.push({
      key: "walkForwardPositive",
      actual: walkForward.positiveValidation,
      expected: configured.walkForwardPositive,
      status:
        walkForward.positiveValidation === configured.walkForwardPositive
          ? "PASS"
          : "FAIL",
    });
  }
  if (configured.runtimeFailureCountEqZero === true) {
    const failures =
      backtest.runtimeFailureCount + walkForward.runtimeFailureCount;
    results.push({
      key: "runtimeFailureCountEqZero",
      actual: failures,
      expected: 0,
      status: failures === 0 ? "PASS" : "FAIL",
    });
  }
  return results;
}

function sameState(left: Experiment, right: Experiment): boolean {
  return graphEvidenceFingerprint(left) === graphEvidenceFingerprint(right);
}

export class ExperimentLabService {
  constructor(
    private readonly repository: SqliteExperimentRepository,
    private readonly drafts: ConfigurationDraftService,
    private readonly executable: ExecutableStrategyConfigurationService,
    private readonly datasets: RegisteredGraphHistoricalDatasetRegistry,
    private readonly plans: RegisteredGraphWalkForwardPlanRegistry,
    private readonly jobs: DurableGraphEvidenceJobService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  catalog(actorId: string): ExperimentCatalog {
    const participants = this.drafts
      .listStrategyVersionsByActor(actorId)
      .map((version) => {
        const validation = this.drafts.validate(version.versionId);
        const source = validation.valid
          ? this.executable.inspectSource(version.versionId)
          : { eligible: false, issueCodes: [] as string[] };
        const eligibility =
          version.runtimeApplied || version.evidenceState.status === "stale"
            ? "stale"
            : validation.valid && source.eligible
              ? "eligible"
              : validation.valid
                ? "unsupported"
                : "invalid";
        return {
          versionId: version.versionId,
          draftId: version.draftId,
          fingerprint: version.fingerprint,
          label: version.humanVersion,
          eligibility,
          issueCodes: [
            ...validation.issues.map((issue) => issue.code),
            ...source.issueCodes,
          ],
          runtimeApplied: false as const,
        };
      });
    return ExperimentCatalogSchema.parse({
      participants,
      datasets: this.datasets.list().map((dataset) => ({
        id: dataset.id,
        version: dataset.version,
        fingerprint: dataset.fingerprint,
        startAt: dataset.asOfSequence[0],
        endAt: dataset.asOfSequence.at(-1),
        timezone: dataset.timezone,
        tradingCalendarRef: dataset.tradingCalendarRef,
      })),
      walkForwardPlans: this.plans.list().map((plan) => ({
        id: plan.id,
        version: plan.version,
        fingerprint: plan.fingerprint,
      })),
      supportedComparisonModes: [
        "STRATEGY_COMPARISON",
        "AGENT_GRAPH_COMPARISON",
        "OPEN_CLASS",
      ],
      runtimeApplied: false,
      exchangeWriteAllowed: false,
    });
  }

  create(raw: unknown, actorId: string): Experiment {
    const request = ExperimentCreateRequestSchema.parse(raw);
    if (request.comparisonMode === "MODEL_COMPARISON") {
      throw new Error("MODEL_COMPARISON_UNSUPPORTED");
    }
    const dataset = this.datasets.require(request.datasetId);
    const walkForwardPlan = this.plans.require(request.walkForwardPlanId);
    if (
      !dataset.asOfSequence.includes(request.startAt) ||
      !dataset.asOfSequence.includes(request.endAt)
    ) {
      throw new Error("EXPERIMENT_RANGE_NOT_REGISTERED");
    }
    const participants = request.participantVersionIds.map((versionId) => {
      const version = this.drafts.get(versionId);
      const validation = this.drafts.validate(versionId);
      if (
        version.createdByActorId !== actorId ||
        version.payload.kind !== "strategy" ||
        version.runtimeApplied ||
        version.evidenceState.status === "stale" ||
        !validation.valid
      ) {
        throw new Error("EXPERIMENT_PARTICIPANT_NOT_ELIGIBLE");
      }
      const materialized = this.executable.materialize(versionId, actorId);
      if (materialized.marketPackRef.id !== dataset.marketPackRef.id) {
        throw new Error("EXPERIMENT_DATASET_MARKET_INCOMPATIBLE");
      }
      const executionParameters = safeParameters(
        materialized.effectiveParameters,
        ["initialCash", "feeBps", "slippageBps", "maxExecutionsPerCycle"],
      );
      const riskParameters = safeParameters(materialized.effectiveParameters, [
        "maxNotional",
        "maxLeverage",
        "leverage",
      ]);
      const promptPolicyRefs = materialized.promptPolicyRefs.map(versionRef);
      const agentConfigurationRefs =
        materialized.agentConfigurationRefs.map(versionRef);
      const modelMode = "rule" as const;
      const participant: ExperimentParticipant = {
        participantId: `participant:${version.fingerprint.slice(7, 31)}`,
        label: version.humanVersion,
        strategyVersionRef: versionRef(
          materialized.strategyConfigurationRef,
        ),
        strategyFingerprint: version.fingerprint,
        executableFingerprint: materialized.fingerprint,
        historicalPlanRef: materialized.historicalPlanRef,
        marketPackRef: materialized.marketPackRef,
        baseProfileRef: materialized.baseProfileRef,
        profileRef: {
          id: materialized.derivedProfile.id,
          version: materialized.derivedProfile.version,
          fingerprint: materialized.derivedProfile.fingerprint,
        },
        candidateSetRef: {
          id: materialized.derivedCandidateSet.id,
          version: materialized.derivedCandidateSet.version,
          fingerprint: materialized.derivedCandidateSet.fingerprint,
        },
        agentConfigurationRefs,
        promptPolicyRefs,
        configProjection: {
          marketPackId: version.payload.marketPackId,
          modelMode,
          executionFingerprint: graphEvidenceFingerprint(executionParameters),
          riskFingerprint: graphEvidenceFingerprint(riskParameters),
          modelFingerprint: graphEvidenceFingerprint({ modelMode }),
          promptSetFingerprint: graphEvidenceFingerprint(promptPolicyRefs),
          graphFingerprint: materialized.historicalPlanRef.fingerprint,
          agentGraphFingerprint: graphEvidenceFingerprint(
            agentConfigurationRefs,
          ),
          effectiveParameters: materialized.effectiveParameters,
        },
        constraintResults: [],
        issueCodes: [],
      };
      return participant;
    });
    participants.sort((left, right) =>
      left.participantId.localeCompare(right.participantId),
    );
    const comparability = deriveExperimentComparability(
      request.comparisonMode,
      participants,
    );
    const first = participants[0]!;
    const executionFingerprints = participants.map(
      (participant) => participant.configProjection.executionFingerprint,
    );
    const riskFingerprints = participants.map(
      (participant) => participant.configProjection.riskFingerprint,
    );
    const promptFingerprints = participants.map(
      (participant) => participant.configProjection.promptSetFingerprint,
    );
    const definition = {
      actorId,
      comparability,
      dataset: {
        datasetRef: {
          id: dataset.id,
          version: dataset.version,
          fingerprint: dataset.fingerprint,
        },
        marketPackRef: dataset.marketPackRef,
        dataSourceRef: dataset.dataSourceRef,
        timezone: dataset.timezone,
        tradingCalendarRef: dataset.tradingCalendarRef,
        startAt: request.startAt,
        endAt: request.endAt,
      },
      walkForwardPlanRef: {
        id: walkForwardPlan.id,
        version: walkForwardPlan.version,
        fingerprint: walkForwardPlan.fingerprint,
      },
      objective: request.objective,
      constraints: request.constraints,
      participants: participants.map(immutableParticipant),
    };
    const fingerprint = graphEvidenceFingerprint(definition);
    const experimentId = `experiment:${graphEvidenceFingerprint({
      actorId,
      idempotencyKey: request.idempotencyKey,
      fingerprint,
    }).slice(7, 31)}`;
    return this.repository.save(
      ExperimentSchema.parse({
        schemaVersion: "1.0.0",
        experimentId,
        fingerprint,
        createdAt: this.now().toISOString(),
        actorId,
        lifecycleStatus: "draft",
        comparability,
        lock: {
          dataset: definition.dataset,
          walkForwardPlanRef: definition.walkForwardPlanRef,
          objective: request.objective,
          constraints: request.constraints,
          execution: {
            model: "graph_trading",
            parameters: valuesDiffer(executionFingerprints)
              ? {}
              : safeParameters(first.configProjection.effectiveParameters, [
                  "initialCash",
                  "feeBps",
                  "slippageBps",
                  "maxExecutionsPerCycle",
                ]),
            fingerprint: graphEvidenceFingerprint(
              [...executionFingerprints].sort(),
            ),
            unavailableFields: [
              ["initialCash", "initial_capital"],
              ["feeBps", "fee_bps"],
              ["slippageBps", "slippage_bps"],
            ]
              .filter(([parameter]) =>
                participants.some(
                  (participant) =>
                    !Object.hasOwn(
                      participant.configProjection.effectiveParameters,
                      parameter!,
                    ),
                ),
              )
              .map(([, unavailable]) => unavailable),
          },
          risk: {
            parameters: valuesDiffer(riskFingerprints)
              ? {}
              : safeParameters(first.configProjection.effectiveParameters, [
                  "maxNotional",
                  "maxLeverage",
                  "leverage",
                ]),
            fingerprint: graphEvidenceFingerprint([...riskFingerprints].sort()),
          },
          modelPrompt: {
            modelMode: first.configProjection.modelMode,
            modelFingerprint: graphEvidenceFingerprint(
              participants
                .map(
                  (participant) => participant.configProjection.modelFingerprint,
                )
                .sort(),
            ),
            promptRefs: valuesDiffer(promptFingerprints)
              ? []
              : first.promptPolicyRefs,
            promptSetFingerprint: graphEvidenceFingerprint(
              [...promptFingerprints].sort(),
            ),
          },
          failurePolicy: "fail_closed",
          runtimeApplied: false,
          exchangeWriteAllowed: false,
        },
        participants,
        configurationDiff: configurationDiff(participants),
      }),
      request.idempotencyKey,
    );
  }

  get(id: string, actorId: string): Experiment {
    return this.repository.get(StableIdSchema.parse(id), actorId);
  }

  list(actorId: string, limit: number, cursor?: string) {
    return this.repository.list(actorId, limit, cursor);
  }

  async backtest(id: string, actorId: string): Promise<Experiment> {
    const current = this.get(id, actorId);
    if (current.comparability.status === "INCOMPATIBLE") {
      throw new Error("EXPERIMENT_INCOMPATIBLE");
    }
    const participants: ExperimentParticipant[] = [];
    for (const participant of current.participants) {
      if (participant.backtestEvidence) {
        participants.push(participant);
        continue;
      }
      try {
        const job = this.jobs.submitBacktest({
          schemaVersion: "1.0.0",
          planId: participant.historicalPlanRef.id,
          datasetId: current.lock.dataset.datasetRef.id,
          profileId: participant.profileRef.id,
          startAt: current.lock.dataset.startAt,
          endAt: current.lock.dataset.endAt,
          idempotencyKey: `experiment:${current.fingerprint}:backtest:${participant.participantId}`,
        });
        const completed = await this.jobs.run(
          job.jobId,
          `experiment:${current.experimentId}`,
        );
        participants.push({
          ...participant,
          backtestJobId: completed.jobId,
          backtestEvidence: projectArtifactEvidence(completed.evidence, {
            plan: participant.historicalPlanRef.fingerprint,
            dataset: current.lock.dataset.datasetRef.fingerprint,
            profile: participant.profileRef.fingerprint,
          }),
          issueCodes: participant.issueCodes.filter(
            (code) => code !== "BACKTEST_FAILED",
          ),
        });
      } catch {
        participants.push({
          ...participant,
          issueCodes: [...new Set([...participant.issueCodes, "BACKTEST_FAILED"])],
        });
      }
    }
    const next = ExperimentSchema.parse({
      ...current,
      participants,
      lifecycleStatus: participants.every(
        (participant) => participant.backtestEvidence,
      )
        ? "backtest_complete"
        : "backtest_partial",
    });
    return sameState(current, next) ? current : this.repository.append(next);
  }

  async walkForward(id: string, actorId: string): Promise<Experiment> {
    const current = this.get(id, actorId);
    if (!current.participants.every((participant) => participant.backtestEvidence)) {
      throw new Error("EXPERIMENT_BACKTEST_REQUIRED");
    }
    const participants: ExperimentParticipant[] = [];
    for (const participant of current.participants) {
      if (participant.walkForwardEvidence) {
        participants.push(participant);
        continue;
      }
      try {
        const job = this.jobs.submitWalkForward({
          schemaVersion: "1.0.0",
          planId: participant.historicalPlanRef.id,
          datasetId: current.lock.dataset.datasetRef.id,
          profileCandidateSetId: participant.candidateSetRef.id,
          walkForwardPlanId: current.lock.walkForwardPlanRef.id,
          startAt: current.lock.dataset.startAt,
          endAt: current.lock.dataset.endAt,
          idempotencyKey: `experiment:${current.fingerprint}:walk-forward:${participant.participantId}`,
        });
        const completed = await this.jobs.run(
          job.jobId,
          `experiment:${current.experimentId}`,
        );
        const withEvidence = ExperimentSchema.shape.participants.element.parse({
          ...participant,
          walkForwardJobId: completed.jobId,
          walkForwardEvidence: projectArtifactEvidence(completed.evidence, {
            plan: participant.historicalPlanRef.fingerprint,
            dataset: current.lock.dataset.datasetRef.fingerprint,
            profile: participant.candidateSetRef.fingerprint,
          }),
          issueCodes: participant.issueCodes.filter(
            (code) => code !== "WALK_FORWARD_FAILED",
          ),
        });
        participants.push({
          ...withEvidence,
          constraintResults: evaluateConstraints(current, withEvidence),
        });
      } catch {
        participants.push({
          ...participant,
          issueCodes: [
            ...new Set([...participant.issueCodes, "WALK_FORWARD_FAILED"]),
          ],
        });
      }
    }
    const next = ExperimentSchema.parse({
      ...current,
      participants,
      lifecycleStatus: participants.every(
        (participant) => participant.walkForwardEvidence,
      )
        ? "evidence_complete"
        : "walk_forward_partial",
    });
    return sameState(current, next) ? current : this.repository.append(next);
  }

  private requireReplayJob(
    jobId: string,
    kind: GraphEvidenceJob["kind"],
  ): GraphEvidenceJob & {
    status: "succeeded";
    evidence: GraphEvidenceArtifact;
  } {
    const job = this.jobs.get(jobId);
    if (job.kind !== kind || job.status !== "succeeded" || !job.evidence) {
      throw new Error("EXPERIMENT_REPLAY_DRIFT");
    }
    return job as GraphEvidenceJob & {
      status: "succeeded";
      evidence: GraphEvidenceArtifact;
    };
  }

  replay(id: string, actorId: string): Experiment {
    const current = this.get(id, actorId);
    if (current.replay) return current;
    const evidenceFingerprints: string[] = [];
    for (const participant of current.participants) {
      if (
        !participant.backtestEvidence ||
        !participant.walkForwardEvidence ||
        !participant.backtestJobId ||
        !participant.walkForwardJobId
      ) {
        throw new Error("EXPERIMENT_REPLAY_EVIDENCE_REQUIRED");
      }
      const backtest = this.requireReplayJob(
        participant.backtestJobId,
        "backtest",
      );
      const walkForward = this.requireReplayJob(
        participant.walkForwardJobId,
        "walk_forward",
      );
      const backtestRequest = GraphBacktestJobRequestSchema.parse(
        backtest.request,
      );
      const walkForwardRequest = GraphWalkForwardJobRequestSchema.parse(
        walkForward.request,
      );
      if (
        backtestRequest.planId !== participant.historicalPlanRef.id ||
        backtestRequest.datasetId !== current.lock.dataset.datasetRef.id ||
        backtestRequest.profileId !== participant.profileRef.id ||
        backtestRequest.startAt !== current.lock.dataset.startAt ||
        backtestRequest.endAt !== current.lock.dataset.endAt ||
        walkForwardRequest.planId !== participant.historicalPlanRef.id ||
        walkForwardRequest.datasetId !== current.lock.dataset.datasetRef.id ||
        walkForwardRequest.profileCandidateSetId !== participant.candidateSetRef.id ||
        walkForwardRequest.walkForwardPlanId !== current.lock.walkForwardPlanRef.id ||
        walkForwardRequest.startAt !== current.lock.dataset.startAt ||
        walkForwardRequest.endAt !== current.lock.dataset.endAt
      ) {
        throw new Error("EXPERIMENT_REPLAY_DRIFT");
      }
      const backtestProjection = projectArtifactEvidence(backtest.evidence, {
        plan: participant.historicalPlanRef.fingerprint,
        dataset: current.lock.dataset.datasetRef.fingerprint,
        profile: participant.profileRef.fingerprint,
      });
      const walkForwardProjection = projectArtifactEvidence(
        walkForward.evidence,
        {
          plan: participant.historicalPlanRef.fingerprint,
          dataset: current.lock.dataset.datasetRef.fingerprint,
          profile: participant.candidateSetRef.fingerprint,
        },
      );
      if (
        graphEvidenceFingerprint(backtestProjection) !==
          graphEvidenceFingerprint(participant.backtestEvidence) ||
        graphEvidenceFingerprint(walkForwardProjection) !==
          graphEvidenceFingerprint(participant.walkForwardEvidence)
      ) {
        throw new Error("EXPERIMENT_REPLAY_DRIFT");
      }
      evidenceFingerprints.push(
        backtest.evidence.manifestFingerprint,
        walkForward.evidence.manifestFingerprint,
      );
    }
    const evidenceFingerprint = graphEvidenceFingerprint(evidenceFingerprints);
    return this.repository.append(
      ExperimentSchema.parse({
        ...current,
        replay: {
          replayId: `replay:${current.fingerprint.slice(7, 31)}`,
          definitionFingerprint: current.fingerprint,
          evidenceFingerprint,
          resultFingerprint: graphEvidenceFingerprint({
            definition: current.fingerprint,
            evidenceFingerprint,
          }),
          status: "verified",
          issueCodes: [],
        },
      }),
    );
  }

  candidate(id: string, actorId: string): Experiment {
    const current = this.get(id, actorId);
    if (current.candidate) return current;
    if (
      current.comparability.status !== "CONTROLLED" ||
      current.lifecycleStatus !== "evidence_complete"
    ) {
      throw new Error("EXPERIMENT_CANDIDATE_NOT_ELIGIBLE");
    }
    const ranked = current.participants
      .filter(
        (participant) =>
          participant.backtestEvidence?.promotionEligible === true &&
          participant.walkForwardEvidence?.promotionEligible === true &&
          participant.constraintResults.every(
            (constraint) => constraint.status === "PASS",
          ),
      )
      .sort(
        (left, right) =>
          right.backtestEvidence!.scorecard!.totalReturnPct -
          left.backtestEvidence!.scorecard!.totalReturnPct,
      );
    if (
      ranked.length === 0 ||
      ranked[0]!.backtestEvidence!.scorecard!.totalReturnPct ===
        ranked[1]?.backtestEvidence?.scorecard?.totalReturnPct
    ) {
      throw new Error("EXPERIMENT_CANDIDATE_NOT_ELIGIBLE");
    }
    const winner = ranked[0]!;
    const evidenceFingerprint = graphEvidenceFingerprint([
      winner.backtestEvidence!.manifestFingerprint,
      winner.walkForwardEvidence!.manifestFingerprint,
    ]);
    return this.repository.append(
      ExperimentSchema.parse({
        ...current,
        candidate: {
          candidateId: `candidate:${graphEvidenceFingerprint({
            experiment: current.fingerprint,
            participant: winner.participantId,
            evidenceFingerprint,
          }).slice(7, 31)}`,
          status: "candidate_for_validation",
          fingerprint: graphEvidenceFingerprint({
            experiment: current.fingerprint,
            participant: winner.participantId,
            evidenceFingerprint,
            constraints: winner.constraintResults,
          }),
          participantId: winner.participantId,
          experimentFingerprint: current.fingerprint,
          evidenceFingerprint,
          constraintResults: winner.constraintResults,
          runtimeApplied: false,
        },
        lifecycleStatus: "candidate_ready",
      }),
    );
  }
}

async function parseEmptyBody(request: Request): Promise<void> {
  const text = await request.text();
  EmptyBodySchema.parse(text.length === 0 ? {} : JSON.parse(text));
}

function statusForCode(code: string): number {
  if (code.startsWith("AUTHORIZATION_")) return 401;
  if (code.includes("NOT_FOUND")) return 404;
  if (code.includes("CONFLICT")) return 409;
  return 400;
}

export class ExperimentLabHttpHandler {
  constructor(
    private readonly service: ExperimentLabService,
    private readonly authenticator: PipelineOrchestrationAuthenticator,
  ) {}

  async handle(request: Request): Promise<Response> {
    try {
      const actor = this.authenticator.authenticate(
        request.headers.get("authorization") ?? undefined,
      );
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === "/api/orchestration/experiments/catalog") {
        if (request.method !== "GET") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
        if ([...url.searchParams.keys()].length > 0) {
          throw new Error("EXPERIMENT_QUERY_INVALID");
        }
        return json(this.service.catalog(actor.actorId));
      }
      if (path === "/api/orchestration/experiments") {
        if (request.method === "GET") {
          const keys = [...url.searchParams.keys()];
          const limit = Number(url.searchParams.get("limit") ?? 20);
          if (
            keys.some((key) => key !== "limit" && key !== "cursor") ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 50
          ) {
            throw new Error("EXPERIMENT_CURSOR_INVALID");
          }
          return json(
            this.service.list(
              actor.actorId,
              limit,
              url.searchParams.get("cursor") ?? undefined,
            ),
          );
        }
        if (request.method === "POST") {
          return json(
            this.service.create(await request.json(), actor.actorId),
            201,
          );
        }
        return json({ code: "METHOD_NOT_ALLOWED" }, 405);
      }
      const actionMatch = path.match(
        /^\/api\/orchestration\/experiments\/([^/]+)\/(backtest|walk-forward|candidate|replay)$/u,
      );
      if (actionMatch) {
        if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
        if ([...url.searchParams.keys()].length > 0) {
          throw new Error("EXPERIMENT_QUERY_INVALID");
        }
        await parseEmptyBody(request);
        let id: string;
        try {
          id = StableIdSchema.parse(decodeURIComponent(actionMatch[1]!));
        } catch {
          throw new Error("EXPERIMENT_PATH_INVALID");
        }
        if (actionMatch[2] === "backtest") {
          return json(await this.service.backtest(id, actor.actorId));
        }
        if (actionMatch[2] === "walk-forward") {
          return json(await this.service.walkForward(id, actor.actorId));
        }
        if (actionMatch[2] === "candidate") {
          return json(this.service.candidate(id, actor.actorId), 201);
        }
        return json(this.service.replay(id, actor.actorId));
      }
      const detailMatch = path.match(
        /^\/api\/orchestration\/experiments\/([^/]+)$/u,
      );
      if (detailMatch) {
        if (request.method !== "GET") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
        if ([...url.searchParams.keys()].length > 0) {
          throw new Error("EXPERIMENT_QUERY_INVALID");
        }
        let id: string;
        try {
          id = StableIdSchema.parse(decodeURIComponent(detailMatch[1]!));
        } catch {
          throw new Error("EXPERIMENT_PATH_INVALID");
        }
        return json(this.service.get(id, actor.actorId));
      }
      return json({ code: "ROUTE_NOT_FOUND" }, 404);
    } catch (error) {
      const code = errorCode(error);
      return json({ code }, statusForCode(code));
    }
  }
}
