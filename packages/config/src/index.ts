import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { StrategyProfileOverrideSchema, StrategyProfileSchema, type StrategyProfile, type StrategyProfileOverride } from "../../contracts/src/index.js";
import { ExperimentParametersSchema, ParameterGridSchema, type ExperimentParameters, type ParameterGrid } from "../../contracts/src/index.js";
import { ProfileInspectionSchema, RunManifestSchema, SCHEMA_VERSION, type ProfileInspection, type RunManifest } from "../../contracts/src/index.js";
export type { StrategyProfile, StrategyProfileOverride } from "../../contracts/src/index.js";

export const DEFAULT_STRATEGY_PROFILE: StrategyProfile = StrategyProfileSchema.parse({
  profileId: "rule-multi-agent", profileVersion: "v1",
  selector: { topN: 1, minQuoteVolume24h: 5_000_000, minPrice: 0.05, minTrendStrength: 20, minVolatilityPct: 0.2, maxVolatilityPct: 12 },
  dataQuality: { minBars5m: 50, minBars15m: 50, minBars1h: 50, requireAlignment: true, maxQuoteAgeMs: 900_000 },
  decision: { perTradeNotional: 1_000, leverage: 1.5, minimumConfidence: 60 },
  risk: { maxLeverage: 1.5, maxNotional: 3_333 },
  accountRisk: { maxOpenPositions: 1, maxUsedMarginPct: 50, maxOrderNotional: 1_000 },
  execution: { initialCash: 10_000, feeBps: 3, slippageBps: 1, maxExecutionsPerCycle: 1 },
  llm: { enabled: false, timeoutMs: 15_000, fallbackToRules: true },
});

function merge<T>(base: T, patch: unknown): T {
  if (Array.isArray(base) || typeof base !== "object" || base === null || typeof patch !== "object" || patch === null || Array.isArray(patch)) return (patch === undefined ? base : patch) as T;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) result[key] = merge(result[key], value);
  return result as T;
}

export function resolveStrategyProfile(override: StrategyProfileOverride = {}): StrategyProfile {
  return StrategyProfileSchema.parse(merge(DEFAULT_STRATEGY_PROFILE, StrategyProfileOverrideSchema.parse(override)));
}

export async function loadStrategyProfile(path?: string): Promise<StrategyProfile> {
  if (!path) return DEFAULT_STRATEGY_PROFILE;
  let raw: unknown;
  try { raw = JSON.parse(await readFile(path, "utf8")) as unknown; }
  catch (error) { throw new Error(`cannot load strategy profile ${path}: ${error instanceof Error ? error.message : String(error)}`); }
  return resolveStrategyProfile(StrategyProfileOverrideSchema.parse(raw));
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** SHA-256 of the resolved profile, not its source filename. */
export function strategyProfileFingerprint(profile: StrategyProfile): string {
  return createHash("sha256").update(stable(StrategyProfileSchema.parse(profile))).digest("hex").slice(0, 16);
}

/** Only these numeric knobs are safe to optimize without changing risk ownership or runtime mode. */
export const OPTIMIZABLE_PARAMETER_NAMES = ["initialCash", "feeBps", "slippageBps", "perTradeNotional", "minQuoteVolume", "minPrice", "minTrendStrength", "maxVolatilityPct"] as const;

export function validateOptimizationParameters(raw: unknown): ExperimentParameters {
  const parameters = ExperimentParametersSchema.parse(raw);
  for (const [name, value] of Object.entries(parameters)) {
    if (!(OPTIMIZABLE_PARAMETER_NAMES as readonly string[]).includes(name)) throw new Error(`parameter ${name} is not allowed for optimization`);
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`optimization parameter ${name} must be a finite number`);
  }
  return parameters;
}

export function validateOptimizationGrid(raw: unknown): ParameterGrid {
  const grid = ParameterGridSchema.parse(raw);
  for (const [name, values] of Object.entries(grid)) {
    if (!(OPTIMIZABLE_PARAMETER_NAMES as readonly string[]).includes(name)) throw new Error(`parameter ${name} is not allowed for optimization`);
    if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error(`optimization parameter ${name} must contain only finite numbers`);
  }
  return grid;
}

export function experimentBaseFromProfile(profile: StrategyProfile): Record<string, number> {
  return { initialCash: profile.execution.initialCash, feeBps: profile.execution.feeBps, slippageBps: profile.execution.slippageBps, perTradeNotional: profile.decision.perTradeNotional, minQuoteVolume: profile.selector.minQuoteVolume24h, minPrice: profile.selector.minPrice, minTrendStrength: profile.selector.minTrendStrength, maxVolatilityPct: profile.selector.maxVolatilityPct };
}

export async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export function createRunManifest(input: Omit<RunManifest, "schemaVersion">): RunManifest {
  return RunManifestSchema.parse({ schemaVersion: SCHEMA_VERSION, ...input });
}

/** Pure, read-only report shared by CLI/TUI before any market or persistence adapter is opened. */
export function inspectStrategyProfile(profile: StrategyProfile, llmExplicitlyAuthorized: boolean): ProfileInspection {
  const warning = profile.llm.enabled && !llmExplicitlyAuthorized ? "profile enables LLM, but --llm deepseek was not explicitly authorized" : undefined;
  const risk = profile.accountRisk;
  return ProfileInspectionSchema.parse({
    profile, fingerprint: strategyProfileFingerprint(profile),
    llm: { enabled: profile.llm.enabled, explicitlyAuthorized: llmExplicitlyAuthorized, warning },
    riskGuards: { maxOpenPositions: risk.maxOpenPositions, maxUsedMarginPct: risk.maxUsedMarginPct, maxOrderNotional: risk.maxOrderNotional, maxCumulativeRealizedLoss: risk.maxCumulativeRealizedLoss ?? null, maxEquityLossPct: risk.maxEquityLossPct ?? null },
    warnings: warning ? [warning] : [],
  });
}
