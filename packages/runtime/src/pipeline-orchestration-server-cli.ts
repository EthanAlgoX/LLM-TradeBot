import { startCurrentPipelineOrchestrationServer } from "./current-pipeline-orchestration-runtime.js";
import { createCsvHistoricalEvidenceRunners } from "../../backtest/src/index.js";
import {
  ParameterGridSchema,
  WalkForwardPlanSchema,
} from "../../contracts/src/index.js";
import { loadCurrentCryptoPaperRuntimeBindingFromEnv } from "./current-crypto-paper-runtime-binding.js";

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
const registeredHistoricalRunners =
  historicalCsvPath && historicalProfilePath && historicalSymbols
    ? await createCsvHistoricalEvidenceRunners({
      csvPath: historicalCsvPath,
      profilePath: historicalProfilePath,
      symbols: parsedHistoricalSymbols,
        walkForwardGrid: ParameterGridSchema.parse(
          JSON.parse(
            process.env.TRADEBOT_WALK_FORWARD_GRID ??
              '{"perTradeNotional":[500,1000]}',
          ),
        ),
        walkForwardPlan: WalkForwardPlanSchema.parse({
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
        }),
    })
  : undefined;
const registeredPaperBinding =
  await loadCurrentCryptoPaperRuntimeBindingFromEnv(process.env);
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
    ? `Current Crypto Paper Runtime binding registered for ${registeredPaperBinding.paperAccountRef}.`
    : "Paper Runtime binding is not configured; activation fails closed.",
);

async function shutdown(): Promise<void> {
  await runtime.close();
  process.exitCode = 0;
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
