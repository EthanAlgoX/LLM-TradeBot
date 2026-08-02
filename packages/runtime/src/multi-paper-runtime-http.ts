import type { PipelineOrchestrationAuthenticator } from "./pipeline-orchestration-auth.js";
import { MultiPaperDeploymentService, MultiPaperRuntimeError, SqliteMultiPaperDeploymentRepository } from "./multi-paper-runtime.js";
import { ShadowPromotionError, ShadowPromotionService } from "./shadow-promotion.js";

const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const error = (code: string, status = 400) => response({ error: { code } }, status);

export class MultiPaperRuntimeHttpHandler {
  constructor(
    private readonly authenticate: PipelineOrchestrationAuthenticator,
    private readonly service: MultiPaperDeploymentService,
    private readonly repository: SqliteMultiPaperDeploymentRepository,
    private readonly shadows?: ShadowPromotionService,
  ) {}
  async handle(request: Request): Promise<Response> {
    let actor; try { actor = this.authenticate.authenticate(request.headers.get("authorization") ?? undefined); } catch { return error("UNAUTHENTICATED", 401); }
    const url = new URL(request.url); const path = url.pathname;
    const match = path.match(/^\/api\/orchestration\/paper-deployments\/([^/]+)(?:\/(preflight|start|stop|archive))?$/);
    const projection = path.match(/^\/api\/orchestration\/paper-deployments\/([^/]+)\/(runs|cycles|trades|artifacts)$/);
    const shadow = path.match(/^\/api\/orchestration\/paper-deployments\/([^/]+)\/shadows$/);
    try {
      if (request.method === "GET" && path === "/api/orchestration/paper-deployments") return response({ data: this.repository.list(actor.actorId, Number(url.searchParams.get("limit") ?? 50)) });
      if (request.method === "POST" && path === "/api/orchestration/paper-deployments") return response({ data: this.service.create(actor.actorId, await request.json()) }, 201);
      if (projection && request.method === "GET") {
        const kind = projection[2]!.slice(0, -1) as "run"|"cycle"|"trade"|"artifact";
        return response(this.repository.projections(actor.actorId, decodeURIComponent(projection[1]!), kind, Number(url.searchParams.get("limit") ?? 50), url.searchParams.get("cursor") ?? undefined));
      }
      if (shadow && request.method === "GET") {
        if (!this.shadows) return error("SHADOW_PROMOTION_UNAVAILABLE", 503);
        return response(this.shadows.list(actor.actorId, decodeURIComponent(shadow[1]!), Number(url.searchParams.get("limit") ?? 20), url.searchParams.get("cursor") ?? undefined));
      }
      if (shadow && request.method === "POST") {
        if (!this.shadows) return error("SHADOW_PROMOTION_UNAVAILABLE", 503);
        return response({ data: this.shadows.observe(actor.actorId, decodeURIComponent(shadow[1]!), await request.json()) }, 201);
      }
      if (match && request.method === "GET" && !match[2]) return response({ data: this.repository.get(actor.actorId, decodeURIComponent(match[1]!)) });
      if (match && request.method === "POST" && match[2]) {
        const deploymentId = decodeURIComponent(match[1]!); const action = match[2] as "preflight"|"start"|"stop"|"archive"; const body = await request.json();
        return response({ data: action === "preflight" ? await this.service.preflight(actor.actorId, deploymentId, body) : this.service.action(actor.actorId, deploymentId, action, body) });
      }
      return error(match || projection || shadow ? "METHOD_NOT_ALLOWED" : "ROUTE_NOT_FOUND", match || projection || shadow ? 405 : 404);
    } catch (cause) {
      if (cause instanceof URIError) return error("DEPLOYMENT_ID_INVALID");
      if (cause instanceof MultiPaperRuntimeError) return error(cause.code, cause.code === "DEPLOYMENT_NOT_FOUND" ? 404 : 409);
      if (cause instanceof ShadowPromotionError) return error(cause.code, cause.code === "SHADOW_NOT_FOUND" ? 404 : 409);
      return error("MULTI_PAPER_REQUEST_INVALID");
    }
  }
}
