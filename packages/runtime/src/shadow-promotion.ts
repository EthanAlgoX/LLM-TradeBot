import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  PromotionPolicySchema,
  PromotionRecommendationSchema,
  ShadowComparisonSchema,
  ShadowDecisionContextSchema,
  ShadowDefinitionSchema,
  ShadowHistoryResponseSchema,
  ShadowObservationRequestSchema,
  ShadowRecordSchema,
  ShadowRunSchema,
  type PromotionPolicy,
  type PromotionRecommendation,
  type ShadowComparison,
  type ShadowDecisionContext,
  type ShadowDefinition,
  type ShadowRecord,
  type ShadowRun,
  type ShadowStrategySnapshot,
} from "../../contracts/src/index.js";
import {
  MultiPaperRuntimeError,
  SqliteMultiPaperDeploymentRepository,
  type StrategyVersionMaterializer,
} from "./multi-paper-runtime.js";

const hash = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const nowIso = () => new Date().toISOString();
const asObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asObjects = (value: unknown): readonly Record<string, unknown>[] => Array.isArray(value) ? value.map(asObject) : [];
const asString = (value: unknown): string | undefined => typeof value === "string" && value.length > 0 ? value : undefined;
const asNumber = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;

export class ShadowPromotionError extends Error {
  constructor(readonly code: string) { super(code); }
}

type ShadowProjectionKind = "run" | "cycle" | "comparison" | "recommendation";
type StoredDefinition = { definition_json: string };
type StoredProjection = { kind: ShadowProjectionKind; payload_json: string };

/**
 * Independent, append-only M5 storage.  It never references the Paper
 * account, orders, fills, journal, safety, or artifact tables for mutation.
 */
export class SqliteShadowPromotionRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS shadow_definitions (
        shadow_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, source_deployment_id TEXT NOT NULL,
        source_run_id TEXT NOT NULL, source_cycle_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL, definition_json TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(actor_id, idempotency_key),
        UNIQUE(actor_id, source_deployment_id, source_run_id, source_cycle_id));
      CREATE TABLE IF NOT EXISTS shadow_events (
        event_id TEXT PRIMARY KEY, shadow_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        event_kind TEXT NOT NULL, event_json TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(shadow_id, event_kind));
      CREATE TABLE IF NOT EXISTS shadow_projection_events (
        projection_id TEXT PRIMARY KEY, shadow_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('run','cycle','comparison','recommendation')),
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(shadow_id, kind));
      CREATE INDEX IF NOT EXISTS shadow_definition_actor_cursor ON shadow_definitions(actor_id, source_deployment_id, created_at DESC, shadow_id DESC);
      CREATE INDEX IF NOT EXISTS shadow_projection_actor_kind ON shadow_projection_events(actor_id, kind, created_at DESC, projection_id DESC);
      CREATE TRIGGER IF NOT EXISTS shadow_definition_immutable BEFORE UPDATE ON shadow_definitions BEGIN SELECT RAISE(ABORT, 'SHADOW_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS shadow_definition_delete_forbidden BEFORE DELETE ON shadow_definitions BEGIN SELECT RAISE(ABORT, 'SHADOW_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS shadow_event_immutable BEFORE UPDATE ON shadow_events BEGIN SELECT RAISE(ABORT, 'SHADOW_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS shadow_event_delete_forbidden BEFORE DELETE ON shadow_events BEGIN SELECT RAISE(ABORT, 'SHADOW_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS shadow_projection_immutable BEFORE UPDATE ON shadow_projection_events BEGIN SELECT RAISE(ABORT, 'SHADOW_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS shadow_projection_delete_forbidden BEFORE DELETE ON shadow_projection_events BEGIN SELECT RAISE(ABORT, 'SHADOW_IMMUTABLE'); END;
    `);
  }

  findByIdempotency(actorId: string, idempotencyKey: string): ShadowRecord | undefined {
    const row = this.database.prepare("SELECT shadow_id FROM shadow_definitions WHERE actor_id=? AND idempotency_key=?").get(actorId, idempotencyKey) as { shadow_id: string } | undefined;
    return row ? this.get(actorId, row.shadow_id) : undefined;
  }

  findBySource(actorId: string, deploymentId: string, runId: string, cycleId: string): ShadowRecord | undefined {
    const row = this.database.prepare("SELECT shadow_id FROM shadow_definitions WHERE actor_id=? AND source_deployment_id=? AND source_run_id=? AND source_cycle_id=?").get(actorId, deploymentId, runId, cycleId) as { shadow_id: string } | undefined;
    return row ? this.get(actorId, row.shadow_id) : undefined;
  }

  append(record: ShadowRecord, idempotencyKey: string): ShadowRecord {
    const parsed = ShadowRecordSchema.parse(record);
    const requestFingerprint = hash({ source: parsed.definition.source, idempotencyKey });
    const existing = this.findByIdempotency(parsed.definition.actorId, idempotencyKey);
    if (existing) {
      const existingFingerprint = hash({ source: existing.definition.source, idempotencyKey });
      if (existingFingerprint !== requestFingerprint) throw new ShadowPromotionError("SHADOW_IDEMPOTENCY_CONFLICT");
      return existing;
    }
    const sameSource = this.findBySource(parsed.definition.actorId, parsed.definition.source.sourceDeploymentId, parsed.definition.source.sourceRunId, parsed.definition.source.sourceCycleId);
    if (sameSource) return sameSource;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const definition = ShadowDefinitionSchema.parse(parsed.definition);
      this.database.prepare("INSERT INTO shadow_definitions(shadow_id,actor_id,source_deployment_id,source_run_id,source_cycle_id,idempotency_key,request_fingerprint,definition_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(definition.shadowId, definition.actorId, definition.source.sourceDeploymentId, definition.source.sourceRunId, definition.source.sourceCycleId, idempotencyKey, requestFingerprint, JSON.stringify(definition), definition.createdAt);
      this.database.prepare("INSERT INTO shadow_events(event_id,shadow_id,actor_id,event_kind,event_json,created_at) VALUES(?,?,?,?,?,?)").run(`shadow-event:${randomUUID()}`, definition.shadowId, definition.actorId, "created", JSON.stringify({ shadowId: definition.shadowId, source: definition.source, createdAt: definition.createdAt }), definition.createdAt);
      const projections: Array<[ShadowProjectionKind, ShadowRun | ShadowDecisionContext | ShadowComparison | PromotionRecommendation]> = [
        ["run", parsed.run], ["cycle", parsed.cycle], ["recommendation", parsed.recommendation],
      ];
      if (parsed.comparison) projections.push(["comparison", parsed.comparison]);
      for (const [kind, payload] of projections) {
        this.database.prepare("INSERT INTO shadow_projection_events(projection_id,shadow_id,actor_id,kind,payload_json,created_at) VALUES(?,?,?,?,?,?)").run(`shadow-projection:${randomUUID()}`, definition.shadowId, definition.actorId, kind, JSON.stringify(payload), definition.createdAt);
      }
      this.database.exec("COMMIT");
      return parsed;
    } catch (cause) {
      this.database.exec("ROLLBACK");
      if (cause instanceof ShadowPromotionError) throw cause;
      // A second service/process can win the unique source or idempotency
      // race after the optimistic reads above. Recover its immutable record
      // rather than creating another Shadow observation or surfacing a
      // transient write race as an executable retry instruction.
      const replay = this.findByIdempotency(parsed.definition.actorId, idempotencyKey);
      if (replay) {
        const replayFingerprint = hash({ source: replay.definition.source, idempotencyKey });
        if (replayFingerprint !== requestFingerprint) throw new ShadowPromotionError("SHADOW_IDEMPOTENCY_CONFLICT");
        return replay;
      }
      const sourceReplay = this.findBySource(parsed.definition.actorId, parsed.definition.source.sourceDeploymentId, parsed.definition.source.sourceRunId, parsed.definition.source.sourceCycleId);
      if (sourceReplay) return sourceReplay;
      throw new ShadowPromotionError("SHADOW_APPEND_CONFLICT");
    }
  }

  get(actorId: string, shadowId: string): ShadowRecord {
    const definitionRow = this.database.prepare("SELECT definition_json FROM shadow_definitions WHERE actor_id=? AND shadow_id=?").get(actorId, shadowId) as StoredDefinition | undefined;
    if (!definitionRow) throw new ShadowPromotionError("SHADOW_NOT_FOUND");
    const projections = this.database.prepare("SELECT kind,payload_json FROM shadow_projection_events WHERE shadow_id=? AND actor_id=?").all(shadowId, actorId) as StoredProjection[];
    const byKind = new Map(projections.map(row => [row.kind, JSON.parse(row.payload_json)]));
    const definition = ShadowDefinitionSchema.parse(JSON.parse(definitionRow.definition_json));
    const run = ShadowRunSchema.parse(byKind.get("run"));
    const cycle = ShadowDecisionContextSchema.parse(byKind.get("cycle"));
    const recommendation = PromotionRecommendationSchema.parse(byKind.get("recommendation"));
    const comparison = byKind.has("comparison") ? ShadowComparisonSchema.parse(byKind.get("comparison")) : undefined;
    return ShadowRecordSchema.parse({ definition, run, cycle, ...(comparison ? { comparison } : {}), recommendation });
  }

  list(actorId: string, deploymentId: string, limit = 20, cursor?: string): { data: readonly ShadowRecord[]; nextCursor?: string } {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const parts = cursor ? Buffer.from(cursor, "base64url").toString("utf8").split("|") : undefined;
    if (parts && (parts.length !== 3 || parts[0] !== actorId || parts[1] !== deploymentId)) throw new ShadowPromotionError("SHADOW_CURSOR_INVALID");
    const anchor = parts?.[2]?.split(",");
    const rows = (anchor
      ? this.database.prepare("SELECT shadow_id,created_at FROM shadow_definitions WHERE actor_id=? AND source_deployment_id=? AND (created_at < ? OR (created_at=? AND shadow_id < ?)) ORDER BY created_at DESC,shadow_id DESC LIMIT ?").all(actorId, deploymentId, anchor[0], anchor[0], anchor[1], safeLimit + 1)
      : this.database.prepare("SELECT shadow_id,created_at FROM shadow_definitions WHERE actor_id=? AND source_deployment_id=? ORDER BY created_at DESC,shadow_id DESC LIMIT ?").all(actorId, deploymentId, safeLimit + 1)) as { shadow_id: string; created_at: string }[];
    const page = rows.slice(0, safeLimit);
    const tail = page.at(-1);
    return ShadowHistoryResponseSchema.parse({ data: page.map(row => this.get(actorId, row.shadow_id)), ...(rows.length > safeLimit && tail ? { nextCursor: Buffer.from(`${actorId}|${deploymentId}|${tail.created_at},${tail.shadow_id}`).toString("base64url") } : {}) });
  }

  comparableCycleCount(actorId: string, definition: ShadowDefinition): number {
    if (!definition.challenger) return 0;
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM shadow_definitions d
      JOIN shadow_projection_events p ON p.shadow_id=d.shadow_id AND p.kind='comparison'
      WHERE d.actor_id=? AND d.source_deployment_id=?
        AND json_extract(d.definition_json, '$.champion.strategyVersionId')=?
        AND json_extract(d.definition_json, '$.challenger.strategyVersionId')=?
    `).get(actorId, definition.source.sourceDeploymentId, definition.champion.strategyVersionId, definition.challenger.strategyVersionId) as { count: number };
    return row.count;
  }
}

export interface RegisteredShadowDecisionEvidenceAdapter {
  readonly adapterId: string;
  readonly adapterFingerprint: string;
  readonly runtimeApplied: false;
  readonly exchangeWriteAllowed: false;
  readonly executionReachable: false;
  evaluate(input: { sourceCycle: Record<string, unknown>; sourceArtifact: Record<string, unknown>; asOf: string }): { champion: ShadowDecisionContext["champion"]; challenger: ShadowDecisionContext["challenger"]; dataQuality: ShadowDecisionContext["dataQuality"]; health: ShadowDecisionContext["health"]; evidenceGaps: string[] };
}

/**
 * The registered M5 adapter is intentionally a read-only evidence adapter.
 * Its input is an immutable M4 cycle/artifact projection; it exposes no
 * Execution Port and does not retain any account, position, order, fill,
 * safety, journal, or Artifact writer.
 */
export class CurrentCryptoReadOnlyShadowAdapter implements RegisteredShadowDecisionEvidenceAdapter {
  readonly adapterId = "shadow-readonly-evidence:v1";
  readonly adapterFingerprint = hash({ adapter: this.adapterId, version: "1.0.0", capability: "decision_evidence_read_only" });
  readonly runtimeApplied = false as const;
  readonly exchangeWriteAllowed = false as const;
  readonly executionReachable = false as const;

  evaluate(input: { sourceCycle: Record<string, unknown>; sourceArtifact: Record<string, unknown>; asOf: string }) {
    const decisions = asObjects(input.sourceCycle.decision);
    const risk = asObjects(input.sourceCycle.risk);
    const artifactStages = asObjects(input.sourceArtifact.artifacts).map(artifact => asString(artifact.stage)).filter((stage): stage is string => Boolean(stage));
    const evidenceGaps: string[] = [];
    if (!Array.isArray(input.sourceCycle.decision)) evidenceGaps.push("SHADOW_DECISION_FACTS_UNAVAILABLE");
    if (!Array.isArray(input.sourceCycle.risk)) evidenceGaps.push("SHADOW_RISK_FACTS_UNAVAILABLE");
    if (!input.sourceCycle.account || typeof input.sourceCycle.account !== "object") evidenceGaps.push("SHADOW_ACCOUNT_SNAPSHOT_UNAVAILABLE");
    if (artifactStages.length === 0) evidenceGaps.push("SHADOW_ARTIFACT_LINEAGE_UNAVAILABLE");
    if (!artifactStages.includes("data")) evidenceGaps.push("SHADOW_DATA_QUALITY_EVIDENCE_UNAVAILABLE");
    const exposure = decisions.reduce((sum, decision) => sum + (asNumber(asObject(decision.orderIntent).notional) ?? 0), 0);
    const summary = {
      decisionCount: decisions.length,
      actions: [...new Set(decisions.map(decision => asString(decision.action)).filter((action): action is string => Boolean(action)))],
      riskRejectedCount: risk.filter(item => item.passed === false).length,
      expectedExposure: Array.isArray(input.sourceCycle.decision)
        ? { availability: "available" as const, grossNotional: exposure }
        : { availability: "unavailable" as const, reason: "SHADOW_DECISION_FACTS_UNAVAILABLE" },
    };
    // A candidate strategy is compared against the exact same immutable M4
    // context. The adapter deliberately does not fabricate market inputs or
    // simulate an execution; any unavailable evidence stays unavailable.
    return {
      champion: summary,
      challenger: summary,
      dataQuality: evidenceGaps.includes("SHADOW_DATA_QUALITY_EVIDENCE_UNAVAILABLE") ? "unavailable" as const : "available" as const,
      health: evidenceGaps.length ? "degraded" as const : input.sourceCycle.status === "ok" ? "healthy" as const : "degraded" as const,
      evidenceGaps,
    };
  }
}

const policy = (): PromotionPolicy => PromotionPolicySchema.parse({
  schemaVersion: "1.0.0", policyId: "shadow-promotion-policy:v1", version: "1.0.0",
  fingerprint: hash({ policy: "shadow-promotion-policy", version: "1.0.0", minimumComparableCycles: 5 }),
  minimumComparableCycles: 5, createdAt: "2026-08-02T00:00:00.000Z", runtimeApplied: false, exchangeWriteAllowed: false,
});

function strategy(definition: { strategyVersionId: string; sourceFingerprint: string; datasetFingerprint: string; graphFingerprint: string; executionFingerprint: string; riskFingerprint: string }): ShadowStrategySnapshot {
  return { strategyVersionId: definition.strategyVersionId, sourceFingerprint: definition.sourceFingerprint, datasetFingerprint: definition.datasetFingerprint, graphFingerprint: definition.graphFingerprint, executionFingerprint: definition.executionFingerprint, riskFingerprint: definition.riskFingerprint };
}

function strategyIsCurrent(versions: StrategyVersionMaterializer, actorId: string, value: ShadowStrategySnapshot): boolean {
  const current = versions.materialize(actorId, value.strategyVersionId);
  return Boolean(current && Object.entries(current).every(([key, fingerprint]) => value[key as keyof typeof current] === fingerprint));
}

/** M5 application service: server-selected source and challenger only. */
export class ShadowPromotionService {
  constructor(private readonly options: {
    shadows: SqliteShadowPromotionRepository;
    deployments: SqliteMultiPaperDeploymentRepository;
    versions: StrategyVersionMaterializer;
    adapter?: RegisteredShadowDecisionEvidenceAdapter;
    now?: () => Date;
  }) {}

  observe(actorId: string, sourceDeploymentId: string, raw: unknown): ShadowRecord {
    const request = ShadowObservationRequestSchema.parse(raw);
    const existing = this.options.shadows.findByIdempotency(actorId, request.idempotencyKey);
    if (existing) {
      const same = existing.definition.source.sourceDeploymentId === sourceDeploymentId && existing.definition.source.sourceRunId === request.sourceRunId && existing.definition.source.sourceCycleId === request.sourceCycleId;
      if (!same) throw new ShadowPromotionError("SHADOW_IDEMPOTENCY_CONFLICT");
      return existing;
    }
    const recovered = this.options.shadows.findBySource(actorId, sourceDeploymentId, request.sourceRunId, request.sourceCycleId);
    if (recovered) return recovered;

    const sourceDeployment = this.options.deployments.get(actorId, sourceDeploymentId);
    const sourceCycle = this.options.deployments.projectionByFactKey(actorId, sourceDeploymentId, "cycle", request.sourceCycleId);
    if (!sourceCycle) throw new ShadowPromotionError("SHADOW_SOURCE_CYCLE_UNAVAILABLE");
    if (asString(sourceCycle.runId) !== request.sourceRunId) throw new ShadowPromotionError("SHADOW_SOURCE_SCOPE_AMBIGUOUS");
    const asOf = asString(sourceCycle.startedAt) ?? asString(sourceCycle.finishedAt);
    if (!asOf) throw new ShadowPromotionError("SHADOW_SOURCE_AS_OF_UNAVAILABLE");
    const sourceArtifact = this.options.deployments.projectionByFactKey(actorId, sourceDeploymentId, "artifact", request.sourceCycleId) ?? {};
    const source = {
      actorId, sourceDeploymentId, sourceRunId: request.sourceRunId, sourceCycleId: request.sourceCycleId,
      sourceCycleFingerprint: hash({ definition: sourceDeployment.definition, cycle: sourceCycle }),
      sourceArtifactFingerprint: hash({ artifact: sourceArtifact }), asOf,
    };
    const champion = strategy(sourceDeployment.definition);
    const drifted = !strategyIsCurrent(this.options.versions, actorId, champion);
    const challengerDeployment = this.options.deployments.list(actorId, 100).find(deployment => deployment.definition.deploymentId !== sourceDeploymentId && deployment.definition.strategyVersionId !== sourceDeployment.definition.strategyVersionId && deployment.state.lifecycle !== "archived");
    const challenger = challengerDeployment ? strategy(challengerDeployment.definition) : undefined;
    const challengerDrifted = challenger ? !strategyIsCurrent(this.options.versions, actorId, challenger) : false;
    const adapter = this.options.adapter ?? new CurrentCryptoReadOnlyShadowAdapter();
    if (adapter.runtimeApplied || adapter.exchangeWriteAllowed || adapter.executionReachable) throw new ShadowPromotionError("SHADOW_ADAPTER_NOT_READ_ONLY");
    const createdAt = (this.options.now ?? (() => new Date()))().toISOString();
    const shadowId = `shadow:${randomUUID()}`;
    const runId = `shadow-run:${randomUUID()}`;
    const cycleId = `shadow-cycle:${randomUUID()}`;
    const definition = ShadowDefinitionSchema.parse({ schemaVersion: "1.0.0", shadowId, actorId, source, champion, ...(challenger ? { challenger } : {}), adapterId: adapter.adapterId, adapterFingerprint: adapter.adapterFingerprint, createdAt, runtimeApplied: false, exchangeWriteAllowed: false, executionReachable: false });
    const initialIssues = [
      ...(drifted ? ["SHADOW_CHAMPION_LINEAGE_STALE"] : []),
      ...(challengerDrifted ? ["SHADOW_CHALLENGER_LINEAGE_STALE"] : []),
      ...(!challenger ? ["SHADOW_CHALLENGER_UNAVAILABLE"] : []),
      ...(Object.keys(sourceArtifact).length === 0 ? ["SHADOW_ARTIFACT_LINEAGE_UNAVAILABLE"] : []),
    ];
    const evaluation = initialIssues.length === 0 ? adapter.evaluate({ sourceCycle, sourceArtifact, asOf }) : undefined;
    const status = drifted || challengerDrifted ? "stale" as const : initialIssues.length ? "unavailable" as const : evaluation!.evidenceGaps.length ? "unavailable" as const : "succeeded" as const;
    const issueCodes = [...new Set([...initialIssues, ...(evaluation?.evidenceGaps ?? [])])];
    const run = ShadowRunSchema.parse({ schemaVersion: "1.0.0", shadowRunId: runId, shadowId, actorId, source, status, issueCodes, startedAt: createdAt, completedAt: createdAt, fingerprint: hash({ shadowId, source, status, issueCodes }), runtimeApplied: false, exchangeWriteAllowed: false, executionReachable: false });
    const context = ShadowDecisionContextSchema.parse({ schemaVersion: "1.0.0", shadowCycleId: cycleId, shadowId, shadowRunId: runId, actorId, source, status, ...(evaluation ? { champion: evaluation.champion, challenger: evaluation.challenger } : {}), dataQuality: status === "stale" ? "stale" : evaluation?.dataQuality ?? "unavailable", health: status === "stale" ? "stale" : evaluation?.health ?? "unavailable", evidenceGaps: issueCodes, createdAt, fingerprint: hash({ cycleId, source, status, evaluation, issueCodes }), runtimeApplied: false, exchangeWriteAllowed: false, executionReachable: false });
    const comparison = status === "succeeded" && evaluation ? ShadowComparisonSchema.parse({
      schemaVersion: "1.0.0", comparisonId: `shadow-comparison:${randomUUID()}`, shadowId, shadowRunId: runId, shadowCycleId: cycleId, actorId, source, status,
      decision: JSON.stringify(evaluation.champion?.actions) === JSON.stringify(evaluation.challenger?.actions) ? "same" : "different",
      risk: evaluation.champion?.riskRejectedCount === evaluation.challenger?.riskRejectedCount ? "same" : "different",
      expectedExposure: evaluation.champion?.expectedExposure.grossNotional === evaluation.challenger?.expectedExposure.grossNotional ? "same" : "different",
      dataQuality: "same", health: "same", evidenceGaps: [],
      note: "Descriptive same-scope snapshot comparison only; it is not a causal claim or return guarantee.", createdAt,
      fingerprint: hash({ shadowId, source, champion: evaluation.champion, challenger: evaluation.challenger }), runtimeApplied: false, exchangeWriteAllowed: false,
    }) : undefined;
    const promotionPolicy = policy();
    const comparableCycleCount = comparison ? this.options.shadows.comparableCycleCount(actorId, definition) + 1 : 0;
    const recommendationStatus = !comparison ? "insufficient_data" as const : comparableCycleCount < promotionPolicy.minimumComparableCycles ? "insufficient_data" as const : comparison.decision === "different" || comparison.risk === "different" ? "recommend_validation" as const : "observe" as const;
    const reasons = !comparison ? [`Shadow evidence is ${status}; ${issueCodes.join(", ") || "comparison unavailable"}.`] : recommendationStatus === "insufficient_data" ? [`Only ${comparableCycleCount}/${promotionPolicy.minimumComparableCycles} comparable immutable Shadow cycles are available.`] : recommendationStatus === "recommend_validation" ? ["A descriptive same-scope divergence is recorded; request later validation without applying Runtime."] : ["Comparable observations are descriptive and do not justify approval, deployment, or replacement."];
    const recommendation = PromotionRecommendationSchema.parse({ schemaVersion: "1.0.0", recommendationId: `shadow-recommendation:${randomUUID()}`, shadowId, shadowRunId: runId, shadowCycleId: cycleId, ...(comparison ? { comparisonId: comparison.comparisonId } : {}), actorId, source, policy: promotionPolicy, status: recommendationStatus, comparableCycleCount, reasons, terminal: true, readOnly: true, createdAt, fingerprint: hash({ shadowId, source, policy: promotionPolicy.fingerprint, recommendationStatus, comparableCycleCount, issueCodes }), runtimeApplied: false, exchangeWriteAllowed: false, executionReachable: false });
    return this.options.shadows.append({ definition, run, cycle: context, ...(comparison ? { comparison } : {}), recommendation }, request.idempotencyKey);
  }

  list(actorId: string, deploymentId: string, limit?: number, cursor?: string) {
    this.options.deployments.get(actorId, deploymentId);
    return this.options.shadows.list(actorId, deploymentId, limit, cursor);
  }
}
