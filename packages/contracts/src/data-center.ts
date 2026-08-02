import { z } from "zod";
import { ArtifactFingerprintSchema, SemanticArtifactSchemaVersion } from "./semantic-agent-artifacts.js";

const Id = z.string().min(3).max(200).regex(/^[a-z0-9][a-z0-9._:@-]*$/u);
const Timestamp = z.string().datetime({ offset: true });

export const DataCenterAssetSchema = z.object({
  assetId: Id,
  name: z.string().min(1).max(200),
  sourceId: Id,
  sourceName: z.string().min(1).max(200),
  sourceKind: z.enum(["binance_public", "csv_historical"]),
  capabilityId: Id,
  health: z.enum(["healthy", "historical", "unavailable"]),
  updatedAt: Timestamp.optional(),
  dataset: z.object({
    datasetId: Id,
    version: z.string().min(1).max(80),
    fingerprint: ArtifactFingerprintSchema,
    asOfStart: Timestamp,
    asOfEnd: Timestamp,
  }).strict().optional(),
  schemaPreview: z.array(z.string().min(1)).min(1),
  quality: z.object({ completeness: z.number().min(0).max(1), label: z.string().min(1) }).strict(),
  lineage: z.array(z.string().min(1)).min(1),
  runtimeApplied: z.literal(false),
}).strict();

export const DataCenterCatalogSchema = z.object({
  schemaVersion: z.literal(SemanticArtifactSchemaVersion),
  assets: z.array(DataCenterAssetSchema),
  radar: z.object({
    regime: z.object({ status: z.enum(["available", "unavailable"]), value: z.string().optional() }).strict(),
    movers: z.object({ status: z.literal("unavailable") }).strict(),
    volume: z.object({ status: z.literal("unavailable") }).strict(),
    fundingOi: z.object({ status: z.literal("unavailable") }).strict(),
  }).strict(),
  runtimeApplied: z.literal(false),
}).strict();

export type DataCenterAsset = z.infer<typeof DataCenterAssetSchema>;
export type DataCenterCatalog = z.infer<typeof DataCenterCatalogSchema>;

/**
 * The only client-supplied facts needed to append a Dataset binding to a
 * Configuration Draft.  Keep this contract shared: the Web UI builds it and
 * the HTTP boundary validates it without maintaining a second copy.
 */
export const DatasetBindingModeSchema = z.enum([
  "latest_snapshot",
  "pinned_snapshot",
  "replay",
]);

export const DatasetBindingIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/u, "dataset_binding_idempotency_key_format");

export const DatasetBindingRequestSchema = z
  .object({
    schemaVersion: z.literal(SemanticArtifactSchemaVersion),
    configurationDraftId: z.string().min(3),
    configurationVersionId: z.string().min(3),
    parentFingerprint: ArtifactFingerprintSchema,
    assetId: Id,
    datasetId: Id,
    version: z.string().min(1).max(80),
    fingerprint: ArtifactFingerprintSchema,
    capabilityId: Id,
    mode: DatasetBindingModeSchema,
    idempotencyKey: DatasetBindingIdempotencyKeySchema,
    conversationId: z.string().min(3).max(240),
  })
  .strict();

export type DatasetBindingRequest = z.infer<typeof DatasetBindingRequestSchema>;
export type DatasetBindingMode = z.infer<typeof DatasetBindingModeSchema>;
