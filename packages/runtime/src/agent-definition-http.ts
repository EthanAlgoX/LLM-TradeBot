import { z } from "zod";
import { AgentCategorySchema } from "../../contracts/src/index.js";
import { AgentDefinitionError, type AgentDefinitionService } from "./agent-definition-service.js";
import type { PipelineOrchestrationAuthenticator } from "./pipeline-orchestration-auth.js";
const key = z.string().min(8).max(200).regex(/^[A-Za-z0-9:_-]+$/);
const createSchema = z.object({ category: AgentCategorySchema, payload: z.unknown(), idempotencyKey: key }).strict();
const versionSchema = z.object({ parentVersionId: z.string().min(1), parentFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/), payload: z.unknown(), idempotencyKey: key }).strict();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
export class AgentDefinitionHttpHandler {
  constructor(private readonly service: AgentDefinitionService, private readonly authenticator: PipelineOrchestrationAuthenticator) {}
  async handle(request: Request): Promise<Response> {
    try {
      const actor = this.authenticator.authenticate(request.headers.get("authorization") ?? undefined); const url = new URL(request.url); const path = url.pathname;
      if (request.method === "GET" && path === "/api/orchestration/agents") {
        const keys = [...url.searchParams.keys()]; if (keys.some((key) => !["category", "limit", "cursor"].includes(key)) || url.searchParams.getAll("category").length > 1 || url.searchParams.getAll("limit").length > 1 || url.searchParams.getAll("cursor").length > 1) throw new AgentDefinitionError("QUERY_INVALID");
        const category = url.searchParams.get("category"); const limit = Number(url.searchParams.get("limit") ?? 20); if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new AgentDefinitionError("QUERY_INVALID"); return response({ ...this.service.list(actor.actorId, category ? AgentCategorySchema.parse(category) : undefined, limit, url.searchParams.get("cursor") ?? undefined), runtimeApplied: false, exchangeWriteAllowed: false });
      }
      if (request.method === "POST" && path === "/api/orchestration/agents") { const body = createSchema.parse(await request.json()); return response({ data: this.service.create(actor.actorId, body.category, body.payload, body.idempotencyKey) }, 201); }
      const versions = path.match(/^\/api\/orchestration\/agents\/([^/]+)\/versions$/u); const one = path.match(/^\/api\/orchestration\/agents\/([^/]+)$/u);
      if (versions) { const definitionId = decodeURIComponent(versions[1]!); if (request.method === "GET") { const keys = [...url.searchParams.keys()]; const limit = Number(url.searchParams.get("limit") ?? 20); if (keys.some((key) => !["limit", "cursor"].includes(key)) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new AgentDefinitionError("QUERY_INVALID"); return response(this.service.versions(actor.actorId, definitionId, limit, url.searchParams.get("cursor") ?? undefined)); } if (request.method === "POST") { const body = versionSchema.parse(await request.json()); return response({ data: this.service.createVersion(actor.actorId, definitionId, { ...body, payload: body.payload ?? null }) }, 201); } }
      if (one && request.method === "GET") return response({ data: this.service.get(actor.actorId, decodeURIComponent(one[1]!)) });
      return response({ error: { code: "ROUTE_NOT_FOUND" } }, 404);
    } catch (error) {
      const code = error instanceof AgentDefinitionError ? error.code : error instanceof z.ZodError ? "REQUEST_CONTRACT_INVALID" : error instanceof Error ? error.message : "AGENT_REQUEST_FAILED";
      const status = code.includes("CONFLICT") ? 409 : code.startsWith("AUTHORIZATION_") ? 401 : 400; return response({ error: { code } }, status);
    }
  }
}
