import { z } from "zod";
import {
  AgentSemanticAssessmentSchema,
  ApprovedReflectionLessonSchema,
  DecisionSemanticContextSchema,
  MarketObservationArtifactSchema,
  ReflectionLessonCandidateSchema,
  SemanticDecisionArtifactSchema,
  type AgentSemanticAssessment,
  type ApprovedReflectionLesson,
  type DecisionSemanticContext,
  type MarketObservationArtifact,
  type ReflectionLessonCandidate,
  type SemanticDecisionArtifact,
  type SemanticObservationWindowReference,
} from "../../contracts/src/index.js";
import {
  HistoricalGraphExecutor,
  RegisteredHistoricalArtifactSchemaRegistry,
  RegisteredHistoricalGraphPlanRegistry,
  RegisteredHistoricalNodeExecutorRegistry,
  type HistoricalGraphArtifactDraft,
  type RegisteredHistoricalNodeExecutor,
} from "../../core/src/historical-graph-executor.js";
import { createRegisteredSemanticPipelinePresetCatalog } from "../../core/src/semantic-pipeline-presets.js";

const SelectedSymbolSchema = z.object({ symbol: z.string().min(1), candidateCount: z.number().int().positive() }).strict();
const DataQualitySchema = z.object({ status: z.enum(["pass", "degraded"]), observationArtifactIds: z.array(z.string()).min(1), issueCodes: z.array(z.string()) }).strict();
const PortfolioActionSchema = z.object({ actionId: z.string().min(1), intent: z.enum(["hold", "open_long", "open_short", "reduce", "close"]), notional: z.number().nonnegative() }).strict();
const RiskDecisionSchema = z.object({ approved: z.boolean(), reasonCodes: z.array(z.string()), action: PortfolioActionSchema }).strict();
const ExecutionResultSchema = z.object({ status: z.enum(["not_executed", "simulated_fill"]), fillId: z.string().optional(), actionId: z.string() }).strict();

const semanticType = (name: string): string => `tradebot.semantic.${name}.v1`;

export interface CurrentCryptoHistoricalExecutionPorts {
  candidateSymbols(asOf: string): Promise<readonly string[]>;
  selectSymbol(candidates: readonly string[], asOf: string): Promise<string>;
  loadObservations(
    symbol: string,
    windows: readonly SemanticObservationWindowReference[],
    asOf: string,
  ): Promise<readonly MarketObservationArtifact[]>;
  analyzeObservation(observation: MarketObservationArtifact): Promise<AgentSemanticAssessment>;
  buildDirectionalCase(
    side: "bull" | "bear",
    assessments: readonly AgentSemanticAssessment[],
    asOf: string,
  ): Promise<AgentSemanticAssessment>;
  monitorCurrentPosition(
    observations: readonly MarketObservationArtifact[],
    asOf: string,
  ): Promise<AgentSemanticAssessment>;
  decide(input: {
    observations: readonly MarketObservationArtifact[];
    assessments: readonly AgentSemanticAssessment[];
    approvedLessons: readonly ApprovedReflectionLesson[];
    asOf: string;
  }): Promise<{ context: DecisionSemanticContext; decision: SemanticDecisionArtifact }>;
  applyPortfolio(decision: SemanticDecisionArtifact): Promise<z.infer<typeof PortfolioActionSchema>>;
  evaluateRisk(action: z.infer<typeof PortfolioActionSchema>): Promise<z.infer<typeof RiskDecisionSchema>>;
  simulateExecution(risk: z.infer<typeof RiskDecisionSchema>): Promise<z.infer<typeof ExecutionResultSchema>>;
  reflect(input: {
    decision: SemanticDecisionArtifact;
    execution: z.infer<typeof ExecutionResultSchema>;
  }): Promise<ReflectionLessonCandidate | undefined>;
  synthesizeResearch(
    assessments: readonly AgentSemanticAssessment[],
    asOf: string,
  ): Promise<AgentSemanticAssessment>;
  approvedLessons(asOf: string): Promise<readonly ApprovedReflectionLesson[]>;
}

function refs(inputs: readonly { artifactId: string; artifactType: string; fingerprint: string }[]) {
  return inputs.map((input) => ({
    artifactId: input.artifactId,
    artifactType: input.artifactType,
    fingerprint: input.fingerprint,
  }));
}

function inheritedLineage(
  inputs: readonly { lineageFingerprints: readonly string[] }[],
  executionLineageFingerprint: string,
): string[] {
  const inherited = [...new Set(inputs.flatMap((input) => input.lineageFingerprints))];
  return inherited.length > 0 ? inherited : [executionLineageFingerprint];
}

function draft(
  artifactType: string,
  payload: unknown,
  asOf: string,
  inputs: readonly {
    artifactId: string;
    artifactType: string;
    fingerprint: string;
    lineageFingerprints: readonly string[];
  }[],
  executionLineageFingerprint: string,
): HistoricalGraphArtifactDraft {
  return {
    artifactType,
    payload,
    asOf,
    sourceArtifactRefs: refs(inputs),
    lineageFingerprints: inheritedLineage(inputs, executionLineageFingerprint),
  };
}

function payloads<TSchema extends z.ZodTypeAny>(
  artifacts: readonly { artifactType: string; payload: unknown }[],
  artifactType: string,
  schema: TSchema,
): z.output<TSchema>[] {
  return artifacts
    .filter((artifact) => artifact.artifactType === artifactType)
    .map((artifact) => schema.parse(artifact.payload));
}

function createExecutors(ports: CurrentCryptoHistoricalExecutionPorts): RegisteredHistoricalNodeExecutor[] {
  const selector: RegisteredHistoricalNodeExecutor = {
    executorId: "historical-executor.selector",
    role: "selector",
    inputArtifactTypes: [],
    outputArtifactTypes: [semanticType("selected_symbol")],
    execute: async ({ asOf, executionLineageFingerprint, executionContext }) => {
      executionContext?.checkpoint();
      const candidates = await ports.candidateSymbols(asOf);
      executionContext?.checkpoint();
      const symbol = await ports.selectSymbol(candidates, asOf);
      executionContext?.checkpoint();
      return [draft(semanticType("selected_symbol"), { symbol, candidateCount: candidates.length }, asOf, [], executionLineageFingerprint)];
    },
  };

  const dataSync = (executorId: string): RegisteredHistoricalNodeExecutor => ({
    executorId,
    role: "data_sync",
    inputArtifactTypes: [semanticType("selected_symbol")],
    outputArtifactTypes: ["market_observation"],
    execute: async ({ plan, node, inputs, asOf, executionLineageFingerprint, executionContext }) => {
      executionContext?.checkpoint();
      const selected = payloads(inputs, semanticType("selected_symbol"), SelectedSymbolSchema)[0];
      const symbol = selected?.symbol ?? (await ports.selectSymbol(await ports.candidateSymbols(asOf), asOf));
      const registeredPreset =
        createRegisteredSemanticPipelinePresetCatalog().get(plan.presetRef.id);
      const windows = registeredPreset
        ? registeredPreset.observationWindows
          .filter((window) => node.observationWindowIds.includes(window.id))
          .map((window) => ({
            id: window.id,
            version: registeredPreset.version,
            fingerprint: plan.presetRef.fingerprint,
            kind: window.kind,
          }))
        : node.observationWindowIds.map((windowId) => {
          const kind = [
            "bar_interval",
            "rolling_window",
            "event_batch",
            "reporting_period",
          ].find((candidate) => windowId.includes(`:${candidate}:`));
          if (!kind) {
            throw new Error(
              `HISTORICAL_OBSERVATION_WINDOW_KIND_UNKNOWN:${windowId}`,
            );
          }
          return {
            id: windowId,
            version: plan.version,
            fingerprint: plan.fingerprint,
            kind,
          };
        }) as SemanticObservationWindowReference[];
      const observations = await ports.loadObservations(symbol, windows, asOf);
      executionContext?.checkpoint();
      return observations.map((observation) => {
        const mapped = draft("market_observation", observation, asOf, inputs, executionLineageFingerprint);
        return {
          ...mapped,
          lineageFingerprints: [
            ...new Set([...mapped.lineageFingerprints, observation.lineage.fingerprint]),
          ],
        };
      });
    },
  });

  const dataQuality: RegisteredHistoricalNodeExecutor = {
    executorId: "historical-executor.data-quality",
    role: "data_quality",
    inputArtifactTypes: ["market_observation"],
    outputArtifactTypes: [semanticType("data_quality")],
    execute: async ({ inputs, asOf, executionLineageFingerprint, executionContext }) => {
      executionContext?.checkpoint();
      const observations = payloads(inputs, "market_observation", MarketObservationArtifactSchema);
      return [draft(semanticType("data_quality"), { status: "pass", observationArtifactIds: observations.map((item) => item.id), issueCodes: [] }, asOf, inputs, executionLineageFingerprint)];
    },
  };

  const analysis = (executorId: string): RegisteredHistoricalNodeExecutor => ({
    executorId,
    role: "window_analysis",
    inputArtifactTypes: ["market_observation", semanticType("data_quality")],
    outputArtifactTypes: ["agent_semantic_assessment"],
    execute: async ({ node, inputs, asOf, executionLineageFingerprint, executionContext }) => {
      executionContext?.checkpoint();
      const observations = payloads(inputs, "market_observation", MarketObservationArtifactSchema);
      const observation = observations.find((item) => node.observationWindowIds.includes(item.observationWindowRef.id));
      if (!observation) throw new Error("observation_window_missing");
      const assessment = await ports.analyzeObservation(observation);
      executionContext?.checkpoint();
      return [draft("agent_semantic_assessment", assessment, asOf, inputs, executionLineageFingerprint)];
    },
  });

  const directionalCase = (side: "bull" | "bear"): RegisteredHistoricalNodeExecutor => ({
    executorId: `historical-executor.${side}`,
    role: side === "bull" ? "bull_research" : "bear_research",
    inputArtifactTypes: ["agent_semantic_assessment"],
    outputArtifactTypes: ["agent_semantic_assessment"],
    execute: async ({ inputs, asOf, executionLineageFingerprint, executionContext }) => {
      executionContext?.checkpoint();
      const assessments = payloads(inputs, "agent_semantic_assessment", AgentSemanticAssessmentSchema);
      const result = await ports.buildDirectionalCase(side, assessments, asOf);
      executionContext?.checkpoint();
      return [draft("agent_semantic_assessment", result, asOf, inputs, executionLineageFingerprint)];
    },
  });

  const positionMonitor: RegisteredHistoricalNodeExecutor = {
    executorId: "historical-executor.position-monitor",
    role: "position_monitor",
    inputArtifactTypes: ["market_observation"],
    outputArtifactTypes: ["agent_semantic_assessment"],
    execute: async ({ inputs, asOf, executionLineageFingerprint, executionContext }) => {
      executionContext?.checkpoint();
      const observations = payloads(inputs, "market_observation", MarketObservationArtifactSchema);
      const result = await ports.monitorCurrentPosition(observations, asOf);
      executionContext?.checkpoint();
      return [draft("agent_semantic_assessment", result, asOf, inputs, executionLineageFingerprint)];
    },
  };

  const decision: RegisteredHistoricalNodeExecutor = {
    executorId: "historical-executor.decision",
    role: "decision",
    inputArtifactTypes: ["agent_semantic_assessment"],
    outputArtifactTypes: ["decision_semantic_context", "semantic_decision"],
    execute: async ({ inputs, priorArtifacts, asOf, executionLineageFingerprint, executionContext }) => {
      executionContext?.checkpoint();
      const observations = payloads(priorArtifacts, "market_observation", MarketObservationArtifactSchema);
      const assessments = payloads(priorArtifacts, "agent_semantic_assessment", AgentSemanticAssessmentSchema);
      const approvedLessons = await ports.approvedLessons(asOf);
      executionContext?.checkpoint();
      const result = await ports.decide({ observations, assessments, approvedLessons, asOf });
      executionContext?.checkpoint();
      return [
        draft("decision_semantic_context", result.context, asOf, inputs, executionLineageFingerprint),
        draft("semantic_decision", result.decision, asOf, inputs, executionLineageFingerprint),
      ];
    },
  };

  const portfolio: RegisteredHistoricalNodeExecutor = {
    executorId: "historical-executor.portfolio",
    role: "portfolio",
    inputArtifactTypes: ["semantic_decision"],
    outputArtifactTypes: [semanticType("portfolio_action")],
    execute: async ({ inputs, asOf, executionLineageFingerprint, executionContext }) => {
      executionContext?.checkpoint();
      const decision = payloads(inputs, "semantic_decision", SemanticDecisionArtifactSchema)[0];
      if (!decision) throw new Error("semantic_decision_missing");
      const action = await ports.applyPortfolio(decision);
      executionContext?.checkpoint();
      return [draft(semanticType("portfolio_action"), action, asOf, inputs, executionLineageFingerprint)];
    },
  };

  const risk: RegisteredHistoricalNodeExecutor = {
    executorId: "historical-executor.risk",
    role: "risk",
    inputArtifactTypes: [semanticType("portfolio_action")],
    outputArtifactTypes: [semanticType("risk_decision")],
    execute: async ({ inputs, asOf, executionLineageFingerprint, executionContext }) => {
      executionContext?.checkpoint();
      const action = payloads(inputs, semanticType("portfolio_action"), PortfolioActionSchema)[0];
      if (!action) throw new Error("portfolio_action_missing");
      const risk = await ports.evaluateRisk(action);
      executionContext?.checkpoint();
      return [draft(semanticType("risk_decision"), risk, asOf, inputs, executionLineageFingerprint)];
    },
  };

  const execution: RegisteredHistoricalNodeExecutor = {
    executorId: "historical-executor.execution",
    role: "execution",
    inputArtifactTypes: [semanticType("risk_decision")],
    outputArtifactTypes: [semanticType("execution_result")],
    execute: async ({ inputs, asOf, executionLineageFingerprint, executionContext }) => {
      executionContext?.checkpoint();
      const riskDecision = payloads(inputs, semanticType("risk_decision"), RiskDecisionSchema)[0];
      if (!riskDecision) throw new Error("risk_decision_missing");
      const result = await ports.simulateExecution(riskDecision);
      executionContext?.checkpoint();
      return [draft(semanticType("execution_result"), result, asOf, inputs, executionLineageFingerprint)];
    },
  };

  const reflection: RegisteredHistoricalNodeExecutor = {
    executorId: "historical-executor.reflection",
    role: "reflection",
    inputArtifactTypes: [semanticType("execution_result"), "semantic_decision"],
    outputArtifactTypes: ["reflection_lesson_candidate"],
    execute: async ({ inputs, priorArtifacts, asOf, executionLineageFingerprint, executionContext }) => {
      executionContext?.checkpoint();
      const executionResult = payloads(inputs, semanticType("execution_result"), ExecutionResultSchema)[0];
      const semanticDecision = payloads([...inputs, ...priorArtifacts], "semantic_decision", SemanticDecisionArtifactSchema)[0];
      if (!executionResult || !semanticDecision) throw new Error("reflection_inputs_missing");
      const candidate = await ports.reflect({ decision: semanticDecision, execution: executionResult });
      executionContext?.checkpoint();
      return candidate ? [draft("reflection_lesson_candidate", candidate, asOf, inputs, executionLineageFingerprint)] : [];
    },
  };

  const researchSynthesis: RegisteredHistoricalNodeExecutor = {
    executorId: "historical-executor.research-synthesis",
    role: "research_synthesis",
    inputArtifactTypes: ["agent_semantic_assessment"],
    outputArtifactTypes: ["agent_semantic_assessment"],
    execute: async ({ inputs, asOf, executionLineageFingerprint, executionContext }) => {
      executionContext?.checkpoint();
      const assessments = payloads(inputs, "agent_semantic_assessment", AgentSemanticAssessmentSchema);
      const result = await ports.synthesizeResearch(assessments, asOf);
      executionContext?.checkpoint();
      return [draft("agent_semantic_assessment", result, asOf, inputs, executionLineageFingerprint)];
    },
  };

  return [
    selector,
    dataSync("historical-executor.data-sync"),
    dataSync("historical-executor.event-sync"),
    dataQuality,
    analysis("historical-executor.window-analysis"),
    analysis("historical-executor.event-analysis"),
    directionalCase("bull"),
    directionalCase("bear"),
    positionMonitor,
    decision,
    portfolio,
    risk,
    execution,
    reflection,
    researchSynthesis,
  ];
}

export function createRegisteredSemanticHistoricalExecution(
  ports: CurrentCryptoHistoricalExecutionPorts,
  options: {
    authorizedCapabilityKinds?: readonly ("bar" | "event" | "report")[];
    now?: () => Date;
    monotonicNow?: () => number;
  } = {},
) {
  const artifactSchemas = new RegisteredHistoricalArtifactSchemaRegistry([
    { artifactType: semanticType("selected_symbol"), schemaRef: { schemaId: semanticType("selected_symbol"), schemaVersion: "1.0.0" }, schema: SelectedSymbolSchema },
    { artifactType: "market_observation", schemaRef: { schemaId: "tradebot.semantic.market_observation.v1", schemaVersion: "1.0.0" }, schema: MarketObservationArtifactSchema },
    { artifactType: semanticType("data_quality"), schemaRef: { schemaId: semanticType("data_quality"), schemaVersion: "1.0.0" }, schema: DataQualitySchema },
    { artifactType: "agent_semantic_assessment", schemaRef: { schemaId: "tradebot.semantic.agent_semantic_assessment.v1", schemaVersion: "1.0.0" }, schema: AgentSemanticAssessmentSchema },
    { artifactType: "decision_semantic_context", schemaRef: { schemaId: "tradebot.semantic.decision_semantic_context.v1", schemaVersion: "1.0.0" }, schema: DecisionSemanticContextSchema },
    { artifactType: "semantic_decision", schemaRef: { schemaId: "tradebot.semantic.semantic_decision.v1", schemaVersion: "1.0.0" }, schema: SemanticDecisionArtifactSchema },
    { artifactType: semanticType("portfolio_action"), schemaRef: { schemaId: semanticType("portfolio_action"), schemaVersion: "1.0.0" }, schema: PortfolioActionSchema },
    { artifactType: semanticType("risk_decision"), schemaRef: { schemaId: semanticType("risk_decision"), schemaVersion: "1.0.0" }, schema: RiskDecisionSchema },
    { artifactType: semanticType("execution_result"), schemaRef: { schemaId: semanticType("execution_result"), schemaVersion: "1.0.0" }, schema: ExecutionResultSchema },
    { artifactType: "reflection_lesson_candidate", schemaRef: { schemaId: "tradebot.semantic.reflection_lesson_candidate.v1", schemaVersion: "1.0.0" }, schema: ReflectionLessonCandidateSchema },
  ]);
  const executorRegistry = new RegisteredHistoricalNodeExecutorRegistry(createExecutors(ports));
  const presetCatalog = createRegisteredSemanticPipelinePresetCatalog();
  const planRegistry = new RegisteredHistoricalGraphPlanRegistry({
    presetCatalog,
    executorRegistry,
    artifactSchemaRegistry: artifactSchemas,
    bindings: [
      { agentTemplateId: "agent-template.selector", executorId: "historical-executor.selector" },
      { agentTemplateId: "agent-template.data-sync", executorId: "historical-executor.data-sync" },
      { agentTemplateId: "agent-template.event-sync", executorId: "historical-executor.event-sync" },
      { agentTemplateId: "agent-template.data-quality", executorId: "historical-executor.data-quality" },
      { agentTemplateId: "agent-template.timeframe-analysis", executorId: "historical-executor.window-analysis" },
      { agentTemplateId: "agent-template.event-analysis", executorId: "historical-executor.event-analysis" },
      { agentTemplateId: "agent-template.bull-research", executorId: "historical-executor.bull" },
      { agentTemplateId: "agent-template.bear-research", executorId: "historical-executor.bear" },
      { agentTemplateId: "agent-template.position-monitor", executorId: "historical-executor.position-monitor" },
      { agentTemplateId: "agent-template.decision", executorId: "historical-executor.decision" },
      { agentTemplateId: "agent-template.portfolio", executorId: "historical-executor.portfolio" },
      { agentTemplateId: "agent-template.risk", executorId: "historical-executor.risk" },
      { agentTemplateId: "agent-template.paper-execution", executorId: "historical-executor.execution" },
      { agentTemplateId: "agent-template.reflection", executorId: "historical-executor.reflection" },
      { agentTemplateId: "agent-template.research-synthesis", executorId: "historical-executor.research-synthesis" },
    ],
    now: options.now,
  });
  const executor = new HistoricalGraphExecutor({
    planRegistry,
    executorRegistry,
    artifactSchemaRegistry: artifactSchemas,
    authorizedCapabilityKinds: options.authorizedCapabilityKinds ?? ["bar"],
    now: options.now,
    monotonicNow: options.monotonicNow,
  });
  return Object.freeze({
    presetCatalog,
    planRegistry,
    executor,
    nodeExecutorRegistry: executorRegistry,
    artifactSchemaRegistry: artifactSchemas,
  });
}
