import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type {
  HistoricalEvidenceRunPlan,
  HistoricalEvidenceRunnerResult,
} from "../packages/contracts/src/index.js";
import {
  CURRENT_CRYPTO_PIPELINE_GRAPH,
  PipelineEvidenceWorkflowError,
} from "../packages/core/src/index.js";
import {
  createCurrentPipelineOrchestrationRuntime,
  type RegisteredHistoricalEvidenceRunner,
} from "../packages/runtime/src/index.js";

const actor = {
  actorId: "operator:artifact-test",
  displayName: "Artifact Test Operator",
  roles: ["operator", "approver"] as ("operator" | "approver")[],
};

function runner(
  kind: "backtest" | "walk_forward",
  run?: (
    plan: HistoricalEvidenceRunPlan,
  ) => Promise<HistoricalEvidenceRunnerResult>,
): RegisteredHistoricalEvidenceRunner {
  return {
    runnerId: `registered-runner:${kind}`,
    kind,
    allowedParameterKeys:
      kind === "backtest" ? ["feeBpsOverride"] : ["folds"],
    strategyProfileRef: "strategy-profile:balanced@1.0.0",
    dataSourceRef: "data-source:csv-historical@1.0.0",
    dataFingerprint: `sha256:${"a".repeat(64)}`,
    timezone: "UTC",
    tradingCalendarRef: "calendar:crypto-24x7@1.0.0",
    costModel: { feeBps: 4, slippageBps: 2 },
    requestedAsOf: () => "2026-07-26T00:00:00.000Z",
    run:
      run ??
      (async (
        plan,
      ): Promise<HistoricalEvidenceRunnerResult> => ({
        schemaVersion: "1.0.0",
        metrics:
          plan.kind === "backtest"
            ? { trades: 18, netReturn: 0.11 }
            : { folds: 4, positiveFolds: 3 },
        summary: `${plan.kind} executed through registered runner`,
        observations: ["server-owned deterministic test artifact"],
      })),
  };
}

function runtimeWithRunners(
  database: DatabaseSync,
  artifactDirectory: string,
  runners: readonly RegisteredHistoricalEvidenceRunner[] = [
    runner("backtest"),
    runner("walk_forward"),
  ],
) {
  return createCurrentPipelineOrchestrationRuntime({
    database,
    operatorToken: "artifact-test-token",
    operatorActor: actor,
    historicalRunners: runners,
    artifactDirectory,
  });
}

test("registered runner writes verifiable artifact lineage and replays idempotently", async () => {
  const database = new DatabaseSync(":memory:");
  const artifactDirectory = mkdtempSync(
    join(tmpdir(), "tradebot-evidence-artifacts-"),
  );
  const runtime = runtimeWithRunners(database, artifactDirectory);
  const draft = runtime.service.createDraft(CURRENT_CRYPTO_PIPELINE_GRAPH);
  runtime.evidenceWorkflow.validateContract(draft.draftId, actor);

  const request = {
    schemaVersion: "1.0.0" as const,
    idempotencyKey: "backtest-idempotency-001",
    parameters: { feeBpsOverride: 5 },
  };
  const first = await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "backtest",
    request,
    actor,
  );
  const replay = await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "backtest",
    request,
    actor,
  );

  assert.equal(first.status, "succeeded");
  assert.deepEqual(replay, first);
  assert.match(first.evidence?.artifactSha256 ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    first.evidence?.lineage?.dataFingerprint,
    `sha256:${"a".repeat(64)}`,
  );
  const manifest = runtime.artifactStore?.verify(
    first.evidence?.lineage?.artifactId ?? "",
  );
  assert.equal(manifest?.jobId, first.jobId);
  assert.deepEqual(runtime.artifactLedger?.getByJobId(first.jobId), manifest);

  await runtime.close();
  database.close();
});

test("runner rejects unknown parameters and cannot be selected by the client", async () => {
  const database = new DatabaseSync(":memory:");
  const runtime = runtimeWithRunners(
    database,
    mkdtempSync(join(tmpdir(), "tradebot-runner-allowlist-")),
  );
  const draft = runtime.service.createDraft(CURRENT_CRYPTO_PIPELINE_GRAPH);
  runtime.evidenceWorkflow.validateContract(draft.draftId, actor);

  await assert.rejects(
    runtime.evidenceWorkflow.runEvidenceJob(
      draft.draftId,
      "backtest",
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "runner-injection-001",
        parameters: {},
        runnerId: "client:arbitrary-runner",
        outputPath: "/tmp/client-path",
      },
      actor,
    ),
    (error: unknown) =>
      error instanceof PipelineEvidenceWorkflowError &&
      error.code === "EVIDENCE_JOB_REQUEST_INVALID",
  );

  const failed = await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "backtest",
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "unknown-parameter-001",
      parameters: { arbitraryLeverage: 100 },
    },
    actor,
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureCode, "RUNNER_PARAMETER_NOT_ALLOWED");
  assert.equal(
    runtime.service.getDraft(draft.draftId).promotionStage,
    "contract_validated",
  );

  await runtime.close();
  database.close();
});

test("artifact verification rejects modified result content", async () => {
  const database = new DatabaseSync(":memory:");
  const artifactDirectory = mkdtempSync(
    join(tmpdir(), "tradebot-artifact-integrity-"),
  );
  const runtime = runtimeWithRunners(database, artifactDirectory);
  const draft = runtime.service.createDraft(CURRENT_CRYPTO_PIPELINE_GRAPH);
  runtime.evidenceWorkflow.validateContract(draft.draftId, actor);
  const job = await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "backtest",
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "artifact-tamper-001",
      parameters: {},
    },
    actor,
  );
  const artifactId = job.evidence?.lineage?.artifactId ?? "";
  const artifactUuid = artifactId.replace(/^historical-artifact:/, "");
  writeFileSync(
    join(artifactDirectory, artifactUuid, "result.json"),
    '{"metrics":{"netReturn":999}}',
    "utf8",
  );

  assert.throws(
    () => runtime.artifactStore?.verify(artifactId),
    (error: unknown) =>
      error instanceof PipelineEvidenceWorkflowError &&
      error.code === "ARTIFACT_INTEGRITY_FAILED",
  );

  await runtime.close();
  database.close();
});

test("a different idempotency key cannot start while the same job kind is running", async () => {
  const database = new DatabaseSync(":memory:");
  let releaseRunner: (() => void) | undefined;
  const waitForRelease = new Promise<void>((resolve) => {
    releaseRunner = resolve;
  });
  const delayedRunner = runner("backtest", async () => {
    await waitForRelease;
    return {
      schemaVersion: "1.0.0",
      metrics: { trades: 1 },
      summary: "delayed registered runner completed",
      observations: [],
    };
  });
  const runtime = runtimeWithRunners(
    database,
    mkdtempSync(join(tmpdir(), "tradebot-artifact-concurrency-")),
    [delayedRunner, runner("walk_forward")],
  );
  const draft = runtime.service.createDraft(CURRENT_CRYPTO_PIPELINE_GRAPH);
  runtime.evidenceWorkflow.validateContract(draft.draftId, actor);
  const firstPromise = runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "backtest",
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "concurrent-job-first",
      parameters: {},
    },
    actor,
  );

  await assert.rejects(
    runtime.evidenceWorkflow.runEvidenceJob(
      draft.draftId,
      "backtest",
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "concurrent-job-second",
        parameters: {},
      },
      actor,
    ),
    (error: unknown) =>
      error instanceof PipelineEvidenceWorkflowError &&
      error.code === "EVIDENCE_JOB_IN_PROGRESS",
  );
  releaseRunner?.();
  assert.equal((await firstPromise).status, "succeeded");

  await runtime.close();
  database.close();
});
