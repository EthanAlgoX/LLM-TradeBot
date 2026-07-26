import { createHash, randomUUID } from "node:crypto";
import {
  PaperRuntimeCycleAuditSchema,
  PaperRuntimePreflightReportSchema,
  PaperRuntimePreflightRequestSchema,
  PaperRuntimeRunRequestSchema,
  PaperRuntimeRunSchema,
  PaperRuntimeStopRecordSchema,
  PaperRuntimeStopRequestSchema,
  type ApprovedPaperPlan,
  type OrchestrationActor,
  type PaperActivationRecord,
  type PaperRuntimeCycleAudit,
  type PaperRuntimeLease,
  type PaperRuntimePreflightCheck,
  type PaperRuntimePreflightReport,
  type PaperRuntimeRun,
  type PaperRuntimeStopRecord,
  type RuntimeSafetyDecision,
  type RuntimeSafetyState,
} from "../../contracts/src/index.js";
import type { ApprovedPaperPlanService } from "../../core/src/approved-paper-plan-service.js";
import type { TradingApplication } from "../../core/src/trading-application.js";
import { SequentialCycleRunner } from "./sequential-cycle-runner.js";
import {
  PaperRuntimeSupervisorError,
  type PaperRuntimeOperationalEventSink,
} from "./sqlite-paper-runtime-supervisor.js";

export interface PaperRuntimeSafetyPort {
  beforeCycle(): Promise<RuntimeSafetyDecision>;
  recordSuccess(): Promise<RuntimeSafetyState>;
  recordFailure(error: unknown): Promise<RuntimeSafetyState>;
}

export interface PaperRuntimeBindingPreflightContext {
  plan: ApprovedPaperPlan;
  activation: PaperActivationRecord;
  now: Date;
}

export interface PaperRuntimeBindingPreflightResult {
  checks: readonly PaperRuntimePreflightCheck[];
}

export interface RegisteredPaperRuntimeBinding {
  bindingId: string;
  bindingFingerprint?: string;
  preflightRequired?: boolean;
  paperAccountRef: string;
  strategyProfileRef: string;
  riskPolicyRefs: readonly string[];
  candidateSymbols: readonly string[];
  maxCycles: number;
  intervalMs: number;
  exchangeWriteAllowed: false;
  preflight?(
    context: PaperRuntimeBindingPreflightContext,
  ): Promise<PaperRuntimeBindingPreflightResult>;
  createRuntime(): Promise<{
    application: TradingApplication;
    safety: PaperRuntimeSafetyPort;
    close?: () => void | Promise<void>;
  }>;
}

export interface PaperRuntimeRunRepository {
  findByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimeRun | undefined;
  findActive(planId: string): PaperRuntimeRun | undefined;
  createRun(
    run: PaperRuntimeRun,
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimeRun;
  replaceRun(run: PaperRuntimeRun): PaperRuntimeRun;
  getRun(runId: string): PaperRuntimeRun;
  appendCycle(audit: PaperRuntimeCycleAudit): PaperRuntimeCycleAudit;
  getCycles(runId: string): readonly PaperRuntimeCycleAudit[];
  markOrphaned?(runId: string, now: Date): PaperRuntimeRun;
}

export interface PaperRuntimeOperationsRepository {
  findPreflightByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimePreflightReport | undefined;
  savePreflight(
    report: PaperRuntimePreflightReport,
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimePreflightReport;
  findLatestPreflight(planId: string): PaperRuntimePreflightReport | undefined;
  acquireLease(
    runId: string,
    planId: string,
    ownerId: string,
    now: Date,
    ttlMs: number,
  ): PaperRuntimeLease;
  heartbeatLease(
    runId: string,
    ownerId: string,
    fencingToken: number,
    now: Date,
    ttlMs: number,
  ): PaperRuntimeLease;
  getLease(runId: string): PaperRuntimeLease;
  releaseLease(
    runId: string,
    ownerId: string,
    fencingToken: number,
    status: "released" | "lost" | "orphaned",
    now: Date,
  ): PaperRuntimeLease;
  recoverExpiredLeases(now: Date): readonly PaperRuntimeLease[];
  findStopByIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimeStopRecord | undefined;
  saveStop(
    record: PaperRuntimeStopRecord,
    actorId: string,
    idempotencyKey: string,
  ): PaperRuntimeStopRecord;
  findStop(runId: string): PaperRuntimeStopRecord | undefined;
  markStopDrained(runId: string, now: Date): PaperRuntimeStopRecord;
}

type PaperRuntimeErrorCode =
  | "PAPER_RUNTIME_ACTOR_ROLE_REQUIRED"
  | "PAPER_RUNTIME_REQUEST_INVALID"
  | "PAPER_RUNTIME_BINDING_NOT_FOUND"
  | "PAPER_RUNTIME_BINDING_MISMATCH"
  | "PAPER_RUNTIME_RUN_IN_PROGRESS"
  | "PAPER_RUNTIME_RUN_NOT_FOUND"
  | "PAPER_RUNTIME_RUN_CONFLICT"
  | "PAPER_RUNTIME_INITIALIZATION_FAILED"
  | "PAPER_RUNTIME_PREFLIGHT_REQUIRED"
  | "PAPER_RUNTIME_PREFLIGHT_FAILED"
  | "PAPER_RUNTIME_PREFLIGHT_EXPIRED"
  | "PAPER_RUNTIME_PREFLIGHT_MISMATCH"
  | "PAPER_RUNTIME_PREFLIGHT_UNAVAILABLE"
  | "PAPER_RUNTIME_LEASE_CONFLICT"
  | "PAPER_RUNTIME_LEASE_LOST"
  | "PAPER_RUNTIME_STOP_NOT_FOUND"
  | "PAPER_RUNTIME_STOP_NOT_ALLOWED"
  | "PAPER_RUNTIME_SUPERVISOR_FAILED";

export class PaperRuntimeActivationError extends Error {
  readonly name = "PaperRuntimeActivationError";

  constructor(
    readonly code: PaperRuntimeErrorCode,
    message: string,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }
}

function requireOperator(actor: OrchestrationActor): void {
  if (!actor.roles.includes("operator")) {
    throw new PaperRuntimeActivationError(
      "PAPER_RUNTIME_ACTOR_ROLE_REQUIRED",
      "Paper Runtime requires the operator role.",
      { actorId: actor.actorId, role: "operator" },
    );
  }
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    [...left]
      .sort()
      .every((value, index) => value === [...right].sort()[index])
  );
}

function safetySnapshot(state: RuntimeSafetyState) {
  return {
    consecutiveFailures: state.consecutiveFailures,
    ...(state.cooldownUntil
      ? { cooldownUntil: state.cooldownUntil.toISOString() }
      : {}),
    ...(state.lastFailure ? { lastFailure: state.lastFailure } : {}),
    updatedAt: state.updatedAt.toISOString(),
  };
}

function reportFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function invariantCheck(
  checkId: string,
  component: PaperRuntimePreflightCheck["component"],
  passed: boolean,
  code: string,
  checkedAt: string,
  fields: Readonly<Record<string, string>> = {},
): PaperRuntimePreflightCheck {
  return {
    checkId,
    component,
    status: passed ? "passed" : "failed",
    code,
    checkedAt,
    latencyMs: 0,
    fields: { ...fields },
  };
}

class DrainRequested extends Error {}

export class PaperRuntimeBindingRegistry {
  private readonly byPaperAccount = new Map<
    string,
    RegisteredPaperRuntimeBinding
  >();

  constructor(bindings: readonly RegisteredPaperRuntimeBinding[]) {
    for (const binding of bindings) {
      if (this.byPaperAccount.has(binding.paperAccountRef)) {
        throw new PaperRuntimeActivationError(
          "PAPER_RUNTIME_RUN_CONFLICT",
          "Only one Paper Runtime binding may own a Paper Account.",
          { paperAccountRef: binding.paperAccountRef },
        );
      }
      this.byPaperAccount.set(
        binding.paperAccountRef,
        Object.freeze({ ...binding }),
      );
    }
  }

  resolve(plan: ApprovedPaperPlan): RegisteredPaperRuntimeBinding {
    const binding = this.byPaperAccount.get(plan.paperAccountRef);
    if (!binding) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_BINDING_NOT_FOUND",
        "No server-owned Paper Runtime binding is registered for this plan.",
        { planId: plan.planId, paperAccountRef: plan.paperAccountRef },
      );
    }
    if (
      binding.exchangeWriteAllowed !== false ||
      binding.strategyProfileRef !== plan.strategyProfileRef ||
      !sameStrings(binding.candidateSymbols, plan.candidateSymbols) ||
      !sameStrings(binding.riskPolicyRefs, plan.riskPolicyRefs) ||
      !Number.isInteger(binding.maxCycles) ||
      binding.maxCycles < 1 ||
      binding.maxCycles > 100 ||
      !Number.isInteger(binding.intervalMs) ||
      binding.intervalMs < 0 ||
      binding.intervalMs > 86_400_000 ||
      (binding.preflightRequired === true &&
        (!binding.preflight || !binding.bindingFingerprint))
    ) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_BINDING_MISMATCH",
        "Registered binding does not match the Approved Paper Plan or safety limits.",
        { planId: plan.planId, bindingId: binding.bindingId },
      );
    }
    return binding;
  }
}

export interface PaperRuntimeActivationServiceOptions {
  ownerId?: string;
  leaseTtlMs?: number;
  preflightTtlMs?: number;
  now?: () => Date;
  supervisor?: PaperRuntimeOperationalEventSink;
}

export class PaperRuntimeActivationService {
  private readonly ownerId: string;
  private readonly leaseTtlMs: number;
  private readonly preflightTtlMs: number;
  private readonly now: () => Date;
  private readonly supervisor?: PaperRuntimeOperationalEventSink;

  constructor(
    private readonly paperPlans: ApprovedPaperPlanService,
    private readonly bindings: PaperRuntimeBindingRegistry,
    private readonly repository: PaperRuntimeRunRepository,
    private readonly operations?: PaperRuntimeOperationsRepository,
    options: PaperRuntimeActivationServiceOptions = {},
  ) {
    this.ownerId = options.ownerId ?? `paper-runtime-owner:${randomUUID()}`;
    this.leaseTtlMs = options.leaseTtlMs ?? 30_000;
    this.preflightTtlMs = options.preflightTtlMs ?? 5 * 60_000;
    this.now = options.now ?? (() => new Date());
    this.supervisor = options.supervisor;
    if (this.leaseTtlMs < 1_000 || this.leaseTtlMs > 300_000) {
      throw new Error("Paper Runtime leaseTtlMs must be 1000..300000.");
    }
    if (this.preflightTtlMs < 1_000 || this.preflightTtlMs > 3_600_000) {
      throw new Error("Paper Runtime preflightTtlMs must be 1000..3600000.");
    }
    if (this.operations && this.repository.markOrphaned) {
      for (const lease of this.operations.recoverExpiredLeases(this.now())) {
        const orphaned = this.repository.markOrphaned(
          lease.runId,
          this.now(),
        );
        this.emitOperationalEvent(
          orphaned,
          "run_orphaned",
          "critical",
          {
            ownerId: lease.ownerId,
            fencingToken: String(lease.fencingToken),
            leaseStatus: "orphaned",
          },
        );
      }
    }
  }

  private emitOperationalEvent(
    run: Pick<PaperRuntimeRun, "runId" | "planId">,
    eventType: Parameters<
      PaperRuntimeOperationalEventSink["appendOperationalEvent"]
    >[0]["eventType"],
    severity: "info" | "warning" | "critical" = "info",
    fields: Readonly<Record<string, string>> = {},
  ): void {
    this.supervisor?.appendOperationalEvent({
      runId: run.runId,
      planId: run.planId,
      eventType,
      severity,
      occurredAt: this.now(),
      fields,
    });
  }

  async runPreflight(
    planId: string,
    rawRequest: unknown,
    actor: OrchestrationActor,
  ): Promise<PaperRuntimePreflightReport> {
    requireOperator(actor);
    const parsed = PaperRuntimePreflightRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_REQUEST_INVALID",
        "Paper Runtime preflight request does not satisfy its strict contract.",
        { zodIssueCount: String(parsed.error.issues.length) },
      );
    }
    if (!this.operations) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_PREFLIGHT_UNAVAILABLE",
        "Paper Runtime preflight persistence is not configured.",
        { planId },
      );
    }
    const idempotent = this.operations.findPreflightByIdempotency(
      actor.actorId,
      parsed.data.idempotencyKey,
    );
    if (idempotent) return idempotent;

    const ready = this.paperPlans.assertReadyForRuntime(planId);
    const binding = this.bindings.resolve(ready.plan);
    if (!binding.preflight || !binding.bindingFingerprint) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_PREFLIGHT_UNAVAILABLE",
        "Registered Paper Runtime binding has no preflight implementation.",
        { planId, bindingId: binding.bindingId },
      );
    }
    const created = this.now();
    const checkedAt = created.toISOString();
    const invariantChecks: PaperRuntimePreflightCheck[] = [
      invariantCheck(
        "approved-plan:fingerprint",
        "approved_plan",
        ready.plan.fingerprint.length > 0,
        "PREFLIGHT_APPROVED_PLAN_FINGERPRINT_VALID",
        checkedAt,
        { planFingerprint: ready.plan.fingerprint },
      ),
      invariantCheck(
        "activation:fingerprint",
        "activation",
        ready.activation.planFingerprint === ready.plan.fingerprint,
        "PREFLIGHT_ACTIVATION_FINGERPRINT_MATCH",
        checkedAt,
        { activationId: ready.activation.activationId },
      ),
      invariantCheck(
        "evidence:immutable-refs",
        "evidence",
        Boolean(
          ready.plan.evidence.backtest.artifactSha256 &&
            ready.plan.evidence.walkForward.artifactSha256,
        ),
        "PREFLIGHT_EVIDENCE_REVERIFIED",
        checkedAt,
        {
          backtestArtifactSha256:
            ready.plan.evidence.backtest.artifactSha256,
          walkForwardArtifactSha256:
            ready.plan.evidence.walkForward.artifactSha256,
        },
      ),
      invariantCheck(
        "binding:approved-refs",
        "binding",
        binding.strategyProfileRef === ready.plan.strategyProfileRef &&
          sameStrings(binding.candidateSymbols, ready.plan.candidateSymbols) &&
          sameStrings(binding.riskPolicyRefs, ready.plan.riskPolicyRefs),
        "PREFLIGHT_BINDING_APPROVED_REFS_MATCH",
        checkedAt,
        { bindingId: binding.bindingId },
      ),
    ];
    const bindingResult = await binding.preflight({
      plan: ready.plan,
      activation: ready.activation,
      now: created,
    });
    const checks = [...invariantChecks, ...bindingResult.checks];
    const reportContent = {
      planId,
      planFingerprint: ready.plan.fingerprint,
      activationId: ready.activation.activationId,
      bindingId: binding.bindingId,
      bindingFingerprint: binding.bindingFingerprint,
      status: checks.every((check) => check.status === "passed")
        ? ("passed" as const)
        : ("failed" as const),
      checks,
      requestedByActorId: actor.actorId,
      createdAt: checkedAt,
      expiresAt: new Date(
        created.getTime() + this.preflightTtlMs,
      ).toISOString(),
    };
    const report = PaperRuntimePreflightReportSchema.parse({
      schemaVersion: "1.0.0",
      reportId: `paper-runtime-preflight:${randomUUID()}`,
      fingerprint: reportFingerprint(reportContent),
      ...reportContent,
      paperAccountMutationAllowed: false,
      exchangeWriteAllowed: false,
    });
    return this.operations.savePreflight(
      report,
      actor.actorId,
      parsed.data.idempotencyKey,
    );
  }

  getLatestPreflight(planId: string): PaperRuntimePreflightReport {
    const report = this.operations?.findLatestPreflight(planId);
    if (!report) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_PREFLIGHT_REQUIRED",
        "No Paper Runtime preflight report exists for this plan.",
        { planId },
      );
    }
    return report;
  }

  startRun(
    planId: string,
    rawRequest: unknown,
    actor: OrchestrationActor,
  ): PaperRuntimeRun {
    requireOperator(actor);
    const parsed = PaperRuntimeRunRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_REQUEST_INVALID",
        "Paper Runtime request does not satisfy its strict contract.",
        { zodIssueCount: String(parsed.error.issues.length) },
      );
    }
    const idempotent = this.repository.findByIdempotency(
      actor.actorId,
      parsed.data.idempotencyKey,
    );
    if (idempotent) return idempotent;

    const ready = this.paperPlans.assertReadyForRuntime(planId);
    const binding = this.bindings.resolve(ready.plan);
    let preflight: PaperRuntimePreflightReport | undefined;
    if (binding.preflightRequired) {
      preflight = this.operations?.findLatestPreflight(planId);
      if (!preflight) {
        throw new PaperRuntimeActivationError(
          "PAPER_RUNTIME_PREFLIGHT_REQUIRED",
          "A passing Paper Runtime preflight is required before starting.",
          { planId, bindingId: binding.bindingId },
        );
      }
      if (preflight.status !== "passed") {
        throw new PaperRuntimeActivationError(
          "PAPER_RUNTIME_PREFLIGHT_FAILED",
          "The latest Paper Runtime preflight failed.",
          { planId, reportId: preflight.reportId },
        );
      }
      if (Date.parse(preflight.expiresAt) <= this.now().getTime()) {
        throw new PaperRuntimeActivationError(
          "PAPER_RUNTIME_PREFLIGHT_EXPIRED",
          "The latest Paper Runtime preflight expired.",
          { planId, reportId: preflight.reportId },
        );
      }
      if (
        preflight.planFingerprint !== ready.plan.fingerprint ||
        preflight.activationId !== ready.activation.activationId ||
        preflight.bindingId !== binding.bindingId ||
        preflight.bindingFingerprint !== binding.bindingFingerprint
      ) {
        throw new PaperRuntimeActivationError(
          "PAPER_RUNTIME_PREFLIGHT_MISMATCH",
          "Paper Runtime preflight fingerprints no longer match the approved binding.",
          { planId, reportId: preflight.reportId },
        );
      }
    }
    const active = this.repository.findActive(planId);
    if (active) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_RUN_IN_PROGRESS",
        "An active Paper Runtime run already owns this plan.",
        { planId, activeRunId: active.runId },
      );
    }

    const requestedAt = this.now();
    const runId = `paper-runtime-run:${randomUUID()}`;
    const lease = this.operations?.acquireLease(
      runId,
      planId,
      this.ownerId,
      requestedAt,
      this.leaseTtlMs,
    );
    const run = PaperRuntimeRunSchema.parse({
      schemaVersion: "1.0.0",
      runId,
      planId,
      planFingerprint: ready.plan.fingerprint,
      activationId: ready.activation.activationId,
      bindingId: binding.bindingId,
      paperAccountRef: binding.paperAccountRef,
      strategyProfileRef: binding.strategyProfileRef,
      candidateSymbols: [...binding.candidateSymbols],
      requestedByActorId: actor.actorId,
      status: "queued",
      plannedCycles: binding.maxCycles,
      processedCycles: 0,
      intervalMs: binding.intervalMs,
      lastControlMode: "normal",
      lastControlApplied: false,
      requestedAt: requestedAt.toISOString(),
      ...(preflight ? { preflightReportId: preflight.reportId } : {}),
      ...(lease
        ? {
            leaseOwnerId: lease.ownerId,
            leaseFencingToken: lease.fencingToken,
            heartbeatAt: lease.heartbeatAt,
          }
        : {}),
      paperRuntimeApplied: false,
      exchangeWriteAllowed: false,
      clientRuntimeParametersAccepted: false,
    });
    let stored: PaperRuntimeRun;
    try {
      stored = this.repository.createRun(
        run,
        actor.actorId,
        parsed.data.idempotencyKey,
      );
    } catch (error) {
      if (lease && this.operations) {
        this.operations.releaseLease(
          runId,
          lease.ownerId,
          lease.fencingToken,
          "released",
          this.now(),
        );
      }
      throw error;
    }
    try {
      if (preflight) {
        this.emitOperationalEvent(stored, "preflight_accepted", "info", {
          reportId: preflight.reportId,
          preflightFingerprint: preflight.fingerprint,
        });
      }
      if (lease) {
        this.emitOperationalEvent(stored, "lease_acquired", "info", {
          ownerId: lease.ownerId,
          fencingToken: String(lease.fencingToken),
          expiresAt: lease.expiresAt,
        });
      }
      this.emitOperationalEvent(stored, "run_queued", "info", {
        plannedCycles: String(stored.plannedCycles),
        intervalMs: String(stored.intervalMs),
      });
    } catch {
      if (lease && this.operations) {
        this.operations.releaseLease(
          runId,
          lease.ownerId,
          lease.fencingToken,
          "released",
          this.now(),
        );
      }
      this.repository.replaceRun({
        ...stored,
        status: "failed",
        failureCode: "PAPER_RUNTIME_SUPERVISOR_FAILED",
        finishedAt: this.now().toISOString(),
      });
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_SUPERVISOR_FAILED",
        "Paper Runtime operational journal failed before activation.",
        { runId, planId },
      );
    }
    queueMicrotask(() => {
      void this.execute(stored, binding);
    });
    return stored;
  }

  requestStop(
    runId: string,
    rawRequest: unknown,
    actor: OrchestrationActor,
  ): PaperRuntimeStopRecord {
    requireOperator(actor);
    const parsed = PaperRuntimeStopRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_REQUEST_INVALID",
        "Paper Runtime stop request does not satisfy its strict contract.",
        { zodIssueCount: String(parsed.error.issues.length) },
      );
    }
    if (!this.operations) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_STOP_NOT_ALLOWED",
        "Paper Runtime stop persistence is not configured.",
        { runId },
      );
    }
    const idempotent = this.operations.findStopByIdempotency(
      actor.actorId,
      parsed.data.idempotencyKey,
    );
    if (idempotent) return idempotent;
    const run = this.repository.getRun(runId);
    if (!["queued", "running", "stop_requested"].includes(run.status)) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_STOP_NOT_ALLOWED",
        "Only an active Paper Runtime run may be drained.",
        { runId, status: run.status },
      );
    }
    const record = this.operations.saveStop(
      PaperRuntimeStopRecordSchema.parse({
        schemaVersion: "1.0.0",
        stopId: `paper-runtime-stop:${randomUUID()}`,
        runId,
        planId: run.planId,
        actorId: actor.actorId,
        actorDisplayName: actor.displayName,
        reason: parsed.data.reason,
        requestedAt: this.now().toISOString(),
        status: "requested",
        currentCycleMayComplete: true,
        futureCyclesAllowed: false,
        exchangeWriteAllowed: false,
      }),
      actor.actorId,
      parsed.data.idempotencyKey,
    );
    this.repository.replaceRun(
      PaperRuntimeRunSchema.parse({
        ...run,
        status: "stop_requested",
        stopId: record.stopId,
      }),
    );
    this.emitOperationalEvent(
      { runId: record.runId, planId: record.planId },
      "stop_requested",
      "warning",
      {
        stopId: record.stopId,
        actorId: actor.actorId,
      },
    );
    return record;
  }

  getRun(runId: string): PaperRuntimeRun {
    return this.repository.getRun(runId);
  }

  getCycles(runId: string): readonly PaperRuntimeCycleAudit[] {
    this.repository.getRun(runId);
    return this.repository.getCycles(runId);
  }

  getLease(runId: string): PaperRuntimeLease {
    if (!this.operations) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_LEASE_LOST",
        "Paper Runtime lease persistence is not configured.",
        { runId },
      );
    }
    this.repository.getRun(runId);
    return this.operations.getLease(runId);
  }

  getStop(runId: string): PaperRuntimeStopRecord {
    this.repository.getRun(runId);
    const stop = this.operations?.findStop(runId);
    if (!stop) {
      throw new PaperRuntimeActivationError(
        "PAPER_RUNTIME_STOP_NOT_FOUND",
        "Paper Runtime stop request was not found.",
        { runId },
      );
    }
    return stop;
  }

  private renewLease(run: PaperRuntimeRun): PaperRuntimeLease | undefined {
    if (!this.operations || !run.leaseOwnerId || !run.leaseFencingToken) {
      return undefined;
    }
    return this.operations.heartbeatLease(
      run.runId,
      run.leaseOwnerId,
      run.leaseFencingToken,
      this.now(),
      this.leaseTtlMs,
    );
  }

  private async execute(
    initial: PaperRuntimeRun,
    binding: RegisteredPaperRuntimeBinding,
  ): Promise<void> {
    let run = this.repository.replaceRun(
      PaperRuntimeRunSchema.parse({
        ...initial,
        status: "running",
        startedAt: this.now().toISOString(),
      }),
    );
    this.emitOperationalEvent(run, "run_started", "info", {
      bindingId: run.bindingId,
      plannedCycles: String(run.plannedCycles),
    });
    let failureCode: string | undefined;
    let drainRequested = false;
    let closeRuntime: (() => void | Promise<void>) | undefined;
    try {
      const firstLease = this.renewLease(run);
      if (firstLease) {
        run = this.repository.replaceRun({
          ...run,
          heartbeatAt: firstLease.heartbeatAt,
        });
        this.emitOperationalEvent(run, "lease_heartbeat", "info", {
          fencingToken: String(firstLease.fencingToken),
          expiresAt: firstLease.expiresAt,
        });
      }
      const runtime = await binding.createRuntime();
      closeRuntime = runtime.close;
      const report = await new SequentialCycleRunner().run(
        {
          cycles: binding.maxCycles,
          intervalMs: binding.intervalMs,
          executionEnabled: true,
          continueOnError: false,
        },
        async (cycle) => {
          const lease = this.renewLease(run);
          if (lease) {
            run = this.repository.replaceRun({
              ...run,
              heartbeatAt: lease.heartbeatAt,
            });
            this.emitOperationalEvent(run, "lease_heartbeat", "info", {
              fencingToken: String(lease.fencingToken),
              expiresAt: lease.expiresAt,
              cycle: String(cycle),
            });
          }
          const stop = this.operations?.findStop(run.runId);
          if (stop) {
            drainRequested = true;
            throw new DrainRequested();
          }

          const startedAt = this.now();
          const traceId = `${run.runId}:cycle:${cycle}`;
          const safety = await runtime.safety.beforeCycle();
          const control = this.paperPlans.findCurrentControl(run.planId);
          const controlMode = control?.mode ?? "normal";
          const executionMode =
            controlMode === "pause_new_openings_close_only"
              ? "close_only"
              : "normal";
          if (!safety.allowed) {
            failureCode = "PAPER_RUNTIME_SAFETY_BLOCKED";
            const audit = PaperRuntimeCycleAuditSchema.parse({
              schemaVersion: "1.0.0",
              runId: run.runId,
              cycle,
              traceId,
              startedAt: startedAt.toISOString(),
              finishedAt: this.now().toISOString(),
              status: "safety_blocked",
              controlMode,
              ...(control ? { controlAuditId: control.controlId } : {}),
              controlApplied: false,
              decisionCount: 0,
              riskDecisionCount: 0,
              executionCount: 0,
              safety: safetySnapshot(safety.state),
              errorCode: failureCode,
            });
            this.repository.appendCycle(audit);
            run = this.repository.replaceRun({
              ...run,
              processedCycles: cycle,
              lastControlMode: controlMode,
              lastControlApplied: false,
              lastSafetyState: audit.safety,
              failureCode,
            });
            this.emitOperationalEvent(
              run,
              "safety_blocked",
              "warning",
              {
                cycle: String(cycle),
                errorCode: failureCode,
              },
            );
            throw new Error(failureCode);
          }
          try {
            const result = await runtime.application.runCycle({
              schemaVersion: "v1",
              traceId,
              runMode: "paper",
              asOf: startedAt,
              strategyId: run.strategyProfileRef,
              configVersion: run.planFingerprint,
              symbols: [...binding.candidateSymbols],
              executionEnabled: true,
              executionMode,
            });
            const safetyState = await runtime.safety.recordSuccess();
            const audit = PaperRuntimeCycleAuditSchema.parse({
              schemaVersion: "1.0.0",
              runId: run.runId,
              cycle,
              traceId,
              startedAt: startedAt.toISOString(),
              finishedAt: this.now().toISOString(),
              status: result.status,
              controlMode,
              ...(control ? { controlAuditId: control.controlId } : {}),
              controlApplied: true,
              decisionCount: result.decisions.length,
              riskDecisionCount: result.riskDecisions.length,
              executionCount: result.executions.length,
              safety: safetySnapshot(safetyState),
            });
            this.repository.appendCycle(audit);
            run = this.repository.replaceRun({
              ...run,
              processedCycles: cycle,
              lastControlMode: controlMode,
              lastControlApplied: true,
              lastSafetyState: audit.safety,
              paperRuntimeApplied: true,
            });
          } catch (error) {
            failureCode = "PAPER_RUNTIME_CYCLE_FAILED";
            const safetyState = await runtime.safety.recordFailure(error);
            const audit = PaperRuntimeCycleAuditSchema.parse({
              schemaVersion: "1.0.0",
              runId: run.runId,
              cycle,
              traceId,
              startedAt: startedAt.toISOString(),
              finishedAt: this.now().toISOString(),
              status: "failed",
              controlMode,
              ...(control ? { controlAuditId: control.controlId } : {}),
              controlApplied: true,
              decisionCount: 0,
              riskDecisionCount: 0,
              executionCount: 0,
              safety: safetySnapshot(safetyState),
              errorCode: failureCode,
            });
            this.repository.appendCycle(audit);
            run = this.repository.replaceRun({
              ...run,
              processedCycles: cycle,
              lastControlMode: controlMode,
              lastControlApplied: true,
              lastSafetyState: audit.safety,
              paperRuntimeApplied: true,
              failureCode,
            });
            this.emitOperationalEvent(run, "cycle_failed", "critical", {
              cycle: String(cycle),
              errorCode: failureCode,
            });
            throw error;
          }
          this.emitOperationalEvent(run, "cycle_completed", "info", {
            cycle: String(cycle),
            controlMode: run.lastControlMode,
          });
        },
      );
      if (drainRequested) {
        const stop = this.operations?.markStopDrained(run.runId, this.now());
        run = this.repository.replaceRun(
          PaperRuntimeRunSchema.parse({
            ...run,
            status: "drained",
            ...(stop ? { stopId: stop.stopId } : {}),
            finishedAt: this.now().toISOString(),
          }),
        );
        this.emitOperationalEvent(run, "run_drained", "warning", {
          processedCycles: String(run.processedCycles),
          ...(run.stopId ? { stopId: run.stopId } : {}),
        });
      } else {
        const finalStatus =
          report.errorCount === 0
            ? "completed"
            : failureCode === "PAPER_RUNTIME_SAFETY_BLOCKED"
              ? "safety_blocked"
              : "failed";
        run = this.repository.replaceRun(
          PaperRuntimeRunSchema.parse({
            ...run,
            status: finalStatus,
            ...(failureCode ? { failureCode } : {}),
            finishedAt: this.now().toISOString(),
          }),
        );
        this.emitOperationalEvent(
          run,
          finalStatus === "completed" ? "run_completed" : "run_failed",
          finalStatus === "completed" ? "info" : "critical",
          {
            processedCycles: String(run.processedCycles),
            ...(run.failureCode ? { errorCode: run.failureCode } : {}),
          },
        );
      }
    } catch (error) {
      const current = this.repository.getRun(initial.runId);
      const supervisorFailed = error instanceof PaperRuntimeSupervisorError;
      if (
        ["completed", "failed", "safety_blocked", "drained", "orphaned"].includes(
          current.status,
        ) &&
        !supervisorFailed
      ) {
        return;
      }
      const leaseLost =
        error instanceof PaperRuntimeActivationError &&
        error.code === "PAPER_RUNTIME_LEASE_LOST";
      run = this.repository.replaceRun(
        PaperRuntimeRunSchema.parse({
          ...current,
          status: leaseLost ? "orphaned" : "failed",
          failureCode: leaseLost
            ? "PAPER_RUNTIME_LEASE_LOST"
            : supervisorFailed
              ? "PAPER_RUNTIME_SUPERVISOR_FAILED"
              : failureCode ?? "PAPER_RUNTIME_INITIALIZATION_FAILED",
          finishedAt: this.now().toISOString(),
        }),
      );
      if (!supervisorFailed) {
        if (leaseLost) {
          this.emitOperationalEvent(run, "lease_lost", "critical", {
            ...(run.leaseFencingToken
              ? { fencingToken: String(run.leaseFencingToken) }
              : {}),
          });
          this.emitOperationalEvent(run, "run_orphaned", "critical", {
            errorCode: "PAPER_RUNTIME_LEASE_LOST",
          });
        } else {
          this.emitOperationalEvent(run, "run_failed", "critical", {
            errorCode:
              run.failureCode ?? "PAPER_RUNTIME_INITIALIZATION_FAILED",
          });
        }
      }
    } finally {
      let resourcesClosed = false;
      if (closeRuntime) {
        try {
          await closeRuntime();
          resourcesClosed = true;
        } catch {
          const current = this.repository.getRun(initial.runId);
          run = this.repository.replaceRun(
            PaperRuntimeRunSchema.parse({
              ...current,
              status: "failed",
              failureCode: "PAPER_RUNTIME_RESOURCE_CLOSE_FAILED",
              finishedAt: this.now().toISOString(),
            }),
          );
          this.emitOperationalEvent(
            run,
            "runtime_resource_close_failed",
            "critical",
            { errorCode: "PAPER_RUNTIME_RESOURCE_CLOSE_FAILED" },
          );
        }
      }
      if (resourcesClosed) {
        try {
          this.emitOperationalEvent(
            this.repository.getRun(initial.runId),
            "runtime_resources_closed",
          );
        } catch {
          const current = this.repository.getRun(initial.runId);
          this.repository.replaceRun({
            ...current,
            status: "failed",
            failureCode: "PAPER_RUNTIME_SUPERVISOR_FAILED",
            finishedAt: this.now().toISOString(),
          });
        }
      }
      const current = this.repository.getRun(initial.runId);
      if (
        this.operations &&
        current.leaseOwnerId &&
        current.leaseFencingToken
      ) {
        try {
          this.operations.releaseLease(
            current.runId,
            current.leaseOwnerId,
            current.leaseFencingToken,
            current.status === "orphaned" ? "lost" : "released",
            this.now(),
          );
        } catch {
          // A replaced fencing token must never be released by the old owner.
        }
      }
    }
  }
}
