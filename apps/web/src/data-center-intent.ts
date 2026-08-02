export interface DataCenterBindingIntent {
  assetId: string;
  datasetId: string;
  version: string;
  fingerprint: string;
  capabilityId: string;
  displayName: string;
  mode: "latest_snapshot" | "pinned_snapshot" | "replay";
}

export function dataCenterBindingIntent(value: unknown): DataCenterBindingIntent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.datasetId === "string" && typeof item.version === "string" && typeof item.fingerprint === "string" && typeof item.capabilityId === "string" && typeof item.displayName === "string" && (item.mode === "latest_snapshot" || item.mode === "pinned_snapshot" || item.mode === "replay") && typeof item.assetId === "string") return item as unknown as DataCenterBindingIntent;
  const dataset = item.dataset as Record<string, unknown> | undefined;
  const strings = [item.assetId, dataset?.datasetId, dataset?.version, dataset?.fingerprint, item.capabilityId, item.name];
  if (!dataset || strings.some((part) => typeof part !== "string" || part.length === 0)) return undefined;
  if (!String(dataset.fingerprint).startsWith("sha256:")) return undefined;
  return { assetId: String(item.assetId), datasetId: String(dataset.datasetId), version: String(dataset.version), fingerprint: String(dataset.fingerprint), capabilityId: String(item.capabilityId), displayName: String(item.name), mode: "pinned_snapshot" };
}
