import { createHash, randomUUID } from "node:crypto";
import type { ConnectionDefinition, ConnectionKind, ConnectionVersion } from "../../contracts/src/index.js";

export interface ConnectionRepository { saveDefinition(value: ConnectionDefinition): void; saveVersion(value: ConnectionVersion): void; list(actorId: string, kind?: ConnectionKind): Array<{ definition: ConnectionDefinition; version: ConnectionVersion }>; }
export class ConnectionError extends Error { constructor(readonly code: string) { super(code); } }
const digest = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const registered: Record<string, Omit<ConnectionVersion, "versionId" | "definitionId" | "versionIndex" | "fingerprint" | "createdByActorId" | "createdAt">> = {
  "data-source:binance-futures-public": { kind: "data_source", registeredRef: "data-source:binance-futures-public", name: "Binance Futures Public", capabilityRefs: ["capability:binance-futures-public:ohlcv:v1"], health: "healthy", secretReferenceStatus: "not_required", impact: { agentDefinitionCount: 0, strategyReferenceCount: 0 }, runtimeApplied: false, exchangeWriteAllowed: false, paperOnly: true },
  "data-source:csv-historical": { kind: "data_source", registeredRef: "data-source:csv-historical", name: "CSV Historical Source", capabilityRefs: ["capability:csv-historical:ohlcv:v1"], health: "healthy", secretReferenceStatus: "not_required", impact: { agentDefinitionCount: 0, strategyReferenceCount: 0 }, runtimeApplied: false, exchangeWriteAllowed: false, paperOnly: true },
  "data-source:daily-research": { kind: "data_source", registeredRef: "data-source:daily-research", name: "Registered Daily Research Source", capabilityRefs: ["capability:daily-research:ohlcv:v1"], health: "healthy", secretReferenceStatus: "not_required", impact: { agentDefinitionCount: 0, strategyReferenceCount: 0 }, runtimeApplied: false, exchangeWriteAllowed: false, paperOnly: true },
  "model-connection:deepseek:default": { kind: "model_adapter", registeredRef: "model-connection:deepseek:default", name: "DeepSeek deterministic adapter", capabilityRefs: ["model-adapter:deepseek:structured:v1"], health: "not_configured", secretReferenceStatus: "unavailable", impact: { agentDefinitionCount: 0, strategyReferenceCount: 0 }, runtimeApplied: false, exchangeWriteAllowed: false, paperOnly: true },
};
export class ConnectionService {
  constructor(private readonly repository: ConnectionRepository, private readonly clock: () => Date = () => new Date()) {}
  materialize(actorId: string, kind: ConnectionKind, registeredRef: string) {
    const spec = registered[registeredRef];
    if (!spec || spec.kind !== kind) throw new ConnectionError("CONNECTION_REF_UNREGISTERED");
    const existing = this.repository.list(actorId, kind).find((item) => item.version.registeredRef === registeredRef); if (existing) return existing;
    const createdAt = this.clock().toISOString(); const definition: ConnectionDefinition = { definitionId: `connection-definition:${randomUUID()}`, kind, createdByActorId: actorId, createdAt };
    const fingerprint = digest({ definitionId: definition.definitionId, registeredRef, spec });
    const version: ConnectionVersion = { ...spec, versionId: `connection-version:${randomUUID()}`, definitionId: definition.definitionId, versionIndex: 1, fingerprint, createdByActorId: actorId, createdAt };
    this.repository.saveDefinition(definition); this.repository.saveVersion(version); return { definition, version };
  }
  list(actorId: string, kind?: ConnectionKind) { return this.repository.list(actorId, kind); }
}
