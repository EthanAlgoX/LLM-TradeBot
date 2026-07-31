import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  AgentSemanticAssessmentSchema,
  MarketObservationArtifactSchema,
  type MarketObservationArtifact,
} from "../../contracts/src/index.js";
import {
  ConfigurableSemanticPipelineExecutionService,
  type RegisteredSemanticAgentAdapter,
  type RegisteredSemanticInputSource,
  type SemanticDecisionSnapshotPort,
} from "../../core/src/configurable-semantic-pipeline-execution-service.js";
import type { ConfigurationDraftRepository, ConfigurationDraftService } from "../../core/src/configuration-draft-service.js";
import type { ConfigurableSemanticPipelineService } from "../../core/src/configurable-semantic-pipeline-service.js";
import { SqliteSemanticPipelineExecutionRepository } from "./sqlite-semantic-pipeline-executions.js";

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function ref(artifact: MarketObservationArtifact) {
  return { artifactId: artifact.id, artifactType: artifact.artifactType, fingerprint: artifact.fingerprint };
}

function fixtureSource(dataSourceId: string): RegisteredSemanticInputSource {
  return {
    dataSourceId,
    load: async ({ marketPackRef, observationWindowRef, sourceCapabilityId, asOf }) => {
      const identity = { dataSourceId, marketPackRef, observationWindowRef, sourceCapabilityId, asOf };
      const suffix = fingerprint(identity).slice("sha256:".length, 31);
      const common = {
        schemaVersion: "1.0.0",
        id: `observation:registered:${suffix}`,
        version: "1.0.0",
        fingerprint: fingerprint(identity),
        lifecycleStatus: "validated",
        createdAt: asOf,
        marketPackRef,
        schemaRef: { schemaId: "tradebot.semantic.market_observation.v1", schemaVersion: "1.0.0" },
        artifactType: "market_observation",
        asOf,
        availableAt: asOf,
        observationWindowRef,
        lineage: {
          lineageId: `lineage:registered:${suffix}`,
          fingerprint: fingerprint({ identity, lineage: true }),
          sourceDefinitionId: dataSourceId,
          sourceCapabilityId,
          transformationVersion: "1.0.0",
          timezone: "UTC",
          tradingCalendarRef: "calendar.registered",
        },
      } as const;
      const before = new Date(Date.parse(asOf) - 300_000).toISOString();
      const payload = observationWindowRef.kind === "bar_interval"
        ? { kind: "bar_interval" as const, symbol: "REGISTERED_INPUT", bars: [{ openedAt: before, closedAt: asOf, availableAt: asOf, open: 100, high: 102, low: 99, close: 101, volume: 1000 }] }
        : observationWindowRef.kind === "rolling_window"
          ? { kind: "rolling_window" as const, subject: "registered-input", samples: [{ observedAt: before, availableAt: asOf, values: { value: 1 } }] }
          : observationWindowRef.kind === "event_batch"
            ? { kind: "event_batch" as const, topic: "registered-input", events: [{ eventId: `event:${suffix}`, eventType: "registered_fact", occurredAt: before, availableAt: asOf, headline: "Registered semantic fact", content: "Bounded local fixture fact for semantic pipeline validation.", attributes: {} }] }
            : { kind: "reporting_period" as const, subject: "registered-input", periodStartedAt: before, periodEndedAt: asOf, publishedAt: asOf, metrics: { value: 1 } };
      return [MarketObservationArtifactSchema.parse({ ...common, payload })];
    },
  };
}

function fixtureAgent(agentTemplateId: string): RegisteredSemanticAgentAdapter {
  return {
    agentTemplateId,
    analyze: async ({ agentConfigRef, observations, asOf }) => observations.map((observation, index) => {
      const identity = { agentTemplateId, agentConfigRef, observation: observation.fingerprint, index };
      const suffix = fingerprint(identity).slice("sha256:".length, 31);
      const assessmentKind = agentTemplateId.includes("bull")
        ? "bull_case"
        : agentTemplateId.includes("bear")
          ? "bear_case"
          : agentTemplateId.includes("research") || agentTemplateId.includes("context")
            ? "research_synthesis"
            : "window_analysis";
      return AgentSemanticAssessmentSchema.parse({
        schemaVersion: "1.0.0",
        id: `assessment:registered:${suffix}`,
        version: "1.0.0",
        fingerprint: fingerprint(identity),
        lifecycleStatus: "validated",
        createdAt: asOf,
        marketPackRef: observation.marketPackRef,
        schemaRef: { schemaId: "tradebot.semantic.agent_semantic_assessment.v1", schemaVersion: "1.0.0" },
        artifactType: "agent_semantic_assessment",
        assessmentKind,
        agentConfigRef,
        ...(assessmentKind === "window_analysis" ? { observationWindowRef: observation.observationWindowRef } : {}),
        direction: agentTemplateId.includes("bull") ? "bullish" : agentTemplateId.includes("bear") ? "bearish" : "neutral",
        confidence: 0.6,
        regime: "registered-fixture",
        semanticThesis: `Server-registered ${agentTemplateId} analyzed a bounded semantic observation.`,
        supportingEvidence: [{
          evidenceId: `evidence:registered:${suffix}`,
          sourceArtifactRef: ref(observation),
          evidenceType: observation.payload.kind === "event_batch" ? "event" : "price_structure",
          locator: "registered-semantic-input",
          summary: "Assessment is derived only from the registered observation artifact.",
        }],
        invalidationConditions: ["The registered source artifact or lineage fingerprint changes."],
        riskFlags: [],
        sourceArtifactRefs: [ref(observation)],
        lineageFingerprint: observation.lineage.fingerprint,
      });
    }),
  };
}

export function createRegisteredConfigurableSemanticPipelineExecution(input: {
  database: DatabaseSync;
  configurations: ConfigurationDraftService;
  configurationRepository: ConfigurationDraftRepository;
  previews: ConfigurableSemanticPipelineService;
  registry: {
    dataSources: ReadonlyMap<string, unknown>;
    agentTemplates: ReadonlyMap<string, unknown>;
  };
  snapshots?: SemanticDecisionSnapshotPort;
  now?: () => Date;
}) {
  const repository = new SqliteSemanticPipelineExecutionRepository(input.database);
  const sources = new Map([...input.registry.dataSources.keys()].map((id) => [id, fixtureSource(id)]));
  const agents = new Map([...input.registry.agentTemplates.keys()]
    .filter((id) => /analysis|research|context|decompos|bull|bear/iu.test(id))
    .map((id) => [id, fixtureAgent(id)]));
  const snapshots = input.snapshots ?? { load: async () => undefined };
  const service = new ConfigurableSemanticPipelineExecutionService(
    input.previews,
    input.configurations,
    input.configurationRepository,
    repository,
    sources,
    agents,
    snapshots,
    input.now,
  );
  return { repository, service, sources, agents };
}
