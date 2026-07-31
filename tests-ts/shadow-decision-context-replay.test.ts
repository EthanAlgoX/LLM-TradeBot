import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SQLiteAgentArtifactLedger } from "../packages/adapters/src/sqlite-agent-artifact-ledger.js";
import { DecisionSemanticContextSchema, ReflectionLessonCandidateSchema, type AgentArtifact } from "../packages/contracts/src/index.js";
import { ArtifactLedgerShadowDecisionContextBaseAdapter } from "../packages/runtime/src/artifact-ledger-shadow-decision-context.js";
import type { ArtifactLedger } from "../packages/core/src/ports.js";

const at = new Date("2026-07-31T09:00:00.000Z");
const fp = (value: unknown): `sha256:${string}` => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const marketPackRef = { id: "market-pack:crypto:v1", version: "1.0.0", fingerprint: `sha256:${"1".repeat(64)}` as const };
const dataSourceRef = { id: "data-source:fixture:v1", version: "1.0.0", fingerprint: `sha256:${"2".repeat(64)}` as const };
const traceId = "trace:shadow:entry";
const decisionId = "artifact:shadow:decision";

function artifact(stage: string, output: unknown, input: unknown = {}, symbol?: string): AgentArtifact {
  return { schemaVersion: "v1", artifactId: stage === "decision" ? decisionId : `artifact:shadow:${stage}`, traceId, asOf: at, ...(symbol ? { symbol } : {}), stage, agent: `${stage}_agent`, agentVersion: "v1", status: "success", startedAt: at, completedAt: at, durationMs: 0, input, output, sourceArtifactIds: [] };
}

function facts(): AgentArtifact[] {
  const bars = ["5m", "15m", "1h"].reduce<Record<string, unknown[]>>((value, timeframe) => {
    value[timeframe] = [{ openTime: new Date("2026-07-31T08:00:00.000Z"), closeTime: at, open: 100, high: 102, low: 99, close: 101, volume: 10 }];
    return value;
  }, {});
  const decision = { schemaVersion: "v1", traceId, asOf: at, symbol: "BTCUSDT", action: "open_long", confidence: 80, reason: "fixture", evidence: ["confirmed"], missingConfirmations: [] };
  return [
    artifact("data", { schemaVersion: "v1", traceId, asOf: at, symbol: "BTCUSDT", stableBars: bars, liveQuote: { price: 101, observedAt: at }, quality: { alignmentOk: true, missingTimeframes: [], warnings: [] } }, {}, "BTCUSDT"),
    artifact("analysis", { schemaVersion: "v1", traceId, asOf: at, symbol: "BTCUSDT", regime: "trending_up", trend: "long", setup: "ready", trigger: "confirmed", diagnostics: [] }, {}, "BTCUSDT"),
    artifact("bull_case", { schemaVersion: "v1", traceId, symbol: "BTCUSDT", side: "long", confidence: 80, evidence: ["uptrend confirmed"], invalidationConditions: ["support breaks"], veto: false }, {}, "BTCUSDT"),
    artifact("bear_case", { schemaVersion: "v1", traceId, symbol: "BTCUSDT", side: "short", confidence: 20, evidence: ["pullback risk"], invalidationConditions: ["resistance breaks"], veto: false }, {}, "BTCUSDT"),
    artifact("decision", decision, {}, "BTCUSDT"),
    artifact("portfolio", [decision], { portfolioStateSnapshot: { cash: 9000, usedMargin: 100, equity: 10000, realizedPnl: 0, unrealizedPnl: 0, fees: 0, positions: [] } }),
    artifact("risk", { schemaVersion: "v1", traceId, symbol: "BTCUSDT", passed: true, riskLevel: "safe", corrections: {}, warnings: [] }, { decision, runtimeControlSnapshot: { newEntriesPaused: false, closeOnly: false } }, "BTCUSDT"),
  ];
}

function candidate(decision: AgentArtifact, market = marketPackRef) {
  return ReflectionLessonCandidateSchema.parse({
    schemaVersion: "1.0.0", id: "candidate:shadow", version: "1.0.0", fingerprint: `sha256:${"3".repeat(64)}`, lifecycleStatus: "candidate", createdAt: at.toISOString(), marketPackRef: market,
    schemaRef: { schemaId: "schema.reflection", schemaVersion: "1.0.0" }, artifactType: "reflection_lesson_candidate", reflectionAgentConfigRef: { id: "agent:reflection", version: "v1", fingerprint: `sha256:${"4".repeat(64)}` },
    failedTradeRef: { tradeId: "trade:shadow", decisionArtifactRef: { artifactId: decision.artifactId, artifactType: "decision_agent_artifact", fingerprint: fp(decision) } }, semanticLesson: "Require renewed confirmation.", failurePattern: "failed entry", applicableMarketPackIds: [market.id], applicableRegimes: ["trending_up"], confidence: 0.8,
    supportingEvidence: [{ evidenceId: "evidence:shadow", sourceArtifactRef: { artifactId: decision.artifactId, artifactType: "decision_agent_artifact", fingerprint: fp(decision) }, evidenceType: "lesson", locator: "trade", summary: "Failed trade evidence." }],
  });
}

function adapter(artifacts: Pick<ArtifactLedger, "query">) {
  return new ArtifactLedgerShadowDecisionContextBaseAdapter(
    { async load() { return { closedTrades: [{ tradeId: "trade:shadow", entryTraceId: traceId, entryDecisionArtifactId: decisionId, symbol: "BTCUSDT" }] }; } },
    artifacts,
    { accountId: "paper:test", marketPackRef, dataSourceRef, baseCurrency: "USDT", riskProfileId: "risk:test", maximumRiskBudget: 1000 },
  );
}

test("complete historical Agent facts build a validated Shadow Decision Context base", async () => {
  const history = facts();
  const base = await adapter({ async query() { return history; } }).load("trade:shadow", candidate(history[4]!));
  assert.ok(base);
  assert.equal(DecisionSemanticContextSchema.safeParse({ ...base, approvedLessons: [] }).success, true);
  assert.equal(base.observations.length, 3);
  assert.equal(base.assessments.length, 2);
});

test("missing Portfolio or Risk facts fail closed", async () => {
  const complete = facts();
  const history = complete.filter((item) => item.stage !== "portfolio");
  await assert.rejects(adapter({ async query() { return history; } }).load("trade:shadow", candidate(complete[4]!)), /SHADOW_DECISION_CONTEXT_FACTS_UNAVAILABLE/u);
});

test("Decision Artifact fingerprint drift is stale", async () => {
  const history = facts();
  const original = candidate(history[4]!);
  const drifted = history.map((item) => item.stage === "decision" ? { ...item, output: { ...(item.output as object), reason: "changed" } } : item);
  await assert.rejects(adapter({ async query() { return drifted; } }).load("trade:shadow", original), /SHADOW_DECISION_CONTEXT_ARTIFACT_STALE/u);
});

test("Market Pack fingerprint drift is stale", async () => {
  const history = facts();
  const staleMarket = { ...marketPackRef, fingerprint: `sha256:${"9".repeat(64)}` as const };
  await assert.rejects(adapter({ async query() { return history; } }).load("trade:shadow", candidate(history[4]!, staleMarket)), /SHADOW_DECISION_CONTEXT_MARKET_STALE/u);
});

test("SQLite Artifact Ledger restart restores the same Shadow Context fingerprint", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-shadow-context-"));
  const path = join(directory, "artifacts.sqlite");
  try {
    const history = facts();
    const first = new SQLiteAgentArtifactLedger(path);
    for (const item of history) await first.append(item);
    const before = await adapter(first).load("trade:shadow", candidate(history[4]!));
    first.close();
    const reopened = new SQLiteAgentArtifactLedger(path);
    const after = await adapter(reopened).load("trade:shadow", candidate(history[4]!));
    assert.equal(after?.fingerprint, before?.fingerprint);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
