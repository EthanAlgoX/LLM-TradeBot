import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  PaperDeploymentActionRequestSchema, PaperDeploymentCreateRequestSchema,
  PaperDeploymentDefinitionSchema, PaperDeploymentEventSchema, PaperDeploymentSchema,
  PaperDeploymentStateSchema, type PaperDeployment, type PaperDeploymentDefinition,
  type PaperDeploymentState, type PaperRuntimeOverviewPoint,
} from "../../contracts/src/index.js";
import type { RegisteredPaperRuntimeBinding } from "./paper-runtime-activation.js";

export class MultiPaperRuntimeError extends Error {
  constructor(readonly code: string) { super(code); }
}
type DeploymentEventKind = "created"|"preflight_passed"|"started"|"heartbeat"|"failed"|"stopping"|"stopped"|"archived"|"close_only";
type ProjectionKind = "run"|"cycle"|"trade"|"artifact";
type DeploymentLease = { deploymentId: string; runId: string; ownerId: string; fencingToken: number; expiresAt: string };

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
const compactTraceEvent = (value: unknown): Record<string, unknown> => {
  const event = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { stage: event.stage, agent: event.agent, phase: event.phase, at: event.at };
};
const compactArtifact = (value: unknown): Record<string, unknown> => {
  const artifact = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    artifactId: artifact.artifactId, traceId: artifact.traceId, stage: artifact.stage,
    agent: artifact.agent, agentVersion: artifact.agentVersion, status: artifact.status,
    symbol: artifact.symbol, orderId: artifact.orderId, tradeId: artifact.tradeId,
    sourceArtifactIds: artifact.sourceArtifactIds,
  };
};

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
      CREATE TABLE IF NOT EXISTS paper_deployment_projection_events (
        projection_id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('run','cycle','trade','artifact')), fact_key TEXT, payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS paper_deployment_projection_cursor ON paper_deployment_projection_events(actor_id, deployment_id, kind, created_at DESC, projection_id DESC);
      CREATE TABLE IF NOT EXISTS paper_deployment_fencing_counters (
        deployment_id TEXT PRIMARY KEY, last_token INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS paper_deployment_leases (
        deployment_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, owner_id TEXT NOT NULL,
        fencing_token INTEGER NOT NULL, status TEXT NOT NULL, expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS paper_deployment_definition_immutable BEFORE UPDATE ON paper_deployment_definitions BEGIN SELECT RAISE(ABORT, 'PAPER_DEPLOYMENT_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS paper_deployment_definition_delete_forbidden BEFORE DELETE ON paper_deployment_definitions BEGIN SELECT RAISE(ABORT, 'PAPER_DEPLOYMENT_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS paper_deployment_event_immutable BEFORE UPDATE ON paper_deployment_events BEGIN SELECT RAISE(ABORT, 'PAPER_DEPLOYMENT_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS paper_deployment_event_delete_forbidden BEFORE DELETE ON paper_deployment_events BEGIN SELECT RAISE(ABORT, 'PAPER_DEPLOYMENT_IMMUTABLE'); END;
    `);
    try { database.exec("ALTER TABLE paper_deployment_projection_events ADD COLUMN fact_key TEXT;"); } catch { /* Existing M4 workspaces already have the compatible column. */ }
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS paper_deployment_projection_fact_once ON paper_deployment_projection_events(deployment_id, kind, fact_key) WHERE fact_key IS NOT NULL;");
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
  /** Immutable operational projections. Payloads are server-produced only. */
  appendProjection(actorId: string, deploymentId: string, kind: ProjectionKind, payload: Record<string, unknown>, factKey?: string): void {
    this.get(actorId, deploymentId);
    const createdAt = nowIso();
    try {
      this.database.prepare("INSERT INTO paper_deployment_projection_events(projection_id,deployment_id,actor_id,kind,fact_key,payload_json,created_at) VALUES(?,?,?,?,?,?,?)").run(`pdp:${randomUUID()}`, deploymentId, actorId, kind, factKey ?? null, JSON.stringify(payload), createdAt);
    } catch {
      if (!factKey) throw new MultiPaperRuntimeError("PROJECTION_CONFLICT");
    }
  }
  projections(actorId: string, deploymentId: string, kind: ProjectionKind, limit = 50, cursor?: string): { data: readonly Record<string, unknown>[]; nextCursor?: string } {
    this.get(actorId, deploymentId);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const cursorParts = cursor ? Buffer.from(cursor, "base64url").toString("utf8").split("|") : undefined;
    if (cursorParts && (cursorParts.length !== 4 || cursorParts[0] !== actorId || cursorParts[1] !== deploymentId || cursorParts[2] !== kind)) throw new MultiPaperRuntimeError("CURSOR_INVALID");
    const rows = (cursorParts
      ? this.database.prepare("SELECT projection_id,payload_json,created_at FROM paper_deployment_projection_events WHERE actor_id=? AND deployment_id=? AND kind=? AND (created_at < ? OR (created_at=? AND projection_id < ?)) ORDER BY created_at DESC,projection_id DESC LIMIT ?").all(actorId,deploymentId,kind,cursorParts[3]!.split(",")[0],cursorParts[3]!.split(",")[0],cursorParts[3]!.split(",")[1],safeLimit + 1)
      : this.database.prepare("SELECT projection_id,payload_json,created_at FROM paper_deployment_projection_events WHERE actor_id=? AND deployment_id=? AND kind=? ORDER BY created_at DESC,projection_id DESC LIMIT ?").all(actorId,deploymentId,kind,safeLimit + 1)) as {projection_id:string;payload_json:string;created_at:string}[];
    const page = rows.slice(0, safeLimit);
    const tail = page.at(-1);
    return { data: page.map((row) => JSON.parse(row.payload_json) as Record<string, unknown>), ...(rows.length > safeLimit && tail ? { nextCursor: Buffer.from(`${actorId}|${deploymentId}|${kind}|${tail.created_at},${tail.projection_id}`).toString("base64url") } : {}) };
  }
  recoverable(): readonly PaperDeployment[] {
    return (this.database.prepare(`SELECT d.definition_json,e.event_json FROM paper_deployment_definitions d JOIN paper_deployment_events e ON e.rowid=(SELECT rowid FROM paper_deployment_events WHERE deployment_id=d.deployment_id ORDER BY rowid DESC LIMIT 1) WHERE json_extract(e.event_json, '$.state.lifecycle') IN ('running','stopping','close_only') ORDER BY d.created_at ASC,d.deployment_id ASC`).all() as {definition_json:string;event_json:string}[]).map((row)=>this.deployment(row));
  }
  updateRuntimeState(actorId: string, deploymentId: string, kind: Exclude<DeploymentEventKind, "created"|"preflight_passed"|"started"|"archived">, patch: Partial<PaperDeploymentState>): PaperDeployment {
    const current = this.get(actorId, deploymentId);
    return this.append(actorId, deploymentId, kind, PaperDeploymentStateSchema.parse({ ...current.state, ...patch, deploymentId, sourceFingerprint: current.definition.sourceFingerprint, runtimeApplied: false, exchangeWriteAllowed: false }));
  }
  acquireLease(actorId: string, deploymentId: string, runId: string, ownerId: string, now: Date, ttlMs: number): DeploymentLease {
    this.get(actorId, deploymentId);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const active = this.database.prepare("SELECT run_id,owner_id,fencing_token,expires_at FROM paper_deployment_leases WHERE deployment_id=? AND status='active'").get(deploymentId) as {run_id:string;owner_id:string;fencing_token:number;expires_at:string}|undefined;
      if (active && Date.parse(active.expires_at) > now.getTime()) throw new MultiPaperRuntimeError("LEASE_CONFLICT");
      this.database.prepare("INSERT INTO paper_deployment_fencing_counters(deployment_id,last_token) VALUES(?,1) ON CONFLICT(deployment_id) DO UPDATE SET last_token=last_token+1").run(deploymentId);
      const token = (this.database.prepare("SELECT last_token FROM paper_deployment_fencing_counters WHERE deployment_id=?").get(deploymentId) as {last_token:number}).last_token;
      const expiresAt = new Date(now.getTime()+ttlMs).toISOString();
      this.database.prepare("INSERT INTO paper_deployment_leases(deployment_id,run_id,owner_id,fencing_token,status,expires_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(deployment_id) DO UPDATE SET run_id=excluded.run_id,owner_id=excluded.owner_id,fencing_token=excluded.fencing_token,status=excluded.status,expires_at=excluded.expires_at,updated_at=excluded.updated_at").run(deploymentId,runId,ownerId,token,"active",expiresAt,now.toISOString());
      this.database.exec("COMMIT");
      return { deploymentId, runId, ownerId, fencingToken: token, expiresAt };
    } catch (cause) { this.database.exec("ROLLBACK"); if (cause instanceof MultiPaperRuntimeError) throw cause; throw new MultiPaperRuntimeError("LEASE_CONFLICT"); }
  }
  assertFence(actorId: string, lease: DeploymentLease, now: Date): void {
    this.get(actorId, lease.deploymentId);
    const row = this.database.prepare("SELECT run_id,owner_id,fencing_token,status,expires_at FROM paper_deployment_leases WHERE deployment_id=?").get(lease.deploymentId) as {run_id:string;owner_id:string;fencing_token:number;status:string;expires_at:string}|undefined;
    if (!row || row.run_id!==lease.runId || row.owner_id!==lease.ownerId || row.fencing_token!==lease.fencingToken || row.status!=="active" || Date.parse(row.expires_at)<=now.getTime()) throw new MultiPaperRuntimeError("LEASE_FENCED");
  }
  heartbeatLease(actorId: string, lease: DeploymentLease, now: Date, ttlMs: number): DeploymentLease {
    this.assertFence(actorId, lease, now);
    const expiresAt = new Date(now.getTime()+ttlMs).toISOString();
    const changed = this.database.prepare("UPDATE paper_deployment_leases SET expires_at=?,updated_at=? WHERE deployment_id=? AND run_id=? AND owner_id=? AND fencing_token=? AND status='active'").run(expiresAt,now.toISOString(),lease.deploymentId,lease.runId,lease.ownerId,lease.fencingToken);
    if (changed.changes!==1) throw new MultiPaperRuntimeError("LEASE_FENCED");
    return { ...lease, expiresAt };
  }
  releaseLease(actorId: string, lease: DeploymentLease, now: Date): void {
    const changed = this.database.prepare("UPDATE paper_deployment_leases SET status='released',updated_at=? WHERE deployment_id=? AND run_id=? AND owner_id=? AND fencing_token=? AND status='active'").run(now.toISOString(),lease.deploymentId,lease.runId,lease.ownerId,lease.fencingToken);
    if (changed.changes!==1) this.assertFence(actorId, lease, now);
  }
}

const transitions: Record<string, readonly string[]> = { draft:["preflight_passed","archived"], preflight_passed:["running","stopped","archived"], running:["stopping","close_only","failed"], stopping:["stopped","close_only","failed"], close_only:["stopped","failed"], stopped:["preflight_passed","archived"], failed:["preflight_passed","archived"], archived:[] };
export class MultiPaperDeploymentService {
  constructor(private readonly repository: SqliteMultiPaperDeploymentRepository, private readonly versions: StrategyVersionMaterializer, private readonly preflightCheck?: (definition: PaperDeployment["definition"]) => Promise<void>) {}
  create(actorId: string, raw: unknown): PaperDeployment { const request=PaperDeploymentCreateRequestSchema.parse(raw); const materialized=this.versions.materialize(actorId,request.strategyVersionId); if(!materialized) throw new MultiPaperRuntimeError("STRATEGY_VERSION_UNAVAILABLE"); const at=nowIso(); return this.repository.create({deploymentId:`paper:${randomUUID()}`,actorId,name:request.name,strategyVersionId:request.strategyVersionId,...materialized,accountId:`account:${randomUUID()}`,initialCapital:request.initialCapital,intervalMs:request.intervalMs,createdAt:at,runtimeApplied:false,exchangeWriteAllowed:false},request.idempotencyKey); }
  action(actorId: string, deploymentId: string, action: "preflight"|"start"|"stop"|"archive", raw: unknown): PaperDeployment {
    const request=PaperDeploymentActionRequestSchema.parse(raw); const current=this.repository.get(actorId,deploymentId);
    if (request.sourceFingerprint && request.sourceFingerprint !== current.definition.sourceFingerprint) throw new MultiPaperRuntimeError("SOURCE_FINGERPRINT_STALE");
    this.assertDefinitionCurrent(current);
    const target = action === "preflight" ? "preflight_passed" : action === "start" ? "running" : action === "stop" ? (current.state.lifecycle === "running" ? "stopping" : current.state.lifecycle === "preflight_passed" ? "stopped" : current.state.lifecycle) : "archived";
    if (current.state.lifecycle===target) return current;
    if (!transitions[current.state.lifecycle]?.includes(target)) throw new MultiPaperRuntimeError("DEPLOYMENT_TRANSITION_INVALID");
    const at=nowIso(); const runId=target==="running" ? `run:${randomUUID()}` : current.state.latestRunId;
    const next=PaperDeploymentStateSchema.parse({...current.state,lifecycle:target, ...(target==="running"?{latestRunId:runId,startedAt:at,stoppedAt:undefined,retryAt:undefined,failureCount:0,health:"healthy"}:{}),...(target==="stopped"?{stoppedAt:at,retryAt:undefined,health:"stopped"}:{}),...(target==="archived"?{archivedAt:at,health:"stopped"}:{})});
    const result=this.repository.append(actorId,deploymentId,target === "preflight_passed" ? "preflight_passed" : target === "running" ? "started" : target === "stopping" ? "stopping" : target === "stopped" ? "stopped" : "archived",next,hash({action,request}));
    if (target==="running" && runId) this.repository.appendProjection(actorId,deploymentId,"run",{runId,deploymentId,accountId:current.definition.accountId,status:"running",startedAt:at,definition:current.definition},runId);
    return result;
  }
  assertDefinitionCurrent(deployment: PaperDeployment): void {
    const actual=this.versions.materialize(deployment.definition.actorId,deployment.definition.strategyVersionId);
    if (!actual || Object.entries(actual).some(([key,value])=>deployment.definition[key as keyof typeof actual]!==value)) throw new MultiPaperRuntimeError("SOURCE_FINGERPRINT_STALE");
  }
  async preflight(actorId: string, deploymentId: string, raw: unknown): Promise<PaperDeployment> {
    const current = this.repository.get(actorId, deploymentId);
    this.assertDefinitionCurrent(current);
    if (this.preflightCheck) await this.preflightCheck(current.definition);
    return this.action(actorId, deploymentId, "preflight", raw);
  }
}

export class BoundedMultiPaperScheduler {
  private active = new Set<string>();
  constructor(private readonly maximumConcurrency=2) {}
  async tick(deployments: readonly PaperDeployment[], execute: (deployment: PaperDeployment)=>Promise<void>): Promise<void> {
    const candidates=deployments.filter((d)=>["running","stopping","close_only"].includes(d.state.lifecycle)&&!this.active.has(d.definition.deploymentId)).slice(0,Math.max(0,this.maximumConcurrency-this.active.size));
    await Promise.all(candidates.map(async(d)=>{this.active.add(d.definition.deploymentId);try{await execute(d);}finally{this.active.delete(d.definition.deploymentId);}}));
  }
  get activeCount(): number { return this.active.size; }
}

/**
 * Background supervisor for the M4 deployment aggregate.  It deliberately
 * delegates every trading decision to the registered Current Crypto binding;
 * it only owns scheduling, fenced lifecycle transitions, and authoritative
 * projections of that binding's facts.
 */
export class DeploymentScopedPaperRuntimeSupervisor {
  private readonly scheduler: BoundedMultiPaperScheduler;
  private readonly ownerId: string;
  private readonly now: () => Date;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private ticking = false;

  constructor(private readonly options: {
    repository: SqliteMultiPaperDeploymentRepository;
    deployments: MultiPaperDeploymentService;
    binding?: RegisteredPaperRuntimeBinding;
    maximumConcurrency?: number;
    leaseTtlMs?: number;
    ownerId?: string;
    now?: () => Date;
  }) {
    this.scheduler = new BoundedMultiPaperScheduler(options.maximumConcurrency ?? 2);
    this.ownerId = options.ownerId ?? `multi-paper-scheduler:${randomUUID()}`;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(delayMs = 1_000): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick().finally(() => this.schedule());
    }, Math.max(100, delayMs));
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      const candidates = this.options.repository.recoverable().filter((deployment) => this.isDue(deployment, now));
      await this.scheduler.tick(candidates, async (deployment) => this.execute(deployment));
    } finally {
      this.ticking = false;
    }
  }

  private isDue(deployment: PaperDeployment, now: Date): boolean {
    if (deployment.state.retryAt && Date.parse(deployment.state.retryAt) > now.getTime()) return false;
    if (deployment.state.lifecycle !== "running") return true;
    return !deployment.state.heartbeatAt || now.getTime() - Date.parse(deployment.state.heartbeatAt) >= deployment.definition.intervalMs;
  }

  private async execute(initial: PaperDeployment): Promise<void> {
    const binding = this.options.binding;
    if (!binding || binding.exchangeWriteAllowed !== false) {
      this.fail(initial, "PAPER_BINDING_UNAVAILABLE");
      return;
    }
    try { this.options.deployments.assertDefinitionCurrent(initial); } catch (error) { this.fail(initial, error instanceof Error ? error.message : "SOURCE_FINGERPRINT_STALE"); return; }
    const runId = initial.state.latestRunId;
    if (!runId) { this.fail(initial, "RUN_CONTEXT_MISSING"); return; }
    const lease = (() => {
      try { return this.options.repository.acquireLease(initial.definition.actorId, initial.definition.deploymentId, runId, this.ownerId, this.now(), this.options.leaseTtlMs ?? 15_000); }
      catch (error) { if (error instanceof MultiPaperRuntimeError && error.code === "LEASE_CONFLICT") return undefined; throw error; }
    })();
    if (!lease) return;
    let activeLease = lease;
    const leaseTtlMs = this.options.leaseTtlMs ?? 15_000;
    const heartbeat = setInterval(() => {
      try { activeLease = this.options.repository.heartbeatLease(initial.definition.actorId, activeLease, this.now(), leaseTtlMs); }
      catch { /* The executor fence below rejects the stale worker before any further write. */ }
    }, Math.max(1_000, Math.floor(leaseTtlMs / 3)));
    let runtime: Awaited<ReturnType<RegisteredPaperRuntimeBinding["createRuntime"]>> | undefined;
    try {
      const closeOnly = initial.state.lifecycle === "close_only" || initial.state.lifecycle === "stopping";
      runtime = await binding.createRuntime({
        responseLocale: "en",
        scope: {
          deploymentId: initial.definition.deploymentId,
          runId,
          accountId: initial.definition.accountId,
          initialCash: initial.definition.initialCapital,
          closeOnly,
          assertFenced: async () => this.options.repository.assertFence(initial.definition.actorId, activeLease, this.now()),
        },
      });
      // Stop never starts a normal cycle.  The existing account is inspected
      // through the same persistent execution adapter before choosing the
      // terminal or close-only path.
      let deployment = this.options.repository.get(initial.definition.actorId, initial.definition.deploymentId);
      if (deployment.state.lifecycle === "stopping") {
        const hasPositions = await runtime.hasOpenPositions?.() ?? false;
        if (!hasPositions) {
          this.options.repository.assertFence(deployment.definition.actorId, lease, this.now());
          this.options.repository.updateRuntimeState(deployment.definition.actorId, deployment.definition.deploymentId, "stopped", { lifecycle: "stopped", stoppedAt: this.now().toISOString(), health: "stopped", retryAt: undefined });
          return;
        }
        deployment = this.options.repository.updateRuntimeState(deployment.definition.actorId, deployment.definition.deploymentId, "close_only", { lifecycle: "close_only", health: "healthy", retryAt: undefined });
      }
      const current = this.options.repository.get(initial.definition.actorId, initial.definition.deploymentId);
      const cycle = current.state.latestCycle + 1;
      const startedAt = this.now();
      const traceId = `${current.definition.deploymentId}:${runId}:cycle:${cycle}`;
      const safety = await runtime.safety.beforeCycle();
      if (!safety.allowed) throw new MultiPaperRuntimeError("PAPER_RUNTIME_SAFETY_BLOCKED");
      this.options.repository.assertFence(current.definition.actorId, lease, this.now());
      const result = await runtime.application.runCycle({
        schemaVersion: "v1", traceId, runMode: "paper", asOf: startedAt,
        strategyId: current.definition.strategyVersionId,
        configVersion: current.definition.graphFingerprint,
        symbols: [...binding.candidateSymbols], executionEnabled: true,
        executionMode: current.state.lifecycle === "close_only" ? "close_only" : "normal",
      });
      const safetyState = await runtime.safety.recordSuccess();
      const account = runtime.portfolioState?.(result.markPrices);
      this.options.repository.assertFence(current.definition.actorId, lease, this.now());
      const cycleKey = `${runId}:cycle:${cycle}`;
      this.options.repository.appendProjection(current.definition.actorId, current.definition.deploymentId, "cycle", {
        cycleId: cycleKey, runId, deploymentId: current.definition.deploymentId, accountId: current.definition.accountId,
        traceId, startedAt: startedAt.toISOString(), finishedAt: this.now().toISOString(), executionMode: current.state.lifecycle === "close_only" ? "close_only" : "normal",
        status: result.status, decision: result.decisions, portfolio: { selectedCount: result.decisions.length }, risk: result.riskDecisions,
        execution: result.executions, account, safety: safetyState,
      }, cycleKey);
      for (const [index, execution] of result.executions.entries()) this.options.repository.appendProjection(current.definition.actorId, current.definition.deploymentId, "trade", {
        runId, cycleId: cycleKey, deploymentId: current.definition.deploymentId, accountId: current.definition.accountId,
        kind: execution.status === "filled" ? "fill" : execution.status === "rejected" ? "order_rejected" : "order_skipped", execution,
      }, `${cycleKey}:execution:${index}`);
      for (const [index, risk] of result.riskDecisions.entries()) if (!risk.passed) this.options.repository.appendProjection(current.definition.actorId, current.definition.deploymentId, "trade", {
        runId, cycleId: cycleKey, deploymentId: current.definition.deploymentId, accountId: current.definition.accountId, kind: "risk_rejection", risk,
      }, `${cycleKey}:risk:${index}`);
      const trace = runtime.loadTrace?.(traceId) ?? [];
      const artifacts = await runtime.loadArtifacts?.(traceId) ?? [];
      this.options.repository.appendProjection(current.definition.actorId, current.definition.deploymentId, "artifact", {
        runId, cycleId: cycleKey, deploymentId: current.definition.deploymentId, traceId,
        // Persist lineage metadata, never large agent inputs/outputs. Full raw
        // evidence remains in the server-owned trace and artefact stores.
        trace: trace.slice(0, 80).map(compactTraceEvent),
        artifacts: artifacts.slice(0, 160).map(compactArtifact),
      }, cycleKey);
      const after = this.options.repository.get(current.definition.actorId, current.definition.deploymentId);
      const noOpenPositions = !(await runtime.hasOpenPositions?.() ?? false);
      this.options.repository.updateRuntimeState(current.definition.actorId, current.definition.deploymentId, noOpenPositions && after.state.lifecycle === "close_only" ? "stopped" : "heartbeat", {
        lifecycle: noOpenPositions && after.state.lifecycle === "close_only" ? "stopped" : after.state.lifecycle,
        latestCycle: cycle, heartbeatAt: this.now().toISOString(), failureCount: 0, retryAt: undefined,
        health: noOpenPositions && after.state.lifecycle === "close_only" ? "stopped" : "healthy",
        ...(noOpenPositions && after.state.lifecycle === "close_only" ? { stoppedAt: this.now().toISOString() } : {}),
      });
    } catch (error) {
      this.fail(initial, error instanceof Error ? error.message : "PAPER_RUNTIME_CYCLE_FAILED");
    } finally {
      clearInterval(heartbeat);
      try { await runtime?.close?.(); } finally { try { this.options.repository.releaseLease(initial.definition.actorId, activeLease, this.now()); } catch { /* A newer worker fenced this handle; it cannot append further facts. */ } }
    }
  }

  private fail(deployment: PaperDeployment, code: string): void {
    const current = this.options.repository.get(deployment.definition.actorId, deployment.definition.deploymentId);
    if (!["running", "stopping", "close_only"].includes(current.state.lifecycle)) return;
    const failureCount = current.state.failureCount + 1;
    const delay = Math.min(60_000, Math.max(current.definition.intervalMs, 1_000) * Math.min(8, 2 ** Math.min(failureCount, 6)));
    const retryAt = new Date(this.now().getTime() + delay).toISOString();
    this.options.repository.appendProjection(current.definition.actorId, current.definition.deploymentId, "cycle", {
      runId: current.state.latestRunId, deploymentId: current.definition.deploymentId, accountId: current.definition.accountId,
      status: "failed", errorCode: code, failedAt: this.now().toISOString(), retryAt,
    }, `${current.state.latestRunId}:failure:${failureCount}`);
    this.options.repository.updateRuntimeState(current.definition.actorId, current.definition.deploymentId, "failed", { failureCount, retryAt, health: "degraded" });
  }
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
