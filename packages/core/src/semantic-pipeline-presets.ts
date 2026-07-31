import {
  SemanticPipelinePresetDefinitionSchema,
  type SemanticPipelinePresetDefinition,
} from "../../contracts/src/semantic-pipeline-preset.js";

const fingerprint = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

const createdAt = "2026-07-26T00:00:00.000Z";
const cryptoMarketPackRef = {
  id: "market-pack.crypto",
  version: "1.0.0",
  fingerprint: fingerprint("a"),
};

const schema = (name: string): string => `tradebot.semantic.${name}.v1`;

const currentCryptoPreset = SemanticPipelinePresetDefinitionSchema.parse({
  schemaVersion: "1.0.0",
  id: "preset.current-crypto-multi-agent",
  version: "1.0.0",
  displayName: "Current Crypto Multi-Agent",
  description:
    "Registered semantic baseline for the current fixed Crypto DecisionPipeline. Its 5m, 15m and 1h defaults describe current capability rather than a framework constraint.",
  fingerprint: fingerprint("b"),
  lifecycleStatus: "active",
  createdAt,
  availability: "registered_available",
  executionMode: "paper_capable",
  marketPackRefs: [cryptoMarketPackRef],
  defaultDataSourceIds: [
    "data-source.binance-futures-public",
    "data-source.csv-historical",
  ],
  requiredCapabilityKinds: ["bar"],
  graphVersionRef: {
    id: "pipeline-graph.current-crypto-fixed",
    version: "1.0.0",
    fingerprint: fingerprint("c"),
  },
  observationWindows: [
    { id: "window.crypto.5m", kind: "bar_interval", label: "5m", unit: "minute", value: 5, capabilityMode: "native" },
    { id: "window.crypto.15m", kind: "bar_interval", label: "15m", unit: "minute", value: 15, capabilityMode: "native" },
    { id: "window.crypto.1h", kind: "bar_interval", label: "1h", unit: "hour", value: 1, capabilityMode: "native" },
  ],
  nodes: [
    { nodeId: "selector", role: "selector", agentTemplateId: "agent-template.selector", observationWindowIds: [], authority: "none", inputArtifactTypes: [schema("candidate_pool")], outputArtifactTypes: [schema("selected_symbol")] },
    { nodeId: "data-sync", role: "data_sync", agentTemplateId: "agent-template.data-sync", observationWindowIds: ["window.crypto.5m", "window.crypto.15m", "window.crypto.1h"], authority: "none", inputArtifactTypes: [schema("selected_symbol")], outputArtifactTypes: ["market_observation"] },
    { nodeId: "data-quality", role: "data_quality", agentTemplateId: "agent-template.data-quality", observationWindowIds: ["window.crypto.5m", "window.crypto.15m", "window.crypto.1h"], authority: "none", inputArtifactTypes: ["market_observation"], outputArtifactTypes: [schema("data_quality")] },
    { nodeId: "analysis-5m", role: "window_analysis", agentTemplateId: "agent-template.timeframe-analysis", observationWindowIds: ["window.crypto.5m"], authority: "none", inputArtifactTypes: ["market_observation", schema("data_quality")], outputArtifactTypes: ["agent_semantic_assessment"] },
    { nodeId: "analysis-15m", role: "window_analysis", agentTemplateId: "agent-template.timeframe-analysis", observationWindowIds: ["window.crypto.15m"], authority: "none", inputArtifactTypes: ["market_observation", schema("data_quality")], outputArtifactTypes: ["agent_semantic_assessment"] },
    { nodeId: "analysis-1h", role: "window_analysis", agentTemplateId: "agent-template.timeframe-analysis", observationWindowIds: ["window.crypto.1h"], authority: "none", inputArtifactTypes: ["market_observation", schema("data_quality")], outputArtifactTypes: ["agent_semantic_assessment"] },
    { nodeId: "bull", role: "bull_research", agentTemplateId: "agent-template.bull-research", observationWindowIds: [], authority: "none", inputArtifactTypes: ["agent_semantic_assessment"], outputArtifactTypes: ["agent_semantic_assessment"] },
    { nodeId: "bear", role: "bear_research", agentTemplateId: "agent-template.bear-research", observationWindowIds: [], authority: "none", inputArtifactTypes: ["agent_semantic_assessment"], outputArtifactTypes: ["agent_semantic_assessment"] },
    { nodeId: "position-monitor", role: "position_monitor", agentTemplateId: "agent-template.position-monitor", observationWindowIds: [], authority: "none", inputArtifactTypes: [schema("position_state"), "market_observation"], outputArtifactTypes: ["agent_semantic_assessment"] },
    { nodeId: "decision", role: "decision", agentTemplateId: "agent-template.decision", observationWindowIds: [], authority: "decision_intent", inputArtifactTypes: ["decision_semantic_context"], outputArtifactTypes: ["decision_semantic_context", "semantic_decision"] },
    { nodeId: "portfolio", role: "portfolio", agentTemplateId: "agent-template.portfolio", observationWindowIds: [], authority: "portfolio_action", inputArtifactTypes: ["semantic_decision"], outputArtifactTypes: [schema("portfolio_action")] },
    { nodeId: "risk", role: "risk", agentTemplateId: "agent-template.risk", observationWindowIds: [], authority: "risk_gate", inputArtifactTypes: [schema("portfolio_action")], outputArtifactTypes: [schema("risk_decision")] },
    { nodeId: "execution", role: "execution", agentTemplateId: "agent-template.paper-execution", observationWindowIds: [], authority: "execution", inputArtifactTypes: [schema("risk_decision")], outputArtifactTypes: [schema("execution_result")] },
    { nodeId: "reflection", role: "reflection", agentTemplateId: "agent-template.reflection", observationWindowIds: [], authority: "none", inputArtifactTypes: [schema("execution_result"), "semantic_decision"], outputArtifactTypes: ["reflection_lesson_candidate"] },
  ],
  edges: [
    { edgeId: "selector-data-sync", sourceNodeId: "selector", targetNodeId: "data-sync", artifactType: schema("selected_symbol"), policy: "required" },
    { edgeId: "data-sync-quality", sourceNodeId: "data-sync", targetNodeId: "data-quality", artifactType: "market_observation", policy: "required" },
    { edgeId: "data-sync-analysis-5m", sourceNodeId: "data-sync", targetNodeId: "analysis-5m", artifactType: "market_observation", policy: "required" },
    { edgeId: "quality-analysis-5m", sourceNodeId: "data-quality", targetNodeId: "analysis-5m", artifactType: schema("data_quality"), policy: "required" },
    { edgeId: "data-sync-analysis-15m", sourceNodeId: "data-sync", targetNodeId: "analysis-15m", artifactType: "market_observation", policy: "required" },
    { edgeId: "quality-analysis-15m", sourceNodeId: "data-quality", targetNodeId: "analysis-15m", artifactType: schema("data_quality"), policy: "required" },
    { edgeId: "data-sync-analysis-1h", sourceNodeId: "data-sync", targetNodeId: "analysis-1h", artifactType: "market_observation", policy: "required" },
    { edgeId: "quality-analysis-1h", sourceNodeId: "data-quality", targetNodeId: "analysis-1h", artifactType: schema("data_quality"), policy: "required" },
    { edgeId: "data-sync-position-monitor", sourceNodeId: "data-sync", targetNodeId: "position-monitor", artifactType: "market_observation", policy: "required" },
    { edgeId: "analysis-5m-bull", sourceNodeId: "analysis-5m", targetNodeId: "bull", artifactType: "agent_semantic_assessment", policy: "required" },
    { edgeId: "analysis-15m-bull", sourceNodeId: "analysis-15m", targetNodeId: "bull", artifactType: "agent_semantic_assessment", policy: "required" },
    { edgeId: "analysis-1h-bull", sourceNodeId: "analysis-1h", targetNodeId: "bull", artifactType: "agent_semantic_assessment", policy: "required" },
    { edgeId: "analysis-5m-bear", sourceNodeId: "analysis-5m", targetNodeId: "bear", artifactType: "agent_semantic_assessment", policy: "required" },
    { edgeId: "analysis-15m-bear", sourceNodeId: "analysis-15m", targetNodeId: "bear", artifactType: "agent_semantic_assessment", policy: "required" },
    { edgeId: "analysis-1h-bear", sourceNodeId: "analysis-1h", targetNodeId: "bear", artifactType: "agent_semantic_assessment", policy: "required" },
    { edgeId: "bull-decision", sourceNodeId: "bull", targetNodeId: "decision", artifactType: "agent_semantic_assessment", policy: "required" },
    { edgeId: "bear-decision", sourceNodeId: "bear", targetNodeId: "decision", artifactType: "agent_semantic_assessment", policy: "required" },
    { edgeId: "position-monitor-decision", sourceNodeId: "position-monitor", targetNodeId: "decision", artifactType: "agent_semantic_assessment", policy: "required" },
    { edgeId: "decision-portfolio", sourceNodeId: "decision", targetNodeId: "portfolio", artifactType: "semantic_decision", policy: "required" },
    { edgeId: "portfolio-risk", sourceNodeId: "portfolio", targetNodeId: "risk", artifactType: schema("portfolio_action"), policy: "required" },
    { edgeId: "risk-execution", sourceNodeId: "risk", targetNodeId: "execution", artifactType: schema("risk_decision"), policy: "required" },
    { edgeId: "execution-reflection", sourceNodeId: "execution", targetNodeId: "reflection", artifactType: schema("execution_result"), policy: "required" },
    { edgeId: "decision-reflection", sourceNodeId: "decision", targetNodeId: "reflection", artifactType: "semantic_decision", policy: "required" },
  ],
  compatibilityTarget: {
    kind: "current_fixed_pipeline",
    reference: "current-crypto-decision-pipeline",
  },
});

const dailyPreset = SemanticPipelinePresetDefinitionSchema.parse({
  schemaVersion: "1.0.0",
  id: "preset.single-window-daily",
  version: "1.0.0",
  displayName: "Single-window Daily Decision",
  description: "Capability-gated single-window daily decision template. It does not claim a currently registered daily adapter.",
  fingerprint: fingerprint("d"),
  lifecycleStatus: "draft",
  createdAt,
  availability: "capability_required",
  executionMode: "paper_capable",
  marketPackRefs: [cryptoMarketPackRef],
  defaultDataSourceIds: [],
  requiredCapabilityKinds: ["bar"],
  graphVersionRef: { id: "pipeline-graph.template-daily", version: "1.0.0", fingerprint: fingerprint("e") },
  observationWindows: [
    { id: "window.template.1d", kind: "bar_interval", label: "1d", unit: "day", value: 1, capabilityMode: "required" },
  ],
  nodes: [
    { nodeId: "data-sync", role: "data_sync", agentTemplateId: "agent-template.data-sync", observationWindowIds: ["window.template.1d"], authority: "none", inputArtifactTypes: [schema("selected_symbol")], outputArtifactTypes: ["market_observation"] },
    { nodeId: "data-quality", role: "data_quality", agentTemplateId: "agent-template.data-quality", observationWindowIds: ["window.template.1d"], authority: "none", inputArtifactTypes: ["market_observation"], outputArtifactTypes: [schema("data_quality")] },
    { nodeId: "analysis-daily", role: "window_analysis", agentTemplateId: "agent-template.timeframe-analysis", observationWindowIds: ["window.template.1d"], authority: "none", inputArtifactTypes: ["market_observation", schema("data_quality")], outputArtifactTypes: ["agent_semantic_assessment"] },
    { nodeId: "decision", role: "decision", agentTemplateId: "agent-template.decision", observationWindowIds: [], authority: "decision_intent", inputArtifactTypes: ["decision_semantic_context"], outputArtifactTypes: ["decision_semantic_context", "semantic_decision"] },
    { nodeId: "portfolio", role: "portfolio", agentTemplateId: "agent-template.portfolio", observationWindowIds: [], authority: "portfolio_action", inputArtifactTypes: ["semantic_decision"], outputArtifactTypes: [schema("portfolio_action")] },
    { nodeId: "risk", role: "risk", agentTemplateId: "agent-template.risk", observationWindowIds: [], authority: "risk_gate", inputArtifactTypes: [schema("portfolio_action")], outputArtifactTypes: [schema("risk_decision")] },
    { nodeId: "execution", role: "execution", agentTemplateId: "agent-template.paper-execution", observationWindowIds: [], authority: "execution", inputArtifactTypes: [schema("risk_decision")], outputArtifactTypes: [schema("execution_result")] },
    { nodeId: "reflection", role: "reflection", agentTemplateId: "agent-template.reflection", observationWindowIds: [], authority: "none", inputArtifactTypes: [schema("execution_result")], outputArtifactTypes: ["reflection_lesson_candidate"] },
  ],
  edges: [
    { edgeId: "data-sync-quality", sourceNodeId: "data-sync", targetNodeId: "data-quality", artifactType: "market_observation", policy: "required" },
    { edgeId: "data-sync-analysis", sourceNodeId: "data-sync", targetNodeId: "analysis-daily", artifactType: "market_observation", policy: "required" },
    { edgeId: "quality-analysis", sourceNodeId: "data-quality", targetNodeId: "analysis-daily", artifactType: schema("data_quality"), policy: "required" },
    { edgeId: "analysis-decision", sourceNodeId: "analysis-daily", targetNodeId: "decision", artifactType: "agent_semantic_assessment", policy: "required" },
    { edgeId: "decision-portfolio", sourceNodeId: "decision", targetNodeId: "portfolio", artifactType: "semantic_decision", policy: "required" },
    { edgeId: "portfolio-risk", sourceNodeId: "portfolio", targetNodeId: "risk", artifactType: schema("portfolio_action"), policy: "required" },
    { edgeId: "risk-execution", sourceNodeId: "risk", targetNodeId: "execution", artifactType: schema("risk_decision"), policy: "required" },
    { edgeId: "execution-reflection", sourceNodeId: "execution", targetNodeId: "reflection", artifactType: schema("execution_result"), policy: "required" },
  ],
  compatibilityTarget: { kind: "contract_template", reference: "single-window-daily" },
});

const eventOnlyPreset = SemanticPipelinePresetDefinitionSchema.parse({
  schemaVersion: "1.0.0",
  id: "preset.event-only-research",
  version: "1.0.0",
  displayName: "Event-only Research",
  description: "Capability-gated event research template with no K-line requirement and no execution authority.",
  fingerprint: fingerprint("f"),
  lifecycleStatus: "draft",
  createdAt,
  availability: "capability_required",
  executionMode: "research_only",
  marketPackRefs: [cryptoMarketPackRef],
  defaultDataSourceIds: [],
  requiredCapabilityKinds: ["event"],
  graphVersionRef: { id: "pipeline-graph.template-event-research", version: "1.0.0", fingerprint: fingerprint("0") },
  observationWindows: [
    { id: "window.template.event-batch", kind: "event_batch", label: "Event batch", unit: "hour", value: 1, capabilityMode: "required" },
  ],
  nodes: [
    { nodeId: "event-sync", role: "data_sync", agentTemplateId: "agent-template.event-sync", observationWindowIds: ["window.template.event-batch"], authority: "none", inputArtifactTypes: [schema("event_query")], outputArtifactTypes: ["market_observation"] },
    { nodeId: "event-quality", role: "data_quality", agentTemplateId: "agent-template.data-quality", observationWindowIds: ["window.template.event-batch"], authority: "none", inputArtifactTypes: ["market_observation"], outputArtifactTypes: [schema("data_quality")] },
    { nodeId: "event-analysis", role: "window_analysis", agentTemplateId: "agent-template.event-analysis", observationWindowIds: ["window.template.event-batch"], authority: "none", inputArtifactTypes: ["market_observation", schema("data_quality")], outputArtifactTypes: ["agent_semantic_assessment"] },
    { nodeId: "research-synthesis", role: "research_synthesis", agentTemplateId: "agent-template.research-synthesis", observationWindowIds: [], authority: "none", inputArtifactTypes: ["agent_semantic_assessment"], outputArtifactTypes: ["agent_semantic_assessment"] },
  ],
  edges: [
    { edgeId: "event-sync-quality", sourceNodeId: "event-sync", targetNodeId: "event-quality", artifactType: "market_observation", policy: "required" },
    { edgeId: "event-sync-analysis", sourceNodeId: "event-sync", targetNodeId: "event-analysis", artifactType: "market_observation", policy: "required" },
    { edgeId: "event-quality-analysis", sourceNodeId: "event-quality", targetNodeId: "event-analysis", artifactType: schema("data_quality"), policy: "required" },
    { edgeId: "event-analysis-synthesis", sourceNodeId: "event-analysis", targetNodeId: "research-synthesis", artifactType: "agent_semantic_assessment", policy: "required" },
  ],
  compatibilityTarget: { kind: "contract_template", reference: "event-only-research" },
});

const registeredPresets = [currentCryptoPreset, dailyPreset, eventOnlyPreset] as const;

export interface RegisteredSemanticPipelinePresetCatalog {
  list(): SemanticPipelinePresetDefinition[];
  get(presetId: string): SemanticPipelinePresetDefinition | undefined;
  require(presetId: string): SemanticPipelinePresetDefinition;
}

export function createRegisteredSemanticPipelinePresetCatalog(): RegisteredSemanticPipelinePresetCatalog {
  const byId = new Map(registeredPresets.map((preset) => [preset.id, preset]));
  const clone = (preset: SemanticPipelinePresetDefinition): SemanticPipelinePresetDefinition =>
    SemanticPipelinePresetDefinitionSchema.parse(preset);

  return Object.freeze({
    list: () => registeredPresets.map(clone),
    get: (presetId: string) => {
      const preset = byId.get(presetId);
      return preset ? clone(preset) : undefined;
    },
    require: (presetId: string) => {
      const preset = byId.get(presetId);
      if (!preset) throw new Error(`SEMANTIC_PRESET_NOT_REGISTERED:${presetId}`);
      return clone(preset);
    },
  });
}
