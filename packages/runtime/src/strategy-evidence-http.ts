import { z } from "zod";

import type { StrategyEvidenceApprovalService } from "../../core/src/strategy-evidence-approval-service.js";
import type { PipelineOrchestrationAuthenticator } from "./pipeline-orchestration-auth.js";

const MAX_BODY_BYTES = 64 * 1024;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readStrictJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error("REQUEST_BODY_TOO_LARGE");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new Error("REQUEST_BODY_TOO_LARGE");
  }
  return text.length === 0 ? {} : JSON.parse(text);
}

function errorCode(error: unknown): string {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return error instanceof Error ? error.message : "STRATEGY_EVIDENCE_REQUEST_FAILED";
}

export class StrategyEvidenceHttpHandler {
  constructor(
    private readonly service: StrategyEvidenceApprovalService,
    private readonly authenticator: PipelineOrchestrationAuthenticator,
  ) {}

  async handle(request: Request): Promise<Response> {
    try {
      const actor = this.authenticator.authenticate(
        request.headers.get("authorization") ?? undefined,
      );
      const url = new URL(request.url);
      const segments = url.pathname.split("/").filter(Boolean);
      if (
        request.method === "POST" &&
        url.pathname === "/api/orchestration/strategy-evidence/bindings"
      ) {
        return json(this.service.createBinding(await readStrictJson(request), actor), 201);
      }
      if (
        segments.length >= 5 &&
        segments[0] === "api" &&
        segments[1] === "orchestration" &&
        segments[2] === "strategy-evidence" &&
        segments[3] === "bindings"
      ) {
        const bindingId = decodeURIComponent(segments[4] ?? "");
        if (segments.length === 5 && request.method === "GET") {
          return json(this.service.get(bindingId));
        }
        const action = segments[5];
        if (segments.length === 6 && request.method === "POST" && action === "backtest") {
          return json(
            await this.service.runBacktest(bindingId, await readStrictJson(request), actor),
          );
        }
        if (
          segments.length === 6 &&
          request.method === "POST" &&
          action === "walk-forward"
        ) {
          return json(
            await this.service.runWalkForward(
              bindingId,
              await readStrictJson(request),
              actor,
            ),
          );
        }
        if (segments.length === 6 && request.method === "POST" && action === "approve") {
          return json(
            this.service.approve(bindingId, await readStrictJson(request), actor),
            201,
          );
        }
      }
      return json({ code: "ROUTE_NOT_FOUND", path: url.pathname }, 404);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return json(
          {
            code: "REQUEST_CONTRACT_INVALID",
            issues: error.issues.map((issue) => ({
              path: issue.path,
              code: issue.code,
            })),
          },
          400,
        );
      }
      const code = errorCode(error);
      const status = code.startsWith("AUTHORIZATION_")
        ? 401
        : code.includes("ACTOR_ROLE_REQUIRED")
          ? 403
          : code.includes("NOT_FOUND")
            ? 404
            : code.includes("CONFLICT")
              ? 409
              : 400;
      return json({ code }, status);
    }
  }
}
