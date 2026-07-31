import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  PaperActivationRecordSchema,
  PaperRuntimeLaunchContextSchema,
  PaperRuntimeLaunchPresetRequestSchema,
  type ApprovedPaperPlan,
  type OrchestrationActor,
  type PaperActivationRecord,
} from "../packages/contracts/src/index.js";
import { CURRENT_CRYPTO_PIPELINE_GRAPH } from "../packages/core/src/current-crypto-pipeline-graph.js";
import { createCurrentPipelineOrchestrationRuntime } from "../packages/runtime/src/current-pipeline-orchestration-runtime.js";
import { CurrentCryptoPaperLaunchService } from "../packages/runtime/src/current-crypto-paper-launch.js";

const sha = (character: string) =>
  `sha256:${character.repeat(64)}`;

const actor: OrchestrationActor = {
  actorId: "actor:paper-launch-test",
  displayName: "Paper Launch Test",
  roles: ["operator", "approver"],
};

function approvedPlan(): ApprovedPaperPlan {
  return {
    schemaVersion: "1.0.0",
    planId: "paper-plan:test",
    planVersion: "current-crypto:test",
    fingerprint: sha("0"),
    lifecycleStatus: "approved_ready",
    draftId: "pipeline-draft:test",
    graphId: CURRENT_CRYPTO_PIPELINE_GRAPH.pipelineGraphId,
    graphVersion:
      CURRENT_CRYPTO_PIPELINE_GRAPH.humanReadableVersion,
    graphFingerprint: CURRENT_CRYPTO_PIPELINE_GRAPH.fingerprint,
    marketPackRefs: ["market-pack:crypto:v1"],
    dataSourceRef: "data-source:csv-historical:v1",
    strategyProfileRef: "strategy-profile:test",
    dataFingerprint: sha("1"),
    paperAccountRef: "paper-account:test",
    candidateSymbols: ["BTCUSDT"],
    riskPolicyRefs: ["risk-policy:test"],
    approvalId: "approval:test",
    approvedByActorId: actor.actorId,
    evidence: {
      backtest: {
        kind: "backtest",
        evidenceId: "evidence:backtest",
        jobId: "job:backtest",
        artifactId: "artifact:backtest",
        artifactRef: "artifacts/backtest.json",
        artifactSha256: sha("a"),
        manifestSha256: sha("c"),
        resultSha256: sha("e"),
      },
      walkForward: {
        kind: "walk_forward",
        evidenceId: "evidence:walk-forward",
        jobId: "job:walk-forward",
        artifactId: "artifact:walk-forward",
        artifactRef: "artifacts/walk-forward.json",
        artifactSha256: sha("b"),
        manifestSha256: sha("d"),
        resultSha256: sha("f"),
      },
    },
    compiledStepCount: 12,
    createdAt: "2026-07-26T00:00:00.000Z",
    createdBy: "tradebot-server",
    runtimeApplied: false,
  };
}

test("Paper launch request and context contracts reject client runtime injection", () => {
  assert.equal(
    PaperRuntimeLaunchPresetRequestSchema.safeParse({
      schemaVersion: "1.0.0",
      idempotencyKey: "paper-launch-contract",
      confirmation:
        "prepare_current_crypto_fixture_paper_plan",
      symbols: ["ETHUSDT"],
      maxCycles: 999,
      module: "client.js",
    }).success,
    false,
  );
  assert.equal(
    PaperRuntimeLaunchContextSchema.safeParse({
      schemaVersion: "1.0.0",
      generatedAt: "2026-07-26T00:00:00.000Z",
      launchState: "release_required",
      preset: {
        presetId:
          "paper-launch-preset:current-crypto-local-fixture",
        humanVersion: "1.0.0",
        availability: "available",
        fixture: true,
        graphId: CURRENT_CRYPTO_PIPELINE_GRAPH.pipelineGraphId,
        observationWindows: ["5m", "15m", "1h"],
      },
      run: { runId: "forged-without-plan" },
      paperOnly: true,
      runtimeApplied: false,
      exchangeWriteAllowed: false,
      clientRuntimeParametersAccepted: false,
    }).success,
    false,
  );
});

test("Current Crypto fixture preparation runs registered evidence before activation", async () => {
  const calls: string[] = [];
  const plan = approvedPlan();
  const activation: PaperActivationRecord =
    PaperActivationRecordSchema.parse({
      schemaVersion: "1.0.0",
      activationId: "paper-activation:test",
      planId: plan.planId,
      planFingerprint: plan.fingerprint,
      draftId: plan.draftId,
      graphFingerprint: plan.graphFingerprint,
      actorId: actor.actorId,
      actorDisplayName: actor.displayName,
      status: "activated_not_applied",
      activatedAt: "2026-07-26T00:01:00.000Z",
      runtimeApplied: false,
    });
  let current:
    | { plan: ApprovedPaperPlan; activation: PaperActivationRecord }
    | undefined;
  const service = new CurrentCryptoPaperLaunchService({
    available: true,
    graph: CURRENT_CRYPTO_PIPELINE_GRAPH,
    now: () => new Date("2026-07-26T00:02:00.000Z"),
    orchestration: {
      createDraft() {
        calls.push("draft");
        return { draftId: plan.draftId } as never;
      },
      getDraft() {
        return { draftId: plan.draftId } as never;
      },
    },
    evidenceWorkflow: {
      validateContract() {
        calls.push("contract");
        return {} as never;
      },
      async runEvidenceJob(_draftId, kind) {
        calls.push(kind);
        return { status: "succeeded" } as never;
      },
      approve() {
        calls.push("approval");
        return {} as never;
      },
    },
    paperPlans: {
      createPlan() {
        calls.push("plan");
        return plan;
      },
      activate() {
        calls.push("activation");
        current = { plan, activation };
        return activation;
      },
      assertReadyForRuntime() {
        calls.push("ready");
        return { plan, activation };
      },
      findLatestActivatedPlan() {
        return current;
      },
      findCurrentControl() {
        return undefined;
      },
    },
    paperRuntime: {
      findLatestPreflight() {
        return undefined;
      },
      findActiveRun() {
        return undefined;
      },
    },
  });
  const context = await service.prepare(
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "paper-launch-service-test",
      confirmation:
        "prepare_current_crypto_fixture_paper_plan",
    },
    actor,
  );
  assert.deepEqual(calls.slice(0, 7), [
    "draft",
    "contract",
    "backtest",
    "walk_forward",
    "approval",
    "plan",
    "activation",
  ]);
  assert.equal(context.launchState, "preflight_required");
  assert.equal(context.plan?.planId, plan.planId);
  assert.equal(context.exchangeWriteAllowed, false);
});

test("authenticated HTTP exposes server launch context and rejects forged preset fields", async () => {
  const runtime = createCurrentPipelineOrchestrationRuntime({
    operatorToken: "paper-launch-http-token",
    currentCryptoPaperLaunchPreset: true,
  });
  try {
    runtime.server.listen(0, "127.0.0.1");
    await once(runtime.server, "listening");
    const address = runtime.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;
    const headers = {
      authorization: "Bearer paper-launch-http-token",
    };
    const contextResponse = await fetch(
      `${base}/api/orchestration/paper-runtime/launch-context`,
      { headers },
    );
    assert.equal(contextResponse.status, 200);
    const contextBody = (await contextResponse.json()) as {
      data: unknown;
    };
    const context = PaperRuntimeLaunchContextSchema.parse(
      contextBody.data,
    );
    assert.equal(context.launchState, "release_required");
    assert.equal(context.preset.availability, "available");

    const forged = await fetch(
      `${base}/api/orchestration/paper-runtime/presets/current-crypto-fixture/prepare`,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: "1.0.0",
          idempotencyKey: "paper-launch-http-forged",
          confirmation:
            "prepare_current_crypto_fixture_paper_plan",
          symbols: ["ETHUSDT"],
        }),
      },
    );
    assert.equal(forged.status, 422);
    const error = (await forged.json()) as {
      error: { code: string };
    };
    assert.equal(
      error.error.code,
      "PAPER_LAUNCH_REQUEST_INVALID",
    );
  } finally {
    await runtime.close();
  }
});
