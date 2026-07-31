import { createHash } from "node:crypto";

import {
  HistoricalGraphExecutionPlanSchema,
  type PipelineGraphVersion,
  type SemanticPresetNodeRole,
} from "../../contracts/src/index.js";
import {
  calculateHistoricalGraphPlanFingerprint,
  HistoricalGraphExecutionError,
  RegisteredHistoricalArtifactSchemaRegistry,
  RegisteredHistoricalGraphPlanRegistry,
  RegisteredHistoricalNodeExecutorRegistry,
} from "./historical-graph-executor.js";
import {
  calculatePipelineContentFingerprint,
  type CompiledPipelinePlan,
} from "./pipeline-orchestration.js";

interface RegistryMarketPack {
  marketPackId: string;
  humanReadableVersion: string;
  fingerprint: string;
}

interface RegistryAgentConfig {
  agentConfigId: string;
  templateId: string;
  templateVersion: string;
  observationRequests: Array<{
    dataSourceId: string;
    portId: string;
    window: { kind: string; unit: string; value: number };
  }>;
}

interface RegistryAgentTemplatePort {
  portId: string;
  schemaRefs: string[];
  required?: boolean;
}

interface RegistryAgentTemplate {
  templateId: string;
  humanReadableVersion: string;
  role: string;
  inputPorts: RegistryAgentTemplatePort[];
  outputPorts: RegistryAgentTemplatePort[];
}

function historicalReferenceFingerprint(value: string): `sha256:${string}` {
  if (/^sha256:[a-f0-9]{64}$/u.test(value)) {
    return value as `sha256:${string}`;
  }
  if (/^[a-f0-9]{64}$/u.test(value)) {
    return `sha256:${value}`;
  }
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export interface PipelineGraphHistoricalBridgeRegistry {
  marketPacks: ReadonlyMap<string, unknown>;
  agentConfigs: ReadonlyMap<string, unknown>;
  agentTemplates: ReadonlyMap<string, unknown>;
  implementationBindings: ReadonlyMap<string, string>;
}

export interface HistoricalImplementationExecutorBinding {
  implementationKey: string;
  executorId: string;
}

export class PipelineGraphHistoricalBridgeError extends Error {
  constructor(
    readonly code:
      | "COMPILER_GRAPH_ID_MISMATCH"
      | "COMPILER_GRAPH_VERSION_MISMATCH"
      | "COMPILER_GRAPH_FINGERPRINT_MISMATCH"
      | "COMPILER_NODE_SET_MISMATCH"
      | "REGISTRY_REFERENCE_MISSING"
      | "TEMPLATE_VERSION_MISMATCH"
      | "PORT_SCHEMA_MISSING"
      | "PORT_SCHEMA_MISMATCH"
      | "IMPLEMENTATION_BINDING_MISSING"
      | "EXECUTOR_BINDING_MISSING"
      | "EXECUTION_ROLE_UNSUPPORTED"
      | "FEEDBACK_GRAPH_NOT_HISTORICAL"
      | "FALLBACK_EDGE_INVALID",
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(code);
    this.name = "PipelineGraphHistoricalBridgeError";
  }
}

function asMarketPack(value: unknown, marketPackRef: string): RegistryMarketPack {
  if (!value || typeof value !== "object") {
    throw new PipelineGraphHistoricalBridgeError("REGISTRY_REFERENCE_MISSING", { marketPackRef });
  }
  const marketPack = value as Partial<RegistryMarketPack>;
  if (!marketPack.marketPackId || !marketPack.humanReadableVersion || !marketPack.fingerprint) {
    throw new PipelineGraphHistoricalBridgeError("REGISTRY_REFERENCE_MISSING", { marketPackRef });
  }
  return marketPack as RegistryMarketPack;
}

function asAgentConfig(value: unknown, agentConfigId: string): RegistryAgentConfig {
  if (!value || typeof value !== "object") {
    throw new PipelineGraphHistoricalBridgeError("REGISTRY_REFERENCE_MISSING", { agentConfigId });
  }
  const config = value as Partial<RegistryAgentConfig>;
  if (!config.agentConfigId || !config.templateId || !config.templateVersion || !Array.isArray(config.observationRequests)) {
    throw new PipelineGraphHistoricalBridgeError("REGISTRY_REFERENCE_MISSING", { agentConfigId });
  }
  return config as RegistryAgentConfig;
}

function asAgentTemplate(value: unknown, agentTemplateId: string): RegistryAgentTemplate {
  if (!value || typeof value !== "object") {
    throw new PipelineGraphHistoricalBridgeError("REGISTRY_REFERENCE_MISSING", { agentTemplateId });
  }
  const template = value as Partial<RegistryAgentTemplate>;
  if (!template.templateId || !template.humanReadableVersion || !template.role || !Array.isArray(template.inputPorts) || !Array.isArray(template.outputPorts)) {
    throw new PipelineGraphHistoricalBridgeError("REGISTRY_REFERENCE_MISSING", { agentTemplateId });
  }
  return template as RegistryAgentTemplate;
}

function semanticRole(role: string): SemanticPresetNodeRole {
  const normalized: Readonly<Record<string, SemanticPresetNodeRole>> = {
    selector: "selector",
    data_sync: "data_sync",
    data_quality: "data_quality",
    analysis: "window_analysis",
    window_analysis: "window_analysis",
    bull: "bull_research",
    bull_case: "bull_research",
    bull_research: "bull_research",
    bear: "bear_research",
    bear_case: "bear_research",
    bear_research: "bear_research",
    research_synthesis: "research_synthesis",
    decision: "decision",
    portfolio: "portfolio",
    risk: "risk",
    execution: "execution",
    position_monitor: "position_monitor",
    reflection: "reflection",
  };
  const mapped = normalized[role];
  if (!mapped) throw new PipelineGraphHistoricalBridgeError("EXECUTION_ROLE_UNSUPPORTED", { role });
  return mapped;
}

function authorityForRole(role: SemanticPresetNodeRole) {
  if (role === "decision") return "decision_intent" as const;
  if (role === "portfolio") return "portfolio_action" as const;
  if (role === "risk") return "risk_gate" as const;
  if (role === "execution") return "execution" as const;
  return "none" as const;
}

export interface PipelineGraphHistoricalBridgeOptions {
  registry: PipelineGraphHistoricalBridgeRegistry;
  historicalPlanRegistry: RegisteredHistoricalGraphPlanRegistry;
  nodeExecutorRegistry: RegisteredHistoricalNodeExecutorRegistry;
  artifactSchemaRegistry: RegisteredHistoricalArtifactSchemaRegistry;
  executorBindings: readonly HistoricalImplementationExecutorBinding[];
  now?: () => Date;
}

export class PipelineGraphHistoricalBridge {
  private readonly executorBindings: ReadonlyMap<string, string>;
  private readonly now: () => Date;

  constructor(private readonly options: PipelineGraphHistoricalBridgeOptions) {
    this.executorBindings = new Map(
      options.executorBindings.map((binding) => [binding.implementationKey, binding.executorId]),
    );
    this.now = options.now ?? (() => new Date());
  }

  bridge(graph: PipelineGraphVersion, compiled: CompiledPipelinePlan) {
    if (compiled.graphId !== graph.pipelineGraphId) {
      throw new PipelineGraphHistoricalBridgeError("COMPILER_GRAPH_ID_MISMATCH", {
        graphId: graph.pipelineGraphId,
        compiledGraphId: compiled.graphId,
      });
    }
    if (compiled.humanVersion !== graph.humanReadableVersion) {
      throw new PipelineGraphHistoricalBridgeError("COMPILER_GRAPH_VERSION_MISMATCH", {
        graphVersion: graph.humanReadableVersion,
        compiledVersion: compiled.humanVersion,
      });
    }
    const graphFingerprint = calculatePipelineContentFingerprint(graph);
    if (compiled.graphFingerprint !== graphFingerprint) {
      throw new PipelineGraphHistoricalBridgeError("COMPILER_GRAPH_FINGERPRINT_MISMATCH", {
        graphId: graph.pipelineGraphId,
      });
    }
    const graphNodes = new Map(graph.nodes.map((node) => [node.nodeId, node]));
    if (
      compiled.steps.length !== graph.nodes.length ||
      compiled.steps.some((step) => !graphNodes.has(step.nodeId)) ||
      new Set(compiled.steps.map((step) => step.nodeId)).size !== graph.nodes.length
    ) {
      throw new PipelineGraphHistoricalBridgeError("COMPILER_NODE_SET_MISMATCH", {
        graphId: graph.pipelineGraphId,
      });
    }
    if (graph.edges.some((edge) => edge.kind === "feedback")) {
      throw new PipelineGraphHistoricalBridgeError("FEEDBACK_GRAPH_NOT_HISTORICAL", {
        graphId: graph.pipelineGraphId,
      });
    }

    const marketPack = asMarketPack(
      this.options.registry.marketPacks.get(graph.marketPackRef),
      graph.marketPackRef,
    );
    const resolvedNodes = new Map<string, {
      config: RegistryAgentConfig;
      template: RegistryAgentTemplate;
      role: SemanticPresetNodeRole;
      executorId: string;
    }>();

    for (const node of graph.nodes) {
      const config = asAgentConfig(
        this.options.registry.agentConfigs.get(node.agentConfigId),
        node.agentConfigId,
      );
      const template = asAgentTemplate(
        this.options.registry.agentTemplates.get(config.templateId),
        config.templateId,
      );
      if (template.humanReadableVersion !== config.templateVersion) {
        throw new PipelineGraphHistoricalBridgeError("TEMPLATE_VERSION_MISMATCH", {
          nodeId: node.nodeId,
          templateVersion: template.humanReadableVersion,
          configVersion: config.templateVersion,
        });
      }
      const implementationKey = this.options.registry.implementationBindings.get(config.agentConfigId);
      if (!implementationKey) {
        throw new PipelineGraphHistoricalBridgeError("IMPLEMENTATION_BINDING_MISSING", {
          nodeId: node.nodeId,
          agentConfigId: config.agentConfigId,
        });
      }
      const executorId = this.executorBindings.get(implementationKey);
      if (!executorId) {
        throw new PipelineGraphHistoricalBridgeError("EXECUTOR_BINDING_MISSING", {
          nodeId: node.nodeId,
          implementationKey,
        });
      }
      const role = semanticRole(template.role);
      const executor = this.options.nodeExecutorRegistry.require(executorId);
      if (executor.role !== role) {
        throw new HistoricalGraphExecutionError("NODE_EXECUTOR_ROLE_MISMATCH", {
          nodeId: node.nodeId,
          executorId,
          expectedRole: role,
          actualRole: executor.role,
        });
      }
      resolvedNodes.set(node.nodeId, { config, template, role, executorId });
    }

    const historicalNodes = compiled.steps.map((step) => {
      const resolved = resolvedNodes.get(step.nodeId);
      if (!resolved) {
        throw new PipelineGraphHistoricalBridgeError("REGISTRY_REFERENCE_MISSING", {
          nodeId: step.nodeId,
        });
      }
      const incoming = graph.edges.filter((edge) => edge.toNodeId === step.nodeId);
      const inputBindings = incoming.map((edge) => {
        const source = resolvedNodes.get(edge.fromNodeId);
        if (!source) {
          throw new PipelineGraphHistoricalBridgeError("REGISTRY_REFERENCE_MISSING", {
            nodeId: edge.fromNodeId,
          });
        }
        const outputPort = source.template.outputPorts.find((port) => port.portId === edge.fromPort);
        const inputPort = resolved.template.inputPorts.find((port) => port.portId === edge.toPort);
        if (!outputPort || !inputPort) {
          throw new PipelineGraphHistoricalBridgeError("PORT_SCHEMA_MISSING", {
            edgeId: edge.edgeId,
            fromPort: edge.fromPort,
            toPort: edge.toPort,
          });
        }
        const artifactType = outputPort.schemaRefs.find((schemaRef) =>
          inputPort.schemaRefs.includes(schemaRef),
        );
        if (!artifactType) {
          throw new PipelineGraphHistoricalBridgeError("PORT_SCHEMA_MISMATCH", {
            edgeId: edge.edgeId,
            outputSchemaRef: outputPort.schemaRefs.join(","),
            inputSchemaRef: inputPort.schemaRefs.join(","),
          });
        }
        if (!this.options.artifactSchemaRegistry.has(artifactType)) {
          throw new HistoricalGraphExecutionError("ARTIFACT_SCHEMA_NOT_REGISTERED", {
            edgeId: edge.edgeId,
            artifactType,
          });
        }
        const policy: "required" | "optional" | "fallback" =
          edge.kind === "fallback" ? "fallback" : edge.required ? "required" : "optional";
        let fallbackForEdgeId: string | undefined;
        if (policy === "fallback") {
          const primary = incoming.find(
            (candidate) =>
              candidate.kind !== "fallback" &&
              candidate.toPort === edge.toPort &&
              candidate.fromNodeId !== edge.fromNodeId,
          );
          if (!primary) {
            throw new PipelineGraphHistoricalBridgeError("FALLBACK_EDGE_INVALID", {
              edgeId: edge.edgeId,
            });
          }
          fallbackForEdgeId = primary.edgeId;
        }
        return {
          edgeId: edge.edgeId,
          sourceNodeId: edge.fromNodeId,
          artifactType,
          policy,
          fallbackForEdgeId,
        };
      });
      const outputArtifactTypes = [
        ...new Set(resolved.template.outputPorts.flatMap((port) => port.schemaRefs)),
      ];
      for (const artifactType of outputArtifactTypes) {
        if (!this.options.artifactSchemaRegistry.has(artifactType)) {
          throw new HistoricalGraphExecutionError("ARTIFACT_SCHEMA_NOT_REGISTERED", {
            nodeId: step.nodeId,
            artifactType,
          });
        }
      }
      const executor = this.options.nodeExecutorRegistry.require(resolved.executorId);
      if (inputBindings.some((binding) => !executor.inputArtifactTypes.includes(binding.artifactType))) {
        throw new HistoricalGraphExecutionError("INPUT_SCHEMA_INCOMPATIBLE", {
          nodeId: step.nodeId,
          executorId: resolved.executorId,
        });
      }
      if (outputArtifactTypes.some((artifactType) => !executor.outputArtifactTypes.includes(artifactType))) {
        throw new HistoricalGraphExecutionError("OUTPUT_ARTIFACT_UNDECLARED", {
          nodeId: step.nodeId,
          executorId: resolved.executorId,
        });
      }
      return {
        index: step.index,
        nodeId: step.nodeId,
        role: resolved.role,
        executorId: resolved.executorId,
        authority: authorityForRole(resolved.role),
        observationWindowIds: resolved.config.observationRequests.map(
          (request) =>
            `window:${request.dataSourceId}:${request.portId}:${request.window.kind}:${request.window.value}:${request.window.unit}`,
        ),
        predecessorNodeIds: [...step.predecessorNodeIds],
        successorNodeIds: [...step.successorNodeIds],
        inputBindings,
        outputArtifactTypes,
      };
    });

    const capabilityKinds = new Set<"bar" | "event" | "report">();
    for (const resolved of resolvedNodes.values()) {
      for (const request of resolved.config.observationRequests) {
        if (request.window.kind === "event_batch") capabilityKinds.add("event");
        else if (request.window.kind === "reporting_period") capabilityKinds.add("report");
        else capabilityKinds.add("bar");
      }
    }
    if (capabilityKinds.size === 0) capabilityKinds.add("bar");
    const executionMode = historicalNodes.some((node) => node.role === "execution")
      ? "paper_capable" as const
      : "research_only" as const;
    const withoutFingerprint = {
      schemaVersion: "1.0.0" as const,
      planId: `pipeline-graph:${graph.pipelineGraphId}:historical-plan:${graph.humanReadableVersion}`,
      version: graph.humanReadableVersion,
      lifecycleStatus: "registered" as const,
      createdAt: this.now().toISOString(),
      presetRef: {
        id: graph.pipelineGraphId,
        version: graph.humanReadableVersion,
        fingerprint: historicalReferenceFingerprint(graphFingerprint),
      },
      compiledGraphRef: {
        id: graph.pipelineGraphId,
        version: graph.humanReadableVersion,
        fingerprint: historicalReferenceFingerprint(graphFingerprint),
      },
      executionMode,
      marketPackRef: {
        id: marketPack.marketPackId,
        version: marketPack.humanReadableVersion,
        fingerprint: historicalReferenceFingerprint(marketPack.fingerprint),
      },
      requiredCapabilityKinds: [...capabilityKinds],
      nodes: historicalNodes,
      runtimeApplied: false as const,
    };
    const plan = HistoricalGraphExecutionPlanSchema.parse({
      ...withoutFingerprint,
      fingerprint: calculateHistoricalGraphPlanFingerprint(withoutFingerprint),
    });
    return this.options.historicalPlanRegistry.registerCompilerBridgePlan(plan);
  }
}
