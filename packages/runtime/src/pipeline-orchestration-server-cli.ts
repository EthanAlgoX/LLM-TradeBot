import { startCurrentPipelineOrchestrationServer } from "./current-pipeline-orchestration-runtime.js";
import { createCsvHistoricalEvidenceRunners } from "../../backtest/src/index.js";
import {
  ParameterGridSchema,
  WalkForwardPlanSchema,
} from "../../contracts/src/index.js";
import { loadCurrentCryptoPaperRuntimeBindingFromEnv } from "./current-crypto-paper-runtime-binding.js";
import { LocalPaperFixtureMarketData } from "./local-paper-market-data.js";
import { createCsvProductionGraphEvidenceRegistration } from "./production-csv-graph-evidence.js";

function parsePort(rawPort: string | undefined): number {
  if (!rawPort) {
    return 8787;
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("TRADEBOT_ORCHESTRATION_PORT must be an integer from 1 to 65535.");
  }
  return port;
}

const configuredOperatorToken = process.env.TRADEBOT_ORCHESTRATION_TOKEN;
const paperMarketDataMode =
  process.env.TRADEBOT_PAPER_MARKET_DATA_MODE ?? "binance_public";
if (!["binance_public", "local_fixture"].includes(paperMarketDataMode)) {
  throw new Error(
    "TRADEBOT_PAPER_MARKET_DATA_MODE must be binance_public or local_fixture.",
  );
}
const historicalCsvPath = process.env.TRADEBOT_HISTORICAL_CSV_PATH;
const historicalProfilePath =
  process.env.TRADEBOT_HISTORICAL_PROFILE_PATH;
const historicalSymbols = process.env.TRADEBOT_HISTORICAL_SYMBOLS;
const historicalConfigured = Boolean(
  historicalCsvPath || historicalProfilePath || historicalSymbols,
);
const parsedHistoricalSymbols = historicalSymbols
  ? historicalSymbols
      .split(",")
      .map((symbol) => symbol.trim())
      .filter(Boolean)
  : [];
if (
  historicalConfigured &&
  (!historicalCsvPath || !historicalProfilePath || !historicalSymbols)
) {
  throw new Error(
    "TRADEBOT_HISTORICAL_CSV_PATH, TRADEBOT_HISTORICAL_PROFILE_PATH, and TRADEBOT_HISTORICAL_SYMBOLS must be configured together.",
  );
}
const configuredWalkForwardGrid = ParameterGridSchema.parse(
  JSON.parse(
    process.env.TRADEBOT_WALK_FORWARD_GRID ??
      '{"perTradeNotional":[500,1000]}',
  ),
);
const configuredWalkForwardPlan = WalkForwardPlanSchema.parse({
  mode: process.env.TRADEBOT_WALK_FORWARD_MODE ?? "rolling",
  trainingCycles: Number(
    process.env.TRADEBOT_WALK_FORWARD_TRAINING_CYCLES ?? 200,
  ),
  validationCycles: Number(
    process.env.TRADEBOT_WALK_FORWARD_VALIDATION_CYCLES ?? 50,
  ),
  stepCycles: Number(
    process.env.TRADEBOT_WALK_FORWARD_STEP_CYCLES ?? 50,
  ),
});
const registeredHistoricalRunners =
  historicalCsvPath && historicalProfilePath && historicalSymbols
    ? await createCsvHistoricalEvidenceRunners({
      csvPath: historicalCsvPath,
      profilePath: historicalProfilePath,
      symbols: parsedHistoricalSymbols,
        walkForwardGrid: configuredWalkForwardGrid,
        walkForwardPlan: configuredWalkForwardPlan,
    })
  : undefined;
const registeredPaperBinding =
  await loadCurrentCryptoPaperRuntimeBindingFromEnv(
    process.env,
    paperMarketDataMode === "local_fixture"
      ? {
          marketDataFactory: () =>
            new LocalPaperFixtureMarketData(),
        }
      : {},
  );
const productionGraphEvidence =
  historicalCsvPath && historicalProfilePath && historicalSymbols
    ? await createCsvProductionGraphEvidenceRegistration({
      csvPath: historicalCsvPath,
      profilePath: historicalProfilePath,
      symbols: parsedHistoricalSymbols,
      walkForward: {
        trainingCycles: configuredWalkForwardPlan.trainingCycles,
        validationCycles: configuredWalkForwardPlan.validationCycles,
        stepCycles: configuredWalkForwardPlan.stepCycles,
      },
      approvedPaperPlanPolicy: {
        planVersion: "current-crypto-semantic-csv:v1",
        paperAccountRef:
          registeredPaperBinding?.paperAccountRef ??
          "paper-account:default",
        candidateSymbols: parsedHistoricalSymbols,
        riskPolicyRefs:
          registeredPaperBinding?.riskPolicyRefs ??
          ["risk-policy:current-paper"],
      },
    })
    : undefined;
if (registeredPaperBinding && !registeredHistoricalRunners) {
  throw new Error(
    "Current Crypto Paper Runtime requires configured Historical Evidence runners.",
  );
}
if (
  registeredPaperBinding &&
  registeredHistoricalRunners &&
  registeredHistoricalRunners.some(
    (runner) =>
      runner.strategyProfileRef !==
      registeredPaperBinding.strategyProfileRef,
  )
) {
  throw new Error(
    "Paper Runtime and Historical Evidence must use the same resolved Strategy Profile.",
  );
}
if (
  registeredPaperBinding &&
  ([...registeredPaperBinding.candidateSymbols].sort().join(",") !==
    [...parsedHistoricalSymbols].sort().join(","))
) {
  throw new Error(
    "Paper Runtime and Historical Evidence must use the same candidate symbols.",
  );
}
const runtime = await startCurrentPipelineOrchestrationServer({
  host: "127.0.0.1",
  port: parsePort(process.env.TRADEBOT_ORCHESTRATION_PORT),
  databasePath:
    process.env.TRADEBOT_ORCHESTRATION_DB_PATH ??
    "tradebot-orchestration.sqlite",
  ...(configuredOperatorToken
    ? { operatorToken: configuredOperatorToken }
    : {}),
  ...(registeredHistoricalRunners
    ? {
        historicalRunners: registeredHistoricalRunners,
        artifactDirectory:
          process.env.TRADEBOT_EVIDENCE_ARTIFACT_DIR ??
          "tradebot-evidence-artifacts",
      }
    : {}),
  ...(productionGraphEvidence
    ? {
        registrySeed: productionGraphEvidence.registrySeed,
        pipelineGraphs: productionGraphEvidence.pipelineGraphs,
        strategyOrchestrationFactory:
          productionGraphEvidence.createStrategyOrchestrationOptions,
      }
    : {}),
  ...(registeredPaperBinding
    ? {
        paperRuntimeBindings: [registeredPaperBinding],
        paperPlanPolicy: {
          planVersion: `current-crypto-paper:${registeredPaperBinding.profileFingerprint}`,
          marketPackRefs: ["market-pack:crypto:v1"],
          paperAccountRef: registeredPaperBinding.paperAccountRef,
          candidateSymbols: [
            ...registeredPaperBinding.candidateSymbols,
          ],
          riskPolicyRefs: [...registeredPaperBinding.riskPolicyRefs],
        },
        ...(paperMarketDataMode === "local_fixture"
          ? { currentCryptoPaperLaunchPreset: true }
          : {}),
        runtimeEvidenceReadModel: {
          paperAccountRef: registeredPaperBinding.paperAccountRef,
          accountId: process.env.TRADEBOT_PAPER_ACCOUNT_ID!,
          marketPackRef: "market-pack:crypto:v1",
          sourceMode:
            paperMarketDataMode === "local_fixture"
              ? "local_fixture"
              : "binance_futures_public_read_only",
          candidateSymbols: [
            ...registeredPaperBinding.candidateSymbols,
          ],
          paperDatabasePath: process.env.TRADEBOT_PAPER_DB_PATH!,
          ...(process.env.TRADEBOT_PAPER_TRACE_DB_PATH
            ? {
                traceDatabasePath:
                  process.env.TRADEBOT_PAPER_TRACE_DB_PATH,
              }
            : {}),
          ...(process.env.TRADEBOT_PAPER_ARTIFACT_DB_PATH
            ? {
                artifactDatabasePath:
                  process.env.TRADEBOT_PAPER_ARTIFACT_DB_PATH,
              }
            : {}),
          ...(process.env.TRADEBOT_PAPER_REFLECTION_DB_PATH
            ? {
                reflectionDatabasePath:
                  process.env.TRADEBOT_PAPER_REFLECTION_DB_PATH,
              }
            : {}),
        },
        comparativeTradeReview: {
          accountId: process.env.TRADEBOT_PAPER_ACCOUNT_ID!,
          paperDatabasePath: process.env.TRADEBOT_PAPER_DB_PATH!,
          reflectionDatabasePath:
            process.env.TRADEBOT_PAPER_REFLECTION_DB_PATH!,
          reviewDatabasePath:
            process.env.TRADEBOT_LESSON_REVIEW_DB_PATH ??
            "tradebot-lesson-reviews.sqlite",
          ...(process.env.TRADEBOT_PAPER_ARTIFACT_DB_PATH
            ? { artifactDatabasePath: process.env.TRADEBOT_PAPER_ARTIFACT_DB_PATH }
            : {}),
          marketPackRef: {
            id: "market-pack:crypto:v1",
            version: "1.0.0",
            fingerprint:
              "sha256:e0f5f3522ac99c6598eebc0693162aa62d9f5f674a590e9404c6c7118d15bdf7",
          },
          dataSourceRef: paperMarketDataMode === "local_fixture"
            ? {
                id: "data-source:local-paper-fixture:v1",
                version: "1.0.0",
                fingerprint:
                  "sha256:88c2c595d6c2be2cf8294997dbaefcfea6480f8b6934a5ec41a2e9126ebfea4e",
              }
            : {
                id: "data-source:binance-futures-public",
                version: "1.0.0",
                fingerprint:
                  "sha256:d9d1d354db7c73b653e639becbd114269b90b51d7b2c07450f4046ad1700eb80",
              },
          pipelineGraphRef: {
            id: "pipeline-graph:current-crypto-fixed",
            version: "1.0.0",
            fingerprint:
              "sha256:c4895c476fdebed86eb40014690cd5dc80fceb6bfc8118ca2df95d2df2a3ee38",
          },
          schemaRef: {
            schemaId: "tradebot.closed-trades.v1",
            schemaVersion: "1.0.0",
          },
        },
      }
    : {}),
});

const address = runtime.server.address();
const port = address && typeof address === "object" ? address.port : 8787;
console.log(`TradeBot orchestration API listening on http://127.0.0.1:${port}`);
if (configuredOperatorToken) {
  console.log("Operator token loaded from TRADEBOT_ORCHESTRATION_TOKEN.");
} else {
  console.log(
    `Ephemeral operator token: ${runtime.ephemeralOperatorToken} (memory only)`,
  );
}
console.log(
  registeredHistoricalRunners
    ? "CSV Backtest and Walk-Forward evidence runners registered."
    : "Historical evidence runners are not configured; evidence jobs fail closed.",
);
console.log(
  registeredPaperBinding
    ? `Current Crypto Paper Runtime binding registered for ${registeredPaperBinding.paperAccountRef}; market data mode ${paperMarketDataMode}.`
    : "Paper Runtime binding is not configured; activation fails closed.",
);
console.log(
  productionGraphEvidence
    ? "Production CSV Semantic Graph compiler and evidence registry enabled."
    : "Configuration Draft API registered; historical graph compilation remains fail-closed until CSV production evidence is configured.",
);
console.log(
  registeredPaperBinding
    ? "Comparative Trade Review API enabled; accepted candidates remain runtimeApplied=false."
    : "Comparative Trade Review API is disabled until Paper Account and Reflection stores are registered.",
);
console.log(
  productionGraphEvidence
    ? "Strategy Evidence API enabled; approved plans remain runtimeApplied=false."
    : "Strategy Evidence API is disabled until Graph datasets, profiles, plans, and a session factory are registered.",
);

async function shutdown(): Promise<void> {
  await runtime.close();
  process.exitCode = 0;
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
