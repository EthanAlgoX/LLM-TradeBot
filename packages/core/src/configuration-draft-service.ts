import {
  ConfigurationCatalogSnapshotSchema,
  ConfigurationDraftPatchSchema,
  ConfigurationDraftVersionSchema,
  ConfigurationValidationResultSchema,
  CreateConfigurationDraftRequestSchema,
  type ConfigurationCatalogSnapshot,
  type ConfigurationDraftPayload,
  type ConfigurationDraftVersion,
  type ConfigurationValidationIssue,
  type HistoricalGraphExecutionPlan,
} from "../../contracts/src/index.js";
import { graphEvidenceFingerprint } from "./graph-backtest-evidence.js";

export interface ConfigurationDraftRepository {
  save(version: ConfigurationDraftVersion): void;
  get(versionId: string): ConfigurationDraftVersion;
  latest(draftId: string): ConfigurationDraftVersion;
  listVersions(draftId: string): ConfigurationDraftVersion[];
}

export interface ConfigurationDraftCatalog {
  snapshot(): ConfigurationCatalogSnapshot;
}

export interface ConfigurationHistoricalCompilerPort {
  pipelineDraftExists(pipelineDraftId: string): boolean;
  compilePipelineDraft(pipelineDraftId: string): HistoricalGraphExecutionPlan;
}

export class ConfigurationDraftError extends Error {
  constructor(
    readonly code:
      | "CONFIGURATION_DRAFT_NOT_FOUND"
      | "CONFIGURATION_PARENT_CONFLICT"
      | "CONFIGURATION_KIND_CHANGED"
      | "CONFIGURATION_VALIDATION_FAILED"
      | "CONFIGURATION_STRATEGY_REQUIRED",
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(code);
    this.name = "ConfigurationDraftError";
  }
}

function versionFingerprint(input: {
  draftId: string;
  versionIndex: number;
  parentFingerprint?: string;
  humanVersion: string;
  payload: ConfigurationDraftPayload;
  evidenceState: ConfigurationDraftVersion["evidenceState"];
}): string {
  return graphEvidenceFingerprint(input);
}

function issue(
  code: ConfigurationValidationIssue["code"],
  entityType: ConfigurationValidationIssue["entityType"],
  entityId: string,
  path: Array<string | number>,
): ConfigurationValidationIssue {
  return {
    issueId: `configuration-issue:${code.toLowerCase()}:${entityId}`,
    code,
    entityType,
    entityId,
    path,
    details: { reference: entityId },
  };
}

export class ConfigurationDraftService {
  constructor(
    private readonly repository: ConfigurationDraftRepository,
    private readonly catalog: ConfigurationDraftCatalog,
    private readonly compiler: ConfigurationHistoricalCompilerPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getCatalog(): ConfigurationCatalogSnapshot {
    return ConfigurationCatalogSnapshotSchema.parse(this.catalog.snapshot());
  }

  create(rawRequest: unknown, actorId: string): ConfigurationDraftVersion {
    const request = CreateConfigurationDraftRequestSchema.parse(rawRequest);
    const draftId = `configuration-draft:${graphEvidenceFingerprint({ actorId, request, createdAt: this.now().toISOString() }).slice(7, 31)}`;
    const evidenceState = { status: "none" as const, evidenceRefs: [] as string[] };
    const fingerprint = versionFingerprint({
      draftId,
      versionIndex: 1,
      humanVersion: request.humanVersion,
      payload: request.payload,
      evidenceState,
    });
    const version = ConfigurationDraftVersionSchema.parse({
      schemaVersion: "1.0.0",
      draftId,
      versionId: `${draftId}:version:1`,
      versionIndex: 1,
      humanVersion: request.humanVersion,
      fingerprint,
      lifecycleStatus: "draft",
      createdAt: this.now().toISOString(),
      createdByActorId: actorId,
      payload: request.payload,
      evidenceState,
      runtimeApplied: false,
    });
    this.repository.save(version);
    return version;
  }

  createVersion(draftId: string, rawPatch: unknown, actorId: string): ConfigurationDraftVersion {
    const patch = ConfigurationDraftPatchSchema.parse(rawPatch);
    const parent = this.repository.latest(draftId);
    if (parent.fingerprint !== patch.parentFingerprint) {
      throw new ConfigurationDraftError("CONFIGURATION_PARENT_CONFLICT", {
        draftId,
        expectedFingerprint: parent.fingerprint,
        suppliedFingerprint: patch.parentFingerprint,
      });
    }
    if (parent.payload.kind !== patch.payload.kind) {
      throw new ConfigurationDraftError("CONFIGURATION_KIND_CHANGED", {
        draftId,
        parentKind: parent.payload.kind,
        patchKind: patch.payload.kind,
      });
    }
    const payloadChanged = graphEvidenceFingerprint(parent.payload) !== graphEvidenceFingerprint(patch.payload);
    const evidenceState = parent.evidenceState.evidenceRefs.length === 0
      ? { status: "none" as const, evidenceRefs: [] as string[] }
      : payloadChanged
        ? { status: "stale" as const, evidenceRefs: parent.evidenceState.evidenceRefs, staleReason: "configuration_changed" as const }
        : { status: "current" as const, evidenceRefs: parent.evidenceState.evidenceRefs };
    const versionIndex = parent.versionIndex + 1;
    const fingerprint = versionFingerprint({
      draftId,
      versionIndex,
      parentFingerprint: parent.fingerprint,
      humanVersion: patch.humanVersion,
      payload: patch.payload,
      evidenceState,
    });
    const version = ConfigurationDraftVersionSchema.parse({
      schemaVersion: "1.0.0",
      draftId,
      versionId: `${draftId}:version:${versionIndex}`,
      versionIndex,
      parentVersionId: parent.versionId,
      parentFingerprint: parent.fingerprint,
      humanVersion: patch.humanVersion,
      fingerprint,
      lifecycleStatus: "draft",
      createdAt: this.now().toISOString(),
      createdByActorId: actorId,
      payload: patch.payload,
      evidenceState,
      runtimeApplied: false,
    });
    this.repository.save(version);
    return version;
  }

  recordEvidence(versionId: string, evidenceRef: string, actorId: string): ConfigurationDraftVersion {
    const current = this.repository.get(versionId);
    const versionIndex = current.versionIndex + 1;
    const evidenceState = {
      status: "current" as const,
      evidenceRefs: [...new Set([...current.evidenceState.evidenceRefs, evidenceRef])],
    };
    const fingerprint = versionFingerprint({
      draftId: current.draftId,
      versionIndex,
      parentFingerprint: current.fingerprint,
      humanVersion: current.humanVersion,
      payload: current.payload,
      evidenceState,
    });
    const version = ConfigurationDraftVersionSchema.parse({
      ...current,
      versionId: `${current.draftId}:version:${versionIndex}`,
      versionIndex,
      parentVersionId: current.versionId,
      parentFingerprint: current.fingerprint,
      fingerprint,
      lifecycleStatus: "validated",
      createdAt: this.now().toISOString(),
      createdByActorId: actorId,
      evidenceState,
    });
    this.repository.save(version);
    return version;
  }

  get(versionId: string): ConfigurationDraftVersion {
    return this.repository.get(versionId);
  }

  getLatest(draftId: string): ConfigurationDraftVersion {
    return this.repository.latest(draftId);
  }

  validate(versionId: string) {
    const version = this.repository.get(versionId);
    const catalog = this.getCatalog();
    const issues: ConfigurationValidationIssue[] = [];
    const payload = version.payload;
    const marketPackId = "marketPackId" in payload ? payload.marketPackId : undefined;
    if (marketPackId && !catalog.marketPackIds.includes(marketPackId)) {
      issues.push(issue("MARKET_PACK_NOT_REGISTERED", "market_pack", marketPackId, ["payload", "marketPackId"]));
    }
    const dataSourceIds = "dataSourceIds" in payload ? payload.dataSourceIds : [];
    for (const [index, dataSourceId] of dataSourceIds.entries()) {
      if (!catalog.dataSourceIds.includes(dataSourceId)) {
        issues.push(issue("DATA_SOURCE_NOT_REGISTERED", "data_source", dataSourceId, ["payload", "dataSourceIds", index]));
      }
    }
    if ("agentTemplateId" in payload && !catalog.agentTemplateIds.includes(payload.agentTemplateId)) {
      issues.push(issue("AGENT_TEMPLATE_NOT_REGISTERED", "agent_template", payload.agentTemplateId, ["payload", "agentTemplateId"]));
    }
    if (payload.kind === "prompt_policy") {
      for (const [index, toolId] of payload.allowedToolIds.entries()) {
        if (!catalog.allowedToolIds.includes(toolId)) {
          issues.push(issue("AGENT_TEMPLATE_NOT_REGISTERED", "agent_template", toolId, ["payload", "allowedToolIds", index]));
        }
      }
    }
    if (payload.kind === "strategy" && !this.compiler.pipelineDraftExists(payload.pipelineDraftId)) {
      issues.push(issue("PIPELINE_DRAFT_NOT_FOUND", "pipeline", payload.pipelineDraftId, ["payload", "pipelineDraftId"]));
    }
    return ConfigurationValidationResultSchema.parse({
      valid: issues.length === 0,
      issues,
      checkedFingerprint: version.fingerprint,
    });
  }

  compileHistorical(versionId: string): HistoricalGraphExecutionPlan {
    const version = this.repository.get(versionId);
    if (version.payload.kind !== "strategy") {
      throw new ConfigurationDraftError("CONFIGURATION_STRATEGY_REQUIRED", {
        versionId,
        kind: version.payload.kind,
      });
    }
    const validation = this.validate(versionId);
    if (!validation.valid) {
      throw new ConfigurationDraftError("CONFIGURATION_VALIDATION_FAILED", {
        versionId,
        issueCodes: validation.issues.map((item) => item.code).join(","),
      });
    }
    return this.compiler.compilePipelineDraft(version.payload.pipelineDraftId);
  }
}
