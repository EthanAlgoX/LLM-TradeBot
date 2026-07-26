import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type {
  PipelineEvidenceJobKind,
  PipelineEvidenceJobRequest,
} from "../packages/contracts/src/index.js";
import type {
  PipelineEvidenceExecutionOutput,
  PipelineEvidenceExecutor,
  StoredPipelineDraft,
} from "../packages/core/src/index.js";
import {
  createCurrentPipelineOrchestrationRuntime,
  LocalBearerAuthenticator,
  PipelineAuthenticationError,
} from "../packages/runtime/src/index.js";
import { CURRENT_CRYPTO_PIPELINE_GRAPH } from "../packages/core/src/index.js";

const operatorToken = "evidence-loop-test-token";

class SuccessfulEvidenceExecutor implements PipelineEvidenceExecutor {
  async execute(input: {
    kind: PipelineEvidenceJobKind;
    draft: StoredPipelineDraft;
    request: PipelineEvidenceJobRequest;
    jobId: string;
  }): Promise<PipelineEvidenceExecutionOutput> {
    return {
      artifactRef: `artifact:${input.kind}:${input.jobId}`,
      metrics:
        input.kind === "backtest"
          ? { trades: 12, netReturn: 0.08 }
          : { folds: 4, positiveFolds: 3 },
      summary: `${input.kind} completed by registered test executor`,
    };
  }
}

function authHeaders(json = false): Record<string, string> {
  return {
    authorization: `Bearer ${operatorToken}`,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

test("bearer authenticator derives actor identity from server configuration", () => {
  const authenticator = new LocalBearerAuthenticator([
    {
      token: operatorToken,
      actor: {
        actorId: "operator:alice",
        displayName: "Alice",
        roles: ["operator", "approver"],
      },
    },
  ]);
  const actor = authenticator.authenticate(`Bearer ${operatorToken}`);
  assert.equal(actor.actorId, "operator:alice");
  assert.throws(
    () => authenticator.authenticate("Bearer client-forged-token"),
    (error: unknown) =>
      error instanceof PipelineAuthenticationError &&
      error.code === "AUTHORIZATION_TOKEN_INVALID",
  );
});

test("server-owned evidence jobs advance gates and persist approval audit", async () => {
  const database = new DatabaseSync(":memory:");
  const runtime = createCurrentPipelineOrchestrationRuntime({
    database,
    operatorToken,
    operatorActor: {
      actorId: "operator:alice",
      displayName: "Alice",
      roles: ["operator", "approver"],
    },
    evidenceExecutor: new SuccessfulEvidenceExecutor(),
  });
  const draft = runtime.service.createDraft(CURRENT_CRYPTO_PIPELINE_GRAPH);
  const actor = {
    actorId: "operator:alice",
    displayName: "Alice",
    roles: ["operator", "approver"] as ("operator" | "approver")[],
  };

  runtime.evidenceWorkflow.validateContract(draft.draftId, actor);
  const backtest = await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "backtest",
    { schemaVersion: "1.0.0", parameters: { feeBps: 4 } },
    actor,
  );
  assert.equal(backtest.status, "succeeded");
  assert.equal(backtest.evidence?.generatedBy, "tradebot-server");

  const walkForward = await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "walk_forward",
    { schemaVersion: "1.0.0", parameters: { folds: 4 } },
    actor,
  );
  assert.equal(walkForward.status, "succeeded");

  const approved = runtime.evidenceWorkflow.approve(
    draft.draftId,
    {
      schemaVersion: "1.0.0",
      decision: "approve",
      note: "Reviewed server evidence.",
    },
    actor,
  );
  assert.equal(approved.draft.promotionStage, "human_approved");
  assert.equal(approved.audit.actorId, "operator:alice");
  assert.equal(approved.audit.evidenceRefs.length, 2);
  assert.equal(
    approved.audit.graphFingerprint,
    draft.contentFingerprint,
  );

  const restored = createCurrentPipelineOrchestrationRuntime({
    database,
    operatorToken,
    evidenceExecutor: new SuccessfulEvidenceExecutor(),
  });
  assert.deepEqual(
    restored.evidenceWorkflow.getJob(backtest.jobId),
    backtest,
  );
  assert.deepEqual(
    restored.evidenceWorkflow.getApproval(approved.audit.approvalId),
    approved.audit,
  );
  await runtime.close();
  await restored.close();
  database.close();
});

test("authenticated HTTP workflow rejects forged evidence and client actor identity", async () => {
  const database = new DatabaseSync(":memory:");
  const runtime = createCurrentPipelineOrchestrationRuntime({
    database,
    operatorToken,
    operatorActor: {
      actorId: "operator:alice",
      displayName: "Alice",
      roles: ["operator", "approver"],
    },
    evidenceExecutor: new SuccessfulEvidenceExecutor(),
  });
  runtime.server.listen(0, "127.0.0.1");
  await once(runtime.server, "listening");
  const address = runtime.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/api/orchestration`;

  const unauthorized = await fetch(`${baseUrl}/drafts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CURRENT_CRYPTO_PIPELINE_GRAPH),
  });
  assert.equal(unauthorized.status, 401);

  const createResponse = await fetch(`${baseUrl}/drafts`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(CURRENT_CRYPTO_PIPELINE_GRAPH),
  });
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as {
    data: { draftId: string };
  };
  const draftPath = `${baseUrl}/drafts/${encodeURIComponent(created.data.draftId)}`;

  const validation = await fetch(`${draftPath}/validate`, {
    method: "POST",
    headers: authHeaders(),
  });
  assert.equal(validation.status, 200);

  const forgedBacktest = await fetch(`${draftPath}/jobs/backtest`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({
      schemaVersion: "1.0.0",
      parameters: {},
      evidenceRef: "client:forged",
      actorId: "client:forged",
    }),
  });
  assert.equal(forgedBacktest.status, 422);

  const backtest = await fetch(`${draftPath}/jobs/backtest`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({ schemaVersion: "1.0.0", parameters: {} }),
  });
  assert.equal(backtest.status, 201);
  const backtestBody = (await backtest.json()) as {
    data: { status: string; evidence: { evidenceId: string } };
  };
  assert.equal(backtestBody.data.status, "succeeded");
  assert.match(
    backtestBody.data.evidence.evidenceId,
    /^pipeline-evidence:/,
  );

  const walkForward = await fetch(`${draftPath}/jobs/walk-forward`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({ schemaVersion: "1.0.0", parameters: {} }),
  });
  assert.equal(walkForward.status, 201);

  const forgedApproval = await fetch(`${draftPath}/approval`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({
      schemaVersion: "1.0.0",
      decision: "approve",
      actorId: "client:forged",
      evidenceRefs: ["client:forged"],
    }),
  });
  assert.equal(forgedApproval.status, 422);

  const approval = await fetch(`${draftPath}/approval`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({
      schemaVersion: "1.0.0",
      decision: "approve",
    }),
  });
  assert.equal(approval.status, 201);
  const approvalBody = (await approval.json()) as {
    data: { audit: { actorId: string; evidenceRefs: string[] } };
  };
  assert.equal(approvalBody.data.audit.actorId, "operator:alice");
  assert.equal(approvalBody.data.audit.evidenceRefs.length, 2);

  const legacyPromotion = await fetch(`${draftPath}/promotions`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({
      targetStage: "paper_running",
      evidenceRef: "client:forged",
      actorId: "client:forged",
    }),
  });
  assert.equal(legacyPromotion.status, 404);

  await runtime.close();
  database.close();
});
