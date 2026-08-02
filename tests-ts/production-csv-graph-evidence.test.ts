import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { resolveStrategyProfile } from "../packages/config/src/index.js";
import {
  createCsvProductionGraphEvidenceRegistration,
  createCurrentPipelineOrchestrationRuntime,
} from "../packages/runtime/src/index.js";

const actor = {
  actorId: "operator:m7",
  displayName: "M7 Operator",
  roles: ["operator", "approver"] as ("operator" | "approver")[],
};

function writeCsv(path: string): void {
  const rows = [
    "ts,symbol,timeframe,open,high,low,close,volume,quote_volume",
  ];
  const start = Date.parse("2026-07-20T00:00:00.000Z");
  for (let index = 0; index < 48; index += 1) {
    const timestamp = new Date(start + index * 5 * 60_000).toISOString();
    const close = 100 + index * 0.25;
    rows.push(
      `${timestamp},BTCUSDT,5m,${close - 0.1},${close + 0.2},${close - 0.3},${close},100,1000000`,
    );
    if (index % 3 === 0) {
      rows.push(
        `${timestamp},BTCUSDT,15m,${close - 0.4},${close + 0.3},${close - 0.6},${close},300,3000000`,
      );
    }
    if (index % 12 === 0) {
      rows.push(
        `${timestamp},BTCUSDT,1h,${close - 1},${close + 0.5},${close - 1.2},${close},1200,12000000`,
      );
    }
  }
  writeFileSync(path, `${rows.join("\n")}\n`, "utf8");
}

function writeProfile(path: string): void {
  const profile = resolveStrategyProfile({
    profileId: "m7-semantic-csv",
    profileVersion: "v1",
    selector: {
      topN: 1,
      minQuoteVolume24h: 0,
      minPrice: 0.00000001,
      minTrendStrength: 0,
      minVolatilityPct: 0,
      maxVolatilityPct: 100,
    },
    dataQuality: {
      minBars5m: 2,
      minBars15m: 2,
      minBars1h: 1,
      maxQuoteAgeMs: 86_400_000,
    },
    decision: {
      perTradeNotional: 500,
      leverage: 1,
      minimumConfidence: 0.5,
    },
    risk: {
      maxLeverage: 1,
      maxNotional: 1_000,
    },
    execution: {
      initialCash: 10_000,
      feeBps: 3,
      slippageBps: 1,
      maxExecutionsPerCycle: 1,
    },
    llm: {
      enabled: false,
    },
  });
  writeFileSync(path, JSON.stringify(profile, null, 2), "utf8");
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-m7-"));
  const csvPath = join(directory, "bars.csv");
  const profilePath = join(directory, "profile.json");
  writeCsv(csvPath);
  writeProfile(profilePath);
  const registration =
    await createCsvProductionGraphEvidenceRegistration({
      csvPath,
      profilePath,
      symbols: ["BTCUSDT"],
      walkForward: {
        trainingCycles: 4,
        validationCycles: 2,
        stepCycles: 2,
      },
      approvedPaperPlanPolicy: {
        planVersion: "m7.v1",
        paperAccountRef: "paper-account:m7",
        candidateSymbols: ["BTCUSDT"],
        riskPolicyRefs: ["risk-policy:m7"],
      },
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });
  return { csvPath, profilePath, registration };
}

test("CSV versioned definitions remain stable across process start times", async () => {
  const configured = await fixture();
  const restarted = await createCsvProductionGraphEvidenceRegistration({
    csvPath: configured.csvPath,
    profilePath: configured.profilePath,
    symbols: ["BTCUSDT"],
    walkForward: {
      trainingCycles: 4,
      validationCycles: 2,
      stepCycles: 2,
    },
    now: () => new Date("2026-08-02T12:00:00.000Z"),
  });

  assert.equal(
    restarted.dataset.fingerprint,
    configured.registration.dataset.fingerprint,
  );
  assert.equal(
    restarted.profile.fingerprint,
    configured.registration.profile.fingerprint,
  );
  assert.equal(
    restarted.walkForwardPlan.fingerprint,
    configured.registration.walkForwardPlan.fingerprint,
  );
});

test("production CSV semantic Graph completes Draft through approved-ready without applying Runtime", async () => {
  const configured = await fixture();
  const database = new DatabaseSync(":memory:");
  const runtime = createCurrentPipelineOrchestrationRuntime({
    database,
    operatorToken: "m7-token",
    operatorActor: actor,
    registrySeed: configured.registration.registrySeed,
    pipelineGraphs: configured.registration.pipelineGraphs,
    strategyOrchestrationFactory:
      configured.registration.createStrategyOrchestrationOptions,
  });
  try {
    const graph = configured.registration.pipelineGraphs[0]!;
    const pipelineDraft = runtime.service.createDraft(graph);
    const production = runtime.productionStrategyOrchestration;
    assert.equal(
      production.workspaceCatalog.configurationDrafts
        .historicalCompilerConfigured,
      true,
    );
    assert.equal(
      production.workspaceCatalog.strategyEvidence.configured,
      true,
    );

    const agentTemplateId =
      configured.registration.registrySeed.agentTemplates?.find(
        (template) => template.role === "analysis",
      )?.templateId;
    assert.ok(agentTemplateId);
    const agentDraft = production.configurationDraftService.create(
      {
        schemaVersion: "1.0.0",
        humanVersion: "m7-agent.v1",
        payload: {
          kind: "agent",
          marketPackId: "market-pack:crypto:v1",
          agentTemplateId,
          dataSourceIds: ["data-source:csv-historical"],
          observationWindows: [
            { kind: "bar_interval", unit: "minute", value: 5 },
          ],
          parameters: {
            confidenceThreshold: 0.6,
            lookbackPeriods: 48,
          },
        },
      },
      actor.actorId,
    );
    const strategy = production.configurationDraftService.create(
      {
        schemaVersion: "1.0.0",
        humanVersion: "m7-strategy.v1",
        payload: {
          kind: "strategy",
          marketPackId: "market-pack:crypto:v1",
          pipelineDraftId: pipelineDraft.draftId,
          agentConfigurationDraftIds: [agentDraft.draftId],
          promptPolicyDraftIds: [],
          weights: {},
          thresholds: {},
        },
      },
      actor.actorId,
    );
    assert.equal(
      production.configurationDraftService.validate(strategy.versionId)
        .valid,
      true,
    );
    const executable =
      production.executableStrategyConfigurationService!.materialize(
        strategy.versionId,
        actor.actorId,
      );
    assert.equal(executable.runtimeApplied, false);
    assert.equal(
      executable.derivedProfile.parameters.minimumConfidence,
      0.6,
    );
    assert.equal(
      executable.derivedProfile.parameters.lookbackPeriods,
      48,
    );

    const evidence = production.strategyEvidenceApprovalService!;
    const dataset = configured.registration.dataset;
    const binding = evidence.createBinding(
      {
        schemaVersion: "1.0.0",
        strategyConfigurationVersionId: strategy.versionId,
        datasetId: dataset.id,
        backtestProfileId: executable.derivedProfile.id,
        walkForwardCandidateSetId:
          executable.derivedCandidateSet.id,
        walkForwardPlanId: configured.registration.walkForwardPlan.id,
        startAt: dataset.asOfSequence[0],
        endAt: dataset.asOfSequence.at(-1),
        idempotencyKey: "m7-create-binding-001",
      },
      actor,
    );
    const backtested = await evidence.runBacktest(
      binding.bindingId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "m7-backtest-001",
      },
      actor,
    );
    assert.equal(backtested.backtestJob?.status, "succeeded");
    const walked = await evidence.runWalkForward(
      binding.bindingId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "m7-walk-forward-001",
      },
      actor,
    );
    assert.equal(walked.lifecycleStatus, "evidence_ready");
    assert.equal(walked.walkForwardJob?.status, "succeeded");

    const approved = evidence.approve(
      binding.bindingId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "m7-human-approval-001",
        note: "M7 historical evidence reviewed.",
      },
      actor,
    );
    assert.equal(approved.binding.lifecycleStatus, "approved");
    assert.equal(approved.plan.lifecycleStatus, "approved_ready");
    assert.equal(approved.plan.runtimeApplied, false);
    assert.equal(
      approved.plan.dataSourceRef,
      "data-source:csv-historical",
    );
    assert.equal(
      approved.plan.graphId,
      graph.pipelineGraphId,
    );
  } finally {
    await runtime.close();
    database.close();
  }
});

test("executable Strategy materialization applies allowlisted parameters and invalidates child Draft drift", async () => {
  const configured = await fixture();
  const database = new DatabaseSync(":memory:");
  const runtime = createCurrentPipelineOrchestrationRuntime({
    database,
    operatorToken: "m8-token",
    operatorActor: actor,
    registrySeed: configured.registration.registrySeed,
    pipelineGraphs: configured.registration.pipelineGraphs,
    strategyOrchestrationFactory:
      configured.registration.createStrategyOrchestrationOptions,
  });
  try {
    const production = runtime.productionStrategyOrchestration;
    const pipelineDraft = runtime.service.createDraft(
      configured.registration.pipelineGraphs[0]!,
    );
    const decisionTemplate = configured.registration.registrySeed
      .agentTemplates!.find((template) => template.role === "decision");
    const riskTemplate = configured.registration.registrySeed
      .agentTemplates!.find((template) => template.role === "risk");
    assert.ok(decisionTemplate);
    assert.ok(riskTemplate);
    const promptPolicy = production.configurationDraftService.create(
      {
        schemaVersion: "1.0.0",
        humanVersion: "m8-decision-prompt.v1",
        payload: {
          kind: "prompt_policy",
          agentTemplateId: decisionTemplate.templateId,
          systemInstructions:
            "Aggregate registered semantic assessments. Never call execution or mutate Runtime.",
          decisionRules: [
            "Return a semantic decision only.",
            "Preserve Decision to Portfolio to Risk to Execution.",
          ],
          parameters: { temperature: 0.2, maxTokens: 800 },
          allowedToolIds: ["tool:market-data:read"],
        },
      },
      actor.actorId,
    );
    const decisionAgent = production.configurationDraftService.create(
      {
        schemaVersion: "1.0.0",
        humanVersion: "m8-decision-agent.v1",
        payload: {
          kind: "agent",
          marketPackId: "market-pack:crypto:v1",
          agentTemplateId: decisionTemplate.templateId,
          dataSourceIds: ["data-source:csv-historical"],
          observationWindows: [
            { kind: "bar_interval", unit: "minute", value: 5 },
          ],
          promptPolicyDraftId: promptPolicy.draftId,
          parameters: { perTradeNotional: 900 },
        },
      },
      actor.actorId,
    );
    const riskAgent = production.configurationDraftService.create(
      {
        schemaVersion: "1.0.0",
        humanVersion: "m8-risk-agent.v1",
        payload: {
          kind: "agent",
          marketPackId: "market-pack:crypto:v1",
          agentTemplateId: riskTemplate.templateId,
          dataSourceIds: ["data-source:csv-historical"],
          observationWindows: [
            { kind: "bar_interval", unit: "minute", value: 5 },
          ],
          parameters: { maxNotional: 100 },
        },
      },
      actor.actorId,
    );
    const strategy = production.configurationDraftService.create(
      {
        schemaVersion: "1.0.0",
        humanVersion: "m8-strategy.v1",
        payload: {
          kind: "strategy",
          marketPackId: "market-pack:crypto:v1",
          pipelineDraftId: pipelineDraft.draftId,
          agentConfigurationDraftIds: [
            decisionAgent.draftId,
            riskAgent.draftId,
          ],
          promptPolicyDraftIds: [promptPolicy.draftId],
          weights: {},
          thresholds: { minimumConfidence: 0 },
        },
      },
      actor.actorId,
    );
    const materializeUrl =
      `http://localhost/api/orchestration/configuration/strategies/` +
      `${encodeURIComponent(strategy.versionId)}/materialize`;
    const unauthorized =
      await production.configurationDraftHttpHandler.handle(
        new Request(materializeUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ schemaVersion: "1.0.0" }),
        }),
      );
    assert.equal(unauthorized.status, 401);
    const materialized =
      await production.configurationDraftHttpHandler.handle(
        new Request(materializeUrl, {
          method: "POST",
          headers: {
            authorization: "Bearer m8-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ schemaVersion: "1.0.0" }),
        }),
      );
    assert.equal(materialized.status, 201);
    const apiExecutable = (await materialized.json()) as {
      strategyConfigurationRef: { versionId: string };
      runtimeApplied: boolean;
    };
    assert.equal(
      apiExecutable.strategyConfigurationRef.versionId,
      strategy.versionId,
    );
    assert.equal(apiExecutable.runtimeApplied, false);
    const executable =
      production.executableStrategyConfigurationService!.getCurrent(
        strategy.versionId,
      );
    assert.equal(
      executable.derivedProfile.parameters.perTradeNotional,
      900,
    );
    assert.equal(executable.derivedProfile.parameters.maxNotional, 100);
    assert.equal(executable.promptExecutionMode, "semantic_only");
    assert.equal(executable.promptPolicyRefs.length, 1);
    assert.equal(executable.runtimeApplied, false);

    const dataset = configured.registration.dataset;
    const evidence = production.strategyEvidenceApprovalService!;
    const binding = evidence.createBinding(
      {
        schemaVersion: "1.0.0",
        strategyConfigurationVersionId: strategy.versionId,
        datasetId: dataset.id,
        backtestProfileId: executable.derivedProfile.id,
        walkForwardCandidateSetId:
          executable.derivedCandidateSet.id,
        walkForwardPlanId: configured.registration.walkForwardPlan.id,
        startAt: dataset.asOfSequence[0],
        endAt: dataset.asOfSequence.at(-1),
        idempotencyKey: "m8-binding-001",
      },
      actor,
    );
    const backtested = await evidence.runBacktest(
      binding.bindingId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: "m8-backtest-001",
      },
      actor,
    );
    const completedJob =
      production.graphEvidenceJobRepository!.get(
        backtested.backtestJob!.jobId,
      );
    assert.ok(completedJob.evidence);
    assert.equal(completedJob.evidence.kind, "graph_backtest");
    if (completedJob.evidence.kind !== "graph_backtest") {
      assert.fail("expected graph backtest evidence");
    }
    if (!("metrics" in completedJob.evidence.result)) {
      assert.fail("expected graph backtest result");
    }
    assert.equal(completedJob.evidence.result.metrics.mode, "trading");
    if (completedJob.evidence.result.metrics.mode !== "trading") {
      assert.fail("expected trading evidence");
    }
    assert.equal(completedJob.evidence.result.metrics.fillCount, 0);
    assert.ok(
      completedJob.evidence.result.metrics.riskRejectionCount > 0,
    );

    production.configurationDraftService.createVersion(
      riskAgent.draftId,
      {
        schemaVersion: "1.0.0",
        parentFingerprint: riskAgent.fingerprint,
        humanVersion: "m8-risk-agent.v2",
        payload: {
          ...riskAgent.payload,
          parameters: { maxNotional: 1_000 },
        },
      },
      actor.actorId,
    );
    assert.throws(
      () =>
        production.executableStrategyConfigurationService!.getCurrent(
          strategy.versionId,
        ),
      /EXECUTABLE_STRATEGY_SOURCE_CHANGED/u,
    );
    await assert.rejects(
      evidence.runBacktest(
        binding.bindingId,
        {
          schemaVersion: "1.0.0",
          idempotencyKey: "m8-backtest-after-drift-001",
        },
        actor,
      ),
      /STRATEGY_EVIDENCE_SCOPE_CHANGED/u,
    );
  } finally {
    await runtime.close();
    database.close();
  }
});

test("production CSV registration and sessions fail closed for malformed or drifted content", async () => {
  const configured = await fixture();
  const malformedPath = join(
    mkdtempSync(join(tmpdir(), "tradebot-m7-malformed-")),
    "bars.csv",
  );
  writeFileSync(
    malformedPath,
    "ts,symbol,timeframe,open,high,low,close,volume\n2026-07-20T00:00:00.000Z,BTCUSDT,1d,1,2,1,2,10\n",
    "utf8",
  );
  await assert.rejects(
    createCsvProductionGraphEvidenceRegistration({
      csvPath: malformedPath,
      profilePath: configured.profilePath,
      symbols: ["BTCUSDT"],
      walkForward: {
        trainingCycles: 2,
        validationCycles: 1,
        stepCycles: 1,
      },
    }),
    /CSV_GRAPH_EVIDENCE_TIMEFRAME_UNSUPPORTED/u,
  );

  appendFileSync(
    configured.csvPath,
    "2026-07-21T00:00:00.000Z,BTCUSDT,5m,120,121,119,120,100,1000000\n",
    "utf8",
  );
  const database = new DatabaseSync(":memory:");
  const runtime = createCurrentPipelineOrchestrationRuntime({
    database,
    registrySeed: configured.registration.registrySeed,
    pipelineGraphs: configured.registration.pipelineGraphs,
    strategyOrchestrationFactory:
      configured.registration.createStrategyOrchestrationOptions,
  });
  try {
    const draft = runtime.service.createDraft(
      configured.registration.pipelineGraphs[0]!,
    );
    const compiled =
      runtime.productionStrategyOrchestration.configurationDraftService;
    const agentDraft = compiled.create(
      {
        schemaVersion: "1.0.0",
        humanVersion: "drift-agent.v1",
        payload: {
          kind: "agent",
          marketPackId: "market-pack:crypto:v1",
          agentTemplateId:
            configured.registration.registrySeed.agentTemplates![0]!
              .templateId,
          dataSourceIds: ["data-source:csv-historical"],
          observationWindows: [
            { kind: "bar_interval", unit: "minute", value: 5 },
          ],
          parameters: {},
        },
      },
      "operator:drift",
    );
    const strategy = compiled.create(
      {
        schemaVersion: "1.0.0",
        humanVersion: "drift-strategy.v1",
        payload: {
          kind: "strategy",
          marketPackId: "market-pack:crypto:v1",
          pipelineDraftId: draft.draftId,
          agentConfigurationDraftIds: [agentDraft.draftId],
          promptPolicyDraftIds: [],
          weights: {},
          thresholds: {},
        },
      },
      "operator:drift",
    );
    const service =
      runtime.productionStrategyOrchestration
        .strategyEvidenceApprovalService!;
    const executable =
      runtime.productionStrategyOrchestration
        .executableStrategyConfigurationService!.materialize(
          strategy.versionId,
          actor.actorId,
        );
    const dataset = configured.registration.dataset;
    const binding = service.createBinding(
      {
        schemaVersion: "1.0.0",
        strategyConfigurationVersionId: strategy.versionId,
        datasetId: dataset.id,
        backtestProfileId: executable.derivedProfile.id,
        walkForwardCandidateSetId:
          executable.derivedCandidateSet.id,
        walkForwardPlanId: configured.registration.walkForwardPlan.id,
        startAt: dataset.asOfSequence[0],
        endAt: dataset.asOfSequence.at(-1),
        idempotencyKey: "m7-drift-binding-001",
      },
      actor,
    );
    await assert.rejects(
      service.runBacktest(
        binding.bindingId,
        {
          schemaVersion: "1.0.0",
          idempotencyKey: "m7-drift-backtest-001",
        },
        actor,
      ),
      /STRATEGY_EVIDENCE_JOB_FAILED|CSV_GRAPH_EVIDENCE_CONTENT_FINGERPRINT_MISMATCH/u,
    );
    assert.equal(
      runtime.productionStrategyOrchestration.workspaceCatalog
        .runtimeApplied,
      false,
    );
  } finally {
    await runtime.close();
    database.close();
  }
});
