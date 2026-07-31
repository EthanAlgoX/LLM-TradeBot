import { createHash } from "node:crypto";

import {
  AgentSemanticAssessmentSchema,
  DecisionSemanticContextSchema,
  MarketObservationArtifactSchema,
  SemanticPipelineExecutionCommandSchema,
  SemanticPipelineExecutionRecordSchema,
  type AgentSemanticAssessment,
  type DecisionSemanticContext,
  type MarketObservationArtifact,
  type SemanticArtifactReference,
  type SemanticPipelineExecutionRecord,
  type SemanticObservationWindowReference,
  type VersionedEntityReference,
} from "../../contracts/src/index.js";
import type { ConfigurationDraftRepository, ConfigurationDraftService } from "./configuration-draft-service.js";
import type { ConfigurableSemanticPipelineService } from "./configurable-semantic-pipeline-service.js";

export interface RegisteredSemanticInputSource {
  readonly dataSourceId: string;
  load(input: {
    marketPackRef: VersionedEntityReference;
    observationWindowRef: SemanticObservationWindowReference;
    sourceCapabilityId: string;
    asOf: string;
  }): Promise<readonly MarketObservationArtifact[]>;
}

export interface RegisteredSemanticAgentAdapter {
  readonly agentTemplateId: string;
  analyze(input: {
    agentConfigRef: VersionedEntityReference;
    observations: readonly MarketObservationArtifact[];
    asOf: string;
  }): Promise<readonly AgentSemanticAssessment[]>;
}

export interface SemanticDecisionSnapshotPort {
  load(input: {
    configurationVersionId: string;
    marketPackRef: VersionedEntityReference;
    asOf: string;
  }): Promise<undefined | {
    decisionAgentConfigRef: VersionedEntityReference;
    portfolioState: {
      asOf: string;
      baseCurrency: string;
      equity: number;
      availableCash: number;
      openPositionRefs: SemanticArtifactReference[];
    };
    riskState: {
      asOf: string;
      riskProfileId: string;
      newEntriesPaused: boolean;
      closeOnly: boolean;
      remainingRiskBudget: number;
      activeFlags: string[];
    };
    dataQuality: {
      status: "pass" | "degraded" | "fail";
      issueCodes: string[];
    };
  }>;
}

export interface SemanticPipelineExecutionRepository {
  findByIdempotency(actorId: string, idempotencyKey: string): SemanticPipelineExecutionRecord | undefined;
  get(executionId: string): SemanticPipelineExecutionRecord;
  save(record: SemanticPipelineExecutionRecord): void;
}

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function semanticFingerprint(value: string): `sha256:${string}` {
  return /^sha256:[a-f0-9]{64}$/u.test(value) ? value as `sha256:${string}` : fingerprint(value);
}

function artifactRef(artifact: { id: string; artifactType: string; fingerprint: string }): SemanticArtifactReference {
  return { artifactId: artifact.id, artifactType: artifact.artifactType, fingerprint: semanticFingerprint(artifact.fingerprint) };
}

export class ConfigurableSemanticPipelineExecutionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export class ConfigurableSemanticPipelineExecutionService {
  constructor(
    private readonly previews: ConfigurableSemanticPipelineService,
    private readonly configurations: ConfigurationDraftService,
    private readonly configurationRepository: ConfigurationDraftRepository,
    private readonly executionRepository: SemanticPipelineExecutionRepository,
    private readonly sources: ReadonlyMap<string, RegisteredSemanticInputSource>,
    private readonly agents: ReadonlyMap<string, RegisteredSemanticAgentAdapter>,
    private readonly snapshots: SemanticDecisionSnapshotPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(rawCommand: unknown, actorId: string): Promise<SemanticPipelineExecutionRecord> {
    const command = SemanticPipelineExecutionCommandSchema.parse(rawCommand);
    const replay = this.executionRepository.findByIdempotency(actorId, command.idempotencyKey);
    if (replay) {
      if (
        replay.configurationRef.id !== command.configurationVersionId ||
        replay.semanticPipelineRef.fingerprint !== command.semanticPipelineFingerprint
      ) {
        throw new ConfigurableSemanticPipelineExecutionError("SEMANTIC_EXECUTION_IDEMPOTENCY_CONFLICT");
      }
      return replay;
    }

    const preview = this.previews.preview({
      schemaVersion: "1.0.0",
      configurationVersionId: command.configurationVersionId,
      idempotencyKey: `execution-preview:${command.idempotencyKey}`,
    }, actorId);
    const createdAt = this.now().toISOString();
    if (preview.fingerprint !== command.semanticPipelineFingerprint) {
      const stale = this.record({
        actorId,
        command,
        preview,
        createdAt,
        lifecycleStatus: "stale",
        observations: [],
        assessments: [],
        issueCodes: ["SEMANTIC_PIPELINE_FINGERPRINT_STALE"],
        nextGate: "configuration_refresh",
      });
      this.executionRepository.save(stale);
      return stale;
    }
    if (!preview.validation.valid) {
      throw new ConfigurableSemanticPipelineExecutionError("SEMANTIC_PIPELINE_CONFIGURATION_INVALID");
    }

    const strategy = this.configurations.get(command.configurationVersionId);
    if (strategy.payload.kind !== "strategy") {
      throw new ConfigurableSemanticPipelineExecutionError("SEMANTIC_PIPELINE_STRATEGY_CONFIGURATION_REQUIRED");
    }
    const marketPackRef: VersionedEntityReference = {
      id: preview.marketPackRef.id,
      version: preview.marketPackRef.humanVersion,
      fingerprint: semanticFingerprint(preview.marketPackRef.fingerprint),
    };
    const observationIndex = new Map<string, MarketObservationArtifact>();
    const assessments: AgentSemanticAssessment[] = [];

    for (const agentDraftId of strategy.payload.agentConfigurationDraftIds) {
      const agent = this.configurationRepository.latest(agentDraftId);
      if (agent.payload.kind !== "agent") {
        throw new ConfigurableSemanticPipelineExecutionError("AGENT_CONFIGURATION_KIND_INVALID");
      }
      const adapter = this.agents.get(agent.payload.agentTemplateId);
      if (!adapter) throw new ConfigurableSemanticPipelineExecutionError("AGENT_ADAPTER_NOT_REGISTERED");
      const agentObservations: MarketObservationArtifact[] = [];
      for (const sourceId of agent.payload.dataSourceIds) {
        const source = this.sources.get(sourceId);
        if (!source) throw new ConfigurableSemanticPipelineExecutionError("SEMANTIC_INPUT_SOURCE_NOT_REGISTERED");
        const sourceProjection = preview.agents
          .find((item) => item.configurationRef.id === agent.versionId)
          ?.dataSourceRefs.find((item) => item.id === sourceId);
        const capabilityId = sourceProjection?.capabilityRefs[0]?.id;
        if (!capabilityId) throw new ConfigurableSemanticPipelineExecutionError("SEMANTIC_INPUT_CAPABILITY_REQUIRED");
        for (const window of agent.payload.observationWindows) {
          const observationWindowRef: SemanticObservationWindowReference = {
            id: `window:${fingerprint(window).slice("sha256:".length, 33)}`,
            version: agent.humanVersion,
            fingerprint: fingerprint(window),
            kind: window.kind,
          };
          const loaded = await source.load({ marketPackRef, observationWindowRef, sourceCapabilityId: capabilityId, asOf: createdAt });
          for (const rawObservation of loaded) {
            const observation = MarketObservationArtifactSchema.parse(rawObservation);
            if (observation.marketPackRef.id !== marketPackRef.id) {
              throw new ConfigurableSemanticPipelineExecutionError("SEMANTIC_INPUT_MARKET_PACK_MISMATCH");
            }
            observationIndex.set(observation.id, observation);
            agentObservations.push(observation);
          }
        }
      }
      if (agentObservations.length === 0) throw new ConfigurableSemanticPipelineExecutionError("SEMANTIC_INPUT_FACTS_UNAVAILABLE");
      const produced = await adapter.analyze({
        agentConfigRef: { id: agent.versionId, version: agent.humanVersion, fingerprint: semanticFingerprint(agent.fingerprint) },
        observations: agentObservations,
        asOf: createdAt,
      });
      for (const rawAssessment of produced) assessments.push(AgentSemanticAssessmentSchema.parse(rawAssessment));
    }
    if (assessments.length < 2) throw new ConfigurableSemanticPipelineExecutionError("SEMANTIC_ANALYSIS_INSUFFICIENT");

    const observations = [...observationIndex.values()];
    const snapshot = await this.snapshots.load({ configurationVersionId: strategy.versionId, marketPackRef, asOf: createdAt });
    let decisionContext: DecisionSemanticContext | undefined;
    if (snapshot) {
      const contextIdentity = {
        strategyFingerprint: strategy.fingerprint,
        observationFingerprints: observations.map((item) => item.fingerprint),
        assessmentFingerprints: assessments.map((item) => item.fingerprint),
        snapshot,
      };
      decisionContext = DecisionSemanticContextSchema.parse({
        schemaVersion: "1.0.0",
        id: `decision-context:configured:${fingerprint(contextIdentity).slice("sha256:".length, 31)}`,
        version: "1.0.0",
        fingerprint: fingerprint(contextIdentity),
        lifecycleStatus: "validated",
        createdAt,
        marketPackRef,
        schemaRef: { schemaId: "tradebot.semantic.decision_semantic_context.v1", schemaVersion: "1.0.0" },
        artifactType: "decision_semantic_context",
        asOf: createdAt,
        decisionAgentConfigRef: snapshot.decisionAgentConfigRef,
        observations,
        assessments,
        approvedLessons: [],
        portfolioState: snapshot.portfolioState,
        riskState: snapshot.riskState,
        dataQuality: {
          ...snapshot.dataQuality,
          checkedArtifactRefs: observations.map(artifactRef),
        },
        lineageFingerprints: [...new Set([
          ...observations.map((item) => item.lineage.fingerprint),
          ...assessments.map((item) => item.lineageFingerprint),
        ])],
      });
    }
    const result = this.record({
      actorId,
      command,
      preview,
      createdAt,
      lifecycleStatus: decisionContext ? "decision_context_ready" : "decision_context_unavailable",
      observations,
      assessments,
      ...(decisionContext ? { decisionContext } : {}),
      issueCodes: decisionContext ? [] : ["DECISION_CONTEXT_SNAPSHOT_UNAVAILABLE"],
      nextGate: decisionContext ? "historical_semantic_evaluation" : "decision_context_snapshot",
    });
    this.executionRepository.save(result);
    return result;
  }

  private record(input: {
    actorId: string;
    command: { configurationVersionId: string; semanticPipelineFingerprint: string; idempotencyKey: string };
    preview: { previewId: string; humanVersion: string; fingerprint: string };
    createdAt: string;
    lifecycleStatus: SemanticPipelineExecutionRecord["lifecycleStatus"];
    observations: MarketObservationArtifact[];
    assessments: AgentSemanticAssessment[];
    decisionContext?: DecisionSemanticContext;
    issueCodes: string[];
    nextGate: SemanticPipelineExecutionRecord["nextGate"];
  }): SemanticPipelineExecutionRecord {
    const identity = {
      actorId: input.actorId,
      configurationVersionId: input.command.configurationVersionId,
      semanticPipelineFingerprint: input.command.semanticPipelineFingerprint,
      idempotencyKey: input.command.idempotencyKey,
      observationFingerprints: input.observations.map((item) => item.fingerprint),
      assessmentFingerprints: input.assessments.map((item) => item.fingerprint),
      decisionContextFingerprint: input.decisionContext?.fingerprint,
      lifecycleStatus: input.lifecycleStatus,
    };
    return SemanticPipelineExecutionRecordSchema.parse({
      schemaVersion: "1.0.0",
      executionId: `semantic-execution:${fingerprint(identity).slice("sha256:".length, 31)}`,
      humanVersion: input.preview.humanVersion,
      fingerprint: fingerprint(identity),
      createdAt: input.createdAt,
      lifecycleStatus: input.lifecycleStatus,
      actorId: input.actorId,
      idempotencyKey: input.command.idempotencyKey,
      configurationRef: {
        id: input.command.configurationVersionId,
        humanVersion: input.preview.humanVersion,
        fingerprint: input.command.semanticPipelineFingerprint,
      },
      semanticPipelineRef: { previewId: input.preview.previewId, fingerprint: input.preview.fingerprint },
      observations: input.observations,
      assessments: input.assessments,
      ...(input.decisionContext ? { decisionContext: input.decisionContext } : {}),
      issueCodes: input.issueCodes,
      nextGate: input.nextGate,
      sourceMode: "server_registered",
      decisionContextApplied: false,
      runtimeApplied: false,
      exchangeWriteAllowed: false,
    });
  }
}
