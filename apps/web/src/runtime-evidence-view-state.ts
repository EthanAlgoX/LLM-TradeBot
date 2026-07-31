export interface RuntimeEvidenceViewState {
  mode: "sample" | "active" | "recent";
  hydrate: boolean;
  live: boolean;
  pollIntervalMs: number;
}

export function deriveRuntimeEvidenceViewState(
  evidenceStatus: "active" | "recent" | "unavailable" | undefined,
): RuntimeEvidenceViewState {
  if (evidenceStatus === "active") {
    return {
      mode: "active",
      hydrate: true,
      live: true,
      pollIntervalMs: 1_000,
    };
  }
  if (evidenceStatus === "recent") {
    return {
      mode: "recent",
      hydrate: true,
      live: false,
      pollIntervalMs: 5_000,
    };
  }
  return {
    mode: "sample",
    hydrate: false,
    live: false,
    pollIntervalMs: 10_000,
  };
}
