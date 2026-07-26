import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import type { OrchestrationActor } from "../../contracts/src/index.js";
import {
  BINANCE_FUTURES_PUBLIC_CAPABILITY,
  BINANCE_FUTURES_PUBLIC_DATA_SOURCE,
  CSV_HISTORICAL_CAPABILITY,
  CSV_HISTORICAL_DATA_SOURCE,
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
} from "../../core/src/pipeline-orchestration.js";
import { validatePipelineGraph } from "../../core/src/pipeline-graph-validator.js";
import { createPipelineOrchestrationHttpServer } from "./pipeline-orchestration-http.js";
import { SqlitePipelineDraftRepository } from "./sqlite-pipeline-draft-repository.js";
import { SqlitePipelineEvidenceRepository } from "./sqlite-pipeline-evidence-repository.js";
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
}

export interface CurrentPipelineOrchestrationRuntime {
  database: DatabaseSync;
  ownsDatabase: boolean;
  registry: ImmutablePipelineRegistry;
  repository: SqlitePipelineDraftRepository;
  compiler: PipelineGraphCompiler;
  service: PipelineOrchestrationService;
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

  const ownsDatabase = !options.database;
  const database =
    options.database ??
    new DatabaseSync(options.databasePath ?? "tradebot-orchestration.sqlite");
  const registry = new ImmutablePipelineRegistry({
    marketPacks: [CURRENT_CRYPTO_MARKET_PACK],
    dataSources: [
      BINANCE_FUTURES_PUBLIC_DATA_SOURCE,
      CSV_HISTORICAL_DATA_SOURCE,
    ],
    capabilities: [
      BINANCE_FUTURES_PUBLIC_CAPABILITY,
      CSV_HISTORICAL_CAPABILITY,
    ],
    agentTemplates: CURRENT_CRYPTO_AGENT_TEMPLATES,
    agentConfigs: CURRENT_CRYPTO_AGENT_CONFIGS,
    implementationBindings: implementationBindings(),
  });
  const repository = new SqlitePipelineDraftRepository(database);
  const validator = (graph: typeof CURRENT_CRYPTO_PIPELINE_GRAPH) =>
    validatePipelineGraph(graph, registry.toValidationContext());
  const compiler = new PipelineGraphCompiler(registry, validator);
  const service = new PipelineOrchestrationService(
    repository,
    compiler,
    validator,
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
    authenticator,
    evidenceWorkflow,
    paperPlanService,
    paperRuntimeActivationService,
    paperRuntimeSupervisorService,
    operationalOutboxDispatcher,
    operationalOutboxWorker,
    operationalRetentionService,
    pipelineGraphs: [CURRENT_CRYPTO_PIPELINE_GRAPH],
    ...(options.maxBodyBytes ? { maxBodyBytes: options.maxBodyBytes } : {}),
  });

  return {
    database,
    ownsDatabase,
    registry,
    repository,
    compiler,
    service,
    evidenceRepository,
    evidenceWorkflow,
    paperPlanRepository,
    paperPlanService,
    paperRuntimeRunRepository,
    paperRuntimeOperationsRepository,
    paperRuntimeSupervisorRepository,
    paperRuntimeSupervisorService,
    paperRuntimeActivationService,
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
