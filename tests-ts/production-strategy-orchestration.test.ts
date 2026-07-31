import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { CreateConfigurationDraftRequestSchema } from "../packages/contracts/src/index.js";
import {
  createGraphHistoricalDatasetDefinition,
  createGraphStrategyProfileCandidateSet,
  createGraphStrategyProfileDefinition,
  createGraphWalkForwardPlanDefinition,
  graphEvidenceFingerprint,
  type GraphBacktestSessionFactory,
} from "../packages/core/src/index.js";
import { createCurrentPipelineOrchestrationRuntime } from "../packages/runtime/src/index.js";

test("Configuration Strategy can reference the existing versioned Pipeline Draft ID", () => {
  const parsed = CreateConfigurationDraftRequestSchema.parse({
    schemaVersion: "1.0.0",
    humanVersion: "current-crypto.v1",
    payload: {
      kind: "strategy",
      marketPackId: "market-pack:crypto:v1",
      pipelineDraftId: "pipeline-graph:current-crypto-fixed@1.0.0",
      agentConfigurationDraftIds: ["configuration-draft:agent"],
      promptPolicyDraftIds: ["configuration-draft:prompt"],
      weights: { analysis: 1 },
      thresholds: { minimumConfidence: 0.6 },
    },
  });
  assert.equal(
    parsed.payload.kind === "strategy"
      ? parsed.payload.pipelineDraftId
      : undefined,
    "pipeline-graph:current-crypto-fixed@1.0.0",
  );
  assert.throws(() =>
    CreateConfigurationDraftRequestSchema.parse({
      ...parsed,
      payload: {
        ...parsed.payload,
        pipelineDraftId: "../runtime injection",
      },
    }),
  );
});

async function listen(
  runtime: ReturnType<typeof createCurrentPipelineOrchestrationRuntime>,
): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    runtime.server.once("error", reject);
    runtime.server.listen(0, "127.0.0.1", () => {
      runtime.server.off("error", reject);
      resolve();
    });
  });
  const address = runtime.server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

test("production composition mounts Configuration Draft API and fails closed for unconfigured Strategy Evidence", async () => {
  const database = new DatabaseSync(":memory:");
  const runtime = createCurrentPipelineOrchestrationRuntime({
    database,
    operatorToken: "production-operator-token",
  });
  const base = await listen(runtime);
  try {
    const catalogResponse = await fetch(`${base}/api/orchestration/catalog`);
    assert.equal(catalogResponse.status, 200);
    const catalog = (await catalogResponse.json()) as {
      data: {
        productionWorkspace: {
          configurationDrafts: {
            configured: boolean;
            historicalCompilerConfigured: boolean;
          };
          strategyEvidence: { configured: boolean };
          runtimeApplied: boolean;
        };
      };
    };
    assert.deepEqual(catalog.data.productionWorkspace, {
      schemaVersion: "1.0.0",
      configurationDrafts: {
        configured: true,
        historicalCompilerConfigured: false,
        allowedToolIds: ["tool:market-data:read"],
      },
      strategyEvidence: {
        configured: false,
        datasets: [],
        profiles: [],
        profileCandidateSets: [],
        walkForwardPlans: [],
      },
      runtimeApplied: false,
    });

    const configurationCatalog = await fetch(
      `${base}/api/orchestration/configuration/catalog`,
      {
        headers: {
          authorization: "Bearer production-operator-token",
        },
      },
    );
    assert.equal(configurationCatalog.status, 200);
    const configurationBody = (await configurationCatalog.json()) as {
      marketPackIds: string[];
      dataSourceIds: string[];
      agentTemplateIds: string[];
    };
    assert.ok(configurationBody.marketPackIds.includes("market-pack:crypto:v1"));
    assert.ok(
      configurationBody.dataSourceIds.includes(
        "data-source:binance-futures-public",
      ),
    );
    assert.ok(
      configurationBody.agentTemplateIds.includes(
        "agent-template:analysis:v1",
      ),
    );

    const injected = await fetch(
      `${base}/api/orchestration/configuration/drafts`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer production-operator-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: "1.0.0",
          humanVersion: "v1",
          actorId: "browser:attacker",
          runtimeApplied: true,
          payload: {
            kind: "market",
            marketPackId: "market-pack:crypto:v1",
            dataSourceIds: ["data-source:binance-futures-public"],
            observationWindows: [
              { kind: "bar_interval", unit: "minute", value: 5 },
            ],
            timezone: "UTC",
            tradingCalendarRef: "calendar:crypto-24x7:v1",
          },
        }),
      },
    );
    assert.equal(injected.status, 400);

    const evidence = await fetch(
      `${base}/api/orchestration/strategy-evidence/bindings`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer production-operator-token",
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(evidence.status, 503);
    assert.equal(
      ((await evidence.json()) as { error: { code: string } }).error.code,
      "STRATEGY_EVIDENCE_NOT_CONFIGURED",
    );
  } finally {
    await runtime.close();
    database.close();
  }
});

test("production composition registers durable Graph Evidence dependencies in the same SQLite boundary", () => {
  const database = new DatabaseSync(":memory:");
  const createdAt = "2026-07-26T12:00:00.000Z";
  const fingerprint = (id: string) => graphEvidenceFingerprint({ id });
  const dataset = createGraphHistoricalDatasetDefinition({
    schemaVersion: "1.0.0",
    id: "dataset.production.current-crypto",
    version: "v1",
    lifecycleStatus: "active",
    createdAt,
    marketPackRef: {
      id: "market-pack:crypto:v1",
      version: "1.0.0",
      fingerprint: fingerprint("market-pack"),
    },
    dataSourceRef: {
      id: "data-source:csv-historical",
      version: "1.0.0",
      fingerprint: fingerprint("data-source"),
    },
    timezone: "UTC",
    tradingCalendarRef: "calendar:crypto-24x7:v1",
    asOfSequence: [
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z",
    ],
  });
  const profile = createGraphStrategyProfileDefinition({
    schemaVersion: "1.0.0",
    id: "profile.production.current-crypto",
    version: "v1",
    lifecycleStatus: "active",
    createdAt,
    compatiblePresetIds: ["preset.production.current-crypto"],
    parameters: { minimumConfidence: 0.6 },
  });
  const candidateSet = createGraphStrategyProfileCandidateSet({
    schemaVersion: "1.0.0",
    id: "profile-set.production.current-crypto",
    version: "v1",
    lifecycleStatus: "active",
    createdAt,
    profileIds: [profile.id],
  });
  const walkForwardPlan = createGraphWalkForwardPlanDefinition({
    schemaVersion: "1.0.0",
    id: "walk-forward-plan.production.current-crypto",
    version: "v1",
    lifecycleStatus: "active",
    createdAt,
    trainingCycles: 2,
    validationCycles: 1,
    stepCycles: 1,
    objective: "total_return_pct",
  });
  const sessionFactory: GraphBacktestSessionFactory = {
    create: async () => {
      throw new Error("TEST_SESSION_NOT_EXECUTED");
    },
  };
  const runtime = createCurrentPipelineOrchestrationRuntime({
    database,
    operatorToken: "production-operator-token",
    strategyOrchestration: {
      graphEvidence: {
        datasets: [dataset],
        profiles: [profile],
        profileCandidateSets: [candidateSet],
        walkForwardPlans: [walkForwardPlan],
        sessionFactory,
        approvedPaperPlanPolicy: {
          planVersion: "v1",
          paperAccountRef: "paper-account:production",
          candidateSymbols: ["BTCUSDT"],
          riskPolicyRefs: ["risk-policy:current-paper"],
        },
      },
    },
  });
  try {
    const production = runtime.productionStrategyOrchestration;
    assert.ok(production.graphEvidenceJobRepository);
    assert.ok(production.graphEvidenceJobService);
    assert.ok(production.strategyEvidenceBindingRepository);
    assert.ok(production.strategyEvidenceApprovalService);
    assert.ok(production.strategyEvidenceHttpHandler);
    assert.equal(production.workspaceCatalog.strategyEvidence.configured, true);
    assert.equal(
      production.workspaceCatalog.strategyEvidence.datasets[0]?.id,
      dataset.id,
    );
    assert.equal(production.workspaceCatalog.runtimeApplied, false);
  } finally {
    database.close();
  }
});
