import { z } from "zod";
import {
  AgentRuntimeConfigSchema,
  ReflectionReportSchema,
  type AgentRuntimeConfig,
  type PolicyAdjustment,
  type ReflectionReport,
} from "../../contracts/src/index.js";
import type { ReflectionAgent, ReflectionInput } from "../../core/src/ports.js";
import type { StructuredLlmPort } from "./llm-directional-case-agents.js";

const LlmReflectionEnhancementSchema = z.object({
  recommendations: z.array(z.string().min(1)).max(5),
  adjustments: z.array(z.object({
    scope: z.enum(["entry_confidence_min", "leverage_cap", "symbol_cooldown"]),
    value: z.number().nonnegative(),
    reason: z.string().min(1),
  })).max(3),
});

export interface LlmReflectionConfig {
  readonly provider: string;
  readonly model: string;
  readonly adjustmentDurationMs?: number;
}

/** Rule report is authoritative; DeepSeek can only add bounded, non-executing suggestions. */
export class LlmReflectionAgent implements ReflectionAgent {
  readonly name = "llm_reflection_agent";
  readonly version = "v1";
  private readonly runtime: AgentRuntimeConfig;
  private readonly adjustmentDurationMs: number;

  constructor(
    private readonly baseline: ReflectionAgent,
    private readonly port: StructuredLlmPort | undefined,
    runtime: AgentRuntimeConfig,
    private readonly config: LlmReflectionConfig,
  ) {
    this.runtime = AgentRuntimeConfigSchema.parse(runtime);
    this.adjustmentDurationMs = config.adjustmentDurationMs ?? 12 * 60 * 60 * 1_000;
  }

  async run(input: ReflectionInput): Promise<ReflectionReport | undefined> {
    const baseline = await this.baseline.run(input);
    if (!baseline) return undefined;
    if (!this.runtime.llm.reflectionEnabled || !this.port) {
      return ReflectionReportSchema.parse({ ...baseline, llmAudit: { provider: this.config.provider, model: this.config.model, fallbackUsed: true, errorCategory: "disabled" } });
    }
    try {
      const output = await withTimeout(this.port.complete({
        systemPrompt: "You are a trading-system reviewer. Return json only. Use only the supplied closed trades and rule reflection. You may add concise process recommendations and bounded policy suggestions. Never propose an order, symbol trade, position change, risk-limit override, or executable action.",
        userPrompt: JSON.stringify({ asOf: input.asOf.toISOString(), closedTrades: input.trades, ruleReflection: baseline }),
        responseSchemaName: "LlmReflectionEnhancement",
        responseSchema: LlmReflectionEnhancementSchema,
      }), this.runtime.llm.timeoutMs);
      const enhancement = LlmReflectionEnhancementSchema.parse(output);
      return ReflectionReportSchema.parse({
        ...baseline,
        recommendations: [...new Set([...baseline.recommendations, ...enhancement.recommendations])],
        adjustments: [...baseline.adjustments, ...enhancement.adjustments.map((adjustment) => this.bound(adjustment, input.asOf))],
        llmAudit: { provider: this.config.provider, model: this.config.model, fallbackUsed: false },
      });
    } catch (error) {
      return ReflectionReportSchema.parse({ ...baseline, llmAudit: { provider: this.config.provider, model: this.config.model, fallbackUsed: true, errorCategory: category(error) } });
    }
  }

  private bound(adjustment: z.infer<typeof LlmReflectionEnhancementSchema>["adjustments"][number], asOf: Date): PolicyAdjustment {
    const maxValue = adjustment.scope === "entry_confidence_min" ? 20 : adjustment.scope === "leverage_cap" ? 1.5 : 86_400_000;
    if (adjustment.value > maxValue) throw new Error("invalid_output: adjustment exceeds bounded scope");
    return { ...adjustment, maxValue, expiresAt: new Date(asOf.getTime() + this.adjustmentDurationMs) };
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function category(error: unknown): "timeout" | "api_error" | "invalid_output" {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("timeout")) return "timeout";
  if (message.includes("API error")) return "api_error";
  return "invalid_output";
}
