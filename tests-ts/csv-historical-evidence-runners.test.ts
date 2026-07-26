import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  createCsvHistoricalEvidenceRunners,
} from "../packages/backtest/src/index.js";
import { resolveStrategyProfile, sha256File } from "../packages/config/src/index.js";
import { CURRENT_CRYPTO_PIPELINE_GRAPH } from "../packages/core/src/index.js";
import { createCurrentPipelineOrchestrationRuntime } from "../packages/runtime/src/index.js";

const actor = {
  actorId: "operator:csv-evidence",
  displayName: "CSV Evidence Operator",
  roles: ["operator", "approver"] as ("operator" | "approver")[],
};

function writeCsvFixture(path: string): void {
  const rows = [
    "ts,symbol,timeframe,open,high,low,close,volume,quote_volume",
  ];
  const start = Date.parse("2026-07-20T00:00:00.000Z");
  for (let index = 0; index < 12; index += 1) {
    const close = 100 + index * 0.8;
    const timestamp = new Date(start + index * 5 * 60_000).toISOString();
    rows.push(
      `${timestamp},BTCUSDT,5m,${close - 0.2},${close + 0.4},${close - 0.5},${close},100,1000000`,
    );
    if ((index + 1) % 3 === 0) {
      rows.push(
        `${timestamp},BTCUSDT,15m,${close - 1},${close + 0.6},${close - 1.2},${close},300,3000000`,
      );
    }
    if (index === 11) {
      rows.push(
        `${timestamp},BTCUSDT,1h,99,110,98,${close},1200,12000000`,
      );
    }
  }
  writeFileSync(path, `${rows.join("\n")}\n`, "utf8");
}

function writeProfileFixture(path: string): void {
  const profile = resolveStrategyProfile({
    profileId: "csv-evidence-fixture",
    profileVersion: "v1",
    selector: {
      topN: 1,
      minQuoteVolume24h: 0,
      minPrice: 0.00000001,
      minTrendStrength: 0,
      minVolatilityPct: 0,
      maxVolatilityPct: 100,
    },
    dataQuality: {
      minBars5m: 1,
      minBars15m: 1,
      minBars1h: 1,
      maxQuoteAgeMs: 86_400_000,
    },
    decision: {
      perTradeNotional: 500,
      leverage: 1,
      minimumConfidence: 0,
    },
    execution: {
      initialCash: 10_000,
      feeBps: 3,
      slippageBps: 1,
      maxExecutionsPerCycle: 1,
    },
    llm: {
      enabled: false,
    },
  });
  writeFileSync(path, JSON.stringify(profile, null, 2), "utf8");
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "tradebot-csv-evidence-"));
  const csvPath = join(directory, "bars.csv");
  const profilePath = join(directory, "profile.json");
  const artifactDirectory = join(directory, "artifacts");
  writeCsvFixture(csvPath);
  writeProfileFixture(profilePath);
  const runners = await createCsvHistoricalEvidenceRunners({
    csvPath,
    profilePath,
    symbols: ["BTCUSDT"],
    dataSourceRef: "data-source:fixture-csv@1.0.0",
    walkForwardGrid: {
      perTradeNotional: [500],
    },
    walkForwardPlan: {
      mode: "rolling",
      trainingCycles: 6,
      validationCycles: 3,
      stepCycles: 3,
    },
    maxTrials: 4,
  });
  return {
    directory,
    csvPath,
    profilePath,
    artifactDirectory,
    runners,
  };
}

test("CSV evidence runners execute the existing backtest and walk-forward engines", async () => {
  const configured = await fixture();
  const database = new DatabaseSync(":memory:");
  const runtime = createCurrentPipelineOrchestrationRuntime({
    database,
    operatorToken: "csv-evidence-token",
    operatorActor: actor,
    historicalRunners: configured.runners,
    artifactDirectory: configured.artifactDirectory,
  });
  const draft = runtime.service.createDraft(CURRENT_CRYPTO_PIPELINE_GRAPH);
  runtime.evidenceWorkflow.validateContract(draft.draftId, actor);

  const backtest = await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "backtest",
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "real-csv-backtest-001",
      parameters: { perTradeNotional: 500 },
    },
    actor,
  );
  assert.equal(backtest.status, "succeeded");
  assert.equal(backtest.evidence?.metrics.cycleCount, 12);
  assert.equal(
    backtest.evidence?.lineage?.runnerId,
    "historical-runner:csv-backtest@1.0.0",
  );
  assert.equal(
    backtest.evidence?.lineage?.dataSourceRef,
    "data-source:fixture-csv@1.0.0",
  );

  const walkForward = await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "walk_forward",
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "real-csv-walk-forward-001",
      parameters: {},
    },
    actor,
  );
  assert.equal(walkForward.status, "succeeded");
  assert.equal(walkForward.evidence?.metrics.foldCount, 2);
  assert.equal(
    walkForward.evidence?.lineage?.runnerId,
    "historical-runner:csv-walk-forward@1.0.0",
  );

  const artifactId = walkForward.evidence?.lineage?.artifactId ?? "";
  const artifactUuid = artifactId.replace(/^historical-artifact:/, "");
  const result = JSON.parse(
    readFileSync(
      join(configured.artifactDirectory, artifactUuid, "result.json"),
      "utf8",
    ),
  ) as {
    payload: {
      manifest: {
        dataSource: { contentFingerprint: string };
      };
      report: {
        folds: {
          trainingEnd: string;
          validationStart: string;
        }[];
      };
    };
  };
  assert.equal(
    result.payload.manifest.dataSource.contentFingerprint,
    await sha256File(configured.csvPath),
  );
  assert.ok(
    result.payload.report.folds.every(
      (fold) =>
        new Date(fold.trainingEnd).getTime() <
        new Date(fold.validationStart).getTime(),
    ),
  );
  assert.equal(
    runtime.service.getDraft(draft.draftId).promotionStage,
    "walk_forward_validated",
  );

  await runtime.close();
  database.close();
});

test("CSV content changes after registration fail closed and change fingerprint", async () => {
  const configured = await fixture();
  const originalFingerprint = await sha256File(configured.csvPath);
  appendFileSync(
    configured.csvPath,
    "2026-07-20T02:00:00.000Z,BTCUSDT,5m,120,121,119,120,100,1000000\n",
    "utf8",
  );
  const changedFingerprint = await sha256File(configured.csvPath);
  assert.notEqual(changedFingerprint, originalFingerprint);

  const database = new DatabaseSync(":memory:");
  const runtime = createCurrentPipelineOrchestrationRuntime({
    database,
    operatorToken: "csv-evidence-token",
    operatorActor: actor,
    historicalRunners: configured.runners,
    artifactDirectory: configured.artifactDirectory,
  });
  const draft = runtime.service.createDraft(CURRENT_CRYPTO_PIPELINE_GRAPH);
  runtime.evidenceWorkflow.validateContract(draft.draftId, actor);
  const job = await runtime.evidenceWorkflow.runEvidenceJob(
    draft.draftId,
    "backtest",
    {
      schemaVersion: "1.0.0",
      idempotencyKey: "changed-csv-content-001",
      parameters: {},
    },
    actor,
  );

  assert.equal(job.status, "failed");
  assert.equal(job.failureCode, "EVIDENCE_EXECUTION_FAILED");
  assert.equal(
    runtime.service.getDraft(draft.draftId).promotionStage,
    "contract_validated",
  );

  await runtime.close();
  database.close();
});
