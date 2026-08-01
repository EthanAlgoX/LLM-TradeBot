export interface OrchestrationViteEnvironment {
  readonly DEV?: boolean;
  readonly VITE_TRADEBOT_ORCHESTRATION_API?: string;
  readonly VITE_TRADEBOT_ORCHESTRATION_TOKEN?: string;
}

export interface OrchestrationSessionConfiguration {
  readonly apiBase: string;
  readonly token?: string;
}

const loopbackApiBase = "http://127.0.0.1:8787";

/**
 * Resolves the local Operator session without persisting any credential.
 * Runtime injection has priority; Vite's token is deliberately DEV-only.
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
    token:
      input.globalToken ??
      (input.viteEnvironment?.DEV
        ? input.viteEnvironment.VITE_TRADEBOT_ORCHESTRATION_TOKEN
        : undefined),
  };
}
