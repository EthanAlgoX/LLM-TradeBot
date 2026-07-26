import {
  CycleRequestSchema,
  CycleResultSchema,
  SCHEMA_VERSION,
  type CycleRequest,
  type CycleResult,
  type DecisionBundle,
  type RiskDecision,
  type ExecutionResult,
  type StageEvent,
} from "../../contracts/src/index.js";
import type {
  DataSyncAgent,
  DataQualityAgent,
  DecisionAgent,
  AnalysisAgent,
  DirectionalCaseAgent,
  ExecutionAgent,
  PortfolioAgent,
  PositionMonitorAgent,
  PositionStatePort,
  PortfolioStatePort,
  PortfolioRiskAgent,
  ReflectionAgent,
  ReflectionStore,
  TradeHistoryPort,
  RiskAgent,
  SelectorAgent,
  TraceSink,
  ArtifactLedger,
} from "./ports.js";

export interface TradingApplication {
  runCycle(request: CycleRequest): Promise<CycleResult>;
}

export interface PipelineDependencies {
  selector: SelectorAgent;
  dataSync: DataSyncAgent;
  dataQuality?: DataQualityAgent;
  analysis: AnalysisAgent;
  bullCase: DirectionalCaseAgent;
  bearCase: DirectionalCaseAgent;
  decision: DecisionAgent;
  portfolio: PortfolioAgent;
  risk: RiskAgent;
  execution: ExecutionAgent;
  positionState?: PositionStatePort;
  portfolioState?: PortfolioStatePort;
  portfolioRisk?: PortfolioRiskAgent;
  positionMonitor?: PositionMonitorAgent;
  reflection?: ReflectionAgent;
  tradeHistory?: TradeHistoryPort;
  reflectionStore?: ReflectionStore;
  reflectionAccountId?: string;
  maxExecutionsPerCycle?: number;
  traceSink?: TraceSink;
  artifactLedger?: ArtifactLedger;
  now?: () => Date;
}

export class DecisionPipeline implements TradingApplication {
  constructor(private readonly deps: PipelineDependencies) {}

  async runCycle(rawRequest: CycleRequest): Promise<CycleResult> {
    const request = CycleRequestSchema.parse(rawRequest);
    const events: StageEvent[] = [];
    let artifactSequence = 0;
    const emit = async (stage: string, agent: string, phase: StageEvent["phase"], data: Record<string, unknown> = {}) => {
      const event: StageEvent = {
        schemaVersion: SCHEMA_VERSION,
        traceId: request.traceId,
        stage,
        agent,
        phase,
        at: this.deps.now?.() ?? new Date(),
        data,
      };
      events.push(event);
      await this.deps.traceSink?.append(event);
    };
    const invoke = async <T>(stage: string, agent: { name: string; version: string }, input: unknown, symbol: string | undefined, operation: () => Promise<T>): Promise<T> => {
      const startedAt = this.deps.now?.() ?? new Date();
      try {
        const output = await operation();
        const completedAt = this.deps.now?.() ?? new Date();
        const fallback = typeof output === "object" && output !== null && "llmAudit" in output && (output as { llmAudit?: { fallbackUsed?: boolean } }).llmAudit?.fallbackUsed === true;
        const outputRecord = output as Record<string, unknown>;
        await this.deps.artifactLedger?.append({ schemaVersion: SCHEMA_VERSION, artifactId: `${request.traceId}:artifact:${++artifactSequence}`, traceId: request.traceId, asOf: request.asOf, symbol, stage, agent: agent.name, agentVersion: agent.version, status: fallback ? "fallback" : "success", startedAt, completedAt, durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()), input, output, orderId: typeof outputRecord?.localOrderId === "string" ? outputRecord.localOrderId : undefined });
        return output;
      } catch (error) {
        const completedAt = this.deps.now?.() ?? new Date();
        await this.deps.artifactLedger?.append({ schemaVersion: SCHEMA_VERSION, artifactId: `${request.traceId}:artifact:${++artifactSequence}`, traceId: request.traceId, asOf: request.asOf, symbol, stage, agent: agent.name, agentVersion: agent.version, status: "error", startedAt, completedAt, durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()), input, error: error instanceof Error ? error.message : "unknown agent error" });
        throw error;
      }
    };

    await emit("selector", this.deps.selector.name, "start");
    const universe = await invoke("selector", this.deps.selector, { request }, undefined, () => this.deps.selector.run({ request }));
    await emit("selector", this.deps.selector.name, "end", { selected: universe.candidates.filter((c) => c.tradable).length });

    const selected = universe.candidates.filter((candidate) => candidate.tradable).map((candidate) => candidate.symbol);
    const openPositions = await this.deps.positionState?.getOpenPositions() ?? [];
    // The request symbols are the Selector's candidate pool, not an instruction
    // to bypass its ranking. Only admitted symbols enter the opening pipeline;
    // open positions are always included so Position Monitor can still exit them.
    const symbols = [...new Set([...selected, ...openPositions.map((position) => position.symbol)])];
    const decisions: DecisionBundle[] = [];
    const riskDecisions: RiskDecision[] = [];
    const executions: ExecutionResult[] = [];

    const markPrices: Record<string, number> = {};
    for (const symbol of symbols) {
      await emit("data", this.deps.dataSync.name, "start", { symbol });
      const dataInput = { traceId: request.traceId, asOf: request.asOf, symbol, timeframes: ["5m", "15m", "1h"] as const };
      const snapshot = await invoke("data", this.deps.dataSync, dataInput, symbol, () => this.deps.dataSync.run(dataInput));
      markPrices[symbol] = snapshot.liveQuote.price;
      await emit("data", this.deps.dataSync.name, "end", { symbol, alignmentOk: snapshot.quality.alignmentOk });

      if (this.deps.dataQuality) {
        await emit("data_quality", this.deps.dataQuality.name, "start", { symbol });
        const quality = await invoke("data_quality", this.deps.dataQuality, snapshot, symbol, () => this.deps.dataQuality!.run(snapshot));
        await emit("data_quality", this.deps.dataQuality.name, "end", { symbol, passed: quality.passed, reasons: quality.reasons });
        if (!quality.passed) continue;
      }

      await emit("analysis", this.deps.analysis.name, "start", { symbol });
      const analysis = await invoke("analysis", this.deps.analysis, snapshot, symbol, () => this.deps.analysis.run(snapshot));
      await emit("analysis", this.deps.analysis.name, "end", { symbol, regime: analysis.regime, trend: analysis.trend, setup: analysis.setup, trigger: analysis.trigger });

      const existingPosition = openPositions.find((position) => position.symbol === symbol);
      if (existingPosition && this.deps.positionMonitor) {
        await emit("position_monitor", this.deps.positionMonitor.name, "start", { symbol });
        const monitorInput = { request, snapshot, analysis, position: existingPosition };
        const exitDecision = await invoke("position_monitor", this.deps.positionMonitor, monitorInput, symbol, () => this.deps.positionMonitor!.run(monitorInput));
        if (exitDecision) decisions.push(exitDecision);
        await emit("position_monitor", this.deps.positionMonitor.name, "end", { symbol, action: exitDecision?.action ?? "hold" });
        continue;
      }

      await emit("directional_cases", "bull_bear_cases", "start", { symbol });
      const [bullCase, bearCase] = await Promise.all([invoke("bull_case", this.deps.bullCase, analysis, symbol, () => this.deps.bullCase.run(analysis)), invoke("bear_case", this.deps.bearCase, analysis, symbol, () => this.deps.bearCase.run(analysis))]);
      await emit("directional_cases", "bull_bear_cases", "end", { symbol, bullConfidence: bullCase.confidence, bearConfidence: bearCase.confidence });

      await emit("decision", this.deps.decision.name, "start", { symbol });
      const decisionInput = { request, snapshot, analysis, bullCase, bearCase };
      const decision = await invoke("decision", this.deps.decision, decisionInput, symbol, () => this.deps.decision.run(decisionInput));
      decisions.push(decision);
      await emit("decision", this.deps.decision.name, "end", { symbol, action: decision.action });
    }

    await emit("portfolio", this.deps.portfolio.name, "start", { proposals: decisions.length });
    const selectedDecisions = await invoke("portfolio", this.deps.portfolio, decisions, undefined, () => this.deps.portfolio.run(decisions));
    await emit("portfolio", this.deps.portfolio.name, "end", { selected: selectedDecisions.length });

    for (const [decisionIndex, decision] of selectedDecisions.entries()) {
      const symbol = decision.symbol;
      await emit("risk", this.deps.risk.name, "start", { symbol, action: decision.action });
      const risk = await invoke("risk", this.deps.risk, { decision }, symbol, () => this.deps.risk.run({ decision }));
      riskDecisions.push(risk);
      await emit("risk", this.deps.risk.name, "end", { symbol, passed: risk.passed });

      if (!risk.passed || !decision.orderIntent || !request.executionEnabled) {
        continue;
      }

      if (request.executionMode === "close_only") {
        const position = openPositions.find(
          (candidate) => candidate.symbol === symbol,
        );
        const reducesExistingPosition =
          (position?.side === "long" && decision.action === "close_long") ||
          (position?.side === "short" && decision.action === "close_short");
        if (!reducesExistingPosition) {
          await emit("execution", this.deps.execution.name, "end", {
            symbol,
            status: "skipped",
            reason: "close_only_new_opening_blocked",
            decisionIndex,
          });
          continue;
        }
      }

      if (this.deps.portfolioRisk && this.deps.portfolioState) {
        await emit("portfolio_risk", this.deps.portfolioRisk.name, "start", { symbol, action: decision.action });
        const portfolioRiskInput = { decision, state: this.deps.portfolioState.markToMarket(markPrices) };
        const accountRisk = await invoke("portfolio_risk", this.deps.portfolioRisk, portfolioRiskInput, symbol, () => this.deps.portfolioRisk!.run(portfolioRiskInput));
        await emit("portfolio_risk", this.deps.portfolioRisk.name, "end", { symbol, passed: accountRisk.passed, reasons: accountRisk.reasons, projectedUsedMarginPct: accountRisk.projectedUsedMarginPct });
        if (!accountRisk.passed) continue;
      }

      if (this.deps.maxExecutionsPerCycle !== undefined && executions.length >= this.deps.maxExecutionsPerCycle) {
        await emit("execution", this.deps.execution.name, "end", { symbol, status: "skipped", reason: "max_executions_per_cycle", decisionIndex });
        continue;
      }

      await emit("execution", this.deps.execution.name, "start", { symbol, action: decision.action });
      const execution = await invoke("execution", this.deps.execution, { decision, risk }, symbol, () => this.deps.execution.run({ decision, risk }));
      executions.push(execution);
      await emit("execution", this.deps.execution.name, "end", { symbol, status: execution.status });
    }

    if (this.deps.reflection && this.deps.tradeHistory) {
      await emit("reflection", this.deps.reflection.name, "start");
      const reflectionInput = { asOf: request.asOf, trades: this.deps.tradeHistory.getClosedTrades() };
      const report = await invoke("reflection", this.deps.reflection, reflectionInput, undefined, () => this.deps.reflection!.run(reflectionInput));
      if (report && this.deps.reflectionStore && this.deps.reflectionAccountId) await this.deps.reflectionStore.save(this.deps.reflectionAccountId, report);
      await emit("reflection", this.deps.reflection.name, "end", {
        reflectionId: report?.reflectionId ?? null,
        sampleSize: report?.sampleSize ?? 0,
        provider: report?.llmAudit?.provider,
        model: report?.llmAudit?.model,
        fallbackUsed: report?.llmAudit?.fallbackUsed,
        errorCategory: report?.llmAudit?.errorCategory,
      });
    }

    const status = riskDecisions.some((risk) => !risk.passed)
      ? "partial"
      : decisions.length === 0
        ? "blocked"
        : "ok";
    return CycleResultSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      traceId: request.traceId,
      asOf: request.asOf,
      universe,
      decisions,
      riskDecisions,
      executions,
      markPrices,
      status,
    });
  }
}
