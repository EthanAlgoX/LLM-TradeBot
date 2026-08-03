import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  OrchestrationIntentRequestSchema,
  type OrchestrationIntentRequest,
} from "../packages/contracts/src/index.js";
import {
  CURRENT_CRYPTO_AGENT_TEMPLATES,
  CURRENT_CRYPTO_MARKET_PACK,
  CURRENT_CRYPTO_PIPELINE_GRAPH,
} from "../packages/core/src/current-crypto-pipeline-graph.js";
import { CURRENT_CRYPTO_SEMANTIC_CSV_PIPELINE_GRAPH } from "../packages/core/src/current-crypto-semantic-historical-graph.js";
import { OrchestrationIntentError } from "../packages/core/src/orchestration-intent-compiler.js";
import { createCurrentPipelineOrchestrationRuntime } from "../packages/runtime/src/current-pipeline-orchestration-runtime.js";

const currentIntent: OrchestrationIntentRequest = {
  schemaVersion: "1.0.0",
  requestId: "request.current-crypto.001",
  presetId: "preset.current-crypto-multi-agent",
  marketPackId: CURRENT_CRYPTO_MARKET_PACK.marketPackId,
  dataSourceIds: [...CURRENT_CRYPTO_PIPELINE_GRAPH.dataSourceRefs],
  observationWindows: [
    { kind: "bar_interval", unit: "minute", value: 5 },
    { kind: "bar_interval", unit: "minute", value: 15 },
    { kind: "bar_interval", unit: "hour", value: 1 },
  ],
  requiredAgentTemplateIds: [],
  target: "draft_only",
};

function fixture() {
  const database = new DatabaseSync(":memory:");
  const runtime = createCurrentPipelineOrchestrationRuntime({ database });
  return { database, runtime };
}

test("strict intent contract expresses single, multi-window and event-only requests", () => {
  assert.equal(OrchestrationIntentRequestSchema.parse(currentIntent).observationWindows.length, 3);
  assert.equal(
    OrchestrationIntentRequestSchema.parse({
      ...currentIntent,
      requestId: "request.daily.001",
      presetId: "preset.single-window-daily",
      dataSourceIds: [],
      observationWindows: [{ kind: "bar_interval", unit: "day", value: 1 }],
    }).observationWindows.length,
    1,
  );
  assert.equal(
    OrchestrationIntentRequestSchema.parse({
      ...currentIntent,
      requestId: "request.events.001",
      presetId: "preset.event-only-research",
      dataSourceIds: [],
      observationWindows: [{ kind: "event_batch", unit: "hour", value: 1 }],
    }).observationWindows[0]?.kind,
    "event_batch",
  );
});

test("registered Crypto intent compiles to an authoritative validated Draft without runtime mutation", async () => {
  const { database, runtime } = fixture();
  try {
    const result = runtime.intentDraftService.createDraft(currentIntent);
    assert.equal(result.validation.valid, true);
    assert.equal(result.draft.graphId, CURRENT_CRYPTO_PIPELINE_GRAPH.pipelineGraphId);
    assert.equal(result.draft.runtimeApplied, false);
    assert.equal(result.runtimeApplied, false);
    assert.equal(result.intent.runtimeMutationAllowed, false);
    assert.deepEqual(result.intent.releaseGates, [
      "contract_validation",
      "backtest",
      "walk_forward",
      "human_approval",
      "paper_running",
    ]);
    assert.equal(
      result.intent.agentTemplateRefs.length,
      CURRENT_CRYPTO_AGENT_TEMPLATES.length,
    );
    assert.ok(result.draft.graph.nodes.some((node) => node.nodeId === "position-monitor"));
    assert.ok(result.draft.graph.nodes.some((node) => node.nodeId === "risk"));
    assert.ok(result.draft.graph.nodes.some((node) => node.nodeId === "execution"));
    assert.ok(result.draft.graph.nodes.some((node) => node.nodeId === "reflection"));
  } finally {
    await runtime.close();
    database.close();
  }
});

test("registered CSV Historical preset creates an exact-set validated draft without runtime mutation", async () => {
  const { database, runtime } = fixture();
  try {
    const result = runtime.intentDraftService.createDraft({
      ...currentIntent,
      requestId: "request.csv-historical.001",
      presetId: "preset.current-crypto-csv-historical",
      dataSourceIds: ["data-source:csv-historical"],
      requiredAgentTemplateIds: ["agent-template:semantic-historical:timeframe-analysis:v1"],
    });
    assert.equal(result.validation.valid, true);
    assert.equal(result.draft.graphId, CURRENT_CRYPTO_SEMANTIC_CSV_PIPELINE_GRAPH.pipelineGraphId);
    assert.deepEqual(result.intent.dataSourceIds, ["data-source:csv-historical"]);
    assert.equal(result.runtimeApplied, false);
    assert.throws(
      () => runtime.intentDraftService.createDraft({ ...currentIntent, requestId: "request.csv-historical.invalid", dataSourceIds: ["data-source:csv-historical"] }),
      (error) => error instanceof OrchestrationIntentError && error.code === "DATA_SOURCE_SET_NOT_SUPPORTED_BY_GRAPH",
    );
  } finally {
    await runtime.close();
    database.close();
  }
});

test("capability-gated daily and event presets remain expressible but fail closed", async () => {
  const { database, runtime } = fixture();
  try {
    for (const request of [
      {
        ...currentIntent,
        requestId: "request.daily.002",
        presetId: "preset.single-window-daily",
        dataSourceIds: [],
        observationWindows: [{ kind: "bar_interval" as const, unit: "day" as const, value: 1 }],
      },
      {
        ...currentIntent,
        requestId: "request.events.002",
        presetId: "preset.event-only-research",
        dataSourceIds: [],
        observationWindows: [{ kind: "event_batch" as const, unit: "hour" as const, value: 1 }],
      },
    ]) {
      assert.throws(
        () => runtime.intentDraftService.createDraft(request),
        (error) =>
          error instanceof OrchestrationIntentError &&
          error.code === "PRESET_CAPABILITY_REQUIRED",
      );
    }
  } finally {
    await runtime.close();
    database.close();
  }
});

test("compiler rejects inaccurate windows, unknown Agents and injected implementation fields", async () => {
  const { database, runtime } = fixture();
  try {
    assert.throws(
      () =>
        runtime.intentDraftService.createDraft({
          ...currentIntent,
          observationWindows: [{ kind: "bar_interval", unit: "minute", value: 5 }],
        }),
      (error) =>
        error instanceof OrchestrationIntentError &&
        error.code === "OBSERVATION_WINDOW_SET_NOT_SUPPORTED_BY_GRAPH",
    );
    assert.throws(
      () =>
        runtime.intentDraftService.createDraft({
          ...currentIntent,
          requiredAgentTemplateIds: ["agent-template.client-injected"],
        }),
      (error) =>
        error instanceof OrchestrationIntentError &&
        error.code === "AGENT_TEMPLATE_NOT_REGISTERED",
    );
    assert.throws(
      () =>
        runtime.intentDraftService.createDraft({
          ...currentIntent,
          implementationRef: "client-code",
        }),
      (error) =>
        error instanceof OrchestrationIntentError &&
        error.code === "INVALID_ORCHESTRATION_INTENT",
    );
  } finally {
    await runtime.close();
    database.close();
  }
});

test("HTTP intent compiler exposes capability blockers and creates only authenticated Drafts", async () => {
  const database = new DatabaseSync(":memory:");
  const runtime = createCurrentPipelineOrchestrationRuntime({ database });
  await new Promise<void>((resolve) =>
    runtime.server.listen(0, "127.0.0.1", resolve),
  );
  const address = runtime.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/orchestration`;
  try {
    const catalogResponse = await fetch(`${base}/intent-catalog`);
    assert.equal(catalogResponse.status, 200);
    const catalog = (await catalogResponse.json()) as {
      data: Array<{
        preset: { id: string };
        compilationAvailable: boolean;
        blockerCodes: string[];
      }>;
    };
    assert.equal(
      catalog.data.find(
        (entry) => entry.preset.id === "preset.current-crypto-multi-agent",
      )?.compilationAvailable,
      true,
    );
    assert.deepEqual(
      catalog.data.find(
        (entry) => entry.preset.id === "preset.event-only-research",
      )?.blockerCodes,
      ["PRESET_CAPABILITY_REQUIRED", "PRESET_GRAPH_BINDING_NOT_REGISTERED"],
    );

    const unauthenticated = await fetch(`${base}/drafts/from-intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(currentIntent),
    });
    assert.equal(unauthenticated.status, 401);

    const created = await fetch(`${base}/drafts/from-intent`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${runtime.ephemeralOperatorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(currentIntent),
    });
    assert.equal(created.status, 201);
    const payload = (await created.json()) as {
      data: {
        draft: { graphId: string; runtimeApplied: boolean };
        intent: { runtimeMutationAllowed: boolean };
      };
    };
    assert.equal(payload.data.draft.graphId, CURRENT_CRYPTO_PIPELINE_GRAPH.pipelineGraphId);
    assert.equal(payload.data.draft.runtimeApplied, false);
    assert.equal(payload.data.intent.runtimeMutationAllowed, false);
  } finally {
    await runtime.close();
    database.close();
  }
});
