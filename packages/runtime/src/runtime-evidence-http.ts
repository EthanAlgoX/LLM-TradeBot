import type {
  PipelineOrchestrationAuthenticator,
} from "./pipeline-orchestration-auth.js";
import type {
  RuntimeEvidenceDashboard,
} from "../../contracts/src/index.js";

export interface RuntimeEvidenceReader {
  read(): Promise<RuntimeEvidenceDashboard>;
}

export interface RuntimeEvidenceHttpResult {
  statusCode: number;
  payload: unknown;
}

export class RuntimeEvidenceHttpHandler {
  constructor(
    private readonly authenticator: PipelineOrchestrationAuthenticator,
    private readonly reader: RuntimeEvidenceReader,
  ) {}

  async handle(input: {
    method: string;
    url: string;
    authorization?: string;
  }): Promise<RuntimeEvidenceHttpResult> {
    this.authenticator.authenticate(input.authorization);
    const url = new URL(input.url, "http://127.0.0.1");
    if ([...url.searchParams].length > 0) {
      return {
        statusCode: 400,
        payload: {
          error: {
            code: "RUNTIME_EVIDENCE_SELECTORS_FORBIDDEN",
            message:
              "Runtime evidence selectors are server-owned; query parameters are not accepted.",
            fields: {
              selectorCount: String([...url.searchParams].length),
            },
          },
        },
      };
    }
    if (input.method !== "GET") {
      return {
        statusCode: 405,
        payload: {
          error: {
            code: "RUNTIME_EVIDENCE_METHOD_NOT_ALLOWED",
            message: "Runtime evidence is exposed through read-only GET.",
            fields: { method: input.method },
          },
        },
      };
    }
    return {
      statusCode: 200,
      payload: { data: await this.reader.read() },
    };
  }
}
