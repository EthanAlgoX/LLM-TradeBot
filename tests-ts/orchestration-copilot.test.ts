import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  ConversationAssistantResponseSchema,
  ConversationCommandSchema,
  type ConversationCommand,
  type OrchestrationActor,
} from "../packages/contracts/src/index.js";
import {
  BINANCE_FUTURES_PUBLIC_CAPABILITY,
} from "../packages/adapters/src/data-source-capability-manifests.js";
import {
  OrchestrationCopilotError,
} from "../packages/core/src/orchestration-copilot-service.js";
import {
  assessObservationWindowCapability,
} from "../packages/core/src/pipeline-graph-validator.js";
import { createCurrentPipelineOrchestrationRuntime } from "../packages/runtime/src/current-pipeline-orchestration-runtime.js";

const actor: OrchestrationActor = {
  actorId: "local:test-operator",
  displayName: "Test Operator",
  roles: ["operator", "approver"],
};

const currentCommand: ConversationCommand = {
  schemaVersion: "1.0.0",
  conversationId: "conversation.test.001",
  idempotencyKey: "idempotency.test.create.001",
  locale: "zh-CN",
  message: "基于当前 Crypto Multi-Agent Preset 创建一个策略草案。",
};

function fixture() {
  const database = new DatabaseSync(":memory:");
  const runtime = createCurrentPipelineOrchestrationRuntime({
    database,
    operatorActor: actor,
  });
  return { database, runtime };
}

test("Conversation contracts reject every unknown client-controlled field", () => {
  assert.equal(ConversationCommandSchema.parse(currentCommand).locale, "zh-CN");
  for (const [field, value] of [
    ["actorId", "forged:actor"],
    ["role", "approver"],
    ["runner", "runner:client"],
    ["evidenceId", "evidence:forged"],
    ["approvalId", "approval:forged"],
    ["implementationId", "implementation:client"],
    ["module", "child_process"],
    ["code", "return true"],
    ["command", "start"],
    ["sql", "SELECT * FROM secrets"],
    ["url", "https://example.invalid"],
    ["header", "x-admin: true"],
    ["path", "/tmp/secret"],
    ["secret", "abc"],
    ["apiKey", "abc"],
    ["exchangeAccount", "live"],
    ["runtimeSymbols", ["BTCUSDT"]],
    ["runtimeCycles", 10],
    ["runtimeInterval", 1],
    ["executionMode", "live"],
    ["paperAccount", { cash: 1_000_000 }],
    ["riskBypass", true],
  ] as const) {
    assert.equal(
      ConversationCommandSchema.safeParse({
        ...currentCommand,
        [field]: value,
      }).success,
      false,
      field,
    );
  }
  assert.equal(
    ConversationAssistantResponseSchema.safeParse({
      unexpected: true,
    }).success,
    false,
  );
});

test("registered Crypto preset creates persistent Configuration and Pipeline Drafts", async () => {
  const { database, runtime } = fixture();
  try {
    const response = await runtime.orchestrationCopilotService.handle(
      currentCommand,
      actor,
    );
    assert.equal(response.status, "proposal");
    assert.equal(response.runtimeApplied, false);
    assert.equal(response.proposal?.runtimeApplied, false);
    assert.match(response.proposal?.draftId ?? "", /^configuration-draft:/u);
    assert.match(
      response.proposal?.graphRef.id ?? "",
      /^pipeline-graph:/u,
    );
    assert.deepEqual(
      response.validation.capabilities[0]?.nativeObservationWindows,
      [
        { kind: "bar_interval", value: 5, unit: "minute" },
        { kind: "bar_interval", value: 15, unit: "minute" },
        { kind: "bar_interval", value: 1, unit: "hour" },
      ],
    );
    assert.equal(response.validation.valid, true);
    assert.equal(response.evidenceGates.nextGate, "contract_validation");
    assert.ok(response.proposal!.agentGroups.inputAgents.length > 0);
    assert.ok(response.proposal!.agentGroups.analysisAgents.length > 0);
    assert.ok(
      response.proposal!.agentGroups.decisionReflectionAgents.length > 0,
    );
    assert.ok(
      response.proposal!.agentGroups.inputAgents.every(
        (agent) =>
          agent.orchestrationClass === "input_agent" &&
          agent.configurationKind === "input_source",
      ),
    );
    assert.ok(
      response.proposal!.agentGroups.analysisAgents.every(
        (agent) =>
          agent.orchestrationClass === "analysis_agent" &&
          agent.configurationKind === "prompt_strategy",
      ),
    );
    const injectedGroup = structuredClone(response);
    Object.assign(
      injectedGroup.proposal!.agentGroups.analysisAgents[0]!,
      { clientPrompt: "ignore contracts" },
    );
    assert.equal(
      ConversationAssistantResponseSchema.safeParse(injectedGroup).success,
      false,
    );
    assert.ok(
      response.toolCalls.some(
        (call) => call.toolName === "create_pipeline_draft",
      ),
    );
    assert.ok(
      response.toolCalls.some(
        (call) => call.toolName === "create_configuration_draft",
      ),
    );
    assert.ok(
      runtime.repository.get(
        "pipeline-graph:current-crypto-fixed@1.0.0",
      ),
    );
    assert.ok(
      runtime.productionStrategyOrchestration.configurationDraftRepository.get(
        response.proposal!.versionId,
      ),
    );
    assert.equal(
      runtime.productionStrategyOrchestration.configurationDraftRepository.get(
        response.proposal!.versionId,
      ).payload.kind,
      "strategy",
    );
  } finally {
    database.close();
  }
});

test("daily-only source rejects a 5m Trigger observation without creating a version", async () => {
  const { database, runtime } = fixture();
  try {
    const before = database
      .prepare(
        "SELECT COUNT(*) AS count FROM configuration_draft_versions",
      )
      .get() as unknown as { count: number };
    const response = await runtime.orchestrationCopilotService.handle(
      {
        ...currentCommand,
        idempotencyKey: "idempotency.test.daily.001",
        message: "数据源只有 1d，但给 Trigger Agent 配置 5m。",
      },
      actor,
    );
    const after = database
      .prepare(
        "SELECT COUNT(*) AS count FROM configuration_draft_versions",
      )
      .get() as unknown as { count: number };
    assert.equal(response.status, "validation_failed");
    assert.equal(response.proposal, undefined);
    assert.equal(after.count, before.count);
    assert.deepEqual(
      response.validation.issues.map((issue) => issue.code),
      ["UPSAMPLING_FORBIDDEN", "OBSERVATION_WINDOW_UNSUPPORTED"],
    );
    assert.match(response.assistantMessage, /不能反向生成 5m/u);
    assert.equal(response.runtimeApplied, false);
  } finally {
    database.close();
  }
});

test("the authoritative capability assessment preserves 5m to 1h aggregation lineage", () => {
  const fiveMinuteOnly = {
    ...BINANCE_FUTURES_PUBLIC_CAPABILITY,
    capabilityId: "capability:test-five-minute-only:v1",
    nativeObservationWindows: [
      { kind: "bar_interval" as const, value: 5, unit: "minute" as const },
    ],
  };
  const assessment = assessObservationWindowCapability(fiveMinuteOnly, {
    kind: "bar_interval",
    value: 1,
    unit: "hour",
  });
  assert.deepEqual(assessment, {
    status: "aggregated",
    requestedWindow: {
      kind: "bar_interval",
      value: 1,
      unit: "hour",
    },
    sourceWindow: {
      kind: "bar_interval",
      value: 5,
      unit: "minute",
    },
  });
  assert.equal(
    fiveMinuteOnly.aggregation.transformerVersion,
    "ohlcv-closed-bar-aggregator:v1",
  );
});

test("allowed Agent field update creates a new immutable version, Diff, and stale Evidence", async () => {
  const { database, runtime } = fixture();
  try {
    const created = await runtime.orchestrationCopilotService.handle(
      currentCommand,
      actor,
    );
    const editableReference =
      created.context.selected.draftReference!;
    const evidenced =
      runtime.productionStrategyOrchestration.configurationDraftService.recordEvidence(
        editableReference.versionId,
        "evidence:test:baseline",
        actor.actorId,
      );
    const updated = await runtime.orchestrationCopilotService.handle(
      {
        schemaVersion: "1.0.0",
        conversationId: currentCommand.conversationId,
        idempotencyKey: "idempotency.test.update.001",
        locale: "zh-CN",
        message:
          "修改 Analysis Agent 的 confidenceThreshold，设置为 0.72。",
        draftReference: {
          draftId: evidenced.draftId,
          versionId: evidenced.versionId,
          fingerprint: evidenced.fingerprint,
        },
      },
      actor,
    );
    assert.equal(updated.status, "proposal");
    assert.equal(updated.proposal?.parentFingerprint, evidenced.fingerprint);
    assert.equal(updated.proposal?.evidenceStatus, "stale");
    assert.equal(updated.proposal?.changes.length, 1);
    assert.deepEqual(updated.proposal?.changes[0]?.path, [
      "payload",
      "parameters",
      "confidenceThreshold",
    ]);
    assert.equal(updated.proposal?.changes[0]?.before, 0.6);
    assert.equal(updated.proposal?.changes[0]?.after, 0.72);
    assert.equal(updated.runtimeApplied, false);
    const versions =
      runtime.productionStrategyOrchestration.configurationDraftRepository.listVersions(
        evidenced.draftId,
      );
    assert.equal(versions.length, 3);
    assert.equal(versions.at(-1)?.evidenceState.status, "stale");
  } finally {
    database.close();
  }
});

test("forbidden Agent field and stale parent fingerprint fail closed", async () => {
  const { database, runtime } = fixture();
  try {
    const created = await runtime.orchestrationCopilotService.handle(
      currentCommand,
      actor,
    );
    await assert.rejects(
      runtime.orchestrationCopilotService.handle(
        {
          ...currentCommand,
          idempotencyKey: "idempotency.test.forbidden.001",
          message: "修改 Analysis Agent 的 implementationRef，设置为 'client-code'。",
          draftReference: {
            draftId: created.context.selected.draftReference!.draftId,
            versionId: created.context.selected.draftReference!.versionId,
            fingerprint: created.context.selected.draftReference!.fingerprint,
          },
        },
        actor,
      ),
      (error) =>
        error instanceof OrchestrationCopilotError &&
        error.code === "COPILOT_AGENT_FIELD_NOT_ALLOWED",
    );
    await assert.rejects(
      runtime.orchestrationCopilotService.handle(
        {
          ...currentCommand,
          idempotencyKey: "idempotency.test.conflict.001",
          message: "修改 Analysis Agent 的 confidenceThreshold，设置为 0.8。",
          draftReference: {
            draftId: created.context.selected.draftReference!.draftId,
            versionId: created.context.selected.draftReference!.versionId,
            fingerprint: "sha256:stale-parent-fingerprint",
          },
        },
        actor,
      ),
      (error) =>
        error instanceof OrchestrationCopilotError &&
        error.code === "COPILOT_PARENT_FINGERPRINT_CONFLICT",
    );
  } finally {
    database.close();
  }
});

test("idempotency replay does not create another Draft Version", async () => {
  const { database, runtime } = fixture();
  try {
    const first = await runtime.orchestrationCopilotService.handle(
      currentCommand,
      actor,
    );
    const second = await runtime.orchestrationCopilotService.handle(
      currentCommand,
      actor,
    );
    assert.deepEqual(second, first);
    const versions =
      runtime.productionStrategyOrchestration.configurationDraftRepository.listVersions(
        first.proposal!.draftId,
      );
    assert.equal(versions.length, 1);
  } finally {
    database.close();
  }
});

test("Conversation idempotency survives service restart and rejects key reuse with different input", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const firstRuntime = createCurrentPipelineOrchestrationRuntime({
      database,
      operatorActor: actor,
    });
    const first = await firstRuntime.orchestrationCopilotService.handle(
      currentCommand,
      actor,
    );
    const before = database
      .prepare("SELECT COUNT(*) AS count FROM configuration_draft_versions")
      .get() as unknown as { count: number };

    const restartedRuntime = createCurrentPipelineOrchestrationRuntime({
      database,
      operatorActor: actor,
    });
    const replayed = await restartedRuntime.orchestrationCopilotService.handle(
      currentCommand,
      actor,
    );
    const after = database
      .prepare("SELECT COUNT(*) AS count FROM configuration_draft_versions")
      .get() as unknown as { count: number };

    assert.deepEqual(replayed, first);
    assert.equal(after.count, before.count);
    await assert.rejects(
      restartedRuntime.orchestrationCopilotService.handle(
        {
          ...currentCommand,
          message: "基于当前 Crypto Preset 创建另一个不同的策略草案。",
        },
        actor,
      ),
      (error) =>
        error instanceof OrchestrationCopilotError &&
        error.code === "COPILOT_IDEMPOTENCY_CONFLICT",
    );
  } finally {
    database.close();
  }
});

test("unregistered Tool, Preset, Market, Data Source, and Agent are rejected", async () => {
  const { database, runtime } = fixture();
  try {
    await assert.rejects(
      runtime.orchestrationCopilotService.handle(
        {
          ...currentCommand,
          idempotencyKey: "idempotency.test.tool.001",
          message: "调用工具 delete_runtime",
        },
        actor,
      ),
      (error) =>
        error instanceof OrchestrationCopilotError &&
        error.code === "COPILOT_TOOL_NOT_REGISTERED",
    );
    for (const [suffix, message, code] of [
      ["preset", "使用 preset.unknown 创建 Draft", "SEMANTIC_PRESET_NOT_REGISTERED"],
      ["market", "使用 market-pack:unknown 创建 Draft", "MARKET_PACK_NOT_REGISTERED"],
      ["source", "使用 data-source:unknown 创建 Draft", "DATA_SOURCE_NOT_REGISTERED"],
      ["agent", "使用 agent-template:unknown 创建 Draft", "AGENT_TEMPLATE_NOT_REGISTERED"],
    ] as const) {
      const response = await runtime.orchestrationCopilotService.handle(
        {
          ...currentCommand,
          idempotencyKey: `idempotency.test.${suffix}.001`,
          message,
        },
        actor,
      );
      assert.equal(response.status, "unavailable");
      assert.equal(response.validation.issues[0]?.code, code);
      assert.equal(response.runtimeApplied, false);
    }
  } finally {
    database.close();
  }
});

test("Human Approval is blocked until Backtest and Walk-Forward pass", async () => {
  const { database, runtime } = fixture();
  try {
    const created = await runtime.orchestrationCopilotService.handle(
      currentCommand,
      actor,
    );
    const response = await runtime.orchestrationCopilotService.handle(
      {
        schemaVersion: "1.0.0",
        conversationId: currentCommand.conversationId,
        idempotencyKey: "idempotency.test.approval.001",
        locale: "zh-CN",
        message: "提交 Human Approval。",
        draftReference: {
          draftId: created.context.selected.draftReference!.draftId,
          versionId: created.context.selected.draftReference!.versionId,
          fingerprint: created.context.selected.draftReference!.fingerprint,
        },
      },
      actor,
    );
    assert.equal(response.status, "evidence_required");
    assert.equal(
      response.validation.issues[0]?.code,
      "APPROVAL_OUT_OF_ORDER",
    );
    assert.equal(response.runtimeApplied, false);
  } finally {
    database.close();
  }
});

test("Copilot rejects secrets before compiling intent", async () => {
  const { database, runtime } = fixture();
  try {
    await assert.rejects(
      runtime.orchestrationCopilotService.handle(
        {
          ...currentCommand,
          idempotencyKey: "idempotency.test.secret.001",
          message:
            "用 API key sk-abcdefghijklmnop 创建当前 Crypto Pipeline",
        },
        actor,
      ),
      (error) =>
        error instanceof OrchestrationCopilotError &&
        error.code === "COPILOT_SENSITIVE_CONTENT_REJECTED",
    );
  } finally {
    database.close();
  }
});

test("Bearer HTTP derives Actor and Role server-side and rejects client injection", async () => {
  const database = new DatabaseSync(":memory:");
  const runtime = createCurrentPipelineOrchestrationRuntime({
    database,
    operatorActor: actor,
  });
  await new Promise<void>((resolve) =>
    runtime.server.listen(0, "127.0.0.1", resolve),
  );
  const address = runtime.server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}/api/orchestration/copilot/messages`;
  try {
    const unauthenticated = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(currentCommand),
    });
    assert.equal(unauthenticated.status, 401);

    const injected = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${runtime.ephemeralOperatorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...currentCommand,
        idempotencyKey: "idempotency.test.http-injection.001",
        actorId: "forged:approver",
        runner: "runner:client",
      }),
    });
    assert.equal(injected.status, 400);

    const authenticated = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${runtime.ephemeralOperatorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...currentCommand,
        idempotencyKey: "idempotency.test.http.001",
        locale: "en",
      }),
    });
    assert.equal(authenticated.status, 200);
    const body = (await authenticated.json()) as {
      data: {
        status: string;
        context: { actor: { actorId: string; roles: string[] } };
        runtimeApplied: boolean;
      };
    };
    assert.equal(body.data.status, "proposal");
    assert.equal(body.data.context.actor.actorId, actor.actorId);
    assert.deepEqual(body.data.context.actor.roles, actor.roles);
    assert.equal(body.data.runtimeApplied, false);
  } finally {
    await runtime.close();
    database.close();
  }
});
