import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import type {
  OrchestrationActor,
  PipelineGraphVersion,
} from "../../contracts/src/index.js";
import {
  BINANCE_FUTURES_PUBLIC_CAPABILITY,
  BINANCE_FUTURES_PUBLIC_DATA_SOURCE,
  CSV_HISTORICAL_CAPABILITY,
  CSV_HISTORICAL_DATA_SOURCE,
  DAILY_RESEARCH_CAPABILITY,
  DAILY_RESEARCH_DATA_SOURCE,
} from "../../adapters/src/data-source-capability-manifests.js";
import {
  CURRENT_CRYPTO_AGENT_CONFIGS,
  CURRENT_CRYPTO_AGENT_TEMPLATES,
  CURRENT_CRYPTO_MARKET_PACK,
  CURRENT_CRYPTO_PIPELINE_GRAPH,
} from "../../core/src/current-crypto-pipeline-graph.js";
import {
  ApprovedPaperPlanService,
  type ApprovedPaperPlanPolicy,
} from "../../core/src/approved-paper-plan-service.js";
import {
  PipelineEvidenceWorkflow,
  UnavailablePipelineEvidenceExecutor,
  type PipelineEvidenceExecutor,
} from "../../core/src/pipeline-evidence-workflow.js";
import {
  ImmutablePipelineRegistry,
  PipelineGraphCompiler,
  PipelineOrchestrationService,
  type PipelineRegistrySeed,
} from "../../core/src/pipeline-orchestration.js";
import {
  OrchestrationIntentCompiler,
  OrchestrationIntentDraftService,
} from "../../core/src/orchestration-intent-compiler.js";
import {
  OrchestrationCopilotService,
} from "../../core/src/orchestration-copilot-service.js";
import { createRegisteredSemanticPipelinePresetCatalog } from "../../core/src/semantic-pipeline-presets.js";
import { validatePipelineGraph } from "../../core/src/pipeline-graph-validator.js";
import { createPipelineOrchestrationHttpServer } from "./pipeline-orchestration-http.js";
import { SqlitePipelineDraftRepository } from "./sqlite-pipeline-draft-repository.js";
import { SqlitePipelineEvidenceRepository } from "./sqlite-pipeline-evidence-repository.js";
import { SqliteConversationReplayRepository } from "./sqlite-conversation-replay-repository.js";
import { LocalBearerAuthenticator } from "./pipeline-orchestration-auth.js";
import {
  HistoricalEvidenceArtifactStore,
  HistoricalEvidenceRunnerRegistry,
  RegisteredHistoricalEvidenceExecutor,
  SqliteHistoricalArtifactLedger,
  type RegisteredHistoricalEvidenceRunner,
} from "./registered-historical-evidence-executor.js";
import { SqliteApprovedPaperPlanRepository } from "./sqlite-approved-paper-plan-repository.js";
import { SqliteApprovedPaperEvidenceVerifier } from "./sqlite-approved-paper-evidence-verifier.js";
import {
  PaperRuntimeActivationService,
  PaperRuntimeBindingRegistry,
  type RegisteredPaperRuntimeBinding,
} from "./paper-runtime-activation.js";
import { SqlitePaperRuntimeRunRepository } from "./sqlite-paper-runtime-run-repository.js";
import { SqlitePaperRuntimeOperationsRepository } from "./sqlite-paper-runtime-operations-repository.js";
import {
  PaperRuntimeSupervisorService,
  SqlitePaperRuntimeSupervisorRepository,
} from "./sqlite-paper-runtime-supervisor.js";
import {
  createProductionStrategyOrchestration,
  type ProductionStrategyOrchestration,
  type ProductionStrategyOrchestrationOptions,
} from "./production-strategy-orchestration.js";
import { CurrentCryptoPaperLaunchService } from "./current-crypto-paper-launch.js";
import {
  createSqliteRuntimeEvidenceReadModelService,
  type RuntimeEvidenceReadModelConfig,
  type RuntimeEvidenceReadModelService,
} from "./runtime-evidence-read-model.js";
import { RuntimeEvidenceHttpHandler } from "./runtime-evidence-http.js";
import {
  createSqliteCausalTradeReviewReadModelService,
  type CausalTradeReviewReadModelService,
} from "./causal-trade-review-read-model.js";
import { CausalTradeReviewHttpHandler } from "./causal-trade-review-http.js";
import {
  ProductionComparativeTradeReviewComposition,
  type ProductionComparativeTradeReviewOptions,
} from "./production-comparative-trade-review.js";
import {
  SqliteLessonCandidateValidationBindingRepository,
} from "./sqlite-lesson-candidate-validation-binding-repository.js";

export type ComparativeTradeReviewRuntimeOptions = Omit<
  ProductionComparativeTradeReviewOptions,
  "authenticator" | "validationBinding" | "evidenceGate"
>;

export interface CurrentPipelineOrchestrationRuntimeOptions {
  database?: DatabaseSync;
  databasePath?: string;
  maxBodyBytes?: number;
  operatorToken?: string;
  operatorActor?: OrchestrationActor;
  evidenceExecutor?: PipelineEvidenceExecutor;
  historicalRunners?: readonly RegisteredHistoricalEvidenceRunner[];
  artifactDirectory?: string;
  paperPlanPolicy?: ApprovedPaperPlanPolicy;
  paperRuntimeBindings?: readonly RegisteredPaperRuntimeBinding[];
  paperRuntimeOwnerId?: string;
  paperRuntimeLeaseTtlMs?: number;
  paperRuntimePreflightTtlMs?: number;
  currentCryptoPaperLaunchPreset?: boolean;
  runtimeEvidenceReadModel?: RuntimeEvidenceReadModelConfig;
  comparativeTradeReview?: ComparativeTradeReviewRuntimeOptions;
  strategyOrchestration?: ProductionStrategyOrchestrationOptions;
  strategyOrchestrationFactory?: (
    registry: ImmutablePipelineRegistry,
  ) => ProductionStrategyOrchestrationOptions;
  registrySeed?: PipelineRegistrySeed;
  pipelineGraphs?: readonly PipelineGraphVersion[];
}

export interface CurrentPipelineOrchestrationRuntime {
  database: DatabaseSync;
  ownsDatabase: boolean;
  registry: ImmutablePipelineRegistry;
  repository: SqlitePipelineDraftRepository;
  compiler: PipelineGraphCompiler;
  service: PipelineOrchestrationService;
  intentCompiler: OrchestrationIntentCompiler;
  intentDraftService: OrchestrationIntentDraftService;
  orchestrationCopilotService: OrchestrationCopilotService;
  evidenceRepository: SqlitePipelineEvidenceRepository;
  evidenceWorkflow: PipelineEvidenceWorkflow;
  artifactStore?: HistoricalEvidenceArtifactStore;
  artifactLedger?: SqliteHistoricalArtifactLedger;
  paperPlanRepository: SqliteApprovedPaperPlanRepository;
  paperPlanService: ApprovedPaperPlanService;
  paperRuntimeRunRepository: SqlitePaperRuntimeRunRepository;
  paperRuntimeOperationsRepository: SqlitePaperRuntimeOperationsRepository;
  paperRuntimeSupervisorRepository: SqlitePaperRuntimeSupervisorRepository;
  paperRuntimeSupervisorService: PaperRuntimeSupervisorService;
  paperRuntimeActivationService: PaperRuntimeActivationService;
  currentCryptoPaperLaunchService?: CurrentCryptoPaperLaunchService;
  runtimeEvidenceReadModelService?: RuntimeEvidenceReadModelService;
  causalTradeReviewReadModelService?: CausalTradeReviewReadModelService;
  comparativeTradeReviewComposition?: ProductionComparativeTradeReviewComposition;
  productionStrategyOrchestration: ProductionStrategyOrchestration;
  ephemeralOperatorToken: string;
  server: ReturnType<typeof createPipelineOrchestrationHttpServer>;
  close(): Promise<void>;
}

export interface StartPipelineOrchestrationServerOptions
  extends CurrentPipelineOrchestrationRuntimeOptions {
  host?: "127.0.0.1" | "::1" | "localhost";
  port?: number;
}

function implementationBindings() {
  return CURRENT_CRYPTO_PIPELINE_GRAPH.nodes.flatMap((node) => {
    const agentConfigId = (node as unknown as { agentConfigId?: string }).agentConfigId;
    return agentConfigId
      ? [{ agentConfigId, implementationKey: `tradebot:${agentConfigId}` }]
      : [];
  });
}

export function createCurrentPipelineOrchestrationRuntime(
  options: CurrentPipelineOrchestrationRuntimeOptions = {},
): CurrentPipelineOrchestrationRuntime {
  if (options.database && options.databasePath) {
    throw new Error("Provide database or databasePath, not both.");
  }
  if (
    options.strategyOrchestration &&
    options.strategyOrchestrationFactory
  ) {
    throw new Error(
      "Provide strategyOrchestration or strategyOrchestrationFactory, not both.",
    );
  }

  const ownsDatabase = !options.database;
  const database =
    options.database ??
    new DatabaseSync(options.databasePath ?? "tradebot-orchestration.sqlite");
  const registrySeed = options.registrySeed ?? {};
  const registry = new ImmutablePipelineRegistry({
    marketPacks: [
      CURRENT_CRYPTO_MARKET_PACK,
      ...(registrySeed.marketPacks ?? []),
    ],
    dataSources: [
      BINANCE_FUTURES_PUBLIC_DATA_SOURCE,
      CSV_HISTORICAL_DATA_SOURCE,
      DAILY_RESEARCH_DATA_SOURCE,
      ...(registrySeed.dataSources ?? []),
    ],
    capabilities: [
      BINANCE_FUTURES_PUBLIC_CAPABILITY,
      CSV_HISTORICAL_CAPABILITY,
      DAILY_RESEARCH_CAPABILITY,
      ...(registrySeed.capabilities ?? []),
    ],
    agentTemplates: [
      ...CURRENT_CRYPTO_AGENT_TEMPLATES,
      ...(registrySeed.agentTemplates ?? []),
    ],
    agentConfigs: [
      ...CURRENT_CRYPTO_AGENT_CONFIGS,
      ...(registrySeed.agentConfigs ?? []),
    ],
    implementationBindings: [
      ...implementationBindings(),
      ...(registrySeed.implementationBindings ?? []),
    ],
  });
  const repository = new SqlitePipelineDraftRepository(database);
  const validator = (graph: PipelineGraphVersion) =>
    validatePipelineGraph(graph, registry.toValidationContext());
  const compiler = new PipelineGraphCompiler(registry, validator);
  const service = new PipelineOrchestrationService(
    repository,
    compiler,
    validator,
  );
  const intentCompiler = new OrchestrationIntentCompiler({
    registry,
    presets: createRegisteredSemanticPipelinePresetCatalog(),
    bindings: [
      {
        presetId: "preset.current-crypto-multi-agent",
        graph: CURRENT_CRYPTO_PIPELINE_GRAPH,
        marketPackIds: [CURRENT_CRYPTO_MARKET_PACK.marketPackId],
        dataSourceIds: CURRENT_CRYPTO_PIPELINE_GRAPH.dataSourceRefs,
      },
    ],
    validateGraph: validator,
  });
  const intentDraftService = new OrchestrationIntentDraftService(
    intentCompiler,
    service,
  );
  const operatorToken =
    options.operatorToken ?? randomBytes(24).toString("base64url");
  const operatorActor = options.operatorActor ?? {
    actorId: "local:operator",
    displayName: "Local TradeBot Operator",
    roles: ["operator", "approver"] as const,
  };
  const authenticator = new LocalBearerAuthenticator([
    {
      token: operatorToken,
      actor: operatorActor,
    },
  ]);
  const evidenceRepository = new SqlitePipelineEvidenceRepository(database);
  if (options.evidenceExecutor && options.historicalRunners) {
    throw new Error(
      "Provide evidenceExecutor or historicalRunners, not both.",
    );
  }
  const artifactStore = options.historicalRunners
    ? new HistoricalEvidenceArtifactStore(
        options.artifactDirectory ?? "tradebot-evidence-artifacts",
      )
    : undefined;
  const artifactLedger = options.historicalRunners
    ? new SqliteHistoricalArtifactLedger(database)
    : undefined;
  const evidenceExecutor =
    options.evidenceExecutor ??
    (options.historicalRunners && artifactStore && artifactLedger
      ? new RegisteredHistoricalEvidenceExecutor(
          new HistoricalEvidenceRunnerRegistry(options.historicalRunners),
          artifactStore,
          artifactLedger,
        )
      : new UnavailablePipelineEvidenceExecutor());
  const evidenceWorkflow = new PipelineEvidenceWorkflow(
    service,
    evidenceRepository,
    evidenceExecutor,
  );
  const paperPlanRepository = new SqliteApprovedPaperPlanRepository(database);
  const strategyOrchestration =
    options.strategyOrchestrationFactory?.(registry) ??
    options.strategyOrchestration;
  const productionStrategyOrchestration =
    createProductionStrategyOrchestration(
      {
        database,
        registry,
        pipelineService: service,
        authenticator,
        paperPlanRepository,
      },
      strategyOrchestration,
    );
  const comparativeTradeReviewComposition = options.comparativeTradeReview
    ? new ProductionComparativeTradeReviewComposition({
        ...options.comparativeTradeReview,
        authenticator: {
          async authenticate(authorization) {
            const actor = authenticator.authenticate(
              authorization ?? undefined,
            );
            if (!actor.roles.includes("approver")) {
              throw new Error("Authenticated actor is not an approver.");
            }
            return {
              actorId: actor.actorId,
              role: "approver",
              authenticatedAt: new Date().toISOString(),
            };
          },
        },
        validationBinding: {
          repository:
            new SqliteLessonCandidateValidationBindingRepository(database),
          configurations:
            productionStrategyOrchestration.configurationDraftService,
          configurationResolver:
            productionStrategyOrchestration.configurationDraftRepository,
          pipelines: service,
        },
        ...(productionStrategyOrchestration.strategyEvidenceApprovalService
          ? {
              evidenceGate: {
                strategyEvidence:
                  productionStrategyOrchestration.strategyEvidenceApprovalService,
                scopes: productionStrategyOrchestration.lessonEvidenceScopes,
                deriveActor: (context) => {
                  if (context.actorId !== operatorActor.actorId) {
                    throw new Error("FORBIDDEN");
                  }
                  return operatorActor;
                },
              },
            }
          : {}),
      })
    : undefined;
  const conversationReplayRepository =
    new SqliteConversationReplayRepository(database);
  const orchestrationCopilotService = new OrchestrationCopilotService({
    intentDraftService,
    configurationDraftService:
      productionStrategyOrchestration.configurationDraftService,
    pipelineService: service,
    evidenceWorkflow,
    registry,
    replayRepository: conversationReplayRepository,
    recipes: [
      {
        presetId: "preset.event-only-research",
        aliases: ["新闻", "事件", "news", "event"],
        marketPackId: CURRENT_CRYPTO_MARKET_PACK.marketPackId,
        dataSourceIds: [],
        defaultObservationWindows: [
          { kind: "event_batch", unit: "hour", value: 1 },
        ],
        editableAgentTemplateId: "agent-template:analysis:v1",
        editableParameters: {},
      },
      {
        presetId: "preset.single-window-daily",
        aliases: ["日线", "单周期", "daily", "1d"],
        marketPackId: CURRENT_CRYPTO_MARKET_PACK.marketPackId,
        dataSourceIds: [DAILY_RESEARCH_DATA_SOURCE.dataSourceId],
        defaultObservationWindows: [
          { kind: "bar_interval", unit: "day", value: 1 },
        ],
        editableAgentTemplateId: "agent-template:analysis:v1",
        editableParameters: { confidenceThreshold: 0.6 },
      },
      {
        presetId: "preset.current-crypto-multi-agent",
        aliases: ["当前", "加密", "比特币", "crypto", "btc", "current"],
        marketPackId: CURRENT_CRYPTO_MARKET_PACK.marketPackId,
        dataSourceIds: CURRENT_CRYPTO_PIPELINE_GRAPH.dataSourceRefs,
        defaultObservationWindows: [
          { kind: "bar_interval", unit: "minute", value: 5 },
          { kind: "bar_interval", unit: "minute", value: 15 },
          { kind: "bar_interval", unit: "hour", value: 1 },
        ],
        editableAgentTemplateId: "agent-template:analysis:v1",
        editableParameters: {
          confidenceThreshold: 0.6,
          lookbackPeriods: 48,
        },
      },
    ],
  });
  const paperEvidenceVerifier = new SqliteApprovedPaperEvidenceVerifier(
    database,
    evidenceRepository,
    artifactStore,
    artifactLedger,
  );
  const paperPlanService = new ApprovedPaperPlanService(
    service,
    paperEvidenceVerifier,
    paperPlanRepository,
    options.paperPlanPolicy ?? {
      planVersion: "1.0.0",
      marketPackRefs: ["market-pack:crypto:v1"],
      paperAccountRef: "paper-account:default",
      candidateSymbols: ["BTCUSDT"],
      riskPolicyRefs: ["risk-policy:current-paper"],
    },
  );
  const paperRuntimeOperationsRepository =
    new SqlitePaperRuntimeOperationsRepository(database);
  const paperRuntimeRunRepository = new SqlitePaperRuntimeRunRepository(database);
  const runtimeEvidenceReadModelService =
    options.runtimeEvidenceReadModel
      ? createSqliteRuntimeEvidenceReadModelService(
          options.runtimeEvidenceReadModel,
          paperRuntimeRunRepository,
        )
      : undefined;
  const runtimeEvidenceHttpHandler = runtimeEvidenceReadModelService
    ? new RuntimeEvidenceHttpHandler(
        authenticator,
        runtimeEvidenceReadModelService,
      )
    : undefined;
  const causalTradeReviewReadModelService =
    options.runtimeEvidenceReadModel
      ? createSqliteCausalTradeReviewReadModelService(
          options.runtimeEvidenceReadModel,
          paperRuntimeRunRepository,
        )
      : undefined;
  const causalTradeReviewHttpHandler = causalTradeReviewReadModelService
    ? new CausalTradeReviewHttpHandler(
        authenticator,
        causalTradeReviewReadModelService,
      )
    : undefined;
  const paperRuntimeSupervisorRepository =
    new SqlitePaperRuntimeSupervisorRepository(database);
  const paperRuntimeSupervisorService = new PaperRuntimeSupervisorService(
    paperRuntimeSupervisorRepository,
    paperRuntimeRunRepository,
    paperRuntimeOperationsRepository,
  );
  const paperRuntimeActivationService = new PaperRuntimeActivationService(
    paperPlanService,
    new PaperRuntimeBindingRegistry(options.paperRuntimeBindings ?? []),
    paperRuntimeRunRepository,
    paperRuntimeOperationsRepository,
    {
      ...(options.paperRuntimeOwnerId
        ? { ownerId: options.paperRuntimeOwnerId }
        : {}),
      ...(options.paperRuntimeLeaseTtlMs
        ? { leaseTtlMs: options.paperRuntimeLeaseTtlMs }
        : {}),
      ...(options.paperRuntimePreflightTtlMs
        ? { preflightTtlMs: options.paperRuntimePreflightTtlMs }
        : {}),
      supervisor: paperRuntimeSupervisorRepository,
    },
  );
  const currentCryptoPaperLaunchService =
    new CurrentCryptoPaperLaunchService({
      available: options.currentCryptoPaperLaunchPreset === true,
      graph: CURRENT_CRYPTO_PIPELINE_GRAPH,
      orchestration: service,
      evidenceWorkflow,
      paperPlans: paperPlanService,
      paperRuntime: paperRuntimeActivationService,
    });
  const operationalOutboxDispatcher = new SqliteOperationalOutboxDispatcher({
    database,
  });
  const operationalOutboxWorker = new DurableOperationalOutboxWorker({
    dispatcher: operationalOutboxDispatcher,
    ownerId: "dispatcher-worker:server",
    schedule: createOperationalDispatcherSchedule({
      scheduleId: "operational-outbox-schedule:default",
      humanVersion: "1.0.0",
      lifecycleStatus: "disabled",
      intervalMs: 30_000,
      batchLimit: 100,
      createdAt: new Date().toISOString(),
    }),
  });
  const operationalRetentionService = new SqliteOperationalRetentionService({
    database,
    dispatcher: operationalOutboxDispatcher,
    policy: createOperationalRetentionPolicy({
      policyId: "operational-retention-policy:default",
      humanVersion: "1.0.0",
      lifecycleStatus: "disabled",
      retentionDays: 90,
      candidateLimit: 1_000,
      createdAt: new Date().toISOString(),
      cleanupAllowed: false,
    }),
  });
  const server = createPipelineOrchestrationHttpServer({
    registry,
    service,
    intentDraftService,
    orchestrationCopilotService,
    authenticator,
    evidenceWorkflow,
    paperPlanService,
    paperRuntimeActivationService,
    currentCryptoPaperLaunchService,
    runtimeEvidenceHttpHandler,
    causalTradeReviewHttpHandler,
    ...(comparativeTradeReviewComposition
      ? {
          comparativeTradeReviewHttpHandler:
            comparativeTradeReviewComposition.handler,
        }
      : {}),
    paperRuntimeSupervisorService,
    operationalOutboxDispatcher,
    operationalOutboxWorker,
    operationalRetentionService,
    configurationDraftHttpHandler:
      productionStrategyOrchestration.configurationDraftHttpHandler,
    ...(productionStrategyOrchestration.strategyEvidenceHttpHandler
      ? {
          strategyEvidenceHttpHandler:
            productionStrategyOrchestration.strategyEvidenceHttpHandler,
        }
      : {}),
    ...(productionStrategyOrchestration.historicalSemanticEvaluationHttpHandler
      ? {
          historicalSemanticEvaluationHttpHandler:
            productionStrategyOrchestration.historicalSemanticEvaluationHttpHandler,
        }
      : {}),
    productionWorkspaceCatalog:
      productionStrategyOrchestration.workspaceCatalog,
    pipelineGraphs: [
      CURRENT_CRYPTO_PIPELINE_GRAPH,
      ...(options.pipelineGraphs ?? []),
    ],
    ...(options.maxBodyBytes ? { maxBodyBytes: options.maxBodyBytes } : {}),
  });

  return {
    database,
    ownsDatabase,
    registry,
    repository,
    compiler,
    service,
    intentCompiler,
    intentDraftService,
    orchestrationCopilotService,
    evidenceRepository,
    evidenceWorkflow,
    paperPlanRepository,
    paperPlanService,
    paperRuntimeRunRepository,
    paperRuntimeOperationsRepository,
    paperRuntimeSupervisorRepository,
    paperRuntimeSupervisorService,
    paperRuntimeActivationService,
    currentCryptoPaperLaunchService,
    ...(runtimeEvidenceReadModelService
      ? { runtimeEvidenceReadModelService }
      : {}),
    ...(causalTradeReviewReadModelService
      ? { causalTradeReviewReadModelService }
      : {}),
    ...(comparativeTradeReviewComposition
      ? { comparativeTradeReviewComposition }
      : {}),
    productionStrategyOrchestration,
    ...(artifactStore ? { artifactStore } : {}),
    ...(artifactLedger ? { artifactLedger } : {}),
    ephemeralOperatorToken: operatorToken,
    server,
    async close(): Promise<void> {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
      runtimeEvidenceReadModelService?.close();
      causalTradeReviewReadModelService?.close();
      comparativeTradeReviewComposition?.close();
      if (ownsDatabase) {
        database.close();
      }
    },
  };
}

export async function startCurrentPipelineOrchestrationServer(
  options: StartPipelineOrchestrationServerOptions = {},
): Promise<CurrentPipelineOrchestrationRuntime> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8787;
  const runtime = createCurrentPipelineOrchestrationRuntime(options);
  await new Promise<void>((resolve, reject) => {
    runtime.server.once("error", reject);
    runtime.server.listen(port, host, () => {
      runtime.server.off("error", reject);
      resolve();
    });
  });
  return runtime;
}
import { SqliteOperationalOutboxDispatcher } from "./sqlite-operational-outbox-dispatcher.js";
import {
  DurableOperationalOutboxWorker,
  createOperationalDispatcherSchedule,
} from "./operational-outbox-worker.js";
import {
  SqliteOperationalRetentionService,
  createOperationalRetentionPolicy,
} from "./sqlite-operational-retention.js";
