import {
  ConversationAssistantResponseSchema,
  ConversationCommandSchema,
  ConversationListRequestSchema,
  ConversationTurnsRequestSchema,
  type ConversationDraftReference,
  type ConversationListRequest,
  type ConversationSummary,
  type ConversationSummaryPage,
  type ConversationTurnsRequest,
  type ConversationTurn,
  type ConversationTurnPage,
  DraftProposalSchema,
  EvidenceGateSummarySchema,
  RegisteredToolCallSchema,
  RegisteredToolResultSchema,
  ValidationSummarySchema,
  type ConversationAssistantResponse,
  type ConversationCommand,
  type DataSourceCapability,
  type DraftChange,
  type OrchestrationActor,
  type OrchestrationCopilotErrorCode,
  type OrchestrationIntentObservationWindow,
  type RegisteredCopilotToolName,
  type RegisteredToolCall,
  type RegisteredToolResult,
  type ValidationSummary,
} from "../../contracts/src/index.js";
import {
  assessObservationWindowCapability,
} from "./pipeline-graph-validator.js";
import {
  ConfigurationDraftError,
  type ConfigurationDraftService,
} from "./configuration-draft-service.js";
import {
  OrchestrationIntentError,
  type OrchestrationIntentDraftService,
} from "./orchestration-intent-compiler.js";
import {
  PipelinePromotionStage,
  type ImmutablePipelineRegistry,
  type PipelineOrchestrationService,
  type StoredPipelineDraft,
} from "./pipeline-orchestration.js";
import {
  PipelineEvidenceWorkflowError,
  type PipelineEvidenceWorkflow,
} from "./pipeline-evidence-workflow.js";

export interface RegisteredCopilotIntentRecipe {
  presetId: string;
  aliases: readonly string[];
  marketPackId: string;
  dataSourceIds: readonly string[];
  defaultObservationWindows: readonly OrchestrationIntentObservationWindow[];
  editableAgentTemplateId: string;
  editableParameters: Readonly<Record<string, unknown>>;
}

export interface ConversationReplayKey {
  actorId: string;
  conversationId: string;
  idempotencyKey: string;
}

export interface ConversationReplayRecord {
  command: ConversationCommand;
  response: ConversationAssistantResponse;
}

export interface ConversationReplayRepository {
  get(key: ConversationReplayKey): ConversationReplayRecord | undefined;
  save(key: ConversationReplayKey, record: ConversationReplayRecord): void;
  listConversations(
    actorId: string,
    request: ConversationListRequest,
  ): ConversationSummaryPage;
  getConversation(
    actorId: string,
    conversationId: string,
  ): ConversationSummary | undefined;
  listTurns(
    actorId: string,
    conversationId: string,
    request: ConversationTurnsRequest,
  ): ConversationTurnPage;
  getLatestTurn(
    actorId: string,
    conversationId: string,
  ): ConversationTurn | undefined;
  getLatestRecord(
    actorId: string,
    conversationId: string,
  ): ConversationReplayRecord | undefined;
  getLatestDraftReference(
    actorId: string,
    conversationId: string,
  ): ConversationDraftReference | undefined;
  appendDraftReference(
    actorId: string,
    conversationId: string,
    idempotencyKey: string,
    draftReference: ConversationDraftReference,
    datasetBindings?: ConversationAssistantResponse["context"]["selected"]["datasetBindings"],
  ): void;
}

export interface OrchestrationCopilotServiceDependencies {
  intentDraftService: OrchestrationIntentDraftService;
  configurationDraftService: ConfigurationDraftService;
  pipelineService: PipelineOrchestrationService;
  evidenceWorkflow: PipelineEvidenceWorkflow;
  registry: ImmutablePipelineRegistry;
  recipes: readonly RegisteredCopilotIntentRecipe[];
  replayRepository?: ConversationReplayRepository;
  now?: () => Date;
}

export class OrchestrationCopilotError extends Error {
  constructor(
    readonly code: OrchestrationCopilotErrorCode,
    message: string,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "OrchestrationCopilotError";
  }
}

const registeredToolNames = [
  "list_market_packs",
  "list_data_sources",
  "inspect_data_source_capability",
  "list_pipeline_presets",
  "list_agent_templates",
  "inspect_agent_template",
  "create_configuration_draft",
  "update_configuration_draft",
  "create_pipeline_draft",
  "validate_configuration_draft",
  "validate_pipeline_draft",
  "inspect_evidence_gates",
  "request_backtest",
  "request_walk_forward",
  "submit_for_human_approval",
] as const satisfies readonly RegisteredCopilotToolName[];

export class RegisteredCopilotToolRegistry {
  private readonly names = new Set<string>(registeredToolNames);

  list(): readonly RegisteredCopilotToolName[] {
    return registeredToolNames;
  }

  require(toolName: string): RegisteredCopilotToolName {
    if (!this.names.has(toolName)) {
      throw new OrchestrationCopilotError(
        "COPILOT_TOOL_NOT_REGISTERED",
        "The requested Copilot tool is not registered on the server.",
        { toolName },
      );
    }
    return toolName as RegisteredCopilotToolName;
  }
}

const sensitiveContent =
  /\b(?:api[_ -]?key|access[_ -]?token|secret|private[_ -]?key|seed[_ -]?phrase|password)\b|sk-[a-z0-9_-]{12,}/iu;
const revisionRequest =
  /(?:修改|调整|改成|设置|\b(?:change|modify|edit|set)\b)/iu;
const approvalRequest = /(?:提交.*审批|申请.*审批|human approval|submit.*approval)/iu;
const backtestRequest = /(?:回测|backtest)/iu;
const walkForwardRequest = /(?:walk[\s-]?forward|前向验证|滚动验证)/iu;
const dailyToMinuteRequest =
  /(?=.*(?:只有|仅有|only|native).*(?:1\s*d|日线|daily))(?=.*(?:5\s*m|5\s*分钟|five.minute))/iu;

const editableAgentParameters: Readonly<Record<string, readonly string[]>> = {
  "agent-template:analysis:v1": [
    "confidenceThreshold",
    "lookbackPeriods",
    "minimumSignalScore",
  ],
  "agent-template:semantic-historical:timeframe-analysis:v1": [
    "confidenceThreshold",
    "lookbackPeriods",
  ],
  "agent-template:decision:v1": ["minimumDecisionScore"],
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  let hash = 0x811c9dc5;
  for (const character of stableJson(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compactId(value: string): string {
  return fingerprint(value).slice("fnv1a32:".length);
}

function windowKey(
  window: OrchestrationIntentObservationWindow,
): string {
  return `${window.kind}:${window.value}:${window.unit}`;
}

function dedupeWindows(
  windows: readonly OrchestrationIntentObservationWindow[],
): OrchestrationIntentObservationWindow[] {
  return [
    ...new Map(windows.map((window) => [windowKey(window), window])).values(),
  ];
}

function extractObservationWindows(
  message: string,
): OrchestrationIntentObservationWindow[] {
  const windows: OrchestrationIntentObservationWindow[] = [];
  for (const match of message.matchAll(/(\d+)\s*(s|m|h|d|w|M|Q)(?![a-z])/gu)) {
    const unit = {
      s: "second",
      m: "minute",
      h: "hour",
      d: "day",
      w: "week",
      M: "month",
      Q: "quarter",
    }[match[2] ?? ""] as OrchestrationIntentObservationWindow["unit"] | undefined;
    const value = Number(match[1]);
    if (unit && value > 0) windows.push({ kind: "bar_interval", value, unit });
  }
  const localized: ReadonlyArray<
    readonly [RegExp, OrchestrationIntentObservationWindow["unit"]]
  > = [
    [/(\d+)\s*秒/gu, "second"],
    [/(\d+)\s*分钟/gu, "minute"],
    [/(\d+)\s*小时/gu, "hour"],
    [/(\d+)\s*(?:天|日)/gu, "day"],
    [/(\d+)\s*周/gu, "week"],
  ];
  for (const [pattern, unit] of localized) {
    for (const match of message.matchAll(pattern)) {
      const value = Number(match[1]);
      if (value > 0) windows.push({ kind: "bar_interval", value, unit });
    }
  }
  return dedupeWindows(windows);
}

function localized(
  command: ConversationCommand,
  zh: string,
  en: string,
): string {
  return command.locale === "zh-CN" ? zh : en;
}

function primitiveValue(raw: string): string | number | boolean {
  const value = raw.trim().replace(/^["']|["']$/gu, "");
  if (/^(?:true|false)$/iu.test(value)) return value.toLowerCase() === "true";
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function requestedParameter(message: string): {
  field: string;
  value: string | number | boolean;
} | undefined {
  const field = [
    "confidenceThreshold",
    "lookbackPeriods",
    "minimumSignalScore",
    "minimumDecisionScore",
    "implementationRef",
    "permissions",
    "riskBypass",
    "topN",
    "executionMode",
  ].find((candidate) => message.includes(candidate));
  if (!field) return undefined;
  const tail = message.slice(message.indexOf(field) + field.length);
  const match = tail.match(
    /(?:改为|修改为|设置为|设为|=|to)\s*(true|false|-?\d+(?:\.\d+)?|["'][^"']+["'])/iu,
  );
  return match?.[1] ? { field, value: primitiveValue(match[1]) } : undefined;
}

function toolCall(
  toolName: RegisteredCopilotToolName,
  command: ConversationCommand,
  index: number,
  createdAt: string,
  args: Record<string, unknown>,
): RegisteredToolCall {
  const identity = {
    conversationId: command.conversationId,
    idempotencyKey: command.idempotencyKey,
    toolName,
    index,
    args,
  };
  return RegisteredToolCallSchema.parse({
    schemaVersion: "1.0.0",
    toolCallId: `tool-call:${compactId(stableJson(identity))}:${index}`,
    toolName,
    humanVersion: "1.0.0",
    fingerprint: fingerprint(identity),
    createdAt,
    lifecycleStatus: "requested",
    arguments: args,
  });
}

function toolResult(
  call: RegisteredToolCall,
  createdAt: string,
  lifecycleStatus: RegisteredToolResult["lifecycleStatus"],
  output: Record<string, unknown>,
): RegisteredToolResult {
  return RegisteredToolResultSchema.parse({
    schemaVersion: "1.0.0",
    toolResultId: `tool-result:${compactId(call.toolCallId)}`,
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    humanVersion: "1.0.0",
    fingerprint: fingerprint({ call: call.fingerprint, lifecycleStatus, output }),
    createdAt,
    lifecycleStatus,
    output,
  });
}

function issueSummary(
  createdAt: string,
  issues: ValidationSummary["issues"],
  capabilities: ValidationSummary["capabilities"],
  checkedFingerprint?: string,
): ValidationSummary {
  const identity = { issues, capabilities, checkedFingerprint };
  return ValidationSummarySchema.parse({
    schemaVersion: "1.0.0",
    validationId: `conversation-validation:${compactId(stableJson(identity))}`,
    humanVersion: "1.0.0",
    fingerprint: fingerprint(identity),
    createdAt,
    lifecycleStatus: issues.length === 0 ? "passed" : "failed",
    valid: issues.length === 0,
    ...(checkedFingerprint ? { checkedFingerprint } : {}),
    issues,
    capabilities,
  });
}

function gateSummary(
  createdAt: string,
  draft?: StoredPipelineDraft,
  stale = false,
) {
  const stages = [
    PipelinePromotionStage.contractValidated,
    PipelinePromotionStage.backtested,
    PipelinePromotionStage.walkForwardValidated,
    PipelinePromotionStage.humanApproved,
    PipelinePromotionStage.paperRunning,
  ] as const;
  const names = [
    "contract_validation",
    "backtest",
    "walk_forward",
    "human_approval",
    "paper_running",
  ] as const;
  const currentIndex = draft
    ? [
        PipelinePromotionStage.draft,
        ...stages,
      ].indexOf(draft.promotionStage)
    : 0;
  const gates = names.map((gate, index) => ({
    gate,
    status:
      stale && index > 0
        ? ("blocked" as const)
        : index < currentIndex
          ? ("passed" as const)
          : index === currentIndex
            ? ("required" as const)
            : gate === "paper_running"
              ? ("not_applied" as const)
              : ("blocked" as const),
    ...(draft?.promotionEvidence[index]?.evidenceRef
      ? { evidenceRef: draft.promotionEvidence[index]?.evidenceRef }
      : {}),
  }));
  const nextGate = names.find((_, index) => index >= currentIndex);
  const identity = { draftId: draft?.draftId, stages: gates, stale };
  return EvidenceGateSummarySchema.parse({
    schemaVersion: "1.0.0",
    summaryId: `evidence-gates:${compactId(stableJson(identity))}`,
    humanVersion: "1.0.0",
    fingerprint: fingerprint(identity),
    createdAt,
    lifecycleStatus: stale ? "blocked" : "required",
    gates,
    ...(nextGate ? { nextGate } : {}),
  });
}

export class OrchestrationCopilotService {
  readonly tools = new RegisteredCopilotToolRegistry();
  private readonly replay = new Map<string, ConversationReplayRecord>();
  private readonly pipelineDraftByConfigurationDraft = new Map<string, string>();
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: OrchestrationCopilotServiceDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async handle(
    rawCommand: unknown,
    actor: OrchestrationActor,
  ): Promise<ConversationAssistantResponse> {
    const parsed = ConversationCommandSchema.safeParse(rawCommand);
    if (!parsed.success) {
      throw new OrchestrationCopilotError(
        "INVALID_CONVERSATION_COMMAND",
        "Conversation command does not satisfy the strict request contract.",
        { zodIssueCount: String(parsed.error.issues.length) },
      );
    }
    const replayKey = {
      actorId: actor.actorId,
      conversationId: parsed.data.conversationId,
      idempotencyKey: parsed.data.idempotencyKey,
    };
    const memoryKey = `${replayKey.actorId}:${replayKey.conversationId}:${replayKey.idempotencyKey}`;
    const replay = this.dependencies.replayRepository?.get(replayKey) ??
      this.replay.get(memoryKey);
    if (replay) {
      if (stableJson(replay.command) !== stableJson(parsed.data)) {
        throw new OrchestrationCopilotError(
          "COPILOT_IDEMPOTENCY_CONFLICT",
          "The idempotency key is already bound to a different Conversation command.",
          { conversationId: parsed.data.conversationId, idempotencyKey: parsed.data.idempotencyKey },
        );
      }
      this.restorePipelineDraftMapping(replay.response);
      return replay.response;
    }
    const command = this.applyAuthoritativeDraftReference(parsed.data, actor);
    if (sensitiveContent.test(command.message)) {
      throw new OrchestrationCopilotError(
        "COPILOT_SENSITIVE_CONTENT_REJECTED",
        "Credentials and secrets are not accepted by the orchestration conversation.",
      );
    }

    const explicitTool = command.message.match(
      /(?:tool|工具)\s*[:：]?\s*([a-z][a-z0-9_]*)/iu,
    )?.[1];
    if (explicitTool) this.tools.require(explicitTool);

    const response = await (dailyToMinuteRequest.test(command.message)
      ? this.rejectDailyUpsampling(command, actor)
      : revisionRequest.test(command.message)
        ? this.updateDraft(command, actor)
        : approvalRequest.test(command.message)
          ? this.submitApproval(command, actor)
          : walkForwardRequest.test(command.message)
            ? this.requestEvidence(command, actor, "walk_forward")
            : backtestRequest.test(command.message)
              ? this.requestEvidence(command, actor, "backtest")
              : this.createDraft(command, actor));
    const parsedResponse = ConversationAssistantResponseSchema.parse(response);
    const record = { command, response: parsedResponse };
    if (this.dependencies.replayRepository) {
      this.dependencies.replayRepository.save(replayKey, record);
    } else {
      this.replay.set(memoryKey, record);
    }
    this.restorePipelineDraftMapping(parsedResponse);
    return parsedResponse;
  }

  listConversations(
    actorId: string,
    request: ConversationListRequest,
  ): ConversationSummaryPage {
    if (!this.dependencies.replayRepository) {
      return {
        schemaVersion: "1.0.0",
        items: [],
        hasMore: false,
      };
    }
    return this.dependencies.replayRepository.listConversations(
      actorId,
      ConversationListRequestSchema.parse(request),
    );
  }

  getConversation(
    actorId: string,
    conversationId: string,
  ): ConversationSummary | undefined {
    return this.dependencies.replayRepository?.getConversation(actorId, conversationId);
  }

  listTurns(
    actorId: string,
    conversationId: string,
    request: ConversationTurnsRequest,
  ): ConversationTurnPage {
    if (!this.dependencies.replayRepository) {
      return {
        schemaVersion: "1.0.0",
        conversationId,
        items: [],
        hasMore: false,
      };
    }
    return this.dependencies.replayRepository.listTurns(
      actorId,
      conversationId,
      ConversationTurnsRequestSchema.parse(request),
    );
  }

  getLatestTurn(
    actorId: string,
    conversationId: string,
  ): ConversationTurn | undefined {
    return this.dependencies.replayRepository?.getLatestTurn(actorId, conversationId);
  }

  getLatestDraftReference(
    actorId: string,
    conversationId: string,
  ): ConversationDraftReference | undefined {
    return this.dependencies.replayRepository?.getLatestDraftReference(
      actorId,
      conversationId,
    );
  }

  private restorePipelineDraftMapping(
    response: ConversationAssistantResponse,
  ): void {
    const configurationDraftId =
      response.context.selected.draftReference?.draftId;
    const pipelineResult = response.toolResults.find(
      (result) =>
        result.toolName === "create_pipeline_draft" &&
        result.lifecycleStatus === "succeeded",
    );
    const pipelineDraftId = pipelineResult?.output.draftId;
    if (configurationDraftId && typeof pipelineDraftId === "string") {
      this.pipelineDraftByConfigurationDraft.set(
        configurationDraftId,
        pipelineDraftId,
      );
    }
  }

  private applyAuthoritativeDraftReference(
    command: ConversationCommand,
    actor: OrchestrationActor,
  ): ConversationCommand {
    const repository = this.dependencies.replayRepository;
    if (!repository) return command;
    const authoritativeReference = repository.getLatestDraftReference(
      actor.actorId,
      command.conversationId,
    );
    if (!authoritativeReference) {
      const { draftReference, ...rest } = command;
      return rest;
    }
    if (
      command.draftReference &&
      !this.isSameDraftReference(command.draftReference, authoritativeReference)
    ) {
      throw new OrchestrationCopilotError(
        "COPILOT_CONVERSATION_DRAFT_REFERENCE_CONFLICT",
        "The provided conversation draft reference does not match the latest server authoritative value for this conversation.",
        {
          conversationId: command.conversationId,
          providedVersionId: command.draftReference.versionId,
          authoritativeVersionId: authoritativeReference.versionId,
          providedFingerprint: command.draftReference.fingerprint,
          authoritativeFingerprint: authoritativeReference.fingerprint,
        },
      );
    }
    if (command.draftReference) return command;
    // The latest replay record is the durable owner of the Configuration →
    // Pipeline association. Rehydrate it before handling a follow-up so a
    // restarted process cannot silently fall back to another recipe's graph.
    const latest = repository.getLatestRecord(actor.actorId, command.conversationId);
    if (latest) this.restorePipelineDraftMapping(latest.response);
    return { ...command, draftReference: authoritativeReference };
  }

  private isSameDraftReference(
    left: ConversationDraftReference,
    right: ConversationDraftReference,
  ): boolean {
    return left.draftId === right.draftId &&
      left.versionId === right.versionId &&
      left.fingerprint === right.fingerprint;
  }

  private createDraft(
    command: ConversationCommand,
    actor: OrchestrationActor,
  ): ConversationAssistantResponse {
    const createdAt = this.now().toISOString();
    const normalized = command.message.toLocaleLowerCase();
    const explicitPresetId = command.message.match(
      /\bpreset[.:][a-z0-9._:-]+/iu,
    )?.[0]?.toLowerCase();
    const explicitMarketPackId = command.message.match(
      /\bmarket-pack:[a-z0-9._:-]+/iu,
    )?.[0]?.toLowerCase();
    const explicitDataSourceId = command.message.match(
      /\bdata-source:[a-z0-9._:-]+/iu,
    )?.[0]?.toLowerCase();
    const explicitAgentTemplateId = command.message.match(
      /\bagent-template:[a-z0-9._:-]+/iu,
    )?.[0]?.toLowerCase();
    if (
      explicitPresetId &&
      !this.dependencies.intentDraftService
        .catalog()
        .some((entry) => entry.preset.id === explicitPresetId)
    ) {
      return this.unavailable(
        command,
        actor,
        createdAt,
        "SEMANTIC_PRESET_NOT_REGISTERED",
        localized(
          command,
          "请求的 Preset 未在服务端注册。未创建 Draft。",
          "The requested preset is not registered on the server. No Draft was created.",
        ),
        { presetId: explicitPresetId },
      );
    }
    if (
      explicitMarketPackId &&
      !this.dependencies.registry.marketPacks.has(explicitMarketPackId)
    ) {
      return this.unavailable(
        command,
        actor,
        createdAt,
        "MARKET_PACK_NOT_REGISTERED",
        localized(
          command,
          "请求的 Market Pack 未在服务端注册。未创建 Draft。",
          "The requested Market Pack is not registered on the server. No Draft was created.",
        ),
        { marketPackId: explicitMarketPackId },
      );
    }
    if (
      explicitDataSourceId &&
      !this.dependencies.registry.dataSources.has(explicitDataSourceId)
    ) {
      return this.unavailable(
        command,
        actor,
        createdAt,
        "DATA_SOURCE_NOT_REGISTERED",
        localized(
          command,
          "请求的 Data Source 未在服务端注册。未创建 Draft。",
          "The requested Data Source is not registered on the server. No Draft was created.",
        ),
        { dataSourceId: explicitDataSourceId },
      );
    }
    if (
      explicitAgentTemplateId &&
      !this.dependencies.registry.agentTemplates.has(explicitAgentTemplateId)
    ) {
      return this.unavailable(
        command,
        actor,
        createdAt,
        "AGENT_TEMPLATE_NOT_REGISTERED",
        localized(
          command,
          "请求的 Agent Template 未在服务端注册。未创建 Draft。",
          "The requested Agent Template is not registered on the server. No Draft was created.",
        ),
        { agentTemplateId: explicitAgentTemplateId },
      );
    }
    // An explicit registered preset is authoritative.  Alias matching is only
    // a convenience fallback; otherwise "current-crypto" inside the CSV
    // preset ID would incorrectly select the live Current Crypto recipe.
    const recipe = explicitPresetId
      ? this.dependencies.recipes.find(
        (candidate) => candidate.presetId === explicitPresetId,
      )
      : this.dependencies.recipes.find((candidate) =>
        candidate.aliases.some((alias) =>
          normalized.includes(alias.toLocaleLowerCase()),
        ),
      );
    if (!recipe) {
      return this.unavailable(
        command,
        actor,
        createdAt,
        "COPILOT_INTENT_AMBIGUOUS",
        localized(
          command,
          "请选择后端已注册的 Crypto Multi-Agent Preset。未创建任何 Draft。",
          "Choose the backend-registered Crypto Multi-Agent preset. No Draft was created.",
        ),
        { requiredField: "presetId" },
      );
    }

    const calls: RegisteredToolCall[] = [];
    const results: RegisteredToolResult[] = [];
    const call = (
      toolName: RegisteredCopilotToolName,
      args: Record<string, unknown>,
      output: Record<string, unknown>,
    ) => {
      const item = toolCall(toolName, command, calls.length, createdAt, args);
      calls.push(item);
      results.push(toolResult(item, createdAt, "succeeded", output));
    };
    call("list_market_packs", {}, {
      ids: [...this.dependencies.registry.marketPacks.keys()],
    });
    call("list_data_sources", {}, {
      ids: [...this.dependencies.registry.dataSources.keys()],
    });
    call("list_pipeline_presets", {}, {
      ids: this.dependencies.intentDraftService
        .catalog()
        .map((entry) => entry.preset.id),
    });
    call("list_agent_templates", {}, {
      ids: [...this.dependencies.registry.agentTemplates.keys()],
    });

    const extractedWindows = extractObservationWindows(command.message);
    const recipeDataSourceIds = explicitDataSourceId
      ? [explicitDataSourceId]
      : recipe.dataSourceIds;
    const requestedWindows =
      extractedWindows.length > 0
        ? extractedWindows
        : [...recipe.defaultObservationWindows];
    try {
      const pipeline = this.dependencies.intentDraftService.createDraft({
        schemaVersion: "1.0.0",
        requestId: `conversation:${compactId(command.conversationId)}:${compactId(command.idempotencyKey)}`,
        presetId: recipe.presetId,
        marketPackId: recipe.marketPackId,
        dataSourceIds: [...recipeDataSourceIds],
        observationWindows: requestedWindows,
        requiredAgentTemplateIds: [recipe.editableAgentTemplateId],
        target: "draft_only",
      });
      call("create_pipeline_draft", { presetId: recipe.presetId }, {
        draftId: pipeline.draft.draftId,
        fingerprint: pipeline.draft.contentFingerprint,
      });

      const configuration =
        this.dependencies.configurationDraftService.create(
          {
            schemaVersion: "1.0.0",
            humanVersion: "1.0.0",
            payload: {
              kind: "agent",
              marketPackId: recipe.marketPackId,
              agentTemplateId: recipe.editableAgentTemplateId,
              dataSourceIds: [...recipeDataSourceIds],
              observationWindows: requestedWindows,
              parameters: { ...recipe.editableParameters },
            },
          },
          actor.actorId,
        );
      this.pipelineDraftByConfigurationDraft.set(
        configuration.draftId,
        pipeline.draft.draftId,
      );
      call("create_configuration_draft", {
        agentTemplateId: recipe.editableAgentTemplateId,
      }, {
        draftId: configuration.draftId,
        versionId: configuration.versionId,
        fingerprint: configuration.fingerprint,
      });
      const strategyConfiguration =
        this.dependencies.configurationDraftService.create(
          {
            schemaVersion: "1.0.0",
            humanVersion: "1.0.0",
            payload: {
              kind: "strategy",
              marketPackId: recipe.marketPackId,
              pipelineDraftId: pipeline.draft.draftId,
              agentConfigurationDraftIds: [configuration.draftId],
              promptPolicyDraftIds: [],
              weights: { [configuration.draftId]: 1 },
              thresholds: {},
            },
          },
          actor.actorId,
        );
      this.pipelineDraftByConfigurationDraft.set(
        strategyConfiguration.draftId,
        pipeline.draft.draftId,
      );
      call("create_configuration_draft", {
        pipelineDraftId: pipeline.draft.draftId,
        agentConfigurationDraftIds: [configuration.draftId],
      }, {
        draftId: strategyConfiguration.draftId,
        versionId: strategyConfiguration.versionId,
        fingerprint: strategyConfiguration.fingerprint,
      });
      const agentValidation =
        this.dependencies.configurationDraftService.validate(
          configuration.versionId,
        );
      const strategyValidation =
        this.dependencies.configurationDraftService.validate(
          strategyConfiguration.versionId,
        );
      call("validate_configuration_draft", {
        versionId: strategyConfiguration.versionId,
      }, { valid: agentValidation.valid && strategyValidation.valid });
      call("validate_pipeline_draft", {
        draftId: pipeline.draft.draftId,
      }, { valid: pipeline.validation.valid });
      call("inspect_evidence_gates", {
        draftId: pipeline.draft.draftId,
      }, { nextGate: "contract_validation" });

      const capabilities = this.capabilitySummaries(
        recipeDataSourceIds,
        requestedWindows,
      );
      const changes: DraftChange[] = [
        {
          schemaVersion: "1.0.0",
          changeId: `draft-change:${compactId(configuration.versionId)}:create`,
          operation: "add",
          scope: "agent",
          entityId: recipe.editableAgentTemplateId,
          path: ["payload"],
          after: configuration.payload,
        },
        {
          schemaVersion: "1.0.0",
          changeId: `draft-change:${compactId(strategyConfiguration.versionId)}:create`,
          operation: "add",
          scope: "graph",
          entityId: strategyConfiguration.draftId,
          path: ["payload"],
          after: strategyConfiguration.payload,
        },
      ];
      const proposal = DraftProposalSchema.parse({
        schemaVersion: "1.0.0",
        proposalId: `draft-proposal:${compactId(strategyConfiguration.versionId)}`,
        draftId: strategyConfiguration.draftId,
        versionId: strategyConfiguration.versionId,
        humanVersion: strategyConfiguration.humanVersion,
        fingerprint: strategyConfiguration.fingerprint,
        createdAt: strategyConfiguration.createdAt,
        lifecycleStatus: "draft",
        evidenceStatus: strategyConfiguration.evidenceState.status,
        marketRef: this.marketRef(recipe.marketPackId),
        sourceRefs: recipeDataSourceIds.map((id) => this.sourceRef(id)),
        presetRef: {
          id: pipeline.preset.id,
          humanVersion: pipeline.preset.version,
          fingerprint: pipeline.preset.fingerprint,
        },
        agentRefs: pipeline.intent.agentTemplateRefs.map((item) => ({
          id: item.id,
          humanVersion: item.version,
          fingerprint: item.fingerprint,
        })),
        agentGroups: this.agentGroups(
          pipeline.intent.agentTemplateRefs.map((item) => item.id),
        ),
        graphRef: {
          id: pipeline.draft.graphId,
          humanVersion: pipeline.draft.humanVersion,
          fingerprint: pipeline.draft.contentFingerprint,
        },
        schemaRefs: pipeline.intent.schemaRefs,
        changes,
        runtimeApplied: false,
      });
      const validationSummary = issueSummary(
        createdAt,
        [
          ...pipeline.validation.issues,
          ...agentValidation.issues,
          ...strategyValidation.issues,
        ].map((item, index) => ({
          issueId: `conversation-issue:${String(index + 1).padStart(2, "0")}:${item.code.toLowerCase()}`,
          code: item.code,
          severity: "error" as const,
          path: item.path,
          details: item.details,
        })),
        capabilities,
        strategyConfiguration.fingerprint,
      );
      return this.response({
        command,
        actor,
        createdAt,
        status: validationSummary.valid ? "proposal" : "validation_failed",
        assistantMessage: localized(
          command,
          `已从服务端注册的 ${pipeline.preset.displayName} 创建不可变 Draft Version。原生窗口为 5m / 15m / 1h；Runtime 未应用任何变更。`,
          `Created an immutable Draft Version from the server-registered ${pipeline.preset.displayName}. Native windows are 5m / 15m / 1h; no change was applied to Runtime.`,
        ),
        calls,
        results,
        proposal,
        validation: validationSummary,
        gates: gateSummary(createdAt, pipeline.draft),
        selected: {
          marketPackId: recipe.marketPackId,
          dataSourceIds: [...recipeDataSourceIds],
          presetId: recipe.presetId,
          agentTemplateId: recipe.editableAgentTemplateId,
          draftReference: {
            draftId: configuration.draftId,
            versionId: configuration.versionId,
            fingerprint: configuration.fingerprint,
          },
        },
      });
    } catch (error) {
      if (!(error instanceof OrchestrationIntentError)) throw error;
      return this.unavailable(
        command,
        actor,
        createdAt,
        error.code,
        localized(
          command,
          "当前注册能力无法准确生成该 Draft。没有创建可编译版本，Runtime 未修改。",
          "Registered capabilities cannot accurately produce this Draft. No compilable version was created and Runtime was not changed.",
        ),
        error.fields,
      );
    }
  }

  private rejectDailyUpsampling(
    command: ConversationCommand,
    actor: OrchestrationActor,
  ): ConversationAssistantResponse {
    const createdAt = this.now().toISOString();
    const dataSourceId = "data-source:daily-research";
    const capability = [...this.dependencies.registry.capabilities.values()].find(
      (item) => item.dataSourceId === dataSourceId,
    );
    if (!capability) {
      return this.unavailable(
        command,
        actor,
        createdAt,
        "DATA_SOURCE_NOT_REGISTERED",
        localized(
          command,
          "服务端未注册所述日线数据源。未创建 Draft。",
          "The described daily source is not registered on the server. No Draft was created.",
        ),
        { dataSourceId },
      );
    }
    const requestedWindow = {
      kind: "bar_interval" as const,
      value: 5,
      unit: "minute" as const,
    };
    const assessment = assessObservationWindowCapability(
      capability,
      requestedWindow,
    );
    const call = toolCall(
      "inspect_data_source_capability",
      command,
      0,
      createdAt,
      { dataSourceId, requestedWindow },
    );
    const result = toolResult(call, createdAt, "rejected", {
      assessment: assessment.status,
      nativeObservationWindows: capability.nativeObservationWindows,
    });
    const issues: ValidationSummary["issues"] = [
      {
        issueId: "conversation-issue:upsampling-forbidden",
        code: "UPSAMPLING_FORBIDDEN",
        severity: "error",
        path: ["observationWindow"],
        details: {
          dataSourceId,
          requestedWindow,
          nativeObservationWindows: capability.nativeObservationWindows,
          reason: "coarser_source_cannot_generate_finer_bars",
          suggestedPresetId: "preset.single-window-daily",
          alternativeCapability: "registered_minute_ohlcv_source_required",
        },
      },
      {
        issueId: "conversation-issue:observation-window-unsupported",
        code: "OBSERVATION_WINDOW_UNSUPPORTED",
        severity: "error",
        path: ["observationWindow"],
        details: {
          dataSourceId,
          requestedWindow,
        },
      },
    ];
    const validation = issueSummary(
      createdAt,
      issues,
      [this.capabilitySummary(capability, [requestedWindow])],
    );
    return this.response({
      command,
      actor,
      createdAt,
      status: "validation_failed",
      assistantMessage: localized(
        command,
        "能力校验失败：1d 数据不能反向生成 5m。请切换到 1d Agent 模板，或接入服务端注册的分钟数据源。未创建可编译版本，Runtime 未修改。",
        "Capability validation failed: 1d data cannot be reverse-generated into 5m bars. Switch to a 1d Agent template or connect a server-registered minute source. No compilable version was created and Runtime was not changed.",
      ),
      calls: [call],
      results: [result],
      validation,
      gates: gateSummary(createdAt),
      selected: {
        marketPackId: "market-pack:crypto:v1",
        dataSourceIds: [dataSourceId],
      },
    });
  }

  private updateDraft(
    command: ConversationCommand,
    actor: OrchestrationActor,
  ): ConversationAssistantResponse {
    const createdAt = this.now().toISOString();
    if (!command.draftReference) {
      throw new OrchestrationCopilotError(
        "COPILOT_DRAFT_REFERENCE_REQUIRED",
        "Updating a Draft requires a server-known Draft reference.",
      );
    }
    const requested = requestedParameter(command.message);
    if (!requested) {
      return this.unavailable(
        command,
        actor,
        createdAt,
        "COPILOT_AGENT_FIELD_NOT_ALLOWED",
        localized(
          command,
          "未识别到允许修改的 Agent 策略字段。未创建新版本。",
          "No allowed Agent strategy field was identified. No new version was created.",
        ),
        { allowedFields: Object.values(editableAgentParameters).flat().join(",") },
      );
    }
    let parent;
    try {
      parent = this.dependencies.configurationDraftService.getLatest(
        command.draftReference.draftId,
      );
    } catch {
      throw new OrchestrationCopilotError(
        "COPILOT_DRAFT_NOT_FOUND",
        "The referenced Configuration Draft was not found.",
        { draftId: command.draftReference.draftId },
      );
    }
    if (
      parent.versionId !== command.draftReference.versionId ||
      parent.fingerprint !== command.draftReference.fingerprint
    ) {
      throw new OrchestrationCopilotError(
        "COPILOT_PARENT_FINGERPRINT_CONFLICT",
        "The Draft parent fingerprint is stale. Refresh before creating a new version.",
        {
          draftId: parent.draftId,
          expectedVersionId: parent.versionId,
          expectedFingerprint: parent.fingerprint,
          suppliedFingerprint: command.draftReference.fingerprint,
        },
      );
    }
    if (parent.payload.kind !== "agent") {
      return this.unavailable(
        command,
        actor,
        createdAt,
        "COPILOT_AGENT_FIELD_NOT_ALLOWED",
        localized(
          command,
          "该 Draft 不是 Agent 配置，不能通过 Agent 字段编辑器修改。",
          "This Draft is not an Agent configuration and cannot be changed with the Agent field editor.",
        ),
        { draftKind: parent.payload.kind },
      );
    }
    const agentPayload = parent.payload;
    const allowed =
      editableAgentParameters[agentPayload.agentTemplateId] ?? [];
    if (!allowed.includes(requested.field)) {
      throw new OrchestrationCopilotError(
        "COPILOT_AGENT_FIELD_NOT_ALLOWED",
        "The requested Agent field is not editable through Copilot.",
        {
          agentTemplateId: agentPayload.agentTemplateId,
          field: requested.field,
          allowedFields: allowed.join(","),
        },
      );
    }

    const call = toolCall(
      "update_configuration_draft",
      command,
      0,
      createdAt,
      {
        draftId: parent.draftId,
        parentFingerprint: parent.fingerprint,
        field: requested.field,
      },
    );
    try {
      const version = this.dependencies.configurationDraftService.createVersion(
        parent.draftId,
        {
          schemaVersion: "1.0.0",
          parentFingerprint: parent.fingerprint,
          humanVersion: `1.0.${parent.versionIndex}`,
          payload: {
            ...agentPayload,
            parameters: {
              ...agentPayload.parameters,
              [requested.field]: requested.value,
            },
          },
        },
        actor.actorId,
      );
      const validation =
        this.dependencies.configurationDraftService.validate(version.versionId);
      const validateCall = toolCall(
        "validate_configuration_draft",
        command,
        1,
        createdAt,
        { versionId: version.versionId },
      );
      const pipelineDraft = this.pipelineDraft(version.draftId);
      const gatesCall = toolCall(
        "inspect_evidence_gates",
        command,
        2,
        createdAt,
        { draftId: pipelineDraft?.draftId ?? version.draftId },
      );
      const change: DraftChange = {
        schemaVersion: "1.0.0",
        changeId: `draft-change:${compactId(version.versionId)}:${requested.field.toLowerCase()}`,
        operation: Object.hasOwn(agentPayload.parameters, requested.field)
          ? "replace"
          : "add",
        scope: "agent",
        entityId: agentPayload.agentTemplateId,
        path: ["payload", "parameters", requested.field],
        ...(Object.hasOwn(agentPayload.parameters, requested.field)
          ? { before: agentPayload.parameters[requested.field] }
          : {}),
        after: requested.value,
      };
      const recipe = this.recipeForAgentPayload(agentPayload);
      if (!recipe) {
        throw new OrchestrationCopilotError(
          "COPILOT_DRAFT_RECIPE_NOT_REGISTERED",
          "The Draft does not match a server-registered Copilot recipe.",
          {
            agentTemplateId: agentPayload.agentTemplateId,
            marketPackId: agentPayload.marketPackId,
            dataSourceIds: agentPayload.dataSourceIds.join(","),
          },
        );
      }
      const preset = this.dependencies.intentDraftService
        .catalog()
        .find((entry) => entry.preset.id === recipe.presetId)?.preset;
      if (!preset) throw new Error("COPILOT_PRESET_NOT_REGISTERED");
      const graph = pipelineDraft?.graph;
      const graphFingerprint =
        pipelineDraft?.contentFingerprint ?? preset.graphVersionRef.fingerprint;
      const proposal = DraftProposalSchema.parse({
        schemaVersion: "1.0.0",
        proposalId: `draft-proposal:${compactId(version.versionId)}`,
        draftId: version.draftId,
        versionId: version.versionId,
        humanVersion: version.humanVersion,
        fingerprint: version.fingerprint,
        parentFingerprint: parent.fingerprint,
        createdAt: version.createdAt,
        lifecycleStatus: "draft",
        evidenceStatus: version.evidenceState.status,
        marketRef: this.marketRef(agentPayload.marketPackId),
        sourceRefs: agentPayload.dataSourceIds.map((id) => this.sourceRef(id)),
        presetRef: {
          id: preset.id,
          humanVersion: preset.version,
          fingerprint: preset.fingerprint,
        },
        agentRefs: [
          this.agentRef(agentPayload.agentTemplateId),
        ],
        agentGroups: this.agentGroups([agentPayload.agentTemplateId]),
        graphRef: {
          id: graph?.pipelineGraphId ?? preset.graphVersionRef.id,
          humanVersion:
            graph?.humanReadableVersion ?? preset.graphVersionRef.version,
          fingerprint: graphFingerprint,
        },
        schemaRefs: graph?.schemaRefs ?? ["tradebot.agent-config.v1"],
        changes: [change],
        runtimeApplied: false,
      });
      const validationSummary = issueSummary(
        createdAt,
        validation.issues.map((item, index) => ({
          issueId: `conversation-issue:${String(index + 1).padStart(2, "0")}:${item.code.toLowerCase()}`,
          code: item.code,
          severity: "error" as const,
          path: item.path,
          details: item.details,
        })),
        this.capabilitySummaries(
          agentPayload.dataSourceIds,
          agentPayload.observationWindows,
        ),
        version.fingerprint,
      );
      return this.response({
        command,
        actor,
        createdAt,
        status: validationSummary.valid ? "proposal" : "validation_failed",
        assistantMessage: localized(
          command,
          `已创建新的不可变 Draft Version，并返回字段级 Diff。父 fingerprint 已锁定；${version.evidenceState.status === "stale" ? "旧 Evidence 已标记 stale；" : ""}Runtime 未修改。`,
          `Created a new immutable Draft Version with a field-level Diff. The parent fingerprint is locked; ${version.evidenceState.status === "stale" ? "prior Evidence is stale; " : ""}Runtime was not changed.`,
        ),
        calls: [call, validateCall, gatesCall],
        results: [
          toolResult(call, createdAt, "succeeded", {
            versionId: version.versionId,
            fingerprint: version.fingerprint,
            parentFingerprint: parent.fingerprint,
          }),
          toolResult(validateCall, createdAt, "succeeded", {
            valid: validation.valid,
          }),
          toolResult(gatesCall, createdAt, "succeeded", {
            evidenceStatus: version.evidenceState.status,
          }),
        ],
        proposal,
        validation: validationSummary,
        gates: gateSummary(
          createdAt,
          pipelineDraft,
          version.evidenceState.status === "stale",
        ),
        selected: {
          marketPackId: agentPayload.marketPackId,
          dataSourceIds: agentPayload.dataSourceIds,
          presetId: recipe.presetId,
          agentTemplateId: agentPayload.agentTemplateId,
          draftReference: {
            draftId: version.draftId,
            versionId: version.versionId,
            fingerprint: version.fingerprint,
          },
        },
      });
    } catch (error) {
      if (
        error instanceof ConfigurationDraftError &&
        error.code === "CONFIGURATION_PARENT_CONFLICT"
      ) {
        throw new OrchestrationCopilotError(
          "COPILOT_PARENT_FINGERPRINT_CONFLICT",
          "The Draft parent fingerprint is stale.",
          error.fields,
        );
      }
      throw error;
    }
  }

  private async requestEvidence(
    command: ConversationCommand,
    actor: OrchestrationActor,
    kind: "backtest" | "walk_forward",
  ): Promise<ConversationAssistantResponse> {
    const createdAt = this.now().toISOString();
    const pipelineDraft = this.requirePipelineDraft(command);
    const toolName =
      kind === "backtest" ? "request_backtest" : "request_walk_forward";
    const call = toolCall(toolName, command, 0, createdAt, {
      draftId: pipelineDraft.draftId,
    });
    try {
      if (
        kind === "backtest" &&
        pipelineDraft.promotionStage === PipelinePromotionStage.draft
      ) {
        this.dependencies.evidenceWorkflow.validateContract(
          pipelineDraft.draftId,
          actor,
        );
      }
      const job = await this.dependencies.evidenceWorkflow.runEvidenceJob(
        pipelineDraft.draftId,
        kind,
        {
          schemaVersion: "1.0.0",
          idempotencyKey: command.idempotencyKey,
          parameters: {},
        },
        actor,
      );
      const current = this.dependencies.pipelineService.getDraft(
        pipelineDraft.draftId,
      );
      const passed = job.status === "succeeded";
      const validation = issueSummary(
        createdAt,
        passed
          ? []
          : [
              {
                issueId: `conversation-issue:${kind.replaceAll("_", "-")}-failed`,
                code: job.failureCode ?? "EVIDENCE_EXECUTION_FAILED",
                severity: "error" as const,
                path: ["evidenceGates", kind],
                details: { jobId: job.jobId, status: job.status },
              },
            ],
        [],
        current.contentFingerprint,
      );
      return this.response({
        command,
        actor,
        createdAt,
        status: "evidence_required",
        assistantMessage: localized(
          command,
          passed
            ? `${kind === "backtest" ? "Backtest" : "Walk-Forward"} 已由注册 Runner 完成。请继续下一 Evidence Gate；Runtime 未修改。`
            : `${kind === "backtest" ? "Backtest" : "Walk-Forward"} 请求已由现有 Evidence Workflow 处理，但当前 Runner 未通过。Runtime 未修改。`,
          passed
            ? `${kind === "backtest" ? "Backtest" : "Walk-Forward"} completed through the registered runner. Continue to the next Evidence Gate; Runtime was not changed.`
            : `The existing Evidence Workflow processed the ${kind === "backtest" ? "Backtest" : "Walk-Forward"} request, but the current runner did not pass. Runtime was not changed.`,
        ),
        calls: [call],
        results: [
          toolResult(
            call,
            createdAt,
            passed ? "succeeded" : "rejected",
            {
              jobId: job.jobId,
              status: job.status,
              ...(job.failureCode ? { failureCode: job.failureCode } : {}),
            },
          ),
        ],
        validation,
        gates: gateSummary(createdAt, current),
        selected: {
          dataSourceIds: [],
          draftReference: command.draftReference,
        },
      });
    } catch (error) {
      if (!(error instanceof PipelineEvidenceWorkflowError)) throw error;
      const validation = issueSummary(
        createdAt,
        [
          {
            issueId: `conversation-issue:${error.code.toLowerCase().replaceAll("_", "-")}`,
            code: error.code,
            severity: "error",
            path: ["evidenceGates", kind],
            details: error.fields,
          },
        ],
        [],
        pipelineDraft.contentFingerprint,
      );
      return this.response({
        command,
        actor,
        createdAt,
        status: "evidence_required",
        assistantMessage: localized(
          command,
          "Evidence Gate 顺序或 Runner 能力不满足请求。Runtime 未修改。",
          "The Evidence Gate order or registered runner capability does not satisfy the request. Runtime was not changed.",
        ),
        calls: [call],
        results: [
          toolResult(call, createdAt, "rejected", {
            code: error.code,
            ...error.fields,
          }),
        ],
        validation,
        gates: gateSummary(createdAt, pipelineDraft),
        selected: {
          dataSourceIds: [],
          draftReference: command.draftReference,
        },
      });
    }
  }

  private submitApproval(
    command: ConversationCommand,
    actor: OrchestrationActor,
  ): ConversationAssistantResponse {
    const createdAt = this.now().toISOString();
    const draft = this.requirePipelineDraft(command);
    const call = toolCall(
      "submit_for_human_approval",
      command,
      0,
      createdAt,
      { draftId: draft.draftId },
    );
    try {
      const approval = this.dependencies.evidenceWorkflow.approve(
        draft.draftId,
        { schemaVersion: "1.0.0", decision: "approve" },
        actor,
      );
      const validation = issueSummary(
        createdAt,
        [],
        [],
        approval.draft.contentFingerprint,
      );
      return this.response({
        command,
        actor,
        createdAt,
        status: "approval_ready",
        assistantMessage: localized(
          command,
          "人工审批已记录为 APPROVED_NOT_APPLIED。Runtime 仍未修改。",
          "Human approval is recorded as APPROVED_NOT_APPLIED. Runtime remains unchanged.",
        ),
        calls: [call],
        results: [
          toolResult(call, createdAt, "succeeded", {
            approvalId: approval.audit.approvalId,
          }),
        ],
        validation,
        gates: gateSummary(createdAt, approval.draft),
        selected: {
          dataSourceIds: [],
          draftReference: command.draftReference,
        },
      });
    } catch (error) {
      if (
        error instanceof PipelineEvidenceWorkflowError &&
        error.code === "APPROVAL_OUT_OF_ORDER"
      ) {
        const validation = issueSummary(
          createdAt,
          [
            {
              issueId: "conversation-issue:approval-out-of-order",
              code: "APPROVAL_OUT_OF_ORDER",
              severity: "error",
              path: ["evidenceGates", "human_approval"],
              details: error.fields,
            },
          ],
          [],
          draft.contentFingerprint,
        );
        return this.response({
          command,
          actor,
          createdAt,
          status: "evidence_required",
          assistantMessage: localized(
            command,
            "Backtest 和 Walk-Forward 尚未通过，不能提交 Human Approval。Runtime 未修改。",
            "Backtest and Walk-Forward have not passed, so Human Approval cannot be submitted. Runtime was not changed.",
          ),
          calls: [call],
          results: [
            toolResult(call, createdAt, "rejected", {
              code: error.code,
              currentStage: draft.promotionStage,
            }),
          ],
          validation,
          gates: gateSummary(createdAt, draft),
          selected: {
            dataSourceIds: [],
            draftReference: command.draftReference,
          },
        });
      }
      throw error;
    }
  }

  private unavailable(
    command: ConversationCommand,
    actor: OrchestrationActor,
    createdAt: string,
    code: string,
    message: string,
    details: Readonly<Record<string, string>>,
  ): ConversationAssistantResponse {
    const validation = issueSummary(createdAt, [
      {
        issueId: `conversation-issue:${code.toLowerCase().replaceAll("_", "-")}`,
        code,
        severity: "error",
        path: ["message"],
        details: { ...details },
      },
    ], []);
    return this.response({
      command,
      actor,
      createdAt,
      status: "unavailable",
      assistantMessage: message,
      calls: [],
      results: [],
      validation,
      gates: gateSummary(createdAt),
      selected: {
        dataSourceIds: [],
        ...(command.draftReference
          ? { draftReference: command.draftReference }
          : {}),
      },
    });
  }

  private response(input: {
    command: ConversationCommand;
    actor: OrchestrationActor;
    createdAt: string;
    status: ConversationAssistantResponse["status"];
    assistantMessage: string;
    calls: RegisteredToolCall[];
    results: RegisteredToolResult[];
    proposal?: ConversationAssistantResponse["proposal"];
    validation: ValidationSummary;
    gates: ConversationAssistantResponse["evidenceGates"];
    selected: ConversationAssistantResponse["context"]["selected"];
  }): ConversationAssistantResponse {
    const selected = this.withDatasetBindingProjection(input.selected);
    const contextIdentity = {
      conversationId: input.command.conversationId,
      actorId: input.actor.actorId,
      selected,
      tools: this.tools.list(),
    };
    const context = {
      schemaVersion: "1.0.0" as const,
      contextId: `conversation-context:${compactId(stableJson(contextIdentity))}`,
      conversationId: input.command.conversationId,
      humanVersion: "1.0.0",
      fingerprint: fingerprint(contextIdentity),
      createdAt: input.createdAt,
      lifecycleStatus: "active" as const,
      actor: {
        actorId: input.actor.actorId,
        roles: [...input.actor.roles],
      },
      registry: {
        marketPackIds: [...this.dependencies.registry.marketPacks.keys()],
        dataSourceIds: [...this.dependencies.registry.dataSources.keys()],
        agentTemplateIds: [...this.dependencies.registry.agentTemplates.keys()],
        presetIds: this.dependencies.intentDraftService
          .catalog()
          .map((entry) => entry.preset.id),
        toolIds: [...this.tools.list()],
      },
      selected,
    };
    const identity = {
      command: input.command,
      status: input.status,
      contextFingerprint: context.fingerprint,
      proposalFingerprint: input.proposal?.fingerprint,
      validationFingerprint: input.validation.fingerprint,
      gateFingerprint: input.gates.fingerprint,
    };
    return ConversationAssistantResponseSchema.parse({
      schemaVersion: "1.0.0",
      responseId: `conversation-response:${compactId(stableJson(identity))}`,
      conversationId: input.command.conversationId,
      idempotencyKey: input.command.idempotencyKey,
      humanVersion: "1.0.0",
      fingerprint: fingerprint(identity),
      createdAt: input.createdAt,
      lifecycleStatus: "completed",
      status: input.status,
      assistantMessage: input.assistantMessage,
      context,
      toolCalls: input.calls,
      toolResults: input.results,
      ...(input.proposal ? { proposal: input.proposal } : {}),
      validation: input.validation,
      evidenceGates: input.gates,
      runtimeApplied: false,
    });
  }

  private withDatasetBindingProjection(
    selected: ConversationAssistantResponse["context"]["selected"],
  ): ConversationAssistantResponse["context"]["selected"] {
    if (!selected.draftReference) return selected;
    const version = this.dependencies.configurationDraftService.get(
      selected.draftReference.versionId,
    );
    const datasetBindings = "dataBindings" in version.payload
      ? version.payload.dataBindings
      : undefined;
    return datasetBindings?.length
      ? { ...selected, datasetBindings: [...datasetBindings] }
      : selected;
  }

  private capabilitySummaries(
    dataSourceIds: readonly string[],
    requestedWindows: readonly OrchestrationIntentObservationWindow[],
  ): ValidationSummary["capabilities"] {
    return [...this.dependencies.registry.capabilities.values()]
      .filter((capability) => dataSourceIds.includes(capability.dataSourceId))
      .map((capability) =>
        this.capabilitySummary(capability, requestedWindows),
      );
  }

  private capabilitySummary(
    capability: DataSourceCapability,
    requestedWindows: readonly OrchestrationIntentObservationWindow[],
  ): ValidationSummary["capabilities"][number] {
    const lineage = requestedWindows.flatMap((requestedWindow) => {
      const assessment = assessObservationWindowCapability(
        capability,
        requestedWindow,
      );
      return assessment.status === "aggregated"
        ? [
            {
              sourceWindow: assessment.sourceWindow,
              targetWindow: requestedWindow,
              transformerVersion:
                capability.aggregation.transformerVersion ??
                "unregistered-transformer",
              timezone: capability.timezone,
              tradingCalendar: capability.tradingCalendar,
              asOfPolicy: "closed_windows_only" as const,
            },
          ]
        : [];
    });
    return {
      capabilityId: capability.capabilityId,
      dataSourceId: capability.dataSourceId,
      nativeObservationWindows: capability.nativeObservationWindows,
      requestedObservationWindows: [...requestedWindows],
      lineage,
    };
  }

  private marketRef(id: string) {
    const market = this.dependencies.registry.marketPacks.get(id);
    if (!market) {
      throw new OrchestrationIntentError(
        "MARKET_PACK_NOT_REGISTERED",
        "Market Pack is not registered.",
        { marketPackId: id },
      );
    }
    return {
      id: market.marketPackId,
      humanVersion: market.humanReadableVersion,
      fingerprint: market.fingerprint,
    };
  }

  private sourceRef(id: string) {
    const source = this.dependencies.registry.dataSources.get(id);
    if (!source) {
      throw new OrchestrationIntentError(
        "DATA_SOURCE_NOT_REGISTERED",
        "Data Source is not registered.",
        { dataSourceId: id },
      );
    }
    return {
      id: source.dataSourceId,
      humanVersion: source.humanReadableVersion,
      fingerprint: source.fingerprint,
    };
  }

  private agentRef(id: string) {
    const agent = this.dependencies.registry.agentTemplates.get(id);
    if (!agent) {
      throw new OrchestrationIntentError(
        "AGENT_TEMPLATE_NOT_REGISTERED",
        "Agent Template is not registered.",
        { templateId: id },
      );
    }
    return {
      id: agent.templateId,
      humanVersion: agent.humanReadableVersion,
      fingerprint: agent.fingerprint,
    };
  }

  private agentGroups(ids: readonly string[]) {
    const groups: {
      inputAgents: Array<ReturnType<OrchestrationCopilotService["categorizedAgentRef"]>>;
      analysisAgents: Array<ReturnType<OrchestrationCopilotService["categorizedAgentRef"]>>;
      decisionReflectionAgents: Array<ReturnType<OrchestrationCopilotService["categorizedAgentRef"]>>;
    } = {
      inputAgents: [],
      analysisAgents: [],
      decisionReflectionAgents: [],
    };
    for (const id of ids) {
      const reference = this.categorizedAgentRef(id);
      if (reference.orchestrationClass === "input_agent") {
        groups.inputAgents.push(reference);
      } else if (reference.orchestrationClass === "analysis_agent") {
        groups.analysisAgents.push(reference);
      } else {
        groups.decisionReflectionAgents.push(reference);
      }
    }
    return groups;
  }

  private categorizedAgentRef(id: string) {
    const agent = this.dependencies.registry.agentTemplates.get(id);
    if (!agent) {
      throw new OrchestrationIntentError(
        "AGENT_TEMPLATE_NOT_REGISTERED",
        "Agent Template is not registered.",
        { templateId: id },
      );
    }
    const inputRoles = new Set([
      "selector",
      "data_sync",
      "data_quality",
      "processing",
    ]);
    const analysisRoles = new Set([
      "analysis",
      "bull_case",
      "bear_case",
      "context",
    ]);
    const orchestrationClass = inputRoles.has(agent.role)
      ? "input_agent" as const
      : analysisRoles.has(agent.role)
        ? "analysis_agent" as const
        : "decision_reflection_agent" as const;
    const promptRoles = new Set([
      "analysis",
      "bull_case",
      "bear_case",
      "context",
      "decision",
      "reflection",
    ]);
    return {
      ...this.agentRef(id),
      orchestrationClass,
      configurationKind:
        orchestrationClass === "input_agent"
          ? "input_source" as const
          : promptRoles.has(agent.role)
            ? "prompt_strategy" as const
            : "controlled_policy" as const,
    };
  }

  private pipelineDraft(configurationDraftId: string) {
    const draftId = this.pipelineDraftByConfigurationDraft.get(configurationDraftId);
    if (!draftId) return undefined;
    try {
      return this.dependencies.pipelineService.getDraft(draftId);
    } catch {
      return undefined;
    }
  }

  private recipeForAgentPayload(
    payload: Extract<
      ReturnType<ConfigurationDraftService["getLatest"]>["payload"],
      { kind: "agent" }
    >,
  ): RegisteredCopilotIntentRecipe | undefined {
    const matches = this.dependencies.recipes.filter((candidate) =>
      candidate.editableAgentTemplateId === payload.agentTemplateId &&
      candidate.marketPackId === payload.marketPackId &&
      candidate.dataSourceIds.length === payload.dataSourceIds.length &&
      candidate.dataSourceIds.every((id) => payload.dataSourceIds.includes(id))
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  private requirePipelineDraft(command: ConversationCommand): StoredPipelineDraft {
    if (!command.draftReference) {
      throw new OrchestrationCopilotError(
        "COPILOT_DRAFT_REFERENCE_REQUIRED",
        "This operation requires a server-known Draft reference.",
      );
    }
    const draft = this.pipelineDraft(command.draftReference.draftId);
    if (!draft) {
      throw new OrchestrationCopilotError(
        "COPILOT_DRAFT_NOT_FOUND",
        "The Pipeline Draft associated with the reference was not found.",
        { draftId: command.draftReference.draftId },
      );
    }
    return draft;
  }
}
