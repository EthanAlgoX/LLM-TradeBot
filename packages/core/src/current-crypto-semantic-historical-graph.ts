import {
  AgentConfigSchema,
  AgentTemplateSchema,
  PipelineGraphVersionSchema,
  SCHEMA_VERSION,
  type AgentConfig,
  type AgentPermission,
  type AgentPort,
  type AgentRole,
  type AgentTemplate,
  type PipelineEdge,
  type PipelineNode,
} from "../../contracts/src/index.js";
import {
  createRegisteredSemanticPipelinePresetCatalog,
} from "./semantic-pipeline-presets.js";
import type {
  AgentImplementationBinding,
  PipelineRegistrySeed,
} from "./pipeline-orchestration.js";
import type {
  HistoricalImplementationExecutorBinding,
} from "./pipeline-graph-historical-bridge.js";

const createdAt = new Date("2026-07-26T00:00:00.000Z");
const market = "crypto";
const marketPackRef = "market-pack:crypto:v1";
const dataSourceId = "data-source:csv-historical";
const capabilityId = "capability:csv-historical:ohlcv:v1";
const configSchemaRef = "tradebot.agent-config.semantic-historical.v1";
const preset = createRegisteredSemanticPipelinePresetCatalog().require(
  "preset.current-crypto-multi-agent",
);

const roleMap: Readonly<Record<string, AgentRole>> = {
  selector: "selector",
  data_sync: "data_sync",
  data_quality: "data_quality",
  window_analysis: "analysis",
  bull_research: "bull_case",
  bear_research: "bear_case",
  position_monitor: "position_monitor",
  decision: "decision",
  portfolio: "portfolio",
  risk: "risk",
  execution: "execution",
  reflection: "reflection",
};

const permissionMap: Readonly<
Partial<Record<AgentRole, AgentPermission>>
> = {
  selector: "observe",
  data_sync: "observe",
  data_quality: "analyze",
  analysis: "analyze",
  bull_case: "analyze",
  bear_case: "analyze",
  decision: "propose_decision",
  portfolio: "allocate_portfolio",
  risk: "veto_risk",
  execution: "execute_paper",
  position_monitor: "propose_close_only",
  reflection: "reflect",
};

const executorMap: Readonly<Record<string, string>> = {
  selector: "historical-executor.selector",
  data_sync: "historical-executor.data-sync",
  data_quality: "historical-executor.data-quality",
  window_analysis: "historical-executor.window-analysis",
  bull_research: "historical-executor.bull",
  bear_research: "historical-executor.bear",
  position_monitor: "historical-executor.position-monitor",
  decision: "historical-executor.decision",
  portfolio: "historical-executor.portfolio",
  risk: "historical-executor.risk",
  execution: "historical-executor.execution",
  reflection: "historical-executor.reflection",
};

function artifactPortId(artifactType: string): string {
  return `artifact:${artifactType}`;
}

function port(
  artifactType: string,
  required = true,
  external = false,
): AgentPort {
  return {
    portId: artifactPortId(artifactType),
    schemaRefs: [artifactType],
    required,
    external,
  };
}

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

const templateNodes = new Map<string, typeof preset.nodes>();
for (const node of preset.nodes) {
  if (!node.agentTemplateId) {
    throw new Error(
      `SEMANTIC_HISTORICAL_TEMPLATE_ID_MISSING:${node.nodeId}`,
    );
  }
  const existing = templateNodes.get(node.agentTemplateId) ?? [];
  templateNodes.set(node.agentTemplateId, [...existing, node]);
}

export const CURRENT_CRYPTO_SEMANTIC_HISTORICAL_AGENT_TEMPLATES:
readonly AgentTemplate[] = [...templateNodes.entries()].map(
  ([semanticTemplateId, nodes]) => {
    const first = nodes[0]!;
    const role = roleMap[first.role];
    if (!role) {
      throw new Error(`SEMANTIC_HISTORICAL_ROLE_UNSUPPORTED:${first.role}`);
    }
    const permission = permissionMap[role];
    if (!permission) {
      throw new Error(
        `SEMANTIC_HISTORICAL_PERMISSION_UNSUPPORTED:${role}`,
      );
    }
    const nodeIds = new Set(nodes.map((node) => node.nodeId));
    const incomingTypes = stableUnique(
      preset.edges
        .filter((edge) => nodeIds.has(edge.targetNodeId))
        .map((edge) => edge.artifactType),
    );
    const outputTypes = stableUnique(
      nodes.flatMap((node) => node.outputArtifactTypes),
    );
    const hasObservationWindows = nodes.some(
      (node) => node.observationWindowIds.length > 0,
    );
    const inputs = incomingTypes.map((artifactType) =>
      port(artifactType, first.role !== "reflection"),
    );
    if (first.role === "selector") {
      inputs.push(port("tradebot.semantic.candidate_pool.v1", true, true));
    }
    if (
      hasObservationWindows &&
      (first.role === "data_sync" || first.role === "window_analysis")
    ) {
      inputs.push({
        portId: "market_data",
        schemaRefs: ["tradebot.market.ohlcv.v1"],
        required: true,
        external: true,
      });
    }
    return AgentTemplateSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      templateId: `agent-template:semantic-historical:${semanticTemplateId.split(".").at(-1) ?? role}:v1`,
      name: `Semantic Historical ${first.role}`,
      role,
      implementationRef: `registered-semantic-historical:${first.role}`,
      configSchemaRef,
      humanReadableVersion: "1.0.0",
      fingerprint: `sha256:semantic-historical-template:${first.role}:v1`,
      lifecycleStatus: "active",
      createdAt,
      inputPorts: inputs,
      outputPorts: outputTypes.map((artifactType) => port(artifactType)),
      supportedMarkets: [market],
      supportedMarketPackRefs: [marketPackRef],
      supportedDataTypes: hasObservationWindows ? ["ohlcv"] : [],
      permissions: [permission],
      timeoutPolicy: {
        maxDurationMs: 15_000,
        onTimeout:
          first.role === "reflection" ? "continue_degraded" : "fail",
      },
      fallbackPolicy: {
        supported: false,
        fallbackTemplateIds: [],
      },
      allowsFeedback: false,
    });
  },
);

const templateBySemanticId = new Map(
  [...templateNodes.keys()].map((semanticTemplateId, index) => [
    semanticTemplateId,
    CURRENT_CRYPTO_SEMANTIC_HISTORICAL_AGENT_TEMPLATES[index]!,
  ]),
);

function observationRequests(node: typeof preset.nodes[number]) {
  if (
    node.role !== "data_sync" &&
    node.role !== "window_analysis"
  ) {
    return [];
  }
  return node.observationWindowIds.map((windowId) => {
    const window = preset.observationWindows.find(
      (candidate) => candidate.id === windowId,
    );
    if (!window) {
      throw new Error(`SEMANTIC_HISTORICAL_WINDOW_NOT_REGISTERED:${windowId}`);
    }
    return {
      portId: "market_data",
      dataSourceId,
      capabilityId,
      window: {
        kind: window.kind,
        unit: window.unit,
        value: window.value,
      },
      requirement: "required" as const,
    };
  });
}

export const CURRENT_CRYPTO_SEMANTIC_HISTORICAL_AGENT_CONFIGS:
readonly AgentConfig[] = preset.nodes.map((node) => {
  const template = templateBySemanticId.get(node.agentTemplateId ?? "");
  if (!template) {
    throw new Error(
      `SEMANTIC_HISTORICAL_TEMPLATE_NOT_REGISTERED:${node.agentTemplateId}`,
    );
  }
  const requests = observationRequests(node);
  return AgentConfigSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    agentConfigId: `agent-config:semantic-historical:${node.nodeId}:v1`,
    templateId: template.templateId,
    templateVersion: template.humanReadableVersion,
    humanReadableVersion: "1.0.0",
    fingerprint: `sha256:semantic-historical-config:${node.nodeId}:v1`,
    lifecycleStatus: "active",
    createdAt,
    market,
    marketPackRef,
    schemaRefs: [configSchemaRef],
    dataSourceRefs: requests.length > 0 ? [dataSourceId] : [],
    observationRequests: requests,
    config: {
      semanticPresetId: preset.id,
      semanticNodeRole: node.role,
    },
  });
});

const configByNodeId = new Map(
  preset.nodes.map((node, index) => [
    node.nodeId,
    CURRENT_CRYPTO_SEMANTIC_HISTORICAL_AGENT_CONFIGS[index]!,
  ]),
);

const requiredPolicy = {
  mode: "required" as const,
  onFailure: "block_openings" as const,
};
const optionalPolicy = {
  mode: "optional" as const,
  onFailure: "continue_degraded" as const,
};

const graphNodes: PipelineNode[] = preset.nodes.map((node) => ({
  nodeId: node.nodeId,
  displayName: node.nodeId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" "),
  agentConfigId: configByNodeId.get(node.nodeId)!.agentConfigId,
  required: node.role !== "reflection",
  failurePolicy:
    node.role === "reflection" ? optionalPolicy : requiredPolicy,
}));

const graphEdges: PipelineEdge[] = preset.edges.map((edge) => {
  const postProcess = edge.targetNodeId === "reflection";
  return {
    edgeId: `edge:${edge.edgeId}`,
    fromNodeId: edge.sourceNodeId,
    fromPort: artifactPortId(edge.artifactType),
    toNodeId: edge.targetNodeId,
    toPort: artifactPortId(edge.artifactType),
    kind: postProcess ? "post_process" : "data",
    required: !postProcess,
  };
});

export const CURRENT_CRYPTO_SEMANTIC_CSV_PIPELINE_GRAPH =
  PipelineGraphVersionSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    pipelineGraphId: "pipeline-graph:current-crypto-semantic-csv",
    name: "Current Crypto Semantic CSV Historical Pipeline",
    humanReadableVersion: "1.0.0",
    fingerprint: "sha256:current-crypto-semantic-csv-historical:v1",
    lifecycleStatus: "validated",
    createdAt,
    market,
    marketPackRef,
    schemaRefs: stableUnique([
      "tradebot.market.ohlcv.v1",
      ...preset.nodes.flatMap((node) => [
        ...node.inputArtifactTypes,
        ...node.outputArtifactTypes,
      ]),
    ]),
    dataSourceRefs: [dataSourceId],
    nodes: graphNodes,
    edges: graphEdges,
    entryNodeIds: ["selector"],
    terminalNodeIds: ["execution", "reflection"],
    dataLineage: [],
    releaseGates: [
      "contract_validation",
      "backtest",
      "walk_forward",
      "human_approval",
      "paper_running",
    ],
  });

export const CURRENT_CRYPTO_SEMANTIC_HISTORICAL_IMPLEMENTATION_BINDINGS:
readonly AgentImplementationBinding[] = preset.nodes.map((node) => ({
  agentConfigId: configByNodeId.get(node.nodeId)!.agentConfigId,
  implementationKey: `tradebot:semantic-historical:${node.role}`,
}));

export const CURRENT_CRYPTO_SEMANTIC_HISTORICAL_EXECUTOR_BINDINGS:
readonly HistoricalImplementationExecutorBinding[] = stableUnique(
  preset.nodes.map((node) => node.role),
).map((role) => ({
  implementationKey: `tradebot:semantic-historical:${role}`,
  executorId:
    executorMap[role] ??
    (() => {
      throw new Error(
        `SEMANTIC_HISTORICAL_EXECUTOR_UNSUPPORTED:${role}`,
      );
    })(),
}));

export const CURRENT_CRYPTO_SEMANTIC_HISTORICAL_REGISTRY_SEED:
PipelineRegistrySeed = {
  agentTemplates: CURRENT_CRYPTO_SEMANTIC_HISTORICAL_AGENT_TEMPLATES,
  agentConfigs: CURRENT_CRYPTO_SEMANTIC_HISTORICAL_AGENT_CONFIGS,
  implementationBindings:
    CURRENT_CRYPTO_SEMANTIC_HISTORICAL_IMPLEMENTATION_BINDINGS,
};
