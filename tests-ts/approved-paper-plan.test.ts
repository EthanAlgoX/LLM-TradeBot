import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ApprovedPaperPlanError,
  CURRENT_CRYPTO_PIPELINE_GRAPH,
} from "../packages/core/src/index.js";
import type { OrchestrationActor } from "../packages/contracts/src/index.js";
import {
  createCurrentPipelineOrchestrationRuntime,
  SqliteApprovedPaperPlanRepository,
  type CurrentPipelineOrchestrationRuntime,
  type RegisteredHistoricalEvidenceRunner,
} from "../packages/runtime/src/index.js";

const actor: OrchestrationActor = {
  actorId: "test:paper-approver",
  displayName: "Paper Approver",
  roles: ["operator", "approver"],
};

function runner(
  kind: "backtest" | "walk_forward",
  executions: { count: number },
): RegisteredHistoricalEvidenceRunner {
  return {
    runnerId: `test-runner:${kind}`,
    kind,
    allowedParameterKeys: [],
    strategyProfileRef: "strategy-profile:test:v1",
    dataSourceRef: "data-source:csv-historical",
    dataFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    timezone: "UTC",
    tradingCalendarRef: "calendar:crypto-24x7",
    costModel: { feeBps: 4, slippageBps: 2 },
    requestedAsOf: () => "2026-07-26T00:00:00.000Z",
    async run() {
      executions.count += 1;
      const metrics: Record<string, number> =
        kind === "backtest"
          ? { totalReturn: 0.12, maxDrawdown: 0.04 }
          : { outOfSampleReturn: 0.08, foldCount: 2 };
      return {
        schemaVersion: "1.0.0",
        metrics,
        summary: `${kind} test evidence`,
        observations: ["server-owned test runner"],
      };
    },
  };
}

function setup(): {
  runtime: CurrentPipelineOrchestrationRuntime;
  directory: string;
  executions: { count: number };
} {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-paper-plan-"));
  const executions = { count: 0 };
  return {
    directory,
    executions,
    runtime: createCurrentPipelineOrchestrationRuntime({
      databasePath: ":memory:",
      operatorToken: "paper-plan-test-token",
      operatorActor: actor,
      artifactDirectory: directory,
      historicalRunners: [
        runner("backtest", executions),
        runner("walk_forward", executions),
      ],
      paperPlanPolicy: {
        planVersion: "1.0.0-test",
        marketPackRefs: ["market-pack:crypto:v1"],
        paperAccountRef: "paper-account:test",
        candidateSymbols: ["BTCUSDT", "ETHUSDT"],
        riskPolicyRefs: ["risk-policy:test-paper"],
      },
    }),
  };
}

async function approve(
  runtime: CurrentPipelineOrchestrationRuntime,
) {
  const draft = runtime.service.createDraft(CURRENT_CRYPTO_PIPELINE_GRAPH);
  runtime.evidenceWorkflow.validateContract(draft.draftId, actor);
  const backtest = await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "backtest",
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "test-backtest-evidence",
      parameters: {},
    },
    actor,
  );
  const walkForward = await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "walk_forward",
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "test-walk-forward-evidence",
      parameters: {},
    },
    actor,
  );
  const approval = runtime.evidenceWorkflow.approve(
    draft.draftId,
    {
      schemaVersion: "1.0.0",
      decision: "approve",
      note: "test approval",
    },
    actor,
  );
  return { draftId: draft.draftId, backtest, walkForward, approval };
}

function planRequest(key = "paper-plan-create-key") {
  return {
    schemaVersion: "1.0.0",
    idempotencyKey: key,
  };
}

test("Paper Plan fails closed before Human Approval", async () => {
  const context = setup();
  try {
    const draft = context.runtime.service.createDraft(
      CURRENT_CRYPTO_PIPELINE_GRAPH,
    );
    assert.throws(
      () =>
        context.runtime.paperPlanService.createPlan(
          draft.draftId,
          planRequest(),
          actor,
        ),
      (error: unknown) =>
        error instanceof ApprovedPaperPlanError &&
        error.code === "PAPER_PLAN_OUT_OF_ORDER",
    );
    assert.equal(context.executions.count, 0);
  } finally {
    await context.runtime.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test("valid evidence creates an immutable plan and activation remains runtime-not-applied", async () => {
  const context = setup();
  try {
    const approved = await approve(context.runtime);
    const plan = context.runtime.paperPlanService.createPlan(
      approved.draftId,
      planRequest(),
      actor,
    );
    const samePlan = context.runtime.paperPlanService.createPlan(
      approved.draftId,
      planRequest(),
      actor,
    );
    assert.equal(samePlan.planId, plan.planId);
    assert.equal(plan.lifecycleStatus, "approved_ready");
    assert.equal(plan.runtimeApplied, false);
    assert.equal(plan.approvalId, approved.approval.audit.approvalId);
    assert.equal(plan.evidence.backtest.artifactSha256.startsWith("sha256:"), true);
    assert.equal(plan.evidence.walkForward.artifactSha256.startsWith("sha256:"), true);
    assert.equal(context.executions.count, 2);

    const activationRequest = {
      schemaVersion: "1.0.0",
      idempotencyKey: "paper-activation-key",
      confirmation: "activate_paper_plan",
    };
    const activation = context.runtime.paperPlanService.activate(
      plan.planId,
      activationRequest,
      actor,
    );
    const sameActivation = context.runtime.paperPlanService.activate(
      plan.planId,
      activationRequest,
      actor,
    );
    assert.equal(sameActivation.activationId, activation.activationId);
    assert.equal(activation.status, "activated_not_applied");
    assert.equal(activation.runtimeApplied, false);
    assert.equal(context.executions.count, 2);
    assert.throws(
      () =>
        context.runtime.paperPlanService.activate(
          plan.planId,
          {
            ...activationRequest,
            idempotencyKey: "different-activation-key",
          },
          actor,
        ),
      (error: unknown) =>
        error instanceof ApprovedPaperPlanError &&
        error.code === "PAPER_PLAN_ALREADY_ACTIVATED",
    );

    const controlRequest = {
      schemaVersion: "1.0.0",
      idempotencyKey: "paper-close-only-key",
      mode: "pause_new_openings_close_only",
      confirmation: "pause_new_openings_close_only",
    };
    const control = context.runtime.paperPlanService.recordCloseOnly(
      plan.planId,
      controlRequest,
      actor,
    );
    assert.equal(control.controlPlaneRecorded, true);
    assert.equal(control.runtimeApplied, false);
    assert.equal(
      control.mode,
      "pause_new_openings_close_only",
    );
    const restored = new SqliteApprovedPaperPlanRepository(
      context.runtime.database,
    );
    assert.equal(restored.getPlan(plan.planId).fingerprint, plan.fingerprint);
    assert.equal(
      restored.findActivationByPlanId(plan.planId)?.activationId,
      activation.activationId,
    );
    assert.equal(
      restored.getCurrentControl(plan.planId)?.controlId,
      control.controlId,
    );
  } finally {
    await context.runtime.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test("approval fingerprint mismatch and artifact tampering are rejected", async () => {
  const mismatch = setup();
  try {
    const approved = await approve(mismatch.runtime);
    const row = mismatch.runtime.database
      .prepare(
        "SELECT record_json FROM pipeline_approval_audits WHERE approval_id = ?",
      )
      .get(approved.approval.audit.approvalId) as unknown as {
      record_json: string;
    };
    const altered = JSON.parse(row.record_json) as Record<string, unknown>;
    altered.graphFingerprint = "fnv1a32:00000000";
    mismatch.runtime.database
      .prepare(
        "UPDATE pipeline_approval_audits SET record_json = ? WHERE approval_id = ?",
      )
      .run(JSON.stringify(altered), approved.approval.audit.approvalId);
    assert.throws(
      () =>
        mismatch.runtime.paperPlanService.createPlan(
          approved.draftId,
          planRequest("fingerprint-mismatch-key"),
          actor,
        ),
      (error: unknown) =>
        error instanceof ApprovedPaperPlanError &&
        error.code === "PAPER_PLAN_EVIDENCE_MISMATCH",
    );
  } finally {
    await mismatch.runtime.close();
    rmSync(mismatch.directory, { recursive: true, force: true });
  }

  const tampered = setup();
  try {
    const approved = await approve(tampered.runtime);
    const artifactId = approved.backtest.evidence?.lineage?.artifactId;
    assert.ok(artifactId);
    const artifactDirectory = artifactId.replace(/^historical-artifact:/, "");
    const resultPath = join(tampered.directory, artifactDirectory, "result.json");
    const original = readFileSync(resultPath, "utf8");
    writeFileSync(resultPath, `${original}\n`);
    assert.throws(
      () =>
        tampered.runtime.paperPlanService.createPlan(
          approved.draftId,
          planRequest("artifact-tamper-key"),
          actor,
        ),
      (error: unknown) =>
        error instanceof ApprovedPaperPlanError &&
        error.code === "PAPER_PLAN_ARTIFACT_INTEGRITY_FAILED",
    );
  } finally {
    await tampered.runtime.close();
    rmSync(tampered.directory, { recursive: true, force: true });
  }
});

test("HTTP requires authentication and rejects client-owned actor or evidence", async () => {
  const context = setup();
  try {
    const approved = await approve(context.runtime);
    context.runtime.server.listen(0, "127.0.0.1");
    await once(context.runtime.server, "listening");
    const address = context.runtime.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;
    const post = (
      path: string,
      body: unknown,
      authenticated = true,
    ) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authenticated
            ? { authorization: "Bearer paper-plan-test-token" }
            : {}),
        },
        body: JSON.stringify(body),
      });
    const path = `/api/orchestration/drafts/${encodeURIComponent(
      approved.draftId,
    )}/paper-plan`;
    assert.equal((await post(path, planRequest(), false)).status, 401);
    assert.equal(
      (
        await post(path, {
          ...planRequest(),
          actorId: "client:forged",
          evidenceRefs: ["client:evidence"],
        })
      ).status,
      422,
    );
    const created = await post(path, planRequest());
    assert.equal(created.status, 201);
    const plan = (
      (await created.json()) as {
        data: { planId: string; runtimeApplied: false };
      }
    ).data;
    assert.equal(plan.runtimeApplied, false);

    const activationPath = `/api/orchestration/paper-plans/${encodeURIComponent(
      plan.planId,
    )}/activation`;
    assert.equal(
      (
        await post(activationPath, {
          schemaVersion: "1.0.0",
          idempotencyKey: "http-activation-key",
          confirmation: "activate_paper_plan",
          approvedByActorId: "client:forged",
        })
      ).status,
      422,
    );
    const activated = await post(activationPath, {
      schemaVersion: "1.0.0",
      idempotencyKey: "http-activation-key",
      confirmation: "activate_paper_plan",
    });
    assert.equal(activated.status, 201);
    const activationBody = (await activated.json()) as {
      data: { runtimeApplied: false };
    };
    assert.equal(activationBody.data.runtimeApplied, false);

    const controlled = await post(
      `/api/orchestration/paper-plans/${encodeURIComponent(
        plan.planId,
      )}/control/close-only`,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "http-close-only-key",
        mode: "pause_new_openings_close_only",
        confirmation: "pause_new_openings_close_only",
      },
    );
    assert.equal(controlled.status, 201);
    const controlBody = (await controlled.json()) as {
      data: { runtimeApplied: false; controlPlaneRecorded: true };
    };
    assert.equal(controlBody.data.runtimeApplied, false);
    assert.equal(controlBody.data.controlPlaneRecorded, true);
    assert.equal(context.executions.count, 2);
  } finally {
    await context.runtime.close();
    rmSync(context.directory, { recursive: true, force: true });
  }
});
