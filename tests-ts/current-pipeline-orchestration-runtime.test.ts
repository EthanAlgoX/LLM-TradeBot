import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CURRENT_CRYPTO_PIPELINE_GRAPH } from "../packages/core/src/index.js";
import {
  createCurrentPipelineOrchestrationRuntime,
  startCurrentPipelineOrchestrationServer,
} from "../packages/runtime/src/index.js";

test("current orchestration composition validates and compiles the real Crypto graph", async () => {
  const database = new DatabaseSync(":memory:");
  const runtime = createCurrentPipelineOrchestrationRuntime({ database });
  const draft = runtime.service.createDraft(CURRENT_CRYPTO_PIPELINE_GRAPH);
  const validation = runtime.service.validateDraft(draft.draftId);
  const plan = runtime.service.compileDraft(draft.draftId);

  assert.equal(validation.valid, true);
  assert.equal(validation.issues.length, 0);
  assert.equal(plan.runtimeApplied, false);
  assert.equal(plan.steps.length, CURRENT_CRYPTO_PIPELINE_GRAPH.nodes.length);
  assert.equal(runtime.registry.marketPacks.size, 1);
  assert.equal(runtime.registry.dataSources.size, 2);
  assert.equal(runtime.registry.capabilities.size, 2);
  await runtime.close();
  database.close();
});

test("current orchestration server exposes the real registry only on loopback", async () => {
  const database = new DatabaseSync(":memory:");
  const runtime = await startCurrentPipelineOrchestrationServer({
    database,
    host: "127.0.0.1",
    port: 0,
  });
  const address = runtime.server.address();
  assert.ok(address && typeof address === "object");

  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/orchestration/catalog`,
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: {
      marketPacks: unknown[];
      dataSources: unknown[];
      capabilities: unknown[];
      runtimeMutationAllowed: boolean;
    };
  };
  assert.equal(body.data.marketPacks.length, 1);
  assert.equal(body.data.dataSources.length, 2);
  assert.equal(body.data.capabilities.length, 2);
  assert.equal(body.data.runtimeMutationAllowed, false);

  await runtime.close();
  database.close();
});
