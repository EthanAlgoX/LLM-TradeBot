import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentConfigSchema,
  AgentTemplateSchema,
  DataLineageSchema,
  DataSourceCapabilitySchema,
  DataSourceDefinitionSchema,
  MarketPackDefinitionSchema,
  ObservationWindowSchema,
  PipelineEdgeSchema,
  PipelineGraphVersionSchema,
  PipelineNodeSchema,
  PipelineValidationIssueSchema,
  PipelineValidationResultSchema,
} from "../packages/contracts/src/index.js";
import {
  BINANCE_FUTURES_PUBLIC_CAPABILITY,
  BINANCE_FUTURES_PUBLIC_DATA_SOURCE,
  CSV_HISTORICAL_CAPABILITY,
  CSV_HISTORICAL_DATA_SOURCE,
} from "../packages/adapters/src/data-source-capability-manifests.js";
import {
  CURRENT_CRYPTO_AGENT_CONFIGS,
  CURRENT_CRYPTO_AGENT_TEMPLATES,
  CURRENT_CRYPTO_MARKET_PACK,
  CURRENT_CRYPTO_PIPELINE_GRAPH,
} from "../packages/core/src/current-crypto-pipeline-graph.js";
import { validatePipelineGraph } from "../packages/core/src/pipeline-graph-validator.js";
import {
  calendarMultiWindowFixture,
  dailySingleWindowFixture,
  dailyToFiveMinuteFixture,
  eventOnlyFixture,
  fiveMinuteToOneHourFixture,
  missingRiskFixture,
  nativeThreeWindowFixture,
  reverseAggregationFixture,
  schemaMismatchFixture,
} from "./fixtures/pipeline-graph-fixtures.js";

test("architecture contracts are strict Zod schemas", () => {
  assert.equal(ObservationWindowSchema.parse({ kind: "bar_interval", value: 5, unit: "minute" }).value, 5);
  assert.equal(MarketPackDefinitionSchema.parse(CURRENT_CRYPTO_MARKET_PACK).market, "crypto");
  assert.equal(DataSourceDefinitionSchema.parse(BINANCE_FUTURES_PUBLIC_DATA_SOURCE).readOnly, true);
  assert.equal(DataSourceCapabilitySchema.parse(BINANCE_FUTURES_PUBLIC_CAPABILITY).dataTypes[0], "ohlcv");
  assert.equal(AgentTemplateSchema.parse(CURRENT_CRYPTO_AGENT_TEMPLATES[0]).role, "selector");
  assert.equal(AgentConfigSchema.parse(CURRENT_CRYPTO_AGENT_CONFIGS[0]).marketPackRef, CURRENT_CRYPTO_MARKET_PACK.marketPackId);
  assert.equal(PipelineNodeSchema.parse(CURRENT_CRYPTO_PIPELINE_GRAPH.nodes[0]).nodeId, "selector");
  assert.equal(PipelineEdgeSchema.parse(CURRENT_CRYPTO_PIPELINE_GRAPH.edges[0]).kind, "data");
  assert.equal(PipelineGraphVersionSchema.parse(CURRENT_CRYPTO_PIPELINE_GRAPH).lifecycleStatus, "validated");
  assert.equal(DataLineageSchema.parse(fiveMinuteToOneHourFixture.graph.dataLineage[0]).transformation, "aggregate");
  const result = validatePipelineGraph(nativeThreeWindowFixture.graph, nativeThreeWindowFixture.context);
  assert.equal(PipelineValidationResultSchema.parse(result).valid, true);
  assert.equal(PipelineValidationIssueSchema.safeParse({
    issueId: "test",
    code: "SCHEMA_INCOMPATIBLE",
    severity: "error",
    entityType: "edge",
    path: [],
    details: {},
  }).success, true);
});

test("existing adapters declare their real fixed OHLCV capabilities", () => {
  for (const capability of [BINANCE_FUTURES_PUBLIC_CAPABILITY, CSV_HISTORICAL_CAPABILITY]) {
    assert.deepEqual(
      capability.nativeObservationWindows.map((window) => `${window.value}:${window.unit}`),
      ["5:minute", "15:minute", "1:hour"],
    );
    assert.deepEqual(capability.markets, ["crypto"]);
    assert.deepEqual(capability.dataTypes, ["ohlcv"]);
  }
  assert.equal(BINANCE_FUTURES_PUBLIC_DATA_SOURCE.readOnly, true);
  assert.equal(CSV_HISTORICAL_DATA_SOURCE.readOnly, true);
});

for (const [name, fixture] of [
  ["native 5m/15m/1h", nativeThreeWindowFixture],
  ["single 1d", dailySingleWindowFixture],
  ["native 1d/1w/1M", calendarMultiWindowFixture],
  ["news-only event batch", eventOnlyFixture],
] as const) {
  test(`${name} pipeline validates`, () => {
    const result = validatePipelineGraph(fixture.graph, fixture.context);
    assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.summary.errorCount, 0);
  });
}

test("daily data cannot satisfy a 5 minute request", () => {
  const result = validatePipelineGraph(dailyToFiveMinuteFixture.graph, dailyToFiveMinuteFixture.context);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "UPSAMPLING_FORBIDDEN"));
  assert.ok(result.issues.some((issue) => issue.code === "OBSERVATION_WINDOW_UNSUPPORTED"));
});

test("5 minute bars aggregate to 1 hour only with recorded lineage", () => {
  const result = validatePipelineGraph(fiveMinuteToOneHourFixture.graph, fiveMinuteToOneHourFixture.context);
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
  assert.equal(fiveMinuteToOneHourFixture.graph.dataLineage[0]?.transformerVersion, "fixture-aggregator:v1");
  assert.equal(fiveMinuteToOneHourFixture.graph.dataLineage[0]?.asOfPolicy, "closed_windows_only");
});

test("reverse daily-to-5-minute generation is rejected", () => {
  const result = validatePipelineGraph(reverseAggregationFixture.graph, reverseAggregationFixture.context);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "UPSAMPLING_FORBIDDEN"));
});

test("missing Risk Gate is rejected", () => {
  const result = validatePipelineGraph(missingRiskFixture.graph, missingRiskFixture.context);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "RISK_BOUNDARY_BYPASSED"));
  assert.ok(result.issues.some((issue) => issue.code === "REQUIRED_INPUT_MISSING"));
});

test("schema-incompatible edge is rejected", () => {
  const result = validatePipelineGraph(schemaMismatchFixture.graph, schemaMismatchFixture.context);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "SCHEMA_INCOMPATIBLE"));
});

test("current fixed Crypto pipeline graph manifest validates without changing runtime execution", () => {
  const result = validatePipelineGraph(CURRENT_CRYPTO_PIPELINE_GRAPH, {
    marketPacks: [CURRENT_CRYPTO_MARKET_PACK],
    dataSources: [BINANCE_FUTURES_PUBLIC_DATA_SOURCE, CSV_HISTORICAL_DATA_SOURCE],
    capabilities: [BINANCE_FUTURES_PUBLIC_CAPABILITY, CSV_HISTORICAL_CAPABILITY],
    agentTemplates: CURRENT_CRYPTO_AGENT_TEMPLATES,
    agentConfigs: CURRENT_CRYPTO_AGENT_CONFIGS,
  });
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
  assert.ok(CURRENT_CRYPTO_PIPELINE_GRAPH.nodes.some((node) => node.nodeId === "position-monitor"));
  assert.ok(CURRENT_CRYPTO_PIPELINE_GRAPH.nodes.some((node) => node.nodeId === "reflection"));
});
