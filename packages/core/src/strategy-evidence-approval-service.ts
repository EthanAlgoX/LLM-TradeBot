import { createHash } from "node:crypto";

import {
  ApprovedPaperPlanRequestSchema,
  ApprovedPaperPlanSchema,
  ApproveStrategyEvidenceRequestSchema,
  CreateStrategyEvidenceBindingRequestSchema,
  RunStrategyEvidenceJobRequestSchema,
  StrategyEvidenceBindingSchema,
  type ApprovedPaperPlan,
  type GraphEvidenceArtifact,
  type GraphEvidenceJob,
  type GraphEvidenceVerificationResult,
  type ExecutableStrategyConfiguration,
  type OrchestrationActor,
  type StrategyEvidenceBinding,
} from "../../contracts/src/index.js";
import type {
  ApprovedPaperPlanRepository,
} from "./approved-paper-plan-service.js";
import type { ConfigurationDraftService } from "./configuration-draft-service.js";
import {
  graphEvidenceFingerprint,
  type RegisteredGraphHistoricalDatasetRegistry,
  type RegisteredGraphStrategyProfileRegistry,
  type RegisteredGraphWalkForwardPlanRegistry,
  verifyGraphEvidenceArtifact,
} from "./graph-backtest-evidence.js";

export interface StrategyEvidenceBindingRepository {
  save(
    binding: StrategyEvidenceBinding,
    creationIdentity?: { actorId: string; idempotencyKey: string },
  ): StrategyEvidenceBinding;
  get(bindingId: string): StrategyEvidenceBinding;
  getVersion(versionId: string): StrategyEvidenceBinding;
  listVersions(bindingId: string): readonly StrategyEvidenceBinding[];
  findByCreationIdempotency(
    actorId: string,
    idempotencyKey: string,
  ): StrategyEvidenceBinding | undefined;
  findLatestByConfigurationVersionId?(
    configurationVersionId: string,
  ): StrategyEvidenceBinding | undefined;
}

export interface StrategyGraphEvidenceJobPort {
  submitBacktest(rawRequest: unknown): GraphEvidenceJob;
  submitWalkForward(rawRequest: unknown): GraphEvidenceJob;
  run(jobId: string, ownerId: string): Promise<GraphEvidenceJob>;
  get(jobId: string): GraphEvidenceJob;
}

export interface StrategyExecutableConfigurationScope {
  getCurrent(
    strategyVersionId: string,
  ): ExecutableStrategyConfiguration;
}

export interface StrategyApprovedPaperPlanPolicy {
  planVersion: string;
  paperAccountRef: string;
  candidateSymbols: readonly string[];
  riskPolicyRefs: readonly string[];
  planTtlMs?: number;
}

export type StrategyGraphEvidenceVerifier = (
  artifact: GraphEvidenceArtifact,
  current: {
    planFingerprint: string;
    datasetFingerprint: string;
    profileScopeFingerprint: string;
  },
) => GraphEvidenceVerificationResult;

type StrategyPaperPlanRepository = Pick<
  ApprovedPaperPlanRepository,
  "findPlanByIdempotency" | "findPlanByDraftId" | "savePlan"
>;

type StrategyEvidenceErrorCode =
  | "STRATEGY_EVIDENCE_ACTOR_ROLE_REQUIRED"
  | "STRATEGY_CONFIGURATION_REQUIRED"
  | "STRATEGY_CONFIGURATION_INVALID"
  | "STRATEGY_CONFIGURATION_CHANGED"
  | "STRATEGY_EVIDENCE_SCOPE_INVALID"
  | "STRATEGY_EVIDENCE_SCOPE_CHANGED"
  | "STRATEGY_EVIDENCE_JOB_FAILED"
  | "STRATEGY_EVIDENCE_INTEGRITY_FAILED"
  | "STRATEGY_EVIDENCE_NOT_READY"
  | "STRATEGY_EVIDENCE_BINDING_NOT_FOUND"
  | "STRATEGY_EVIDENCE_APPROVAL_CONFLICT";

export class StrategyEvidenceApprovalError extends Error {
  constructor(
    readonly code: StrategyEvidenceErrorCode,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(code);
    this.name = "StrategyEvidenceApprovalError";
  }
}

function sha256Hex(value: string): string {
  if (/^sha256:[a-f0-9]{64}$/u.test(value)) {
    return value.slice("sha256:".length);
  }
  if (/^[a-f0-9]{64}$/u.test(value)) {
    return value;
  }
  return createHash("sha256").update(value).digest("hex");
}

function assertRole(actor: OrchestrationActor, role: "operator" | "approver"): void {
  if (!actor.roles.includes(role)) {
    throw new StrategyEvidenceApprovalError("STRATEGY_EVIDENCE_ACTOR_ROLE_REQUIRED", {
      actorId: actor.actorId,
      requiredRole: role,
    });
  }
}

export class StrategyEvidenceApprovalService {
  private readonly verifyEvidence: StrategyGraphEvidenceVerifier;
  private readonly now: () => Date;
  private readonly executableStrategyScope?: StrategyExecutableConfigurationScope;

  constructor(
    private readonly configuration: ConfigurationDraftService,
    private readonly bindings: StrategyEvidenceBindingRepository,
    private readonly jobs: StrategyGraphEvidenceJobPort,
    private readonly datasets: RegisteredGraphHistoricalDatasetRegistry,
    private readonly profiles: RegisteredGraphStrategyProfileRegistry,
    private readonly walkForwardPlans: RegisteredGraphWalkForwardPlanRegistry,
    private readonly paperPlans: StrategyPaperPlanRepository,
    private readonly policy: StrategyApprovedPaperPlanPolicy,
    options: {
      now?: () => Date;
      verifyEvidence?: StrategyGraphEvidenceVerifier;
      executableStrategyScope?: StrategyExecutableConfigurationScope;
    } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.verifyEvidence = options.verifyEvidence ?? verifyGraphEvidenceArtifact;
    this.executableStrategyScope = options.executableStrategyScope;
  }

  createBinding(
    rawRequest: unknown,
    actor: OrchestrationActor,
    options: { readonly requireExecutableScope?: boolean } = {},
  ): StrategyEvidenceBinding {
    assertRole(actor, "operator");
    const request = CreateStrategyEvidenceBindingRequestSchema.parse(rawRequest);
    const replay = this.bindings.findByCreationIdempotency(actor.actorId, request.idempotencyKey);
    if (replay) {
      return replay;
    }
    const configuration = this.configuration.get(request.strategyConfigurationVersionId);
    if (configuration.payload.kind !== "strategy") {
      throw new StrategyEvidenceApprovalError("STRATEGY_CONFIGURATION_REQUIRED", {
        versionId: configuration.versionId,
      });
    }
    const validation = this.configuration.validate(configuration.versionId);
    if (!validation.valid) {
      throw new StrategyEvidenceApprovalError("STRATEGY_CONFIGURATION_INVALID", {
        versionId: configuration.versionId,
        issueCodes: validation.issues.map((issue) => issue.code).join(","),
      });
    }
    const historicalPlan = this.configuration.compileHistorical(configuration.versionId);
    const executableStrategy = options.requireExecutableScope === false
      ? undefined
      : this.executableStrategyScope?.getCurrent(configuration.versionId);
    if (
      executableStrategy &&
      (
        request.backtestProfileId !==
          executableStrategy.derivedProfile.id ||
        request.walkForwardCandidateSetId !==
          executableStrategy.derivedCandidateSet.id ||
        historicalPlan.fingerprint !==
          executableStrategy.historicalPlanRef.fingerprint
      )
    ) {
      throw new StrategyEvidenceApprovalError(
        "STRATEGY_EVIDENCE_SCOPE_INVALID",
        {
          requestedProfileId: request.backtestProfileId,
          executableProfileId:
            executableStrategy.derivedProfile.id,
          requestedCandidateSetId:
            request.walkForwardCandidateSetId,
          executableCandidateSetId:
            executableStrategy.derivedCandidateSet.id,
        },
      );
    }
    const dataset = this.datasets.require(request.datasetId);
    const profile = this.profiles.require(request.backtestProfileId, historicalPlan.presetRef.id);
    const candidateSet = this.profiles.requireCandidateSet(request.walkForwardCandidateSetId);
    const walkForwardPlan = this.walkForwardPlans.require(request.walkForwardPlanId);
    if (!candidateSet.profileIds.includes(profile.id)) {
      throw new StrategyEvidenceApprovalError("STRATEGY_EVIDENCE_SCOPE_INVALID", {
        profileId: profile.id,
        candidateSetId: candidateSet.id,
      });
    }
    if (
      dataset.marketPackRef.id !== historicalPlan.marketPackRef.id ||
      configuration.payload.marketPackId !== historicalPlan.marketPackRef.id
    ) {
      throw new StrategyEvidenceApprovalError("STRATEGY_EVIDENCE_SCOPE_INVALID", {
        configurationMarketPackId: configuration.payload.marketPackId,
        planMarketPackId: historicalPlan.marketPackRef.id,
        datasetMarketPackId: dataset.marketPackRef.id,
      });
    }
    const createdAt = this.now().toISOString();
    const identitySeed = {
      actorId: actor.actorId,
      configurationVersionId: configuration.versionId,
      datasetId: dataset.id,
      profileId: profile.id,
      candidateSetId: candidateSet.id,
      walkForwardPlanId: walkForwardPlan.id,
      startAt: request.startAt,
      endAt: request.endAt,
      idempotencyKey: request.idempotencyKey,
    };
    const bindingId = `strategy-evidence:${sha256Hex(graphEvidenceFingerprint(identitySeed)).slice(0, 32)}`;
    const withoutFingerprint = {
      schemaVersion: "1.0.0" as const,
      bindingId,
      versionId: `${bindingId}:v1`,
      versionIndex: 1,
      lifecycleStatus: "draft" as const,
      createdAt,
      updatedAt: createdAt,
      createdByActorId: actor.actorId,
      configurationRef: {
        draftId: configuration.draftId,
        versionId: configuration.versionId,
        versionFingerprint: configuration.fingerprint,
        payloadFingerprint: graphEvidenceFingerprint(configuration.payload),
      },
      historicalPlanRef: {
        id: historicalPlan.planId,
        version: historicalPlan.version,
        fingerprint: historicalPlan.fingerprint,
      },
      compiledGraphRef: historicalPlan.compiledGraphRef,
      marketPackRef: historicalPlan.marketPackRef,
      datasetRef: {
        id: dataset.id,
        version: dataset.version,
        fingerprint: dataset.fingerprint,
      },
      dataSourceRef: dataset.dataSourceRef,
      backtestProfileRef: {
        id: profile.id,
        version: profile.version,
        fingerprint: profile.fingerprint,
      },
      walkForwardCandidateSetRef: {
        id: candidateSet.id,
        version: candidateSet.version,
        fingerprint: candidateSet.fingerprint,
      },
      walkForwardPlanRef: {
        id: walkForwardPlan.id,
        version: walkForwardPlan.version,
        fingerprint: walkForwardPlan.fingerprint,
      },
      startAt: request.startAt,
      endAt: request.endAt,
      runtimeApplied: false as const,
    };
    const binding = StrategyEvidenceBindingSchema.parse({
      ...withoutFingerprint,
      fingerprint: graphEvidenceFingerprint(withoutFingerprint),
    });
    return this.bindings.save(binding, {
      actorId: actor.actorId,
      idempotencyKey: request.idempotencyKey,
    });
  }

  get(bindingId: string): StrategyEvidenceBinding {
    try {
      return this.bindings.get(bindingId);
    } catch {
      throw new StrategyEvidenceApprovalError("STRATEGY_EVIDENCE_BINDING_NOT_FOUND", {
        bindingId,
      });
    }
  }

  findCurrentForConfiguration(
    configurationVersionId: string,
    options: { readonly requireExecutableScope?: boolean } = {},
  ): StrategyEvidenceBinding | undefined {
    const binding = this.bindings.findLatestByConfigurationVersionId?.(
      configurationVersionId,
    );
    return binding ? this.assertScopeCurrent(binding, options) : undefined;
  }

  findApprovalReadyForConfiguration(
    configurationVersionId: string,
  ): StrategyEvidenceBinding {
    const binding = this.findCurrentForConfiguration(configurationVersionId);
    if (
      !binding ||
      binding.lifecycleStatus !== "evidence_ready" ||
      !binding.backtestJob ||
      !binding.walkForwardJob
    ) {
      throw new StrategyEvidenceApprovalError("STRATEGY_EVIDENCE_NOT_READY", {
        configurationVersionId,
      });
    }
    this.requireCurrentEvidence(
      binding,
      this.jobs.get(binding.backtestJob.jobId),
      "backtest",
    );
    this.requireCurrentEvidence(
      binding,
      this.jobs.get(binding.walkForwardJob.jobId),
      "walk_forward",
    );
    return binding;
  }

  async runBacktest(
    bindingId: string,
    rawRequest: unknown,
    actor: OrchestrationActor,
    options: { readonly requireExecutableScope?: boolean } = {},
  ): Promise<StrategyEvidenceBinding> {
    assertRole(actor, "operator");
    const request = RunStrategyEvidenceJobRequestSchema.parse(rawRequest);
    const binding = this.assertScopeCurrent(this.get(bindingId), options);
    const job = this.jobs.submitBacktest({
      schemaVersion: "1.0.0",
      planId: binding.historicalPlanRef.id,
      datasetId: binding.datasetRef.id,
      profileId: binding.backtestProfileRef.id,
      startAt: binding.startAt,
      endAt: binding.endAt,
      idempotencyKey: request.idempotencyKey,
    });
    if (binding.backtestJob?.jobId === job.jobId) {
      return binding;
    }
    const completed =
      job.status === "succeeded"
        ? job
        : await this.jobs.run(job.jobId, `strategy-evidence:${actor.actorId}`);
    return this.recordJob(binding, completed, "backtest", actor.actorId);
  }

  async runWalkForward(
    bindingId: string,
    rawRequest: unknown,
    actor: OrchestrationActor,
    options: { readonly requireExecutableScope?: boolean } = {},
  ): Promise<StrategyEvidenceBinding> {
    assertRole(actor, "operator");
    const request = RunStrategyEvidenceJobRequestSchema.parse(rawRequest);
    const binding = this.assertScopeCurrent(this.get(bindingId), options);
    const job = this.jobs.submitWalkForward({
      schemaVersion: "1.0.0",
      planId: binding.historicalPlanRef.id,
      datasetId: binding.datasetRef.id,
      profileCandidateSetId: binding.walkForwardCandidateSetRef.id,
      walkForwardPlanId: binding.walkForwardPlanRef.id,
      startAt: binding.startAt,
      endAt: binding.endAt,
      idempotencyKey: request.idempotencyKey,
    });
    if (binding.walkForwardJob?.jobId === job.jobId) {
      return binding;
    }
    const completed =
      job.status === "succeeded"
        ? job
        : await this.jobs.run(job.jobId, `strategy-evidence:${actor.actorId}`);
    return this.recordJob(binding, completed, "walk_forward", actor.actorId);
  }

  approve(
    bindingId: string,
    rawRequest: unknown,
    actor: OrchestrationActor,
  ): { binding: StrategyEvidenceBinding; plan: ApprovedPaperPlan } {
    assertRole(actor, "approver");
    const request = ApproveStrategyEvidenceRequestSchema.parse(rawRequest);
    ApprovedPaperPlanRequestSchema.parse({
      schemaVersion: request.schemaVersion,
      idempotencyKey: request.idempotencyKey,
    });
    const replay = this.paperPlans.findPlanByIdempotency(actor.actorId, request.idempotencyKey);
    if (replay) {
      const replayBinding = this.get(bindingId);
      if (replay.draftId !== replayBinding.configurationRef.draftId) {
        throw new StrategyEvidenceApprovalError("STRATEGY_EVIDENCE_APPROVAL_CONFLICT", {
          bindingId,
          replayPlanId: replay.planId,
        });
      }
      return { binding: replayBinding, plan: replay };
    }
    const binding = this.assertScopeCurrent(this.get(bindingId));
    if (
      binding.lifecycleStatus !== "evidence_ready" ||
      !binding.backtestJob ||
      !binding.walkForwardJob
    ) {
      throw new StrategyEvidenceApprovalError("STRATEGY_EVIDENCE_NOT_READY", {
        bindingId,
        lifecycleStatus: binding.lifecycleStatus,
      });
    }
    const existing = this.paperPlans.findPlanByDraftId(binding.configurationRef.draftId);
    if (existing) {
      throw new StrategyEvidenceApprovalError("STRATEGY_EVIDENCE_APPROVAL_CONFLICT", {
        bindingId,
        existingPlanId: existing.planId,
      });
    }
    const backtest = this.requireCurrentEvidence(binding, this.jobs.get(binding.backtestJob.jobId), "backtest");
    const walkForward = this.requireCurrentEvidence(
      binding,
      this.jobs.get(binding.walkForwardJob.jobId),
      "walk_forward",
    );
    const approvedAt = this.now().toISOString();
    const approvalId = `strategy-approval:${sha256Hex(
      graphEvidenceFingerprint({
        bindingFingerprint: binding.fingerprint,
        actorId: actor.actorId,
        idempotencyKey: request.idempotencyKey,
      }),
    ).slice(0, 32)}`;
    const approval = {
      approvalId,
      actorId: actor.actorId,
      actorDisplayName: actor.displayName,
      note: request.note,
      approvedAt,
      evidenceFingerprints: [
        graphEvidenceFingerprint(backtest),
        graphEvidenceFingerprint(walkForward),
      ],
    };
    const planId = `paper-plan:strategy:${sha256Hex(
      graphEvidenceFingerprint({ bindingId, approvalId }),
    ).slice(0, 32)}`;
    const expiresAt =
      this.policy.planTtlMs === undefined
        ? undefined
        : new Date(this.now().getTime() + this.policy.planTtlMs).toISOString();
    const withoutFingerprint = {
      schemaVersion: "1.0.0" as const,
      planId,
      planVersion: this.policy.planVersion,
      lifecycleStatus: "approved_ready" as const,
      draftId: binding.configurationRef.draftId,
      graphId: binding.compiledGraphRef.id,
      graphVersion: binding.compiledGraphRef.version,
      graphFingerprint: binding.compiledGraphRef.fingerprint,
      marketPackRefs: [binding.marketPackRef.id],
      dataSourceRef: binding.dataSourceRef.id,
      strategyProfileRef: binding.backtestProfileRef.id,
      dataFingerprint: sha256Hex(binding.datasetRef.fingerprint),
      paperAccountRef: this.policy.paperAccountRef,
      candidateSymbols: [...this.policy.candidateSymbols],
      riskPolicyRefs: [...this.policy.riskPolicyRefs],
      approvalId,
      approvedByActorId: actor.actorId,
      evidence: {
        backtest: this.paperEvidenceReference(binding.backtestJob.jobId, "backtest", backtest),
        walkForward: this.paperEvidenceReference(
          binding.walkForwardJob.jobId,
          "walk_forward",
          walkForward,
        ),
      },
      compiledStepCount: this.configuration.compileHistorical(
        binding.configurationRef.versionId,
      ).nodes.length,
      createdAt: approvedAt,
      expiresAt,
      createdBy: "tradebot-server" as const,
      runtimeApplied: false as const,
    };
    const plan = ApprovedPaperPlanSchema.parse({
      ...withoutFingerprint,
      fingerprint: graphEvidenceFingerprint(withoutFingerprint),
    });
    const savedPlan = this.paperPlans.savePlan(
      plan,
      actor.actorId,
      request.idempotencyKey,
    );
    const approvedBinding = this.nextVersion(binding, {
      lifecycleStatus: "approved",
      approval,
      approvedPaperPlanId: savedPlan.planId,
    });
    return { binding: approvedBinding, plan: savedPlan };
  }

  private recordJob(
    binding: StrategyEvidenceBinding,
    job: GraphEvidenceJob,
    kind: "backtest" | "walk_forward",
    actorId: string,
  ): StrategyEvidenceBinding {
    const evidence = this.requireCurrentEvidence(binding, job, kind);
    const jobRef = {
      jobId: job.jobId,
      status: "succeeded" as const,
      evidenceRef: evidence.evidenceRef,
      evidenceFingerprint: graphEvidenceFingerprint(evidence),
    };
    const patch =
      kind === "backtest"
        ? { backtestJob: jobRef }
        : { walkForwardJob: jobRef };
    const hasPair =
      kind === "backtest" ? Boolean(binding.walkForwardJob) : Boolean(binding.backtestJob);
    const updated = this.nextVersion(binding, {
      ...patch,
      lifecycleStatus: hasPair ? "evidence_ready" : "partial_evidence",
    });
    if (hasPair) {
      const latestConfiguration = this.configuration.getLatest(
        binding.configurationRef.draftId,
      );
      this.configuration.recordEvidence(
        latestConfiguration.versionId,
        `strategy-evidence:${updated.bindingId}:${updated.fingerprint}`,
        actorId,
      );
    }
    return updated;
  }

  private requireCurrentEvidence(
    binding: StrategyEvidenceBinding,
    job: GraphEvidenceJob,
    kind: "backtest" | "walk_forward",
  ): GraphEvidenceArtifact {
    const expectedKind = kind === "backtest" ? "graph_backtest" : "graph_walk_forward";
    if (job.status !== "succeeded" || !job.evidence || job.evidence.kind !== expectedKind) {
      throw new StrategyEvidenceApprovalError("STRATEGY_EVIDENCE_JOB_FAILED", {
        jobId: job.jobId,
        status: job.status,
      });
    }
    const profileFingerprint =
      kind === "backtest"
        ? binding.backtestProfileRef.fingerprint
        : binding.walkForwardCandidateSetRef.fingerprint;
    const verification = this.verifyEvidence(job.evidence, {
      planFingerprint: binding.historicalPlanRef.fingerprint,
      datasetFingerprint: binding.datasetRef.fingerprint,
      profileScopeFingerprint: profileFingerprint,
    });
    if (!verification.valid || !job.evidence.promotionEligible) {
      throw new StrategyEvidenceApprovalError("STRATEGY_EVIDENCE_INTEGRITY_FAILED", {
        jobId: job.jobId,
        issueCodes: verification.issueCodes.join(","),
        promotionEligible: String(job.evidence.promotionEligible),
      });
    }
    return job.evidence;
  }

  private paperEvidenceReference(
    jobId: string,
    kind: "backtest" | "walk_forward",
    evidence: GraphEvidenceArtifact,
  ) {
    return {
      kind,
      evidenceId: evidence.evidenceRef,
      jobId,
      artifactId: evidence.artifactId,
      artifactRef: evidence.evidenceRef,
      artifactSha256: graphEvidenceFingerprint(evidence),
      manifestSha256: evidence.manifestFingerprint,
      resultSha256: evidence.resultFingerprint,
    };
  }

  private assertScopeCurrent(
    binding: StrategyEvidenceBinding,
    options: { readonly requireExecutableScope?: boolean } = {},
  ): StrategyEvidenceBinding {
    if (binding.lifecycleStatus === "stale") {
      throw new StrategyEvidenceApprovalError("STRATEGY_CONFIGURATION_CHANGED", {
        bindingId: binding.bindingId,
      });
    }
    const latest = this.configuration.getLatest(binding.configurationRef.draftId);
    if (graphEvidenceFingerprint(latest.payload) !== binding.configurationRef.payloadFingerprint) {
      this.nextVersion(binding, {
        lifecycleStatus: "stale",
        staleReason: "configuration_changed",
      });
      throw new StrategyEvidenceApprovalError("STRATEGY_CONFIGURATION_CHANGED", {
        bindingId: binding.bindingId,
        latestVersionId: latest.versionId,
      });
    }
    const plan = this.configuration.compileHistorical(binding.configurationRef.versionId);
    let executableStrategy:
      | ExecutableStrategyConfiguration
      | undefined;
    try {
      executableStrategy = options.requireExecutableScope === false
        ? undefined
        : this.executableStrategyScope?.getCurrent(
            binding.configurationRef.versionId,
          );
    } catch {
      this.nextVersion(binding, {
        lifecycleStatus: "stale",
        staleReason: "evidence_scope_changed",
      });
      throw new StrategyEvidenceApprovalError(
        "STRATEGY_EVIDENCE_SCOPE_CHANGED",
        { bindingId: binding.bindingId },
      );
    }
    const dataset = this.datasets.require(binding.datasetRef.id);
    const profile = this.profiles.require(binding.backtestProfileRef.id, plan.presetRef.id);
    const candidateSet = this.profiles.requireCandidateSet(
      binding.walkForwardCandidateSetRef.id,
    );
    const walkForwardPlan = this.walkForwardPlans.require(binding.walkForwardPlanRef.id);
    const scopeChanged =
      plan.fingerprint !== binding.historicalPlanRef.fingerprint ||
      dataset.fingerprint !== binding.datasetRef.fingerprint ||
      profile.fingerprint !== binding.backtestProfileRef.fingerprint ||
      candidateSet.fingerprint !== binding.walkForwardCandidateSetRef.fingerprint ||
      walkForwardPlan.fingerprint !== binding.walkForwardPlanRef.fingerprint ||
      (
        executableStrategy !== undefined &&
        (
          executableStrategy.derivedProfile.fingerprint !==
            binding.backtestProfileRef.fingerprint ||
          executableStrategy.derivedCandidateSet.fingerprint !==
            binding.walkForwardCandidateSetRef.fingerprint
        )
      );
    if (scopeChanged) {
      this.nextVersion(binding, {
        lifecycleStatus: "stale",
        staleReason: "evidence_scope_changed",
      });
      throw new StrategyEvidenceApprovalError("STRATEGY_EVIDENCE_SCOPE_CHANGED", {
        bindingId: binding.bindingId,
      });
    }
    return binding;
  }

  private nextVersion(
    binding: StrategyEvidenceBinding,
    patch: Partial<StrategyEvidenceBinding>,
  ): StrategyEvidenceBinding {
    const versionIndex = binding.versionIndex + 1;
    const { fingerprint: _fingerprint, ...base } = binding;
    const withoutFingerprint = {
      ...base,
      ...patch,
      versionId: `${binding.bindingId}:v${versionIndex}`,
      versionIndex,
      parentFingerprint: binding.fingerprint,
      updatedAt: this.now().toISOString(),
      runtimeApplied: false as const,
    };
    const next = StrategyEvidenceBindingSchema.parse({
      ...withoutFingerprint,
      fingerprint: graphEvidenceFingerprint(withoutFingerprint),
    });
    return this.bindings.save(next);
  }
}
