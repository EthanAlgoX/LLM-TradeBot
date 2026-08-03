export interface OrchestrationViteEnvironment {
  readonly DEV?: boolean;
  readonly VITE_TRADEBOT_ORCHESTRATION_API?: string;
  /** Legacy input retained for callers; deliberately ignored. */
  readonly VITE_TRADEBOT_ORCHESTRATION_TOKEN?: string;
}

export interface OrchestrationSessionConfiguration {
  readonly apiBase: string;
  readonly token?: string;
}

const loopbackApiBase = "http://127.0.0.1:8787";

/**
 * Resolves the local API address. Browser identity is established through a
 * loopback HttpOnly cookie, so no credential enters the bundle.
 */
export function resolveOrchestrationSessionConfiguration(input: {
  readonly globalApiBase?: string;
  readonly globalToken?: string;
  readonly viteEnvironment?: OrchestrationViteEnvironment;
}): OrchestrationSessionConfiguration {
  return {
    apiBase:
      input.globalApiBase ??
      input.viteEnvironment?.VITE_TRADEBOT_ORCHESTRATION_API ??
      loopbackApiBase,
    token: input.globalToken,
  };
}
