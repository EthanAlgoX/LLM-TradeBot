import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  ExperimentCreateRequestSchema,
  ExperimentEvidenceSchema,
  ExperimentSchema,
  type Experiment,
  type ExperimentParticipant,
  type GraphEvidenceArtifact,
  type GraphEvidenceJob,
} from "../packages/contracts/src/index.js";
import {
  createGraphEvidenceArtifact,
  graphEvidenceFingerprint,
} from "../packages/core/src/index.js";
import {
  ExperimentLabHttpHandler,
  ExperimentLabService,
  LocalBearerAuthenticator,
  SqliteExperimentRepository,
  deriveExperimentComparability,
} from "../packages/runtime/src/index.js";

const time = "2026-08-01T00:00:00.000Z";
const end = "2026-08-02T00:00:00.000Z";
const fp = (name: string) => graphEvidenceFingerprint({ name });
const ref = (id: string) => ({ id, version: "v1", fingerprint: fp(id) });

const request = () => ({
  schemaVersion: "1.0.0",
  idempotencyKey: "experiment-request-1",
  participantVersionIds: ["strategy:one", "strategy:two"],
  datasetId: "dataset:one",
  startAt: time,
  endAt: end,
  walkForwardPlanId: "plan:walk-forward",
  comparisonMode: "STRATEGY_COMPARISON",
  objective: { kind: "maximize_total_return" },
  constraints: {},
});

function participant(
  suffix: string,
  overrides: Partial<ExperimentParticipant["configProjection"]> = {},
): ExperimentParticipant {
  const parameters = {
    initialCash: 10_000,
    feeBps: 3,
    slippageBps: 1,
    maxNotional: 1_000,
  };
  return {
    participantId: `participant:${suffix}`,
    label: `Strategy ${suffix}`,
    strategyVersionRef: ref(`strategy:${suffix}`),
    strategyFingerprint: fp(`strategy:${suffix}`),
    executableFingerprint: fp(`executable:${suffix}`),
    historicalPlanRef: ref("historical-plan:one"),
    marketPackRef: ref("market-pack:one"),
    baseProfileRef: ref("profile:base"),
    profileRef: ref(`profile:${suffix}`),
    candidateSetRef: ref(`candidate-set:${suffix}`),
    agentConfigurationRefs: [ref(`agent:${suffix}`)],
    promptPolicyRefs: [],
    configProjection: {
      marketPackId: "market-pack:one",
      modelMode: "rule",
      executionFingerprint: fp("execution:shared"),
      riskFingerprint: fp("risk:shared"),
      modelFingerprint: fp("model:rule"),
      promptSetFingerprint: fp("prompts:none"),
      graphFingerprint: fp("graph:shared"),
      agentGraphFingerprint: fp("agent-graph:shared"),
      effectiveParameters: parameters,
      ...overrides,
    },
    constraintResults: [],
    issueCodes: [],
  };
}

function experiment(
  id: string,
  actorId = "actor:one",
  participants = [participant("one"), participant("two")],
): Experiment {
  return ExperimentSchema.parse({
    schemaVersion: "1.0.0",
    experimentId: id,
    fingerprint: fp(`definition:${id}`),
    createdAt: time,
    actorId,
    lifecycleStatus: "draft",
    comparability: deriveExperimentComparability(
      "STRATEGY_COMPARISON",
      participants,
    ),
    lock: {
      dataset: {
        datasetRef: ref("dataset:one"),
        marketPackRef: ref("market-pack:one"),
        dataSourceRef: ref("data-source:csv"),
        timezone: "UTC",
        tradingCalendarRef: "calendar:crypto-24x7",
        startAt: time,
        endAt: end,
      },
      walkForwardPlanRef: ref("plan:walk-forward"),
      objective: { kind: "maximize_total_return" },
      constraints: {},
      execution: {
        model: "graph_trading",
        parameters: { initialCash: 10_000, feeBps: 3, slippageBps: 1 },
        fingerprint: fp("execution-lock"),
        unavailableFields: [],
      },
      risk: {
        parameters: { maxNotional: 1_000 },
        fingerprint: fp("risk-lock"),
      },
      modelPrompt: {
        modelMode: "rule",
        modelFingerprint: fp("model:rule"),
        promptRefs: [],
        promptSetFingerprint: fp("prompts:none"),
      },
      failurePolicy: "fail_closed",
      runtimeApplied: false,
      exchangeWriteAllowed: false,
    },
    participants,
    configurationDiff: [],
  });
}

function backtestArtifact(
  target: ExperimentParticipant,
  totalReturnPct: number,
): GraphEvidenceArtifact {
  const initialEquity = 10_000;
  const finalEquity = initialEquity * (1 + totalReturnPct / 100);
  const result = {
    schemaVersion: "1.0.0" as const,
    runId: `backtest-run:${target.participantId}`,
    version: "v1",
    fingerprint: fp(`backtest-run:${target.participantId}:${totalReturnPct}`),
    lifecycleStatus: "succeeded" as const,
    createdAt: time,
    planRef: target.historicalPlanRef,
    datasetRef: ref("dataset:one"),
    profileRef: target.profileRef,
    startAt: time,
    endAt: end,
    cycles: [
      {
        cycleId: `cycle:${target.participantId}`,
        asOf: end,
        graphRunId: `graph-run:${target.participantId}`,
        graphPlanRef: target.historicalPlanRef,
        graphRunStatus: "succeeded" as const,
        nodeRunCount: 4,
        artifactFingerprints: [],
        lineageFingerprints: [fp(`lineage:${target.participantId}`)],
        outcome: {
          mode: "trading" as const,
          equity: finalEquity,
          availableCash: finalEquity,
          realizedPnl: finalEquity - initialEquity,
          unrealizedPnl: 0,
          tradeCount: 2,
          fillCount: 2,
          riskRejectionCount: 0,
        },
        fingerprint: fp(`cycle:${target.participantId}`),
      },
    ],
    metrics: {
      mode: "trading" as const,
      initialEquity,
      finalEquity,
      totalReturnPct,
      maxDrawdownPct: 2,
      tradeCount: 2,
      fillCount: 2,
      riskRejectionCount: 0,
      cycleCount: 1,
    },
    promotionEligible: true,
    runtimeApplied: false as const,
  };
  return createGraphEvidenceArtifact({
    kind: "graph_backtest",
    result,
    profileScopeRef: target.profileRef,
    createdAt: time,
  });
}

function walkForwardArtifact(
  target: ExperimentParticipant,
  validationReturnPct: number,
): GraphEvidenceArtifact {
  const metrics = {
    mode: "trading" as const,
    initialEquity: 10_000,
    finalEquity: 10_100,
    totalReturnPct: validationReturnPct,
    maxDrawdownPct: 1,
    tradeCount: 2,
    fillCount: 2,
    riskRejectionCount: 0,
    cycleCount: 1,
  };
  const result = {
    schemaVersion: "1.0.0" as const,
    runId: `walk-forward-run:${target.participantId}`,
    version: "v1",
    fingerprint: fp(`walk-forward-run:${target.participantId}`),
    lifecycleStatus: "succeeded" as const,
    createdAt: time,
    planRef: target.historicalPlanRef,
    datasetRef: ref("dataset:one"),
    candidateSetRef: target.candidateSetRef,
    walkForwardPlanRef: ref("plan:walk-forward"),
    folds: [
      {
        foldId: `fold:${target.participantId}`,
        trainingStartAt: "2026-07-29T00:00:00.000Z",
        trainingEndAt: "2026-07-30T00:00:00.000Z",
        validationStartAt: time,
        validationEndAt: end,
        candidates: [
          {
            profileRef: target.profileRef,
            trainingRunRef: ref(`training:${target.participantId}`),
            metrics,
          },
        ],
        selectedProfileRef: target.profileRef,
        validationRunRef: ref(`validation:${target.participantId}`),
        validationMetrics: metrics,
        fingerprint: fp(`fold:${target.participantId}`),
      },
    ],
    promotionEligible: true,
    runtimeApplied: false as const,
  };
  return createGraphEvidenceArtifact({
    kind: "graph_walk_forward",
    result,
    profileScopeRef: target.candidateSetRef,
    createdAt: time,
  });
}

function projection(
  artifact: GraphEvidenceArtifact,
  totalReturnPct?: number,
) {
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
  return totalReturnPct === undefined
    ? {
        ...common,
        walkForward: {
          foldCount: 1,
          positiveValidation: true,
          promotionEligible: true,
          runtimeFailureCount: 0,
          validationReturnsPct: [1],
        },
      }
    : {
        ...common,
        scorecard: {
          totalReturnPct,
          maxDrawdownPct: 2,
          tradeCount: 2,
          fillCount: 2,
          riskRejectionCount: 0,
          cycleCount: 1,
          runtimeFailureCount: 0,
          equityPoints: [
            { asOf: end, equity: 10_000 * (1 + totalReturnPct / 100) },
          ],
          unavailableMetrics: ["sharpe", "sortino", "profit_factor"],
        },
      };
}

function readyExperiment(
  id: string,
  returns: [number, number] = [8, 4],
): { experiment: Experiment; jobs: Map<string, GraphEvidenceJob> } {
  const base = experiment(id);
  const jobs = new Map<string, GraphEvidenceJob>();
  const participants = base.participants.map((item, index) => {
    const backtest = backtestArtifact(item, returns[index]!);
    const walkForward = walkForwardArtifact(item, 1);
    const backtestJobId = `job:backtest:${item.participantId}`;
    const walkForwardJobId = `job:walk-forward:${item.participantId}`;
    jobs.set(backtestJobId, {
      schemaVersion: "1.0.0",
      jobId: backtestJobId,
      kind: "backtest",
      request: {
        schemaVersion: "1.0.0",
        planId: item.historicalPlanRef.id,
        datasetId: base.lock.dataset.datasetRef.id,
        profileId: item.profileRef.id,
        startAt: time,
        endAt: end,
        idempotencyKey: `idempotency:backtest:${item.participantId}`,
      },
      requestFingerprint: fp(`request:${backtestJobId}`),
      status: "succeeded",
      requestedAt: time,
      completedAt: end,
      evidence: backtest,
    });
    jobs.set(walkForwardJobId, {
      schemaVersion: "1.0.0",
      jobId: walkForwardJobId,
      kind: "walk_forward",
      request: {
        schemaVersion: "1.0.0",
        planId: item.historicalPlanRef.id,
        datasetId: base.lock.dataset.datasetRef.id,
        profileCandidateSetId: item.candidateSetRef.id,
        walkForwardPlanId: base.lock.walkForwardPlanRef.id,
        startAt: time,
        endAt: end,
        idempotencyKey: `idempotency:walk-forward:${item.participantId}`,
      },
      requestFingerprint: fp(`request:${walkForwardJobId}`),
      status: "succeeded",
      requestedAt: time,
      completedAt: end,
      evidence: walkForward,
    });
    return {
      ...item,
      backtestJobId,
      walkForwardJobId,
      backtestEvidence: projection(backtest, returns[index]!),
      walkForwardEvidence: projection(walkForward),
      constraintResults: [],
    };
  });
  return {
    experiment: ExperimentSchema.parse({
      ...base,
      participants,
      lifecycleStatus: "evidence_complete",
    }),
    jobs,
  };
}

function service(
  repository: SqliteExperimentRepository,
  jobs: Map<string, GraphEvidenceJob> = new Map(),
) {
  return new ExperimentLabService(
    repository,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    { get: (jobId: string) => {
      const job = jobs.get(jobId);
      if (!job) throw new Error("GRAPH_JOB_NOT_FOUND");
      return job;
    } } as never,
  );
}

test("experiment create contracts reject unknown fields, duplicate participants, invalid ranges, and false failure guards", () => {
  assert.throws(() => ExperimentCreateRequestSchema.parse({ ...request(), unexpected: true }));
  assert.throws(() => ExperimentCreateRequestSchema.parse({ ...request(), participantVersionIds: ["strategy:one", "strategy:one"] }));
  assert.throws(() => ExperimentCreateRequestSchema.parse({ ...request(), startAt: "2026-08-03T00:00:00.000Z" }));
  assert.throws(() => ExperimentCreateRequestSchema.parse({ ...request(), constraints: { runtimeFailureCountEqZero: false } }));
});

test("experiment contracts require two to five participants and exactly one evidence projection kind", () => {
  assert.throws(() => ExperimentCreateRequestSchema.parse({ ...request(), participantVersionIds: ["strategy:one"] }));
  assert.throws(() => ExperimentCreateRequestSchema.parse({ ...request(), participantVersionIds: ["a:one", "a:two", "a:three", "a:four", "a:five", "a:six"] }));
  const ready = readyExperiment("experiment:evidence-shape").experiment;
  const evidence = ready.participants[0]!.backtestEvidence!;
  assert.throws(() => ExperimentEvidenceSchema.parse({ ...evidence, walkForward: ready.participants[0]!.walkForwardEvidence!.walkForward }));
});

test("repository is actor isolated and cursor is actor-bound with stable limit-plus-one pagination", () => {
  const database = new DatabaseSync(":memory:");
  const repository = new SqliteExperimentRepository(database);
  repository.save(experiment("experiment:one"), "key:one");
  repository.save(experiment("experiment:two"), "key:two");
  repository.save(experiment("experiment:other", "actor:two"), "key:other");
  assert.throws(() => repository.get("experiment:one", "actor:two"), /EXPERIMENT_NOT_FOUND/);
  const first = repository.list("actor:one", 1);
  assert.equal(first.data.length, 1);
  assert.ok(first.nextCursor);
  const second = repository.list("actor:one", 1, first.nextCursor);
  assert.equal(second.data.length, 1);
  assert.notEqual(second.data[0]!.experimentId, first.data[0]!.experimentId);
  assert.throws(() => repository.list("actor:two", 1, first.nextCursor), /EXPERIMENT_CURSOR_INVALID/);
});

test("repository definitions and events are append-only and immutable definition drift fails closed", () => {
  const database = new DatabaseSync(":memory:");
  const repository = new SqliteExperimentRepository(database);
  const draft = experiment("experiment:immutable");
  repository.save(draft, "key:immutable");
  repository.append({ ...draft, lifecycleStatus: "backtest_partial" });
  assert.throws(() => database.prepare("UPDATE experiment_definitions SET created_at = ?").run(time), /EXPERIMENT_IMMUTABLE/);
  assert.throws(() => database.prepare("DELETE FROM experiment_events").run(), /EXPERIMENT_IMMUTABLE/);
  assert.throws(() => repository.append({ ...draft, lock: { ...draft.lock, failurePolicy: "fail_closed", risk: { ...draft.lock.risk, fingerprint: fp("changed-risk") } } }), /EXPERIMENT_DEFINITION_CHANGED/);
});

test("idempotent create retry returns the latest authority and conflicting definition fails", () => {
  const database = new DatabaseSync(":memory:");
  const repository = new SqliteExperimentRepository(database);
  const draft = experiment("experiment:idempotent");
  repository.save(draft, "key:idempotent");
  repository.append({ ...draft, lifecycleStatus: "backtest_partial" });
  assert.equal(repository.save(draft, "key:idempotent").lifecycleStatus, "backtest_partial");
  assert.throws(() => repository.save({ ...draft, fingerprint: fp("changed") }, "key:idempotent"), /EXPERIMENT_IDEMPOTENCY_CONFLICT/);
});

test("comparability derives controlled strategy, open risk drift, incompatible market, and controlled agent graph modes", () => {
  const baseline = participant("one");
  const strategy = participant("two");
  assert.equal(deriveExperimentComparability("STRATEGY_COMPARISON", [baseline, strategy]).status, "CONTROLLED");
  const riskDrift = participant("risk", { riskFingerprint: fp("risk:changed") });
  assert.equal(deriveExperimentComparability("STRATEGY_COMPARISON", [baseline, riskDrift]).status, "OPEN_CLASS");
  const marketDrift = participant("market", { marketPackId: "market-pack:two" });
  assert.equal(deriveExperimentComparability("STRATEGY_COMPARISON", [baseline, marketDrift]).status, "INCOMPATIBLE");
  const graphDrift = participant("graph", { agentGraphFingerprint: fp("agent-graph:two") });
  assert.equal(deriveExperimentComparability("AGENT_GRAPH_COMPARISON", [baseline, graphDrift]).status, "CONTROLLED");
  assert.equal(deriveExperimentComparability("MODEL_COMPARISON", [baseline, strategy]).status, "INCOMPATIBLE");
});

test("candidate selects a unique top participant from multiple eligible participants and is idempotent", () => {
  const database = new DatabaseSync(":memory:");
  const repository = new SqliteExperimentRepository(database);
  const ready = readyExperiment("experiment:candidate", [9, 4]);
  repository.save(ready.experiment, "key:candidate");
  const lab = service(repository, ready.jobs);
  const candidate = lab.candidate(ready.experiment.experimentId, "actor:one");
  assert.equal(candidate.candidate?.participantId, ready.experiment.participants[0]!.participantId);
  assert.equal(candidate.candidate?.status, "candidate_for_validation");
  assert.equal(candidate.candidate?.runtimeApplied, false);
  assert.deepEqual(lab.candidate(ready.experiment.experimentId, "actor:one"), candidate);
  assert.equal((database.prepare("SELECT count(*) AS count FROM experiment_events").get() as { count: number }).count, 1);
});

test("candidate fails closed for a tied first place and open class", () => {
  const database = new DatabaseSync(":memory:");
  const repository = new SqliteExperimentRepository(database);
  const tied = readyExperiment("experiment:tied", [5, 5]).experiment;
  repository.save(tied, "key:tied");
  assert.throws(() => service(repository).candidate(tied.experimentId, "actor:one"), /EXPERIMENT_CANDIDATE_NOT_ELIGIBLE/);
  const open = ExperimentSchema.parse({ ...readyExperiment("experiment:open").experiment, comparability: { status: "OPEN_CLASS", requestedMode: "OPEN_CLASS", changedDimensions: ["strategy"], lockedDimensions: ["dataset"], issueCodes: ["OPEN_CLASS_REQUESTED"] } });
  repository.save(open, "key:open");
  assert.throws(() => service(repository).candidate(open.experimentId, "actor:one"), /EXPERIMENT_CANDIDATE_NOT_ELIGIBLE/);
});

test("replay re-reads durable jobs, verifies artifacts, and is idempotent", () => {
  const database = new DatabaseSync(":memory:");
  const repository = new SqliteExperimentRepository(database);
  const ready = readyExperiment("experiment:replay");
  repository.save(ready.experiment, "key:replay");
  const lab = service(repository, ready.jobs);
  const replayed = lab.replay(ready.experiment.experimentId, "actor:one");
  assert.equal(replayed.replay?.status, "verified");
  assert.deepEqual(lab.replay(ready.experiment.experimentId, "actor:one"), replayed);
  assert.equal((database.prepare("SELECT count(*) AS count FROM experiment_events").get() as { count: number }).count, 1);
});

test("replay fails closed when a durable job request drifts", () => {
  const database = new DatabaseSync(":memory:");
  const repository = new SqliteExperimentRepository(database);
  const ready = readyExperiment("experiment:replay-drift");
  const first = ready.experiment.participants[0]!;
  const job = ready.jobs.get(first.backtestJobId!)!;
  ready.jobs.set(first.backtestJobId!, { ...job, request: { ...job.request, datasetId: "dataset:other" } });
  repository.save(ready.experiment, "key:replay-drift");
  assert.throws(() => service(repository, ready.jobs).replay(ready.experiment.experimentId, "actor:one"), /EXPERIMENT_REPLAY_DRIFT/);
});

test("HTTP derives actor, isolates records, rejects unknown methods and malformed paths", async () => {
  const database = new DatabaseSync(":memory:");
  const repository = new SqliteExperimentRepository(database);
  const record = experiment("experiment:http");
  repository.save(record, "key:http");
  const handler = new ExperimentLabHttpHandler(
    service(repository),
    new LocalBearerAuthenticator([
      { token: "actor-one-token", actor: { actorId: "actor:one", displayName: "One", roles: ["operator"] } },
      { token: "actor-two-token", actor: { actorId: "actor:two", displayName: "Two", roles: ["operator"] } },
    ]),
  );
  const url = "http://localhost/api/orchestration/experiments/experiment:http";
  assert.equal((await handler.handle(new Request(url))).status, 401);
  assert.equal((await handler.handle(new Request(url, { headers: { authorization: "Bearer actor-one-token" } }))).status, 200);
  assert.equal((await handler.handle(new Request(url, { headers: { authorization: "Bearer actor-two-token" } }))).status, 404);
  assert.equal((await handler.handle(new Request(url, { method: "PUT", headers: { authorization: "Bearer actor-one-token" } }))).status, 405);
  assert.equal((await handler.handle(new Request(`${url}/approve`, { method: "POST", headers: { authorization: "Bearer actor-one-token" } }))).status, 404);
  assert.equal((await handler.handle(new Request("http://localhost/api/orchestration/experiments/%E0%A4%A", { headers: { authorization: "Bearer actor-one-token" } }))).status, 400);
});
