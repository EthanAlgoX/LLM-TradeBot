import { z } from "zod";
import { AgentCategorySchema } from "../../contracts/src/index.js";
import { AgentDefinitionError, type AgentDefinitionService } from "./agent-definition-service.js";
import type { PipelineOrchestrationAuthenticator } from "./pipeline-orchestration-auth.js";
const key = z.string().min(8).max(200).regex(/^[A-Za-z0-9:_-]+$/);
const createSchema = z.object({ category: AgentCategorySchema, payload: z.unknown(), idempotencyKey: key }).strict();
const versionSchema = z.object({ parentVersionId: z.string().min(1), parentFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/), payload: z.unknown(), idempotencyKey: key }).strict();
const authoritySchema = z.object({ versionId: z.string().min(1), fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict();
const cloneSchema = authoritySchema.extend({ idempotencyKey: key }).strict();
const testSchema = authoritySchema.extend({ fixtureRef: z.string().min(1) }).strict();
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
      if (request.method === "GET" && path === "/api/orchestration/agent-catalog") { const category = url.searchParams.get("category"); if ([...url.searchParams.keys()].some((item) => item !== "category")) throw new AgentDefinitionError("QUERY_INVALID"); return response({ data: this.service.catalog(actor.actorId, category ? AgentCategorySchema.parse(category) : undefined), runtimeApplied: false, exchangeWriteAllowed: false }); }
      const versions = path.match(/^\/api\/orchestration\/agents\/([^/]+)\/versions$/u); const one = path.match(/^\/api\/orchestration\/agents\/([^/]+)$/u);
      const transition = path.match(/^\/api\/orchestration\/agents\/([^/]+)\/(validate|publish|archive)$/u); const clone = path.match(/^\/api\/orchestration\/agents\/([^/]+)\/clone$/u); const diff = path.match(/^\/api\/orchestration\/agents\/([^/]+)\/diff$/u); const test = path.match(/^\/api\/orchestration\/agents\/([^/]+)\/test$/u); const evidence = path.match(/^\/api\/orchestration\/agents\/([^/]+)\/versions\/([^/]+)\/evidence$/u);
      if (transition && request.method === "POST") { const body = authoritySchema.parse(await request.json()); return response({ data: this.service.transition(actor.actorId, decodeURIComponent(transition[1]!), { ...body, action: transition[2]! as "validate" | "publish" | "archive" }) }); }
      if (clone && request.method === "POST") { const body = cloneSchema.parse(await request.json()); return response({ data: this.service.clone(actor.actorId, decodeURIComponent(clone[1]!), body) }, 201); }
      if (diff && request.method === "GET") { const left = url.searchParams.get("leftVersionId"); const right = url.searchParams.get("rightVersionId"); if (!left || !right || [...url.searchParams.keys()].some((item) => !["leftVersionId", "rightVersionId"].includes(item))) throw new AgentDefinitionError("QUERY_INVALID"); return response({ data: this.service.diff(actor.actorId, decodeURIComponent(diff[1]!), left, right) }); }
      if (test && request.method === "POST") { const body = testSchema.parse(await request.json()); return response({ data: this.service.test(actor.actorId, decodeURIComponent(test[1]!), body) }, 201); }
      if (evidence && request.method === "GET") return response({ data: this.service.evidence(actor.actorId, decodeURIComponent(evidence[1]!), decodeURIComponent(evidence[2]!)) });
      if (versions) { const definitionId = decodeURIComponent(versions[1]!); if (request.method === "GET") { const keys = [...url.searchParams.keys()]; const limit = Number(url.searchParams.get("limit") ?? 20); if (keys.some((key) => !["limit", "cursor"].includes(key)) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new AgentDefinitionError("QUERY_INVALID"); return response(this.service.versions(actor.actorId, definitionId, limit, url.searchParams.get("cursor") ?? undefined)); } if (request.method === "POST") { const body = versionSchema.parse(await request.json()); return response({ data: this.service.createVersion(actor.actorId, definitionId, { ...body, payload: body.payload ?? null }) }, 201); } }
      if (one && request.method === "GET") return response({ data: this.service.get(actor.actorId, decodeURIComponent(one[1]!)) });
      return response({ error: { code: "ROUTE_NOT_FOUND" } }, 404);
    } catch (error) {
      const code = error instanceof AgentDefinitionError ? error.code : error instanceof z.ZodError ? "REQUEST_CONTRACT_INVALID" : error instanceof Error ? error.message : "AGENT_REQUEST_FAILED";
      const status = code.includes("CONFLICT") ? 409 : code.startsWith("AUTHORIZATION_") ? 401 : 400; return response({ error: { code } }, status);
    }
  }
}
