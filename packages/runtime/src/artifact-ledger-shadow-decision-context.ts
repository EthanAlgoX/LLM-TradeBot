import { createHash } from "node:crypto";
import {
  AgentSemanticAssessmentSchema,
  AnalysisBundleSchema,
  DecisionBundleSchema,
  DecisionSemanticContextSchema,
  DirectionalCaseSchema,
  MarketObservationArtifactSchema,
  MultiTimeframeSnapshotSchema,
  PortfolioStateSchema,
  RiskDecisionSchema,
  type AgentArtifact,
  type AgentSemanticAssessment,
  type DecisionSemanticContext,
  type MarketObservationArtifact,
  type ReflectionLessonCandidate,
} from "../../contracts/src/index.js";
import type { ArtifactLedger } from "../../core/src/ports.js";
import type { ShadowDecisionContextBasePort } from "../../core/src/approved-lesson-materialization-service.js";

type VersionedRef = { id: string; version: string; fingerprint: `sha256:${string}` };
interface HistoricalTrade { tradeId?: string; entryTraceId?: string; entryDecisionArtifactId?: string; symbol: string }
interface HistoricalPaperAccountReader { load(accountId: string): Promise<{ closedTrades: HistoricalTrade[] } | undefined> }
export interface ArtifactLedgerShadowDecisionContextOptions { accountId: string; marketPackRef: VersionedRef; dataSourceRef: VersionedRef; baseCurrency: string; riskProfileId: string; maximumRiskBudget: number }

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export class ArtifactLedgerShadowDecisionContextBaseAdapter implements ShadowDecisionContextBasePort {
  public constructor(private readonly accounts: HistoricalPaperAccountReader, private readonly artifacts: Pick<ArtifactLedger, "query">, private readonly options: ArtifactLedgerShadowDecisionContextOptions) {}

  public async load(selectedTradeId: string, candidate: ReflectionLessonCandidate): Promise<Omit<DecisionSemanticContext, "approvedLessons"> | undefined> {
    if (candidate.marketPackRef.id !== this.options.marketPackRef.id || candidate.marketPackRef.fingerprint !== this.options.marketPackRef.fingerprint) throw new Error("SHADOW_DECISION_CONTEXT_MARKET_STALE");
    const account = await this.accounts.load(this.options.accountId);
    const trade = account?.closedTrades.find((item) => item.tradeId === selectedTradeId);
    if (!trade?.entryTraceId || !trade.entryDecisionArtifactId) throw new Error("SHADOW_DECISION_CONTEXT_FACTS_UNAVAILABLE");
    const history = await this.artifacts.query({ traceId: trade.entryTraceId, limit: 500 });
    const decisionArtifact = history.find((item) => item.artifactId === trade.entryDecisionArtifactId && item.stage === "decision");
    if (!decisionArtifact) throw new Error("SHADOW_DECISION_CONTEXT_FACTS_UNAVAILABLE");
    if (candidate.failedTradeRef.decisionArtifactRef.artifactId !== decisionArtifact.artifactId || candidate.failedTradeRef.decisionArtifactRef.fingerprint !== fingerprint(decisionArtifact)) throw new Error("SHADOW_DECISION_CONTEXT_ARTIFACT_STALE");
    const dataArtifact = this.require(history, "data", trade.symbol);
    const analysisArtifact = this.require(history, "analysis", trade.symbol);
    const bullArtifact = this.require(history, "bull_case", trade.symbol);
    const bearArtifact = this.require(history, "bear_case", trade.symbol);
    const portfolioArtifact = this.require(history, "portfolio");
    const riskArtifact = this.require(history, "risk", trade.symbol);
    const snapshot = MultiTimeframeSnapshotSchema.parse(dataArtifact.output);
    const analysis = AnalysisBundleSchema.parse(analysisArtifact.output);
    const decision = DecisionBundleSchema.parse(decisionArtifact.output);
    const portfolioState = PortfolioStateSchema.safeParse(record(portfolioArtifact.input)?.portfolioStateSnapshot);
    const risk = RiskDecisionSchema.parse(riskArtifact.output);
    const runtimeControl = record(record(riskArtifact.input)?.runtimeControlSnapshot);
    if (!portfolioState.success || !runtimeControl) throw new Error("SHADOW_DECISION_CONTEXT_FACTS_UNAVAILABLE");
    const observations = this.observations(snapshot, dataArtifact);
    const assessments = [this.assessment(bullArtifact, analysis.regime, observations), this.assessment(bearArtifact, analysis.regime, observations)];
    const identity = { selectedTradeId, candidateFingerprint: candidate.fingerprint, artifactFingerprints: history.map(fingerprint), marketPackFingerprint: this.options.marketPackRef.fingerprint };
    const contextId = `shadow-context-base:${fingerprint(identity).slice(7, 31)}`;
    const withoutFingerprint = {
      schemaVersion: "1.0.0" as const, id: contextId, version: "1.0.0", lifecycleStatus: "validated" as const,
      createdAt: decisionArtifact.completedAt.toISOString(), marketPackRef: this.options.marketPackRef,
      schemaRef: { schemaId: "tradebot.semantic.decision_semantic_context.v1", schemaVersion: "1.0.0" }, artifactType: "decision_semantic_context" as const,
      asOf: decision.asOf.toISOString(), decisionAgentConfigRef: this.agentConfigRef(decisionArtifact), observations, assessments,
      portfolioState: { asOf: decision.asOf.toISOString(), baseCurrency: this.options.baseCurrency, equity: Math.max(0, portfolioState.data.equity), availableCash: Math.max(0, portfolioState.data.cash), openPositionRefs: portfolioState.data.positions.map((position) => ({ artifactId: position.entryExecutionArtifactId ?? position.positionId ?? `position:${fingerprint(position).slice(7, 31)}`, artifactType: "paper_position", fingerprint: fingerprint(position) })) },
      riskState: { asOf: decision.asOf.toISOString(), riskProfileId: this.options.riskProfileId, newEntriesPaused: runtimeControl.newEntriesPaused === true, closeOnly: runtimeControl.closeOnly === true, remainingRiskBudget: Math.max(0, this.options.maximumRiskBudget - portfolioState.data.usedMargin), activeFlags: [...(risk.passed ? [] : ["risk_rejected"]), ...(risk.blockedReason ? [risk.blockedReason] : []), ...risk.warnings] },
      dataQuality: { status: snapshot.quality.alignmentOk && snapshot.quality.missingTimeframes.length === 0 ? "pass" as const : "fail" as const, issueCodes: [...snapshot.quality.missingTimeframes, ...snapshot.quality.warnings], checkedArtifactRefs: observations.map((item) => ({ artifactId: item.id, artifactType: item.artifactType, fingerprint: item.fingerprint })) },
      lineageFingerprints: [...observations.map((item) => item.lineage.fingerprint), ...assessments.map((item) => item.lineageFingerprint)],
    };
    const validated = DecisionSemanticContextSchema.parse({
      ...withoutFingerprint,
      fingerprint: fingerprint(withoutFingerprint),
      approvedLessons: [],
    });
    const { approvedLessons: _approvedLessons, ...base } = validated;
    return base;
  }

  private require(artifacts: readonly AgentArtifact[], stage: string, symbol?: string): AgentArtifact {
    const artifact = artifacts.find((item) => item.stage === stage && (!symbol || item.symbol === symbol) && item.status !== "error");
    if (!artifact) throw new Error("SHADOW_DECISION_CONTEXT_FACTS_UNAVAILABLE");
    return artifact;
  }

  private observations(snapshot: ReturnType<typeof MultiTimeframeSnapshotSchema.parse>, source: AgentArtifact): MarketObservationArtifact[] {
    return (["5m", "15m", "1h"] as const).map((timeframe) => {
      const bars = snapshot.stableBars[timeframe];
      if (bars.length === 0) throw new Error("SHADOW_DECISION_CONTEXT_FACTS_UNAVAILABLE");
      const lineageIdentity = { sourceArtifactFingerprint: fingerprint(source), timeframe, dataSourceFingerprint: this.options.dataSourceRef.fingerprint };
      const identity = { lineageIdentity, bars, asOf: snapshot.asOf };
      return MarketObservationArtifactSchema.parse({
        schemaVersion: "1.0.0", id: `shadow-observation:${fingerprint(identity).slice(7, 31)}`, version: "1.0.0", fingerprint: fingerprint(identity), lifecycleStatus: "validated", createdAt: source.completedAt.toISOString(), marketPackRef: this.options.marketPackRef,
        schemaRef: { schemaId: "tradebot.semantic.market_observation.v1", schemaVersion: "1.0.0" }, artifactType: "market_observation", asOf: snapshot.asOf.toISOString(), availableAt: bars.at(-1)!.closeTime.toISOString(),
        observationWindowRef: { id: `window:crypto:${timeframe}`, version: "1.0.0", fingerprint: fingerprint({ timeframe }), kind: "bar_interval" },
        lineage: { lineageId: `shadow-lineage:${fingerprint(lineageIdentity).slice(7, 31)}`, fingerprint: fingerprint(lineageIdentity), sourceDefinitionId: this.options.dataSourceRef.id, sourceCapabilityId: `capability:ohlcv:${timeframe}`, transformationVersion: "1.0.0", timezone: "UTC", tradingCalendarRef: "calendar:crypto:24x7" },
        payload: { kind: "bar_interval", symbol: snapshot.symbol, bars: bars.map((bar) => ({ openedAt: bar.openTime.toISOString(), closedAt: bar.closeTime.toISOString(), availableAt: bar.closeTime.toISOString(), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume })) },
      });
    });
  }

  private assessment(source: AgentArtifact, regime: string, observations: readonly MarketObservationArtifact[]): AgentSemanticAssessment {
    const directional = DirectionalCaseSchema.parse(source.output);
    if (directional.evidence.length === 0 || directional.invalidationConditions.length === 0) throw new Error("SHADOW_DECISION_CONTEXT_FACTS_UNAVAILABLE");
    const primary = observations[0]!;
    const identity = { sourceFingerprint: fingerprint(source), observationFingerprints: observations.map((item) => item.fingerprint) };
    return AgentSemanticAssessmentSchema.parse({
      schemaVersion: "1.0.0", id: `shadow-assessment:${fingerprint(identity).slice(7, 31)}`, version: "1.0.0", fingerprint: fingerprint(identity), lifecycleStatus: "validated", createdAt: source.completedAt.toISOString(), marketPackRef: this.options.marketPackRef,
      schemaRef: { schemaId: "tradebot.semantic.agent_assessment.v1", schemaVersion: "1.0.0" }, artifactType: "agent_semantic_assessment", assessmentKind: directional.side === "long" ? "bull_case" : "bear_case", agentConfigRef: this.agentConfigRef(source), direction: directional.side === "long" ? "bullish" : "bearish", confidence: directional.confidence / 100, regime, semanticThesis: directional.evidence.join("; "),
      supportingEvidence: [{ evidenceId: `shadow-evidence:${fingerprint(identity).slice(7, 31)}`, sourceArtifactRef: { artifactId: primary.id, artifactType: primary.artifactType, fingerprint: primary.fingerprint }, evidenceType: "agent_assessment", locator: `agent-artifact:${source.artifactId}`, summary: directional.evidence.join("; ") }],
      invalidationConditions: directional.invalidationConditions, riskFlags: directional.veto ? ["agent_veto"] : [], sourceArtifactRefs: observations.map((item) => ({ artifactId: item.id, artifactType: item.artifactType, fingerprint: item.fingerprint })), lineageFingerprint: primary.lineage.fingerprint,
    });
  }

  private agentConfigRef(artifact: AgentArtifact): VersionedRef {
    return { id: `agent-config:${artifact.agent}`, version: artifact.agentVersion, fingerprint: fingerprint({ agent: artifact.agent, version: artifact.agentVersion }) };
  }
}
