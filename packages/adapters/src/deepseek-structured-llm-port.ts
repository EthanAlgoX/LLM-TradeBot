import process from "node:process";
import type { StructuredLlmPort, StructuredLlmRequest } from "../../agents/src/llm-directional-case-agents.js";

export interface JsonHttpResponse { readonly status: number; readonly body: unknown; }
export interface JsonHttpPostTransport { post(url: string, headers: Readonly<Record<string, string>>, body: unknown): Promise<JsonHttpResponse>; }

export class FetchJsonHttpPostTransport implements JsonHttpPostTransport {
  constructor(private readonly timeoutMs = 15_000) {}

  async post(url: string, headers: Readonly<Record<string, string>>, body: unknown): Promise<JsonHttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
      return { status: response.status, body: await response.json() as unknown };
    } finally { clearTimeout(timer); }
  }
}

export class DeepSeekApiError extends Error {
  constructor(readonly status: number, readonly payload: unknown) {
    super(`DeepSeek API error: status=${status}`);
    this.name = "DeepSeekApiError";
  }
}

export interface DeepSeekStructuredLlmConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
}

/** DeepSeek's OpenAI-compatible JSON-mode adapter. It has no order or exchange capability. */
export class DeepSeekStructuredLlmClient implements StructuredLlmPort {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  readonly provider = "deepseek";

  constructor(private readonly config: DeepSeekStructuredLlmConfig, private readonly transport: JsonHttpPostTransport = new FetchJsonHttpPostTransport(config.timeoutMs)) {
    if (!config.apiKey.trim()) throw new Error("DeepSeek apiKey must not be empty");
    this.baseUrl = (config.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.model = config.model ?? "deepseek-v4-flash";
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 1_000;
  }

  async complete(request: StructuredLlmRequest): Promise<unknown> {
    const response = await this.transport.post(`${this.baseUrl}/chat/completions`, {
      "Authorization": `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
    }, {
      model: this.model,
      messages: [
        { role: "system", content: `${request.systemPrompt}\nReturn valid json only.` },
        { role: "user", content: request.userPrompt },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: false,
      response_format: { type: "json_object" },
    });
    if (response.status < 200 || response.status >= 300) throw new DeepSeekApiError(response.status, response.body);
    const content = (response.body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new DeepSeekApiError(response.status, response.body);
    try { return JSON.parse(content) as unknown; }
    catch { throw new Error("DeepSeek returned invalid JSON despite JSON mode"); }
  }

  get modelName(): string { return this.model; }

}

export function createDeepSeekStructuredLlmFromEnv(environment: NodeJS.ProcessEnv = process.env): DeepSeekStructuredLlmClient | undefined {
  const apiKey = environment.DEEPSEEK_API_KEY;
  if (!apiKey) return undefined;
  return new DeepSeekStructuredLlmClient({
    apiKey,
    baseUrl: environment.DEEPSEEK_BASE_URL,
    model: environment.DEEPSEEK_MODEL,
    temperature: numberFromEnv(environment.DEEPSEEK_TEMPERATURE),
    maxTokens: integerFromEnv(environment.DEEPSEEK_MAX_TOKENS),
    timeoutMs: integerFromEnv(environment.DEEPSEEK_TIMEOUT_MS),
  });
}

function numberFromEnv(value: string | undefined): number | undefined {
  const parsed = value === undefined ? undefined : Number(value);
  return parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
}

function integerFromEnv(value: string | undefined): number | undefined {
  const parsed = numberFromEnv(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
