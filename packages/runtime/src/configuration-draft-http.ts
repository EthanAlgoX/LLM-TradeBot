import { z } from "zod";
import type { ConfigurationDraftService } from "../../core/src/configuration-draft-service.js";
import type {
  ExecutableStrategyConfigurationService,
} from "../../core/src/executable-strategy-configuration-service.js";
import type { ConfigurableSemanticPipelineService } from "../../core/src/configurable-semantic-pipeline-service.js";
import type { ConfigurableSemanticPipelineExecutionService } from "../../core/src/configurable-semantic-pipeline-execution-service.js";
import type { PipelineOrchestrationAuthenticator } from "./pipeline-orchestration-auth.js";

const MAX_BODY_BYTES = 64 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readStrictJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new Error("REQUEST_BODY_TOO_LARGE");
  return text.length === 0 ? {} : JSON.parse(text);
}

export class ConfigurationDraftHttpHandler {
  constructor(
    private readonly service: ConfigurationDraftService,
    private readonly authenticator: PipelineOrchestrationAuthenticator,
    private readonly executableStrategies?: ExecutableStrategyConfigurationService,
    private readonly semanticPipeline?: ConfigurableSemanticPipelineService,
    private readonly semanticPipelineExecution?: ConfigurableSemanticPipelineExecutionService,
  ) {}

  async handle(request: Request): Promise<Response> {
    try {
      const actor = this.authenticator.authenticate(request.headers.get("authorization") ?? undefined);
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "GET" && path === "/api/orchestration/configuration/catalog") {
        return json(this.service.getCatalog());
      }
      if (request.method === "POST" && path === "/api/orchestration/configuration/drafts") {
        return json(this.service.create(await readStrictJson(request), actor.actorId), 201);
      }
      if (request.method === "POST" && path === "/api/orchestration/configuration/semantic-pipeline/preview") {
        if (!this.semanticPipeline) return json({ code: "SEMANTIC_PIPELINE_NOT_CONFIGURED" }, 503);
        return json(this.semanticPipeline.preview(await readStrictJson(request), actor.actorId));
      }
      if (request.method === "POST" && path === "/api/orchestration/configuration/semantic-pipeline/execute") {
        if (!this.semanticPipelineExecution) return json({ code: "SEMANTIC_PIPELINE_EXECUTION_NOT_CONFIGURED" }, 503);
        return json(await this.semanticPipelineExecution.execute(await readStrictJson(request), actor.actorId), 201);
      }

      const materializeMatch = path.match(
        /^\/api\/orchestration\/configuration\/strategies\/([^/]+)\/materialize$/u,
      );
      if (request.method === "POST" && materializeMatch) {
        const body = await readStrictJson(request);
        z.object({ schemaVersion: z.literal("1.0.0") })
          .strict()
          .parse(body);
        if (!this.executableStrategies) {
          return json(
            { code: "EXECUTABLE_STRATEGY_NOT_CONFIGURED" },
            503,
          );
        }
        return json(
          this.executableStrategies.materialize(
            decodeURIComponent(materializeMatch[1]!),
            actor.actorId,
          ),
          201,
        );
      }

      const createVersionMatch = path.match(/^\/api\/orchestration\/configuration\/drafts\/([^/]+)\/versions$/u);
      if (request.method === "POST" && createVersionMatch) {
        return json(
          this.service.createVersion(
            decodeURIComponent(createVersionMatch[1]!),
            await readStrictJson(request),
            actor.actorId,
          ),
          201,
        );
      }

      const versionActionMatch = path.match(
        /^\/api\/orchestration\/configuration\/drafts\/([^/]+)\/versions\/([^/]+)(?:\/(validate|compile))?$/u,
      );
      if (versionActionMatch) {
        const versionId = decodeURIComponent(versionActionMatch[2]!);
        const action = versionActionMatch[3];
        if (request.method === "GET" && !action) return json(this.service.get(versionId));
        if (request.method === "POST" && action === "validate") {
          const body = await readStrictJson(request);
          z.object({ schemaVersion: z.literal("1.0.0") }).strict().parse(body);
          return json(this.service.validate(versionId));
        }
        if (request.method === "POST" && action === "compile") {
          const body = await readStrictJson(request);
          z.object({ schemaVersion: z.literal("1.0.0") }).strict().parse(body);
          return json(this.service.compileHistorical(versionId));
        }
      }
      return json({ code: "ROUTE_NOT_FOUND", path }, 404);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return json({ code: "REQUEST_CONTRACT_INVALID", issues: error.issues.map((item) => ({ path: item.path, code: item.code })) }, 400);
      }
      const code =
        error instanceof Error &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : error instanceof Error
            ? error.message
            : "CONFIGURATION_REQUEST_FAILED";
      const status = code.startsWith("AUTHORIZATION_") ? 401 : code.includes("CONFLICT") ? 409 : 400;
      return json({ code }, status);
    }
  }
}
