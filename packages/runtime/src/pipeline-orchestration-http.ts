import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type {
  ImmutablePipelineRegistry,
  PipelineOrchestrationService,
} from "../../core/src/pipeline-orchestration.js";
import {
  ConversationIdSchema,
  ConversationListRequestSchema,
  ConversationTurnsRequestSchema,
  projectToolActivity,
  type PipelineGraphVersion,
} from "../../contracts/src/index.js";
import {
  PipelineOrchestrationError,
} from "../../core/src/pipeline-orchestration.js";
import { ConversationReplayReadError } from "./sqlite-conversation-replay-repository.js";
import {
  OrchestrationIntentError,
  type OrchestrationIntentDraftService,
} from "../../core/src/orchestration-intent-compiler.js";
import {
  OrchestrationCopilotError,
  type OrchestrationCopilotService,
} from "../../core/src/orchestration-copilot-service.js";
import {
  ApprovedPaperPlanError,
  type ApprovedPaperPlanService,
} from "../../core/src/approved-paper-plan-service.js";
import {
  PaperRuntimeActivationError,
  type PaperRuntimeActivationService,
} from "./paper-runtime-activation.js";
import {
  PaperRuntimeSupervisorError,
  type PaperRuntimeSupervisorService,
} from "./sqlite-paper-runtime-supervisor.js";
import {
  PipelineEvidenceWorkflowError,
  type PipelineEvidenceWorkflow,
} from "../../core/src/pipeline-evidence-workflow.js";
import {
  PipelineAuthenticationError,
  type PipelineOrchestrationAuthenticator,
} from "./pipeline-orchestration-auth.js";
import type { ConfigurationDraftHttpHandler } from "./configuration-draft-http.js";
import type { StrategyEvidenceHttpHandler } from "./strategy-evidence-http.js";
import type { HistoricalSemanticEvaluationHttpHandler } from "./historical-semantic-evaluation-http.js";
import type { DataCenterHttpHandler } from "./data-center-http.js";
import type { ExperimentLabHttpHandler } from "./experiment-lab.js";
import {
  CurrentCryptoPaperLaunchError,
  type CurrentCryptoPaperLaunchService,
} from "./current-crypto-paper-launch.js";
import type {
  RuntimeEvidenceHttpHandler,
} from "./runtime-evidence-http.js";
import type {
  CausalTradeReviewHttpHandler,
} from "./causal-trade-review-http.js";
import type {
  ComparativeTradeReviewHttpHandler,
} from "./comparative-trade-review-http.js";
import type { MultiPaperRuntimeHttpHandler } from "./multi-paper-runtime-http.js";
import type { AgentDefinitionHttpHandler } from "./agent-definition-http.js";
import type { ConnectionHttpHandler } from "./connection-http.js";
import type { StrategyWorkbenchHttpHandler } from "./strategy-workbench-http.js";

const defaultMaxBodyBytes = 1_048_576;

export interface PipelineOrchestrationHttpDependencies {
  registry: ImmutablePipelineRegistry;
  service: PipelineOrchestrationService;
  intentDraftService?: OrchestrationIntentDraftService;
  orchestrationCopilotService?: OrchestrationCopilotService;
  authenticator: PipelineOrchestrationAuthenticator;
  evidenceWorkflow: PipelineEvidenceWorkflow;
  paperPlanService?: ApprovedPaperPlanService;
  paperRuntimeActivationService?: PaperRuntimeActivationService;
  currentCryptoPaperLaunchService?: CurrentCryptoPaperLaunchService;
  runtimeEvidenceHttpHandler?: RuntimeEvidenceHttpHandler;
  causalTradeReviewHttpHandler?: CausalTradeReviewHttpHandler;
  comparativeTradeReviewHttpHandler?: ComparativeTradeReviewHttpHandler;
  paperRuntimeSupervisorService?: PaperRuntimeSupervisorService;
  operationalOutboxDispatcher?: SqliteOperationalOutboxDispatcher;
  operationalOutboxWorker?: DurableOperationalOutboxWorker;
  operationalRetentionService?: SqliteOperationalRetentionService;
  configurationDraftHttpHandler?: ConfigurationDraftHttpHandler;
  strategyEvidenceHttpHandler?: StrategyEvidenceHttpHandler;
  historicalSemanticEvaluationHttpHandler?: HistoricalSemanticEvaluationHttpHandler;
  dataCenterHttpHandler?: DataCenterHttpHandler;
  experimentLabHttpHandler?: ExperimentLabHttpHandler;
  multiPaperRuntimeHttpHandler?: MultiPaperRuntimeHttpHandler;
  agentDefinitionHttpHandler?: AgentDefinitionHttpHandler;
  connectionHttpHandler?: ConnectionHttpHandler;
  strategyWorkbenchHttpHandler?: StrategyWorkbenchHttpHandler;
  productionWorkspaceCatalog?: object;
  pipelineGraphs?: readonly PipelineGraphVersion[];
  maxBodyBytes?: number;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function sendError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  fields: Readonly<Record<string, string>> = {},
): void {
  sendJson(response, statusCode, {
    error: {
      code,
      message,
      fields,
    },
  });
}

async function readJson(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<unknown> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpRequestError(
      415,
      "CONTENT_TYPE_UNSUPPORTED",
      "Content-Type must be application/json.",
    );
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > maxBodyBytes) {
      throw new HttpRequestError(
        413,
        "REQUEST_BODY_TOO_LARGE",
        "JSON request body exceeds the configured limit.",
      );
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpRequestError(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
}

class HttpRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }
}

function paginationRequest(url: URL, kind: "conversations" | "turns") {
  const allowed = new Set(["cursor", "limit"]);
  const fields: Record<string, string> = {};
  for (const [key] of url.searchParams) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) fields[key] = "unsupported_or_duplicate";
  }
  const limit = url.searchParams.get("limit");
  const value = {
    schemaVersion: "1.0.0" as const,
    ...(url.searchParams.has("cursor") ? { cursor: url.searchParams.get("cursor") ?? "" } : {}),
    ...(limit !== null ? { limit: Number(limit) } : {}),
  };
  const schema = kind === "conversations" ? ConversationListRequestSchema : ConversationTurnsRequestSchema;
  const parsed = schema.safeParse(value);
  if (Object.keys(fields).length > 0 || !parsed.success) {
    throw new HttpRequestError(400, "INVALID_CONVERSATION_PAGINATION", "Conversation pagination is invalid.", fields);
  }
  return parsed.data;
}

function registryCatalog(
  registry: ImmutablePipelineRegistry,
  pipelineGraphs: readonly PipelineGraphVersion[],
  productionWorkspaceCatalog?: object,
): object {
  return {
    marketPacks: [...registry.marketPacks.values()],
    dataSources: [...registry.dataSources.values()],
    capabilities: [...registry.capabilities.values()],
    agentTemplates: [...registry.agentTemplates.values()],
    agentConfigs: [...registry.agentConfigs.values()],
    implementationBindings: [...registry.implementationBindings.keys()].map(
      (agentConfigId) => ({ agentConfigId, registered: true }),
    ),
    pipelineGraphs,
    ...(productionWorkspaceCatalog
      ? { productionWorkspace: productionWorkspaceCatalog }
      : {}),
    runtimeMutationAllowed: false,
  };
}

async function readRawBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<string | undefined> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > maxBodyBytes) {
      throw new HttpRequestError(
        413,
        "REQUEST_BODY_TOO_LARGE",
        "Request body exceeds the configured limit.",
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function forwardWebHandler(
  request: IncomingMessage,
  response: ServerResponse,
  handler: { handle(request: Request): Promise<Response> },
  maxBodyBytes: number,
): Promise<void> {
  const headers = new Headers();
  for (const [name, rawValue] of Object.entries(request.headers)) {
    if (Array.isArray(rawValue)) {
      rawValue.forEach((value) => headers.append(name, value));
    } else if (rawValue !== undefined) {
      headers.set(name, rawValue);
    }
  }
  const body = await readRawBody(request, maxBodyBytes);
  const forwarded = new Request(
    new URL(request.url ?? "/", "http://127.0.0.1"),
    {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
    },
  );
  const handled = await handler.handle(forwarded);
  handled.headers.forEach((value, name) => response.setHeader(name, value));
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.statusCode = handled.status;
  response.end(Buffer.from(await handled.arrayBuffer()));
}

function loopbackOrigin(origin: string | undefined): string | undefined {
  if (!origin) {
    return undefined;
  }
  try {
    const url = new URL(origin);
    if (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "[::1]")
    ) {
      return origin;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function createPipelineOrchestrationHttpServer(
  dependencies: PipelineOrchestrationHttpDependencies,
): Server {
  const maxBodyBytes = dependencies.maxBodyBytes ?? defaultMaxBodyBytes;
  return createServer(async (request, response) => {
    try {
      const allowedOrigin = loopbackOrigin(request.headers.origin);
      if (allowedOrigin) {
        response.setHeader("access-control-allow-origin", allowedOrigin);
        response.setHeader("vary", "origin");
      }
      if (request.method === "OPTIONS") {
        if (!allowedOrigin) {
          sendError(
            response,
            403,
            "ORIGIN_NOT_ALLOWED",
            "Only loopback browser origins may access this local API.",
          );
          return;
        }
        response.writeHead(204, {
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
          "access-control-max-age": "600",
        });
        response.end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (dependencies.operationalOutboxDispatcher) {
        const operationalOutboxHandler = createOperationalOutboxHttpHandler({
          dispatcher: dependencies.operationalOutboxDispatcher,
          authenticate: () =>
            dependencies.authenticator.authenticate(
              request.headers.authorization,
            ),
          worker: dependencies.operationalOutboxWorker,
          retentionService: dependencies.operationalRetentionService,
        });
        if (await operationalOutboxHandler(request, response)) {
          return;
        }
      }
      const path = url.pathname;
      if (path.startsWith("/api/orchestration/workbench/")) {
        if (!dependencies.strategyWorkbenchHttpHandler) { sendError(response, 503, "WORKBENCH_NOT_CONFIGURED", "Structured workbench is not configured."); return; }
        await forwardWebHandler(request, response, dependencies.strategyWorkbenchHttpHandler, maxBodyBytes); return;
      }
      if (path.startsWith("/api/orchestration/agents")) {
        if (!dependencies.agentDefinitionHttpHandler) { sendError(response, 503, "AGENT_DEFINITIONS_UNAVAILABLE", "Agent definitions are not configured."); return; }
        await forwardWebHandler(request, response, dependencies.agentDefinitionHttpHandler, maxBodyBytes); return;
      }
      if (path.startsWith("/api/orchestration/connections")) {
        if (!dependencies.connectionHttpHandler) { sendError(response, 503, "CONNECTIONS_UNAVAILABLE", "Connections are not configured."); return; }
        await forwardWebHandler(request, response, dependencies.connectionHttpHandler, maxBodyBytes); return;
      }
      if (path.startsWith("/api/orchestration/paper-deployments")) {
        if (!dependencies.multiPaperRuntimeHttpHandler) {
          sendError(response, 404, "MULTI_PAPER_RUNTIME_UNAVAILABLE", "Multi Paper Runtime is not configured.");
          return;
        }
        await forwardWebHandler(request, response, dependencies.multiPaperRuntimeHttpHandler, maxBodyBytes);
        return;
      }
      if (path.startsWith("/api/orchestration/data-center/")) {
        if (!dependencies.dataCenterHttpHandler) {
          sendError(response, 503, "DATA_CENTER_UNAVAILABLE", "Data Center is not configured.");
          return;
        }
        await forwardWebHandler(request, response, dependencies.dataCenterHttpHandler, maxBodyBytes);
        return;
      }
      if (path.startsWith("/api/orchestration/experiments")) {
        if (!dependencies.experimentLabHttpHandler) { sendError(response, 503, "EXPERIMENT_LAB_UNAVAILABLE", "Registered Graph Evidence scope is required."); return; }
        await forwardWebHandler(request, response, dependencies.experimentLabHttpHandler, maxBodyBytes);
        return;
      }
      if (
        path.startsWith("/api/orchestration/trade-reviews/") ||
        path.startsWith("/api/orchestration/lesson-candidates/")
      ) {
        if (!dependencies.comparativeTradeReviewHttpHandler) {
          sendError(
            response,
            503,
            "COMPARATIVE_TRADE_REVIEW_UNAVAILABLE",
            "Comparative Trade Review is not configured.",
          );
          return;
        }
        dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        await forwardWebHandler(
          request,
          response,
          dependencies.comparativeTradeReviewHttpHandler,
          maxBodyBytes,
        );
        return;
      }
      if (path.startsWith("/api/orchestration/causal-review/")) {
        if (!dependencies.causalTradeReviewHttpHandler) {
          sendError(
            response,
            404,
            "CAUSAL_REVIEW_UNAVAILABLE",
            "Causal Run and Trade Review is not configured.",
          );
          return;
        }
        const result = await dependencies.causalTradeReviewHttpHandler.handle({
          method: request.method ?? "GET",
          url: request.url ?? path,
          ...(request.headers.authorization
            ? { authorization: request.headers.authorization }
            : {}),
        });
        sendJson(response, result.statusCode, result.payload);
        return;
      }
      if (
        path.startsWith("/api/orchestration/configuration/") &&
        dependencies.configurationDraftHttpHandler
      ) {
        await forwardWebHandler(
          request,
          response,
          dependencies.configurationDraftHttpHandler,
          maxBodyBytes,
        );
        return;
      }
      if (path.startsWith("/api/orchestration/strategy-evidence/")) {
        if (!dependencies.strategyEvidenceHttpHandler) {
          sendError(
            response,
            503,
            "STRATEGY_EVIDENCE_NOT_CONFIGURED",
            "Graph evidence datasets, profiles, plans, and a session factory must be registered.",
          );
          return;
        }
        await forwardWebHandler(
          request,
          response,
          dependencies.strategyEvidenceHttpHandler,
          maxBodyBytes,
        );
        return;
      }
      if (path.startsWith("/api/orchestration/semantic-evaluation/")) {
        if (!dependencies.historicalSemanticEvaluationHttpHandler) {
          sendError(response, 503, "HISTORICAL_SEMANTIC_EVALUATION_NOT_CONFIGURED", "Registered Graph Evidence scope is required.");
          return;
        }
        await forwardWebHandler(request, response, dependencies.historicalSemanticEvaluationHttpHandler, maxBodyBytes);
        return;
      }
      const draftMatch = path.match(/^\/api\/orchestration\/drafts\/([^/]+)$/);
      const actionMatch = path.match(
        /^\/api\/orchestration\/drafts\/([^/]+)\/(validate|compile)$/,
      );
      const evidenceJobMatch = path.match(
        /^\/api\/orchestration\/drafts\/([^/]+)\/jobs\/(backtest|walk-forward)$/,
      );
      const approvalMatch = path.match(
        /^\/api\/orchestration\/drafts\/([^/]+)\/approval$/,
      );
      const jobMatch = path.match(
        /^\/api\/orchestration\/jobs\/([^/]+)$/,
      );
      const approvalAuditMatch = path.match(
        /^\/api\/orchestration\/approvals\/([^/]+)$/,
      );
      const paperPlanCreationMatch = path.match(
        /^\/api\/orchestration\/drafts\/([^/]+)\/paper-plan$/,
      );
      const paperPlanMatch = path.match(
        /^\/api\/orchestration\/paper-plans\/([^/]+)$/,
      );
      const paperActivationMatch = path.match(
        /^\/api\/orchestration\/paper-plans\/([^/]+)\/activation$/,
      );
      const paperCloseOnlyMatch = path.match(
        /^\/api\/orchestration\/paper-plans\/([^/]+)\/control\/close-only$/,
      );
      const paperControlMatch = path.match(
        /^\/api\/orchestration\/paper-plans\/([^/]+)\/control$/,
      );
      const paperNormalMatch = path.match(
        /^\/api\/orchestration\/paper-plans\/([^/]+)\/control\/normal$/,
      );
      const paperRunCreationMatch = path.match(
        /^\/api\/orchestration\/paper-plans\/([^/]+)\/runs$/,
      );
      const paperPreflightMatch = path.match(
        /^\/api\/orchestration\/paper-plans\/([^/]+)\/preflight$/,
      );
      const paperRunMatch = path.match(
        /^\/api\/orchestration\/paper-runs\/([^/]+)$/,
      );
      const paperRunCyclesMatch = path.match(
        /^\/api\/orchestration\/paper-runs\/([^/]+)\/cycles$/,
      );
      const paperRunLeaseMatch = path.match(
        /^\/api\/orchestration\/paper-runs\/([^/]+)\/lease$/,
      );
      const paperRunStopMatch = path.match(
        /^\/api\/orchestration\/paper-runs\/([^/]+)\/stop$/,
      );

      if (
        request.method === "GET" &&
        path === "/api/orchestration/paper-runtime/launch-context"
      ) {
        dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        if (!dependencies.currentCryptoPaperLaunchService) {
          sendError(
            response,
            404,
            "PAPER_LAUNCH_PRESET_UNAVAILABLE",
            "Paper Runtime launch context is not configured.",
          );
          return;
        }
        sendJson(response, 200, {
          data:
            dependencies.currentCryptoPaperLaunchService.getContext(),
        });
        return;
      }

      if (
        path === "/api/orchestration/paper-runtime/evidence"
      ) {
        if (!dependencies.runtimeEvidenceHttpHandler) {
          sendError(
            response,
            404,
            "RUNTIME_EVIDENCE_UNAVAILABLE",
            "Runtime evidence read model is not configured.",
          );
          return;
        }
        const result =
          await dependencies.runtimeEvidenceHttpHandler.handle({
            method: request.method ?? "GET",
            url: request.url ?? path,
            ...(request.headers.authorization
              ? { authorization: request.headers.authorization }
              : {}),
          });
        sendJson(response, result.statusCode, result.payload);
        return;
      }

      if (
        request.method === "POST" &&
        path ===
          "/api/orchestration/paper-runtime/presets/current-crypto-fixture/prepare"
      ) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        if (!dependencies.currentCryptoPaperLaunchService) {
          sendError(
            response,
            404,
            "PAPER_LAUNCH_PRESET_UNAVAILABLE",
            "The Current Crypto fixture launch preset is not configured.",
          );
          return;
        }
        sendJson(response, 201, {
          data:
            await dependencies.currentCryptoPaperLaunchService.prepare(
              await readJson(request, maxBodyBytes),
              actor,
            ),
        });
        return;
      }
      const paperRunEventsMatch = path.match(
        /^\/api\/orchestration\/paper-runs\/([^/]+)\/events$/,
      );
      const paperRunIncidentsMatch = path.match(
        /^\/api\/orchestration\/paper-runs\/([^/]+)\/incidents$/,
      );
      const paperIncidentAcknowledgementMatch = path.match(
        /^\/api\/orchestration\/paper-incidents\/([^/]+)\/acknowledgement$/,
      );
      const paperOrphanClearanceMatch = path.match(
        /^\/api\/orchestration\/paper-runs\/([^/]+)\/orphan-clearance$/,
      );
      const paperPlanService = dependencies.paperPlanService;
      if (
        (paperPlanCreationMatch ||
          paperPlanMatch ||
          paperActivationMatch ||
          paperCloseOnlyMatch ||
          paperNormalMatch ||
          paperControlMatch) &&
        !paperPlanService
      ) {
        sendError(
          response,
          404,
          "ROUTE_NOT_FOUND",
          "Paper Plan orchestration is not configured.",
        );
        return;
      }
      const paperRuntimeSupervisorService =
        dependencies.paperRuntimeSupervisorService;
      if (
        (paperRunEventsMatch ||
          paperRunIncidentsMatch ||
          paperIncidentAcknowledgementMatch ||
          paperOrphanClearanceMatch) &&
        !paperRuntimeSupervisorService
      ) {
        sendError(
          response,
          404,
          "ROUTE_NOT_FOUND",
          "Paper Runtime supervision is not configured.",
        );
        return;
      }
      const paperRuntimeActivationService =
        dependencies.paperRuntimeActivationService;
      if (
        (paperRunCreationMatch ||
          paperPreflightMatch ||
          paperRunMatch ||
          paperRunCyclesMatch ||
          paperRunLeaseMatch ||
          paperRunStopMatch) &&
        !paperRuntimeActivationService
      ) {
        sendError(
          response,
          404,
          "ROUTE_NOT_FOUND",
          "Paper Runtime activation is not configured.",
        );
        return;
      }

      if (request.method === "GET" && path === "/api/orchestration/catalog") {
        sendJson(response, 200, {
          data: registryCatalog(
            dependencies.registry,
            dependencies.pipelineGraphs ?? [],
            dependencies.productionWorkspaceCatalog,
          ),
        });
        return;
      }

      if (request.method === "GET" && path === "/api/orchestration/session") {
        sendJson(response, 200, {
          data: {
            actor: dependencies.authenticator.authenticate(
              request.headers.authorization,
            ),
          },
        });
        return;
      }

      if (
        request.method === "GET" &&
        path === "/api/orchestration/intent-catalog"
      ) {
        if (!dependencies.intentDraftService) {
          sendError(
            response,
            404,
            "INTENT_COMPILER_NOT_CONFIGURED",
            "The controlled Orchestration Intent Compiler is not configured.",
          );
          return;
        }
        sendJson(response, 200, {
          data: dependencies.intentDraftService.catalog(),
        });
        return;
      }

      if (
        request.method === "POST" &&
        path === "/api/orchestration/drafts/from-intent"
      ) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        if (!dependencies.intentDraftService) {
          sendError(
            response,
            404,
            "INTENT_COMPILER_NOT_CONFIGURED",
            "The controlled Orchestration Intent Compiler is not configured.",
          );
          return;
        }
        const intent = await readJson(request, maxBodyBytes);
        sendJson(response, 201, {
          data: dependencies.intentDraftService.createDraft(intent),
        });
        return;
      }

      if (
        request.method === "POST" &&
        path === "/api/orchestration/copilot/messages"
      ) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        if (!dependencies.orchestrationCopilotService) {
          sendError(
            response,
            404,
            "ORCHESTRATION_COPILOT_NOT_CONFIGURED",
            "The controlled Orchestration Copilot is not configured.",
          );
          return;
        }
        const message = await readJson(request, maxBodyBytes);
        const copilotResponse = await dependencies.orchestrationCopilotService.handle(message, actor);
        const { toolCalls, toolResults, ...browserResponse } = copilotResponse;
        sendJson(response, 200, {
          data: {
            ...browserResponse,
            toolActivity: projectToolActivity(toolCalls, toolResults),
          },
        });
        return;
      }

      const conversationMatch = path.match(/^\/api\/orchestration\/conversations\/([^/]+)$/);
      const turnsMatch = path.match(/^\/api\/orchestration\/conversations\/([^/]+)\/turns$/);
      if (path === "/api/orchestration/conversations" || conversationMatch || turnsMatch) {
        if (request.method !== "GET") {
          sendError(response, 405, "METHOD_NOT_ALLOWED", "Conversation history is read-only.");
          return;
        }
        const actor = dependencies.authenticator.authenticate(request.headers.authorization);
        if (!dependencies.orchestrationCopilotService) {
          sendError(response, 404, "ORCHESTRATION_COPILOT_NOT_CONFIGURED", "The controlled Orchestration Copilot is not configured.");
          return;
        }
        if (path === "/api/orchestration/conversations") {
          sendJson(response, 200, { data: dependencies.orchestrationCopilotService.listConversations(actor.actorId, paginationRequest(url, "conversations")) });
          return;
        }
        let rawConversationId: string;
        try {
          rawConversationId = decodeURIComponent((turnsMatch ?? conversationMatch)![1]);
        } catch {
          throw new HttpRequestError(400, "INVALID_CONVERSATION_ID", "Conversation id is invalid.");
        }
        const parsedId = ConversationIdSchema.safeParse({ schemaVersion: "1.0.0", conversationId: rawConversationId });
        if (!parsedId.success) throw new HttpRequestError(400, "INVALID_CONVERSATION_ID", "Conversation id is invalid.");
        if (!dependencies.orchestrationCopilotService.getConversation(actor.actorId, parsedId.data.conversationId)) {
          sendError(response, 404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
          return;
        }
        if (turnsMatch) {
          sendJson(response, 200, { data: dependencies.orchestrationCopilotService.listTurns(actor.actorId, parsedId.data.conversationId, paginationRequest(url, "turns")) });
          return;
        }
        sendJson(response, 200, { data: dependencies.orchestrationCopilotService.getConversation(actor.actorId, parsedId.data.conversationId) });
        return;
      }

      if (request.method === "POST" && path === "/api/orchestration/drafts") {
        dependencies.authenticator.authenticate(request.headers.authorization);
        const graph = await readJson(request, maxBodyBytes);
        sendJson(response, 201, {
          data: dependencies.service.createDraft(graph),
        });
        return;
      }

      if (request.method === "GET" && draftMatch) {
        dependencies.authenticator.authenticate(request.headers.authorization);
        const draftId = decodeURIComponent(draftMatch[1]);
        sendJson(response, 200, {
          data: dependencies.service.getDraft(draftId),
        });
        return;
      }

      if (request.method === "POST" && actionMatch) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        const draftId = decodeURIComponent(actionMatch[1]);
        const action = actionMatch[2];
        if (action === "validate") {
          sendJson(response, 200, {
            data: dependencies.evidenceWorkflow.validateContract(
              draftId,
              actor,
            ),
          });
          return;
        }
        if (action === "compile") {
          sendJson(response, 200, {
            data: dependencies.service.compileDraft(draftId),
          });
          return;
        }
      }

      if (request.method === "POST" && evidenceJobMatch) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        const draftId = decodeURIComponent(evidenceJobMatch[1]);
        const kind =
          evidenceJobMatch[2] === "backtest" ? "backtest" : "walk_forward";
        const body = await readJson(request, maxBodyBytes);
        sendJson(response, 201, {
          data: await dependencies.evidenceWorkflow.runEvidenceJob(
            draftId,
            kind,
            body,
            actor,
          ),
        });
        return;
      }

      if (request.method === "GET" && jobMatch) {
        dependencies.authenticator.authenticate(request.headers.authorization);
        sendJson(response, 200, {
          data: dependencies.evidenceWorkflow.getJob(
            decodeURIComponent(jobMatch[1]),
          ),
        });
        return;
      }

      if (request.method === "POST" && approvalMatch) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        const body = await readJson(request, maxBodyBytes);
        sendJson(response, 201, {
          data: dependencies.evidenceWorkflow.approve(
            decodeURIComponent(approvalMatch[1]),
            body,
            actor,
          ),
        });
        return;
      }

      if (request.method === "GET" && approvalAuditMatch) {
        dependencies.authenticator.authenticate(request.headers.authorization);
        sendJson(response, 200, {
          data: dependencies.evidenceWorkflow.getApproval(
            decodeURIComponent(approvalAuditMatch[1]),
          ),
        });
        return;
      }

      if (request.method === "POST" && paperPlanCreationMatch) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        const body = await readJson(request, maxBodyBytes);
        sendJson(response, 201, {
          data: paperPlanService!.createPlan(
            decodeURIComponent(paperPlanCreationMatch[1]),
            body,
            actor,
          ),
        });
        return;
      }

      if (request.method === "GET" && paperPlanMatch) {
        dependencies.authenticator.authenticate(request.headers.authorization);
        sendJson(response, 200, {
          data: paperPlanService!.getPlan(
            decodeURIComponent(paperPlanMatch[1]),
          ),
        });
        return;
      }

      if (request.method === "POST" && paperActivationMatch) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        const body = await readJson(request, maxBodyBytes);
        sendJson(response, 201, {
          data: paperPlanService!.activate(
            decodeURIComponent(paperActivationMatch[1]),
            body,
            actor,
          ),
        });
        return;
      }

      if (request.method === "GET" && paperActivationMatch) {
        dependencies.authenticator.authenticate(request.headers.authorization);
        sendJson(response, 200, {
          data: paperPlanService!.getActivation(
            decodeURIComponent(paperActivationMatch[1]),
          ),
        });
        return;
      }

      if (request.method === "POST" && paperCloseOnlyMatch) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        const body = await readJson(request, maxBodyBytes);
        sendJson(response, 201, {
          data: paperPlanService!.recordCloseOnly(
            decodeURIComponent(paperCloseOnlyMatch[1]),
            body,
            actor,
          ),
        });
        return;
      }

      if (request.method === "POST" && paperNormalMatch) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        const body = await readJson(request, maxBodyBytes);
        sendJson(response, 201, {
          data: paperPlanService!.recordNormal(
            decodeURIComponent(paperNormalMatch[1]),
            body,
            actor,
          ),
        });
        return;
      }

      if (request.method === "GET" && paperControlMatch) {
        dependencies.authenticator.authenticate(request.headers.authorization);
        sendJson(response, 200, {
          data: paperPlanService!.getCurrentControl(
            decodeURIComponent(paperControlMatch[1]),
          ),
        });
        return;
      }

      if (request.method === "POST" && paperRunCreationMatch) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        const body = await readJson(request, maxBodyBytes);
        sendJson(response, 202, {
          data: paperRuntimeActivationService!.startRun(
            decodeURIComponent(paperRunCreationMatch[1]),
            body,
            actor,
          ),
        });
        return;
      }

      if (request.method === "POST" && paperPreflightMatch) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        const body = await readJson(request, maxBodyBytes);
        sendJson(response, 201, {
          data: await paperRuntimeActivationService!.runPreflight(
            decodeURIComponent(paperPreflightMatch[1]),
            body,
            actor,
          ),
        });
        return;
      }

      if (request.method === "GET" && paperPreflightMatch) {
        dependencies.authenticator.authenticate(request.headers.authorization);
        sendJson(response, 200, {
          data: paperRuntimeActivationService!.getLatestPreflight(
            decodeURIComponent(paperPreflightMatch[1]),
          ),
        });
        return;
      }

      if (request.method === "GET" && paperRunMatch) {
        dependencies.authenticator.authenticate(request.headers.authorization);
        sendJson(response, 200, {
          data: paperRuntimeActivationService!.getRun(
            decodeURIComponent(paperRunMatch[1]),
          ),
        });
        return;
      }

      if (request.method === "GET" && paperRunCyclesMatch) {
        dependencies.authenticator.authenticate(request.headers.authorization);
        sendJson(response, 200, {
          data: paperRuntimeActivationService!.getCycles(
            decodeURIComponent(paperRunCyclesMatch[1]),
          ),
        });
        return;
      }

      if (request.method === "GET" && paperRunLeaseMatch) {
        dependencies.authenticator.authenticate(request.headers.authorization);
        sendJson(response, 200, {
          data: paperRuntimeActivationService!.getLease(
            decodeURIComponent(paperRunLeaseMatch[1]),
          ),
        });
        return;
      }

      if (request.method === "POST" && paperRunStopMatch) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        const body = await readJson(request, maxBodyBytes);
        sendJson(response, 202, {
          data: paperRuntimeActivationService!.requestStop(
            decodeURIComponent(paperRunStopMatch[1]),
            body,
            actor,
          ),
        });
        return;
      }

      if (request.method === "GET" && paperRunStopMatch) {
        dependencies.authenticator.authenticate(request.headers.authorization);
        sendJson(response, 200, {
          data: paperRuntimeActivationService!.getStop(
            decodeURIComponent(paperRunStopMatch[1]),
          ),
        });
        return;
      }

      if (request.method === "GET" && paperRunEventsMatch) {
        dependencies.authenticator.authenticate(request.headers.authorization);
        sendJson(response, 200, {
          data: paperRuntimeSupervisorService!.listEvents(
            decodeURIComponent(paperRunEventsMatch[1]),
            {
              afterSequence:
                url.searchParams.get("afterSequence") ?? undefined,
              limit: url.searchParams.get("limit") ?? undefined,
            },
          ),
        });
        return;
      }

      if (request.method === "GET" && paperRunIncidentsMatch) {
        dependencies.authenticator.authenticate(request.headers.authorization);
        sendJson(response, 200, {
          data: paperRuntimeSupervisorService!.listIncidents(
            decodeURIComponent(paperRunIncidentsMatch[1]),
          ),
        });
        return;
      }

      if (
        request.method === "POST" &&
        paperIncidentAcknowledgementMatch
      ) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        const body = await readJson(request, maxBodyBytes);
        sendJson(response, 201, {
          data: paperRuntimeSupervisorService!.acknowledge(
            decodeURIComponent(paperIncidentAcknowledgementMatch[1]),
            body,
            actor,
          ),
        });
        return;
      }

      if (request.method === "POST" && paperOrphanClearanceMatch) {
        const actor = dependencies.authenticator.authenticate(
          request.headers.authorization,
        );
        const body = await readJson(request, maxBodyBytes);
        sendJson(response, 201, {
          data: paperRuntimeSupervisorService!.clearOrphan(
            decodeURIComponent(paperOrphanClearanceMatch[1]),
            body,
            actor,
          ),
        });
        return;
      }

      if (request.method === "GET" && paperOrphanClearanceMatch) {
        dependencies.authenticator.authenticate(request.headers.authorization);
        sendJson(response, 200, {
          data: paperRuntimeSupervisorService!.getClearance(
            decodeURIComponent(paperOrphanClearanceMatch[1]),
          ),
        });
        return;
      }

      sendError(response, 404, "ROUTE_NOT_FOUND", "Orchestration route was not found.");
    } catch (error) {
      if (error instanceof HttpRequestError) {
        sendError(
          response,
          error.statusCode,
          error.code,
          error.message,
          error.fields,
        );
        return;
      }
      if (error instanceof ConversationReplayReadError) {
        sendError(response, 400, error.code, "Conversation history request is invalid.");
        return;
      }
      if (error instanceof PipelineAuthenticationError) {
        sendError(response, 401, error.code, error.message);
        return;
      }
      if (error instanceof OrchestrationIntentError) {
        const statusCode =
          error.code === "SEMANTIC_PRESET_NOT_REGISTERED" ||
          error.code === "PRESET_GRAPH_BINDING_NOT_REGISTERED" ||
          error.code === "MARKET_PACK_NOT_REGISTERED" ||
          error.code === "DATA_SOURCE_NOT_REGISTERED" ||
          error.code === "AGENT_TEMPLATE_NOT_REGISTERED"
            ? 404
            : error.code === "INVALID_ORCHESTRATION_INTENT"
              ? 400
              : 422;
        sendError(response, statusCode, error.code, error.message, error.fields);
        return;
      }
      if (error instanceof OrchestrationCopilotError) {
        sendError(response, 400, error.code, error.message, error.fields);
        return;
      }
      if (error instanceof PipelineEvidenceWorkflowError) {
        const statusCode =
          error.code === "EVIDENCE_JOB_NOT_FOUND" ||
          error.code === "APPROVAL_NOT_FOUND"
            ? 404
            : error.code === "ACTOR_ROLE_REQUIRED"
              ? 403
              : error.code === "EVIDENCE_RECORD_CONFLICT"
                ? 409
                : 422;
        sendError(response, statusCode, error.code, error.message, error.fields);
        return;
      }
      if (error instanceof ApprovedPaperPlanError) {
        const statusCode =
          error.code === "PAPER_PLAN_NOT_FOUND" ||
          error.code === "PAPER_PLAN_NOT_ACTIVATED"
            ? 404
            : error.code === "PAPER_ACTOR_ROLE_REQUIRED"
              ? 403
              : error.code === "PAPER_PLAN_CONFLICT" ||
                  error.code === "PAPER_PLAN_ALREADY_ACTIVATED"
                ? 409
                : 422;
        sendError(response, statusCode, error.code, error.message, error.fields);
        return;
      }
      if (error instanceof CurrentCryptoPaperLaunchError) {
        const statusCode =
          error.code === "PAPER_LAUNCH_ACTOR_ROLE_REQUIRED"
            ? 403
            : error.code === "PAPER_LAUNCH_PRESET_UNAVAILABLE"
              ? 404
              : 422;
        sendError(
          response,
          statusCode,
          error.code,
          error.message,
          error.fields,
        );
        return;
      }
      if (error instanceof PaperRuntimeActivationError) {
        const statusCode =
          error.code === "PAPER_RUNTIME_RUN_NOT_FOUND" ||
          error.code === "PAPER_RUNTIME_BINDING_NOT_FOUND" ||
          error.code === "PAPER_RUNTIME_STOP_NOT_FOUND"
            ? 404
            : error.code === "PAPER_RUNTIME_ACTOR_ROLE_REQUIRED"
              ? 403
              : error.code === "PAPER_RUNTIME_RUN_IN_PROGRESS" ||
                  error.code === "PAPER_RUNTIME_RUN_CONFLICT" ||
                  error.code === "PAPER_RUNTIME_LEASE_CONFLICT" ||
                  error.code === "PAPER_RUNTIME_LEASE_LOST"
                ? 409
                : 422;
        sendError(response, statusCode, error.code, error.message, error.fields);
        return;
      }
      if (error instanceof PaperRuntimeSupervisorError) {
        const statusCode =
          error.code === "PAPER_RUNTIME_INCIDENT_NOT_FOUND"
            ? 404
            : error.code ===
                "PAPER_RUNTIME_SUPERVISOR_ACTOR_ROLE_REQUIRED"
              ? 403
              : error.code === "PAPER_RUNTIME_INCIDENT_CONFLICT"
                ? 409
                : 422;
        sendError(
          response,
          statusCode,
          error.code,
          error.message,
          error.fields,
        );
        return;
      }
      if (error instanceof PipelineOrchestrationError) {
        const statusCode =
          error.code === "PIPELINE_DRAFT_NOT_FOUND"
            ? 404
            : error.code === "PIPELINE_VERSION_CONFLICT"
              ? 409
              : 422;
        sendError(response, statusCode, error.code, error.message, error.fields);
        return;
      }
      sendError(
        response,
        500,
        "INTERNAL_ORCHESTRATION_ERROR",
        "Unexpected orchestration error.",
      );
    }
  });
}
import { createOperationalOutboxHttpHandler } from "./operational-outbox-http.js";
import type { SqliteOperationalOutboxDispatcher } from "./sqlite-operational-outbox-dispatcher.js";
import type { DurableOperationalOutboxWorker } from "./operational-outbox-worker.js";
import type { SqliteOperationalRetentionService } from "./sqlite-operational-retention.js";
