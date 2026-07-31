import { createHash } from "node:crypto";

import {
  SemanticPipelinePreviewCommandSchema,
  SemanticPipelinePreviewSchema,
  type SemanticPipelinePreview,
} from "../../contracts/src/index.js";
import type { ConfigurationDraftRepository, ConfigurationDraftService } from "./configuration-draft-service.js";

type UnknownRegistry = Readonly<{
  marketPacks: ReadonlyMap<string, unknown>;
  dataSources: ReadonlyMap<string, unknown>;
  capabilities: ReadonlyMap<string, unknown>;
  agentTemplates: ReadonlyMap<string, unknown>;
}>;

interface RegisteredRef {
  id: string;
  humanVersion: string;
  fingerprint: string;
}

function hash(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringField(value: unknown, keys: readonly string[], fallback: string): string {
  const item = record(value);
  for (const key of keys) {
    if (typeof item[key] === "string" && item[key] !== "") return item[key] as string;
  }
  return fallback;
}

function registeredRef(id: string, value: unknown): RegisteredRef {
  return {
    id: stringField(value, ["id"], id),
    humanVersion: stringField(value, ["humanVersion", "version"], "v1"),
    fingerprint: stringField(value, ["fingerprint"], hash({ id, value })),
  };
}

export class ConfigurableSemanticPipelineError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export class ConfigurableSemanticPipelineService {
  private readonly idempotency = new Map<string, { configurationVersionId: string; response: SemanticPipelinePreview }>();

  constructor(
    private readonly configurations: ConfigurationDraftService,
    private readonly repository: ConfigurationDraftRepository,
    private readonly registry: UnknownRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  preview(rawCommand: unknown, actorId: string): SemanticPipelinePreview {
    const command = SemanticPipelinePreviewCommandSchema.parse(rawCommand);
    const idempotencyId = `${actorId}:${command.idempotencyKey}`;
    const replay = this.idempotency.get(idempotencyId);
    if (replay) {
      if (replay.configurationVersionId !== command.configurationVersionId) {
        throw new ConfigurableSemanticPipelineError("SEMANTIC_PIPELINE_IDEMPOTENCY_CONFLICT");
      }
      return replay.response;
    }

    const strategy = this.configurations.get(command.configurationVersionId);
    if (strategy.payload.kind !== "strategy") {
      throw new ConfigurableSemanticPipelineError("SEMANTIC_PIPELINE_STRATEGY_CONFIGURATION_REQUIRED");
    }
    const marketPack = this.registry.marketPacks.get(strategy.payload.marketPackId);
    if (!marketPack) throw new ConfigurableSemanticPipelineError("MARKET_PACK_NOT_REGISTERED");

    const issueCodes = new Set<string>(this.configurations.validate(strategy.versionId).issues.map((issue) => issue.code));
    const agents: SemanticPipelinePreview["agents"] = [];
    for (const agentDraftId of strategy.payload.agentConfigurationDraftIds) {
      const agent = this.repository.latest(agentDraftId);
      if (agent.payload.kind !== "agent") {
        issueCodes.add("AGENT_CONFIGURATION_KIND_INVALID");
        continue;
      }
      for (const issue of this.configurations.validate(agent.versionId).issues) issueCodes.add(issue.code);
      if (agent.payload.marketPackId !== strategy.payload.marketPackId) issueCodes.add("AGENT_MARKET_PACK_MISMATCH");

      const template = this.registry.agentTemplates.get(agent.payload.agentTemplateId);
      if (!template) {
        issueCodes.add("AGENT_TEMPLATE_NOT_REGISTERED");
        continue;
      }
      const dataSourceRefs: SemanticPipelinePreview["agents"][number]["dataSourceRefs"] = [];
      for (const dataSourceId of agent.payload.dataSourceIds) {
        const source = this.registry.dataSources.get(dataSourceId);
        if (!source) {
          issueCodes.add("DATA_SOURCE_NOT_REGISTERED");
          continue;
        }
        const sourceRecord = record(source);
        const explicitCapabilityIds = Array.isArray(sourceRecord.capabilityIds)
          ? sourceRecord.capabilityIds.filter((id): id is string => typeof id === "string")
          : [];
        const discoveredCapabilityIds = [...this.registry.capabilities.entries()]
          .filter(([, capability]) => {
            const item = record(capability);
            return item.dataSourceId === dataSourceId || item.sourceDefinitionId === dataSourceId;
          })
          .map(([id]) => id);
        const capabilityIds = [...new Set([...explicitCapabilityIds, ...discoveredCapabilityIds])];
        dataSourceRefs.push({
          ...registeredRef(dataSourceId, source),
          capabilityRefs: capabilityIds.map((id) => registeredRef(id, this.registry.capabilities.get(id))),
        });
      }
      agents.push({
        configurationRef: { id: agent.versionId, humanVersion: agent.humanVersion, fingerprint: agent.fingerprint },
        templateRef: registeredRef(agent.payload.agentTemplateId, template),
        dataSourceRefs,
        observationWindows: agent.payload.observationWindows.map((window) => ({
          id: `window:${hash(window).slice("sha256:".length, 33)}`,
          kind: window.kind,
          description: JSON.stringify(window),
        })),
        inputArtifactType: "market_observation",
        outputArtifactType: "agent_semantic_assessment",
      });
    }

    const valid = issueCodes.size === 0;
    const response = SemanticPipelinePreviewSchema.parse({
      schemaVersion: "1.0.0",
      previewId: `semantic-preview:${hash({ actorId, command }).slice("sha256:".length, 33)}`,
      humanVersion: strategy.humanVersion,
      fingerprint: hash({ strategyFingerprint: strategy.fingerprint, agentFingerprints: agents.map((agent) => agent.configurationRef.fingerprint) }),
      createdAt: this.now().toISOString(),
      lifecycleStatus: valid ? "ready" : "validation_failed",
      strategyConfigurationRef: { id: strategy.versionId, humanVersion: strategy.humanVersion, fingerprint: strategy.fingerprint },
      marketPackRef: registeredRef(strategy.payload.marketPackId, marketPack),
      agents,
      validation: { valid, issueCodes: [...issueCodes].sort() },
      nextGate: valid ? "registered_semantic_input_execution" : "configuration_validation",
      clientDataAccepted: false,
      clientAgentImplementationAccepted: false,
      decisionContextCreated: false,
      runtimeApplied: false,
      exchangeWriteAllowed: false,
    });
    this.idempotency.set(idempotencyId, { configurationVersionId: command.configurationVersionId, response });
    return response;
  }
}
