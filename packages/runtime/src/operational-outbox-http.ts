import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import {
  OperationalDeadLetterReplayRequestSchema,
  OperationalDispatchRequestSchema,
  OperationalRetentionExecutionRequestSchema,
  OperationalRetentionPreviewRequestSchema,
} from "../../contracts/src/index.js";
import {
  OperationalOutboxDispatcherError,
  type OperationalDispatcherActor,
  type SqliteOperationalOutboxDispatcher,
} from "./sqlite-operational-outbox-dispatcher.js";
import type { DurableOperationalOutboxWorker } from "./operational-outbox-worker.js";
import {
  OperationalRetentionError,
  type SqliteOperationalRetentionService,
} from "./sqlite-operational-retention.js";

export interface OperationalOutboxHttpDependencies {
  dispatcher: SqliteOperationalOutboxDispatcher;
  authenticate(
    request: IncomingMessage,
  ): Promise<OperationalDispatcherActor | null> | OperationalDispatcherActor | null;
  worker?: DurableOperationalOutboxWorker;
  retentionService?: SqliteOperationalRetentionService;
}

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) {
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length === 0 ? {} : JSON.parse(text);
};

const ownerIdForActor = (actorId: string): string =>
  `dispatcher-owner:${createHash("sha256")
    .update(actorId)
    .digest("hex")
    .slice(0, 24)}`;

const statusForDispatcherError = (
  error: OperationalOutboxDispatcherError,
): number => {
  if (error.code === "DELIVERY_REPLAY_FORBIDDEN") {
    return 403;
  }
  if (
    error.code === "DELIVERY_DEAD_LETTER_NOT_FOUND" ||
    error.code === "DELIVERY_TEMPLATE_NOT_FOUND"
  ) {
    return 404;
  }
  if (
    error.code === "DISPATCHER_LEASE_HELD" ||
    error.code === "DISPATCHER_FENCED" ||
    error.code === "DELIVERY_DEAD_LETTER_NOT_REPLAYABLE"
  ) {
    return 409;
  }
  return 422;
};

const statusForRetentionError = (error: OperationalRetentionError): number => {
  if (error.code === "RETENTION_OPERATOR_REQUIRED") {
    return 403;
  }
  if (error.code === "RETENTION_MANIFEST_NOT_FOUND") {
    return 404;
  }
  if (
    error.code === "RETENTION_CANDIDATE_DRIFT" ||
    error.code === "RETENTION_EXECUTION_CONFLICT"
  ) {
    return 409;
  }
  return 422;
};

export const createOperationalOutboxHttpHandler = (
  dependencies: OperationalOutboxHttpDependencies,
): ((
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>) => {
  return async (request, response): Promise<boolean> => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const isBase = url.pathname === "/api/orchestration/operational-outbox";
    const replayMatch = url.pathname.match(
      /^\/api\/orchestration\/operational-outbox\/dead-letters\/([a-z0-9._:-]+)\/replay$/,
    );
    const isRetentionPreview =
      url.pathname ===
      "/api/orchestration/operational-outbox/retention/previews";
    const retentionExecutionMatch = url.pathname.match(
      /^\/api\/orchestration\/operational-outbox\/retention\/manifests\/([a-z0-9._:-]+)\/execute$/,
    );
    const isDispatch =
      url.pathname === "/api/orchestration/operational-outbox/dispatch";
    if (
      !isBase &&
      !replayMatch &&
      !isDispatch &&
      !isRetentionPreview &&
      !retentionExecutionMatch
    ) {
      return false;
    }
    try {
      const actor = await dependencies.authenticate(request);
      if (!actor) {
        sendJson(response, 401, {
          error: { code: "AUTHENTICATION_REQUIRED" },
        });
        return true;
      }
      if (request.method === "GET" && isBase) {
        sendJson(response, 200, {
          state: dependencies.dispatcher.getState(),
          templates: dependencies.dispatcher.listTemplates(),
          attempts: dependencies.dispatcher.listAttempts(100),
          deadLetters: dependencies.dispatcher.listDeadLetters(100),
          externalChannels: {
            slack: "not_configured",
            email: "not_configured",
            webhook: "not_configured",
          },
          worker: dependencies.worker?.getState() ?? null,
          retention: dependencies.retentionService?.getStatus() ?? null,
        });
        return true;
      }
      if (!actor.roles.includes("operator")) {
        sendJson(response, 403, {
          error: { code: "OPERATOR_ROLE_REQUIRED" },
        });
        return true;
      }
      if (request.method === "POST" && isDispatch) {
        OperationalDispatchRequestSchema.parse(await readJsonBody(request));
        const result = await dependencies.dispatcher.dispatchAvailable(
          ownerIdForActor(actor.actorId),
        );
        sendJson(response, 200, result);
        return true;
      }
      if (request.method === "POST" && replayMatch) {
        const requestBody = OperationalDeadLetterReplayRequestSchema.parse(
          await readJsonBody(request),
        );
        const attempt = dependencies.dispatcher.replayDeadLetter(
          replayMatch[1]!,
          requestBody,
          actor,
        );
        sendJson(response, 200, { attempt });
        return true;
      }
      if (
        request.method === "POST" &&
        isRetentionPreview &&
        dependencies.retentionService
      ) {
        const requestBody = OperationalRetentionPreviewRequestSchema.parse(
          await readJsonBody(request),
        );
        const result = dependencies.retentionService.createPreview(
          requestBody,
          actor,
        );
        sendJson(response, 201, result);
        return true;
      }
      if (
        request.method === "POST" &&
        retentionExecutionMatch &&
        dependencies.retentionService
      ) {
        const requestBody = OperationalRetentionExecutionRequestSchema.parse(
          await readJsonBody(request),
        );
        if (requestBody.manifestId !== retentionExecutionMatch[1]) {
          sendJson(response, 422, {
            error: { code: "RETENTION_MANIFEST_PATH_MISMATCH" },
          });
          return true;
        }
        const execution = dependencies.retentionService.execute(
          requestBody,
          actor,
        );
        sendJson(response, 200, { execution });
        return true;
      }
      sendJson(response, 405, {
        error: { code: "METHOD_NOT_ALLOWED" },
      });
      return true;
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 422, {
          error: { code: "INVALID_OPERATIONAL_OUTBOX_REQUEST" },
        });
        return true;
      }
      if (error instanceof OperationalOutboxDispatcherError) {
        sendJson(response, statusForDispatcherError(error), {
          error: { code: error.code },
        });
        return true;
      }
      if (error instanceof OperationalRetentionError) {
        sendJson(response, statusForRetentionError(error), {
          error: { code: error.code },
        });
        return true;
      }
      sendJson(response, 500, {
        error: { code: "OPERATIONAL_OUTBOX_FAILED" },
      });
      return true;
    }
  };
};
