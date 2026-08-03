import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { AgentDefinitionService, SqliteAgentDefinitionRepository } from "../packages/runtime/src/index.js";

const input = (prompt = "Interpret normalized market facts.") => ({ name: "Input fixture", templateRef: "agent-template:input:v1", dataRef: "data-source:binance-futures-public:v1", upstreamArtifactSchemaRefs: [], userInstructionPrompt: prompt, inputSchemaRef: "schema:market-observation-input:v1", budget: { maxTokens: 1000, maxCalls: 1, timeoutMs: 5000 } });
const analysis = () => ({ name: "Analysis fixture", templateRef: "agent-template:analysis:v1", upstreamArtifactSchemaRefs: ["artifact-schema:structured-observation:v1"], modelRef: "model-connection:deepseek:default", userInstructionPrompt: "Assess registered observations.", inputSchemaRef: "schema:analysis-input:v1", budget: { maxTokens: 2000, maxCalls: 2, timeoutMs: 10000 } });

test("Agent versions are immutable, parent-bound, actor-scoped, idempotent, cursor-bound, and recover after SQLite restart", () => {
  const folder = mkdtempSync(join(tmpdir(), "tradebot-agent-")); const path = join(folder, "agents.sqlite");
  let db = new DatabaseSync(path); let service = new AgentDefinitionService(new SqliteAgentDefinitionRepository(db));
  try {
    const created = service.create("actor:one", "input", input(), "agent:create:001");
    assert.equal(service.create("actor:one", "input", input(), "agent:create:001").version.versionId, created.version.versionId);
    assert.throws(() => service.create("actor:one", "input", input("changed"), "agent:create:001"), /IDEMPOTENCY_CONFLICT/);
    const v2 = service.createVersion("actor:one", created.definition.definitionId, { parentVersionId: created.version.versionId, parentFingerprint: created.version.fingerprint, payload: input("v2 behavior"), idempotencyKey: "agent:version:001" });
    assert.equal(service.createVersion("actor:one", created.definition.definitionId, { parentVersionId: created.version.versionId, parentFingerprint: created.version.fingerprint, payload: input("v2 behavior"), idempotencyKey: "agent:version:001" }).versionId, v2.versionId);
    assert.equal(service.get("actor:one", created.definition.definitionId).version.versionId, v2.versionId);
    assert.equal(service.versions("actor:one", created.definition.definitionId, 1).data[0]!.versionId, v2.versionId);
    assert.throws(() => service.createVersion("actor:one", created.definition.definitionId, { parentVersionId: created.version.versionId, parentFingerprint: created.version.fingerprint, payload: input("stale parent"), idempotencyKey: "agent:version:stale" }), /PARENT_VERSION_CONFLICT/);
    assert.throws(() => service.versions("actor:two", created.definition.definitionId), /AGENT_DEFINITION_NOT_FOUND/);
    const first = service.versions("actor:one", created.definition.definitionId, 1); assert.ok(first.nextCursor); assert.equal(service.versions("actor:one", created.definition.definitionId, 1, first.nextCursor).data[0]!.versionId, created.version.versionId);
    assert.throws(() => service.versions("actor:two", created.definition.definitionId, 1, first.nextCursor), /AGENT_DEFINITION_NOT_FOUND/);
    assert.throws(() => service.versions("actor:one", created.definition.definitionId, 1, "not-a-cursor"), /CURSOR_INVALID/);
    assert.throws(() => service.create("actor:one", "input", { ...input(), templateRef: "https://injected.invalid/agent" }, "agent:inject:001"), /TEMPLATE_REF_UNREGISTERED/);
    assert.throws(() => service.create("actor:one", "analysis", { ...analysis(), runner: "rm -rf /" }, "agent:inject:002"), /unrecognized/i);
    db.close(); db = new DatabaseSync(path); service = new AgentDefinitionService(new SqliteAgentDefinitionRepository(db));
    assert.equal(service.get("actor:one", created.definition.definitionId).version.fingerprint, v2.fingerprint);
    assert.equal(service.versions("actor:one", created.definition.definitionId).data.length, 2);
  } finally { db.close(); rmSync(folder, { recursive: true, force: true }); }
});
