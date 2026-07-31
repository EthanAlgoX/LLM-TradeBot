import { createHash } from "node:crypto";
import { SQLitePaperAccountStore } from "../../adapters/src/sqlite-paper-account-store.js";
import { SQLiteReflectionStore } from "../../adapters/src/sqlite-reflection-store.js";
import { SQLiteAgentArtifactLedger } from "../../adapters/src/sqlite-agent-artifact-ledger.js";
import {
  ReflectionCandidateReviewSummarySchema,
  TradeOutcomeEvidenceSchema,
  type ReflectionCandidateReviewSummary,
  type TradeOutcomeEvidence,
} from "../../contracts/src/index.js";
import {
  ComparativeTradeEvidenceService,
  LessonCandidateReviewService,
  type ReflectionCandidateReviewCatalogPort,
  type ReflectionCandidateReviewFact,
  type TradeOutcomeEvidencePort,
} from "../../core/src/comparative-trade-review-service.js";
import {
  LessonEvidenceGateProjectionService,
  type LessonEvidenceScope,
} from "../../core/src/lesson-evidence-gate-service.js";
import { LessonHumanApprovalService } from "../../core/src/lesson-human-approval-service.js";
import {
  ApprovedLessonMaterializationService,
  type ReflectionSemanticLessonCandidatePort,
} from "../../core/src/approved-lesson-materialization-service.js";
import { ReflectionLessonCandidateSchema } from "../../contracts/src/index.js";
import type { StrategyEvidenceApprovalService } from "../../core/src/strategy-evidence-approval-service.js";
import type { OrchestrationActor } from "../../contracts/src/index.js";
import {
  LessonCandidateValidationHandoffService,
} from "../../core/src/lesson-candidate-validation-handoff-service.js";
import {
  LessonCandidateValidationBindingService,
  type LessonCandidateConfigurationValidationPort,
  type LessonCandidatePipelineValidationPort,
  type LessonCandidateStrategyConfigurationResolver,
  type LessonCandidateValidationBindingRepository,
} from "../../core/src/lesson-candidate-validation-binding-service.js";
import {
  ComparativeTradeReviewHttpHandler,
  type LessonReviewBearerAuthenticator,
} from "./comparative-trade-review-http.js";
import { SQLiteLessonCandidateReviewRepository } from "./sqlite-lesson-candidate-review-repository.js";
import { SQLiteLessonHumanApprovalRepository } from "./sqlite-lesson-human-approval-repository.js";
import { ArtifactLedgerShadowDecisionContextBaseAdapter } from "./artifact-ledger-shadow-decision-context.js";
import { SQLiteShadowReplayAuditRepository } from "./sqlite-shadow-replay-audit-repository.js";

interface PaperClosedTrade {
  tradeId?: string;
  symbol: string;
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  exitPrice: number;
  openedAt: Date | string;
  closedAt: Date | string;
  exitReason: string;
  realizedPnl: number;
  fees: number;
  exitTraceId?: string;
}

interface PaperAccountReader {
  load(accountId: string): Promise<
    | {
        closedTrades: PaperClosedTrade[];
      }
    | undefined
  >;
}

interface ReflectionReader {
  latest(accountId: string): Promise<unknown>;
  getCandidate(accountId: string, candidateId: string): Promise<{
    candidate: unknown;
    sourceReflectionFingerprint: `sha256:${string}`;
  } | undefined>;
  findCandidateBySourceTradeId(accountId: string, sourceTradeId: string): Promise<{
    candidate: unknown;
    sourceReflectionFingerprint: `sha256:${string}`;
  } | undefined>;
}

type VersionedRef = {
  id: string;
  version: string;
  fingerprint: `sha256:${string}`;
};

export interface ProductionComparativeTradeReviewReferences {
  marketPackRef: VersionedRef;
  dataSourceRef: VersionedRef;
  pipelineGraphRef: VersionedRef;
  schemaRef: {
    schemaId: string;
    schemaVersion: string;
  };
}

export interface ProductionComparativeTradeReviewOptions
  extends ProductionComparativeTradeReviewReferences {
  accountId: string;
  paperDatabasePath: string;
  reflectionDatabasePath: string;
  reviewDatabasePath: string;
  artifactDatabasePath?: string;
  authenticator: LessonReviewBearerAuthenticator;
  validationBinding?: {
    repository: LessonCandidateValidationBindingRepository;
    configurations: LessonCandidateConfigurationValidationPort;
    configurationResolver: LessonCandidateStrategyConfigurationResolver;
    pipelines: LessonCandidatePipelineValidationPort;
  };
  evidenceGate?: {
    strategyEvidence: StrategyEvidenceApprovalService;
    scopes: readonly LessonEvidenceScope[];
    deriveActor: (
      context: Awaited<ReturnType<LessonReviewBearerAuthenticator["authenticate"]>>,
    ) => OrchestrationActor;
  };
  now?: () => string;
}

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function safeLegacyId(prefix: string, value: string): string {
  return `${prefix}:${fingerprint(value).slice(7, 31)}`;
}

function timestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class PaperAccountTradeOutcomeEvidenceAdapter
  implements TradeOutcomeEvidencePort
{
  public constructor(
    private readonly accounts: PaperAccountReader,
    private readonly accountId: string,
    private readonly references: ProductionComparativeTradeReviewReferences,
  ) {}

  public async requireTrade(tradeId: string): Promise<TradeOutcomeEvidence> {
    const trades = await this.load();
    const trade = trades.find((candidate) => candidate.tradeId === tradeId);
    if (!trade) {
      throw new Error("SELECTED_TRADE_NOT_REGISTERED");
    }
    return this.map(trade);
  }

  public async listPriorClosedTrades(input: {
    closedBefore: string;
    maximum: number;
  }): Promise<TradeOutcomeEvidence[]> {
    const trades = await this.load();
    return trades
      .filter((trade) => timestamp(trade.closedAt) < Date.parse(input.closedBefore))
      .sort((left, right) => timestamp(right.closedAt) - timestamp(left.closedAt))
      .slice(0, input.maximum)
      .map((trade) => this.map(trade));
  }

  private async load(): Promise<PaperClosedTrade[]> {
    const account = await this.accounts.load(this.accountId);
    if (!account) {
      throw new Error("PAPER_ACCOUNT_NOT_REGISTERED");
    }
    return account.closedTrades;
  }

  private map(trade: PaperClosedTrade): TradeOutcomeEvidence {
    if (!trade.tradeId || !trade.exitTraceId) {
      throw new Error("TRADE_LINEAGE_INCOMPLETE");
    }
    const runId = trade.exitTraceId.includes(":cycle:")
      ? trade.exitTraceId.slice(0, trade.exitTraceId.indexOf(":cycle:"))
      : safeLegacyId("paper-run", trade.exitTraceId);
    const identity = {
      accountId: this.accountId,
      trade,
      references: this.references,
    };
    return TradeOutcomeEvidenceSchema.parse({
      schemaVersion: "1.0.0",
      id: `trade-outcome:${fingerprint(identity).slice(7, 31)}`,
      humanVersion: "1.0.0",
      fingerprint: fingerprint(identity),
      createdAt: iso(trade.closedAt),
      lifecycleStatus: "recorded",
      tradeId: trade.tradeId,
      runId,
      traceId: trade.exitTraceId,
      symbol: trade.symbol,
      side: trade.side,
      openedAt: iso(trade.openedAt),
      closedAt: iso(trade.closedAt),
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      quantity: trade.qty,
      realizedPnl: trade.realizedPnl,
      fees: trade.fees,
      closeReason: trade.exitReason,
      ...this.references,
    });
  }
}

export class ReflectionStoreCandidateReviewAdapter
  implements ReflectionCandidateReviewCatalogPort
{
  public constructor(
    private readonly reflections: ReflectionReader,
    private readonly accountId: string,
  ) {}

  public async requireCandidate(
    candidateId: string,
  ): Promise<ReflectionCandidateReviewFact> {
    const stored = await this.reflections.getCandidate(this.accountId, candidateId);
    const parsed = ReflectionLessonCandidateSchema.safeParse(stored?.candidate);
    if (!stored || !parsed.success) {
      throw new Error("LESSON_CANDIDATE_NOT_REGISTERED");
    }
    return {
      candidateId: parsed.data.id,
      fingerprint: parsed.data.fingerprint,
      sourceTradeId: parsed.data.failedTradeRef.tradeId,
    };
  }

  public async findBySourceTradeId(
    tradeId: string,
  ): Promise<ReflectionCandidateReviewFact | undefined> {
    const stored = await this.reflections.findCandidateBySourceTradeId(this.accountId, tradeId);
    const parsed = ReflectionLessonCandidateSchema.safeParse(stored?.candidate);
    return parsed.success ? {
      candidateId: parsed.data.id,
      fingerprint: parsed.data.fingerprint,
      sourceTradeId: parsed.data.failedTradeRef.tradeId,
    } : undefined;
  }

  public async inspectBySourceTradeId(
    tradeId: string,
  ): Promise<ReflectionCandidateReviewSummary | undefined> {
    const stored = await this.reflections.findCandidateBySourceTradeId(this.accountId, tradeId);
    const parsed = ReflectionLessonCandidateSchema.safeParse(stored?.candidate);
    if (!stored || !parsed.success) return undefined;
    const candidate = parsed.data;
    return ReflectionCandidateReviewSummarySchema.parse({
      schemaVersion: "1.0.0",
      id: candidate.id,
      humanVersion: "1.0.0",
      fingerprint: candidate.fingerprint,
      createdAt: candidate.createdAt,
      lifecycleStatus: "candidate",
      sourceTradeId: candidate.failedTradeRef.tradeId,
      sourceReflectionFingerprint: stored.sourceReflectionFingerprint,
      semanticCandidateRef: {
        id: candidate.id,
        fingerprint: candidate.fingerprint,
      },
      semanticFactsAvailable: true,
      lineageStatus: "verified",
      readOnly: true,
      runtimeApplied: false,
      exchangeWriteAllowed: false,
    });
  }
}

export class ReflectionStoreSemanticLessonCandidateAdapter
  implements ReflectionSemanticLessonCandidatePort
{
  public constructor(
    private readonly reflections: ReflectionReader,
    private readonly accountId: string,
  ) {}

  public async findBySourceTradeId(selectedTradeId: string) {
    const stored = await this.reflections.findCandidateBySourceTradeId(
      this.accountId,
      selectedTradeId,
    );
    const parsed = ReflectionLessonCandidateSchema.safeParse(stored?.candidate);
    return parsed.success ? parsed.data : undefined;
  }
}

export class ProductionComparativeTradeReviewComposition {
  public readonly handler: ComparativeTradeReviewHttpHandler;
  private readonly paperStore: SQLitePaperAccountStore;
  private readonly reflectionStore: SQLiteReflectionStore;
  private readonly reviewRepository: SQLiteLessonCandidateReviewRepository;
  private readonly lessonApprovalRepository: SQLiteLessonHumanApprovalRepository;
  private readonly artifactLedger?: SQLiteAgentArtifactLedger;
  private readonly shadowAuditRepository: SQLiteShadowReplayAuditRepository;

  public constructor(options: ProductionComparativeTradeReviewOptions) {
    this.paperStore = new SQLitePaperAccountStore(options.paperDatabasePath);
    this.reflectionStore = new SQLiteReflectionStore(
      options.reflectionDatabasePath,
    );
    this.reviewRepository = new SQLiteLessonCandidateReviewRepository(
      options.reviewDatabasePath,
    );
    this.lessonApprovalRepository = new SQLiteLessonHumanApprovalRepository(
      options.reviewDatabasePath,
    );
    this.artifactLedger = options.artifactDatabasePath ? new SQLiteAgentArtifactLedger(options.artifactDatabasePath) : undefined;
    this.shadowAuditRepository = new SQLiteShadowReplayAuditRepository(options.reviewDatabasePath);
    const references = {
      marketPackRef: options.marketPackRef,
      dataSourceRef: options.dataSourceRef,
      pipelineGraphRef: options.pipelineGraphRef,
      schemaRef: options.schemaRef,
    };
    const trades = new PaperAccountTradeOutcomeEvidenceAdapter(
      this.paperStore,
      options.accountId,
      references,
    );
    const candidates = new ReflectionStoreCandidateReviewAdapter(
      this.reflectionStore,
      options.accountId,
    );
    const comparisons = new ComparativeTradeEvidenceService(
      trades,
      options.now,
    );
    const evidenceIndex = new Map<string, Awaited<ReturnType<typeof comparisons.create>>>();
    const indexedComparisons = {
      create: async (tradeId: string) => {
        const evidence = await comparisons.create(tradeId);
        evidenceIndex.set(evidence.id, evidence);
        return evidence;
      },
    };
    const lessonReviews = new LessonCandidateReviewService(
      candidates,
      {
        async requireEvidence(evidenceId) {
          const evidence = evidenceIndex.get(evidenceId);
          if (!evidence) throw new Error("COMPARATIVE_EVIDENCE_NOT_REGISTERED");
          return evidence;
        },
      },
      this.reviewRepository,
      options.now,
    );
    const validationBindings = options.validationBinding
      ? new LessonCandidateValidationBindingService(
          candidates,
          this.reviewRepository,
          indexedComparisons,
          options.validationBinding.configurations,
          options.validationBinding.configurationResolver,
          options.validationBinding.pipelines,
          options.validationBinding.repository,
          options.now,
        )
      : undefined;
    const validationHandoff = new LessonCandidateValidationHandoffService(
      candidates,
      this.reviewRepository,
      indexedComparisons,
      validationBindings,
      options.now,
    );
    const evidenceGate = validationBindings && options.evidenceGate
      ? new LessonEvidenceGateProjectionService(
          validationBindings,
          options.evidenceGate.strategyEvidence,
          {
            resolve: () => options.evidenceGate?.scopes ?? [],
          },
          options.evidenceGate.deriveActor,
          options.now,
        )
      : undefined;
    const lessonApprovals = evidenceGate && options.evidenceGate
      ? new LessonHumanApprovalService(
          evidenceGate,
          options.evidenceGate.strategyEvidence,
          this.lessonApprovalRepository,
          options.now,
        )
      : undefined;
    const materializations = lessonApprovals && evidenceGate
      ? new ApprovedLessonMaterializationService(
          lessonApprovals,
          evidenceGate,
          new ReflectionStoreSemanticLessonCandidateAdapter(
            this.reflectionStore,
            options.accountId,
          ),
          this.artifactLedger ? new ArtifactLedgerShadowDecisionContextBaseAdapter(this.paperStore, this.artifactLedger, {
            accountId: options.accountId,
            marketPackRef: options.marketPackRef,
            dataSourceRef: options.dataSourceRef,
            baseCurrency: "USDT",
            riskProfileId: "risk-profile:current-crypto-paper",
            maximumRiskBudget: 100,
          }) : undefined,
          options.now,
          this.shadowAuditRepository,
        )
      : undefined;
    this.handler = new ComparativeTradeReviewHttpHandler(
      indexedComparisons,
      lessonReviews,
      options.authenticator,
      candidates,
      this.reviewRepository,
      validationHandoff,
      validationBindings,
      evidenceGate,
      lessonApprovals,
      materializations,
      this.shadowAuditRepository,
    );
  }

  public close(): void {
    this.artifactLedger?.close();
    this.shadowAuditRepository.close();
    this.lessonApprovalRepository.close();
    this.reviewRepository.close();
    this.reflectionStore.close();
    this.paperStore.close();
  }
}
