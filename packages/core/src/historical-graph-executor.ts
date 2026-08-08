import { createHash } from "node:crypto";
import { z } from "zod";
import {
  HistoricalGraphArtifactEnvelopeSchema,
  HistoricalGraphExecutionPlanSchema,
  HistoricalGraphExecutionRequestSchema,
  HistoricalGraphExecutionResultSchema,
  HistoricalGraphNodeRunSchema,
  type HistoricalGraphArtifactEnvelope,
  type HistoricalGraphExecutionErrorCode,
  type HistoricalGraphExecutionPlan,
  type HistoricalGraphExecutionRequest,
  type HistoricalGraphExecutionResult,
  type HistoricalGraphPlanNode,
  type SemanticArtifactReference,
  type SemanticPipelinePresetDefinition,
  type SemanticPresetNodeRole,
} from "../../contracts/src/index.js";
import type { RegisteredSemanticPipelinePresetCatalog } from "./semantic-pipeline-presets.js";

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

function fingerprint(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

export function calculateHistoricalGraphPlanFingerprint(
  plan: Omit<HistoricalGraphExecutionPlan, "fingerprint">,
): string {
  return fingerprint(plan);
}

export class HistoricalGraphExecutionError extends Error {
  constructor(
    readonly code: HistoricalGraphExecutionErrorCode,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(code);
    this.name = "HistoricalGraphExecutionError";
  }
}

export interface RegisteredHistoricalArtifactSchema {
  artifactType: string;
  schemaRef: {
    schemaId: string;
    schemaVersion: string;
  };
  schema: z.ZodType<unknown>;
}

export class RegisteredHistoricalArtifactSchemaRegistry {
  private readonly definitions = new Map<string, RegisteredHistoricalArtifactSchema>();

  constructor(definitions: readonly RegisteredHistoricalArtifactSchema[]) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.artifactType)) {
        throw new HistoricalGraphExecutionError("ARTIFACT_SCHEMA_NOT_REGISTERED", {
          artifactType: definition.artifactType,
          reason: "duplicate",
        });
      }
      this.definitions.set(definition.artifactType, Object.freeze({ ...definition }));
    }
  }

  has(artifactType: string): boolean {
    return this.definitions.has(artifactType);
  }

  parse(artifactType: string, payload: unknown): unknown {
    const definition = this.definitions.get(artifactType);
    if (!definition) {
      throw new HistoricalGraphExecutionError("ARTIFACT_SCHEMA_NOT_REGISTERED", {
        artifactType,
      });
    }
    return definition.schema.parse(payload);
  }

  schemaRef(artifactType: string): { schemaId: string; schemaVersion: string } {
    const definition = this.definitions.get(artifactType);
    if (!definition) {
      throw new HistoricalGraphExecutionError("ARTIFACT_SCHEMA_NOT_REGISTERED", {
        artifactType,
      });
    }
    return { ...definition.schemaRef };
  }
}

export interface HistoricalGraphArtifactDraft {
  artifactType: string;
  payload: unknown;
  asOf: string;
  sourceArtifactRefs: readonly SemanticArtifactReference[];
  lineageFingerprints: readonly string[];
}

export interface TypedHistoricalGraphArtifact extends HistoricalGraphArtifactEnvelope {
  payload: unknown;
}

export interface HistoricalNodeExecutionContext {
  plan: HistoricalGraphExecutionPlan;
  node: HistoricalGraphPlanNode;
  asOf: string;
  executionLineageFingerprint: string;
  inputs: readonly TypedHistoricalGraphArtifact[];
  priorArtifacts: readonly TypedHistoricalGraphArtifact[];
  executionContext?: HistoricalGraphExecutionContext;
}

/** Optional server-owned cancellation control for bounded historical execution. */
export interface HistoricalGraphExecutionContext {
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
  checkpoint(): void;
}

export interface RegisteredHistoricalNodeExecutor {
  executorId: string;
  role: SemanticPresetNodeRole;
  inputArtifactTypes: readonly string[];
  outputArtifactTypes: readonly string[];
  execute(context: HistoricalNodeExecutionContext): Promise<readonly HistoricalGraphArtifactDraft[]>;
}

export class RegisteredHistoricalNodeExecutorRegistry {
  private readonly executors = new Map<string, RegisteredHistoricalNodeExecutor>();

  constructor(executors: readonly RegisteredHistoricalNodeExecutor[]) {
    for (const executor of executors) {
      if (this.executors.has(executor.executorId)) {
        throw new HistoricalGraphExecutionError("NODE_EXECUTOR_NOT_REGISTERED", {
          executorId: executor.executorId,
          reason: "duplicate",
        });
      }
      this.executors.set(executor.executorId, Object.freeze({ ...executor }));
    }
  }

  require(executorId: string): RegisteredHistoricalNodeExecutor {
    const executor = this.executors.get(executorId);
    if (!executor) {
      throw new HistoricalGraphExecutionError("NODE_EXECUTOR_NOT_REGISTERED", { executorId });
    }
    return executor;
  }
}

export interface HistoricalNodeExecutorBinding {
  agentTemplateId: string;
  executorId: string;
}

export interface RegisteredHistoricalGraphPlanRegistryOptions {
  presetCatalog: RegisteredSemanticPipelinePresetCatalog;
  executorRegistry: RegisteredHistoricalNodeExecutorRegistry;
  artifactSchemaRegistry: RegisteredHistoricalArtifactSchemaRegistry;
  bindings: readonly HistoricalNodeExecutorBinding[];
  now?: () => Date;
}

function topologicalNodeIds(preset: SemanticPipelinePresetDefinition): string[] {
  const incoming = new Map(preset.nodes.map((node) => [node.nodeId, 0]));
  const outgoing = new Map(preset.nodes.map((node) => [node.nodeId, [] as string[]]));
  for (const edge of preset.edges) {
    incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) ?? 0) + 1);
    outgoing.get(edge.sourceNodeId)?.push(edge.targetNodeId);
  }
  const available = preset.nodes
    .filter((node) => incoming.get(node.nodeId) === 0)
    .map((node) => node.nodeId)
    .sort();
  const result: string[] = [];
  while (available.length > 0) {
    const nodeId = available.shift();
    if (!nodeId) break;
    result.push(nodeId);
    for (const successor of [...(outgoing.get(nodeId) ?? [])].sort()) {
      const next = (incoming.get(successor) ?? 0) - 1;
      incoming.set(successor, next);
      if (next === 0) {
        available.push(successor);
        available.sort();
      }
    }
  }
  if (result.length !== preset.nodes.length) {
    throw new HistoricalGraphExecutionError("PLAN_CONTRACT_INVALID", {
      presetId: preset.id,
      reason: "cycle",
    });
  }
  return result;
}

export class RegisteredHistoricalGraphPlanRegistry {
  private readonly plans = new Map<string, HistoricalGraphExecutionPlan>();
  private readonly bindings: ReadonlyMap<string, string>;
  private readonly now: () => Date;

  constructor(private readonly options: RegisteredHistoricalGraphPlanRegistryOptions) {
    const bindings = new Map<string, string>();
    for (const binding of options.bindings) {
      if (bindings.has(binding.agentTemplateId)) {
        throw new HistoricalGraphExecutionError("NODE_EXECUTOR_NOT_REGISTERED", {
          agentTemplateId: binding.agentTemplateId,
          reason: "duplicate_binding",
        });
      }
      bindings.set(binding.agentTemplateId, binding.executorId);
    }
    this.bindings = bindings;
    this.now = options.now ?? (() => new Date());
  }

  compileAndRegisterPreset(presetId: string): HistoricalGraphExecutionPlan {
    const preset = this.options.presetCatalog.get(presetId);
    if (!preset) {
      throw new HistoricalGraphExecutionError("PRESET_NOT_REGISTERED", { presetId });
    }
    const orderedNodeIds = topologicalNodeIds(preset);
    const presetNodes = new Map(preset.nodes.map((node) => [node.nodeId, node]));
    const nodes = orderedNodeIds.map((nodeId, index) => {
      const node = presetNodes.get(nodeId);
      if (!node || !node.agentTemplateId) {
        throw new HistoricalGraphExecutionError("NODE_EXECUTOR_NOT_REGISTERED", {
          nodeId,
          reason: "agent_template_missing",
        });
      }
      const executorId = this.bindings.get(node.agentTemplateId);
      if (!executorId) {
        throw new HistoricalGraphExecutionError("NODE_EXECUTOR_NOT_REGISTERED", {
          nodeId,
          agentTemplateId: node.agentTemplateId,
        });
      }
      const executor = this.options.executorRegistry.require(executorId);
      if (executor.role !== node.role) {
        throw new HistoricalGraphExecutionError("NODE_EXECUTOR_ROLE_MISMATCH", {
          nodeId,
          executorId,
          expectedRole: node.role,
          actualRole: executor.role,
        });
      }
      for (const artifactType of node.outputArtifactTypes) {
        if (!executor.outputArtifactTypes.includes(artifactType)) {
          throw new HistoricalGraphExecutionError("OUTPUT_ARTIFACT_UNDECLARED", {
            nodeId,
            executorId,
            artifactType,
          });
        }
        if (!this.options.artifactSchemaRegistry.has(artifactType)) {
          throw new HistoricalGraphExecutionError("ARTIFACT_SCHEMA_NOT_REGISTERED", {
            nodeId,
            artifactType,
          });
        }
      }
      const incoming = preset.edges.filter((edge) => edge.targetNodeId === nodeId);
      for (const edge of incoming) {
        if (!executor.inputArtifactTypes.includes(edge.artifactType)) {
          throw new HistoricalGraphExecutionError("INPUT_SCHEMA_INCOMPATIBLE", {
            nodeId,
            executorId,
            artifactType: edge.artifactType,
          });
        }
      }
      return {
        index,
        nodeId,
        role: node.role,
        executorId,
        authority: node.authority,
        observationWindowIds: node.observationWindowIds,
        predecessorNodeIds: [...new Set(incoming.map((edge) => edge.sourceNodeId))].sort(),
        successorNodeIds: [
          ...new Set(
            preset.edges
              .filter((edge) => edge.sourceNodeId === nodeId)
              .map((edge) => edge.targetNodeId),
          ),
        ].sort(),
        inputBindings: incoming.map((edge) => ({
          edgeId: edge.edgeId,
          sourceNodeId: edge.sourceNodeId,
          artifactType: edge.artifactType,
          policy: edge.policy,
          fallbackForEdgeId: edge.fallbackForEdgeId,
        })),
        outputArtifactTypes: node.outputArtifactTypes,
      };
    });

    const planWithoutFingerprint = {
      schemaVersion: "1.0.0" as const,
      planId: `${preset.id}:historical-plan:${preset.version}`,
      version: preset.version,
      lifecycleStatus: "registered" as const,
      createdAt: this.now().toISOString(),
      presetRef: {
        id: preset.id,
        version: preset.version,
        fingerprint: preset.fingerprint,
      },
      compiledGraphRef: preset.graphVersionRef,
      executionMode: preset.executionMode,
      marketPackRef: preset.marketPackRefs[0]!,
      requiredCapabilityKinds: preset.requiredCapabilityKinds,
      nodes,
      runtimeApplied: false as const,
    };
    const plan = HistoricalGraphExecutionPlanSchema.parse({
      ...planWithoutFingerprint,
      fingerprint: calculateHistoricalGraphPlanFingerprint(planWithoutFingerprint),
    });
    const existing = this.plans.get(plan.planId);
    if (existing && existing.fingerprint !== plan.fingerprint) {
      throw new HistoricalGraphExecutionError("PLAN_FINGERPRINT_MISMATCH", {
        planId: plan.planId,
      });
    }
    this.plans.set(plan.planId, plan);
    return HistoricalGraphExecutionPlanSchema.parse(plan);
  }

  registerCompilerBridgePlan(rawPlan: unknown): HistoricalGraphExecutionPlan {
    const plan = HistoricalGraphExecutionPlanSchema.parse(rawPlan);
    const { fingerprint: suppliedFingerprint, ...withoutFingerprint } = plan;
    if (calculateHistoricalGraphPlanFingerprint(withoutFingerprint) !== suppliedFingerprint) {
      throw new HistoricalGraphExecutionError("PLAN_FINGERPRINT_MISMATCH", {
        planId: plan.planId,
      });
    }
    const existing = this.plans.get(plan.planId);
    if (existing && existing.fingerprint !== plan.fingerprint) {
      throw new HistoricalGraphExecutionError("PLAN_FINGERPRINT_MISMATCH", {
        planId: plan.planId,
      });
    }
    this.plans.set(plan.planId, plan);
    return HistoricalGraphExecutionPlanSchema.parse(plan);
  }

  require(planId: string): HistoricalGraphExecutionPlan {
    const plan = this.plans.get(planId);
    if (!plan) throw new HistoricalGraphExecutionError("PLAN_NOT_REGISTERED", { planId });
    const { fingerprint: storedFingerprint, ...withoutFingerprint } = plan;
    if (calculateHistoricalGraphPlanFingerprint(withoutFingerprint) !== storedFingerprint) {
      throw new HistoricalGraphExecutionError("PLAN_FINGERPRINT_MISMATCH", { planId });
    }
    return HistoricalGraphExecutionPlanSchema.parse(plan);
  }
}

export interface HistoricalGraphExecutorOptions {
  planRegistry: RegisteredHistoricalGraphPlanRegistry;
  executorRegistry: RegisteredHistoricalNodeExecutorRegistry;
  artifactSchemaRegistry: RegisteredHistoricalArtifactSchemaRegistry;
  authorizedCapabilityKinds: readonly ("bar" | "event" | "report")[];
  now?: () => Date;
  monotonicNow?: () => number;
}

interface CachedExecution {
  asOf: string;
  result: HistoricalGraphExecutionResult;
}

function artifactReference(artifact: TypedHistoricalGraphArtifact): SemanticArtifactReference {
  return {
    artifactId: artifact.artifactId,
    artifactType: artifact.artifactType,
    fingerprint: artifact.fingerprint,
  };
}

export class HistoricalGraphExecutor {
  private readonly results = new Map<string, CachedExecution>();
  private readonly now: () => Date;
  private readonly monotonicNow: () => number;

  constructor(private readonly options: HistoricalGraphExecutorOptions) {
    this.now = options.now ?? (() => new Date());
    this.monotonicNow = options.monotonicNow ?? (() => Date.now());
  }

  async execute(
    rawRequest: unknown,
    context?: HistoricalGraphExecutionContext,
  ): Promise<HistoricalGraphExecutionResult> {
    const request = HistoricalGraphExecutionRequestSchema.parse(rawRequest);
    const plan = this.options.planRegistry.require(request.planId);
    for (const capability of plan.requiredCapabilityKinds) {
      if (!this.options.authorizedCapabilityKinds.includes(capability)) {
        throw new HistoricalGraphExecutionError("CAPABILITY_NOT_AUTHORIZED", {
          planId: plan.planId,
          capability,
        });
      }
    }
    const cacheKey = `${request.planId}:${request.idempotencyKey}`;
    const cached = this.results.get(cacheKey);
    if (cached) {
      if (cached.asOf !== request.asOf) {
        throw new HistoricalGraphExecutionError("IDEMPOTENCY_CONFLICT", {
          planId: request.planId,
          idempotencyKey: request.idempotencyKey,
        });
      }
      return HistoricalGraphExecutionResultSchema.parse(cached.result);
    }
    context?.checkpoint();
    const result = await this.executePlan(plan, request, context);
    context?.checkpoint();
    this.results.set(cacheKey, { asOf: request.asOf, result });
    return HistoricalGraphExecutionResultSchema.parse(result);
  }

  private async executePlan(
    plan: HistoricalGraphExecutionPlan,
    request: HistoricalGraphExecutionRequest,
    context?: HistoricalGraphExecutionContext,
  ): Promise<HistoricalGraphExecutionResult> {
    const startedAt = this.now().toISOString();
    const runId = `historical-run:${fingerprint({
      planId: plan.planId,
      idempotencyKey: request.idempotencyKey,
      asOf: request.asOf,
    }).slice(7, 31)}`;
    const executionLineageFingerprint = fingerprint({
      planFingerprint: plan.fingerprint,
      asOf: request.asOf,
    });
    const artifacts: TypedHistoricalGraphArtifact[] = [];
    const outputsByNode = new Map<string, TypedHistoricalGraphArtifact[]>();
    const nodeRuns = [];
    const recoveredRequiredEdgeIds = new Set<string>();

    for (const node of plan.nodes) {
      context?.checkpoint();
      const nodeStartedAt = this.now().toISOString();
      const monotonicStart = this.monotonicNow();
      const executor = this.options.executorRegistry.require(node.executorId);
      const usedFallbackEdgeIds: string[] = [];
      const inputs: TypedHistoricalGraphArtifact[] = [];
      let preparationError: HistoricalGraphExecutionError | undefined;

      for (const binding of node.inputBindings.filter((item) => item.policy !== "fallback")) {
        const primary = (outputsByNode.get(binding.sourceNodeId) ?? []).filter(
          (artifact) => artifact.artifactType === binding.artifactType,
        );
        if (primary.length > 0) {
          inputs.push(...primary);
          continue;
        }
        const fallbackBindings = node.inputBindings.filter(
          (item) => item.policy === "fallback" && item.fallbackForEdgeId === binding.edgeId,
        );
        const fallbackArtifacts = fallbackBindings.flatMap((fallback) =>
          (outputsByNode.get(fallback.sourceNodeId) ?? []).filter(
            (artifact) => artifact.artifactType === fallback.artifactType,
          ),
        );
        if (fallbackArtifacts.length > 0) {
          inputs.push(...fallbackArtifacts);
          usedFallbackEdgeIds.push(...fallbackBindings.map((item) => item.edgeId));
          recoveredRequiredEdgeIds.add(binding.edgeId);
          continue;
        }
        if (binding.policy === "required") {
          preparationError = new HistoricalGraphExecutionError("REQUIRED_INPUT_MISSING", {
            nodeId: node.nodeId,
            edgeId: binding.edgeId,
            artifactType: binding.artifactType,
          });
          break;
        }
      }

      if (!preparationError) {
        try {
          for (const input of inputs) {
            if (!executor.inputArtifactTypes.includes(input.artifactType)) {
              throw new HistoricalGraphExecutionError("INPUT_SCHEMA_INCOMPATIBLE", {
                nodeId: node.nodeId,
                artifactType: input.artifactType,
              });
            }
            this.options.artifactSchemaRegistry.parse(input.artifactType, input.payload);
          }
          const drafts = await executor.execute({
            plan,
            node,
            asOf: request.asOf,
            executionLineageFingerprint,
            inputs,
            priorArtifacts: [...artifacts],
            executionContext: context,
          });
          context?.checkpoint();
          const nodeOutputs: TypedHistoricalGraphArtifact[] = [];
          for (const [outputIndex, draft] of drafts.entries()) {
            context?.checkpoint();
            if (
              !node.outputArtifactTypes.includes(draft.artifactType) ||
              !executor.outputArtifactTypes.includes(draft.artifactType)
            ) {
              throw new HistoricalGraphExecutionError("OUTPUT_ARTIFACT_UNDECLARED", {
                nodeId: node.nodeId,
                artifactType: draft.artifactType,
              });
            }
            if (Date.parse(draft.asOf) > Date.parse(request.asOf)) {
              throw new HistoricalGraphExecutionError("FUTURE_DATA_DETECTED", {
                nodeId: node.nodeId,
                artifactType: draft.artifactType,
              });
            }
            if (draft.lineageFingerprints.length === 0) {
              throw new HistoricalGraphExecutionError("LINEAGE_MISSING", {
                nodeId: node.nodeId,
                artifactType: draft.artifactType,
              });
            }
            const inputReferences = new Map(
              inputs.map((input) => [input.artifactId, artifactReference(input)]),
            );
            for (const sourceRef of draft.sourceArtifactRefs) {
              const source = inputReferences.get(sourceRef.artifactId);
              if (!source || source.fingerprint !== sourceRef.fingerprint) {
                throw new HistoricalGraphExecutionError("SOURCE_ARTIFACT_MISMATCH", {
                  nodeId: node.nodeId,
                  artifactId: sourceRef.artifactId,
                });
              }
            }
            const inputLineage = new Set(inputs.flatMap((input) => input.lineageFingerprints));
            if (
              inputs.length > 0 &&
              !draft.lineageFingerprints.some((lineage) => inputLineage.has(lineage))
            ) {
              throw new HistoricalGraphExecutionError("LINEAGE_MISMATCH", {
                nodeId: node.nodeId,
                artifactType: draft.artifactType,
              });
            }
            let parsedPayload: unknown;
            try {
              parsedPayload = this.options.artifactSchemaRegistry.parse(
                draft.artifactType,
                draft.payload,
              );
            } catch (error) {
              if (error instanceof HistoricalGraphExecutionError) throw error;
              throw new HistoricalGraphExecutionError("OUTPUT_SCHEMA_INCOMPATIBLE", {
                nodeId: node.nodeId,
                artifactType: draft.artifactType,
                reason: error instanceof Error ? error.name : "unknown",
              });
            }
            const artifactId = `${runId}:${node.nodeId}:${outputIndex}`;
            const envelope = HistoricalGraphArtifactEnvelopeSchema.parse({
              artifactId,
              artifactType: draft.artifactType,
              schemaRef: this.options.artifactSchemaRegistry.schemaRef(draft.artifactType),
              fingerprint: fingerprint({
                artifactId,
                artifactType: draft.artifactType,
                payload: parsedPayload,
                sourceArtifactRefs: draft.sourceArtifactRefs,
                lineageFingerprints: draft.lineageFingerprints,
              }),
              producerNodeId: node.nodeId,
              asOf: draft.asOf,
              sourceArtifactRefs: draft.sourceArtifactRefs,
              lineageFingerprints: draft.lineageFingerprints,
            });
            nodeOutputs.push({ ...envelope, payload: parsedPayload });
          }
          outputsByNode.set(node.nodeId, nodeOutputs);
          artifacts.push(...nodeOutputs);
          const completedAt = this.now().toISOString();
          nodeRuns.push(
            HistoricalGraphNodeRunSchema.parse({
              nodeRunId: `${runId}:node:${node.index}`,
              nodeId: node.nodeId,
              executorId: node.executorId,
              status: usedFallbackEdgeIds.length > 0 ? "fallback_succeeded" : "succeeded",
              startedAt: nodeStartedAt,
              completedAt,
              durationMs: Math.max(0, Math.round(this.monotonicNow() - monotonicStart)),
              inputArtifactRefs: inputs.map(artifactReference),
              outputArtifactRefs: nodeOutputs.map(artifactReference),
              usedFallbackEdgeIds,
            }),
          );
          continue;
        } catch (error) {
          preparationError =
            error instanceof HistoricalGraphExecutionError
              ? error
              : new HistoricalGraphExecutionError("NODE_EXECUTION_FAILED", {
                  nodeId: node.nodeId,
                  reason: error instanceof Error ? error.name : "unknown",
                });
        }
      }

      outputsByNode.set(node.nodeId, []);
      const completedAt = this.now().toISOString();
      nodeRuns.push(
        HistoricalGraphNodeRunSchema.parse({
          nodeRunId: `${runId}:node:${node.index}`,
          nodeId: node.nodeId,
          executorId: node.executorId,
          status: "failed",
          startedAt: nodeStartedAt,
          completedAt,
          durationMs: Math.max(0, Math.round(this.monotonicNow() - monotonicStart)),
          inputArtifactRefs: inputs.map(artifactReference),
          outputArtifactRefs: [],
          usedFallbackEdgeIds,
          error: {
            code: preparationError?.code ?? "NODE_EXECUTION_FAILED",
            nodeId: node.nodeId,
            fields: { ...(preparationError?.fields ?? {}) },
          },
        }),
      );
    }

    const failedNodeIds = new Set(
      nodeRuns.filter((nodeRun) => nodeRun.status === "failed").map((nodeRun) => nodeRun.nodeId),
    );
    const blockingFailure = plan.nodes.some((node) => {
      if (!failedNodeIds.has(node.nodeId)) return false;
      if (node.authority !== "none" || node.successorNodeIds.length === 0) return true;
      const requiredOutgoingEdgeIds = plan.nodes.flatMap((target) =>
        target.inputBindings
          .filter(
            (binding) =>
              binding.sourceNodeId === node.nodeId && binding.policy === "required",
          )
          .map((binding) => binding.edgeId),
      );
      return requiredOutgoingEdgeIds.some((edgeId) => !recoveredRequiredEdgeIds.has(edgeId));
    });
    const status = blockingFailure
      ? "failed"
      : failedNodeIds.size > 0
        ? "completed_with_warnings"
        : "succeeded";
    const terminalNodeIds = new Set(
      plan.nodes.filter((node) => node.successorNodeIds.length === 0).map((node) => node.nodeId),
    );
    const completedAt = this.now().toISOString();
    const result = HistoricalGraphExecutionResultSchema.parse({
      run: {
        schemaVersion: "1.0.0",
        runId,
        planRef: {
          id: plan.planId,
          version: plan.version,
          fingerprint: plan.fingerprint,
        },
        idempotencyKey: request.idempotencyKey,
        asOf: request.asOf,
        startedAt,
        completedAt,
        status,
        nodeRuns,
        artifactRefs: artifacts.map(artifactReference),
        terminalArtifactRefs: artifacts
          .filter((artifact) => terminalNodeIds.has(artifact.producerNodeId))
          .map(artifactReference),
        errorCodes: [
          ...new Set(
            nodeRuns.flatMap((nodeRun) => (nodeRun.error ? [nodeRun.error.code] : [])),
          ),
        ],
        runtimeApplied: false,
      },
      artifacts: artifacts.map(({ payload: _payload, ...envelope }) => envelope),
    });
    return result;
  }
}
