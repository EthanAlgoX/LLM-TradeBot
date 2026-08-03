import { z } from "zod";
import type { PipelineOrchestrationAuthenticator } from "./pipeline-orchestration-auth.js";
import { StrategyWorkbenchError, type StrategyWorkbenchService } from "./strategy-workbench-service.js";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
export class StrategyWorkbenchHttpHandler {
  constructor(private readonly service: StrategyWorkbenchService, private readonly authenticator: PipelineOrchestrationAuthenticator) {}
  async handle(request: Request): Promise<Response> {
    try { const actor = this.authenticator.authenticate(request.headers.get("authorization") ?? undefined); const path = new URL(request.url).pathname;
      if (request.method === "POST" && path === "/api/orchestration/workbench/turns") return json({ data: this.service.recommend(actor.actorId, await request.json()) }, 201);
      if (request.method === "POST" && path === "/api/orchestration/workbench/apply") return json({ data: this.service.apply(actor.actorId, await request.json()) }, 201);
      if (request.method === "GET" && path === "/api/orchestration/workbench/conversations") return json({ data: this.service.listConversations(actor.actorId, Object.fromEntries(new URL(request.url).searchParams.entries())) });
      const history = path.match(/^\/api\/orchestration\/workbench\/conversations\/([^/]+)$/u);
      if (request.method === "GET" && history) return json({ data: this.service.history(actor.actorId, decodeURIComponent(history[1]!)), runtimeApplied: false, paperOnly: true, exchangeWriteAllowed: false });
      const turns = path.match(/^\/api\/orchestration\/workbench\/conversations\/([^/]+)\/turns$/u);
      if (request.method === "GET" && turns) return json({ data: this.service.listTurns(actor.actorId, decodeURIComponent(turns[1]!), Object.fromEntries(new URL(request.url).searchParams.entries())) });
      return json({ error: { code: "ROUTE_NOT_FOUND" } }, 404);
    } catch (error) { const code = error instanceof StrategyWorkbenchError ? error.code : error instanceof z.ZodError ? "REQUEST_CONTRACT_INVALID" : "WORKBENCH_REQUEST_FAILED"; return json({ error: { code } }, code.includes("STALE") || code.includes("DRIFT") ? 409 : code === "PUBLISHED_CATALOG_INSUFFICIENT" ? 422 : 400); }
  }
}
