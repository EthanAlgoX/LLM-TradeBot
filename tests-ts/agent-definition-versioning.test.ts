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

test("Agent governance, catalog, clone, server diff and deterministic test evidence are append-only and fail closed", () => {
  const folder = mkdtempSync(join(tmpdir(), "tradebot-agent-governance-")); const path = join(folder, "agents.sqlite"); const db = new DatabaseSync(path); const service = new AgentDefinitionService(new SqliteAgentDefinitionRepository(db));
  try {
    const created = service.create("actor:one", "input", input(), "agent:governance:create");
    assert.equal(service.get("actor:one", created.definition.definitionId).lifecycle.status, "draft");
    assert.throws(() => service.transition("actor:one", created.definition.definitionId, { versionId: created.version.versionId, fingerprint: created.version.fingerprint, action: "publish" }), /LIFECYCLE_TRANSITION_INVALID/);
    const v2 = service.createVersion("actor:one", created.definition.definitionId, { parentVersionId: created.version.versionId, parentFingerprint: created.version.fingerprint, payload: input("changed"), idempotencyKey: "agent:governance:v2" });
    const diff = service.diff("actor:one", created.definition.definitionId, created.version.versionId, v2.versionId); assert.ok(diff.changes.some((item) => item.field === "userInstructionPrompt"));
    service.transition("actor:one", created.definition.definitionId, { versionId: v2.versionId, fingerprint: v2.fingerprint, action: "validate" });
    service.transition("actor:one", created.definition.definitionId, { versionId: v2.versionId, fingerprint: v2.fingerprint, action: "publish" });
    assert.equal(service.catalog("actor:one").length, 1);
    assert.throws(() => service.createVersion("actor:one", created.definition.definitionId, { parentVersionId: v2.versionId, parentFingerprint: v2.fingerprint, payload: input("illegal"), idempotencyKey: "agent:published-edit" }), /PARENT_VERSION_CONFLICT/);
    const clone = service.clone("actor:one", created.definition.definitionId, { versionId: v2.versionId, fingerprint: v2.fingerprint, idempotencyKey: "agent:clone:001" }); const cloneDefinition = clone.definition; assert.ok(cloneDefinition);
    assert.notEqual(cloneDefinition.definitionId, created.definition.definitionId); assert.equal(cloneDefinition.sourceLineage?.versionId, v2.versionId); assert.equal(service.get("actor:one", cloneDefinition.definitionId).lifecycle.status, "draft");
    const evidence = service.test("actor:one", created.definition.definitionId, { versionId: v2.versionId, fingerprint: v2.fingerprint, fixtureRef: "fixture:market-observation:v1" });
    assert.equal(evidence.adapter, "DETERMINISTIC_TEST_ADAPTER"); assert.equal(service.evidence("actor:one", created.definition.definitionId, v2.versionId).length, 1);
    assert.throws(() => service.test("actor:one", created.definition.definitionId, { versionId: v2.versionId, fingerprint: v2.fingerprint, fixtureRef: "https://injected.invalid" }), /FIXTURE_REF_UNREGISTERED/);
    service.transition("actor:one", created.definition.definitionId, { versionId: v2.versionId, fingerprint: v2.fingerprint, action: "archive" });
    assert.equal(service.get("actor:one", created.definition.definitionId).lifecycle.status, "archived");
  } finally { db.close(); rmSync(folder, { recursive: true, force: true }); }
});
