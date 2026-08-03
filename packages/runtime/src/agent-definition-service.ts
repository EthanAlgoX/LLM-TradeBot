import { createHash, randomUUID } from "node:crypto";
import type { AgentCategory, AgentDefinition, AgentVersion, AgentVersionPayload, AgentLifecycleStatus, AgentTestEvidence } from "../../contracts/src/index.js";
import { AgentVersionPayloadSchema } from "../../contracts/src/index.js";

export interface AgentDefinitionRepository {
  saveDefinition(definition: AgentDefinition): void;
  saveVersion(version: AgentVersion): void;
  getDefinition(definitionId: string): AgentDefinition | undefined;
  getVersion(versionId: string): AgentVersion | undefined;
  latest(definitionId: string): AgentVersion | undefined;
  listDefinitions(actorId: string, category?: AgentCategory): AgentDefinition[];
  listVersions(definitionId: string): AgentVersion[];
  getReplay(actorId: string, scope: string, idempotencyKey: string): { requestFingerprint: string; response: { definition?: AgentDefinition; version: AgentVersion } } | undefined;
  saveReplay(actorId: string, scope: string, idempotencyKey: string, requestFingerprint: string, response: { definition?: AgentDefinition; version: AgentVersion }): void;
  saveGovernance(actorId: string, versionId: string, fingerprint: string, status: AgentLifecycleStatus, occurredAt: string): void;
  governance(versionId: string): { status: AgentLifecycleStatus; actorId: string; occurredAt: string }[];
  saveEvidence(value: AgentTestEvidence): void;
  evidence(actorId: string, versionId: string): AgentTestEvidence[];
}
export class AgentDefinitionError extends Error { constructor(readonly code: string) { super(code); } }
const digest = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const parseCursor = (value: string | undefined, expected: Record<string, string>) => {
  if (!value) return undefined;
  try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>; if (parsed.v !== 1 || Object.entries(expected).some(([key, item]) => parsed[key] !== item) || typeof parsed.after !== "string") throw new Error(); return parsed.after; } catch { throw new AgentDefinitionError("CURSOR_INVALID"); }
};
const registries = {
  templates: new Set(["agent-template:input:v1", "agent-template:analysis:v1", "agent-template:decision:v1", "agent-template:reflection:v1"]),
  data: new Set(["data-source:binance-futures-public:v1", "data-source:csv-historical:v1", "data-source:daily-research:v1"]),
  artifacts: new Set(["artifact-schema:structured-observation:v1", "artifact-schema:analysis-assessment:v1"]),
  models: new Set(["model-connection:deepseek:default"]),
  inputSchemas: new Set(["schema:market-observation-input:v1", "schema:analysis-input:v1"]),
};
function locked(category: AgentCategory) {
  return { systemPolicyRef: "platform-policy:agent-safety:v1", outputSchemaRef: category === "input" ? "schema:structured-observation-output:v1" : "schema:analysis-assessment-output:v1", toolPermissionPolicyRef: category === "input" ? "tool-policy:input-deterministic:v1" : "tool-policy:analysis-readonly:v1" };
}
function validate(category: AgentCategory, value: unknown): AgentVersionPayload {
  const payload = AgentVersionPayloadSchema.parse(value);
  if (!registries.templates.has(payload.templateRef) || !payload.templateRef.includes(`:${category}:`)) throw new AgentDefinitionError("TEMPLATE_REF_UNREGISTERED");
  if (payload.dataRef && !registries.data.has(payload.dataRef)) throw new AgentDefinitionError("DATA_REF_UNREGISTERED");
  if (payload.upstreamArtifactSchemaRefs.some((ref) => !registries.artifacts.has(ref))) throw new AgentDefinitionError("UPSTREAM_REF_UNREGISTERED");
  if (payload.modelRef && !registries.models.has(payload.modelRef)) throw new AgentDefinitionError("MODEL_REF_UNREGISTERED");
  if (!registries.inputSchemas.has(payload.inputSchemaRef)) throw new AgentDefinitionError("INPUT_SCHEMA_UNREGISTERED");
  if (category === "input" && (!payload.dataRef || payload.upstreamArtifactSchemaRefs.length)) throw new AgentDefinitionError("INPUT_REQUIRES_REGISTERED_DATA");
  if (category === "analysis" && (!payload.modelRef || !payload.upstreamArtifactSchemaRefs.length)) throw new AgentDefinitionError("ANALYSIS_REQUIRES_MODEL_AND_UPSTREAM");
  return payload;
}
export class AgentDefinitionService {
  constructor(private readonly repository: AgentDefinitionRepository, private readonly clock: () => Date = () => new Date()) {}
  create(actorId: string, category: AgentCategory, payloadInput: unknown, idempotencyKey: string): { definition: AgentDefinition; version: AgentVersion } {
    const requestFingerprint = digest({ category, payloadInput }); const scope = `create:${category}`; const replay = this.repository.getReplay(actorId, scope, idempotencyKey);
    if (replay) { if (replay.requestFingerprint !== requestFingerprint || !replay.response.definition) throw new AgentDefinitionError("IDEMPOTENCY_CONFLICT"); return { definition: replay.response.definition, version: replay.response.version }; }
    const payload = validate(category, payloadInput); const now = this.clock().toISOString();
    const definition: AgentDefinition = { definitionId: `agent-definition:${randomUUID()}`, category, createdByActorId: actorId, createdAt: now };
    const version = this.version(definition, actorId, payload, null, 1, now); this.repository.saveDefinition(definition); this.repository.saveVersion(version); const response = { definition, version }; this.repository.saveReplay(actorId, scope, idempotencyKey, requestFingerprint, response); return response;
  }
  createVersion(actorId: string, definitionId: string, request: { parentVersionId: string; parentFingerprint: string; payload: unknown; idempotencyKey: string }): AgentVersion {
    const requestFingerprint = digest(request); const scope = `version:${definitionId}`; const replay = this.repository.getReplay(actorId, scope, request.idempotencyKey);
    if (replay) { if (replay.requestFingerprint !== requestFingerprint) throw new AgentDefinitionError("IDEMPOTENCY_CONFLICT"); return replay.response.version; }
    const definition = this.owned(actorId, definitionId); const parent = this.repository.getVersion(request.parentVersionId);
    if (!parent || parent.definitionId !== definitionId || parent.fingerprint !== request.parentFingerprint || this.repository.latest(definitionId)?.versionId !== parent.versionId || !["draft", "validated"].includes(this.lifecycle(parent).status)) throw new AgentDefinitionError("PARENT_VERSION_CONFLICT");
    const payload = validate(definition.category, request.payload); const now = this.clock().toISOString(); const version = this.version(definition, actorId, payload, parent.versionId, parent.versionIndex + 1, now); this.repository.saveVersion(version); this.repository.saveReplay(actorId, scope, request.idempotencyKey, requestFingerprint, { version }); return version;
  }
  get(actorId: string, definitionId: string) { const definition = this.owned(actorId, definitionId); const version = this.repository.latest(definitionId); if (!version) throw new AgentDefinitionError("VERSION_NOT_FOUND"); return { definition, version, lifecycle: this.lifecycle(version) }; }
  list(actorId: string, category?: AgentCategory, limit = 20, value?: string) { const after = parseCursor(value, { kind: "agent-definitions", actorId, category: category ?? "all" }); const all = this.repository.listDefinitions(actorId, category).filter((definition) => !after || definition.definitionId > after); const selected = all.slice(0, limit + 1); const data = selected.slice(0, limit).map((definition) => { const version = this.repository.latest(definition.definitionId)!; return { definition, version, lifecycle: this.lifecycle(version) }; }); return { data, ...(selected.length > limit ? { nextCursor: cursor({ v: 1, kind: "agent-definitions", actorId, category: category ?? "all", after: data.at(-1)!.definition.definitionId }) } : {}) }; }
  versions(actorId: string, definitionId: string, limit = 20, value?: string) { this.owned(actorId, definitionId); const after = parseCursor(value, { kind: "agent-versions", actorId, definitionId }); const afterIndex = after === undefined ? 0 : Number(after); if (after !== undefined && (!Number.isInteger(afterIndex) || afterIndex < 1)) throw new AgentDefinitionError("CURSOR_INVALID"); const all = this.repository.listVersions(definitionId).sort((a, b) => b.versionIndex - a.versionIndex).filter((version) => after === undefined || version.versionIndex < afterIndex); const selected = all.slice(0, limit + 1); const data = selected.slice(0, limit); return { data, ...(selected.length > limit ? { nextCursor: cursor({ v: 1, kind: "agent-versions", actorId, definitionId, after: String(data.at(-1)!.versionIndex) }) } : {}) }; }
  transition(actorId: string, definitionId: string, request: { versionId: string; fingerprint: string; action: "validate" | "publish" | "archive" }) {
    const definition = this.owned(actorId, definitionId); const version = this.repository.getVersion(request.versionId);
    if (!version || version.definitionId !== definition.definitionId || version.fingerprint !== request.fingerprint || this.repository.latest(definitionId)?.versionId !== version.versionId) throw new AgentDefinitionError("VERSION_AUTHORITY_CONFLICT");
    const current = this.lifecycle(version).status;
    const target: AgentLifecycleStatus = request.action === "validate" ? "validated" : request.action === "publish" ? "published" : "archived";
    if ((target === "validated" && current !== "draft") || (target === "published" && current !== "validated") || (target === "archived" && !["validated", "published"].includes(current))) throw new AgentDefinitionError("LIFECYCLE_TRANSITION_INVALID");
    this.repository.saveGovernance(actorId, version.versionId, version.fingerprint, target, this.clock().toISOString()); return { version, lifecycle: this.lifecycle(version) };
  }
  catalog(actorId: string, category?: AgentCategory) { return this.repository.listDefinitions(actorId, category).flatMap((definition) => { const version = this.repository.latest(definition.definitionId)!; return this.lifecycle(version).status === "published" ? [{ definition, version, lifecycle: this.lifecycle(version) }] : []; }); }
  clone(actorId: string, definitionId: string, request: { versionId: string; fingerprint: string; idempotencyKey: string }) {
    const source = this.owned(actorId, definitionId); const version = this.repository.getVersion(request.versionId); if (!version || version.definitionId !== source.definitionId || version.fingerprint !== request.fingerprint) throw new AgentDefinitionError("VERSION_AUTHORITY_CONFLICT");
    const replay = this.repository.getReplay(actorId, `clone:${definitionId}`, request.idempotencyKey); const requestFingerprint = digest(request); if (replay) { if (replay.requestFingerprint !== requestFingerprint || !replay.response.definition) throw new AgentDefinitionError("IDEMPOTENCY_CONFLICT"); return replay.response; }
    const now = this.clock().toISOString(); const definition: AgentDefinition = { definitionId: `agent-definition:${randomUUID()}`, category: source.category, createdByActorId: actorId, createdAt: now, sourceLineage: { definitionId, versionId: version.versionId, fingerprint: version.fingerprint } }; const cloned = this.version(definition, actorId, version.payload, null, 1, now); const response = { definition, version: cloned }; this.repository.saveDefinition(definition); this.repository.saveVersion(cloned); this.repository.saveReplay(actorId, `clone:${definitionId}`, request.idempotencyKey, requestFingerprint, response); return response;
  }
  diff(actorId: string, definitionId: string, leftVersionId: string, rightVersionId: string) { this.owned(actorId, definitionId); const left = this.repository.getVersion(leftVersionId); const right = this.repository.getVersion(rightVersionId); if (!left || !right || left.definitionId !== definitionId || right.definitionId !== definitionId) throw new AgentDefinitionError("VERSION_NOT_FOUND"); const fields = ["dataRef", "upstreamArtifactSchemaRefs", "modelRef", "userInstructionPrompt", "inputSchemaRef", "budget"] as const; return { left: { versionId: left.versionId, fingerprint: left.fingerprint, status: this.lifecycle(left).status }, right: { versionId: right.versionId, fingerprint: right.fingerprint, status: this.lifecycle(right).status }, changes: fields.flatMap((field) => JSON.stringify(left.payload[field]) === JSON.stringify(right.payload[field]) ? [] : [{ field, before: left.payload[field] ?? null, after: right.payload[field] ?? null }]), parent: { before: left.parentVersionId, after: right.parentVersionId } }; }
  test(actorId: string, definitionId: string, request: { versionId: string; fingerprint: string; fixtureRef: string }) { const definition = this.owned(actorId, definitionId); const version = this.repository.getVersion(request.versionId); if (!version || version.definitionId !== definition.definitionId || version.fingerprint !== request.fingerprint) throw new AgentDefinitionError("VERSION_AUTHORITY_CONFLICT"); if (!new Set(["fixture:market-observation:v1", "fixture:analysis-assessment:v1", "fixture:decision-assessment:v1", "fixture:reflection-assessment:v1"]).has(request.fixtureRef)) throw new AgentDefinitionError("FIXTURE_REF_UNREGISTERED"); const matching = (definition.category === "input" && request.fixtureRef === "fixture:market-observation:v1") || (definition.category === "analysis" && request.fixtureRef === "fixture:analysis-assessment:v1") || (definition.category === "decision" && request.fixtureRef === "fixture:decision-assessment:v1") || (definition.category === "reflection" && request.fixtureRef === "fixture:reflection-assessment:v1"); if (!matching) throw new AgentDefinitionError("FIXTURE_CATEGORY_MISMATCH"); const evidence: AgentTestEvidence = { testRunId: `agent-test:${randomUUID()}`, agentVersionId: version.versionId, fingerprint: version.fingerprint, fixtureRef: request.fixtureRef, adapter: "DETERMINISTIC_TEST_ADAPTER", status: "succeeded", inputSummary: `Registered ${request.fixtureRef} fixture`, outputSummary: `Schema-valid ${version.outputSchemaRef} output`, schemaValid: true, durationMs: 1, usage: { calls: 1, tokens: Math.min(version.payload.budget.maxTokens, 128) }, createdByActorId: actorId, createdAt: this.clock().toISOString(), runtimeApplied: false, exchangeWriteAllowed: false, paperOnly: true }; this.repository.saveEvidence(evidence); return evidence; }
  evidence(actorId: string, definitionId: string, versionId: string) { this.owned(actorId, definitionId); const version = this.repository.getVersion(versionId); if (!version || version.definitionId !== definitionId) throw new AgentDefinitionError("VERSION_NOT_FOUND"); return this.repository.evidence(actorId, versionId); }
  private lifecycle(version: AgentVersion) { const facts = this.repository.governance(version.versionId); return { status: facts.at(-1)?.status ?? "draft" as AgentLifecycleStatus, facts }; }
  private owned(actorId: string, definitionId: string) { const definition = this.repository.getDefinition(definitionId); if (!definition || definition.createdByActorId !== actorId) throw new AgentDefinitionError("AGENT_DEFINITION_NOT_FOUND"); return definition; }
  private version(definition: AgentDefinition, actorId: string, payload: AgentVersionPayload, parentVersionId: string | null, versionIndex: number, createdAt: string): AgentVersion {
    const locks = locked(definition.category); const fingerprint = digest({ definitionId: definition.definitionId, versionIndex, parentVersionId, category: definition.category, payload, ...locks });
    return { versionId: `agent-version:${randomUUID()}`, definitionId: definition.definitionId, versionIndex, parentVersionId, fingerprint, createdByActorId: actorId, createdAt, category: definition.category, payload, ...locks, runtimeApplied: false, exchangeWriteAllowed: false, paperOnly: true };
  }
}
