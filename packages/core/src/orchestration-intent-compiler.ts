import {
  CompiledOrchestrationIntentSchema,
  OrchestrationIntentRequestSchema,
  type CompiledOrchestrationIntent,
  type OrchestrationIntentErrorCode,
  type OrchestrationIntentObservationWindow,
  type OrchestrationIntentRequest,
  type PipelineGraphVersion,
  type PipelineValidationResult,
  type SemanticPipelinePresetDefinition,
} from "../../contracts/src/index.js";
import {
  type ImmutablePipelineRegistry,
  type PipelineOrchestrationService,
  type StoredPipelineDraft,
} from "./pipeline-orchestration.js";
import type { RegisteredSemanticPipelinePresetCatalog } from "./semantic-pipeline-presets.js";

export interface OrchestrationPresetGraphBinding {
  presetId: string;
  graph: PipelineGraphVersion;
  marketPackIds: readonly string[];
  dataSourceIds: readonly string[];
}

export interface OrchestrationIntentCompilerDependencies {
  registry: ImmutablePipelineRegistry;
  presets: RegisteredSemanticPipelinePresetCatalog;
  bindings: readonly OrchestrationPresetGraphBinding[];
  validateGraph(graph: PipelineGraphVersion): PipelineValidationResult;
  now?: () => string;
}

export interface OrchestrationIntentCatalogEntry {
  preset: SemanticPipelinePresetDefinition;
  compilationAvailable: boolean;
  blockerCodes: readonly OrchestrationIntentErrorCode[];
}

export interface OrchestrationIntentCompilation {
  intent: CompiledOrchestrationIntent;
  preset: SemanticPipelinePresetDefinition;
  graph: PipelineGraphVersion;
  validation: PipelineValidationResult;
  runtimeApplied: false;
}

export interface OrchestrationIntentDraftResult
  extends Omit<OrchestrationIntentCompilation, "graph"> {
  draft: StoredPipelineDraft;
}

export class OrchestrationIntentError extends Error {
  constructor(
    readonly code: OrchestrationIntentErrorCode,
    message: string,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "OrchestrationIntentError";
  }
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

function fingerprint(value: unknown): string {
  let hash = 0x811c9dc5;
  for (const character of stableJson(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function exactSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((item) => expected.has(item));
}

function windowKey(window: OrchestrationIntentObservationWindow): string {
  return `${window.kind}:${window.value}:${window.unit}`;
}

export class OrchestrationIntentCompiler {
  private readonly bindings: ReadonlyMap<string, OrchestrationPresetGraphBinding>;
  private readonly now: () => string;

  constructor(private readonly dependencies: OrchestrationIntentCompilerDependencies) {
    this.bindings = new Map(
      dependencies.bindings.map((binding) => [binding.presetId, binding]),
    );
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  catalog(): readonly OrchestrationIntentCatalogEntry[] {
    return this.dependencies.presets.list().map((preset) => {
      const blockerCodes: OrchestrationIntentErrorCode[] = [];
      if (preset.availability !== "registered_available") {
        blockerCodes.push("PRESET_CAPABILITY_REQUIRED");
      }
      if (!this.bindings.has(preset.id)) {
        blockerCodes.push("PRESET_GRAPH_BINDING_NOT_REGISTERED");
      }
      return {
        preset,
        compilationAvailable: blockerCodes.length === 0,
        blockerCodes,
      };
    });
  }

  compile(rawRequest: unknown): OrchestrationIntentCompilation {
    const parsed = OrchestrationIntentRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new OrchestrationIntentError(
        "INVALID_ORCHESTRATION_INTENT",
        "Orchestration intent does not satisfy the strict request contract.",
        { zodIssueCount: String(parsed.error.issues.length) },
      );
    }
    const request = parsed.data;
    const preset = this.dependencies.presets.get(request.presetId);
    if (!preset) {
      throw new OrchestrationIntentError(
        "SEMANTIC_PRESET_NOT_REGISTERED",
        "The requested semantic Pipeline preset is not registered.",
        { presetId: request.presetId },
      );
    }
    if (preset.availability !== "registered_available") {
      throw new OrchestrationIntentError(
        "PRESET_CAPABILITY_REQUIRED",
        "The requested preset is expressible but its backend capability is not registered.",
        {
          presetId: preset.id,
          requiredCapabilityKinds: preset.requiredCapabilityKinds.join(","),
        },
      );
    }
    const binding = this.bindings.get(preset.id);
    if (!binding) {
      throw new OrchestrationIntentError(
        "PRESET_GRAPH_BINDING_NOT_REGISTERED",
        "The requested preset has no registered executable Graph binding.",
        { presetId: preset.id },
      );
    }
    if (!this.dependencies.registry.marketPacks.has(request.marketPackId)) {
      throw new OrchestrationIntentError(
        "MARKET_PACK_NOT_REGISTERED",
        "The requested Market Pack is not registered.",
        { marketPackId: request.marketPackId },
      );
    }
    if (!binding.marketPackIds.includes(request.marketPackId)) {
      throw new OrchestrationIntentError(
        "MARKET_PACK_NOT_SUPPORTED_BY_PRESET",
        "The requested Market Pack is not supported by the registered preset binding.",
        { marketPackId: request.marketPackId, presetId: preset.id },
      );
    }
    for (const dataSourceId of request.dataSourceIds) {
      if (!this.dependencies.registry.dataSources.has(dataSourceId)) {
        throw new OrchestrationIntentError(
          "DATA_SOURCE_NOT_REGISTERED",
          "The requested Data Source is not registered.",
          { dataSourceId },
        );
      }
    }
    if (!exactSet(request.dataSourceIds, binding.dataSourceIds)) {
      throw new OrchestrationIntentError(
        "DATA_SOURCE_SET_NOT_SUPPORTED_BY_GRAPH",
        "The registered Graph cannot accurately represent the requested Data Source set.",
        {
          presetId: preset.id,
          requestedDataSourceIds: request.dataSourceIds.join(","),
          supportedDataSourceIds: binding.dataSourceIds.join(","),
        },
      );
    }
    const requestedWindowKeys = request.observationWindows.map(windowKey);
    const supportedWindowKeys = preset.observationWindows.map(windowKey);
    if (!exactSet(requestedWindowKeys, supportedWindowKeys)) {
      throw new OrchestrationIntentError(
        "OBSERVATION_WINDOW_SET_NOT_SUPPORTED_BY_GRAPH",
        "The registered Graph cannot accurately represent the requested Observation Window set.",
        {
          presetId: preset.id,
          requestedWindows: requestedWindowKeys.join(","),
          supportedWindows: supportedWindowKeys.join(","),
        },
      );
    }

    const graphTemplateIds = new Set<string>();
    for (const node of binding.graph.nodes) {
      const config = this.dependencies.registry.agentConfigs.get(node.agentConfigId);
      if (config) graphTemplateIds.add(config.templateId);
    }
    for (const templateId of request.requiredAgentTemplateIds) {
      if (!this.dependencies.registry.agentTemplates.has(templateId)) {
        throw new OrchestrationIntentError(
          "AGENT_TEMPLATE_NOT_REGISTERED",
          "A required Agent Template is not registered.",
          { templateId },
        );
      }
      if (!graphTemplateIds.has(templateId)) {
        throw new OrchestrationIntentError(
          "AGENT_TEMPLATE_NOT_IN_PRESET",
          "A required Agent Template is not part of the registered preset Graph.",
          { templateId, presetId: preset.id },
        );
      }
    }

    const validation = this.dependencies.validateGraph(binding.graph);
    if (!validation.valid) {
      throw new OrchestrationIntentError(
        "INTENT_GRAPH_VALIDATION_FAILED",
        "The registered Graph failed authoritative validation.",
        {
          presetId: preset.id,
          issueCodes: validation.issues.map((issue) => issue.code).join(","),
        },
      );
    }

    const agentTemplateRefs = [...graphTemplateIds]
      .sort()
      .map((templateId) => {
        const template = this.dependencies.registry.agentTemplates.get(templateId)!;
        return {
          id: template.templateId,
          version: template.humanReadableVersion,
          fingerprint: template.fingerprint,
        };
      });
    const normalizedRequest: OrchestrationIntentRequest = request;
    const intent = CompiledOrchestrationIntentSchema.parse({
      schemaVersion: "1.0.0",
      intentId: `orchestration-intent:${request.requestId}`,
      humanReadableVersion: "1.0.0",
      fingerprint: fingerprint({
        request: normalizedRequest,
        presetFingerprint: preset.fingerprint,
        graphFingerprint: binding.graph.fingerprint,
      }),
      lifecycleStatus: "draft",
      createdAt: this.now(),
      schemaRefs: ["tradebot.orchestration-intent.v1"],
      presetRef: {
        id: preset.id,
        version: preset.version,
        fingerprint: preset.fingerprint,
      },
      graphRef: {
        id: binding.graph.pipelineGraphId,
        version: binding.graph.humanReadableVersion,
        fingerprint: binding.graph.fingerprint,
      },
      marketPackId: request.marketPackId,
      dataSourceIds: request.dataSourceIds,
      observationWindows: request.observationWindows,
      agentTemplateRefs,
      releaseGates: [
        "contract_validation",
        "backtest",
        "walk_forward",
        "human_approval",
        "paper_running",
      ],
      runtimeMutationAllowed: false,
    });
    return {
      intent,
      preset,
      graph: binding.graph,
      validation,
      runtimeApplied: false,
    };
  }
}

export class OrchestrationIntentDraftService {
  constructor(
    private readonly compiler: OrchestrationIntentCompiler,
    private readonly pipelineService: PipelineOrchestrationService,
  ) {}

  catalog(): readonly OrchestrationIntentCatalogEntry[] {
    return this.compiler.catalog();
  }

  createDraft(rawRequest: unknown): OrchestrationIntentDraftResult {
    const compilation = this.compiler.compile(rawRequest);
    return {
      intent: compilation.intent,
      preset: compilation.preset,
      validation: compilation.validation,
      draft: this.pipelineService.createDraft(compilation.graph),
      runtimeApplied: false,
    };
  }
}
