import {
  ExecutableStrategyConfigurationSchema,
  type AgentRole,
  type AgentTemplate,
  type ConfigurationDraftVersion,
  type ExecutableParameterSource,
  type ExecutableStrategyConfiguration,
  type GraphStrategyProfileDefinition,
  type HistoricalGraphExecutionPlan,
} from "../../contracts/src/index.js";
import type { ConfigurationDraftService } from "./configuration-draft-service.js";
import {
  createGraphStrategyProfileCandidateSet,
  createGraphStrategyProfileDefinition,
  graphEvidenceFingerprint,
  type RegisteredGraphStrategyProfileRegistry,
} from "./graph-backtest-evidence.js";

export interface ExecutableStrategyConfigurationRepository {
  save(
    configuration: ExecutableStrategyConfiguration,
  ): ExecutableStrategyConfiguration;
  findByStrategyVersionId(
    strategyVersionId: string,
  ): ExecutableStrategyConfiguration | undefined;
  get(executableStrategyId: string): ExecutableStrategyConfiguration;
}

export interface ExecutableStrategyTemplateCatalog {
  require(templateId: string): AgentTemplate;
}

export interface ExecutableNumericParameterRule {
  effectiveParameter: string;
  min: number;
  max: number;
}

export interface ExecutableStrategyParameterPolicy {
  version: string;
  agentRoleParameters: Partial<
    Record<AgentRole, Readonly<Record<string, ExecutableNumericParameterRule>>>
  >;
  strategyThresholds: Readonly<
    Record<string, ExecutableNumericParameterRule>
  >;
  promptParameters: Readonly<
    Record<string, ExecutableNumericParameterRule>
  >;
}

const rule = (
  effectiveParameter: string,
  min: number,
  max: number,
): ExecutableNumericParameterRule => ({
  effectiveParameter,
  min,
  max,
});

export const DEFAULT_EXECUTABLE_STRATEGY_PARAMETER_POLICY:
ExecutableStrategyParameterPolicy = {
  version: "1.0.0",
  agentRoleParameters: {
    decision: {
      minimumConfidence: rule("minimumConfidence", 0, 100),
      perTradeNotional: rule("perTradeNotional", 1, 1_000_000),
    },
    risk: {
      maxNotional: rule("maxNotional", 1, 1_000_000),
    },
    execution: {
      initialCash: rule("initialCash", 100, 100_000_000),
      feeBps: rule("feeBps", 0, 1_000),
    },
    analysis: {
      weight: rule("analysisWeight", 0, 1),
    },
    bull_case: {
      weight: rule("bullWeight", 0, 1),
    },
    bear_case: {
      weight: rule("bearWeight", 0, 1),
    },
    position_monitor: {
      weight: rule("positionMonitorWeight", 0, 1),
    },
  },
  strategyThresholds: {
    minimumConfidence: rule("minimumConfidence", 0, 100),
    perTradeNotional: rule("perTradeNotional", 1, 1_000_000),
    maxNotional: rule("maxNotional", 1, 1_000_000),
    initialCash: rule("initialCash", 100, 100_000_000),
    feeBps: rule("feeBps", 0, 1_000),
  },
  promptParameters: {
    temperature: rule("temperature", 0, 2),
    maxTokens: rule("maxTokens", 64, 32_768),
  },
};

type ConfigurationRefKind = "strategy" | "agent" | "prompt_policy";

function configurationRef(
  version: ConfigurationDraftVersion,
  kind: ConfigurationRefKind,
) {
  return {
    draftId: version.draftId,
    versionId: version.versionId,
    fingerprint: version.fingerprint,
    kind,
  };
}

function numericParameter(
  value: unknown,
  ruleDefinition: ExecutableNumericParameterRule | undefined,
  fields: Readonly<Record<string, string>>,
): number {
  if (!ruleDefinition) {
    throw new ExecutableStrategyConfigurationError(
      "EXECUTABLE_STRATEGY_PARAMETER_NOT_ALLOWED",
      fields,
    );
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < ruleDefinition.min ||
    value > ruleDefinition.max
  ) {
    throw new ExecutableStrategyConfigurationError(
      "EXECUTABLE_STRATEGY_PARAMETER_OUT_OF_RANGE",
      {
        ...fields,
        min: String(ruleDefinition.min),
        max: String(ruleDefinition.max),
      },
    );
  }
  return value;
}

function weightParameterForRole(role: AgentRole): string | undefined {
  const mapping: Partial<Record<AgentRole, string>> = {
    analysis: "analysisWeight",
    bull_case: "bullWeight",
    bear_case: "bearWeight",
    position_monitor: "positionMonitorWeight",
  };
  return mapping[role];
}

type ExecutableStrategyErrorCode =
  | "EXECUTABLE_STRATEGY_NOT_FOUND"
  | "EXECUTABLE_STRATEGY_REQUIRED"
  | "EXECUTABLE_STRATEGY_VALIDATION_FAILED"
  | "EXECUTABLE_STRATEGY_REFERENCE_DUPLICATE"
  | "EXECUTABLE_STRATEGY_REFERENCE_KIND_MISMATCH"
  | "EXECUTABLE_STRATEGY_PROMPT_REFERENCE_INVALID"
  | "EXECUTABLE_STRATEGY_PROMPT_TEMPLATE_MISMATCH"
  | "EXECUTABLE_STRATEGY_PARAMETER_NOT_ALLOWED"
  | "EXECUTABLE_STRATEGY_PARAMETER_OUT_OF_RANGE"
  | "EXECUTABLE_STRATEGY_WEIGHT_TARGET_INVALID"
  | "EXECUTABLE_STRATEGY_SOURCE_CHANGED";

export class ExecutableStrategyConfigurationError extends Error {
  constructor(
    readonly code: ExecutableStrategyErrorCode,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(code);
    this.name = "ExecutableStrategyConfigurationError";
  }
}

interface ResolvedMaterializationSource {
  strategy: ConfigurationDraftVersion & {
    payload: Extract<
      ConfigurationDraftVersion["payload"],
      { kind: "strategy" }
    >;
  };
  agents: Array<
    ConfigurationDraftVersion & {
      payload: Extract<
        ConfigurationDraftVersion["payload"],
        { kind: "agent" }
      >;
    }
  >;
  prompts: Array<
    ConfigurationDraftVersion & {
      payload: Extract<
        ConfigurationDraftVersion["payload"],
        { kind: "prompt_policy" }
      >;
    }
  >;
  historicalPlan: HistoricalGraphExecutionPlan;
  baseProfile: GraphStrategyProfileDefinition;
  sourceFingerprint: `sha256:${string}`;
}

export class ExecutableStrategyConfigurationService {
  private readonly policy: ExecutableStrategyParameterPolicy;
  private readonly now: () => Date;

  constructor(
    private readonly configuration: ConfigurationDraftService,
    private readonly repository: ExecutableStrategyConfigurationRepository,
    private readonly templates: ExecutableStrategyTemplateCatalog,
    private readonly profiles: RegisteredGraphStrategyProfileRegistry,
    private readonly baseProfileId: string,
    options: {
      policy?: ExecutableStrategyParameterPolicy;
      now?: () => Date;
    } = {},
  ) {
    this.policy =
      options.policy ?? DEFAULT_EXECUTABLE_STRATEGY_PARAMETER_POLICY;
    this.now = options.now ?? (() => new Date());
  }

  materialize(
    strategyVersionId: string,
    actorId: string,
  ): ExecutableStrategyConfiguration {
    const source = this.resolveSource(strategyVersionId);
    const existing =
      this.repository.findByStrategyVersionId(strategyVersionId);
    if (existing) {
      if (existing.sourceFingerprint !== source.sourceFingerprint) {
        throw new ExecutableStrategyConfigurationError(
          "EXECUTABLE_STRATEGY_SOURCE_CHANGED",
          {
            strategyVersionId,
            expectedSourceFingerprint: existing.sourceFingerprint,
            currentSourceFingerprint: source.sourceFingerprint,
          },
        );
      }
      return this.registerDerived(existing);
    }

    const effectiveParameters: Record<
      string,
      string | number | boolean | null
    > = { ...source.baseProfile.parameters };
    const parameterSources: Record<string, ExecutableParameterSource> = {};
    for (const parameterName of Object.keys(effectiveParameters)) {
      parameterSources[parameterName] = {
        kind: "base_profile",
        sourceId: source.baseProfile.id,
      };
    }

    const rolesByAgentDraftId = new Map<string, AgentRole>();
    const promptByDraftId = new Map(
      source.prompts.map((prompt) => [prompt.draftId, prompt]),
    );
    const usedPromptDraftIds = new Set<string>();

    for (const agent of source.agents) {
      const template = this.templates.require(
        agent.payload.agentTemplateId,
      );
      rolesByAgentDraftId.set(agent.draftId, template.role);
      const roleRules =
        this.policy.agentRoleParameters[template.role] ?? {};
      for (const [parameterName, rawValue] of Object.entries(
        agent.payload.parameters,
      )) {
        const policyRule = roleRules[parameterName];
        const value = numericParameter(rawValue, policyRule, {
          sourceVersionId: agent.versionId,
          agentTemplateId: template.templateId,
          parameterName,
        });
        effectiveParameters[policyRule!.effectiveParameter] = value;
        parameterSources[policyRule!.effectiveParameter] = {
          kind: "agent_configuration",
          sourceId: agent.versionId,
        };
      }

      if (agent.payload.promptPolicyDraftId) {
        const prompt = promptByDraftId.get(
          agent.payload.promptPolicyDraftId,
        );
        if (!prompt) {
          throw new ExecutableStrategyConfigurationError(
            "EXECUTABLE_STRATEGY_PROMPT_REFERENCE_INVALID",
            {
              agentVersionId: agent.versionId,
              promptPolicyDraftId:
                agent.payload.promptPolicyDraftId,
            },
          );
        }
        if (
          prompt.payload.agentTemplateId !==
          agent.payload.agentTemplateId
        ) {
          throw new ExecutableStrategyConfigurationError(
            "EXECUTABLE_STRATEGY_PROMPT_TEMPLATE_MISMATCH",
            {
              agentTemplateId: agent.payload.agentTemplateId,
              promptTemplateId: prompt.payload.agentTemplateId,
            },
          );
        }
        usedPromptDraftIds.add(prompt.draftId);
      }
    }

    for (const prompt of source.prompts) {
      if (!usedPromptDraftIds.has(prompt.draftId)) {
        throw new ExecutableStrategyConfigurationError(
          "EXECUTABLE_STRATEGY_PROMPT_REFERENCE_INVALID",
          {
            promptPolicyDraftId: prompt.draftId,
            reason: "orphan_prompt_policy",
          },
        );
      }
      const template = this.templates.require(
        prompt.payload.agentTemplateId,
      );
      for (const [parameterName, rawValue] of Object.entries(
        prompt.payload.parameters,
      )) {
        const policyRule = this.policy.promptParameters[parameterName];
        const value = numericParameter(rawValue, policyRule, {
          sourceVersionId: prompt.versionId,
          agentTemplateId: template.templateId,
          parameterName,
        });
        const effectiveName = `prompt.${template.role}.${policyRule!.effectiveParameter}`;
        effectiveParameters[effectiveName] = value;
        parameterSources[effectiveName] = {
          kind: "prompt_policy",
          sourceId: prompt.versionId,
        };
      }
    }

    for (const [parameterName, rawValue] of Object.entries(
      source.strategy.payload.thresholds,
    )) {
      const policyRule =
        this.policy.strategyThresholds[parameterName];
      const value = numericParameter(rawValue, policyRule, {
        sourceVersionId: source.strategy.versionId,
        parameterName,
      });
      effectiveParameters[policyRule!.effectiveParameter] = value;
      parameterSources[policyRule!.effectiveParameter] = {
        kind: "strategy_threshold",
        sourceId: source.strategy.versionId,
      };
    }

    for (const [weightTarget, rawWeight] of Object.entries(
      source.strategy.payload.weights,
    )) {
      const directRole = rolesByAgentDraftId.get(weightTarget);
      const role =
        directRole ??
        source.agents
          .map((agent) =>
            this.templates.require(agent.payload.agentTemplateId),
          )
          .find((template) => template.role === weightTarget)?.role;
      const effectiveName = role
        ? weightParameterForRole(role)
        : undefined;
      if (!effectiveName) {
        throw new ExecutableStrategyConfigurationError(
          "EXECUTABLE_STRATEGY_WEIGHT_TARGET_INVALID",
          {
            strategyVersionId: source.strategy.versionId,
            weightTarget,
          },
        );
      }
      effectiveParameters[effectiveName] = numericParameter(
        rawWeight,
        rule(effectiveName, 0, 1),
        {
          sourceVersionId: source.strategy.versionId,
          weightTarget,
        },
      );
      parameterSources[effectiveName] = {
        kind: "strategy_weight",
        sourceId: source.strategy.versionId,
      };
    }

    const promptPolicySetFingerprint = graphEvidenceFingerprint(
      source.prompts.map((prompt) => ({
        versionId: prompt.versionId,
        fingerprint: prompt.fingerprint,
      })),
    );
    effectiveParameters.configurationSourceFingerprint =
      source.sourceFingerprint;
    effectiveParameters.promptPolicySetFingerprint =
      promptPolicySetFingerprint;
    effectiveParameters.materializationPolicyVersion =
      this.policy.version;
    parameterSources.configurationSourceFingerprint = {
      kind: "materialization_policy",
      sourceId: source.strategy.versionId,
    };
    parameterSources.promptPolicySetFingerprint = {
      kind: "prompt_policy",
      sourceId:
        source.prompts[0]?.versionId ?? source.strategy.versionId,
    };
    parameterSources.materializationPolicyVersion = {
      kind: "materialization_policy",
      sourceId: source.strategy.versionId,
    };

    const createdAt = this.now().toISOString();
    const identitySuffix = source.sourceFingerprint.slice(7, 31);
    const derivedProfile = createGraphStrategyProfileDefinition({
      schemaVersion: "1.0.0",
      id: `profile:materialized:${identitySuffix}`,
      version: source.strategy.humanVersion,
      lifecycleStatus: "active",
      createdAt,
      compatiblePresetIds: [source.historicalPlan.presetRef.id],
      parameters: effectiveParameters,
    });
    const derivedCandidateSet =
      createGraphStrategyProfileCandidateSet({
        schemaVersion: "1.0.0",
        id: `profile-set:materialized:${identitySuffix}`,
        version: source.strategy.humanVersion,
        lifecycleStatus: "active",
        createdAt,
        profileIds: [derivedProfile.id],
      });
    const withoutFingerprint = {
      schemaVersion: "1.0.0" as const,
      executableStrategyId: `executable-strategy:${identitySuffix}`,
      humanVersion: source.strategy.humanVersion,
      sourceFingerprint: source.sourceFingerprint,
      lifecycleStatus: "materialized" as const,
      createdAt,
      createdByActorId: actorId,
      materializationPolicyVersion: this.policy.version,
      strategyConfigurationRef: configurationRef(
        source.strategy,
        "strategy",
      ),
      agentConfigurationRefs: source.agents.map((agent) =>
        configurationRef(agent, "agent"),
      ),
      promptPolicyRefs: source.prompts.map((prompt) =>
        configurationRef(prompt, "prompt_policy"),
      ),
      historicalPlanRef: {
        id: source.historicalPlan.planId,
        version: source.historicalPlan.version,
        fingerprint: source.historicalPlan.fingerprint,
      },
      marketPackRef: source.historicalPlan.marketPackRef,
      baseProfileRef: {
        id: source.baseProfile.id,
        version: source.baseProfile.version,
        fingerprint: source.baseProfile.fingerprint,
      },
      effectiveParameters,
      parameterSources,
      promptExecutionMode: "semantic_only" as const,
      derivedProfile,
      derivedCandidateSet,
      runtimeApplied: false as const,
    };
    const materialized = ExecutableStrategyConfigurationSchema.parse({
      ...withoutFingerprint,
      fingerprint: graphEvidenceFingerprint(withoutFingerprint),
    });
    return this.registerDerived(
      this.repository.save(materialized),
    );
  }

  getCurrent(
    strategyVersionId: string,
  ): ExecutableStrategyConfiguration {
    const existing =
      this.repository.findByStrategyVersionId(strategyVersionId);
    if (!existing) {
      throw new ExecutableStrategyConfigurationError(
        "EXECUTABLE_STRATEGY_NOT_FOUND",
        { strategyVersionId },
      );
    }
    const source = this.resolveSource(strategyVersionId);
    if (existing.sourceFingerprint !== source.sourceFingerprint) {
      throw new ExecutableStrategyConfigurationError(
        "EXECUTABLE_STRATEGY_SOURCE_CHANGED",
        {
          strategyVersionId,
          expectedSourceFingerprint: existing.sourceFingerprint,
          currentSourceFingerprint: source.sourceFingerprint,
        },
      );
    }
    if (
      existing.historicalPlanRef.fingerprint !==
      source.historicalPlan.fingerprint
    ) {
      throw new ExecutableStrategyConfigurationError(
        "EXECUTABLE_STRATEGY_SOURCE_CHANGED",
        { strategyVersionId, reason: "historical_plan_changed" },
      );
    }
    return this.registerDerived(existing);
  }

  private registerDerived(
    configuration: ExecutableStrategyConfiguration,
  ): ExecutableStrategyConfiguration {
    this.profiles.registerProfile(configuration.derivedProfile);
    this.profiles.registerCandidateSet(
      configuration.derivedCandidateSet,
    );
    return ExecutableStrategyConfigurationSchema.parse(configuration);
  }

  private resolveSource(
    strategyVersionId: string,
  ): ResolvedMaterializationSource {
    const rawStrategy = this.configuration.get(strategyVersionId);
    if (rawStrategy.payload.kind !== "strategy") {
      throw new ExecutableStrategyConfigurationError(
        "EXECUTABLE_STRATEGY_REQUIRED",
        {
          strategyVersionId,
          kind: rawStrategy.payload.kind,
        },
      );
    }
    const validation = this.configuration.validate(strategyVersionId);
    if (!validation.valid) {
      throw new ExecutableStrategyConfigurationError(
        "EXECUTABLE_STRATEGY_VALIDATION_FAILED",
        {
          strategyVersionId,
          issueCodes: validation.issues
            .map((issue) => issue.code)
            .join(","),
        },
      );
    }
    const strategy = rawStrategy as ResolvedMaterializationSource["strategy"];
    const uniqueAgentIds = new Set(
      strategy.payload.agentConfigurationDraftIds,
    );
    const uniquePromptIds = new Set(
      strategy.payload.promptPolicyDraftIds,
    );
    if (
      uniqueAgentIds.size !==
        strategy.payload.agentConfigurationDraftIds.length ||
      uniquePromptIds.size !== strategy.payload.promptPolicyDraftIds.length
    ) {
      throw new ExecutableStrategyConfigurationError(
        "EXECUTABLE_STRATEGY_REFERENCE_DUPLICATE",
        { strategyVersionId },
      );
    }

    const agents = strategy.payload.agentConfigurationDraftIds.map(
      (draftId) => {
        const version = this.configuration.getLatest(draftId);
        if (version.payload.kind !== "agent") {
          throw new ExecutableStrategyConfigurationError(
            "EXECUTABLE_STRATEGY_REFERENCE_KIND_MISMATCH",
            {
              draftId,
              expectedKind: "agent",
              actualKind: version.payload.kind,
            },
          );
        }
        const result = this.configuration.validate(version.versionId);
        if (!result.valid) {
          throw new ExecutableStrategyConfigurationError(
            "EXECUTABLE_STRATEGY_VALIDATION_FAILED",
            {
              versionId: version.versionId,
              issueCodes: result.issues
                .map((issue) => issue.code)
                .join(","),
            },
          );
        }
        return version as ResolvedMaterializationSource["agents"][number];
      },
    );
    const prompts = strategy.payload.promptPolicyDraftIds.map(
      (draftId) => {
        const version = this.configuration.getLatest(draftId);
        if (version.payload.kind !== "prompt_policy") {
          throw new ExecutableStrategyConfigurationError(
            "EXECUTABLE_STRATEGY_REFERENCE_KIND_MISMATCH",
            {
              draftId,
              expectedKind: "prompt_policy",
              actualKind: version.payload.kind,
            },
          );
        }
        const result = this.configuration.validate(version.versionId);
        if (!result.valid) {
          throw new ExecutableStrategyConfigurationError(
            "EXECUTABLE_STRATEGY_VALIDATION_FAILED",
            {
              versionId: version.versionId,
              issueCodes: result.issues
                .map((issue) => issue.code)
                .join(","),
            },
          );
        }
        return version as ResolvedMaterializationSource["prompts"][number];
      },
    );
    const historicalPlan =
      this.configuration.compileHistorical(strategyVersionId);
    const baseProfile = this.profiles.require(
      this.baseProfileId,
      historicalPlan.presetRef.id,
    );
    const sourceFingerprint = graphEvidenceFingerprint({
      policyVersion: this.policy.version,
      strategy: configurationRef(strategy, "strategy"),
      agents: agents.map((agent) =>
        configurationRef(agent, "agent"),
      ),
      prompts: prompts.map((prompt) =>
        configurationRef(prompt, "prompt_policy"),
      ),
      historicalPlanRef: {
        id: historicalPlan.planId,
        version: historicalPlan.version,
        fingerprint: historicalPlan.fingerprint,
      },
      baseProfileRef: {
        id: baseProfile.id,
        version: baseProfile.version,
        fingerprint: baseProfile.fingerprint,
      },
    });
    return {
      strategy,
      agents,
      prompts,
      historicalPlan,
      baseProfile,
      sourceFingerprint,
    };
  }
}

