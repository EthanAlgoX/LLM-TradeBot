import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  ConversationAssistantResponseSchema,
  ConversationCommandSchema,
  ToolActivityListSchema,
  projectToolActivity,
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
  ConversationReplayReadError,
  SqliteConversationReplayRepository,
} from "../packages/runtime/src/sqlite-conversation-replay-repository.js";
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

test("an explicit CSV Historical preset wins over overlapping Current Crypto aliases", async () => {
  const { database, runtime } = fixture();
  try {
    const response = await runtime.orchestrationCopilotService.handle(
      {
        ...currentCommand,
        conversationId: "conversation.csv-compatible.001",
        idempotencyKey: "idempotency.csv-compatible.001",
        locale: "en",
        message: "Create a CSV Historical Draft using preset.current-crypto-csv-historical and data-source:csv-historical",
      },
      actor,
    );
    assert.equal(response.status, "proposal");
    assert.equal(response.context.selected.presetId, "preset.current-crypto-csv-historical");
    assert.deepEqual(response.context.selected.dataSourceIds, ["data-source:csv-historical"]);
    assert.equal(response.context.selected.draftReference?.versionId.endsWith(":version:1"), true);
    assert.equal(response.runtimeApplied, false);
  } finally {
    database.close();
  }
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

test("tool activity is bounded, strict, correlated, and omits raw arguments and output", async () => {
  const { database, runtime } = fixture();
  try {
    const response = await runtime.orchestrationCopilotService.handle(currentCommand, actor);
    const activity = projectToolActivity(response.toolCalls, response.toolResults);
    assert.ok(activity.length > 0);
    assert.ok(activity.every((item) => item.toolCallLifecycle === "requested"));
    assert.ok(activity.every((item) => !("arguments" in item) && !("output" in item)));
    assert.ok(activity.every((item) => !item.toolResultId || response.toolResults.some((result) => result.toolCallId === item.toolCallId && result.toolResultId === item.toolResultId)));
    const unmatched = projectToolActivity(response.toolCalls, [{ ...response.toolResults[0]!, toolCallId: "tool-call:unmatched" }]);
    assert.ok(unmatched.every((item) => item.toolResultLifecycle === undefined));
    assert.equal(ToolActivityListSchema.safeParse([...activity, ...activity, ...activity, ...activity, ...activity]).success, false);
    assert.equal(ToolActivityListSchema.safeParse([{ ...activity[0]!, output: { secret: "never" } }]).success, false);
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

test("allowed Agent field update creates a new immutable version and field Diff", async () => {
  const { database, runtime } = fixture();
  try {
    const created = await runtime.orchestrationCopilotService.handle(
      currentCommand,
      actor,
    );
    const editableReference =
      created.context.selected.draftReference!;
    const updated = await runtime.orchestrationCopilotService.handle(
      {
        schemaVersion: "1.0.0",
        conversationId: currentCommand.conversationId,
        idempotencyKey: "idempotency.test.update.001",
        locale: "zh-CN",
        message:
          "修改 Analysis Agent 的 confidenceThreshold，设置为 0.72。",
        draftReference: editableReference,
      },
      actor,
    );
    assert.equal(updated.status, "proposal");
    assert.equal(updated.proposal?.parentFingerprint, editableReference.fingerprint);
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
        editableReference.draftId,
      );
    assert.equal(versions.length, 2);
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
          draftReference: created.context.selected.draftReference,
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
        error.code === "COPILOT_CONVERSATION_DRAFT_REFERENCE_CONFLICT",
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

test("Conversation history is actor-scoped, paginated, and read-only", async () => {
  const database = new DatabaseSync(":memory:");
  const runtime = createCurrentPipelineOrchestrationRuntime({ database, operatorActor: actor });
  await new Promise<void>((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const address = runtime.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/orchestration`;
  const auth = { authorization: `Bearer ${runtime.ephemeralOperatorToken}`, "content-type": "application/json" };
  try {
    await runtime.orchestrationCopilotService.handle(currentCommand, actor);
    await runtime.orchestrationCopilotService.handle({ ...currentCommand, idempotencyKey: "idempotency.test.history.002", message: "修改 Analysis Agent 的 confidenceThreshold，设置为 0.72。" }, actor);
    const list = await fetch(`${base}/conversations?limit=1`, { headers: auth });
    assert.equal(list.status, 200);
    const listBody = await list.json() as { data: { items: Array<{ conversationId: string; turnCount: number }>; hasMore: boolean } };
    assert.equal(listBody.data.items[0]?.conversationId, currentCommand.conversationId);
    assert.equal(listBody.data.items[0]?.turnCount, 2);
    const turns = await fetch(`${base}/conversations/${currentCommand.conversationId}/turns?limit=1`, { headers: auth });
    assert.equal(turns.status, 200);
    const turnsBody = await turns.json() as { data: { items: Array<{ runtimeApplied: boolean }>; hasMore: boolean } };
    assert.equal(turnsBody.data.items.length, 1);
    assert.equal(turnsBody.data.items[0]?.runtimeApplied, false);
    const invalid = await fetch(`${base}/conversations?limit=NaN`, { headers: auth });
    assert.equal(invalid.status, 400);
    const injectedActor = await fetch(`${base}/conversations?actorId=forged:actor`, { headers: auth });
    assert.equal(injectedActor.status, 400);
    const unauthenticatedTurns = await fetch(`${base}/conversations/${currentCommand.conversationId}/turns?limit=1`);
    assert.equal(unauthenticatedTurns.status, 401);
    const malformedId = await fetch(`${base}/conversations/%E0%A4%A` , { headers: auth });
    assert.equal(malformedId.status, 400);
    const write = await fetch(`${base}/conversations`, { method: "POST", headers: auth });
    assert.equal(write.status, 405);
    const put = await fetch(`${base}/conversations/${currentCommand.conversationId}`, { method: "PUT", headers: auth });
    assert.equal(put.status, 405);
    const missing = await fetch(`${base}/conversations/conversation.unknown`, { headers: auth });
    assert.equal(missing.status, 404);
  } finally {
    await runtime.close();
    database.close();
  }
});

test("conversation authority requires the complete server draft reference before tools run", async () => {
  const { database, runtime } = fixture();
  try {
    const first = await runtime.orchestrationCopilotService.handle(currentCommand, actor);
    const authoritative = first.context.selected.draftReference!;
    const count = () => (database.prepare("SELECT COUNT(*) AS count FROM configuration_draft_versions").get() as { count: number }).count;
    const before = count();
    for (const forged of [
      { ...authoritative, versionId: "configuration-version:forged" },
      { ...authoritative, fingerprint: "fnv1a32:deadbeef" },
      { ...authoritative, draftId: "configuration-draft:forged" },
    ]) {
      await assert.rejects(
        runtime.orchestrationCopilotService.handle({ ...currentCommand, idempotencyKey: `idempotency.test.authority.${forged.versionId ?? forged.draftId}`, message: "修改 Analysis Agent 的 confidenceThreshold，设置为 0.72。", draftReference: forged }, actor),
        (error: unknown) => error instanceof OrchestrationCopilotError && error.code === "COPILOT_CONVERSATION_DRAFT_REFERENCE_CONFLICT",
      );
    }
    assert.equal(count(), before);
    const restored = await runtime.orchestrationCopilotService.handle({ ...currentCommand, idempotencyKey: "idempotency.test.authority.restore", message: "修改 Analysis Agent 的 confidenceThreshold，设置为 0.72。" }, actor);
    assert.equal(restored.context.selected.draftReference?.draftId, authoritative.draftId);
    const clean = await runtime.orchestrationCopilotService.handle({ ...currentCommand, conversationId: "conversation.test.clean", idempotencyKey: "idempotency.test.authority.clean", draftReference: authoritative }, actor);
    assert.notEqual(clean.context.selected.draftReference?.draftId, authoritative.draftId);
  } finally { database.close(); }
});

test("SQLite conversation replay pagination is SQL-bounded, stable, actor-isolated, and fail-closed", async () => {
  const { database, runtime } = fixture();
  const repository = new SqliteConversationReplayRepository(database);
  const actorB: OrchestrationActor = { actorId: "local:second-operator", displayName: "Second", roles: ["operator"] };
  try {
    for (const currentActor of [actor, actorB]) {
      for (const conversationId of ["conversation.test.page.a", "conversation.test.page.b"]) {
        await runtime.orchestrationCopilotService.handle({ ...currentCommand, conversationId: `${conversationId}.${currentActor === actor ? "one" : "two"}`, idempotencyKey: `idempotency.test.${conversationId}.${currentActor === actor ? "one" : "two"}.1` }, currentActor);
        await runtime.orchestrationCopilotService.handle({ ...currentCommand, conversationId: `${conversationId}.${currentActor === actor ? "one" : "two"}`, idempotencyKey: `idempotency.test.${conversationId}.${currentActor === actor ? "one" : "two"}.2`, message: "修改 Analysis Agent 的 confidenceThreshold，设置为 0.72。" }, currentActor);
      }
    }
    const first = repository.listConversations(actor.actorId, { schemaVersion: "1.0.0", limit: 1 });
    const second = repository.listConversations(actor.actorId, { schemaVersion: "1.0.0", limit: 50, cursor: first.nextCursor });
    assert.equal(first.items.length + second.items.length, 2);
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.conversationId)).size, 2);
    assert.ok([...first.items, ...second.items].every((item) => item.conversationId.endsWith(".one")));
    const turnFirst = repository.listTurns(actor.actorId, "conversation.test.page.a.one", { schemaVersion: "1.0.0", limit: 1 });
    const turnSecond = repository.listTurns(actor.actorId, "conversation.test.page.a.one", { schemaVersion: "1.0.0", limit: 50, cursor: turnFirst.nextCursor });
    assert.equal(turnFirst.items.length + turnSecond.items.length, 2);
    assert.equal(repository.listTurns(actorB.actorId, "conversation.test.page.a.one", { schemaVersion: "1.0.0", limit: 1 }).items.length, 0);
    assert.equal(repository.getConversation(actorB.actorId, "conversation.test.page.a.one"), undefined);
    assert.throws(() => repository.listTurns(actor.actorId, "conversation.test.page.a.one", { schemaVersion: "1.0.0", limit: 1, cursor: first.nextCursor }), (error: unknown) => error instanceof ConversationReplayReadError && error.code === "INVALID_CONVERSATION_CURSOR");
    database.prepare("INSERT INTO orchestration_conversation_replays (actor_id, conversation_id, idempotency_key, command_json, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(actor.actorId, "conversation.test.corrupt", "idempotency.test.corrupt", "{}", "{}", new Date().toISOString());
    assert.throws(() => repository.getConversation(actor.actorId, "conversation.test.corrupt"), (error: unknown) => error instanceof ConversationReplayReadError && error.code === "CORRUPT_CONVERSATION_REPLAY");
    assert.throws(() => database.prepare("DELETE FROM orchestration_conversation_replays WHERE conversation_id = ?").run("conversation.test.corrupt"));
  } finally { database.close(); }
});

test("SQLite conversation history and its authoritative Draft reference survive runtime restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-conversation-replay-"));
  const databasePath = join(directory, "runtime.sqlite");
  const firstRuntime = createCurrentPipelineOrchestrationRuntime({ databasePath, operatorActor: actor });
  try {
    const created = await firstRuntime.orchestrationCopilotService.handle(currentCommand, actor);
    const reference = created.context.selected.draftReference!;
    await firstRuntime.close();
    const restoredRuntime = createCurrentPipelineOrchestrationRuntime({ databasePath, operatorActor: actor });
    try {
      assert.deepEqual(restoredRuntime.orchestrationCopilotService.getLatestDraftReference(actor.actorId, currentCommand.conversationId), reference);
      const continued = await restoredRuntime.orchestrationCopilotService.handle({ ...currentCommand, idempotencyKey: "idempotency.test.restart.002", message: "修改 Analysis Agent 的 confidenceThreshold，设置为 0.72。" }, actor);
      assert.equal(continued.context.selected.draftReference?.draftId, reference.draftId);
      assert.equal(restoredRuntime.orchestrationCopilotService.listTurns(actor.actorId, currentCommand.conversationId, { schemaVersion: "1.0.0", limit: 50 }).items.length, 2);
    } finally { await restoredRuntime.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
