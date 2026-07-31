import { z } from "zod";
import {
  CausalReviewOpaqueIdSchema,
  CausalReviewPageRequestSchema,
} from "../../contracts/src/index.js";
import type {
  PipelineOrchestrationAuthenticator,
} from "./pipeline-orchestration-auth.js";
import {
  CausalTradeReviewError,
  type CausalTradeReviewReadModelService,
} from "./causal-trade-review-read-model.js";

export interface CausalTradeReviewHttpRequest {
  method: string;
  url: string;
  authorization?: string;
}

export interface CausalTradeReviewHttpResponse {
  statusCode: number;
  payload: unknown;
}

function error(statusCode: number, code: string, message: string) {
  return {
    statusCode,
    payload: { error: { code, message } },
  };
}

function decodeId(raw: string): string {
  return CausalReviewOpaqueIdSchema.parse(decodeURIComponent(raw));
}

export class CausalTradeReviewHttpHandler {
  constructor(
    private readonly authenticator: PipelineOrchestrationAuthenticator,
    private readonly reader: CausalTradeReviewReadModelService,
  ) {}

  async handle(
    request: CausalTradeReviewHttpRequest,
  ): Promise<CausalTradeReviewHttpResponse> {
    this.authenticator.authenticate(request.authorization);
    if (request.method !== "GET") {
      return error(
        405,
        "CAUSAL_REVIEW_READ_ONLY",
        "Causal Run and Trade Review is read-only.",
      );
    }
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const duplicateKeys = [...new Set(url.searchParams.keys())]
        .filter((key) => url.searchParams.getAll(key).length > 1);
      if (duplicateKeys.length > 0) {
        return error(
          400,
          "CAUSAL_REVIEW_QUERY_REJECTED",
          "Duplicate query selectors are not allowed.",
        );
      }
      const latestMatch = url.pathname.match(
        /^\/api\/orchestration\/causal-review\/runs\/latest$/,
      );
      const runMatch = url.pathname.match(
        /^\/api\/orchestration\/causal-review\/runs\/([^/]+)$/,
      );
      const cycleMatch = url.pathname.match(
        /^\/api\/orchestration\/causal-review\/runs\/([^/]+)\/cycles\/(\d+)$/,
      );
      const tradeMatch = url.pathname.match(
        /^\/api\/orchestration\/causal-review\/runs\/([^/]+)\/cycles\/(\d+)\/trades\/([^/]+)$/,
      );
      if (latestMatch || runMatch) {
        const rawQuery = Object.fromEntries(url.searchParams.entries());
        const page = CausalReviewPageRequestSchema.parse({
          schemaVersion: "1.0.0",
          ...(rawQuery.cursor ? { cursor: rawQuery.cursor } : {}),
          ...(rawQuery.limit
            ? { limit: Number(rawQuery.limit) }
            : {}),
          ...Object.fromEntries(
            Object.entries(rawQuery).filter(
              ([key]) => key !== "cursor" && key !== "limit",
            ),
          ),
        });
        const data = await this.reader.readRun({
          ...(runMatch && !latestMatch
            ? { runId: decodeId(runMatch[1]!) }
            : {}),
          page,
        });
        return { statusCode: 200, payload: { data } };
      }
      if (cycleMatch || tradeMatch) {
        if (url.searchParams.size > 0) {
          return error(
            400,
            "CAUSAL_REVIEW_QUERY_REJECTED",
            "Cycle and trade routes do not accept query selectors.",
          );
        }
        const match = tradeMatch ?? cycleMatch!;
        const runId = decodeId(match[1]!);
        const cycle = Number(match[2]);
        if (!Number.isSafeInteger(cycle) || cycle < 1) {
          return error(
            400,
            "CAUSAL_REVIEW_PATH_REJECTED",
            "Cycle must be a positive integer.",
          );
        }
        const data = await this.reader.readRun({
          runId,
          cycle,
          ...(tradeMatch ? { tradeRef: decodeId(tradeMatch[3]!) } : {}),
        });
        return { statusCode: 200, payload: { data } };
      }
      return error(
        404,
        "CAUSAL_REVIEW_ROUTE_NOT_FOUND",
        "The causal review route is not registered.",
      );
    } catch (caught) {
      if (caught instanceof CausalTradeReviewError) {
        return error(
          caught.code === "CAUSAL_REVIEW_CURSOR_INVALID" ? 400 : 404,
          caught.code,
          caught.message,
        );
      }
      if (caught instanceof z.ZodError || caught instanceof URIError) {
        return error(
          400,
          "CAUSAL_REVIEW_QUERY_REJECTED",
          "Only registered opaque IDs, server cursors, and bounded limits are accepted.",
        );
      }
      throw caught;
    }
  }
}
