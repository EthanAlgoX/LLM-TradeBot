import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import type {
  GraphEvidenceArtifact,
  GraphEvidenceJob,
  GraphEvidenceVerificationResult,
  HistoricalGraphExecutionPlan,
  OrchestrationActor,
} from "../packages/contracts/src/index.js";
import {
  ConfigurationDraftService,
  createGraphHistoricalDatasetDefinition,
  createGraphStrategyProfileCandidateSet,
  createGraphStrategyProfileDefinition,
  createGraphWalkForwardPlanDefinition,
  graphEvidenceFingerprint,
  RegisteredGraphHistoricalDatasetRegistry,
  RegisteredGraphStrategyProfileRegistry,
  RegisteredGraphWalkForwardPlanRegistry,
  StrategyEvidenceApprovalError,
  StrategyEvidenceApprovalService,
  type StrategyGraphEvidenceJobPort,
} from "../packages/core/src/index.js";
import {
  LocalBearerAuthenticator,
  SqliteApprovedPaperPlanRepository,
  SqliteConfigurationDraftRepository,
  SqliteStrategyEvidenceBindingRepository,
  StrategyEvidenceHttpHandler,
} from "../packages/runtime/src/index.js";

const now = () => new Date("2026-07-26T10:00:00.000Z");
const fingerprint = (id: string) => graphEvidenceFingerprint({ id });

const historicalPlan = {
  schemaVersion: "1.0.0",
  planId: "historical-plan.strategy-evidence",
  version: "v1",
  fingerprint: fingerprint("historical-plan"),
  lifecycleStatus: "registered",
  createdAt: now().toISOString(),
  presetRef: {
    id: "pipeline-graph.current",
    version: "v1",
    fingerprint: fingerprint("preset"),
  },
  compiledGraphRef: {
    id: "pipeline-graph.current",
    version: "v1",
    fingerprint: fingerprint("graph"),
  },
  executionMode: "paper_capable",
  marketPackRef: {
    id: "market-pack.crypto",
    version: "v1",
    fingerprint: fingerprint("market-pack"),
  },
  requiredCapabilityKinds: ["bar"],
  nodes: [
    {
      index: 0,
      nodeId: "node.decision",
      role: "decision",
      executorId: "executor.decision",
      authority: "decision_intent",
      observationWindowIds: ["bar_interval:day:1"],
      predecessorNodeIds: [],
      successorNodeIds: ["node.portfolio"],
      inputBindings: [],
      outputArtifactTypes: ["artifact.decision"],
    },
    {
      index: 1,
      nodeId: "node.portfolio",
      role: "portfolio",
      executorId: "executor.portfolio",
      authority: "portfolio_action",
      observationWindowIds: [],
      predecessorNodeIds: ["node.decision"],
      successorNodeIds: ["node.risk"],
      inputBindings: [
        {
          edgeId: "edge.decision-portfolio",
          sourceNodeId: "node.decision",
          artifactType: "artifact.decision",
          policy: "required",
        },
      ],
      outputArtifactTypes: ["artifact.portfolio"],
    },
    {
      index: 2,
      nodeId: "node.risk",
      role: "risk",
      executorId: "executor.risk",
      authority: "risk_gate",
      observationWindowIds: [],
      predecessorNodeIds: ["node.portfolio"],
      successorNodeIds: ["node.execution"],
      inputBindings: [
        {
          edgeId: "edge.portfolio-risk",
          sourceNodeId: "node.portfolio",
          artifactType: "artifact.portfolio",
          policy: "required",
        },
      ],
      outputArtifactTypes: ["artifact.risk"],
    },
    {
      index: 3,
      nodeId: "node.execution",
      role: "execution",
      executorId: "executor.execution",
      authority: "execution",
      observationWindowIds: [],
      predecessorNodeIds: ["node.risk"],
      successorNodeIds: [],
      inputBindings: [
        {
          edgeId: "edge.risk-execution",
          sourceNodeId: "node.risk",
          artifactType: "artifact.risk",
          policy: "required",
        },
      ],
      outputArtifactTypes: ["artifact.execution"],
    },
  ],
  runtimeApplied: false,
} as HistoricalGraphExecutionPlan;

const operator: OrchestrationActor = {
  actorId: "actor.operator",
  displayName: "Test Operator",
  roles: ["operator"],
};

const approver: OrchestrationActor = {
  actorId: "actor.approver",
  displayName: "Test Approver",
  roles: ["approver"],
};

class FakeStrategyGraphEvidenceJobs implements StrategyGraphEvidenceJobPort {
  readonly jobs = new Map<string, GraphEvidenceJob>();
  promotionEligible = true;
  tamperPlan = false;

  constructor(
    private readonly datasetRef: HistoricalGraphExecutionPlan["marketPackRef"],
    private readonly profileRef: HistoricalGraphExecutionPlan["marketPackRef"],
    private readonly candidateSetRef: HistoricalGraphExecutionPlan["marketPackRef"],
  ) {}

  submitBacktest(rawRequest: unknown): GraphEvidenceJob {
    return this.submit("backtest", rawRequest);
  }

  submitWalkForward(rawRequest: unknown): GraphEvidenceJob {
    return this.submit("walk_forward", rawRequest);
  }

  async run(jobId: string): Promise<GraphEvidenceJob> {
    const job = this.jobs.get(jobId);
    assert.ok(job);
    const profileScopeRef =
      job.kind === "backtest" ? this.profileRef : this.candidateSetRef;
    const evidence = {
      schemaVersion: "1.0.0",
      artifactId: `artifact.${job.jobId}`,
      evidenceRef: `evidence.${job.jobId}`,
      kind: job.kind === "backtest" ? "graph_backtest" : "graph_walk_forward",
      generatedBy: "tradebot-server",
      createdAt: now().toISOString(),
      manifestFingerprint: fingerprint(`manifest.${job.jobId}`),
      planRef: {
        id: historicalPlan.planId,
        version: historicalPlan.version,
        fingerprint: this.tamperPlan
          ? fingerprint("tampered-plan")
          : historicalPlan.fingerprint,
      },
      datasetRef: this.datasetRef,
      profileScopeRef,
      promotionEligible: this.promotionEligible,
      runtimeApplied: false,
      result: {},
      resultFingerprint: fingerprint(`result.${job.jobId}`),
    } as unknown as GraphEvidenceArtifact;
    const completed = {
      ...job,
      status: "succeeded",
      startedAt: now().toISOString(),
      completedAt: now().toISOString(),
      evidence,
    } as GraphEvidenceJob;
    this.jobs.set(jobId, completed);
    return completed;
  }

  get(jobId: string): GraphEvidenceJob {
    const job = this.jobs.get(jobId);
    assert.ok(job);
    return job;
  }

  private submit(kind: "backtest" | "walk_forward", rawRequest: unknown): GraphEvidenceJob {
    const request = rawRequest as { idempotencyKey: string };
    const replay = [...this.jobs.values()].find(
      (job) =>
        job.kind === kind &&
        (job.request as { idempotencyKey: string }).idempotencyKey ===
          request.idempotencyKey,
    );
    if (replay) {
      return replay;
    }
    const jobId = `graph-job.${kind}.${this.jobs.size + 1}`;
    const job = {
      schemaVersion: "1.0.0",
      jobId,
      kind,
      request: rawRequest,
      requestFingerprint: fingerprint(jobId),
      status: "queued",
      requestedAt: now().toISOString(),
    } as GraphEvidenceJob;
    this.jobs.set(jobId, job);
    return job;
  }
}

function createHarness() {
  const database = new DatabaseSync(":memory:");
  const configuration = new ConfigurationDraftService(
    new SqliteConfigurationDraftRepository(database),
    {
      snapshot: () => ({
        marketPackIds: ["market-pack.crypto"],
        dataSourceIds: ["data-source.csv"],
        agentTemplateIds: ["agent-template.analysis"],
        allowedToolIds: ["tool.market-data"],
      }),
    },
    {
      pipelineDraftExists: (pipelineDraftId) => pipelineDraftId === "pipeline-draft.current",
      compilePipelineDraft: () => historicalPlan,
    },
    now,
  );
  const prompt = configuration.create(
    {
      schemaVersion: "1.0.0",
      humanVersion: "v1",
      payload: {
        kind: "prompt_policy",
        agentTemplateId: "agent-template.analysis",
        systemInstructions: "Analyze registered evidence and return semantic output only.",
        decisionRules: ["Do not execute orders."],
        parameters: {},
        allowedToolIds: ["tool.market-data"],
      },
    },
    operator.actorId,
  );
  const agent = configuration.create(
    {
      schemaVersion: "1.0.0",
      humanVersion: "v1",
      payload: {
        kind: "agent",
        marketPackId: "market-pack.crypto",
        agentTemplateId: "agent-template.analysis",
        dataSourceIds: ["data-source.csv"],
        observationWindows: [{ kind: "bar_interval", unit: "day", value: 1 }],
        promptPolicyDraftId: prompt.draftId,
        parameters: {},
      },
    },
    operator.actorId,
  );
  const strategy = configuration.create(
    {
      schemaVersion: "1.0.0",
      humanVersion: "v1",
      payload: {
        kind: "strategy",
        marketPackId: "market-pack.crypto",
        pipelineDraftId: "pipeline-draft.current",
        agentConfigurationDraftIds: [agent.draftId],
        promptPolicyDraftIds: [prompt.draftId],
        weights: { analysis: 1 },
        thresholds: { minimumConfidence: 0.6 },
      },
    },
    operator.actorId,
  );

  const dataset = createGraphHistoricalDatasetDefinition({
    schemaVersion: "1.0.0",
    id: "dataset.strategy-evidence",
    version: "v1",
    lifecycleStatus: "active",
    createdAt: now().toISOString(),
    marketPackRef: historicalPlan.marketPackRef,
    dataSourceRef: {
      id: "data-source.csv",
      version: "v1",
      fingerprint: fingerprint("data-source"),
    },
    timezone: "UTC",
    tradingCalendarRef: "calendar.24x7",
    asOfSequence: [
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z",
    ],
  });
  const profile = createGraphStrategyProfileDefinition({
    schemaVersion: "1.0.0",
    id: "profile.strategy-evidence",
    version: "v1",
    lifecycleStatus: "active",
    createdAt: now().toISOString(),
    compatiblePresetIds: [historicalPlan.presetRef.id],
    parameters: { minimumConfidence: 0.6 },
  });
  const candidateSet = createGraphStrategyProfileCandidateSet({
    schemaVersion: "1.0.0",
    id: "profile-set.strategy-evidence",
    version: "v1",
    lifecycleStatus: "active",
    createdAt: now().toISOString(),
    profileIds: [profile.id],
  });
  const walkForwardPlan = createGraphWalkForwardPlanDefinition({
    schemaVersion: "1.0.0",
    id: "walk-forward-plan.strategy-evidence",
    version: "v1",
    lifecycleStatus: "active",
    createdAt: now().toISOString(),
    trainingCycles: 2,
    validationCycles: 1,
    stepCycles: 1,
    objective: "total_return_pct",
  });
  const jobs = new FakeStrategyGraphEvidenceJobs(
    {
      id: dataset.id,
      version: dataset.version,
      fingerprint: dataset.fingerprint,
    },
    {
      id: profile.id,
      version: profile.version,
      fingerprint: profile.fingerprint,
    },
    {
      id: candidateSet.id,
      version: candidateSet.version,
      fingerprint: candidateSet.fingerprint,
    },
  );
  const bindingRepository = new SqliteStrategyEvidenceBindingRepository(database);
  const service = new StrategyEvidenceApprovalService(
    configuration,
    bindingRepository,
    jobs,
    new RegisteredGraphHistoricalDatasetRegistry([dataset]),
    new RegisteredGraphStrategyProfileRegistry([profile], [candidateSet]),
    new RegisteredGraphWalkForwardPlanRegistry([walkForwardPlan]),
    new SqliteApprovedPaperPlanRepository(database),
    {
      planVersion: "v1",
      paperAccountRef: "paper-account.default",
      candidateSymbols: ["BTCUSDT"],
      riskPolicyRefs: ["risk-policy.default"],
      planTtlMs: 86_400_000,
    },
    {
      now,
      verifyEvidence: (artifact, current) => {
        const issueCodes: GraphEvidenceVerificationResult["issueCodes"] = [];
        if (artifact.planRef.fingerprint !== current.planFingerprint) {
          issueCodes.push("PLAN_FINGERPRINT_MISMATCH" as const);
        }
        if (artifact.datasetRef.fingerprint !== current.datasetFingerprint) {
          issueCodes.push("DATASET_FINGERPRINT_MISMATCH" as const);
        }
        if (artifact.profileScopeRef.fingerprint !== current.profileScopeFingerprint) {
          issueCodes.push("PROFILE_SCOPE_FINGERPRINT_MISMATCH" as const);
        }
        return { valid: issueCodes.length === 0, issueCodes };
      },
    },
  );
  const createRequest = {
    schemaVersion: "1.0.0",
    strategyConfigurationVersionId: strategy.versionId,
    datasetId: dataset.id,
    backtestProfileId: profile.id,
    walkForwardCandidateSetId: candidateSet.id,
    walkForwardPlanId: walkForwardPlan.id,
    startAt: "2026-01-01T00:00:00.000Z",
    endAt: "2026-01-03T00:00:00.000Z",
    idempotencyKey: "create-strategy-evidence-001",
  };
  return {
    database,
    configuration,
    strategy,
    jobs,
    bindingRepository,
    service,
    createRequest,
  };
}

async function completeEvidence(harness: ReturnType<typeof createHarness>) {
  const created = harness.service.createBinding(harness.createRequest, operator);
  const backtested = await harness.service.runBacktest(
    created.bindingId,
    { schemaVersion: "1.0.0", idempotencyKey: "backtest-strategy-001" },
    operator,
  );
  const ready = await harness.service.runWalkForward(
    created.bindingId,
    { schemaVersion: "1.0.0", idempotencyKey: "walk-forward-strategy-001" },
    operator,
  );
  return { created, backtested, ready };
}

test("strategy binding requires both M3 evidence kinds before human approval creates a non-running paper plan", async () => {
  const harness = createHarness();
  const created = harness.service.createBinding(harness.createRequest, operator);
  assert.equal(created.lifecycleStatus, "draft");
  assert.equal(created.runtimeApplied, false);
  assert.throws(
    () =>
      harness.service.approve(
        created.bindingId,
        { schemaVersion: "1.0.0", idempotencyKey: "approval-too-early-001" },
        approver,
      ),
    (error) =>
      error instanceof StrategyEvidenceApprovalError &&
      error.code === "STRATEGY_EVIDENCE_NOT_READY",
  );

  const { ready } = await completeEvidence(harness);
  assert.equal(ready.lifecycleStatus, "evidence_ready");
  assert.equal(harness.configuration.getLatest(harness.strategy.draftId).evidenceState.status, "current");

  const approved = harness.service.approve(
    ready.bindingId,
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "approve-strategy-evidence-001",
      note: "Evidence reviewed.",
    },
    approver,
  );
  assert.equal(approved.binding.lifecycleStatus, "approved");
  assert.equal(approved.plan.lifecycleStatus, "approved_ready");
  assert.equal(approved.plan.runtimeApplied, false);
  assert.equal(approved.plan.paperAccountRef, "paper-account.default");
  assert.deepEqual(approved.plan.candidateSymbols, ["BTCUSDT"]);
  assert.equal(approved.plan.approvedByActorId, approver.actorId);
  assert.equal(harness.bindingRepository.listVersions(ready.bindingId).length, 4);

  const replayedEvidence = await harness.service.runWalkForward(
    ready.bindingId,
    { schemaVersion: "1.0.0", idempotencyKey: "walk-forward-strategy-001" },
    operator,
  );
  assert.equal(replayedEvidence.fingerprint, approved.binding.fingerprint);
  const replayedApproval = harness.service.approve(
    ready.bindingId,
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "approve-strategy-evidence-001",
      note: "Evidence reviewed.",
    },
    approver,
  );
  assert.equal(replayedApproval.plan.fingerprint, approved.plan.fingerprint);
});

test("a changed strategy payload makes completed evidence stale and blocks approval", async () => {
  const harness = createHarness();
  const { ready } = await completeEvidence(harness);
  const latest = harness.configuration.getLatest(harness.strategy.draftId);
  assert.equal(latest.payload.kind, "strategy");
  harness.configuration.createVersion(
    latest.draftId,
    {
      schemaVersion: "1.0.0",
      parentFingerprint: latest.fingerprint,
      humanVersion: "v2",
      payload: {
        ...latest.payload,
        thresholds: { minimumConfidence: 0.75 },
      },
    },
    operator.actorId,
  );

  assert.throws(
    () =>
      harness.service.approve(
        ready.bindingId,
        { schemaVersion: "1.0.0", idempotencyKey: "approve-stale-strategy-001" },
        approver,
      ),
    (error) =>
      error instanceof StrategyEvidenceApprovalError &&
      error.code === "STRATEGY_CONFIGURATION_CHANGED",
  );
  assert.equal(harness.service.get(ready.bindingId).lifecycleStatus, "stale");
  assert.equal(harness.service.get(ready.bindingId).staleReason, "configuration_changed");
  const readable = harness.service.findReadableForConfiguration(
    harness.strategy.versionId,
  );
  assert.equal(readable?.lifecycleStatus, "stale");
  assert.equal(readable?.backtestJob?.jobId, ready.backtestJob?.jobId);
  assert.equal(readable?.walkForwardJob?.jobId, ready.walkForwardJob?.jobId);
  assert.equal(
    harness.service.findReadableForConfiguration(latest.versionId),
    undefined,
  );
});

test("promotion-ineligible or tampered evidence and non-approver actors fail closed", async () => {
  const ineligible = createHarness();
  const binding = ineligible.service.createBinding(ineligible.createRequest, operator);
  ineligible.jobs.promotionEligible = false;
  await assert.rejects(
    () =>
      ineligible.service.runBacktest(
        binding.bindingId,
        { schemaVersion: "1.0.0", idempotencyKey: "ineligible-backtest-001" },
        operator,
      ),
    (error) =>
      error instanceof StrategyEvidenceApprovalError &&
      error.code === "STRATEGY_EVIDENCE_INTEGRITY_FAILED",
  );

  const tampered = createHarness();
  const tamperedBinding = tampered.service.createBinding(tampered.createRequest, operator);
  tampered.jobs.tamperPlan = true;
  await assert.rejects(
    () =>
      tampered.service.runBacktest(
        tamperedBinding.bindingId,
        { schemaVersion: "1.0.0", idempotencyKey: "tampered-backtest-001" },
        operator,
      ),
    (error) =>
      error instanceof StrategyEvidenceApprovalError &&
      error.code === "STRATEGY_EVIDENCE_INTEGRITY_FAILED",
  );

  const complete = createHarness();
  const { ready } = await completeEvidence(complete);
  assert.throws(
    () =>
      complete.service.approve(
        ready.bindingId,
        { schemaVersion: "1.0.0", idempotencyKey: "operator-approval-001" },
        operator,
      ),
    (error) =>
      error instanceof StrategyEvidenceApprovalError &&
      error.code === "STRATEGY_EVIDENCE_ACTOR_ROLE_REQUIRED",
  );
});

test("strategy evidence HTTP derives actor identity and rejects plan, evidence, and runtime injection", async () => {
  const harness = createHarness();
  const handler = new StrategyEvidenceHttpHandler(
    harness.service,
    new LocalBearerAuthenticator([
      { token: "operator-token", actor: operator },
      { token: "approver-token", actor: approver },
    ]),
  );
  const unauthorized = await handler.handle(
    new Request("http://localhost/api/orchestration/strategy-evidence/bindings"),
  );
  assert.equal(unauthorized.status, 401);

  const injected = await handler.handle(
    new Request("http://localhost/api/orchestration/strategy-evidence/bindings", {
      method: "POST",
      headers: {
        authorization: "Bearer operator-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...harness.createRequest,
        actorId: "actor.attacker",
        planId: "historical-plan.attacker",
        evidence: { forged: true },
        runtimeApplied: true,
      }),
    }),
  );
  assert.equal(injected.status, 400);

  const created = await handler.handle(
    new Request("http://localhost/api/orchestration/strategy-evidence/bindings", {
      method: "POST",
      headers: {
        authorization: "Bearer operator-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(harness.createRequest),
    }),
  );
  assert.equal(created.status, 201);
  const body = (await created.json()) as { runtimeApplied: boolean; bindingId: string };
  assert.equal(body.runtimeApplied, false);
  assert.ok(body.bindingId);
});
