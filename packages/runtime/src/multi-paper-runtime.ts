import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  PaperDeploymentActionRequestSchema, PaperDeploymentCreateRequestSchema,
  PaperDeploymentDefinitionSchema, PaperDeploymentEventSchema, PaperDeploymentSchema,
  PaperDeploymentStateSchema, type PaperDeployment, type PaperDeploymentDefinition,
  type PaperDeploymentState, type PaperRuntimeOverviewPoint,
} from "../../contracts/src/index.js";

export class MultiPaperRuntimeError extends Error {
  constructor(readonly code: string) { super(code); }
}
type DeploymentEventKind = "created"|"preflight_passed"|"started"|"heartbeat"|"failed"|"stopping"|"stopped"|"archived"|"close_only";

export interface StrategyVersionMaterializer {
  materialize(actorId: string, strategyVersionId: string): {
    sourceFingerprint: string; datasetFingerprint: string; graphFingerprint: string;
    executionFingerprint: string; riskFingerprint: string;
  } | undefined;
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const nowIso = () => new Date().toISOString();
const state = (definition: PaperDeploymentDefinition): PaperDeploymentState => PaperDeploymentStateSchema.parse({
  deploymentId: definition.deploymentId, lifecycle: "draft", sourceFingerprint: definition.sourceFingerprint,
  latestCycle: 0, failureCount: 0, health: "stopped", runtimeApplied: false, exchangeWriteAllowed: false,
});

/** Append-only, actor-scoped deployment aggregate. Definitions and events are immutable. */
export class SqliteMultiPaperDeploymentRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS paper_deployment_definitions (
        deployment_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL, definition_json TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(actor_id, idempotency_key));
      CREATE TABLE IF NOT EXISTS paper_deployment_events (
        event_id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        event_kind TEXT NOT NULL, request_fingerprint TEXT, event_json TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(deployment_id, request_fingerprint));
      CREATE INDEX IF NOT EXISTS paper_deployment_actor_created ON paper_deployment_definitions(actor_id, created_at DESC, deployment_id DESC);
      CREATE INDEX IF NOT EXISTS paper_deployment_events_latest ON paper_deployment_events(deployment_id, created_at DESC);
      CREATE TRIGGER IF NOT EXISTS paper_deployment_definition_immutable BEFORE UPDATE ON paper_deployment_definitions BEGIN SELECT RAISE(ABORT, 'PAPER_DEPLOYMENT_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS paper_deployment_definition_delete_forbidden BEFORE DELETE ON paper_deployment_definitions BEGIN SELECT RAISE(ABORT, 'PAPER_DEPLOYMENT_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS paper_deployment_event_immutable BEFORE UPDATE ON paper_deployment_events BEGIN SELECT RAISE(ABORT, 'PAPER_DEPLOYMENT_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS paper_deployment_event_delete_forbidden BEFORE DELETE ON paper_deployment_events BEGIN SELECT RAISE(ABORT, 'PAPER_DEPLOYMENT_IMMUTABLE'); END;
    `);
  }
  private deployment(row: { definition_json: string; event_json?: string }): PaperDeployment {
    const definition = PaperDeploymentDefinitionSchema.parse(JSON.parse(row.definition_json));
    return PaperDeploymentSchema.parse({ definition, state: row.event_json ? JSON.parse(row.event_json).state : state(definition) });
  }
  create(definition: PaperDeploymentDefinition, idempotencyKey: string): PaperDeployment {
    const parsed = PaperDeploymentDefinitionSchema.parse(definition); const requestFingerprint = hash(parsed);
    const existing = this.database.prepare("SELECT definition_json FROM paper_deployment_definitions WHERE actor_id=? AND idempotency_key=?").get(parsed.actorId, idempotencyKey) as {definition_json:string}|undefined;
    if (existing) { const replay = PaperDeploymentDefinitionSchema.parse(JSON.parse(existing.definition_json)); if (hash(replay) !== requestFingerprint) throw new MultiPaperRuntimeError("IDEMPOTENCY_CONFLICT"); return this.get(parsed.actorId, replay.deploymentId); }
    const count = this.database.prepare("SELECT COUNT(*) AS n FROM paper_deployment_definitions d WHERE actor_id=? AND NOT EXISTS (SELECT 1 FROM paper_deployment_events e WHERE e.deployment_id=d.deployment_id AND e.event_kind='archived')").get(parsed.actorId) as {n:number};
    if (count.n >= 10) throw new MultiPaperRuntimeError("DEPLOYMENT_LIMIT_REACHED");
    this.database.prepare("INSERT INTO paper_deployment_definitions(deployment_id,actor_id,idempotency_key,request_fingerprint,definition_json,created_at) VALUES(?,?,?,?,?,?)").run(parsed.deploymentId, parsed.actorId, idempotencyKey, requestFingerprint, JSON.stringify(parsed), parsed.createdAt);
    this.append(parsed.actorId, parsed.deploymentId, "created", state(parsed), requestFingerprint);
    return this.get(parsed.actorId, parsed.deploymentId);
  }
  get(actorId: string, deploymentId: string): PaperDeployment {
    const row = this.database.prepare(`SELECT d.definition_json, e.event_json FROM paper_deployment_definitions d LEFT JOIN paper_deployment_events e ON e.rowid=(SELECT rowid FROM paper_deployment_events WHERE deployment_id=d.deployment_id ORDER BY rowid DESC LIMIT 1) WHERE d.actor_id=? AND d.deployment_id=?`).get(actorId, deploymentId) as {definition_json:string;event_json?:string}|undefined;
    if (!row) throw new MultiPaperRuntimeError("DEPLOYMENT_NOT_FOUND"); return this.deployment(row);
  }
  list(actorId: string, limit = 50): readonly PaperDeployment[] {
    return (this.database.prepare(`SELECT d.definition_json,e.event_json FROM paper_deployment_definitions d LEFT JOIN paper_deployment_events e ON e.rowid=(SELECT rowid FROM paper_deployment_events WHERE deployment_id=d.deployment_id ORDER BY rowid DESC LIMIT 1) WHERE d.actor_id=? ORDER BY d.created_at DESC,d.deployment_id DESC LIMIT ?`).all(actorId, Math.min(Math.max(limit,1),100)) as {definition_json:string;event_json?:string}[]).map((row)=>this.deployment(row));
  }
  append(actorId: string, deploymentId: string, kind: DeploymentEventKind, next: PaperDeploymentState, requestFingerprint?: string): PaperDeployment {
    const current = this.get(actorId, deploymentId); const event = PaperDeploymentEventSchema.parse({ eventId: `pde:${randomUUID()}`, deploymentId, actorId, kind, state: next, ...(requestFingerprint ? {requestFingerprint}:{}), createdAt: nowIso() });
    try { this.database.prepare("INSERT INTO paper_deployment_events(event_id,deployment_id,actor_id,event_kind,request_fingerprint,event_json,created_at) VALUES(?,?,?,?,?,?,?)").run(event.eventId,deploymentId,actorId,kind,requestFingerprint ?? null,JSON.stringify(event),event.createdAt); } catch { if (requestFingerprint) return this.get(actorId,deploymentId); throw new MultiPaperRuntimeError("DEPLOYMENT_EVENT_CONFLICT"); }
    return { definition: current.definition, state: event.state };
  }
}

const transitions: Record<string, readonly string[]> = { draft:["preflight_passed","archived"], preflight_passed:["running","archived"], running:["stopping","close_only","failed"], stopping:["stopped","close_only","failed"], close_only:["stopped","failed"], stopped:["preflight_passed","archived"], failed:["preflight_passed","archived"], archived:[] };
export class MultiPaperDeploymentService {
  constructor(private readonly repository: SqliteMultiPaperDeploymentRepository, private readonly versions: StrategyVersionMaterializer) {}
  create(actorId: string, raw: unknown): PaperDeployment { const request=PaperDeploymentCreateRequestSchema.parse(raw); const materialized=this.versions.materialize(actorId,request.strategyVersionId); if(!materialized) throw new MultiPaperRuntimeError("STRATEGY_VERSION_UNAVAILABLE"); const at=nowIso(); return this.repository.create({deploymentId:`paper:${randomUUID()}`,actorId,name:request.name,strategyVersionId:request.strategyVersionId,...materialized,accountId:`account:${randomUUID()}`,initialCapital:request.initialCapital,intervalMs:request.intervalMs,createdAt:at,runtimeApplied:false,exchangeWriteAllowed:false},request.idempotencyKey); }
  action(actorId: string, deploymentId: string, action: "preflight"|"start"|"stop"|"archive", raw: unknown): PaperDeployment { const request=PaperDeploymentActionRequestSchema.parse(raw); const current=this.repository.get(actorId,deploymentId); const target = action === "preflight" ? "preflight_passed" : action === "start" ? "running" : action === "stop" ? (current.state.lifecycle === "running" ? "stopping" : "stopped") : "archived"; if (request.sourceFingerprint && request.sourceFingerprint !== current.definition.sourceFingerprint) throw new MultiPaperRuntimeError("SOURCE_FINGERPRINT_STALE"); if (!transitions[current.state.lifecycle]?.includes(target)) { if (current.state.lifecycle===target) return current; throw new MultiPaperRuntimeError("DEPLOYMENT_TRANSITION_INVALID"); }
    const at=nowIso(); const next=PaperDeploymentStateSchema.parse({...current.state,lifecycle:target, ...(target==="running"?{startedAt:at,health:"healthy"}:{}) ,...(target==="stopped"?{stoppedAt:at,health:"stopped"}:{}),...(target==="archived"?{archivedAt:at,health:"stopped"}:{})}); return this.repository.append(actorId,deploymentId,target === "preflight_passed" ? "preflight_passed" : target === "running" ? "started" : target === "stopping" ? "stopping" : target === "stopped" ? "stopped" : "archived",next,hash({action,request})); }
}

export class BoundedMultiPaperScheduler {
  private active = new Set<string>();
  constructor(private readonly maximumConcurrency=2) {}
  async tick(deployments: readonly PaperDeployment[], execute: (deployment: PaperDeployment)=>Promise<void>): Promise<void> {
    const candidates=deployments.filter((d)=>d.state.lifecycle==="running"&&!this.active.has(d.definition.deploymentId)).slice(0,Math.max(0,this.maximumConcurrency-this.active.size));
    await Promise.all(candidates.map(async(d)=>{this.active.add(d.definition.deploymentId);try{await execute(d);}finally{this.active.delete(d.definition.deploymentId);}}));
  }
  get activeCount(): number { return this.active.size; }
}

export class ExecutableStrategyVersionMaterializer implements StrategyVersionMaterializer {
  constructor(private readonly configurations: { findByStrategyVersionId(id: string): { createdByActorId: string; sourceFingerprint: string; fingerprint: string; historicalPlanRef: { fingerprint: string }; derivedProfile: { fingerprint?: string }; } | undefined }) {}
  materialize(actorId: string, strategyVersionId: string) {
    const configuration = this.configurations.findByStrategyVersionId(strategyVersionId);
    if (!configuration || configuration.createdByActorId !== actorId) return undefined;
    // Every reference is server-owned and immutable; no client-provided execution facts enter here.
    return { sourceFingerprint: configuration.sourceFingerprint, datasetFingerprint: configuration.historicalPlanRef.fingerprint,
      graphFingerprint: configuration.fingerprint, executionFingerprint: configuration.fingerprint,
      riskFingerprint: configuration.derivedProfile.fingerprint ?? configuration.fingerprint };
  }
}

export function downsampleOverview(points: readonly {at:string; equity:number}[], initialCapital: number, maximum = 300): readonly PaperRuntimeOverviewPoint[] {
  const step=Math.max(1,Math.ceil(points.length/Math.max(1,maximum))); return points.filter((_,i)=>i%step===0||i===points.length-1).map((point)=>({at:point.at,equity:point.equity,normalizedReturnPct:((point.equity-initialCapital)/initialCapital)*100}));
}
