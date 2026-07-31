import {
  type GraphBacktestSession,
  type GraphBacktestSessionFactory,
} from "../../core/src/graph-backtest-evidence.js";
import {
  createRegisteredSemanticHistoricalExecution,
  type CurrentCryptoHistoricalExecutionPorts,
} from "./registered-semantic-historical-node-executors.js";
import type {
  GraphCycleOutcome,
  GraphHistoricalDatasetDefinition,
  GraphStrategyProfileDefinition,
  HistoricalGraphExecutionPlan,
  HistoricalGraphExecutionResult,
} from "../../contracts/src/index.js";

export interface RegisteredGraphBacktestSessionResources {
  ports: CurrentCryptoHistoricalExecutionPorts;
  captureCycleOutcome(
    asOf: string,
    result: HistoricalGraphExecutionResult,
  ): Promise<GraphCycleOutcome>;
  close?(): Promise<void>;
}

export interface RegisteredGraphBacktestSessionProvider {
  create(input: {
    sessionId: string;
    planId: string;
    dataset: GraphHistoricalDatasetDefinition;
    profile: GraphStrategyProfileDefinition;
  }): Promise<RegisteredGraphBacktestSessionResources>;
}

export function createRegisteredGraphBacktestSessionFactory(
  provider: RegisteredGraphBacktestSessionProvider,
  options: {
    authorizedCapabilityKinds?: readonly ("bar" | "event" | "report")[];
    resolvePlan?: (planId: string) => HistoricalGraphExecutionPlan;
    now?: () => Date;
    monotonicNow?: () => number;
  } = {},
): GraphBacktestSessionFactory {
  return Object.freeze({
    create: async (
      input: Parameters<GraphBacktestSessionFactory["create"]>[0],
    ): Promise<GraphBacktestSession> => {
      const resources = await provider.create(input);
      const composition = createRegisteredSemanticHistoricalExecution(resources.ports, {
        authorizedCapabilityKinds: options.authorizedCapabilityKinds ?? ["bar", "event"],
        now: options.now,
        monotonicNow: options.monotonicNow,
      });
      const plan = options.resolvePlan
        ? composition.planRegistry.registerCompilerBridgePlan(
          options.resolvePlan(input.planId),
        )
        : (() => {
          const preset = composition.presetCatalog
            .list()
            .find(
              (candidate) =>
                `${candidate.id}:historical-plan:${candidate.version}` ===
                input.planId,
            );
          if (!preset) {
            throw new Error(
              `GRAPH_BACKTEST_PLAN_NOT_REGISTERED:${input.planId}`,
            );
          }
          return composition.planRegistry.compileAndRegisterPreset(preset.id);
        })();
      return Object.freeze({
        plan,
        execute: (asOf: string, idempotencyKey: string) =>
          composition.executor.execute({ planId: plan.planId, idempotencyKey, asOf }),
        captureCycleOutcome: resources.captureCycleOutcome,
        close: async () => {
          await resources.close?.();
        },
      });
    },
  });
}
