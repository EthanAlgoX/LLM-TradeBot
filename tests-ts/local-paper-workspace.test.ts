import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCsvProductionGraphEvidenceRegistration } from "../packages/runtime/src/production-csv-graph-evidence.js";
import { loadCurrentCryptoPaperRuntimeBindingFromEnv } from "../packages/runtime/src/current-crypto-paper-runtime-binding.js";
import { LocalPaperFixtureMarketData } from "../packages/runtime/src/local-paper-market-data.js";
import { prepareLocalPaperWorkspace } from "../packages/runtime/src/local-paper-workspace.js";
import type {
  ApprovedPaperPlan,
  PaperActivationRecord,
} from "../packages/contracts/src/index.js";

test("local Paper workspace prepares an explicit fixture evidence and Runtime binding", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "tradebot-local-paper-"),
  );
  const now = new Date("2026-07-26T12:34:00.000Z");
  try {
    const workspace = prepareLocalPaperWorkspace(directory);
    assert.equal(workspace.historicalSourceLabel, "CSV SYNTHETIC FIXTURE");
    assert.equal(workspace.paperMarketDataLabel, "LOCAL BACKEND FIXTURE");
    assert.equal(
      workspace.environment.TRADEBOT_PAPER_MARKET_DATA_MODE,
      "local_fixture",
    );
    assert.match(
      readFileSync(workspace.historicalCsvPath, "utf8"),
      /^ts,symbol,timeframe,open,high,low,close,volume,quote_volume/mu,
    );

    const registration =
      await createCsvProductionGraphEvidenceRegistration({
        csvPath: workspace.historicalCsvPath,
        profilePath: workspace.profilePath,
        symbols: [...workspace.symbols],
        walkForward: {
          trainingCycles: 20,
          validationCycles: 10,
          stepCycles: 10,
        },
        approvedPaperPlanPolicy: {
          planVersion: "local-paper:v1",
          paperAccountRef: "paper-account:local-paper",
          candidateSymbols: [...workspace.symbols],
          riskPolicyRefs: ["risk-policy:local-paper"],
        },
        now: () => now,
      });
    assert.equal(registration.pipelineGraphs.length, 1);

    const binding =
      await loadCurrentCryptoPaperRuntimeBindingFromEnv(
        workspace.environment,
        {
          marketDataFactory: () =>
            new LocalPaperFixtureMarketData(() => now),
          now: () => now,
        },
      );
    assert.ok(binding);
    assert.equal(binding.exchangeWriteAllowed, false);
    assert.equal(binding.profile.selector.topN, 1);
    const plan = {
      schemaVersion: "1.0.0",
      planId: "paper-plan:local-paper-workspace",
      planVersion: "local-paper:v1",
      fingerprint: `sha256:${"1".repeat(64)}`,
      lifecycleStatus: "approved_ready",
      draftId: "draft:local-paper-workspace",
      graphId: registration.pipelineGraphs[0]!.pipelineGraphId,
      graphVersion:
        registration.pipelineGraphs[0]!.humanReadableVersion,
      graphFingerprint: registration.pipelineGraphs[0]!.fingerprint,
      marketPackRefs: ["market-pack:crypto:v1"],
      dataSourceRef: "data-source:csv-historical",
      strategyProfileRef: binding.strategyProfileRef,
      dataFingerprint: "fixture-data-fingerprint",
      paperAccountRef: binding.paperAccountRef,
      candidateSymbols: [...binding.candidateSymbols],
      riskPolicyRefs: [...binding.riskPolicyRefs],
      approvalId: "approval:local-paper-workspace",
      approvedByActorId: "operator:local-paper-workspace",
      evidence: {
        backtest: {
          kind: "backtest",
          evidenceId: "evidence:backtest:local-paper-workspace",
          jobId: "job:backtest:local-paper-workspace",
          artifactId: "artifact:backtest:local-paper-workspace",
          artifactRef: "artifact-ref:backtest:local-paper-workspace",
          artifactSha256: "a".repeat(64),
          manifestSha256: "b".repeat(64),
          resultSha256: "c".repeat(64),
        },
        walkForward: {
          kind: "walk_forward",
          evidenceId: "evidence:walk-forward:local-paper-workspace",
          jobId: "job:walk-forward:local-paper-workspace",
          artifactId: "artifact:walk-forward:local-paper-workspace",
          artifactRef: "artifact-ref:walk-forward:local-paper-workspace",
          artifactSha256: "d".repeat(64),
          manifestSha256: "e".repeat(64),
          resultSha256: "f".repeat(64),
        },
      },
      compiledStepCount: 12,
      createdAt: now.toISOString(),
      createdBy: "tradebot-server",
      runtimeApplied: false,
    } as ApprovedPaperPlan;
    const activation = {
      schemaVersion: "1.0.0",
      activationId: "paper-activation:local-paper-workspace",
      planId: plan.planId,
      planFingerprint: plan.fingerprint,
      draftId: plan.draftId,
      graphFingerprint: plan.graphFingerprint,
      actorId: "operator:local-paper-workspace",
      actorDisplayName: "Local Paper Operator",
      status: "activated_not_applied",
      activatedAt: now.toISOString(),
      runtimeApplied: false,
    } as PaperActivationRecord;
    const preflight = await binding.preflight!({
      plan,
      activation,
      now,
    });
    assert.ok(
      preflight.checks.every((check) => check.status === "passed"),
    );
    const runtime = await binding.createRuntime();
    await runtime.close?.();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
