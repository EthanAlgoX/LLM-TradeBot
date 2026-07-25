import { z } from "zod";
import {
  AgentRuntimeConfigSchema,
  DirectionalCaseSchema,
  type Agent,
  type AgentRuntimeConfig,
  type AnalysisBundle,
  type DirectionalCase,
} from "../../contracts/src/index.js";
import { RuleBearCaseAgent, RuleBullCaseAgent } from "./rule-decision-agents.js";

export interface StructuredLlmRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly responseSchemaName: string;
  readonly responseSchema: z.ZodType<unknown>;
}

/** Provider-neutral port. Concrete model clients belong in adapters, not Agent logic. */
export interface StructuredLlmPort { complete(request: StructuredLlmRequest): Promise<unknown>; }

class LlmDirectionalCaseAgent implements Agent<AnalysisBundle, DirectionalCase> {
  readonly version = "v1";
  readonly name: string;
  private readonly enabled: boolean;
  private readonly timeoutMs: number;
  private readonly fallbackToRules: boolean;

  constructor(private readonly side: "long" | "short", private readonly port: StructuredLlmPort | undefined, config: AgentRuntimeConfig, private readonly fallback: Agent<AnalysisBundle, DirectionalCase>) {
    const normalized = AgentRuntimeConfigSchema.parse(config);
    this.name = side === "long" ? "llm_bull_case_agent" : "llm_bear_case_agent";
    this.enabled = side === "long" ? normalized.llm.bullCaseEnabled : normalized.llm.bearCaseEnabled;
    this.timeoutMs = normalized.llm.timeoutMs;
    this.fallbackToRules = normalized.llm.fallbackToRules;
  }

  async run(analysis: AnalysisBundle): Promise<DirectionalCase> {
    if (!this.enabled || !this.port) return this.fallback.run(analysis);
    try {
      const output = await withTimeout(this.port.complete({
        systemPrompt: this.systemPrompt(),
        userPrompt: JSON.stringify({ symbol: analysis.symbol, asOf: analysis.asOf.toISOString(), analysis }),
        responseSchemaName: "DirectionalCase",
        responseSchema: DirectionalCaseSchema,
      }), this.timeoutMs);
      const candidate = DirectionalCaseSchema.parse(output);
      if (candidate.side !== this.side) throw new Error(`LLM returned ${candidate.side} for ${this.side} case`);
      if (candidate.symbol !== analysis.symbol || candidate.traceId !== analysis.traceId) throw new Error("LLM response does not match the source analysis");
      return candidate;
    } catch (error) {
      if (this.fallbackToRules) return this.fallback.run(analysis);
      throw error;
    }
  }

  private systemPrompt(): string {
    const role = this.side === "long" ? "BULLISH" : "BEARISH";
    return `You are a ${role} market analyst. Use only the supplied structured analysis. Return JSON matching DirectionalCase exactly. Provide evidence and invalidation conditions. Do not emit an order, a trade action, a price target, or prose outside the JSON.`;
  }
}

export class LlmBullCaseAgent extends LlmDirectionalCaseAgent {
  constructor(port: StructuredLlmPort | undefined, config: AgentRuntimeConfig) { super("long", port, config, new RuleBullCaseAgent()); }
}

export class LlmBearCaseAgent extends LlmDirectionalCaseAgent {
  constructor(port: StructuredLlmPort | undefined, config: AgentRuntimeConfig) { super("short", port, config, new RuleBearCaseAgent()); }
}

export interface DirectionalCaseAgentSet { readonly bullCase: Agent<AnalysisBundle, DirectionalCase>; readonly bearCase: Agent<AnalysisBundle, DirectionalCase>; }
export function createDirectionalCaseAgents(config: AgentRuntimeConfig, port?: StructuredLlmPort): DirectionalCaseAgentSet {
  return { bullCase: new LlmBullCaseAgent(port, config), bearCase: new LlmBearCaseAgent(port, config) };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`LLM timeout after ${timeoutMs}ms`)), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
