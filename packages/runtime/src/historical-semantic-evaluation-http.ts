import { z } from "zod";

import type { HistoricalSemanticEvaluationService } from "../../core/src/historical-semantic-evaluation-service.js";
import type { PipelineOrchestrationAuthenticator } from "./pipeline-orchestration-auth.js";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

export class HistoricalSemanticEvaluationHttpHandler {
  constructor(
    private readonly service: HistoricalSemanticEvaluationService,
    private readonly authenticator: PipelineOrchestrationAuthenticator,
  ) {}

  async handle(request: Request): Promise<Response> {
    try {
      const actor = this.authenticator.authenticate(request.headers.get("authorization") ?? undefined);
      const url = new URL(request.url);
      if (request.method !== "POST" || url.pathname !== "/api/orchestration/semantic-evaluation/actions") {
        return json({ code: "ROUTE_NOT_FOUND", path: url.pathname }, 404);
      }
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > 64 * 1024) return json({ code: "REQUEST_BODY_TOO_LARGE" }, 413);
      return json(await this.service.execute(text ? JSON.parse(text) : {}, actor), 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return json({ code: "REQUEST_CONTRACT_INVALID", issues: error.issues.map((issue) => ({ path: issue.path, code: issue.code })) }, 400);
      }
      const code = error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : error instanceof Error ? error.message : "HISTORICAL_SEMANTIC_EVALUATION_FAILED";
      const status = code.startsWith("AUTHORIZATION_") ? 401 : code.includes("ACTOR_ROLE_REQUIRED") ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("CONFLICT") ? 409 : 400;
      return json({ code }, status);
    }
  }
}
