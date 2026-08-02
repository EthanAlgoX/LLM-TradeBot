import { readFile } from "node:fs/promises";

import {
  AgentSemanticAssessmentSchema,
  DecisionSemanticContextSchema,
  MarketObservationArtifactSchema,
  ReflectionLessonCandidateSchema,
  SemanticDecisionArtifactSchema,
  type AgentSemanticAssessment,
  type HistoricalGraphExecutionPlan,
  type MarketBar,
  type MarketObservationArtifact,
  type PipelineGraphVersion,
  type ReflectionLessonCandidate,
  type SemanticArtifactReference,
  type SemanticDecisionArtifact,
  type SemanticObservationWindowReference,
  type StrategyProfile,
} from "../../contracts/src/index.js";
import {
  CSV_HISTORICAL_CAPABILITY,
  CSV_HISTORICAL_DATA_SOURCE,
  CsvHistoricalCandleSource,
} from "../../adapters/src/index.js";
import {
  CURRENT_CRYPTO_MARKET_PACK,
  CURRENT_CRYPTO_SEMANTIC_CSV_PIPELINE_GRAPH,
  CURRENT_CRYPTO_SEMANTIC_HISTORICAL_EXECUTOR_BINDINGS,
  CURRENT_CRYPTO_SEMANTIC_HISTORICAL_REGISTRY_SEED,
  PipelineGraphHistoricalBridge,
  createGraphHistoricalDatasetDefinition,
  createGraphStrategyProfileCandidateSet,
  createGraphStrategyProfileDefinition,
  createGraphWalkForwardPlanDefinition,
  graphEvidenceFingerprint,
  type CompiledPipelinePlan,
  type ImmutablePipelineRegistry,
  type PipelineRegistrySeed,
} from "../../core/src/index.js";
import {
  loadStrategyProfile,
  sha256File,
  strategyProfileFingerprint,
} from "../../config/src/index.js";
import {
  createRegisteredGraphBacktestSessionFactory,
  type RegisteredGraphBacktestSessionProvider,
} from "./registered-graph-backtest-session.js";
import {
  createRegisteredSemanticHistoricalExecution,
  type CurrentCryptoHistoricalExecutionPorts,
} from "./registered-semantic-historical-node-executors.js";
import type {
  ProductionHistoricalGraphCompiler,
  ProductionStrategyOrchestrationOptions,
} from "./production-strategy-orchestration.js";

type NativeTimeframe = "5m" | "15m" | "1h";

export interface CsvProductionGraphEvidenceConfig {
  csvPath: string;
  profilePath: string;
  symbols: readonly string[];
  start?: Date;
  end?: Date;
  walkForward: {
    trainingCycles: number;
    validationCycles: number;
    stepCycles: number;
    objective?: "total_return_pct" | "max_drawdown_pct";
  };
  datasetId?: string;
  approvedPaperPlanPolicy?: {
    planVersion: string;
    paperAccountRef: string;
    candidateSymbols: readonly string[];
    riskPolicyRefs: readonly string[];
    planTtlMs?: number;
  };
  now?: () => Date;
}

export interface CsvProductionGraphEvidenceRegistration {
  registrySeed: PipelineRegistrySeed;
  pipelineGraphs: readonly PipelineGraphVersion[];
  dataset: ReturnType<typeof createGraphHistoricalDatasetDefinition>;
  profile: ReturnType<typeof createGraphStrategyProfileDefinition>;
  profileCandidateSet: ReturnType<
    typeof createGraphStrategyProfileCandidateSet
  >;
  walkForwardPlan: ReturnType<typeof createGraphWalkForwardPlanDefinition>;
  createStrategyOrchestrationOptions(
    registry: ImmutablePipelineRegistry,
  ): ProductionStrategyOrchestrationOptions;
}

function stableComponent(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!normalized) {
    throw new Error("CSV_GRAPH_EVIDENCE_STABLE_ID_INVALID");
  }
  return normalized;
}

function assertDateRange(start: Date | undefined, end: Date | undefined): void {
  if (
    (start && Number.isNaN(start.getTime())) ||
    (end && Number.isNaN(end.getTime())) ||
    (start && end && start > end)
  ) {
    throw new Error("CSV_GRAPH_EVIDENCE_RANGE_INVALID");
  }
}

function parseStrictCsv(csv: string, registeredSymbols: ReadonlySet<string>): void {
  const lines = csv.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  const headerLine = lines.shift();
  if (!headerLine) {
    throw new Error("CSV_GRAPH_EVIDENCE_EMPTY");
  }
  const headers = headerLine.split(",").map((value) => value.trim());
  const requiredHeaders = [
    "ts",
    "symbol",
    "timeframe",
    "open",
    "high",
    "low",
    "close",
    "volume",
  ];
  if (
    new Set(headers).size !== headers.length ||
    requiredHeaders.some((header) => !headers.includes(header))
  ) {
    throw new Error("CSV_GRAPH_EVIDENCE_HEADER_INVALID");
  }
  const seen = new Set<string>();
  for (const [lineIndex, line] of lines.entries()) {
    const values = line.split(",").map((value) => value.trim());
    if (values.length !== headers.length) {
      throw new Error(`CSV_GRAPH_EVIDENCE_ROW_INVALID:${lineIndex + 2}`);
    }
    const row = Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
    if (!row.symbol || !registeredSymbols.has(row.symbol)) {
      continue;
    }
    if (
      row.timeframe !== "5m" &&
      row.timeframe !== "15m" &&
      row.timeframe !== "1h"
    ) {
      throw new Error(
        `CSV_GRAPH_EVIDENCE_TIMEFRAME_UNSUPPORTED:${lineIndex + 2}`,
      );
    }
    const timestamp = Date.parse(row.ts ?? "");
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    const volume = Number(row.volume);
    if (
      !Number.isFinite(timestamp) ||
      ![open, high, low, close].every(
        (value) => Number.isFinite(value) && value > 0,
      ) ||
      !Number.isFinite(volume) ||
      volume < 0 ||
      high < Math.max(open, close) ||
      low > Math.min(open, close) ||
      low > high
    ) {
      throw new Error(`CSV_GRAPH_EVIDENCE_ROW_INVALID:${lineIndex + 2}`);
    }
    const identity = `${row.symbol}:${row.timeframe}:${new Date(timestamp).toISOString()}`;
    if (seen.has(identity)) {
      throw new Error(`CSV_GRAPH_EVIDENCE_DUPLICATE_BAR:${identity}`);
    }
    seen.add(identity);
  }
}

function requiredBarCount(
  timeframe: NativeTimeframe,
  profile: StrategyProfile,
): number {
  if (timeframe === "5m") return profile.dataQuality.minBars5m;
  if (timeframe === "15m") return profile.dataQuality.minBars15m;
  return profile.dataQuality.minBars1h;
}

async function buildSchedule(
  source: CsvHistoricalCandleSource,
  symbols: readonly string[],
  profile: StrategyProfile,
  start: Date | undefined,
  end: Date | undefined,
): Promise<string[]> {
  const timeframes: readonly NativeTimeframe[] = ["5m", "15m", "1h"];
  let firstUsableAt = Number.NEGATIVE_INFINITY;
  let lastUsableAt = Number.POSITIVE_INFINITY;
  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      const bars = await source.loadBars(symbol, timeframe);
      const required = requiredBarCount(timeframe, profile);
      if (bars.length < required) {
        throw new Error(
          `CSV_GRAPH_EVIDENCE_WINDOW_INCOMPLETE:${symbol}:${timeframe}`,
        );
      }
      firstUsableAt = Math.max(
        firstUsableAt,
        bars[required - 1]!.closeTime.getTime(),
      );
      if (timeframe === "5m") {
        lastUsableAt = Math.min(
          lastUsableAt,
          bars.at(-1)!.closeTime.getTime(),
        );
      }
    }
  }
  const timeline = await source.loadBars(symbols[0]!, "5m");
  return timeline
    .map((bar) => bar.closeTime)
    .filter(
      (asOf) =>
        asOf.getTime() >= firstUsableAt &&
        asOf.getTime() <= lastUsableAt &&
        (!start || asOf >= start) &&
        (!end || asOf <= end),
    )
    .map((asOf) => asOf.toISOString());
}

function reference(
  artifact: {
    id?: string;
    artifactId?: string;
    artifactType: string;
    fingerprint: string;
  },
): SemanticArtifactReference {
  return {
    artifactId: artifact.id ?? artifact.artifactId!,
    artifactType: artifact.artifactType,
    fingerprint: artifact.fingerprint,
  };
}

function timeframeForWindow(
  window: SemanticObservationWindowReference,
): NativeTimeframe {
  if (
    window.kind === "bar_interval" &&
    window.id.endsWith(":bar_interval:5:minute")
  ) {
    return "5m";
  }
  if (
    window.kind === "bar_interval" &&
    window.id.endsWith(":bar_interval:15:minute")
  ) {
    return "15m";
  }
  if (
    window.kind === "bar_interval" &&
    window.id.endsWith(":bar_interval:1:hour")
  ) {
    return "1h";
  }
  throw new Error(`CSV_GRAPH_EVIDENCE_WINDOW_UNSUPPORTED:${window.id}`);
}

function observationBars(
  bars: readonly MarketBar[],
  asOf: string,
): MarketBar[] {
  const asOfMs = Date.parse(asOf);
  return bars
    .filter((bar) => bar.closeTime.getTime() <= asOfMs)
    .slice(-240);
}

function makeAssessment(input: {
  source: MarketObservationArtifact | AgentSemanticAssessment;
  kind:
    | "window_analysis"
    | "bull_case"
    | "bear_case"
    | "position_monitor";
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;
  thesis: string;
  asOf: string;
  marketPackRef: MarketObservationArtifact["marketPackRef"];
  observationWindowRef?: SemanticObservationWindowReference;
}): AgentSemanticAssessment {
  const sourceRef = reference(input.source);
  const lineageFingerprint =
    "lineage" in input.source
      ? input.source.lineage.fingerprint
      : input.source.lineageFingerprint;
  const identity = {
    kind: input.kind,
    sourceRef,
    direction: input.direction,
    confidence: input.confidence,
    asOf: input.asOf,
  };
  const suffix = graphEvidenceFingerprint(identity).slice(7, 31);
  return AgentSemanticAssessmentSchema.parse({
    schemaVersion: "1.0.0",
    id: `assessment:${input.kind}:${suffix}`,
    version: "1.0.0",
    fingerprint: graphEvidenceFingerprint(identity),
    lifecycleStatus: "validated",
    createdAt: input.asOf,
    marketPackRef: input.marketPackRef,
    schemaRef: {
      schemaId: "tradebot.semantic.agent_semantic_assessment.v1",
      schemaVersion: "1.0.0",
    },
    artifactType: "agent_semantic_assessment",
    assessmentKind: input.kind,
    agentConfigRef: {
      id: `agent-config:semantic-historical:${input.kind.replaceAll("_", "-")}:v1`,
      version: "1.0.0",
      fingerprint: graphEvidenceFingerprint({
        agent: input.kind,
        version: "1.0.0",
      }),
    },
    observationWindowRef: input.observationWindowRef,
    direction: input.direction,
    confidence: Math.max(0, Math.min(1, input.confidence)),
    regime: input.direction === "neutral" ? "position-aware" : "trend",
    semanticThesis: input.thesis,
    supportingEvidence: [
      {
        evidenceId: `evidence:${input.kind}:${suffix}`,
        sourceArtifactRef: sourceRef,
        evidenceType:
          "lineage" in input.source ? "price_structure" : "agent_assessment",
        locator: "registered-csv-historical-session",
        summary: input.thesis,
      },
    ],
    invalidationConditions: [
      "Closed historical evidence no longer supports this semantic assessment.",
    ],
    riskFlags: [],
    sourceArtifactRefs: [sourceRef],
    lineageFingerprint,
  });
}

function unavailableCompilerPorts(): CurrentCryptoHistoricalExecutionPorts {
  const unavailable = async (): Promise<never> => {
    throw new Error("HISTORICAL_COMPILER_PORT_EXECUTION_FORBIDDEN");
  };
  return {
    candidateSymbols: unavailable,
    selectSymbol: unavailable,
    loadObservations: unavailable,
    analyzeObservation: unavailable,
    buildDirectionalCase: unavailable,
    monitorCurrentPosition: unavailable,
    decide: unavailable,
    applyPortfolio: unavailable,
    evaluateRisk: unavailable,
    simulateExecution: unavailable,
    reflect: unavailable,
    synthesizeResearch: unavailable,
    approvedLessons: unavailable,
  };
}

class RegisteredProductionHistoricalGraphCompiler
implements ProductionHistoricalGraphCompiler {
  private readonly composition = createRegisteredSemanticHistoricalExecution(
    unavailableCompilerPorts(),
    { authorizedCapabilityKinds: ["bar"] },
  );
  private readonly bridge: PipelineGraphHistoricalBridge;

  constructor(
    registry: ImmutablePipelineRegistry,
    now: () => Date,
  ) {
    this.bridge = new PipelineGraphHistoricalBridge({
      registry,
      historicalPlanRegistry: this.composition.planRegistry,
      nodeExecutorRegistry: this.composition.nodeExecutorRegistry,
      artifactSchemaRegistry: this.composition.artifactSchemaRegistry,
      executorBindings:
        CURRENT_CRYPTO_SEMANTIC_HISTORICAL_EXECUTOR_BINDINGS,
      now,
    });
  }

  compile(
    graph: PipelineGraphVersion,
    compiled: CompiledPipelinePlan,
  ): HistoricalGraphExecutionPlan {
    return this.bridge.bridge(graph, compiled);
  }

  require(planId: string): HistoricalGraphExecutionPlan {
    return this.composition.planRegistry.require(planId);
  }
}

function createSessionProvider(input: {
  csvPath: string;
  registeredFingerprint: string;
  datasetId: string;
  symbols: readonly string[];
  profile: StrategyProfile;
}): RegisteredGraphBacktestSessionProvider {
  return {
    create: async ({ sessionId, planId, dataset, profile }) => {
      if (
        dataset.id !== input.datasetId ||
        dataset.dataSourceRef.id !== CSV_HISTORICAL_DATA_SOURCE.dataSourceId ||
        dataset.dataSourceRef.fingerprint !==
          `sha256:${input.registeredFingerprint}`
      ) {
        throw new Error("CSV_GRAPH_EVIDENCE_DATASET_SCOPE_MISMATCH");
      }
      if (
        !profile.compatiblePresetIds.includes(
          CURRENT_CRYPTO_SEMANTIC_CSV_PIPELINE_GRAPH.pipelineGraphId,
        )
      ) {
        throw new Error("CSV_GRAPH_EVIDENCE_PROFILE_SCOPE_MISMATCH");
      }
      const currentFingerprint = await sha256File(input.csvPath);
      if (currentFingerprint !== input.registeredFingerprint) {
        throw new Error("CSV_GRAPH_EVIDENCE_CONTENT_FINGERPRINT_MISMATCH");
      }
      const source = await CsvHistoricalCandleSource.fromFile(input.csvPath);
      let selectedSymbol = input.symbols[0]!;
      let currentPrice = 0;
      let cash = Number(
        profile.parameters.initialCash ??
          input.profile.execution.initialCash,
      );
      const initialCash = cash;
      let position:
        | { side: "long" | "short"; entryPrice: number; quantity: number }
        | undefined;
      let tradeCount = 0;
      let fillCount = 0;
      let riskRejectionCount = 0;
      let fees = 0;
      let cycle = 0;
      let lastAsOf = dataset.asOfSequence[0]!;
      let latestObservations: readonly MarketObservationArtifact[] = [];

      const markToMarket = () => {
        if (!position || currentPrice <= 0) return 0;
        const direction = position.side === "long" ? 1 : -1;
        return (
          (currentPrice - position.entryPrice) *
          position.quantity *
          direction
        );
      };
      const currentEquity = () => Math.max(0, cash + markToMarket());
      const profileMinimumConfidence = Number(
        profile.parameters.minimumConfidence ??
          input.profile.decision.minimumConfidence,
      );
      const minimumConfidence =
        profileMinimumConfidence > 1
          ? profileMinimumConfidence / 100
          : profileMinimumConfidence;
      const perTradeNotional = Number(
        profile.parameters.perTradeNotional ??
          input.profile.decision.perTradeNotional,
      );
      const maxNotional = Number(
        profile.parameters.maxNotional ?? input.profile.risk.maxNotional,
      );
      const feeBps = Number(
        profile.parameters.feeBps ?? input.profile.execution.feeBps,
      );
      const marketPackRef = dataset.marketPackRef;

      const ports: CurrentCryptoHistoricalExecutionPorts = {
        candidateSymbols: async () => [...input.symbols],
        selectSymbol: async (candidates) => {
          const candidate = candidates.find((symbol) =>
            input.symbols.includes(symbol),
          );
          if (!candidate) {
            throw new Error("CSV_GRAPH_EVIDENCE_SYMBOL_NOT_REGISTERED");
          }
          selectedSymbol = candidate;
          return candidate;
        },
        loadObservations: async (symbol, windows, asOf) => {
          if (!input.symbols.includes(symbol)) {
            throw new Error("CSV_GRAPH_EVIDENCE_SYMBOL_NOT_REGISTERED");
          }
          lastAsOf = asOf;
          cycle += 1;
          const observations = await Promise.all(
            windows.map(async (window) => {
              const timeframe = timeframeForWindow(window);
              const closed = observationBars(
                await source.loadBars(symbol, timeframe),
                asOf,
              );
              if (
                closed.length <
                requiredBarCount(timeframe, input.profile)
              ) {
                throw new Error(
                  `CSV_GRAPH_EVIDENCE_WINDOW_INCOMPLETE:${symbol}:${timeframe}:${asOf}`,
                );
              }
              const latest = closed.at(-1)!;
              if (timeframe === "5m") {
                currentPrice = latest.close;
              }
              const lineageContent = {
                datasetId: dataset.id,
                dataFingerprint: dataset.dataSourceRef.fingerprint,
                symbol,
                timeframe,
                asOf,
                lastClosedAt: latest.closeTime.toISOString(),
              };
              const lineageFingerprint =
                graphEvidenceFingerprint(lineageContent);
              const identity = {
                sessionId,
                planId,
                window,
                lineageFingerprint,
                asOf,
              };
              const suffix = graphEvidenceFingerprint(identity).slice(7, 31);
              return MarketObservationArtifactSchema.parse({
                schemaVersion: "1.0.0",
                id: `observation:${suffix}`,
                version: dataset.version,
                fingerprint: graphEvidenceFingerprint(identity),
                lifecycleStatus: "validated",
                createdAt: asOf,
                marketPackRef,
                schemaRef: {
                  schemaId: "tradebot.semantic.market_observation.v1",
                  schemaVersion: "1.0.0",
                },
                artifactType: "market_observation",
                asOf,
                availableAt: latest.closeTime.toISOString(),
                observationWindowRef: window,
                lineage: {
                  lineageId: `lineage:csv:${suffix}`,
                  fingerprint: lineageFingerprint,
                  sourceDefinitionId:
                    CSV_HISTORICAL_DATA_SOURCE.dataSourceId,
                  sourceCapabilityId:
                    CSV_HISTORICAL_CAPABILITY.capabilityId,
                  transformationVersion: "csv-native-closed-bars.v1",
                  timezone: CSV_HISTORICAL_CAPABILITY.timezone,
                  tradingCalendarRef:
                    CSV_HISTORICAL_CAPABILITY.tradingCalendar,
                },
                payload: {
                  kind: "bar_interval",
                  symbol,
                  bars: closed.map((bar) => ({
                    openedAt: bar.openTime.toISOString(),
                    closedAt: bar.closeTime.toISOString(),
                    availableAt: bar.closeTime.toISOString(),
                    open: bar.open,
                    high: bar.high,
                    low: bar.low,
                    close: bar.close,
                    volume: bar.volume,
                  })),
                },
              });
            }),
          );
          latestObservations = observations;
          return observations;
        },
        analyzeObservation: async (observation) => {
          if (observation.payload.kind !== "bar_interval") {
            throw new Error("CSV_GRAPH_EVIDENCE_NON_BAR_OBSERVATION");
          }
          const first = observation.payload.bars[0]!;
          const latest = observation.payload.bars.at(-1)!;
          const momentum = (latest.close - first.close) / first.close;
          const direction =
            Math.abs(momentum) < 0.001
              ? "neutral"
              : momentum > 0
                ? "bullish"
                : "bearish";
          return makeAssessment({
            source: observation,
            kind: "window_analysis",
            direction,
            confidence: Math.min(0.95, 0.5 + Math.abs(momentum) * 8),
            thesis: `${timeframeForWindow(observation.observationWindowRef)} closed-bar momentum is ${direction}.`,
            asOf: observation.asOf,
            marketPackRef,
            observationWindowRef: observation.observationWindowRef,
          });
        },
        buildDirectionalCase: async (side, assessments, asOf) => {
          const sourceAssessment = assessments[0];
          if (!sourceAssessment) {
            throw new Error("CSV_GRAPH_EVIDENCE_ASSESSMENT_MISSING");
          }
          const targetDirection =
            side === "bull" ? "bullish" : "bearish";
          const aligned = assessments.filter(
            (assessment) => assessment.direction === targetDirection,
          );
          const confidence =
            assessments.length === 0
              ? 0
              : (aligned.reduce(
                (sum, assessment) => sum + assessment.confidence,
                0,
              ) +
                assessments.filter(
                  (assessment) => assessment.direction === "neutral",
                ).length *
                  0.25) /
                assessments.length;
          return makeAssessment({
            source: sourceAssessment,
            kind: side === "bull" ? "bull_case" : "bear_case",
            direction: targetDirection,
            confidence,
            thesis: `${side} case synthesized ${aligned.length}/${assessments.length} aligned window assessments.`,
            asOf,
            marketPackRef,
          });
        },
        monitorCurrentPosition: async (observations, asOf) => {
          const sourceObservation = observations[0];
          if (!sourceObservation) {
            throw new Error("CSV_GRAPH_EVIDENCE_OBSERVATION_MISSING");
          }
          return makeAssessment({
            source: sourceObservation,
            kind: "position_monitor",
            direction: "neutral",
            confidence: position ? 0.7 : 0.5,
            thesis: position
              ? `Existing ${position.side} position was included in the historical decision context.`
              : "No open position required a close-only proposal.",
            asOf,
            marketPackRef,
          });
        },
        decide: async ({
          observations,
          assessments,
          approvedLessons,
          asOf,
        }) => {
          const bull = assessments
            .filter((assessment) => assessment.assessmentKind === "bull_case")
            .sort((left, right) => right.confidence - left.confidence)[0];
          const bear = assessments
            .filter((assessment) => assessment.assessmentKind === "bear_case")
            .sort((left, right) => right.confidence - left.confidence)[0];
          const winner =
            (bull?.confidence ?? 0) >= (bear?.confidence ?? 0)
              ? bull
              : bear;
          if (!winner) {
            throw new Error("CSV_GRAPH_EVIDENCE_DIRECTIONAL_CASE_MISSING");
          }
          const intent =
            position || winner.confidence < minimumConfidence
              ? "hold"
              : winner.direction === "bearish"
                ? "open_short"
                : "open_long";
          const contextIdentity = {
            sessionId,
            cycle,
            observations: observations.map(reference),
            assessments: assessments.map(reference),
            approvedLessons: approvedLessons.map(reference),
            asOf,
          };
          const contextSuffix = graphEvidenceFingerprint(
            contextIdentity,
          ).slice(7, 31);
          const context = DecisionSemanticContextSchema.parse({
            schemaVersion: "1.0.0",
            id: `decision-context:${contextSuffix}`,
            version: profile.version,
            fingerprint: graphEvidenceFingerprint(contextIdentity),
            lifecycleStatus: "validated",
            createdAt: asOf,
            marketPackRef,
            schemaRef: {
              schemaId: "tradebot.semantic.decision_semantic_context.v1",
              schemaVersion: "1.0.0",
            },
            artifactType: "decision_semantic_context",
            asOf,
            decisionAgentConfigRef: {
              id: "agent-config:semantic-historical:decision:v1",
              version: "1.0.0",
              fingerprint: graphEvidenceFingerprint({
                agent: "decision",
                version: "1.0.0",
              }),
            },
            observations,
            assessments,
            approvedLessons,
            portfolioState: {
              asOf,
              baseCurrency: "USDT",
              equity: currentEquity(),
              availableCash: Math.max(0, cash),
              openPositionRefs: [],
            },
            riskState: {
              asOf,
              riskProfileId: "risk-profile:semantic-historical",
              newEntriesPaused: false,
              closeOnly: false,
              remainingRiskBudget: Math.max(0, maxNotional),
              activeFlags: [],
            },
            dataQuality: {
              status: "pass",
              issueCodes: [],
              checkedArtifactRefs: observations.map(reference),
            },
            lineageFingerprints: [
              ...new Set([
                ...observations.map(
                  (observation) => observation.lineage.fingerprint,
                ),
                ...assessments.map(
                  (assessment) => assessment.lineageFingerprint,
                ),
              ]),
            ],
          });
          const decisionIdentity = {
            context: reference(context),
            intent,
            confidence: winner.confidence,
            asOf,
          };
          const decisionSuffix = graphEvidenceFingerprint(
            decisionIdentity,
          ).slice(7, 31);
          const decision = SemanticDecisionArtifactSchema.parse({
            schemaVersion: "1.0.0",
            id: `semantic-decision:${decisionSuffix}`,
            version: profile.version,
            fingerprint: graphEvidenceFingerprint(decisionIdentity),
            lifecycleStatus: "validated",
            createdAt: asOf,
            marketPackRef,
            schemaRef: {
              schemaId: "tradebot.semantic.semantic_decision.v1",
              schemaVersion: "1.0.0",
            },
            artifactType: "semantic_decision",
            asOf,
            decisionAgentConfigRef: context.decisionAgentConfigRef,
            decisionContextRef: reference(context),
            intent,
            confidence: winner.confidence,
            semanticRationale:
              intent === "hold"
                ? "Semantic evidence did not authorize a new opening or an isolated position is already open."
                : `${winner.assessmentKind} won after semantic multi-window handoff.`,
            supportingEvidence: [
              {
                evidenceId: `evidence:decision:${decisionSuffix}`,
                sourceArtifactRef: reference(winner),
                evidenceType: "agent_assessment",
                locator: "directional-case-winner",
                summary: winner.semanticThesis,
              },
            ],
            riskFlags: [],
            requiresPortfolioRiskChain: true,
          });
          return { context, decision };
        },
        applyPortfolio: async (decision) => ({
          actionId: `action:${graphEvidenceFingerprint({
            decision: decision.id,
            sessionId,
          }).slice(7, 31)}`,
          intent: decision.intent,
          notional: decision.intent === "hold" ? 0 : perTradeNotional,
        }),
        evaluateRisk: async (action) => {
          const approved =
            action.intent === "hold" || action.notional <= maxNotional;
          if (!approved) riskRejectionCount += 1;
          return {
            approved,
            reasonCodes: approved ? [] : ["MAX_NOTIONAL_EXCEEDED"],
            action,
          };
        },
        simulateExecution: async (risk) => {
          if (
            !risk.approved ||
            risk.action.intent === "hold" ||
            position ||
            currentPrice <= 0
          ) {
            return {
              status: "not_executed",
              actionId: risk.action.actionId,
            };
          }
          const side =
            risk.action.intent === "open_short" ? "short" : "long";
          position = {
            side,
            entryPrice: currentPrice,
            quantity: risk.action.notional / currentPrice,
          };
          const fee = (risk.action.notional * feeBps) / 10_000;
          cash = Math.max(0, cash - fee);
          fees += fee;
          tradeCount += 1;
          fillCount += 1;
          return {
            status: "simulated_fill",
            fillId: `fill:${sessionId.slice(-24)}:${cycle}`,
            actionId: risk.action.actionId,
          };
        },
        reflect: async ({ decision, execution }) => {
          if (
            decision.intent === "hold" ||
            execution.status === "simulated_fill"
          ) {
            return undefined;
          }
          const identity = {
            sessionId,
            decisionId: decision.id,
            execution,
          };
          const suffix = graphEvidenceFingerprint(identity).slice(7, 31);
          return ReflectionLessonCandidateSchema.parse({
            schemaVersion: "1.0.0",
            id: `lesson-candidate:${suffix}`,
            version: "1.0.0",
            fingerprint: graphEvidenceFingerprint(identity),
            lifecycleStatus: "candidate",
            createdAt: lastAsOf,
            marketPackRef,
            schemaRef: {
              schemaId:
                "tradebot.semantic.reflection_lesson_candidate.v1",
              schemaVersion: "1.0.0",
            },
            artifactType: "reflection_lesson_candidate",
            reflectionAgentConfigRef: {
              id: "agent-config:semantic-historical:reflection:v1",
              version: "1.0.0",
              fingerprint: graphEvidenceFingerprint({
                agent: "reflection",
                version: "1.0.0",
              }),
            },
            failedTradeRef: {
              tradeId: `trade:failed:${suffix}`,
              decisionArtifactRef: reference(decision),
            },
            semanticLesson:
              "The rejected historical opening remains a lesson candidate and cannot mutate the strategy.",
            failurePattern: "Historical risk or portfolio gate rejected execution.",
            applicableMarketPackIds: [marketPackRef.id],
            applicableRegimes: ["trend"],
            confidence: 0.6,
            supportingEvidence: [
              {
                evidenceId: `evidence:lesson:${suffix}`,
                sourceArtifactRef: reference(decision),
                evidenceType: "lesson",
                locator: "failed-historical-execution",
                summary:
                  "The candidate references the rejected semantic decision.",
              },
            ],
          });
        },
        synthesizeResearch: async () => {
          throw new Error(
            "CSV_GRAPH_EVIDENCE_RESEARCH_SYNTHESIS_NOT_REGISTERED",
          );
        },
        approvedLessons: async () => [],
      };

      return {
        ports,
        captureCycleOutcome: async () => ({
          mode: "trading" as const,
          equity: currentEquity(),
          availableCash: Math.max(0, cash),
          realizedPnl: -fees,
          unrealizedPnl: markToMarket(),
          tradeCount,
          fillCount,
          riskRejectionCount,
        }),
        close: async () => {
          latestObservations = [];
          selectedSymbol = input.symbols[0]!;
          void latestObservations;
          void selectedSymbol;
          void initialCash;
        },
      };
    },
  };
}

export async function createCsvProductionGraphEvidenceRegistration(
  config: CsvProductionGraphEvidenceConfig,
): Promise<CsvProductionGraphEvidenceRegistration> {
  assertDateRange(config.start, config.end);
  const symbols = [...new Set(config.symbols.map((symbol) => symbol.trim()))]
    .filter(Boolean);
  if (symbols.length === 0) {
    throw new Error("CSV_GRAPH_EVIDENCE_SYMBOLS_REQUIRED");
  }
  if (
    !Number.isInteger(config.walkForward.trainingCycles) ||
    config.walkForward.trainingCycles < 2 ||
    !Number.isInteger(config.walkForward.validationCycles) ||
    config.walkForward.validationCycles < 1 ||
    !Number.isInteger(config.walkForward.stepCycles) ||
    config.walkForward.stepCycles < 1
  ) {
    throw new Error("CSV_GRAPH_EVIDENCE_WALK_FORWARD_INVALID");
  }

  const profile = await loadStrategyProfile(config.profilePath);
  if (profile.llm.enabled) {
    throw new Error("CSV_GRAPH_EVIDENCE_LLM_MUST_BE_DISABLED");
  }
  const csv = await readFile(config.csvPath, "utf8");
  parseStrictCsv(csv, new Set(symbols));
  const source = await CsvHistoricalCandleSource.fromFile(config.csvPath);
  const registeredFingerprint = await sha256File(config.csvPath);
  const asOfSequence = await buildSchedule(
    source,
    symbols,
    profile,
    config.start,
    config.end,
  );
  const requiredCycles =
    config.walkForward.trainingCycles +
    config.walkForward.validationCycles;
  if (asOfSequence.length < Math.max(2, requiredCycles)) {
    throw new Error(
      `CSV_GRAPH_EVIDENCE_SCHEDULE_INSUFFICIENT:${asOfSequence.length}:${requiredCycles}`,
    );
  }

  const now = config.now ?? (() => new Date());
  // These are versioned definitions derived from immutable CSV/profile input.
  // Their identity must not drift merely because the local process restarted.
  const createdAt = asOfSequence[0]!;
  const profileComponent = stableComponent(profile.profileId);
  const dataset = createGraphHistoricalDatasetDefinition({
    schemaVersion: "1.0.0",
    id:
      config.datasetId ??
      `dataset:csv:${profileComponent}:${registeredFingerprint.slice(0, 12)}`,
    version: `1.0.0+${registeredFingerprint.slice(0, 12)}`,
    lifecycleStatus: "active",
    createdAt,
    marketPackRef: {
      id: CURRENT_CRYPTO_MARKET_PACK.marketPackId,
      version: CURRENT_CRYPTO_MARKET_PACK.humanReadableVersion,
      fingerprint: graphEvidenceFingerprint(CURRENT_CRYPTO_MARKET_PACK),
    },
    dataSourceRef: {
      id: CSV_HISTORICAL_DATA_SOURCE.dataSourceId,
      version: `1.0.0+${registeredFingerprint.slice(0, 12)}`,
      fingerprint: `sha256:${registeredFingerprint}`,
    },
    timezone: CSV_HISTORICAL_CAPABILITY.timezone,
    tradingCalendarRef: CSV_HISTORICAL_CAPABILITY.tradingCalendar,
    asOfSequence,
  });
  const strategyFingerprint = strategyProfileFingerprint(profile);
  const graphProfile = createGraphStrategyProfileDefinition({
    schemaVersion: "1.0.0",
    id: `profile:csv:${profileComponent}:${strategyFingerprint}`,
    version: profile.profileVersion,
    lifecycleStatus: "active",
    createdAt,
    compatiblePresetIds: [
      CURRENT_CRYPTO_SEMANTIC_CSV_PIPELINE_GRAPH.pipelineGraphId,
    ],
    parameters: {
      strategyProfileFingerprint: strategyFingerprint,
      initialCash: profile.execution.initialCash,
      feeBps: profile.execution.feeBps,
      perTradeNotional: profile.decision.perTradeNotional,
      minimumConfidence: profile.decision.minimumConfidence,
      maxNotional: profile.risk.maxNotional,
    },
  });
  const profileCandidateSet = createGraphStrategyProfileCandidateSet({
    schemaVersion: "1.0.0",
    id: `profile-set:csv:${profileComponent}:${strategyFingerprint}`,
    version: profile.profileVersion,
    lifecycleStatus: "active",
    createdAt,
    profileIds: [graphProfile.id],
  });
  const walkForwardPlan = createGraphWalkForwardPlanDefinition({
    schemaVersion: "1.0.0",
    id: `walk-forward-plan:csv:${config.walkForward.trainingCycles}-${config.walkForward.validationCycles}-${config.walkForward.stepCycles}`,
    version: "1.0.0",
    lifecycleStatus: "active",
    createdAt,
    trainingCycles: config.walkForward.trainingCycles,
    validationCycles: config.walkForward.validationCycles,
    stepCycles: config.walkForward.stepCycles,
    objective:
      config.walkForward.objective ?? "total_return_pct",
  });

  return {
    registrySeed: CURRENT_CRYPTO_SEMANTIC_HISTORICAL_REGISTRY_SEED,
    pipelineGraphs: [CURRENT_CRYPTO_SEMANTIC_CSV_PIPELINE_GRAPH],
    dataset,
    profile: graphProfile,
    profileCandidateSet,
    walkForwardPlan,
    createStrategyOrchestrationOptions: (registry) => {
      const compiler = new RegisteredProductionHistoricalGraphCompiler(
        registry,
        now,
      );
      const sessionFactory = createRegisteredGraphBacktestSessionFactory(
        createSessionProvider({
          csvPath: config.csvPath,
          registeredFingerprint,
          datasetId: dataset.id,
          symbols,
          profile,
        }),
        {
          authorizedCapabilityKinds: ["bar"],
          resolvePlan: (planId) => compiler.require(planId),
          now,
        },
      );
      return {
        historicalGraphCompiler: compiler,
        graphEvidence: {
          datasets: [dataset],
          profiles: [graphProfile],
          profileCandidateSets: [profileCandidateSet],
          walkForwardPlans: [walkForwardPlan],
          sessionFactory,
          executableStrategy: {
            baseProfileId: graphProfile.id,
          },
          approvedPaperPlanPolicy:
            config.approvedPaperPlanPolicy ?? {
              planVersion: `csv-semantic:${strategyFingerprint}`,
              paperAccountRef: "paper-account:default",
              candidateSymbols: symbols,
              riskPolicyRefs: ["risk-policy:current-paper"],
            },
        },
        now,
      };
    },
  };
}
