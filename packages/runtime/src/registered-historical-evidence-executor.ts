import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  HistoricalEvidenceArtifactManifestSchema,
  HistoricalEvidenceRunPlanSchema,
  HistoricalEvidenceRunnerResultSchema,
  type HistoricalArtifactLineage,
  type HistoricalEvidenceArtifactManifest,
  type HistoricalEvidenceRunPlan,
  type HistoricalEvidenceRunnerResult,
  type PipelineEvidenceJobKind,
} from "../../contracts/src/index.js";
import {
  PipelineEvidenceWorkflowError,
  type PipelineEvidenceExecutionOutput,
  type PipelineEvidenceExecutor,
} from "../../core/src/pipeline-evidence-workflow.js";

type RunParameterValue = string | number | boolean | null;

export interface RegisteredHistoricalEvidenceRunner {
  runnerId: string;
  kind: PipelineEvidenceJobKind;
  allowedParameterKeys: readonly string[];
  strategyProfileRef: string;
  dataSourceRef: string;
  dataFingerprint: string;
  timezone: string;
  tradingCalendarRef: string;
  costModel: {
    feeBps: number;
    slippageBps: number;
  };
  requestedAsOf(): string;
  run(plan: HistoricalEvidenceRunPlan): Promise<HistoricalEvidenceRunnerResult>;
}

export class HistoricalEvidenceRunnerRegistry {
  private readonly runners = new Map<
    PipelineEvidenceJobKind,
    RegisteredHistoricalEvidenceRunner
  >();

  constructor(runners: readonly RegisteredHistoricalEvidenceRunner[]) {
    for (const runner of runners) {
      if (this.runners.has(runner.kind)) {
        throw new PipelineEvidenceWorkflowError(
          "EVIDENCE_RECORD_CONFLICT",
          "Only one registered runner is allowed for each evidence job kind.",
          { kind: runner.kind },
        );
      }
      this.runners.set(runner.kind, Object.freeze({ ...runner }));
    }
  }

  get(kind: PipelineEvidenceJobKind): RegisteredHistoricalEvidenceRunner {
    const runner = this.runners.get(kind);
    if (!runner) {
      throw new PipelineEvidenceWorkflowError(
        "RUNNER_NOT_REGISTERED",
        "No backend runner is registered for this evidence job kind.",
        { kind },
      );
    }
    return runner;
  }
}

function stableJson(value: unknown): string {
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function unsignedManifest(
  manifest: HistoricalEvidenceArtifactManifest,
): Omit<
  HistoricalEvidenceArtifactManifest,
  "artifactRef" | "manifestSha256"
> {
  const {
    artifactRef: _artifactRef,
    manifestSha256: _manifestSha256,
    ...unsigned
  } = manifest;
  return unsigned;
}

export class HistoricalEvidenceArtifactStore {
  readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = resolve(rootDirectory);
    mkdirSync(this.rootDirectory, { recursive: true });
  }

  write(
    plan: HistoricalEvidenceRunPlan,
    rawResult: HistoricalEvidenceRunnerResult,
  ): {
    manifest: HistoricalEvidenceArtifactManifest;
    lineage: HistoricalArtifactLineage;
  } {
    const parsedPlan = HistoricalEvidenceRunPlanSchema.parse(plan);
    const result = HistoricalEvidenceRunnerResultSchema.parse(rawResult);
    const artifactUuid = randomUUID();
    const artifactId = `historical-artifact:${artifactUuid}`;
    const resultContent = stableJson(result);
    const resultSha256 = sha256(resultContent);
    const createdAt = new Date().toISOString();
    const unsigned = {
      schemaVersion: "1.0.0" as const,
      artifactId,
      jobId: parsedPlan.jobId,
      draftId: parsedPlan.draftId,
      graphFingerprint: parsedPlan.graphFingerprint,
      kind: parsedPlan.kind,
      runPlan: parsedPlan,
      resultSha256,
      createdAt,
    };
    const manifestSha256 = sha256(stableJson(unsigned));
    const artifactRef = `tradebot-artifact:${artifactUuid}:${manifestSha256}`;
    const manifest = HistoricalEvidenceArtifactManifestSchema.parse({
      ...unsigned,
      artifactRef,
      manifestSha256,
    });
    const artifactDirectory = join(this.rootDirectory, artifactUuid);
    mkdirSync(artifactDirectory, { recursive: false });
    writeFileSync(join(artifactDirectory, "result.json"), resultContent, {
      encoding: "utf8",
      flag: "wx",
    });
    writeFileSync(
      join(artifactDirectory, "manifest.json"),
      stableJson(manifest),
      {
        encoding: "utf8",
        flag: "wx",
      },
    );
    return {
      manifest,
      lineage: {
        artifactId,
        runnerId: parsedPlan.runnerId,
        runPlanId: parsedPlan.runPlanId,
        strategyProfileRef: parsedPlan.strategyProfileRef,
        dataSourceRef: parsedPlan.dataSourceRef,
        dataFingerprint: parsedPlan.dataFingerprint,
        manifestSha256,
        resultSha256,
      },
    };
  }

  verify(artifactId: string): HistoricalEvidenceArtifactManifest {
    const artifactUuid = artifactId.replace(/^historical-artifact:/, "");
    if (!/^[a-f0-9-]{36}$/.test(artifactUuid)) {
      throw new PipelineEvidenceWorkflowError(
        "ARTIFACT_INTEGRITY_FAILED",
        "Artifact ID is invalid.",
        { artifactId },
      );
    }
    try {
      const artifactDirectory = join(this.rootDirectory, artifactUuid);
      const manifest = HistoricalEvidenceArtifactManifestSchema.parse(
        JSON.parse(
          readFileSync(join(artifactDirectory, "manifest.json"), "utf8"),
        ),
      );
      const resultContent = readFileSync(
        join(artifactDirectory, "result.json"),
        "utf8",
      );
      if (
        sha256(stableJson(unsignedManifest(manifest))) !==
          manifest.manifestSha256 ||
        sha256(resultContent) !== manifest.resultSha256
      ) {
        throw new Error("hash mismatch");
      }
      return manifest;
    } catch {
      throw new PipelineEvidenceWorkflowError(
        "ARTIFACT_INTEGRITY_FAILED",
        "Historical evidence artifact failed integrity verification.",
        { artifactId },
      );
    }
  }
}

interface ArtifactLedgerRow {
  manifest_json: string;
}

export class SqliteHistoricalArtifactLedger {
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS historical_evidence_artifacts (
        artifact_id TEXT PRIMARY KEY,
        artifact_ref TEXT NOT NULL UNIQUE,
        job_id TEXT NOT NULL UNIQUE,
        draft_id TEXT NOT NULL,
        graph_fingerprint TEXT NOT NULL,
        kind TEXT NOT NULL,
        runner_id TEXT NOT NULL,
        data_fingerprint TEXT NOT NULL,
        manifest_sha256 TEXT NOT NULL,
        result_sha256 TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT
    `);
  }

  save(manifest: HistoricalEvidenceArtifactManifest): void {
    const parsed = HistoricalEvidenceArtifactManifestSchema.parse(manifest);
    this.database
      .prepare(`
        INSERT INTO historical_evidence_artifacts (
          artifact_id,
          artifact_ref,
          job_id,
          draft_id,
          graph_fingerprint,
          kind,
          runner_id,
          data_fingerprint,
          manifest_sha256,
          result_sha256,
          manifest_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        parsed.artifactId,
        parsed.artifactRef,
        parsed.jobId,
        parsed.draftId,
        parsed.graphFingerprint,
        parsed.kind,
        parsed.runPlan.runnerId,
        parsed.runPlan.dataFingerprint,
        parsed.manifestSha256,
        parsed.resultSha256,
        JSON.stringify(parsed),
        parsed.createdAt,
      );
  }

  getByJobId(jobId: string): HistoricalEvidenceArtifactManifest {
    const row = this.database
      .prepare(
        "SELECT manifest_json FROM historical_evidence_artifacts WHERE job_id = ?",
      )
      .get(jobId) as unknown as ArtifactLedgerRow | undefined;
    if (!row) {
      throw new PipelineEvidenceWorkflowError(
        "EVIDENCE_JOB_NOT_FOUND",
        "Historical evidence artifact was not found for the job.",
        { jobId },
      );
    }
    return HistoricalEvidenceArtifactManifestSchema.parse(
      JSON.parse(row.manifest_json),
    );
  }
}

export class RegisteredHistoricalEvidenceExecutor
  implements PipelineEvidenceExecutor
{
  constructor(
    private readonly registry: HistoricalEvidenceRunnerRegistry,
    private readonly artifactStore: HistoricalEvidenceArtifactStore,
    private readonly artifactLedger: SqliteHistoricalArtifactLedger,
  ) {}

  async execute(input: Parameters<PipelineEvidenceExecutor["execute"]>[0]): Promise<PipelineEvidenceExecutionOutput> {
    const runner = this.registry.get(input.kind);
    const parameters = input.request.parameters as Record<
      string,
      RunParameterValue
    >;
    const unknownParameter = Object.keys(parameters).find(
      (key) => !runner.allowedParameterKeys.includes(key),
    );
    if (unknownParameter) {
      throw new PipelineEvidenceWorkflowError(
        "RUNNER_PARAMETER_NOT_ALLOWED",
        "Evidence job contains a parameter outside the registered allowlist.",
        { kind: input.kind, parameter: unknownParameter },
      );
    }

    const plan = HistoricalEvidenceRunPlanSchema.parse({
      schemaVersion: "1.0.0",
      runPlanId: `historical-run-plan:${randomUUID()}`,
      jobId: input.jobId,
      draftId: input.draft.draftId,
      graphId: input.draft.graphId,
      graphFingerprint: input.draft.contentFingerprint,
      kind: input.kind,
      runnerId: runner.runnerId,
      strategyProfileRef: runner.strategyProfileRef,
      dataSourceRef: runner.dataSourceRef,
      dataFingerprint: runner.dataFingerprint,
      requestedAsOf: runner.requestedAsOf(),
      timezone: runner.timezone,
      tradingCalendarRef: runner.tradingCalendarRef,
      costModel: runner.costModel,
      parameters,
      requestedByActorId: input.requestedByActorId,
      createdAt: new Date().toISOString(),
    });
    const result = HistoricalEvidenceRunnerResultSchema.parse(
      await runner.run(plan),
    );
    const stored = this.artifactStore.write(plan, result);
    this.artifactLedger.save(stored.manifest);
    return {
      artifactRef: stored.manifest.artifactRef,
      artifactSha256: stored.manifest.manifestSha256,
      lineage: stored.lineage,
      metrics: result.metrics,
      summary: result.summary,
    };
  }
}
