import { createHash } from "node:crypto";
import {
  ComparativeTradeEvidenceSchema,
  LessonCandidateReviewCommandSchema,
  LessonCandidateReviewContextSchema,
  LessonCandidateReviewResponseSchema,
  type ComparativeTradeEvidence,
  type LessonCandidateReviewCommand,
  type LessonCandidateReviewContext,
  type LessonCandidateReviewRecord,
  type LessonCandidateReviewResponse,
  type TradeOutcomeEvidence,
} from "../../contracts/src/index.js";

export interface TradeOutcomeEvidencePort {
  requireTrade(tradeId: string): Promise<TradeOutcomeEvidence>;
  listPriorClosedTrades(input: {
    closedBefore: string;
    maximum: number;
  }): Promise<TradeOutcomeEvidence[]>;
}

export interface ReflectionCandidateReviewFact {
  candidateId: string;
  fingerprint: string;
  sourceTradeId: string;
}

export interface ReflectionCandidateReviewPort {
  requireCandidate(candidateId: string): Promise<ReflectionCandidateReviewFact>;
}

export interface ReflectionCandidateReviewCatalogPort
  extends ReflectionCandidateReviewPort {
  findBySourceTradeId(
    tradeId: string,
  ): Promise<ReflectionCandidateReviewFact | undefined>;
}

export interface ComparativeTradeEvidencePort {
  requireEvidence(evidenceId: string): Promise<ComparativeTradeEvidence>;
}

export interface LessonCandidateReviewRepository {
  findByIdempotencyKey(idempotencyKey: string): Promise<LessonCandidateReviewRecord | undefined>;
  append(record: LessonCandidateReviewRecord): Promise<void>;
}

export interface LessonCandidateReviewHistoryPort {
  listByCandidateId(input: {
    candidateId: string;
    cursor?: string;
    limit: number;
  }): Promise<{
    records: LessonCandidateReviewRecord[];
    nextCursor?: string;
  }>;
}

export type ReviewClock = () => string;

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export class ComparativeTradeEvidenceService {
  public constructor(
    private readonly trades: TradeOutcomeEvidencePort,
    private readonly clock: ReviewClock = () => new Date().toISOString(),
    private readonly maximumComparators = 5,
  ) {}

  public async create(selectedTradeId: string): Promise<ComparativeTradeEvidence> {
    const selectedTrade = await this.trades.requireTrade(selectedTradeId);
    const candidates = await this.trades.listPriorClosedTrades({
      closedBefore: selectedTrade.closedAt,
      maximum: 50,
    });
    const comparatorTrades = candidates
      .filter((candidate) =>
        candidate.tradeId !== selectedTrade.tradeId &&
        candidate.pipelineGraphRef.fingerprint === selectedTrade.pipelineGraphRef.fingerprint &&
        candidate.marketPackRef.id === selectedTrade.marketPackRef.id &&
        candidate.marketPackRef.fingerprint === selectedTrade.marketPackRef.fingerprint &&
        candidate.symbol === selectedTrade.symbol &&
        Date.parse(candidate.closedAt) < Date.parse(selectedTrade.closedAt),
      )
      .sort((left, right) =>
        Date.parse(right.closedAt) - Date.parse(left.closedAt) ||
        left.tradeId.localeCompare(right.tradeId),
      )
      .slice(0, this.maximumComparators);

    const baseline = comparatorTrades[0];
    const identity = {
      selectedTradeFingerprint: selectedTrade.fingerprint,
      comparatorFingerprints: comparatorTrades.map((trade) => trade.fingerprint),
      policyId: "most_recent_prior_same_graph_market_symbol",
    };
    const evidenceFingerprint = fingerprint(identity);
    const metrics = baseline
      ? [
          {
            metric: "realized_pnl" as const,
            unit: "account_currency" as const,
            selectedValue: selectedTrade.realizedPnl,
            baselineValue: baseline.realizedPnl,
            delta: selectedTrade.realizedPnl - baseline.realizedPnl,
          },
          {
            metric: "fees" as const,
            unit: "account_currency" as const,
            selectedValue: selectedTrade.fees,
            baselineValue: baseline.fees,
            delta: selectedTrade.fees - baseline.fees,
          },
          {
            metric: "holding_duration_ms" as const,
            unit: "milliseconds" as const,
            selectedValue: Date.parse(selectedTrade.closedAt) - Date.parse(selectedTrade.openedAt),
            baselineValue: Date.parse(baseline.closedAt) - Date.parse(baseline.openedAt),
            delta:
              Date.parse(selectedTrade.closedAt) -
              Date.parse(selectedTrade.openedAt) -
              (Date.parse(baseline.closedAt) - Date.parse(baseline.openedAt)),
          },
        ]
      : [];

    return ComparativeTradeEvidenceSchema.parse({
      schemaVersion: "1.0.0",
      id: `trade-comparison:${evidenceFingerprint.slice(7, 31)}`,
      humanVersion: "1.0.0",
      fingerprint: evidenceFingerprint,
      createdAt: this.clock(),
      lifecycleStatus: baseline ? "available" : "insufficient_evidence",
      selectedTrade,
      comparatorTrades,
      baselineTradeId: baseline?.tradeId,
      policy: {
        policyId: "most_recent_prior_same_graph_market_symbol",
        samePipelineGraphFingerprint: true,
        sameMarketPack: true,
        sameSymbol: true,
        priorClosedTradesOnly: true,
        maximumComparators: this.maximumComparators,
        serverSelected: true,
      },
      metrics,
      issueCodes: baseline ? [] : ["COMPARATOR_NOT_AVAILABLE"],
      causalClaim: false,
      readOnly: true,
      runtimeApplied: false,
      exchangeWriteAllowed: false,
    });
  }
}

export class LessonCandidateReviewService {
  public constructor(
    private readonly candidates: ReflectionCandidateReviewPort,
    private readonly evidence: ComparativeTradeEvidencePort,
    private readonly reviews: LessonCandidateReviewRepository,
    private readonly clock: ReviewClock = () => new Date().toISOString(),
  ) {}

  public async review(
    commandInput: LessonCandidateReviewCommand,
    contextInput: LessonCandidateReviewContext,
  ): Promise<LessonCandidateReviewResponse> {
    const command = LessonCandidateReviewCommandSchema.parse(commandInput);
    const context = LessonCandidateReviewContextSchema.parse(contextInput);
    const commandFingerprint = fingerprint(command);
    const existing = await this.reviews.findByIdempotencyKey(command.idempotencyKey);
    if (existing) {
      if (
        existing.candidateId !== command.candidateId ||
        existing.candidateFingerprint !== command.candidateFingerprint ||
        existing.comparativeEvidenceId !== command.comparativeEvidenceId ||
        existing.comparativeEvidenceFingerprint !== command.comparativeEvidenceFingerprint ||
        existing.decision !== command.decision ||
        existing.rationale !== command.rationale
      ) {
        throw new Error("LESSON_REVIEW_IDEMPOTENCY_CONFLICT");
      }
      return LessonCandidateReviewResponseSchema.parse({
        review: existing,
        nextGate:
          existing.lifecycleStatus === "accepted_for_validation"
            ? "contract_validation"
            : "candidate_closed",
        runtimeApplied: false,
      });
    }

    const candidate = await this.candidates.requireCandidate(command.candidateId);
    if (candidate.fingerprint !== command.candidateFingerprint) {
      throw new Error("LESSON_CANDIDATE_FINGERPRINT_MISMATCH");
    }
    const comparativeEvidence = await this.evidence.requireEvidence(
      command.comparativeEvidenceId,
    );
    if (comparativeEvidence.fingerprint !== command.comparativeEvidenceFingerprint) {
      throw new Error("COMPARATIVE_EVIDENCE_FINGERPRINT_MISMATCH");
    }
    if (comparativeEvidence.selectedTrade.tradeId !== candidate.sourceTradeId) {
      throw new Error("LESSON_REVIEW_TRADE_EVIDENCE_MISMATCH");
    }
    if (
      command.decision === "accept_for_validation" &&
      comparativeEvidence.lifecycleStatus !== "available"
    ) {
      throw new Error("LESSON_REVIEW_COMPARATIVE_EVIDENCE_REQUIRED");
    }

    const createdAt = this.clock();
    const recordFingerprint = fingerprint({
      commandFingerprint,
      actorId: context.actorId,
      comparativeEvidenceFingerprint: comparativeEvidence.fingerprint,
      createdAt,
    });
    const record: LessonCandidateReviewRecord = {
      schemaVersion: "1.0.0",
      id: `lesson-review:${recordFingerprint.slice(7, 31)}`,
      humanVersion: "1.0.0",
      fingerprint: recordFingerprint,
      createdAt,
      lifecycleStatus:
        command.decision === "accept_for_validation"
          ? "accepted_for_validation"
          : "rejected",
      candidateId: candidate.candidateId,
      candidateFingerprint: candidate.fingerprint as `sha256:${string}`,
      comparativeEvidenceId: comparativeEvidence.id,
      comparativeEvidenceFingerprint: comparativeEvidence.fingerprint,
      sourceTradeId: candidate.sourceTradeId,
      decision: command.decision,
      rationale: command.rationale,
      reviewer: context,
      idempotencyKey: command.idempotencyKey,
      approvedLessonCreated: false,
      strategyMutationCreated: false,
      readOnlyEvidence: true,
      runtimeApplied: false,
      exchangeWriteAllowed: false,
    };
    await this.reviews.append(record);
    return LessonCandidateReviewResponseSchema.parse({
      review: record,
      nextGate:
        record.lifecycleStatus === "accepted_for_validation"
          ? "contract_validation"
          : "candidate_closed",
      runtimeApplied: false,
    });
  }
}
