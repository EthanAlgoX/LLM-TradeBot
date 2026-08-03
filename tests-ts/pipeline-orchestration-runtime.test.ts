import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type {
  PipelineGraphVersion,
  PipelineValidationResult,
} from "../packages/contracts/src/index.js";
import {
  CURRENT_CRYPTO_PIPELINE_GRAPH,
  ImmutablePipelineRegistry,
  PipelineEvidenceWorkflow,
  PipelineGraphCompiler,
  PipelineOrchestrationError,
  PipelineOrchestrationService,
  UnavailablePipelineEvidenceExecutor,
} from "../packages/core/src/index.js";
import {
  createPipelineOrchestrationHttpServer,
  LocalBearerAuthenticator,
  SqlitePipelineEvidenceRepository,
  SqlitePipelineDraftRepository,
} from "../packages/runtime/src/index.js";

const operatorToken = "test-operator-token";

const validResult = {
  valid: true,
  issues: [],
} as unknown as PipelineValidationResult;

function bindings(graph: PipelineGraphVersion) {
  return graph.nodes.flatMap((node) => {
    const agentConfigId = (node as unknown as { agentConfigId?: string }).agentConfigId;
    return agentConfigId
      ? [{ agentConfigId, implementationKey: `backend:${agentConfigId}` }]
      : [];
  });
}

function runtimeFixture(database: DatabaseSync) {
  const registry = new ImmutablePipelineRegistry({
    implementationBindings: bindings(CURRENT_CRYPTO_PIPELINE_GRAPH),
  });
  const validator = () => validResult;
  const repository = new SqlitePipelineDraftRepository(database);
  const compiler = new PipelineGraphCompiler(registry, validator);
  const service = new PipelineOrchestrationService(repository, compiler, validator);
  const evidenceRepository = new SqlitePipelineEvidenceRepository(database);
  const evidenceWorkflow = new PipelineEvidenceWorkflow(
    service,
    evidenceRepository,
    new UnavailablePipelineEvidenceExecutor(),
  );
  const authenticator = new LocalBearerAuthenticator([
    {
      token: operatorToken,
      actor: {
        actorId: "test:operator",
        displayName: "Test Operator",
        roles: ["operator", "approver"],
      },
    },
  ]);
  return {
    registry,
    repository,
    service,
    evidenceWorkflow,
    authenticator,
  };
}

test("SQLite repository restores immutable graph drafts and promotion state", () => {
  const database = new DatabaseSync(":memory:");
  const firstRuntime = runtimeFixture(database);
  let draft = firstRuntime.service.createDraft(CURRENT_CRYPTO_PIPELINE_GRAPH);
  draft = firstRuntime.service.promote(
    draft.draftId,
    "contract_validated",
    "validation:current-crypto",
    "2026-07-26T00:00:00.000Z",
  );

  const restoredRuntime = runtimeFixture(database);
  const restored = restoredRuntime.service.getDraft(draft.draftId);
  assert.deepEqual(restored, draft);
  assert.equal(restored.runtimeApplied, false);
  assert.equal(restored.promotionEvidence.length, 1);
  database.close();
});

test("SQLite repository rejects an overwrite of the same graph version", () => {
  const database = new DatabaseSync(":memory:");
  const { repository } = runtimeFixture(database);
  repository.save(CURRENT_CRYPTO_PIPELINE_GRAPH);
  const changed = structuredClone(CURRENT_CRYPTO_PIPELINE_GRAPH) as unknown as {
    fingerprint: string;
  };
  changed.fingerprint = `${changed.fingerprint}-changed`;

  assert.throws(
    () => repository.save(changed),
    (error: unknown) =>
      error instanceof PipelineOrchestrationError &&
      error.code === "PIPELINE_VERSION_CONFLICT",
  );
  database.close();
});

test("HTTP API exposes controlled catalog, draft, validation, and compile routes", async () => {
  const database = new DatabaseSync(":memory:");
  const fixture = runtimeFixture(database);
  const server = createPipelineOrchestrationHttpServer(fixture);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const catalogResponse = await fetch(`${baseUrl}/api/orchestration/catalog`);
  assert.equal(catalogResponse.status, 200);
  const catalog = (await catalogResponse.json()) as {
    data: { runtimeMutationAllowed: boolean };
  };
  assert.equal(catalog.data.runtimeMutationAllowed, false);

  const createResponse = await fetch(`${baseUrl}/api/orchestration/drafts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${operatorToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(CURRENT_CRYPTO_PIPELINE_GRAPH),
  });
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as {
    data: { draftId: string; runtimeApplied: boolean };
  };
  assert.equal(created.data.runtimeApplied, false);

  const encodedDraftId = encodeURIComponent(created.data.draftId);
  const validationResponse = await fetch(
    `${baseUrl}/api/orchestration/drafts/${encodedDraftId}/validate`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${operatorToken}` },
    },
  );
  assert.equal(validationResponse.status, 200);

  const compileResponse = await fetch(
    `${baseUrl}/api/orchestration/drafts/${encodedDraftId}/compile`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${operatorToken}` },
    },
  );
  assert.equal(compileResponse.status, 200);
  const compiled = (await compileResponse.json()) as {
    data: { runtimeApplied: boolean };
  };
  assert.equal(compiled.data.runtimeApplied, false);

  server.close();
  await once(server, "close");
  database.close();
});

test("local Paper identity ignores a stale pre-versioned cookie after reload", async () => {
  const database = new DatabaseSync(":memory:");
  const fixture = runtimeFixture(database);
  const server = createPipelineOrchestrationHttpServer({
    ...fixture,
    localIdentityToken: operatorToken,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const handoff = await fetch(`${baseUrl}/api/orchestration/local-identity`, {
    method: "POST",
    headers: { origin: "http://127.0.0.1:5174" },
  });
  assert.equal(handoff.status, 204);
  assert.match(
    handoff.headers.get("set-cookie") ?? "",
    /^tradebot_local_operator_v2=/u,
  );

  const session = await fetch(`${baseUrl}/api/orchestration/session`, {
    headers: {
      cookie:
        "tradebot_local_operator=stale; tradebot_local_operator_v2=test-operator-token",
    },
  });
  assert.equal(session.status, 200);
  const body = (await session.json()) as { data: { actor: { actorId: string } } };
  assert.equal(body.data.actor.actorId, "test:operator");

  server.close();
  await once(server, "close");
  database.close();
});

test("HTTP API rejects unsupported mutation routes and oversized bodies", async () => {
  const database = new DatabaseSync(":memory:");
  const fixture = runtimeFixture(database);
  const server = createPipelineOrchestrationHttpServer({
    ...fixture,
    maxBodyBytes: 32,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const executeResponse = await fetch(`${baseUrl}/api/orchestration/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(executeResponse.status, 404);

  const largeResponse = await fetch(`${baseUrl}/api/orchestration/drafts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${operatorToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ payload: "x".repeat(64) }),
  });
  assert.equal(largeResponse.status, 413);

  server.close();
  await once(server, "close");
  database.close();
});
