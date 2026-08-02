import { z } from "zod";
import type { DataSourceCapability, DataSourceDefinition, GraphHistoricalDatasetDefinition } from "../../contracts/src/index.js";
import { DataCenterCatalogSchema, DatasetBindingRequestSchema } from "../../contracts/src/index.js";
import type { ConfigurationDraftService } from "../../core/src/configuration-draft-service.js";
import type { PipelineOrchestrationAuthenticator } from "./pipeline-orchestration-auth.js";
import type { ConversationReplayRepository } from "../../core/src/orchestration-copilot-service.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function catalog(
  sources: readonly DataSourceDefinition[], capabilities: readonly DataSourceCapability[], datasets: readonly GraphHistoricalDatasetDefinition[],
) {
  const assets = sources.filter((source) => source.dataSourceId === "data-source:binance-futures-public" || source.dataSourceId === "data-source:csv-historical").map((source) => {
    const capability = capabilities.find((item) => item.dataSourceId === source.dataSourceId);
    if (!capability) throw new Error("DATA_CENTER_CAPABILITY_MISSING");
    const dataset = datasets.find((item) => item.dataSourceRef.id === source.dataSourceId);
    const isCsv = source.dataSourceId === "data-source:csv-historical";
    return {
      assetId: `asset:${source.dataSourceId.replace(/^data-source:/u, "")}`,
      name: isCsv ? "CSV Historical OHLCV" : "Binance Futures Public OHLCV",
      sourceId: source.dataSourceId,
      sourceName: source.name,
      sourceKind: isCsv ? "csv_historical" as const : "binance_public" as const,
      capabilityId: capability.capabilityId,
      health: isCsv && dataset ? "historical" as const : "unavailable" as const,
      ...(dataset ? { updatedAt: dataset.asOfSequence.at(-1) } : {}),
      ...(dataset ? { dataset: { datasetId: dataset.id, version: dataset.version, fingerprint: dataset.fingerprint, asOfStart: dataset.asOfSequence[0]!, asOfEnd: dataset.asOfSequence.at(-1)! } } : {}),
      schemaPreview: ["ts", "symbol", "timeframe", "open", "high", "low", "close", "volume"],
      quality: { completeness: capability.completeness, label: isCsv && dataset ? "registered historical snapshot" : "live snapshot not registered" },
      lineage: dataset ? [source.dataSourceId, capability.capabilityId, dataset.id, dataset.fingerprint] : [source.dataSourceId, capability.capabilityId, "no registered snapshot"],
      runtimeApplied: false as const,
    };
  });
  return DataCenterCatalogSchema.parse({
    schemaVersion: "1.0.0", assets,
    radar: { regime: { status: "unavailable" }, movers: { status: "unavailable" }, volume: { status: "unavailable" }, fundingOi: { status: "unavailable" } },
    runtimeApplied: false,
  });
}

export class DataCenterHttpHandler {
  constructor(
    private readonly sources: readonly DataSourceDefinition[], private readonly capabilities: readonly DataSourceCapability[], private readonly datasets: readonly GraphHistoricalDatasetDefinition[],
    private readonly configurations: ConfigurationDraftService, private readonly authenticator: PipelineOrchestrationAuthenticator, private readonly replayRepository: ConversationReplayRepository,
  ) {}

  async handle(request: Request): Promise<Response> {
    try {
      const actor = this.authenticator.authenticate(request.headers.get("authorization") ?? undefined);
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path === "/api/orchestration/data-center/assets") return json({ data: catalog(this.sources, this.capabilities, this.datasets) });
      if (request.method !== "POST" || path !== "/api/orchestration/data-center/bindings") return json({ error: { code: "ROUTE_NOT_FOUND" } }, 404);
      const raw = await request.json();
      const input = DatasetBindingRequestSchema.parse(raw);
      const current = this.configurations.get(input.configurationVersionId);
      if (current.draftId !== input.configurationDraftId || current.createdByActorId !== actor.actorId || current.fingerprint !== input.parentFingerprint) return json({ error: { code: "DATASET_BINDING_FORBIDDEN" } }, 403);
      if (current.payload.kind !== "market" && current.payload.kind !== "agent") return json({ error: { code: "DATASET_BINDING_DRAFT_KIND_UNSUPPORTED" } }, 400);
      const available = catalog(this.sources, this.capabilities, this.datasets).assets.find((asset) => asset.assetId === input.assetId && asset.dataset?.datasetId === input.datasetId && asset.dataset.version === input.version && asset.dataset.fingerprint === input.fingerprint && asset.capabilityId === input.capabilityId);
      if (!available || available.sourceId !== (current.payload.dataSourceIds.includes(available.sourceId) ? available.sourceId : "")) return json({ error: { code: "DATASET_BINDING_CAPABILITY_MISMATCH" } }, 400);
      const dataBindings = [...(current.payload.dataBindings ?? []).filter((item) => item.assetId !== input.assetId), { assetId: input.assetId, datasetId: input.datasetId, version: input.version, fingerprint: input.fingerprint, capabilityId: input.capabilityId, mode: input.mode }];
      const existing = this.replayRepository.get({ actorId: actor.actorId, conversationId: input.conversationId, idempotencyKey: `dataset-binding:${input.idempotencyKey}` });
      if (existing?.response.context.selected.draftReference) return json({ data: { version: this.configurations.get(existing.response.context.selected.draftReference.versionId), validation: this.configurations.validate(existing.response.context.selected.draftReference.versionId), runtimeApplied: false } });
      const version = this.configurations.createVersion(current.draftId, { schemaVersion: "1.0.0", parentFingerprint: current.fingerprint, humanVersion: `${current.humanVersion} + dataset`, payload: { ...current.payload, dataBindings } }, actor.actorId);
      const validation = this.configurations.validate(version.versionId);
      this.replayRepository.appendDraftReference(actor.actorId, input.conversationId, `dataset-binding:${input.idempotencyKey}`, { draftId: version.draftId, versionId: version.versionId, fingerprint: version.fingerprint }, dataBindings);
      return json({ data: { version, validation, runtimeApplied: false } }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) return json({ error: { code: "REQUEST_CONTRACT_INVALID" } }, 400);
      const code = error instanceof Error ? error.message : "DATA_CENTER_REQUEST_FAILED";
      return json({ error: { code } }, code.startsWith("AUTHORIZATION_") ? 401 : 400);
    }
  }
}
