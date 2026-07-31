import {
  PipelineGraphVersionSchema,
  type AgentConfig,
  type AgentTemplate,
  type DataSourceCapability,
  type DataSourceDefinition,
  type MarketPackDefinition,
  type PipelineGraphVersion,
  type PipelineValidationIssue,
  type PipelineValidationResult,
} from "../../contracts/src/index.js";
import { validatePipelineGraph } from "./pipeline-graph-validator.js";

type PipelineValidationContext = Parameters<typeof validatePipelineGraph>[1];

export const PipelinePromotionStage = {
  draft: "draft",
  contractValidated: "contract_validated",
  backtested: "backtested",
  walkForwardValidated: "walk_forward_validated",
  humanApproved: "human_approved",
  paperRunning: "paper_running",
} as const;

export type PipelinePromotionStage =
  (typeof PipelinePromotionStage)[keyof typeof PipelinePromotionStage];

export interface AgentImplementationBinding {
  agentConfigId: string;
  implementationKey: string;
}

export interface PipelineRegistrySeed {
  marketPacks?: readonly MarketPackDefinition[];
  dataSources?: readonly DataSourceDefinition[];
  capabilities?: readonly DataSourceCapability[];
  agentTemplates?: readonly AgentTemplate[];
  agentConfigs?: readonly AgentConfig[];
  implementationBindings?: readonly AgentImplementationBinding[];
}

export class PipelineOrchestrationError extends Error {
  constructor(
    readonly code:
      | "DUPLICATE_REGISTRY_ID"
      | "UNREGISTERED_AGENT_IMPLEMENTATION"
      | "INVALID_PIPELINE_DRAFT"
      | "PIPELINE_VERSION_CONFLICT"
      | "PIPELINE_DRAFT_NOT_FOUND"
      | "PIPELINE_VALIDATION_FAILED"
      | "PROMOTION_OUT_OF_ORDER"
      | "PROMOTION_EVIDENCE_REQUIRED"
      | "HUMAN_APPROVER_REQUIRED",
    message: string,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "PipelineOrchestrationError";
  }
}

const registryIdFields = {
  marketPack: ["marketPackId", "id"],
  dataSource: ["dataSourceId", "id"],
  capability: ["capabilityId", "id"],
  agentTemplate: ["agentTemplateId", "templateId", "id"],
  agentConfig: ["agentConfigId", "configId", "id"],
} as const;

function getStringField(value: unknown, fields: readonly string[]): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const field of fields) {
    const candidate = record[field];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezeDeep(child);
    }
  }
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function calculatePipelineContentFingerprint(graph: PipelineGraphVersion): string {
  let hash = 0x811c9dc5;
  for (const character of stableJson(graph)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function addUnique<T>(
  target: Map<string, T>,
  values: readonly T[],
  fields: readonly string[],
  entityKind: string,
): void {
  for (const value of values) {
    const id = getStringField(value, fields);
    if (!id) {
      throw new PipelineOrchestrationError(
        "DUPLICATE_REGISTRY_ID",
        `Registry entity ${entityKind} has no stable ID.`,
        { entityKind },
      );
    }
    if (target.has(id)) {
      throw new PipelineOrchestrationError(
        "DUPLICATE_REGISTRY_ID",
        `Duplicate ${entityKind} registry ID: ${id}.`,
        { entityKind, entityId: id },
      );
    }
    target.set(id, freezeDeep(clone(value)));
  }
}

export class ImmutablePipelineRegistry {
  readonly marketPacks = new Map<string, MarketPackDefinition>();
  readonly dataSources = new Map<string, DataSourceDefinition>();
  readonly capabilities = new Map<string, DataSourceCapability>();
  readonly agentTemplates = new Map<string, AgentTemplate>();
  readonly agentConfigs = new Map<string, AgentConfig>();
  readonly implementationBindings = new Map<string, string>();

  constructor(seed: PipelineRegistrySeed = {}) {
    addUnique(
      this.marketPacks,
      seed.marketPacks ?? [],
      registryIdFields.marketPack,
      "market_pack",
    );
    addUnique(
      this.dataSources,
      seed.dataSources ?? [],
      registryIdFields.dataSource,
      "data_source",
    );
    addUnique(
      this.capabilities,
      seed.capabilities ?? [],
      registryIdFields.capability,
      "data_source_capability",
    );
    addUnique(
      this.agentTemplates,
      seed.agentTemplates ?? [],
      registryIdFields.agentTemplate,
      "agent_template",
    );
    addUnique(
      this.agentConfigs,
      seed.agentConfigs ?? [],
      registryIdFields.agentConfig,
      "agent_config",
    );

    for (const binding of seed.implementationBindings ?? []) {
      if (this.implementationBindings.has(binding.agentConfigId)) {
        throw new PipelineOrchestrationError(
          "DUPLICATE_REGISTRY_ID",
          `Duplicate implementation binding: ${binding.agentConfigId}.`,
          { entityKind: "implementation_binding", entityId: binding.agentConfigId },
        );
      }
      this.implementationBindings.set(binding.agentConfigId, binding.implementationKey);
    }
  }

  assertGraphImplementationsRegistered(graph: PipelineGraphVersion): void {
    for (const node of graph.nodes) {
      const agentConfigId = getStringField(node, ["agentConfigId", "configId"]);
      if (agentConfigId && !this.implementationBindings.has(agentConfigId)) {
        throw new PipelineOrchestrationError(
          "UNREGISTERED_AGENT_IMPLEMENTATION",
          `Pipeline node ${node.nodeId} references an unregistered implementation.`,
          { nodeId: node.nodeId, agentConfigId },
        );
      }
    }
  }

  toValidationContext(): PipelineValidationContext {
    const capabilities = [...this.capabilities.values()];
    return {
      marketPacks: [...this.marketPacks.values()],
      dataSources: [...this.dataSources.values()],
      capabilities,
      dataSourceCapabilities: capabilities,
      agentTemplates: [...this.agentTemplates.values()],
      agentConfigs: [...this.agentConfigs.values()],
    } as unknown as PipelineValidationContext;
  }
}

export interface StoredPipelineDraft {
  draftId: string;
  graphId: string;
  humanVersion: string;
  contentFingerprint: string;
  graph: PipelineGraphVersion;
  promotionStage: PipelinePromotionStage;
  promotionEvidence: readonly PipelinePromotionEvidence[];
  runtimeApplied: false;
}

export interface PipelinePromotionEvidence {
  stage: Exclude<PipelinePromotionStage, "draft">;
  evidenceRef: string;
  recordedAt: string;
  actorId?: string;
}

export interface PipelineDraftRepository {
  save(rawGraph: unknown): StoredPipelineDraft;
  get(draftId: string): StoredPipelineDraft;
  replacePromotionState(
    draftId: string,
    promotionStage: PipelinePromotionStage,
    evidence: readonly PipelinePromotionEvidence[],
  ): StoredPipelineDraft;
}

function graphIdentity(graph: PipelineGraphVersion): {
  graphId: string;
  humanVersion: string;
} {
  return {
    graphId:
      getStringField(graph, ["graphId", "pipelineGraphId", "id"]) ??
      "pipeline-graph:unknown",
    humanVersion:
      getStringField(graph, ["humanVersion", "humanReadableVersion", "version"]) ??
      "unversioned",
  };
}

function draftKey(graphId: string, humanVersion: string): string {
  return `${graphId}@${humanVersion}`;
}

const promotionOrder: readonly PipelinePromotionStage[] = [
  PipelinePromotionStage.draft,
  PipelinePromotionStage.contractValidated,
  PipelinePromotionStage.backtested,
  PipelinePromotionStage.walkForwardValidated,
  PipelinePromotionStage.humanApproved,
  PipelinePromotionStage.paperRunning,
];

export class InMemoryPipelineDraftRepository implements PipelineDraftRepository {
  private readonly drafts = new Map<string, StoredPipelineDraft>();

  save(rawGraph: unknown): StoredPipelineDraft {
    const parsed = PipelineGraphVersionSchema.safeParse(rawGraph);
    if (!parsed.success) {
      throw new PipelineOrchestrationError(
        "INVALID_PIPELINE_DRAFT",
        "Pipeline draft does not satisfy the graph contract.",
        { zodIssueCount: String(parsed.error.issues.length) },
      );
    }

    const graph = freezeDeep(clone(parsed.data));
    const { graphId, humanVersion } = graphIdentity(graph);
    const key = draftKey(graphId, humanVersion);
    const contentFingerprint = calculatePipelineContentFingerprint(graph);
    const existing = this.drafts.get(key);

    if (existing) {
      if (existing.contentFingerprint !== contentFingerprint) {
        throw new PipelineOrchestrationError(
          "PIPELINE_VERSION_CONFLICT",
          "A graph version is immutable once stored.",
          { graphId, humanVersion },
        );
      }
      return clone(existing);
    }

    const stored = freezeDeep({
      draftId: key,
      graphId,
      humanVersion,
      contentFingerprint,
      graph,
      promotionStage: PipelinePromotionStage.draft,
      promotionEvidence: [],
      runtimeApplied: false as const,
    });
    this.drafts.set(key, stored);
    return clone(stored);
  }

  get(draftId: string): StoredPipelineDraft {
    const stored = this.drafts.get(draftId);
    if (!stored) {
      throw new PipelineOrchestrationError(
        "PIPELINE_DRAFT_NOT_FOUND",
        `Pipeline draft ${draftId} was not found.`,
        { draftId },
      );
    }
    return clone(stored);
  }

  replacePromotionState(
    draftId: string,
    promotionStage: PipelinePromotionStage,
    evidence: readonly PipelinePromotionEvidence[],
  ): StoredPipelineDraft {
    const current = this.get(draftId);
    const replacement = freezeDeep({
      ...current,
      promotionStage,
      promotionEvidence: clone(evidence),
      runtimeApplied: false as const,
    });
    this.drafts.set(draftId, replacement);
    return clone(replacement);
  }
}

export interface CompiledPipelineStep {
  index: number;
  nodeId: string;
  agentConfigId?: string;
  predecessorNodeIds: readonly string[];
  successorNodeIds: readonly string[];
}

export interface CompiledPipelinePlan {
  graphId: string;
  humanVersion: string;
  graphFingerprint: string;
  steps: readonly CompiledPipelineStep[];
  runtimeApplied: false;
}

export type PipelineGraphValidator = (
  graph: PipelineGraphVersion,
) => PipelineValidationResult;

export class PipelineGraphCompiler {
  constructor(
    private readonly registry: ImmutablePipelineRegistry,
    private readonly validator: PipelineGraphValidator,
  ) {}

  compile(graph: PipelineGraphVersion): CompiledPipelinePlan {
    this.registry.assertGraphImplementationsRegistered(graph);
    const validation = this.validator(graph);
    if (!validation.valid) {
      throw new PipelineOrchestrationError(
        "PIPELINE_VALIDATION_FAILED",
        "Pipeline graph validation failed before compilation.",
        { issueCount: String(validation.issues.length) },
      );
    }

    const nodeIndex = new Map(graph.nodes.map((node, index) => [node.nodeId, index]));
    const predecessors = new Map<string, Set<string>>();
    const successors = new Map<string, Set<string>>();
    const indegree = new Map(graph.nodes.map((node) => [node.nodeId, 0]));

    for (const node of graph.nodes) {
      predecessors.set(node.nodeId, new Set());
      successors.set(node.nodeId, new Set());
    }

    for (const edge of graph.edges) {
      const sourceNodeId = getStringField(edge, [
        "sourceNodeId",
        "fromNodeId",
        "source",
      ]);
      const targetNodeId = getStringField(edge, [
        "targetNodeId",
        "toNodeId",
        "target",
      ]);
      if (!sourceNodeId || !targetNodeId) {
        continue;
      }
      if (!successors.get(sourceNodeId)?.has(targetNodeId)) {
        successors.get(sourceNodeId)?.add(targetNodeId);
        predecessors.get(targetNodeId)?.add(sourceNodeId);
        indegree.set(targetNodeId, (indegree.get(targetNodeId) ?? 0) + 1);
      }
    }

    const ready = graph.nodes
      .filter((node) => indegree.get(node.nodeId) === 0)
      .map((node) => node.nodeId);
    const orderedNodeIds: string[] = [];

    while (ready.length > 0) {
      ready.sort((left, right) => (nodeIndex.get(left) ?? 0) - (nodeIndex.get(right) ?? 0));
      const nodeId = ready.shift();
      if (!nodeId) {
        break;
      }
      orderedNodeIds.push(nodeId);
      for (const successor of successors.get(nodeId) ?? []) {
        const nextIndegree = (indegree.get(successor) ?? 1) - 1;
        indegree.set(successor, nextIndegree);
        if (nextIndegree === 0) {
          ready.push(successor);
        }
      }
    }

    if (orderedNodeIds.length !== graph.nodes.length) {
      throw new PipelineOrchestrationError(
        "PIPELINE_VALIDATION_FAILED",
        "Pipeline graph cannot compile because a cycle remains.",
        { issueCount: "1" },
      );
    }

    const nodesById = new Map(graph.nodes.map((node) => [node.nodeId, node]));
    const { graphId, humanVersion } = graphIdentity(graph);
    return freezeDeep({
      graphId,
      humanVersion,
      graphFingerprint: calculatePipelineContentFingerprint(graph),
      steps: orderedNodeIds.map((nodeId, index) => {
        const node = nodesById.get(nodeId);
        return {
          index,
          nodeId,
          agentConfigId: node
            ? getStringField(node, ["agentConfigId", "configId"])
            : undefined,
          predecessorNodeIds: [...(predecessors.get(nodeId) ?? [])],
          successorNodeIds: [...(successors.get(nodeId) ?? [])],
        };
      }),
      runtimeApplied: false as const,
    });
  }
}

export class PipelineOrchestrationService {
  constructor(
    private readonly repository: PipelineDraftRepository,
    private readonly compiler: PipelineGraphCompiler,
    private readonly validator: PipelineGraphValidator,
  ) {}

  createDraft(rawGraph: unknown): StoredPipelineDraft {
    return this.repository.save(rawGraph);
  }

  validateDraft(draftId: string): PipelineValidationResult {
    return this.validator(this.repository.get(draftId).graph);
  }

  getDraft(draftId: string): StoredPipelineDraft {
    return this.repository.get(draftId);
  }

  compileDraft(draftId: string): CompiledPipelinePlan {
    return this.compiler.compile(this.repository.get(draftId).graph);
  }

  promote(
    draftId: string,
    targetStage: Exclude<PipelinePromotionStage, "draft">,
    evidenceRef: string,
    recordedAt: string,
    actorId?: string,
  ): StoredPipelineDraft {
    const current = this.repository.get(draftId);
    const currentIndex = promotionOrder.indexOf(current.promotionStage);
    const expected = promotionOrder[currentIndex + 1];
    if (targetStage !== expected) {
      throw new PipelineOrchestrationError(
        "PROMOTION_OUT_OF_ORDER",
        `Expected promotion to ${expected ?? "none"}, received ${targetStage}.`,
        { currentStage: current.promotionStage, targetStage },
      );
    }
    if (!evidenceRef.trim()) {
      throw new PipelineOrchestrationError(
        "PROMOTION_EVIDENCE_REQUIRED",
        "Promotion evidence is required.",
        { targetStage },
      );
    }
    if (targetStage === PipelinePromotionStage.contractValidated) {
      const validation = this.validator(current.graph);
      if (!validation.valid) {
        throw new PipelineOrchestrationError(
          "PIPELINE_VALIDATION_FAILED",
          "Contract validation must pass before promotion.",
          { issueCount: String(validation.issues.length) },
        );
      }
    }
    if (targetStage === PipelinePromotionStage.humanApproved && !actorId?.trim()) {
      throw new PipelineOrchestrationError(
        "HUMAN_APPROVER_REQUIRED",
        "Human approval requires an actor ID.",
        { targetStage },
      );
    }

    const evidence: PipelinePromotionEvidence = {
      stage: targetStage,
      evidenceRef,
      recordedAt,
      ...(actorId ? { actorId } : {}),
    };
    return this.repository.replacePromotionState(
      draftId,
      targetStage,
      [...current.promotionEvidence, evidence],
    );
  }
}

export function machineIssueCodes(
  result: PipelineValidationResult,
): readonly PipelineValidationIssue["code"][] {
  return result.issues.map((issue) => issue.code);
}
