import { z } from "zod";
import { PipelineEvidenceJobKindSchema } from "./orchestration-evidence.js";

const RunParameterValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const HistoricalEvidenceRunPlanSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    runPlanId: z.string().min(1),
    jobId: z.string().min(1),
    draftId: z.string().min(1),
    graphId: z.string().min(1),
    graphFingerprint: z.string().min(1),
    kind: PipelineEvidenceJobKindSchema,
    runnerId: z.string().min(1),
    strategyProfileRef: z.string().min(1),
    dataSourceRef: z.string().min(1),
    dataFingerprint: z.string().min(1),
    requestedAsOf: z.string().datetime(),
    timezone: z.string().min(1),
    tradingCalendarRef: z.string().min(1),
    costModel: z
      .object({
        feeBps: z.number().finite().nonnegative(),
        slippageBps: z.number().finite().nonnegative(),
      })
      .strict(),
    parameters: z.record(z.string(), RunParameterValueSchema),
    requestedByActorId: z.string().min(1),
    createdAt: z.string().datetime(),
  })
  .strict();
export type HistoricalEvidenceRunPlan = z.infer<
  typeof HistoricalEvidenceRunPlanSchema
>;

export const HistoricalEvidenceRunnerResultSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    metrics: z.record(z.string(), z.number().finite()),
    summary: z.string().min(1),
    observations: z.array(z.string().min(1)).max(100).default([]),
    payload: z.unknown().optional(),
  })
  .strict();
export type HistoricalEvidenceRunnerResult = z.infer<
  typeof HistoricalEvidenceRunnerResultSchema
>;

export const HistoricalEvidenceArtifactManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactId: z.string().min(1),
    artifactRef: z.string().min(1),
    jobId: z.string().min(1),
    draftId: z.string().min(1),
    graphFingerprint: z.string().min(1),
    kind: PipelineEvidenceJobKindSchema,
    runPlan: HistoricalEvidenceRunPlanSchema,
    resultSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    manifestSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    createdAt: z.string().datetime(),
  })
  .strict();
export type HistoricalEvidenceArtifactManifest = z.infer<
  typeof HistoricalEvidenceArtifactManifestSchema
>;

export const HistoricalArtifactLineageSchema = z
  .object({
    artifactId: z.string().min(1),
    runnerId: z.string().min(1),
    runPlanId: z.string().min(1),
    strategyProfileRef: z.string().min(1),
    dataSourceRef: z.string().min(1),
    dataFingerprint: z.string().min(1),
    manifestSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    resultSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
export type HistoricalArtifactLineage = z.infer<
  typeof HistoricalArtifactLineageSchema
>;
