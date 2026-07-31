import type { DatabaseSync } from "node:sqlite";

import type {
  GraphHistoricalDatasetDefinition,
  GraphStrategyProfileCandidateSet,
  GraphStrategyProfileDefinition,
  GraphWalkForwardPlanDefinition,
  HistoricalGraphExecutionPlan,
  PipelineGraphVersion,
} from "../../contracts/src/index.js";
import {
  ConfigurationDraftService,
  ConfigurableSemanticPipelineService,
  HistoricalSemanticEvaluationService,
  ExecutableStrategyConfigurationService,
  GraphBacktestRunner,
  GraphWalkForwardRunner,
  RegisteredGraphHistoricalDatasetRegistry,
  RegisteredGraphStrategyProfileRegistry,
  RegisteredGraphWalkForwardPlanRegistry,
  StrategyEvidenceApprovalService,
  type GraphBacktestSessionFactory,
  type ExecutableStrategyParameterPolicy,
  type StrategyApprovedPaperPlanPolicy,
} from "../../core/src/index.js";
import type {
  CompiledPipelinePlan,
  ImmutablePipelineRegistry,
  PipelineOrchestrationService,
} from "../../core/src/pipeline-orchestration.js";
import type { PipelineOrchestrationAuthenticator } from "./pipeline-orchestration-auth.js";
import { ConfigurationDraftHttpHandler } from "./configuration-draft-http.js";
import { RegisteredStrategyGraphEvidenceJobPort } from "./registered-strategy-graph-evidence-job-port.js";
import { createRegisteredConfigurableSemanticPipelineExecution } from "./registered-configurable-semantic-pipeline-execution.js";
import { SqliteApprovedPaperPlanRepository } from "./sqlite-approved-paper-plan-repository.js";
import { SqliteConfigurationDraftRepository } from "./sqlite-configuration-draft-repository.js";
import { SqliteExecutableStrategyConfigurationRepository } from "./sqlite-executable-strategy-configurations.js";
import {
  DurableGraphEvidenceJobService,
  SqliteGraphEvidenceJobRepository,
} from "./sqlite-graph-evidence-jobs.js";
import { SqliteStrategyEvidenceBindingRepository } from "./sqlite-strategy-evidence-bindings.js";
import { StrategyEvidenceHttpHandler } from "./strategy-evidence-http.js";
import { HistoricalSemanticEvaluationHttpHandler } from "./historical-semantic-evaluation-http.js";

export interface ProductionHistoricalGraphCompiler {
  compile(
    graph: PipelineGraphVersion,
    compiled: CompiledPipelinePlan,
  ): HistoricalGraphExecutionPlan;
}

export interface ProductionGraphEvidenceOptions {
  datasets: readonly GraphHistoricalDatasetDefinition[];
  profiles: readonly GraphStrategyProfileDefinition[];
  profileCandidateSets: readonly GraphStrategyProfileCandidateSet[];
  walkForwardPlans: readonly GraphWalkForwardPlanDefinition[];
  sessionFactory: GraphBacktestSessionFactory;
  approvedPaperPlanPolicy: StrategyApprovedPaperPlanPolicy;
  executableStrategy?: {
    baseProfileId: string;
    policy?: ExecutableStrategyParameterPolicy;
  };
}

export interface ProductionStrategyOrchestrationOptions {
  historicalGraphCompiler?: ProductionHistoricalGraphCompiler;
  graphEvidence?: ProductionGraphEvidenceOptions;
  allowedToolIds?: readonly string[];
  now?: () => Date;
}

export interface ProductionStrategyWorkspaceCatalog {
  schemaVersion: "1.0.0";
  configurationDrafts: {
    configured: true;
    historicalCompilerConfigured: boolean;
    allowedToolIds: readonly string[];
  };
  strategyEvidence: {
    configured: boolean;
    datasets: readonly {
      id: string;
      version: string;
      fingerprint: string;
      startAt?: string;
      endAt?: string;
    }[];
    profiles: readonly {
      id: string;
      version: string;
      fingerprint: string;
    }[];
    profileCandidateSets: readonly {
      id: string;
      version: string;
      fingerprint: string;
    }[];
    walkForwardPlans: readonly {
      id: string;
      version: string;
      fingerprint: string;
    }[];
  };
  runtimeApplied: false;
}

export interface ProductionStrategyOrchestration {
  configurationDraftRepository: SqliteConfigurationDraftRepository;
  configurationDraftService: ConfigurationDraftService;
  configurableSemanticPipelineService: ConfigurableSemanticPipelineService;
  configurableSemanticPipelineExecutionService: import("../../core/src/index.js").ConfigurableSemanticPipelineExecutionService;
  configurationDraftHttpHandler: ConfigurationDraftHttpHandler;
  executableStrategyConfigurationRepository?: SqliteExecutableStrategyConfigurationRepository;
  executableStrategyConfigurationService?: ExecutableStrategyConfigurationService;
  graphEvidenceJobRepository?: SqliteGraphEvidenceJobRepository;
  graphEvidenceJobService?: DurableGraphEvidenceJobService;
  strategyEvidenceBindingRepository?: SqliteStrategyEvidenceBindingRepository;
  strategyEvidenceApprovalService?: StrategyEvidenceApprovalService;
  strategyEvidenceHttpHandler?: StrategyEvidenceHttpHandler;
  historicalSemanticEvaluationService?: HistoricalSemanticEvaluationService;
  historicalSemanticEvaluationHttpHandler?: HistoricalSemanticEvaluationHttpHandler;
  lessonEvidenceScopes: readonly {
    datasetId: string;
    backtestProfileId: string;
    walkForwardCandidateSetId: string;
    walkForwardPlanId: string;
    startAt: string;
    endAt: string;
  }[];
  workspaceCatalog: ProductionStrategyWorkspaceCatalog;
}

export interface ProductionStrategyOrchestrationDependencies {
  database: DatabaseSync;
  registry: ImmutablePipelineRegistry;
  pipelineService: PipelineOrchestrationService;
  authenticator: PipelineOrchestrationAuthenticator;
  paperPlanRepository: SqliteApprovedPaperPlanRepository;
}

function definitionRef(definition: {
  id: string;
  version: string;
  fingerprint: string;
}) {
  return {
    id: definition.id,
    version: definition.version,
    fingerprint: definition.fingerprint,
  };
}

export function createProductionStrategyOrchestration(
  dependencies: ProductionStrategyOrchestrationDependencies,
  options: ProductionStrategyOrchestrationOptions = {},
): ProductionStrategyOrchestration {
  const now = options.now ?? (() => new Date());
  const allowedToolIds = options.allowedToolIds ?? ["tool:market-data:read"];
  const historicalPlans = new Map<string, HistoricalGraphExecutionPlan>();
  const configurationDraftRepository = new SqliteConfigurationDraftRepository(
    dependencies.database,
  );
  const configurationDraftService = new ConfigurationDraftService(
    configurationDraftRepository,
    {
      snapshot: () => ({
        marketPackIds: [...dependencies.registry.marketPacks.keys()],
        dataSourceIds: [...dependencies.registry.dataSources.keys()],
        agentTemplateIds: [...dependencies.registry.agentTemplates.keys()],
        allowedToolIds: [...allowedToolIds],
      }),
    },
    {
      pipelineDraftExists: (pipelineDraftId) => {
        try {
          dependencies.pipelineService.getDraft(pipelineDraftId);
          return true;
        } catch {
          return false;
        }
      },
      compilePipelineDraft: (pipelineDraftId) => {
        if (!options.historicalGraphCompiler) {
          throw new Error("HISTORICAL_GRAPH_COMPILER_NOT_CONFIGURED");
        }
        const draft = dependencies.pipelineService.getDraft(pipelineDraftId);
        const plan = options.historicalGraphCompiler.compile(
          draft.graph,
          dependencies.pipelineService.compileDraft(pipelineDraftId),
        );
        historicalPlans.set(plan.planId, plan);
        return plan;
      },
    },
    now,
  );
  const configurableSemanticPipelineService =
    new ConfigurableSemanticPipelineService(
      configurationDraftService,
      configurationDraftRepository,
      dependencies.registry,
      now,
    );
  const configurableSemanticPipelineExecution =
    createRegisteredConfigurableSemanticPipelineExecution({
      database: dependencies.database,
      configurations: configurationDraftService,
      configurationRepository: configurationDraftRepository,
      previews: configurableSemanticPipelineService,
      registry: dependencies.registry,
      now,
    });
  const graphEvidence = options.graphEvidence;
  const lessonEvidenceScopes = graphEvidence
    ? graphEvidence.datasets.flatMap((dataset) => {
        const startAt = dataset.asOfSequence[0];
        const endAt = dataset.asOfSequence.at(-1);
        if (!startAt || !endAt) return [];
        return graphEvidence.profiles.flatMap((profile) =>
          graphEvidence.profileCandidateSets
            .filter((candidateSet) => candidateSet.profileIds.includes(profile.id))
            .flatMap((candidateSet) =>
              graphEvidence.walkForwardPlans.map((plan) => ({
                datasetId: dataset.id,
                backtestProfileId: profile.id,
                walkForwardCandidateSetId: candidateSet.id,
                walkForwardPlanId: plan.id,
                startAt,
                endAt,
              })),
            ),
        );
      })
    : [];
  const workspaceCatalog: ProductionStrategyWorkspaceCatalog = {
    schemaVersion: "1.0.0",
    configurationDrafts: {
      configured: true,
      historicalCompilerConfigured: Boolean(options.historicalGraphCompiler),
      allowedToolIds: [...allowedToolIds],
    },
    strategyEvidence: {
      configured: Boolean(graphEvidence),
      datasets:
        graphEvidence?.datasets.map((definition) => ({
          ...definitionRef(definition),
          ...(definition.asOfSequence[0]
            ? { startAt: definition.asOfSequence[0] }
            : {}),
          ...(definition.asOfSequence.at(-1)
            ? { endAt: definition.asOfSequence.at(-1) }
            : {}),
        })) ?? [],
      profiles: graphEvidence?.profiles.map(definitionRef) ?? [],
      profileCandidateSets:
        graphEvidence?.profileCandidateSets.map(definitionRef) ?? [],
      walkForwardPlans:
        graphEvidence?.walkForwardPlans.map(definitionRef) ?? [],
    },
    runtimeApplied: false,
  };

  if (!graphEvidence) {
    const configurationDraftHttpHandler = new ConfigurationDraftHttpHandler(
      configurationDraftService,
      dependencies.authenticator,
      undefined,
      configurableSemanticPipelineService,
      configurableSemanticPipelineExecution.service,
    );
    return {
      configurationDraftRepository,
      configurationDraftService,
      configurableSemanticPipelineService,
      configurableSemanticPipelineExecutionService: configurableSemanticPipelineExecution.service,
      configurationDraftHttpHandler,
      lessonEvidenceScopes,
      workspaceCatalog,
    };
  }

  const datasets = new RegisteredGraphHistoricalDatasetRegistry(
    graphEvidence.datasets,
  );
  const profiles = new RegisteredGraphStrategyProfileRegistry(
    graphEvidence.profiles,
    graphEvidence.profileCandidateSets,
  );
  const executableStrategyConfigurationRepository =
    graphEvidence.executableStrategy
      ? new SqliteExecutableStrategyConfigurationRepository(
          dependencies.database,
        )
      : undefined;
  const executableStrategyConfigurationService =
    graphEvidence.executableStrategy &&
    executableStrategyConfigurationRepository
      ? new ExecutableStrategyConfigurationService(
          configurationDraftService,
          executableStrategyConfigurationRepository,
          {
            require: (templateId) => {
              const template =
                dependencies.registry.agentTemplates.get(templateId);
              if (!template) {
                throw new Error(
                  `AGENT_TEMPLATE_NOT_REGISTERED:${templateId}`,
                );
              }
              return template;
            },
          },
          profiles,
          graphEvidence.executableStrategy.baseProfileId,
          {
            policy: graphEvidence.executableStrategy.policy,
            now,
          },
        )
      : undefined;
  const configurationDraftHttpHandler = new ConfigurationDraftHttpHandler(
    configurationDraftService,
    dependencies.authenticator,
    executableStrategyConfigurationService,
    configurableSemanticPipelineService,
    configurableSemanticPipelineExecution.service,
  );
  const walkForwardPlans = new RegisteredGraphWalkForwardPlanRegistry(
    graphEvidence.walkForwardPlans,
  );
  const backtests = new GraphBacktestRunner(
    datasets,
    profiles,
    graphEvidence.sessionFactory,
    now,
  );
  const walkForwards = new GraphWalkForwardRunner(
    datasets,
    profiles,
    walkForwardPlans,
    backtests,
    (planId) => {
      const plan = historicalPlans.get(planId);
      if (!plan) {
        throw new Error(`HISTORICAL_GRAPH_PLAN_NOT_COMPILED:${planId}`);
      }
      return plan;
    },
    now,
  );
  const graphEvidenceJobRepository = new SqliteGraphEvidenceJobRepository(
    dependencies.database,
  );
  const graphEvidenceJobService = new DurableGraphEvidenceJobService(
    graphEvidenceJobRepository,
    backtests,
    walkForwards,
    {
      backtest: (profileId) => profiles.require(profileId),
      walkForward: (candidateSetId) =>
        profiles.requireCandidateSet(candidateSetId),
    },
    now,
  );
  const graphEvidenceJobs = new RegisteredStrategyGraphEvidenceJobPort(
    graphEvidenceJobService,
    graphEvidenceJobRepository,
  );
  const strategyEvidenceBindingRepository =
    new SqliteStrategyEvidenceBindingRepository(dependencies.database);
  const strategyEvidenceApprovalService =
    new StrategyEvidenceApprovalService(
      configurationDraftService,
      strategyEvidenceBindingRepository,
      graphEvidenceJobs,
      datasets,
      profiles,
      walkForwardPlans,
      dependencies.paperPlanRepository,
      graphEvidence.approvedPaperPlanPolicy,
      {
        now,
        executableStrategyScope:
          executableStrategyConfigurationService,
      },
    );
  const strategyEvidenceHttpHandler = new StrategyEvidenceHttpHandler(
    strategyEvidenceApprovalService,
    dependencies.authenticator,
  );
  const primaryDataset = graphEvidence.datasets[0];
  const primaryProfile = graphEvidence.profiles[0];
  const primaryCandidateSet = graphEvidence.profileCandidateSets[0];
  const primaryWalkForwardPlan = graphEvidence.walkForwardPlans[0];
  const historicalSemanticEvaluationService =
    primaryDataset && primaryProfile && primaryCandidateSet && primaryWalkForwardPlan
      ? new HistoricalSemanticEvaluationService(
          configurableSemanticPipelineExecution.repository,
          {
            verify: (execution) => {
              const current = configurableSemanticPipelineService.preview({
                schemaVersion: "1.0.0",
                configurationVersionId: execution.configurationRef.id,
                idempotencyKey: `historical-verify:${execution.executionId}`,
              }, "actor.system");
              if (current.fingerprint !== execution.semanticPipelineRef.fingerprint) {
                return ["SEMANTIC_PIPELINE_OR_AGENT_ADAPTER_STALE"];
              }
              return [];
            },
          },
          {
            resolve: () => ({
              datasetId: primaryDataset.id,
              dataSourceId: primaryDataset.dataSourceRef.id,
              backtestProfileId: primaryProfile.id,
              walkForwardCandidateSetId: primaryCandidateSet.id,
              walkForwardPlanId: primaryWalkForwardPlan.id,
              startAt: primaryDataset.asOfSequence[0]!,
              endAt: primaryDataset.asOfSequence.at(-1)!,
            }),
          },
          {
            findByConfigurationVersionId: (configurationVersionId) =>
              strategyEvidenceBindingRepository.findLatestByConfigurationVersionId(
                configurationVersionId,
              ),
            createBinding: (request, actor) =>
              strategyEvidenceApprovalService.createBinding(request, actor),
            runBacktest: (bindingId, request, actor) =>
              strategyEvidenceApprovalService.runBacktest(bindingId, request, actor),
            runWalkForward: (bindingId, request, actor) =>
              strategyEvidenceApprovalService.runWalkForward(bindingId, request, actor),
            approve: (bindingId, request, actor) =>
              strategyEvidenceApprovalService.approve(bindingId, request, actor),
            get: (bindingId) => strategyEvidenceApprovalService.get(bindingId),
          },
          now,
        )
      : undefined;
  const historicalSemanticEvaluationHttpHandler = historicalSemanticEvaluationService
    ? new HistoricalSemanticEvaluationHttpHandler(
        historicalSemanticEvaluationService,
        dependencies.authenticator,
      )
    : undefined;

  return {
    configurationDraftRepository,
    configurationDraftService,
    configurableSemanticPipelineService,
    configurableSemanticPipelineExecutionService: configurableSemanticPipelineExecution.service,
    configurationDraftHttpHandler,
    executableStrategyConfigurationRepository,
    executableStrategyConfigurationService,
    graphEvidenceJobRepository,
    graphEvidenceJobService,
    strategyEvidenceBindingRepository,
    strategyEvidenceApprovalService,
    strategyEvidenceHttpHandler,
    ...(historicalSemanticEvaluationService
      ? { historicalSemanticEvaluationService }
      : {}),
    ...(historicalSemanticEvaluationHttpHandler
      ? { historicalSemanticEvaluationHttpHandler }
      : {}),
    lessonEvidenceScopes,
    workspaceCatalog,
  };
}
