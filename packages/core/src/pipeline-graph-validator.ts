import {
  PipelineGraphVersionSchema,
  PipelineValidationResultSchema,
  SCHEMA_VERSION,
  type AgentConfig,
  type AgentPort,
  type AgentTemplate,
  type DataLineage,
  type DataSourceCapability,
  type DataSourceDefinition,
  type MarketPackDefinition,
  type ObservationWindow,
  type PipelineEdge,
  type PipelineGraphVersion,
  type PipelineNode,
  type PipelineValidationCode,
  type PipelineValidationIssue,
  type PipelineValidationResult,
} from "../../contracts/src/index.js";

export interface PipelineValidationContext {
  readonly marketPacks: readonly MarketPackDefinition[];
  readonly dataSources: readonly DataSourceDefinition[];
  readonly capabilities: readonly DataSourceCapability[];
  readonly agentTemplates: readonly AgentTemplate[];
  readonly agentConfigs: readonly AgentConfig[];
}

const requiredReleaseGates = [
  "contract_validation",
  "backtest",
  "walk_forward",
  "human_approval",
  "paper_running",
] as const;

type IssueEntity = PipelineValidationIssue["entityType"];

export function validatePipelineGraph(
  rawGraph: unknown,
  context: PipelineValidationContext,
): PipelineValidationResult {
  const parsed = PipelineGraphVersionSchema.safeParse(rawGraph);
  if (!parsed.success) {
    const graph = rawGraph && typeof rawGraph === "object" ? rawGraph as Record<string, unknown> : {};
    const issue: PipelineValidationIssue = {
      issueId: "INVALID_GRAPH_CONTRACT:graph:contract",
      code: "INVALID_GRAPH_CONTRACT",
      severity: "error",
      entityType: "graph",
      entityId: typeof graph.pipelineGraphId === "string" ? graph.pipelineGraphId : "unknown",
      path: [],
      details: {
        zodIssueCodes: parsed.error.issues.map((item) => item.code),
        invalidPaths: parsed.error.issues.map((item) => item.path.join(".")),
      },
    };
    return PipelineValidationResultSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      pipelineGraphId: typeof graph.pipelineGraphId === "string" ? graph.pipelineGraphId : "unknown",
      graphVersion: typeof graph.humanReadableVersion === "string" ? graph.humanReadableVersion : "unknown",
      valid: false,
      issues: [issue],
      summary: { errorCount: 1, warningCount: 0 },
    });
  }

  const graph = parsed.data;
  const issues: PipelineValidationIssue[] = [];
  const addIssue = (
    code: PipelineValidationCode,
    entityType: IssueEntity,
    entityId: string | undefined,
    path: Array<string | number>,
    details: Record<string, unknown> = {},
    severity: PipelineValidationIssue["severity"] = "error",
  ): void => {
    issues.push({
      issueId: `${code}:${entityId ?? graph.pipelineGraphId}:${path.join(".") || "root"}`,
      code,
      severity,
      entityType,
      entityId,
      path,
      details,
    });
  };

  const nodes = uniqueMap(graph.nodes, (node) => node.nodeId, (nodeId) => {
    addIssue("DUPLICATE_NODE_ID", "node", nodeId, ["nodes"], { nodeId });
  });
  uniqueMap(graph.edges, (edge) => edge.edgeId, (edgeId) => {
    addIssue("DUPLICATE_EDGE_ID", "edge", edgeId, ["edges"], { edgeId });
  });
  const configs = new Map(context.agentConfigs.map((config) => [config.agentConfigId, config]));
  const templates = new Map(context.agentTemplates.map((template) => [template.templateId, template]));
  const marketPacks = new Map(context.marketPacks.map((pack) => [pack.marketPackId, pack]));
  const dataSources = new Map(context.dataSources.map((source) => [source.dataSourceId, source]));
  const capabilities = new Map(context.capabilities.map((capability) => [capability.capabilityId, capability]));

  const marketPack = marketPacks.get(graph.marketPackRef);
  if (!marketPack) {
    addIssue("MARKET_PACK_NOT_FOUND", "graph", graph.pipelineGraphId, ["marketPackRef"], {
      marketPackRef: graph.marketPackRef,
    });
  } else if (marketPack.market !== graph.market) {
    addIssue("MARKET_PACK_MISMATCH", "graph", graph.pipelineGraphId, ["market"], {
      graphMarket: graph.market,
      marketPackMarket: marketPack.market,
    });
  }

  for (const entryNodeId of graph.entryNodeIds) {
    if (!nodes.has(entryNodeId)) {
      addIssue("UNKNOWN_ENTRY_NODE", "graph", graph.pipelineGraphId, ["entryNodeIds"], { entryNodeId });
    }
  }
  for (const terminalNodeId of graph.terminalNodeIds) {
    if (!nodes.has(terminalNodeId)) {
      addIssue("UNKNOWN_TERMINAL_NODE", "graph", graph.pipelineGraphId, ["terminalNodeIds"], { terminalNodeId });
    }
  }

  const resolved = new Map<string, { node: PipelineNode; config: AgentConfig; template: AgentTemplate }>();
  for (const [nodeId, node] of nodes) {
    const config = configs.get(node.agentConfigId);
    if (!config) {
      addIssue("UNKNOWN_AGENT_CONFIG", "node", nodeId, ["agentConfigId"], {
        agentConfigId: node.agentConfigId,
      });
      continue;
    }
    const template = templates.get(config.templateId);
    if (!template) {
      addIssue("UNKNOWN_AGENT_TEMPLATE", "agent_config", config.agentConfigId, ["templateId"], {
        templateId: config.templateId,
      });
      continue;
    }
    resolved.set(nodeId, { node, config, template });
    if (config.templateVersion !== template.humanReadableVersion) {
      addIssue("AGENT_TEMPLATE_VERSION_MISMATCH", "agent_config", config.agentConfigId, ["templateVersion"], {
        configuredVersion: config.templateVersion,
        registeredVersion: template.humanReadableVersion,
      });
    }
    if (config.market !== graph.market || !template.supportedMarkets.includes(graph.market)) {
      addIssue("MARKET_UNSUPPORTED", "node", nodeId, ["agentConfigId"], {
        graphMarket: graph.market,
        configMarket: config.market,
        supportedMarkets: template.supportedMarkets,
      });
    }
    if (
      config.marketPackRef !== graph.marketPackRef
      || !template.supportedMarketPackRefs.includes(graph.marketPackRef)
    ) {
      addIssue("MARKET_PACK_MISMATCH", "node", nodeId, ["agentConfigId"], {
        graphMarketPackRef: graph.marketPackRef,
        configMarketPackRef: config.marketPackRef,
        supportedMarketPackRefs: template.supportedMarketPackRefs,
      });
    }
    validateFailurePolicy(node, nodes, addIssue);
    validateDataRequirements(
      graph,
      node,
      config,
      template,
      dataSources,
      capabilities,
      addIssue,
    );
  }

  const validEdges: PipelineEdge[] = [];
  for (const edge of graph.edges) {
    const source = resolved.get(edge.fromNodeId);
    const target = resolved.get(edge.toNodeId);
    if (!nodes.has(edge.fromNodeId)) {
      addIssue("UNKNOWN_EDGE_SOURCE", "edge", edge.edgeId, ["fromNodeId"], {
        fromNodeId: edge.fromNodeId,
      });
    }
    if (!nodes.has(edge.toNodeId)) {
      addIssue("UNKNOWN_EDGE_TARGET", "edge", edge.edgeId, ["toNodeId"], {
        toNodeId: edge.toNodeId,
      });
    }
    if (!source || !target) continue;
    validEdges.push(edge);
    const output = source.template.outputPorts.find((port) => port.portId === edge.fromPort);
    const input = target.template.inputPorts.find((port) => port.portId === edge.toPort);
    if (!output) {
      addIssue("PORT_NOT_FOUND", "edge", edge.edgeId, ["fromPort"], {
        nodeId: edge.fromNodeId,
        portId: edge.fromPort,
        direction: "output",
      });
    }
    if (!input) {
      addIssue("PORT_NOT_FOUND", "edge", edge.edgeId, ["toPort"], {
        nodeId: edge.toNodeId,
        portId: edge.toPort,
        direction: "input",
      });
    }
    if (output && input && edge.kind !== "control" && !schemasCompatible(output, input)) {
      addIssue("SCHEMA_INCOMPATIBLE", "edge", edge.edgeId, ["fromPort", "toPort"], {
        fromSchemaRefs: output.schemaRefs,
        toSchemaRefs: input.schemaRefs,
      });
    }
    validateFeedbackEdge(edge, source.template, target.template, addIssue);
  }

  validateRequiredInputs(resolved, validEdges, addIssue);
  validateConnectivity(graph, resolved, validEdges, addIssue);
  validateCycles(resolved, validEdges, addIssue);
  validateExecutionBoundaries(resolved, validEdges, addIssue);

  if (graph.releaseGates.join("|") !== requiredReleaseGates.join("|")) {
    addIssue("RELEASE_GATES_INCOMPLETE", "graph", graph.pipelineGraphId, ["releaseGates"], {
      required: requiredReleaseGates,
      actual: graph.releaseGates,
    });
  }

  const orderedIssues = [...issues].sort((left, right) => (
    left.code.localeCompare(right.code)
    || (left.entityId ?? "").localeCompare(right.entityId ?? "")
    || left.issueId.localeCompare(right.issueId)
  ));
  const errorCount = orderedIssues.filter((issue) => issue.severity === "error").length;
  const warningCount = orderedIssues.length - errorCount;
  return PipelineValidationResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    pipelineGraphId: graph.pipelineGraphId,
    graphVersion: graph.humanReadableVersion,
    valid: errorCount === 0,
    issues: orderedIssues,
    summary: { errorCount, warningCount },
  });
}

function uniqueMap<T>(
  values: readonly T[],
  id: (value: T) => string,
  duplicate: (id: string) => void,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = id(value);
    if (result.has(key)) duplicate(key);
    else result.set(key, value);
  }
  return result;
}

function schemasCompatible(output: AgentPort, input: AgentPort): boolean {
  return output.schemaRefs.some((schemaRef) => input.schemaRefs.includes(schemaRef));
}

function validateFailurePolicy(
  node: PipelineNode,
  nodes: ReadonlyMap<string, PipelineNode>,
  addIssue: (
    code: PipelineValidationCode,
    entityType: IssueEntity,
    entityId: string | undefined,
    path: Array<string | number>,
    details?: Record<string, unknown>,
  ) => void,
): void {
  const policy = node.failurePolicy;
  const complete = policy.mode === "required"
    ? node.required && policy.onFailure === "block_openings" && !policy.fallbackNodeId
    : policy.mode === "optional"
      ? !node.required && policy.onFailure === "continue_degraded" && !policy.fallbackNodeId
      : policy.onFailure === "use_fallback" && Boolean(policy.fallbackNodeId);
  if (!complete) {
    addIssue("FAILURE_POLICY_INCOMPLETE", "node", node.nodeId, ["failurePolicy"], {
      required: node.required,
      policy,
    });
  }
  if (policy.mode === "fallback" && (!policy.fallbackNodeId || !nodes.has(policy.fallbackNodeId))) {
    addIssue("FALLBACK_NODE_INVALID", "node", node.nodeId, ["failurePolicy", "fallbackNodeId"], {
      fallbackNodeId: policy.fallbackNodeId,
    });
  }
}

function validateDataRequirements(
  graph: PipelineGraphVersion,
  node: PipelineNode,
  config: AgentConfig,
  template: AgentTemplate,
  dataSources: ReadonlyMap<string, DataSourceDefinition>,
  capabilities: ReadonlyMap<string, DataSourceCapability>,
  addIssue: (
    code: PipelineValidationCode,
    entityType: IssueEntity,
    entityId: string | undefined,
    path: Array<string | number>,
    details?: Record<string, unknown>,
  ) => void,
): void {
  for (const sourceId of config.dataSourceRefs) {
    const source = dataSources.get(sourceId);
    if (!source) {
      addIssue("DATA_SOURCE_NOT_FOUND", "agent_config", config.agentConfigId, ["dataSourceRefs"], {
        dataSourceId: sourceId,
      });
      continue;
    }
    if (!graph.dataSourceRefs.includes(sourceId)) {
      addIssue("DATA_SOURCE_NOT_FOUND", "agent_config", config.agentConfigId, ["dataSourceRefs"], {
        dataSourceId: sourceId,
        reason: "not_declared_by_graph",
      });
    }
    if (!source.marketPackRefs.includes(graph.marketPackRef)) {
      addIssue("MARKET_PACK_MISMATCH", "data_source", sourceId, ["marketPackRefs"], {
        graphMarketPackRef: graph.marketPackRef,
        sourceMarketPackRefs: source.marketPackRefs,
      });
    }
  }

  for (const [requestIndex, request] of config.observationRequests.entries()) {
    const source = dataSources.get(request.dataSourceId);
    if (!source) {
      addIssue("DATA_SOURCE_NOT_FOUND", "agent_config", config.agentConfigId, ["observationRequests", requestIndex], {
        dataSourceId: request.dataSourceId,
      });
      continue;
    }
    if (!config.dataSourceRefs.includes(request.dataSourceId)) {
      addIssue("DATA_SOURCE_NOT_FOUND", "agent_config", config.agentConfigId, ["observationRequests", requestIndex], {
        dataSourceId: request.dataSourceId,
        reason: "not_declared_by_agent_config",
      });
    }
    const inputPort = template.inputPorts.find((port) => port.portId === request.portId);
    if (!inputPort) {
      addIssue("PORT_NOT_FOUND", "agent_config", config.agentConfigId, ["observationRequests", requestIndex, "portId"], {
        portId: request.portId,
      });
    }
    if (request.requirement === "fallback" && !request.fallbackDataSourceId) {
      addIssue("FAILURE_POLICY_INCOMPLETE", "agent_config", config.agentConfigId, ["observationRequests", requestIndex], {
        requirement: request.requirement,
      });
    }
    const capability = request.capabilityId
      ? capabilities.get(request.capabilityId)
      : [...capabilities.values()].find((candidate) => candidate.dataSourceId === request.dataSourceId);
    if (!capability || capability.dataSourceId !== request.dataSourceId) {
      addIssue("DATA_CAPABILITY_NOT_FOUND", "agent_config", config.agentConfigId, ["observationRequests", requestIndex], {
        capabilityId: request.capabilityId,
        dataSourceId: request.dataSourceId,
      });
      continue;
    }
    if (
      !capability.markets.includes(graph.market)
      || !capability.marketPackRefs.includes(graph.marketPackRef)
    ) {
      addIssue("MARKET_UNSUPPORTED", "capability", capability.capabilityId, ["markets"], {
        graphMarket: graph.market,
        capabilityMarkets: capability.markets,
        graphMarketPackRef: graph.marketPackRef,
      });
    }
    if (
      template.supportedDataTypes.length === 0
      || !capability.dataTypes.some((dataType) => template.supportedDataTypes.includes(dataType))
    ) {
      addIssue("DATA_SOURCE_TYPE_UNSUPPORTED", "node", node.nodeId, ["agentConfigId"], {
        templateDataTypes: template.supportedDataTypes,
        capabilityDataTypes: capability.dataTypes,
      });
    }
    validateObservationWindow(graph, request.window, capability, requestIndex, config, addIssue);
  }
}

function validateObservationWindow(
  graph: PipelineGraphVersion,
  requested: ObservationWindow,
  capability: DataSourceCapability,
  requestIndex: number,
  config: AgentConfig,
  addIssue: (
    code: PipelineValidationCode,
    entityType: IssueEntity,
    entityId: string | undefined,
    path: Array<string | number>,
    details?: Record<string, unknown>,
  ) => void,
): void {
  const native = capability.nativeObservationWindows.find((window) => windowsEqual(window, requested));
  if (native) return;
  const aggregateSource = capability.nativeObservationWindows.find((window) => (
    capability.aggregation.allowed && canAggregate(window, requested)
  ));
  if (aggregateSource) {
    const lineage = graph.dataLineage.find((candidate) => (
      candidate.dataSourceId === capability.dataSourceId
      && candidate.capabilityId === capability.capabilityId
      && candidate.transformation === "aggregate"
      && windowsEqual(candidate.sourceWindow, aggregateSource)
      && windowsEqual(candidate.targetWindow, requested)
    ));
    if (!lineage) {
      addIssue("DATA_LINEAGE_REQUIRED", "agent_config", config.agentConfigId, ["observationRequests", requestIndex, "window"], {
        capabilityId: capability.capabilityId,
        sourceWindow: aggregateSource,
        targetWindow: requested,
      });
    } else {
      validateLineage(lineage, capability, addIssue);
    }
    return;
  }

  const requestedSize = fixedWindowSize(requested);
  const comparableNative = capability.nativeObservationWindows
    .map((window) => ({ window, size: fixedWindowSize(window) }))
    .filter((item): item is { window: ObservationWindow; size: number } => item.size !== undefined);
  if (
    requested.kind === "bar_interval"
    && requestedSize !== undefined
    && comparableNative.length > 0
    && comparableNative.every((item) => item.size > requestedSize)
  ) {
    addIssue("UPSAMPLING_FORBIDDEN", "agent_config", config.agentConfigId, ["observationRequests", requestIndex, "window"], {
      requested,
      nativeObservationWindows: capability.nativeObservationWindows,
    });
  }
  addIssue("OBSERVATION_WINDOW_UNSUPPORTED", "agent_config", config.agentConfigId, ["observationRequests", requestIndex, "window"], {
    requested,
    nativeObservationWindows: capability.nativeObservationWindows,
    aggregationAllowed: capability.aggregation.allowed,
  });
}

function validateLineage(
  lineage: DataLineage,
  capability: DataSourceCapability,
  addIssue: (
    code: PipelineValidationCode,
    entityType: IssueEntity,
    entityId: string | undefined,
    path: Array<string | number>,
    details?: Record<string, unknown>,
  ) => void,
): void {
  if (
    lineage.transformerVersion !== capability.aggregation.transformerVersion
    || lineage.timezone !== capability.timezone
    || lineage.tradingCalendar !== capability.tradingCalendar
    || lineage.asOfPolicy !== "closed_windows_only"
    || !canAggregate(lineage.sourceWindow, lineage.targetWindow)
  ) {
    addIssue("DATA_LINEAGE_INVALID", "lineage", lineage.lineageId, ["dataLineage"], {
      lineageTransformerVersion: lineage.transformerVersion,
      capabilityTransformerVersion: capability.aggregation.transformerVersion,
      lineageTimezone: lineage.timezone,
      capabilityTimezone: capability.timezone,
      lineageTradingCalendar: lineage.tradingCalendar,
      capabilityTradingCalendar: capability.tradingCalendar,
    });
  }
}

function windowsEqual(left: ObservationWindow, right: ObservationWindow): boolean {
  return left.kind === right.kind && left.value === right.value && left.unit === right.unit;
}

function fixedWindowSize(window: ObservationWindow): number | undefined {
  const units: Partial<Record<ObservationWindow["unit"], number>> = {
    second: 1,
    minute: 60,
    hour: 3_600,
    day: 86_400,
    week: 604_800,
  };
  const multiplier = units[window.unit];
  return multiplier === undefined ? undefined : multiplier * window.value;
}

function canAggregate(source: ObservationWindow, target: ObservationWindow): boolean {
  if (source.kind !== "bar_interval" || target.kind !== "bar_interval") return false;
  const sourceSize = fixedWindowSize(source);
  const targetSize = fixedWindowSize(target);
  if (sourceSize !== undefined && targetSize !== undefined) {
    return sourceSize < targetSize && targetSize % sourceSize === 0;
  }
  const calendarMonths = (window: ObservationWindow): number | undefined => {
    if (window.unit === "month") return window.value;
    if (window.unit === "quarter") return window.value * 3;
    return undefined;
  };
  const sourceMonths = calendarMonths(source);
  const targetMonths = calendarMonths(target);
  return sourceMonths !== undefined
    && targetMonths !== undefined
    && sourceMonths < targetMonths
    && targetMonths % sourceMonths === 0;
}

function validateFeedbackEdge(
  edge: PipelineEdge,
  source: AgentTemplate,
  target: AgentTemplate,
  addIssue: (
    code: PipelineValidationCode,
    entityType: IssueEntity,
    entityId: string | undefined,
    path: Array<string | number>,
    details?: Record<string, unknown>,
  ) => void,
): void {
  if (edge.kind !== "feedback") return;
  const forbiddenPermissions = new Set([
    "propose_decision",
    "propose_close_only",
    "allocate_portfolio",
    "veto_risk",
    "execute_paper",
  ]);
  if (
    !edge.feedbackPolicy
    || !source.allowsFeedback
    || !target.allowsFeedback
    || source.permissions.some((permission) => forbiddenPermissions.has(permission))
    || target.permissions.some((permission) => forbiddenPermissions.has(permission))
  ) {
    addIssue("FEEDBACK_POLICY_INCOMPLETE", "edge", edge.edgeId, ["feedbackPolicy"], {
      sourceAllowsFeedback: source.allowsFeedback,
      targetAllowsFeedback: target.allowsFeedback,
      feedbackPolicy: edge.feedbackPolicy,
    });
  }
}

function validateRequiredInputs(
  resolved: ReadonlyMap<string, { node: PipelineNode; config: AgentConfig; template: AgentTemplate }>,
  edges: readonly PipelineEdge[],
  addIssue: (
    code: PipelineValidationCode,
    entityType: IssueEntity,
    entityId: string | undefined,
    path: Array<string | number>,
    details?: Record<string, unknown>,
  ) => void,
): void {
  for (const [nodeId, { template }] of resolved) {
    for (const port of template.inputPorts.filter((candidate) => candidate.required && !candidate.external)) {
      if (!edges.some((edge) => edge.toNodeId === nodeId && edge.toPort === port.portId && edge.required)) {
        addIssue("REQUIRED_INPUT_MISSING", "node", nodeId, ["inputPorts", port.portId], {
          portId: port.portId,
          schemaRefs: port.schemaRefs,
        });
      }
    }
  }
}

function validateConnectivity(
  graph: PipelineGraphVersion,
  resolved: ReadonlyMap<string, { node: PipelineNode; config: AgentConfig; template: AgentTemplate }>,
  edges: readonly PipelineEdge[],
  addIssue: (
    code: PipelineValidationCode,
    entityType: IssueEntity,
    entityId: string | undefined,
    path: Array<string | number>,
    details?: Record<string, unknown>,
  ) => void,
): void {
  const reachable = new Set<string>();
  const queue = graph.entryNodeIds.filter((nodeId) => resolved.has(nodeId));
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const edge of edges.filter((candidate) => (
      candidate.fromNodeId === nodeId && candidate.kind !== "fallback" && candidate.kind !== "feedback"
    ))) {
      queue.push(edge.toNodeId);
    }
  }
  for (const [nodeId, { template }] of resolved) {
    const hasIncoming = edges.some((edge) => edge.toNodeId === nodeId);
    const hasOutgoing = edges.some((edge) => edge.fromNodeId === nodeId);
    const isEntry = graph.entryNodeIds.includes(nodeId);
    const isTerminal = graph.terminalNodeIds.includes(nodeId) || template.outputPorts.length === 0;
    if ((!isEntry && !hasIncoming) || (!isTerminal && !hasOutgoing)) {
      addIssue("DANGLING_NODE", "node", nodeId, ["nodes"], {
        hasIncoming,
        hasOutgoing,
        isEntry,
        isTerminal,
      });
    }
    if (!reachable.has(nodeId)) {
      addIssue("UNREACHABLE_NODE", "node", nodeId, ["nodes"], {
        entryNodeIds: graph.entryNodeIds,
      });
    }
  }
}

function validateCycles(
  resolved: ReadonlyMap<string, { node: PipelineNode; config: AgentConfig; template: AgentTemplate }>,
  edges: readonly PipelineEdge[],
  addIssue: (
    code: PipelineValidationCode,
    entityType: IssueEntity,
    entityId: string | undefined,
    path: Array<string | number>,
    details?: Record<string, unknown>,
  ) => void,
): void {
  const adjacency = new Map<string, string[]>();
  for (const nodeId of resolved.keys()) adjacency.set(nodeId, []);
  for (const edge of edges.filter((candidate) => candidate.kind !== "feedback" && candidate.kind !== "fallback")) {
    adjacency.get(edge.fromNodeId)?.push(edge.toNodeId);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (nodeId: string, path: string[]): void => {
    if (visiting.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      addIssue("CYCLE_NOT_ALLOWED", "node", nodeId, ["edges"], {
        cycle: [...path.slice(Math.max(0, cycleStart)), nodeId],
      });
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const target of adjacency.get(nodeId) ?? []) walk(target, [...path, nodeId]);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of resolved.keys()) walk(nodeId, []);
}

function validateExecutionBoundaries(
  resolved: ReadonlyMap<string, { node: PipelineNode; config: AgentConfig; template: AgentTemplate }>,
  edges: readonly PipelineEdge[],
  addIssue: (
    code: PipelineValidationCode,
    entityType: IssueEntity,
    entityId: string | undefined,
    path: Array<string | number>,
    details?: Record<string, unknown>,
  ) => void,
): void {
  const executions = [...resolved.entries()].filter(([, value]) => value.template.role === "execution");
  const decisionNodes = [...resolved.values()].filter((value) => value.template.role === "decision");
  for (const [executionNodeId, execution] of executions) {
    if (!execution.template.permissions.includes("execute_paper")) {
      addIssue("EXECUTION_BOUNDARY_BYPASSED", "node", executionNodeId, ["permissions"], {
        permissions: execution.template.permissions,
      });
    }
    const incoming = edges.filter((edge) => edge.toNodeId === executionNodeId && edge.kind !== "post_process");
    const riskEdge = incoming.find((edge) => edge.toPort === "risk");
    const decisionEdge = incoming.find((edge) => edge.toPort === "decision");
    const riskNode = riskEdge ? resolved.get(riskEdge.fromNodeId) : undefined;
    const portfolioNode = decisionEdge ? resolved.get(decisionEdge.fromNodeId) : undefined;
    if (!riskNode || riskNode.template.role !== "risk" || !riskNode.template.permissions.includes("veto_risk")) {
      addIssue("RISK_BOUNDARY_BYPASSED", "node", executionNodeId, ["inputPorts", "risk"], {
        riskSourceNodeId: riskEdge?.fromNodeId,
      });
    }
    if (
      !portfolioNode
      || portfolioNode.template.role !== "portfolio"
      || !portfolioNode.template.permissions.includes("allocate_portfolio")
    ) {
      addIssue("EXECUTION_BOUNDARY_BYPASSED", "node", executionNodeId, ["inputPorts", "decision"], {
        decisionSourceNodeId: decisionEdge?.fromNodeId,
      });
    }
    if (riskNode && portfolioNode) {
      const riskInput = edges.find((edge) => (
        edge.toNodeId === riskEdge!.fromNodeId
        && edge.toPort === "decision"
        && edge.fromNodeId === decisionEdge!.fromNodeId
      ));
      if (!riskInput) {
        addIssue("RISK_BOUNDARY_BYPASSED", "node", executionNodeId, ["inputPorts", "risk"], {
          reason: "risk_did_not_validate_portfolio_decision",
          riskNodeId: riskEdge?.fromNodeId,
          portfolioNodeId: decisionEdge?.fromNodeId,
        });
      }
    }
    if (portfolioNode) {
      const proposals = edges.filter((edge) => edge.toNodeId === decisionEdge!.fromNodeId && edge.toPort === "proposals");
      const invalidProposal = proposals.find((edge) => {
        const source = resolved.get(edge.fromNodeId);
        return !source || !(
          source.template.permissions.includes("propose_decision")
          || source.template.permissions.includes("propose_close_only")
        );
      });
      if (proposals.length === 0 || invalidProposal) {
        addIssue("DECISION_BOUNDARY_BYPASSED", "node", executionNodeId, ["inputPorts", "decision"], {
          invalidSourceNodeId: invalidProposal?.fromNodeId,
          proposalCount: proposals.length,
        });
      }
    }
    const unexpectedIncoming = incoming.find((edge) => edge.toPort !== "decision" && edge.toPort !== "risk");
    if (unexpectedIncoming) {
      addIssue("EXECUTION_BOUNDARY_BYPASSED", "edge", unexpectedIncoming.edgeId, ["toNodeId"], {
        toNodeId: executionNodeId,
        toPort: unexpectedIncoming.toPort,
      });
    }
    if (decisionNodes.length === 0) {
      addIssue("DECISION_BOUNDARY_BYPASSED", "node", executionNodeId, ["nodes"], {
        reason: "decision_agent_missing",
      });
    }
  }
}
