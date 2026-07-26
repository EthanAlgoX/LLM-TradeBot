import {
  AgentConfigSchema,
  AgentTemplateSchema,
  MarketPackDefinitionSchema,
  PipelineGraphVersionSchema,
  SCHEMA_VERSION,
  type AgentConfig,
  type AgentPort,
  type AgentRole,
  type AgentTemplate,
  type FailurePolicy,
  type PipelineEdge,
  type PipelineNode,
} from "../../contracts/src/index.js";

const createdAt = new Date("2026-07-26T00:00:00.000Z");
const marketPackRef = "market-pack:crypto:v1";
const market = "crypto";
const configSchemaRef = "tradebot.agent-config.v1";
const schemas = {
  cycle: "tradebot.cycle-request.v1",
  universe: "tradebot.universe-set.v1",
  snapshot: "tradebot.multi-timeframe-snapshot.v1",
  analysis: "tradebot.analysis-bundle.v1",
  directionalCase: "tradebot.directional-case.v1",
  decision: "tradebot.decision-bundle.v1",
  risk: "tradebot.risk-decision.v1",
  execution: "tradebot.execution-result.v1",
  position: "tradebot.open-position.v1",
  closedTrades: "tradebot.closed-trades.v1",
  reflection: "tradebot.reflection-report.v1",
};

export const CURRENT_CRYPTO_MARKET_PACK = MarketPackDefinitionSchema.parse({
  schemaVersion: SCHEMA_VERSION,
  marketPackId: marketPackRef,
  name: "Crypto 24x7 Market Pack",
  humanReadableVersion: "1.0.0",
  fingerprint: "sha256:crypto-market-pack-v1",
  lifecycleStatus: "active",
  createdAt,
  market,
  timezone: "UTC",
  tradingCalendar: "calendar:crypto-24x7:v1",
  marketSchemaRef: "tradebot.market.crypto.v1",
  schemaRefs: ["tradebot.market.crypto.v1", "tradebot.market.ohlcv.v1"],
  capabilities: ["continuous_trading", "perpetual_futures", "paper_execution"],
  executionModes: ["backtest", "paper", "read_only"],
});

const port = (
  portId: string,
  schemaRefs: string | string[],
  required = true,
  external = false,
): AgentPort => ({
  portId,
  schemaRefs: Array.isArray(schemaRefs) ? schemaRefs : [schemaRefs],
  required,
  external,
});

const template = (input: {
  id: string;
  name: string;
  role: AgentRole;
  implementationRef: string;
  inputs: AgentPort[];
  outputs: AgentPort[];
  dataTypes?: AgentTemplate["supportedDataTypes"];
  permissions: AgentTemplate["permissions"];
  timeout?: AgentTemplate["timeoutPolicy"];
}): AgentTemplate => AgentTemplateSchema.parse({
  schemaVersion: SCHEMA_VERSION,
  templateId: input.id,
  name: input.name,
  role: input.role,
  implementationRef: input.implementationRef,
  configSchemaRef,
  humanReadableVersion: "1.0.0",
  fingerprint: `sha256:${input.id}:v1`,
  lifecycleStatus: "active",
  createdAt,
  inputPorts: input.inputs,
  outputPorts: input.outputs,
  supportedMarkets: [market],
  supportedMarketPackRefs: [marketPackRef],
  supportedDataTypes: input.dataTypes ?? [],
  permissions: input.permissions,
  timeoutPolicy: input.timeout ?? { maxDurationMs: 15_000, onTimeout: "fail" },
  fallbackPolicy: { supported: false, fallbackTemplateIds: [] },
  allowsFeedback: false,
});

export const CURRENT_CRYPTO_AGENT_TEMPLATES: readonly AgentTemplate[] = [
  template({
    id: "agent-template:selector:v1",
    name: "Selector",
    role: "selector",
    implementationRef: "MarketOpportunitySelectorAgent",
    inputs: [port("cycle", schemas.cycle, true, true)],
    outputs: [port("universe", schemas.universe)],
    permissions: ["observe"],
  }),
  template({
    id: "agent-template:data-sync:v1",
    name: "Data Sync",
    role: "data_sync",
    implementationRef: "HistoricalDataSyncAgent",
    inputs: [
      port("universe", schemas.universe),
      port("market_data", "tradebot.market.ohlcv.v1", true, true),
    ],
    outputs: [port("snapshot", schemas.snapshot)],
    dataTypes: ["ohlcv"],
    permissions: ["observe"],
  }),
  template({
    id: "agent-template:data-quality:v1",
    name: "Data Quality",
    role: "data_quality",
    implementationRef: "RuleDataQualityAgent",
    inputs: [port("snapshot", schemas.snapshot)],
    outputs: [port("snapshot", schemas.snapshot)],
    permissions: ["analyze"],
  }),
  template({
    id: "agent-template:analysis:v1",
    name: "Analysis",
    role: "analysis",
    implementationRef: "MultiPeriodAnalysisAgent",
    inputs: [port("snapshot", schemas.snapshot)],
    outputs: [port("analysis", schemas.analysis)],
    permissions: ["analyze"],
  }),
  template({
    id: "agent-template:bull-case:v1",
    name: "Bull Case",
    role: "bull_case",
    implementationRef: "RuleBullCaseAgent",
    inputs: [port("analysis", schemas.analysis)],
    outputs: [port("case", schemas.directionalCase)],
    permissions: ["analyze"],
  }),
  template({
    id: "agent-template:bear-case:v1",
    name: "Bear Case",
    role: "bear_case",
    implementationRef: "RuleBearCaseAgent",
    inputs: [port("analysis", schemas.analysis)],
    outputs: [port("case", schemas.directionalCase)],
    permissions: ["analyze"],
  }),
  template({
    id: "agent-template:decision:v1",
    name: "Decision",
    role: "decision",
    implementationRef: "RuleDecisionAgent",
    inputs: [
      port("snapshot", schemas.snapshot),
      port("analysis", schemas.analysis),
      port("bull_case", schemas.directionalCase),
      port("bear_case", schemas.directionalCase),
    ],
    outputs: [port("decision", schemas.decision)],
    permissions: ["propose_decision"],
  }),
  template({
    id: "agent-template:position-monitor:v1",
    name: "Position Monitor",
    role: "position_monitor",
    implementationRef: "RulePositionMonitorAgent",
    inputs: [
      port("snapshot", schemas.snapshot),
      port("analysis", schemas.analysis),
      port("position", schemas.position, true, true),
    ],
    outputs: [port("decision", schemas.decision)],
    permissions: ["propose_close_only"],
  }),
  template({
    id: "agent-template:portfolio:v1",
    name: "Portfolio",
    role: "portfolio",
    implementationRef: "SingleOpportunityPortfolioAgent",
    inputs: [port("proposals", schemas.decision)],
    outputs: [port("decision", schemas.decision)],
    permissions: ["allocate_portfolio"],
  }),
  template({
    id: "agent-template:risk:v1",
    name: "Risk",
    role: "risk",
    implementationRef: "RuleRiskAgent",
    inputs: [port("decision", schemas.decision)],
    outputs: [port("risk", schemas.risk)],
    permissions: ["veto_risk"],
  }),
  template({
    id: "agent-template:execution:v1",
    name: "Execution",
    role: "execution",
    implementationRef: "PersistentPaperExecutionAgent",
    inputs: [port("decision", schemas.decision), port("risk", schemas.risk)],
    outputs: [port("result", schemas.execution)],
    permissions: ["execute_paper"],
  }),
  template({
    id: "agent-template:reflection:v1",
    name: "Reflection",
    role: "reflection",
    implementationRef: "BoundedReflectionAgent",
    inputs: [
      port("execution", schemas.execution, false),
      port("closed_trades", schemas.closedTrades, true, true),
    ],
    outputs: [port("reflection", schemas.reflection)],
    permissions: ["reflect"],
    timeout: { maxDurationMs: 15_000, onTimeout: "continue_degraded" },
  }),
];

const config = (
  id: string,
  templateId: string,
  input: Pick<AgentConfig, "dataSourceRefs" | "observationRequests"> = {
    dataSourceRefs: [],
    observationRequests: [],
  },
): AgentConfig => AgentConfigSchema.parse({
  schemaVersion: SCHEMA_VERSION,
  agentConfigId: id,
  templateId,
  templateVersion: "1.0.0",
  humanReadableVersion: "1.0.0",
  fingerprint: `sha256:${id}:v1`,
  lifecycleStatus: "active",
  createdAt,
  market,
  marketPackRef,
  schemaRefs: [configSchemaRef],
  dataSourceRefs: input.dataSourceRefs,
  observationRequests: input.observationRequests,
  config: {},
});

export const CURRENT_CRYPTO_AGENT_CONFIGS: readonly AgentConfig[] = [
  config("agent-config:selector:v1", "agent-template:selector:v1"),
  config("agent-config:data-sync:v1", "agent-template:data-sync:v1", {
    dataSourceRefs: ["data-source:binance-futures-public"],
    observationRequests: [
      {
        portId: "market_data",
        dataSourceId: "data-source:binance-futures-public",
        capabilityId: "capability:binance-futures-public:ohlcv:v1",
        window: { kind: "bar_interval", value: 5, unit: "minute" },
        requirement: "required",
      },
      {
        portId: "market_data",
        dataSourceId: "data-source:binance-futures-public",
        capabilityId: "capability:binance-futures-public:ohlcv:v1",
        window: { kind: "bar_interval", value: 15, unit: "minute" },
        requirement: "required",
      },
      {
        portId: "market_data",
        dataSourceId: "data-source:binance-futures-public",
        capabilityId: "capability:binance-futures-public:ohlcv:v1",
        window: { kind: "bar_interval", value: 1, unit: "hour" },
        requirement: "required",
      },
    ],
  }),
  config("agent-config:data-quality:v1", "agent-template:data-quality:v1"),
  config("agent-config:analysis:v1", "agent-template:analysis:v1"),
  config("agent-config:bull-case:v1", "agent-template:bull-case:v1"),
  config("agent-config:bear-case:v1", "agent-template:bear-case:v1"),
  config("agent-config:decision:v1", "agent-template:decision:v1"),
  config("agent-config:position-monitor:v1", "agent-template:position-monitor:v1"),
  config("agent-config:portfolio:v1", "agent-template:portfolio:v1"),
  config("agent-config:risk:v1", "agent-template:risk:v1"),
  config("agent-config:execution:v1", "agent-template:execution:v1"),
  config("agent-config:reflection:v1", "agent-template:reflection:v1"),
];

const requiredPolicy: FailurePolicy = { mode: "required", onFailure: "block_openings" };
const optionalPolicy: FailurePolicy = { mode: "optional", onFailure: "continue_degraded" };
const node = (
  nodeId: string,
  displayName: string,
  agentConfigId: string,
  required = true,
): PipelineNode => ({
  nodeId,
  displayName,
  agentConfigId,
  required,
  failurePolicy: required ? requiredPolicy : optionalPolicy,
});
const edge = (
  edgeId: string,
  fromNodeId: string,
  fromPort: string,
  toNodeId: string,
  toPort: string,
  kind: PipelineEdge["kind"] = "data",
): PipelineEdge => ({
  edgeId,
  fromNodeId,
  fromPort,
  toNodeId,
  toPort,
  kind,
  required: kind !== "post_process",
});

export const CURRENT_CRYPTO_PIPELINE_GRAPH = PipelineGraphVersionSchema.parse({
  schemaVersion: SCHEMA_VERSION,
  pipelineGraphId: "pipeline-graph:current-crypto-fixed",
  name: "Current Fixed Crypto Decision Pipeline",
  humanReadableVersion: "1.0.0",
  fingerprint: "sha256:current-fixed-crypto-pipeline-graph-v1",
  lifecycleStatus: "validated",
  createdAt,
  market,
  marketPackRef,
  schemaRefs: Object.values(schemas),
  dataSourceRefs: ["data-source:binance-futures-public"],
  nodes: [
    node("selector", "Selector", "agent-config:selector:v1"),
    node("data-sync", "Data Sync", "agent-config:data-sync:v1"),
    node("data-quality", "Data Quality", "agent-config:data-quality:v1"),
    node("analysis", "Analysis", "agent-config:analysis:v1"),
    node("bull-case", "Bull Case", "agent-config:bull-case:v1"),
    node("bear-case", "Bear Case", "agent-config:bear-case:v1"),
    node("decision", "Decision", "agent-config:decision:v1"),
    node("position-monitor", "Position Monitor", "agent-config:position-monitor:v1"),
    node("portfolio", "Portfolio", "agent-config:portfolio:v1"),
    node("risk", "Risk", "agent-config:risk:v1"),
    node("execution", "Execution", "agent-config:execution:v1"),
    node("reflection", "Reflection", "agent-config:reflection:v1", false),
  ],
  edges: [
    edge("edge:selector:data-sync", "selector", "universe", "data-sync", "universe"),
    edge("edge:data-sync:data-quality", "data-sync", "snapshot", "data-quality", "snapshot"),
    edge("edge:data-quality:analysis", "data-quality", "snapshot", "analysis", "snapshot"),
    edge("edge:data-quality:position-monitor", "data-quality", "snapshot", "position-monitor", "snapshot"),
    edge("edge:analysis:bull-case", "analysis", "analysis", "bull-case", "analysis"),
    edge("edge:analysis:bear-case", "analysis", "analysis", "bear-case", "analysis"),
    edge("edge:analysis:decision", "analysis", "analysis", "decision", "analysis"),
    edge("edge:data-quality:decision", "data-quality", "snapshot", "decision", "snapshot"),
    edge("edge:analysis:position-monitor", "analysis", "analysis", "position-monitor", "analysis"),
    edge("edge:bull-case:decision", "bull-case", "case", "decision", "bull_case"),
    edge("edge:bear-case:decision", "bear-case", "case", "decision", "bear_case"),
    edge("edge:decision:portfolio", "decision", "decision", "portfolio", "proposals"),
    edge("edge:position-monitor:portfolio", "position-monitor", "decision", "portfolio", "proposals"),
    edge("edge:portfolio:risk", "portfolio", "decision", "risk", "decision"),
    edge("edge:portfolio:execution", "portfolio", "decision", "execution", "decision"),
    edge("edge:risk:execution", "risk", "risk", "execution", "risk"),
    edge("edge:execution:reflection", "execution", "result", "reflection", "execution", "post_process"),
  ],
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
