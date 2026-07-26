import {
  AgentConfigSchema,
  AgentTemplateSchema,
  DataLineageSchema,
  DataSourceCapabilitySchema,
  DataSourceDefinitionSchema,
  PipelineGraphVersionSchema,
  SCHEMA_VERSION,
  type AgentConfig,
  type AgentRole,
  type AgentTemplate,
  type DataLineage,
  type DataSourceCapability,
  type MarketDataType,
  type ObservationWindow,
  type PipelineGraphVersion,
} from "../../packages/contracts/src/index.js";
import { CURRENT_CRYPTO_MARKET_PACK } from "../../packages/core/src/current-crypto-pipeline-graph.js";
import type { PipelineValidationContext } from "../../packages/core/src/pipeline-graph-validator.js";

const createdAt = new Date("2026-07-26T00:00:00.000Z");
const market = "crypto";
const marketPackRef = CURRENT_CRYPTO_MARKET_PACK.marketPackId;
const artifactSchema = "fixture.market-artifact.v1";
const analysisSchema = "fixture.analysis.v1";
const decisionSchema = "fixture.decision.v1";
const riskSchema = "fixture.risk.v1";
const executionSchema = "fixture.execution.v1";

const windowKey = (window: ObservationWindow): string => `${window.kind}:${window.value}:${window.unit}`;

const makeTemplate = (
  id: string,
  role: AgentRole,
  inputs: Array<[string, string, boolean, boolean]>,
  outputs: Array<[string, string]>,
  permissions: AgentTemplate["permissions"],
  dataTypes: MarketDataType[] = [],
): AgentTemplate => AgentTemplateSchema.parse({
  schemaVersion: SCHEMA_VERSION,
  templateId: id,
  name: id,
  role,
  implementationRef: `fixture:${id}`,
  configSchemaRef: "fixture.agent-config.v1",
  humanReadableVersion: "1.0.0",
  fingerprint: `sha256:${id}`,
  lifecycleStatus: "validated",
  createdAt,
  inputPorts: inputs.map(([portId, schemaRef, required, external]) => ({
    portId,
    schemaRefs: [schemaRef],
    required,
    external,
  })),
  outputPorts: outputs.map(([portId, schemaRef]) => ({
    portId,
    schemaRefs: [schemaRef],
    required: true,
    external: false,
  })),
  supportedMarkets: [market],
  supportedMarketPackRefs: [marketPackRef],
  supportedDataTypes: dataTypes,
  permissions,
  timeoutPolicy: { maxDurationMs: 1_000, onTimeout: "fail" },
  fallbackPolicy: { supported: false, fallbackTemplateIds: [] },
  allowsFeedback: false,
});

const makeSource = (
  sourceId: string,
  dataType: MarketDataType,
  windows: ObservationWindow[],
  aggregationAllowed = false,
): { definition: ReturnType<typeof DataSourceDefinitionSchema.parse>; capability: DataSourceCapability } => {
  const capabilityId = `capability:${sourceId}`;
  const schemaRef = `fixture.${dataType}.v1`;
  return {
    definition: DataSourceDefinitionSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      dataSourceId: sourceId,
      name: sourceId,
      provider: "Fixture",
      sourceKind: dataType === "news" ? "event_feed" : "historical_file",
      connectorRef: `connector:${sourceId}`,
      humanReadableVersion: "1.0.0",
      fingerprint: `sha256:${sourceId}`,
      lifecycleStatus: "validated",
      createdAt,
      marketPackRefs: [marketPackRef],
      marketSchemaRefs: [schemaRef],
      capabilityRefs: [capabilityId],
      readOnly: true,
    }),
    capability: DataSourceCapabilitySchema.parse({
      schemaVersion: SCHEMA_VERSION,
      capabilityId,
      dataSourceId: sourceId,
      humanReadableVersion: "1.0.0",
      fingerprint: `sha256:${capabilityId}:${windows.map(windowKey).join(",")}`,
      lifecycleStatus: "validated",
      createdAt,
      markets: [market],
      marketPackRefs: [marketPackRef],
      schemaRefs: [schemaRef],
      dataTypes: [dataType],
      nativeObservationWindows: windows,
      supportsRealtime: dataType === "news",
      timezone: "UTC",
      timestampSemantics: dataType === "news" ? "publish_time" : "close_time",
      tradingCalendar: "calendar:crypto-24x7:v1",
      aggregation: {
        allowed: aggregationAllowed,
        transformerVersion: aggregationAllowed ? "fixture-aggregator:v1" : undefined,
        closedWindowsOnly: true,
      },
      completeness: 1,
    }),
  };
};

const makeConfig = (
  id: string,
  templateId: string,
  sourceId?: string,
  capabilityId?: string,
  windows: ObservationWindow[] = [],
): AgentConfig => AgentConfigSchema.parse({
  schemaVersion: SCHEMA_VERSION,
  agentConfigId: id,
  templateId,
  templateVersion: "1.0.0",
  humanReadableVersion: "1.0.0",
  fingerprint: `sha256:${id}:${windows.map(windowKey).join(",")}`,
  lifecycleStatus: "validated",
  createdAt,
  market,
  marketPackRef,
  schemaRefs: ["fixture.agent-config.v1"],
  dataSourceRefs: sourceId ? [sourceId] : [],
  observationRequests: sourceId && capabilityId
    ? windows.map((window) => ({
      portId: "market_data",
      dataSourceId: sourceId,
      capabilityId,
      window,
      requirement: "required" as const,
    }))
    : [],
  config: {},
});

const buildFixture = (input: {
  id: string;
  dataType: MarketDataType;
  nativeWindows: ObservationWindow[];
  requestedWindows: ObservationWindow[];
  aggregationAllowed?: boolean;
  lineage?: DataLineage[];
  incompatibleSchema?: boolean;
  omitRisk?: boolean;
}): { graph: PipelineGraphVersion; context: PipelineValidationContext } => {
  const source = makeSource(
    `data-source:${input.id}`,
    input.dataType,
    input.nativeWindows,
    input.aggregationAllowed,
  );
  const sourceTemplate = makeTemplate(
    `template:${input.id}:source`,
    "data_sync",
    [["market_data", `fixture.${input.dataType}.v1`, true, true]],
    [["artifact", artifactSchema]],
    ["observe"],
    [input.dataType],
  );
  const analysisTemplate = makeTemplate(
    `template:${input.id}:analysis`,
    "analysis",
    [["artifact", input.incompatibleSchema ? "fixture.incompatible.v1" : artifactSchema, true, false]],
    [["analysis", analysisSchema]],
    ["analyze"],
  );
  const decisionTemplate = makeTemplate(
    `template:${input.id}:decision`,
    "decision",
    [["analysis", analysisSchema, true, false]],
    [["decision", decisionSchema]],
    ["propose_decision"],
  );
  const portfolioTemplate = makeTemplate(
    `template:${input.id}:portfolio`,
    "portfolio",
    [["proposals", decisionSchema, true, false]],
    [["decision", decisionSchema]],
    ["allocate_portfolio"],
  );
  const riskTemplate = makeTemplate(
    `template:${input.id}:risk`,
    "risk",
    [["decision", decisionSchema, true, false]],
    [["risk", riskSchema]],
    ["veto_risk"],
  );
  const executionTemplate = makeTemplate(
    `template:${input.id}:execution`,
    "execution",
    [
      ["decision", decisionSchema, true, false],
      ["risk", riskSchema, true, false],
    ],
    [["result", executionSchema]],
    ["execute_paper"],
  );
  const templates = [
    sourceTemplate,
    analysisTemplate,
    decisionTemplate,
    portfolioTemplate,
    riskTemplate,
    executionTemplate,
  ];
  const configs = templates.map((template) => makeConfig(
    `config:${input.id}:${template.role}`,
    template.templateId,
    template.role === "data_sync" ? source.definition.dataSourceId : undefined,
    template.role === "data_sync" ? source.capability.capabilityId : undefined,
    template.role === "data_sync" ? input.requestedWindows : [],
  ));
  const nodes = templates
    .filter((template) => !input.omitRisk || template.role !== "risk")
    .map((template) => ({
      nodeId: template.role,
      displayName: template.name,
      agentConfigId: `config:${input.id}:${template.role}`,
      required: true,
      failurePolicy: { mode: "required" as const, onFailure: "block_openings" as const },
    }));
  const edges = [
    {
      edgeId: "edge:source-analysis",
      fromNodeId: "data_sync",
      fromPort: "artifact",
      toNodeId: "analysis",
      toPort: "artifact",
      kind: "data" as const,
      required: true,
    },
    {
      edgeId: "edge:analysis-decision",
      fromNodeId: "analysis",
      fromPort: "analysis",
      toNodeId: "decision",
      toPort: "analysis",
      kind: "data" as const,
      required: true,
    },
    {
      edgeId: "edge:decision-portfolio",
      fromNodeId: "decision",
      fromPort: "decision",
      toNodeId: "portfolio",
      toPort: "proposals",
      kind: "data" as const,
      required: true,
    },
    {
      edgeId: "edge:portfolio-execution",
      fromNodeId: "portfolio",
      fromPort: "decision",
      toNodeId: "execution",
      toPort: "decision",
      kind: "data" as const,
      required: true,
    },
    ...input.omitRisk ? [] : [
      {
        edgeId: "edge:portfolio-risk",
        fromNodeId: "portfolio",
        fromPort: "decision",
        toNodeId: "risk",
        toPort: "decision",
        kind: "data" as const,
        required: true,
      },
      {
        edgeId: "edge:risk-execution",
        fromNodeId: "risk",
        fromPort: "risk",
        toNodeId: "execution",
        toPort: "risk",
        kind: "data" as const,
        required: true,
      },
    ],
  ];
  const graph = PipelineGraphVersionSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    pipelineGraphId: `pipeline:${input.id}`,
    name: input.id,
    humanReadableVersion: "1.0.0",
    fingerprint: `sha256:pipeline:${input.id}`,
    lifecycleStatus: "validated",
    createdAt,
    market,
    marketPackRef,
    schemaRefs: [artifactSchema, analysisSchema, decisionSchema, riskSchema, executionSchema],
    dataSourceRefs: [source.definition.dataSourceId],
    nodes,
    edges,
    entryNodeIds: ["data_sync"],
    terminalNodeIds: ["execution"],
    dataLineage: input.lineage ?? [],
    releaseGates: [
      "contract_validation",
      "backtest",
      "walk_forward",
      "human_approval",
      "paper_running",
    ],
  });
  return {
    graph,
    context: {
      marketPacks: [CURRENT_CRYPTO_MARKET_PACK],
      dataSources: [source.definition],
      capabilities: [source.capability],
      agentTemplates: templates,
      agentConfigs: configs,
    },
  };
};

const bar = (value: number, unit: ObservationWindow["unit"]): ObservationWindow => ({
  kind: "bar_interval",
  value,
  unit,
});

export const nativeThreeWindowFixture = buildFixture({
  id: "native-three-window",
  dataType: "ohlcv",
  nativeWindows: [bar(5, "minute"), bar(15, "minute"), bar(1, "hour")],
  requestedWindows: [bar(5, "minute"), bar(15, "minute"), bar(1, "hour")],
});

export const dailySingleWindowFixture = buildFixture({
  id: "daily-single-window",
  dataType: "ohlcv",
  nativeWindows: [bar(1, "day")],
  requestedWindows: [bar(1, "day")],
});

export const calendarMultiWindowFixture = buildFixture({
  id: "calendar-multi-window",
  dataType: "ohlcv",
  nativeWindows: [bar(1, "day"), bar(1, "week"), bar(1, "month")],
  requestedWindows: [bar(1, "day"), bar(1, "week"), bar(1, "month")],
});

export const eventOnlyFixture = buildFixture({
  id: "event-only",
  dataType: "news",
  nativeWindows: [{ kind: "event_batch", value: 50, unit: "hour" }],
  requestedWindows: [{ kind: "event_batch", value: 50, unit: "hour" }],
});

export const dailyToFiveMinuteFixture = buildFixture({
  id: "daily-to-five-minute",
  dataType: "ohlcv",
  nativeWindows: [bar(1, "day")],
  requestedWindows: [bar(5, "minute")],
  aggregationAllowed: true,
});

const aggregateLineage = DataLineageSchema.parse({
  schemaVersion: SCHEMA_VERSION,
  lineageId: "lineage:five-minute-to-one-hour",
  dataSourceId: "data-source:five-minute-to-one-hour",
  capabilityId: "capability:data-source:five-minute-to-one-hour",
  humanReadableVersion: "1.0.0",
  fingerprint: "sha256:lineage:five-minute-to-one-hour",
  lifecycleStatus: "validated",
  createdAt,
  sourceWindow: bar(5, "minute"),
  targetWindow: bar(1, "hour"),
  transformation: "aggregate",
  transformerVersion: "fixture-aggregator:v1",
  timezone: "UTC",
  tradingCalendar: "calendar:crypto-24x7:v1",
  sourceSchemaRef: "fixture.ohlcv.v1",
  targetSchemaRef: "fixture.ohlcv.v1",
  asOfPolicy: "closed_windows_only",
});

export const fiveMinuteToOneHourFixture = buildFixture({
  id: "five-minute-to-one-hour",
  dataType: "ohlcv",
  nativeWindows: [bar(5, "minute")],
  requestedWindows: [bar(1, "hour")],
  aggregationAllowed: true,
  lineage: [aggregateLineage],
});

export const reverseAggregationFixture = buildFixture({
  id: "reverse-aggregation",
  dataType: "ohlcv",
  nativeWindows: [bar(1, "day")],
  requestedWindows: [bar(5, "minute")],
  aggregationAllowed: true,
});

export const missingRiskFixture = buildFixture({
  id: "missing-risk",
  dataType: "ohlcv",
  nativeWindows: [bar(1, "day")],
  requestedWindows: [bar(1, "day")],
  omitRisk: true,
});

export const schemaMismatchFixture = buildFixture({
  id: "schema-mismatch",
  dataType: "ohlcv",
  nativeWindows: [bar(1, "day")],
  requestedWindows: [bar(1, "day")],
  incompatibleSchema: true,
});
