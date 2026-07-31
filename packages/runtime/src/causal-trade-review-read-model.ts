import { createHash } from "node:crypto";
import type {
  AgentArtifact,
  AgentArtifactQuery,
  CausalAgentEvidenceNode,
  CausalCycleReview,
  CausalEvidenceField,
  CausalReviewIssue,
  CausalReviewPageRequest,
  CausalRunReviewResponse,
  PaperRuntimeCycleAudit,
  PaperRuntimeRun,
  PaperAccountState,
  ReflectionReport,
  SingleTradeReview,
  StageEvent,
  TradeReviewIssue,
} from "../../contracts/src/index.js";
import {
  CausalRunReviewResponseSchema,
  SingleTradeReviewSchema,
} from "../../contracts/src/index.js";
import { SQLiteAgentArtifactLedger } from "../../adapters/src/sqlite-agent-artifact-ledger.js";
import { SQLitePaperAccountStore } from "../../adapters/src/sqlite-paper-account-store.js";
import { SQLiteReflectionStore } from "../../adapters/src/sqlite-reflection-store.js";
import { SQLiteTraceSink } from "../../adapters/src/sqlite-trace-sink.js";
import { buildTradeReview } from "./review-presenter.js";
import type {
  RuntimeEvidenceReadModelConfig,
} from "./runtime-evidence-read-model.js";

export interface CausalTradeReviewReadPorts {
  runs: {
    findLatestRun(): PaperRuntimeRun | undefined;
    getRun(runId: string): PaperRuntimeRun | undefined;
    getCycles(runId: string): readonly PaperRuntimeCycleAudit[];
  };
  traces?: {
    load(traceId: string): readonly StageEvent[];
  };
  artifacts?: {
    query(query: AgentArtifactQuery): Promise<readonly AgentArtifact[]>;
  };
  accounts?: {
    load(accountId: string): Promise<PaperAccountState | undefined>;
  };
  reflections?: {
    latest(accountId: string): Promise<ReflectionReport | undefined>;
  };
}

export class CausalTradeReviewError extends Error {
  constructor(
    readonly code:
      | "RUN_NOT_FOUND"
      | "CYCLE_NOT_FOUND"
      | "TRADE_NOT_FOUND"
      | "CAUSAL_REVIEW_CURSOR_INVALID",
    message: string,
  ) {
    super(message);
  }
}

const terminalStatuses = new Set<PaperRuntimeRun["status"]>([
  "drained",
  "orphaned",
  "completed",
  "failed",
  "safety_blocked",
]);

const sensitiveKey =
  /(api.?key|authorization|bearer|code|command|filesystem|header|password|path|prompt|secret|sql|token|url)/i;

function primitive(value: unknown): string | number | boolean | null {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value === "string" ? value.slice(0, 500) : value;
  }
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value).slice(0, 500);
}

function evidenceFields(
  value: unknown,
  prefix = "",
  depth = 0,
): { fields: CausalEvidenceField[]; redacted: boolean } {
  if (
    value === null ||
    typeof value !== "object" ||
    value instanceof Date
  ) {
    return {
      fields: [{ key: prefix || "value", value: primitive(value) }],
      redacted: false,
    };
  }
  const fields: CausalEvidenceField[] = [];
  let redacted = false;
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  for (const [key, child] of entries) {
    if (fields.length >= 40) break;
    const fieldKey = prefix ? `${prefix}.${key}` : key;
    if (sensitiveKey.test(fieldKey)) {
      redacted = true;
      continue;
    }
    if (
      depth < 2 &&
      child !== null &&
      typeof child === "object" &&
      !(child instanceof Date)
    ) {
      const nested = evidenceFields(child, fieldKey, depth + 1);
      fields.push(...nested.fields.slice(0, 40 - fields.length));
      redacted ||= nested.redacted;
    } else {
      fields.push({ key: fieldKey.slice(0, 160), value: primitive(child) });
    }
  }
  return { fields, redacted };
}

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function encodeCursor(offset: number): string {
  return Buffer.from(`tradebot-cycle-offset:${offset}`).toString("base64url");
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const match = decoded.match(/^tradebot-cycle-offset:(\d+)$/);
  if (!match) {
    throw new CausalTradeReviewError(
      "CAUSAL_REVIEW_CURSOR_INVALID",
      "The cycle cursor is not a server-issued cursor.",
    );
  }
  return Number(match[1]);
}

function normalizeStage(stage: string): string {
  return stage.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function artifactNode(
  artifact: AgentArtifact,
): { node: CausalAgentEvidenceNode; redacted: boolean } {
  const input = evidenceFields(artifact.input);
  const output = evidenceFields(artifact.output);
  return {
    node: {
      artifactId: artifact.artifactId,
      traceId: artifact.traceId,
      stage: artifact.stage,
      agentRef: artifact.agent,
      agentVersion: artifact.agentVersion,
      status: artifact.status,
      startedAt: artifact.startedAt.toISOString(),
      completedAt: artifact.completedAt.toISOString(),
      durationMs: artifact.durationMs,
      ...(artifact.symbol ? { symbol: artifact.symbol } : {}),
      ...(artifact.orderId ? { orderId: artifact.orderId } : {}),
      ...(artifact.tradeId ? { tradeId: artifact.tradeId } : {}),
      inputFields: input.fields,
      outputFields: output.fields,
      evidenceAvailability:
        artifact.status === "success" ? "available" : "partial",
    },
    redacted: input.redacted || output.redacted,
  };
}

function referencesIn(
  value: unknown,
  artifactIds: ReadonlySet<string>,
  output: Set<string>,
  depth = 0,
): void {
  if (depth > 4 || value === null || value === undefined) return;
  if (typeof value === "string") {
    if (artifactIds.has(value)) output.add(value);
    return;
  }
  if (typeof value !== "object") return;
  for (const child of Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>)) {
    referencesIn(child, artifactIds, output, depth + 1);
  }
}

function runSummary(run: PaperRuntimeRun) {
  return {
    runId: run.runId,
    status: run.status,
    planId: run.planId,
    planFingerprint: run.planFingerprint,
    strategyProfileRef: run.strategyProfileRef,
    paperAccountRef: run.paperAccountRef,
    candidateSymbols: [...run.candidateSymbols],
    plannedCycles: run.plannedCycles,
    processedCycles: run.processedCycles,
    requestedAt: run.requestedAt,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    exchangeWriteAllowed: false as const,
  };
}

function cycleSummary(
  cycle: PaperRuntimeCycleAudit,
  evidenceAvailability:
    | "available"
    | "partial"
    | "unavailable"
    | "not_inspected" = "not_inspected",
) {
  return {
    cycle: cycle.cycle,
    traceId: cycle.traceId,
    status: cycle.status,
    startedAt: cycle.startedAt,
    finishedAt: cycle.finishedAt,
    decisionCount: cycle.decisionCount,
    riskDecisionCount: cycle.riskDecisionCount,
    executionCount: cycle.executionCount,
    evidenceAvailability,
  };
}

export class CausalTradeReviewReadModelService {
  constructor(
    private readonly config: RuntimeEvidenceReadModelConfig,
    private readonly ports: CausalTradeReviewReadPorts,
    private readonly closePorts: readonly { close(): void }[] = [],
  ) {}

  async readRun(input: {
    runId?: string;
    cycle?: number;
    tradeRef?: string;
    page?: CausalReviewPageRequest;
  } = {}): Promise<CausalRunReviewResponse> {
    const run = input.runId
      ? this.ports.runs.getRun(input.runId)
      : this.ports.runs.findLatestRun();
    if (!run && input.runId) {
      throw new CausalTradeReviewError(
        "RUN_NOT_FOUND",
        `Run ${input.runId} is not registered.`,
      );
    }
    const page = input.page ?? {
      schemaVersion: "1.0.0",
      limit: 8,
    };
    if (!run) {
      const base = {
        schemaVersion: "1.0.0" as const,
        reviewId: `causal-review:${this.config.paperAccountRef}`,
        humanVersion: "1.0.0",
        createdAt: this.config.now?.().toISOString() ?? new Date().toISOString(),
        lifecycleStatus: "unavailable" as const,
        evidenceStatus: "unavailable" as const,
        dataClass:
          this.config.sourceMode === "local_fixture"
            ? "sample" as const
            : "runtime" as const,
        context: {
          marketPackRef: this.config.marketPackRef,
          dataSourceRef: this.config.sourceMode,
          paperAccountRef: this.config.paperAccountRef,
          schemaRefs: ["tradebot.causal-run-review.v1"],
        },
        cycles: [],
        pagination: { limit: page.limit },
        issues: [{
          code: "RUN_NOT_FOUND" as const,
          severity: "info" as const,
          message: "No Paper Runtime run is available for causal review.",
        }],
        readOnly: true as const,
        runtimeApplied: false as const,
        exchangeWriteAllowed: false as const,
      };
      return CausalRunReviewResponseSchema.parse({
        ...base,
        fingerprint: fingerprint(base),
      });
    }

    const allCycles = [...this.ports.runs.getCycles(run.runId)]
      .sort((left, right) => right.cycle - left.cycle);
    const offset = decodeCursor(page.cursor);
    const pageCycles = allCycles.slice(offset, offset + page.limit);
    const nextOffset = offset + pageCycles.length;
    const selectedAudit = input.cycle === undefined
      ? undefined
      : allCycles.find((cycle) => cycle.cycle === input.cycle);
    if (input.cycle !== undefined && !selectedAudit) {
      throw new CausalTradeReviewError(
        "CYCLE_NOT_FOUND",
        `Cycle ${input.cycle} is not registered for run ${run.runId}.`,
      );
    }
    const selectedCycle = selectedAudit
      ? await this.buildCycleReview(
          selectedAudit,
          run.strategyProfileRef,
          input.tradeRef,
        )
      : undefined;
    const lifecycleStatus = selectedCycle
      ? selectedCycle.cycle.evidenceAvailability === "available"
        ? terminalStatuses.has(run.status) ? "recent" : "active"
        : selectedCycle.cycle.evidenceAvailability
      : terminalStatuses.has(run.status) ? "recent" : "active";
    const createdAt =
      selectedAudit?.finishedAt ??
      run.finishedAt ??
      run.startedAt ??
      run.requestedAt;
    const base = {
      schemaVersion: "1.0.0" as const,
      reviewId: `causal-review:${run.runId}`,
      humanVersion: `run-${run.processedCycles}`,
      createdAt,
      lifecycleStatus,
      evidenceStatus: lifecycleStatus,
      dataClass:
        this.config.sourceMode === "local_fixture"
          ? "sample" as const
          : "runtime" as const,
      context: {
        marketPackRef: this.config.marketPackRef,
        dataSourceRef: this.config.sourceMode,
        paperAccountRef: this.config.paperAccountRef,
        graphRef: run.strategyProfileRef,
        schemaRefs: [
          "tradebot.causal-run-review.v1",
          "tradebot.agent-artifact.v1",
          "tradebot.stage-event.v1",
        ],
      },
      run: runSummary(run),
      cycles: pageCycles.map((cycle) =>
        cycleSummary(
          cycle,
          selectedAudit?.cycle === cycle.cycle
            ? selectedCycle?.cycle.evidenceAvailability
            : "not_inspected",
        )),
      ...(selectedCycle ? { selectedCycle } : {}),
      pagination: {
        limit: page.limit,
        ...(nextOffset < allCycles.length
          ? { nextCursor: encodeCursor(nextOffset) }
          : {}),
      },
      issues: selectedCycle?.issues ?? [],
      readOnly: true as const,
      runtimeApplied: false as const,
      exchangeWriteAllowed: false as const,
    };
    return CausalRunReviewResponseSchema.parse({
      ...base,
      fingerprint: fingerprint(base),
    });
  }

  private async buildCycleReview(
    audit: PaperRuntimeCycleAudit,
    graphRef: string,
    selectedTradeRef?: string,
  ): Promise<CausalCycleReview> {
    const traceEvents = this.ports.traces?.load(audit.traceId) ?? [];
    const artifacts = this.ports.artifacts
      ? await this.ports.artifacts.query({
          traceId: audit.traceId,
          limit: 500,
        })
      : [];
    const account = await this.ports.accounts?.load(this.config.accountId);
    const reflection = await this.ports.reflections?.latest(
      this.config.accountId,
    );
    const issues: CausalReviewIssue[] = [];
    if (traceEvents.length === 0) {
      issues.push({
        code: "TRACE_NOT_RECORDED",
        severity: "warning",
        message: "No append-only StageEvent trace was recorded for this cycle.",
      });
    }
    if (artifacts.length === 0) {
      issues.push({
        code: "ARTIFACTS_NOT_RECORDED",
        severity: "warning",
        message: "No Agent Artifact was recorded for this cycle.",
      });
    }

    const mapped = artifacts.map(artifactNode);
    for (let index = 0; index < artifacts.length; index += 1) {
      const artifact = artifacts[index]!;
      if (artifact.status === "fallback") {
        issues.push({
          code: "ARTIFACT_DEGRADED",
          severity: "warning",
          message: `${artifact.stage} used a fallback artifact.`,
          artifactId: artifact.artifactId,
        });
      }
      if (artifact.status === "error") {
        issues.push({
          code: "ARTIFACT_ERROR",
          severity: "error",
          message: `${artifact.stage} recorded an error artifact.`,
          artifactId: artifact.artifactId,
        });
      }
      if (mapped[index]?.redacted) {
        issues.push({
          code: "SENSITIVE_EVIDENCE_REDACTED",
          severity: "info",
          message: "Sensitive or executable evidence fields were redacted.",
          artifactId: artifact.artifactId,
        });
      }
    }

    const artifactIds = new Set(artifacts.map((artifact) => artifact.artifactId));
    const explicitLinks: CausalCycleReview["lineage"] = [];
    artifacts.forEach((artifact) => {
      const refs = new Set<string>();
      referencesIn(artifact.input, artifactIds, refs);
      referencesIn(artifact.output, artifactIds, refs);
      refs.delete(artifact.artifactId);
      for (const ref of refs) {
        explicitLinks.push({
          linkId: `lineage:${ref}:${artifact.artifactId}`,
          fromArtifactId: ref,
          toArtifactId: artifact.artifactId,
          relationship: "explicit_reference",
          causal: true,
        });
      }
    });
    const observedLinks = artifacts.slice(1).map((artifact, index) => ({
      linkId: `sequence:${artifacts[index]!.artifactId}:${artifact.artifactId}`,
      fromArtifactId: artifacts[index]!.artifactId,
      toArtifactId: artifact.artifactId,
      relationship: "observed_sequence" as const,
      causal: false,
    }));
    if (artifacts.length > 1 && explicitLinks.length === 0) {
      issues.push({
        code: "EXPLICIT_LINEAGE_NOT_RECORDED",
        severity: "info",
        message:
          "Artifact order is shown as observed sequence only; no causal dependency was inferred.",
      });
    }

    const idsFor = (matcher: (stage: string) => boolean) =>
      artifacts
        .filter((artifact) => matcher(normalizeStage(artifact.stage)))
        .map((artifact) => artifact.artifactId);
    const tradeRefs = new Map<string, AgentArtifact[]>();
    for (const artifact of artifacts) {
      const ref = artifact.tradeId ?? artifact.orderId;
      if (!ref) continue;
      const group = tradeRefs.get(ref) ?? [];
      group.push(artifact);
      tradeRefs.set(ref, group);
    }
    for (const order of account?.orders ?? []) {
      if (order.traceId !== audit.traceId) continue;
      const ref = order.tradeId ?? order.localOrderId;
      if (!tradeRefs.has(ref)) tradeRefs.set(ref, []);
      if (
        selectedTradeRef === order.localOrderId &&
        !tradeRefs.has(selectedTradeRef)
      ) tradeRefs.set(selectedTradeRef, []);
    }
    for (const position of account?.positions ?? []) {
      if (position.entryTraceId !== audit.traceId) continue;
      const ref = position.tradeId ?? position.entryOrderId;
      if (ref && !tradeRefs.has(ref)) tradeRefs.set(ref, []);
    }
    for (const trade of account?.closedTrades ?? []) {
      if (
        trade.entryTraceId !== audit.traceId &&
        trade.exitTraceId !== audit.traceId
      ) continue;
      const ref = trade.tradeId ?? trade.exitOrderId ?? trade.entryOrderId;
      if (ref && !tradeRefs.has(ref)) tradeRefs.set(ref, []);
      if (
        selectedTradeRef &&
        [trade.entryOrderId, trade.exitOrderId, trade.positionId]
          .includes(selectedTradeRef) &&
        !tradeRefs.has(selectedTradeRef)
      ) tradeRefs.set(selectedTradeRef, []);
    }
    if (selectedTradeRef && !tradeRefs.has(selectedTradeRef)) {
      throw new CausalTradeReviewError(
        "TRADE_NOT_FOUND",
        `Trade or order ${selectedTradeRef} is not explicitly linked to this cycle.`,
      );
    }
    const selectedRefs = selectedTradeRef
      ? [selectedTradeRef]
      : [...tradeRefs.keys()].slice(0, 100);
    const tradeReviews: CausalCycleReview["tradeReviews"] = [];
    for (const tradeRef of selectedRefs) {
      const matched = tradeRefs.get(tradeRef) ?? [];
      const singleTradeReview = await this.buildSingleTradeReview(
        audit,
        graphRef,
        tradeRef,
        artifacts,
        account,
        reflection,
      );
      const review = buildTradeReview(
        matched.length > 0 ? matched : artifacts,
        matched.some((artifact) => artifact.orderId === tradeRef)
          ? tradeRef
          : undefined,
      );
      tradeReviews.push({
        tradeRef,
        ...(matched.find((artifact) => artifact.orderId === tradeRef)
          ? { orderId: tradeRef }
          : {}),
        ...(matched.find((artifact) => artifact.tradeId === tradeRef)
          ? { tradeId: tradeRef }
          : {}),
        ...(singleTradeReview?.symbol
          ? { symbol: singleTradeReview.symbol }
          : matched.find((artifact) => artifact.symbol)?.symbol
            ? { symbol: matched.find((artifact) => artifact.symbol)!.symbol }
          : {}),
        matchedArtifactIds: matched.map((artifact) => artifact.artifactId),
        presenterFields: evidenceFields(review).fields,
        ...(singleTradeReview ? { singleTradeReview } : {}),
      });
    }

    if (!reflection) {
      issues.push({
        code: "REFLECTION_NOT_RECORDED",
        severity: "info",
        message: "No Reflection Lesson Candidate is available.",
      });
    } else {
      issues.push({
        code: "REFLECTION_NOT_CYCLE_LINKED",
        severity: "info",
        message:
          "Reflection is the latest account snapshot and is not represented as cycle-causal evidence.",
      });
    }
    const availability =
      traceEvents.length > 0 && artifacts.length > 0
        ? "available" as const
        : traceEvents.length > 0 || artifacts.length > 0
          ? "partial" as const
          : "unavailable" as const;
    return {
      cycle: cycleSummary(audit, availability),
      traceEvents: traceEvents.slice(0, 500).map((event, index) => ({
        eventId: `trace-event:${audit.cycle}:${index + 1}`,
        traceId: event.traceId,
        stage: event.stage,
        agentRef: event.agent,
        phase: event.phase,
        occurredAt: event.at.toISOString(),
        fields: evidenceFields(event.data).fields,
      })),
      agentEvidence: mapped.map(({ node }) => node),
      actionChain: {
        selectorArtifactIds: idsFor((stage) => stage.includes("selector")),
        positionMonitorArtifactIds: idsFor((stage) =>
          stage.includes("position_monitor")),
        decisionArtifactIds: idsFor((stage) => stage === "decision"),
        portfolioArtifactIds: idsFor((stage) => stage === "portfolio"),
        riskArtifactIds: idsFor((stage) => stage === "risk"),
        executionArtifactIds: idsFor((stage) => stage === "execution"),
      },
      lineage: [...explicitLinks, ...observedLinks],
      tradeReviews,
      ...(selectedTradeRef ? { selectedTradeRef } : {}),
      reflection: {
        availability: reflection ? "available" : "unavailable",
        scope: "latest_account_snapshot",
        candidateOnly: true,
        runtimeApplied: false,
        ...(reflection
          ? {
              reflectionId: reflection.reflectionId,
              asOf: reflection.asOf.toISOString(),
              recommendations: [...reflection.recommendations].slice(0, 20),
            }
          : { recommendations: [] }),
      },
      issues,
    };
  }

  private async buildSingleTradeReview(
    audit: PaperRuntimeCycleAudit,
    graphRef: string,
    tradeRef: string,
    cycleArtifacts: readonly AgentArtifact[],
    account: PaperAccountState | undefined,
    reflection: ReflectionReport | undefined,
  ): Promise<SingleTradeReview | undefined> {
    const position = account?.positions.find((item) =>
      [item.tradeId, item.positionId, item.entryOrderId].includes(tradeRef));
    const closedTrade = account?.closedTrades.find((item) =>
      [
        item.tradeId,
        item.positionId,
        item.entryOrderId,
        item.exitOrderId,
      ].includes(tradeRef));
    const matchingOrder = account?.orders.find((item) =>
      [item.localOrderId, item.tradeId, item.positionId].includes(tradeRef));
    const tradeId =
      closedTrade?.tradeId ?? position?.tradeId ?? matchingOrder?.tradeId;
    const positionId =
      closedTrade?.positionId ??
      position?.positionId ??
      matchingOrder?.positionId;
    const relatedOrders = (account?.orders ?? []).filter((order) =>
      order.localOrderId === tradeRef ||
      (tradeId !== undefined && order.tradeId === tradeId) ||
      (positionId !== undefined && order.positionId === positionId));
    const explicitArtifactIds = new Set([
      closedTrade?.entryDecisionArtifactId,
      closedTrade?.entryPortfolioArtifactId,
      closedTrade?.entryRiskArtifactId,
      closedTrade?.entryExecutionArtifactId,
      closedTrade?.exitDecisionArtifactId,
      closedTrade?.exitPortfolioArtifactId,
      closedTrade?.exitRiskArtifactId,
      closedTrade?.exitExecutionArtifactId,
      position?.entryDecisionArtifactId,
      position?.entryPortfolioArtifactId,
      position?.entryRiskArtifactId,
      position?.entryExecutionArtifactId,
      ...relatedOrders.flatMap((order) => [
        order.riskArtifactId,
        order.executionArtifactId,
      ]),
    ].filter((item): item is string => Boolean(item)));
    const traceIds = new Set([
      audit.traceId,
      position?.entryTraceId,
      closedTrade?.entryTraceId,
      closedTrade?.exitTraceId,
      ...relatedOrders.map((order) => order.traceId),
    ].filter((item): item is string => Boolean(item)));
    const relatedArtifacts = [...cycleArtifacts];
    if (this.ports.artifacts) {
      for (const traceId of traceIds) {
        if (traceId === audit.traceId) continue;
        relatedArtifacts.push(...await this.ports.artifacts.query({
          traceId,
          limit: 500,
        }));
      }
    }
    const uniqueArtifacts = [...new Map(
      relatedArtifacts.map((artifact) => [artifact.artifactId, artifact]),
    ).values()];
    const matchedArtifacts = uniqueArtifacts.filter((artifact) =>
      explicitArtifactIds.has(artifact.artifactId) ||
      artifact.orderId === tradeRef ||
      artifact.tradeId === tradeRef ||
      (tradeId !== undefined && artifact.tradeId === tradeId) ||
      relatedOrders.some((order) => artifact.orderId === order.localOrderId));
    if (
      !position &&
      !closedTrade &&
      !matchingOrder &&
      matchedArtifacts.length === 0
    ) return undefined;

    const entryOrderId =
      closedTrade?.entryOrderId ??
      position?.entryOrderId ??
      relatedOrders.find((order) =>
        order.action === "open_long" || order.action === "open_short")
        ?.localOrderId;
    const exitOrderId =
      closedTrade?.exitOrderId ??
      relatedOrders.find((order) =>
        order.action === "close_long" || order.action === "close_short")
        ?.localOrderId;
    const entryOrder = relatedOrders.find((order) =>
      order.localOrderId === entryOrderId);
    const exitOrder = relatedOrders.find((order) =>
      order.localOrderId === exitOrderId);
    const entry = {
      ...(entryOrderId ? { orderId: entryOrderId } : {}),
      ...(closedTrade?.entryTraceId ?? position?.entryTraceId
        ? { traceId: (closedTrade?.entryTraceId ?? position?.entryTraceId)! }
        : {}),
      ...(closedTrade?.entryDecisionArtifactId ??
      position?.entryDecisionArtifactId
        ? {
            decisionArtifactId:
              (closedTrade?.entryDecisionArtifactId ??
                position?.entryDecisionArtifactId)!,
          }
        : {}),
      ...(closedTrade?.entryPortfolioArtifactId ??
      position?.entryPortfolioArtifactId
        ? {
            portfolioArtifactId:
              (closedTrade?.entryPortfolioArtifactId ??
                position?.entryPortfolioArtifactId)!,
          }
        : {}),
      ...(closedTrade?.entryRiskArtifactId ?? position?.entryRiskArtifactId
        ? {
            riskArtifactId:
              (closedTrade?.entryRiskArtifactId ??
                position?.entryRiskArtifactId)!,
          }
        : {}),
      ...(closedTrade?.entryExecutionArtifactId ??
      position?.entryExecutionArtifactId
        ? {
            executionArtifactId:
              (closedTrade?.entryExecutionArtifactId ??
                position?.entryExecutionArtifactId)!,
          }
        : {}),
      ...(closedTrade?.entryFillId ?? position?.entryFillId
        ? { fillId: (closedTrade?.entryFillId ?? position?.entryFillId)! }
        : {}),
      ...(closedTrade?.entryPrice ?? position?.entryPrice
        ? { fillPrice: (closedTrade?.entryPrice ?? position?.entryPrice)! }
        : {}),
      ...(entryOrder?.fee !== undefined ? { fee: entryOrder.fee } : {}),
      ...(closedTrade?.openedAt ?? position?.openedAt
        ? {
            occurredAt:
              (closedTrade?.openedAt ?? position?.openedAt)!.toISOString(),
          }
        : {}),
    };
    const exit = closedTrade ? {
      ...(exitOrderId ? { orderId: exitOrderId } : {}),
      ...(closedTrade.exitTraceId ? { traceId: closedTrade.exitTraceId } : {}),
      ...(closedTrade.exitDecisionArtifactId
        ? { decisionArtifactId: closedTrade.exitDecisionArtifactId }
        : {}),
      ...(closedTrade.exitPortfolioArtifactId
        ? { portfolioArtifactId: closedTrade.exitPortfolioArtifactId }
        : {}),
      ...(closedTrade.exitRiskArtifactId
        ? { riskArtifactId: closedTrade.exitRiskArtifactId }
        : {}),
      ...(closedTrade.exitExecutionArtifactId
        ? { executionArtifactId: closedTrade.exitExecutionArtifactId }
        : {}),
      ...(closedTrade.exitFillId ? { fillId: closedTrade.exitFillId } : {}),
      fillPrice: closedTrade.exitPrice,
      ...(exitOrder?.fee !== undefined ? { fee: exitOrder.fee } : {}),
      occurredAt: closedTrade.closedAt.toISOString(),
      reason: closedTrade.exitReason,
    } : undefined;
    const issues: TradeReviewIssue[] = [];
    const entryComplete = Boolean(
      entry.orderId &&
      entry.decisionArtifactId &&
      entry.portfolioArtifactId &&
      entry.riskArtifactId &&
      entry.executionArtifactId,
    );
    if (!entryComplete) {
      issues.push({
        code: "ENTRY_EVIDENCE_NOT_RECORDED",
        severity: "warning",
        message: "The complete entry artifact chain was not recorded.",
      });
    }
    if (!entry.fillId) {
      issues.push({
        code: "FILL_EVIDENCE_NOT_RECORDED",
        severity: "warning",
        message: "The entry fill reference was not recorded.",
      });
    }
    const exitComplete = !closedTrade || Boolean(
      exit?.orderId &&
      exit.decisionArtifactId &&
      exit.portfolioArtifactId &&
      exit.riskArtifactId &&
      exit.executionArtifactId,
    );
    if (closedTrade && !exitComplete) {
      issues.push({
        code: "EXIT_EVIDENCE_NOT_RECORDED",
        severity: "warning",
        message: "The complete exit artifact chain was not recorded.",
      });
    }
    if (!tradeId || !positionId) {
      issues.push({
        code: "POSITION_LINEAGE_NOT_RECORDED",
        severity: "warning",
        message: "Stable Trade and Position lineage was not fully recorded.",
      });
    }
    for (const artifact of matchedArtifacts) {
      if (artifact.status === "fallback") {
        issues.push({
          code: "ARTIFACT_DEGRADED",
          severity: "warning",
          message: `${artifact.stage} used fallback evidence.`,
        });
      }
      if (artifact.status === "error") {
        issues.push({
          code: "ARTIFACT_ERROR",
          severity: "error",
          message: `${artifact.stage} recorded an error.`,
        });
      }
    }
    const reflectionLinked = Boolean(
      tradeId && reflection?.sourceTradeIds?.includes(tradeId));
    if (!reflection) {
      issues.push({
        code: "REFLECTION_NOT_RECORDED",
        severity: "info",
        message: "No Reflection Lesson Candidate is available.",
      });
    } else if (!reflectionLinked) {
      issues.push({
        code: "REFLECTION_NOT_TRADE_LINKED",
        severity: "info",
        message: "The latest Reflection is not explicitly linked to this trade.",
      });
    }
    const links: SingleTradeReview["links"] = [];
    for (const artifact of matchedArtifacts) {
      for (const source of artifact.sourceArtifactIds ?? []) {
        links.push({
          linkId: `trade-link:${source}:${artifact.artifactId}`,
          fromRef: source,
          toRef: artifact.artifactId,
          relationship: "explicit_artifact_input",
          causal: true,
        });
      }
    }
    if (entry.orderId && entry.fillId) {
      links.push({
        linkId: `trade-link:${entry.orderId}:${entry.fillId}`,
        fromRef: entry.orderId,
        toRef: entry.fillId,
        relationship: "order_fill",
        causal: true,
      });
    }
    if (tradeId && entry.fillId) {
      links.push({
        linkId: `trade-link:${entry.fillId}:${tradeId}`,
        fromRef: entry.fillId,
        toRef: tradeId,
        relationship: "position_entry",
        causal: true,
      });
    }
    if (tradeId && exit?.fillId) {
      links.push({
        linkId: `trade-link:${tradeId}:${exit.fillId}`,
        fromRef: tradeId,
        toRef: exit.fillId,
        relationship: "position_exit",
        causal: true,
      });
    }
    if (reflectionLinked && tradeId && reflection) {
      links.push({
        linkId: `trade-link:${tradeId}:${reflection.reflectionId}`,
        fromRef: tradeId,
        toRef: reflection.reflectionId,
        relationship: "reflection_source",
        causal: true,
      });
    }
    const available =
      entryComplete &&
      Boolean(entry.fillId) &&
      exitComplete &&
      Boolean(tradeId && positionId);
    const availability =
      available ? "available" as const
      : position || closedTrade || matchingOrder || matchedArtifacts.length > 0
        ? "partial" as const
        : "unavailable" as const;
    const lifecycleStatus =
      availability === "unavailable"
        ? "unavailable" as const
        : availability === "partial"
          ? "partial_evidence" as const
          : closedTrade
            ? "closed_trade" as const
            : "active_position" as const;
    const base = {
      schemaVersion: "1.0.0" as const,
      reviewId: `single-trade-review:${tradeId ?? tradeRef}`,
      humanVersion: "1.0.0",
      createdAt:
        closedTrade?.closedAt.toISOString() ??
        position?.openedAt.toISOString() ??
        audit.finishedAt,
      lifecycleStatus,
      availability,
      runId: audit.runId,
      cycle: audit.cycle,
      traceId: audit.traceId,
      tradeRef,
      ...(tradeId ? { tradeId } : {}),
      ...(positionId ? { positionId } : {}),
      ...(closedTrade?.symbol ?? position?.symbol ?? matchingOrder?.symbol
        ? {
            symbol:
              (closedTrade?.symbol ??
                position?.symbol ??
                matchingOrder?.symbol)!,
          }
        : {}),
      ...(Object.keys(entry).length > 0 ? { entry } : {}),
      ...(exit ? { exit } : {}),
      ...(closedTrade?.side ?? position?.side
        ? { side: (closedTrade?.side ?? position?.side)! }
        : {}),
      ...(closedTrade?.qty ?? position?.qty
        ? { quantity: (closedTrade?.qty ?? position?.qty)! }
        : {}),
      ...(closedTrade
        ? {
            realizedPnl: closedTrade.realizedPnl,
            fees: closedTrade.fees,
          }
        : {}),
      ...(reflectionLinked && reflection
        ? { reflectionId: reflection.reflectionId }
        : {}),
      reflectionCandidateOnly: true as const,
      links,
      issues,
      marketPackRef: this.config.marketPackRef,
      dataSourceRef: this.config.sourceMode,
      graphRef,
      schemaRefs: [
        "tradebot.single-trade-review.v1",
        "tradebot.agent-artifact.v1",
        "tradebot.paper-account-state.v1",
      ],
      readOnly: true as const,
      runtimeApplied: false as const,
      exchangeWriteAllowed: false as const,
    };
    return SingleTradeReviewSchema.parse({
      ...base,
      fingerprint: fingerprint(base),
    });
  }

  close(): void {
    for (const port of this.closePorts) port.close();
  }
}

export function createSqliteCausalTradeReviewReadModelService(
  config: RuntimeEvidenceReadModelConfig,
  runs: CausalTradeReviewReadPorts["runs"],
): CausalTradeReviewReadModelService {
  const closePorts: { close(): void }[] = [];
  const traces = config.traceDatabasePath
    ? new SQLiteTraceSink(config.traceDatabasePath)
    : undefined;
  const artifacts = config.artifactDatabasePath
    ? new SQLiteAgentArtifactLedger(config.artifactDatabasePath)
    : undefined;
  const reflections = config.reflectionDatabasePath
    ? new SQLiteReflectionStore(config.reflectionDatabasePath)
    : undefined;
  const accounts = new SQLitePaperAccountStore(config.paperDatabasePath);
  if (traces) closePorts.push(traces);
  if (artifacts) closePorts.push(artifacts);
  if (reflections) closePorts.push(reflections);
  closePorts.push(accounts);
  return new CausalTradeReviewReadModelService(
    config,
    {
      runs,
      ...(traces ? { traces } : {}),
      ...(artifacts ? { artifacts } : {}),
      ...(reflections ? { reflections } : {}),
      accounts,
    },
    closePorts,
  );
}
