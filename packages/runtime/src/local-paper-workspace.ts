import {
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

export interface LocalPaperWorkspace {
  readonly directory: string;
  readonly profilePath: string;
  readonly historicalCsvPath: string;
  readonly symbols: readonly ["BTCUSDT"];
  readonly historicalSourceLabel: "CSV SYNTHETIC FIXTURE";
  readonly paperMarketDataLabel: "LOCAL BACKEND FIXTURE";
  readonly environment: Readonly<Record<string, string>>;
}

const localProfileOverride = {
  profileId: "current-crypto-local-paper",
  profileVersion: "v2",
  selector: {
    topN: 1,
    minQuoteVolume24h: 0,
    minPrice: 0.00000001,
    minTrendStrength: 0,
    minVolatilityPct: 0,
    maxVolatilityPct: 100,
  },
  dataQuality: {
    minBars5m: 2,
    minBars15m: 2,
    minBars1h: 2,
    requireAlignment: true,
    maxQuoteAgeMs: 14_400_000,
  },
  decision: {
    perTradeNotional: 500,
    leverage: 1,
    minimumConfidence: 0.5,
  },
  risk: {
    maxLeverage: 1,
    maxNotional: 1_000,
  },
  accountRisk: {
    maxOpenPositions: 1,
    maxUsedMarginPct: 25,
    maxOrderNotional: 500,
  },
  execution: {
    initialCash: 100_000,
    feeBps: 3,
    slippageBps: 1,
    maxExecutionsPerCycle: 1,
  },
  llm: {
    enabled: false,
    timeoutMs: 1_000,
    fallbackToRules: true,
  },
} as const;

function historicalCsv(): string {
  const rows = [
    "ts,symbol,timeframe,open,high,low,close,volume,quote_volume",
  ];
  const start = Date.parse("2026-07-20T00:00:00.000Z");
  const fiveMinutePeriods = 96 * 12;
  for (let index = 0; index < fiveMinutePeriods; index += 1) {
    const timestamp = new Date(
      start + (index + 1) * 5 * 60_000,
    ).toISOString();
    const close = 60_000 + index * 1.5;
    rows.push(
      `${timestamp},BTCUSDT,5m,${close - 2},${close + 4},${close - 5},${close},1200,72000000`,
    );
    if ((index + 1) % 3 === 0) {
      rows.push(
        `${timestamp},BTCUSDT,15m,${close - 6},${close + 8},${close - 10},${close},3600,216000000`,
      );
    }
    if ((index + 1) % 12 === 0) {
      rows.push(
        `${timestamp},BTCUSDT,1h,${close - 18},${close + 22},${close - 30},${close},14400,864000000`,
      );
    }
  }
  return `${rows.join("\n")}\n`;
}

export function prepareLocalPaperWorkspace(
  rawDirectory: string,
): LocalPaperWorkspace {
  const directory = resolve(rawDirectory);
  mkdirSync(directory, { recursive: true });
  const profilePath = join(directory, "strategy-profile.json");
  const historicalCsvPath = join(directory, "historical-bars.csv");
  writeFileSync(
    profilePath,
    `${JSON.stringify(localProfileOverride, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(historicalCsvPath, historicalCsv(), "utf8");

  return {
    directory,
    profilePath,
    historicalCsvPath,
    symbols: ["BTCUSDT"],
    historicalSourceLabel: "CSV SYNTHETIC FIXTURE",
    paperMarketDataLabel: "LOCAL BACKEND FIXTURE",
    environment: {
      TRADEBOT_ORCHESTRATION_PORT: "8787",
      TRADEBOT_ORCHESTRATION_DB_PATH: join(
        directory,
        "orchestration.sqlite",
      ),
      TRADEBOT_HISTORICAL_CSV_PATH: historicalCsvPath,
      TRADEBOT_HISTORICAL_PROFILE_PATH: profilePath,
      TRADEBOT_HISTORICAL_SYMBOLS: "BTCUSDT",
      TRADEBOT_WALK_FORWARD_GRID:
        '{"perTradeNotional":[500]}',
      TRADEBOT_WALK_FORWARD_MODE: "rolling",
      TRADEBOT_WALK_FORWARD_TRAINING_CYCLES: "20",
      TRADEBOT_WALK_FORWARD_VALIDATION_CYCLES: "10",
      TRADEBOT_WALK_FORWARD_STEP_CYCLES: "10",
      TRADEBOT_EVIDENCE_ARTIFACT_DIR: join(
        directory,
        "evidence-artifacts",
      ),
      TRADEBOT_PAPER_PROFILE_PATH: profilePath,
      TRADEBOT_PAPER_SYMBOLS: "BTCUSDT",
      TRADEBOT_PAPER_DB_PATH: join(directory, "paper.sqlite"),
      TRADEBOT_PAPER_ACCOUNT_ID: "local-paper-100k",
      TRADEBOT_PAPER_SAFETY_DB_PATH: join(
        directory,
        "safety.sqlite",
      ),
      TRADEBOT_PAPER_TRACE_DB_PATH: join(
        directory,
        "trace.sqlite",
      ),
      TRADEBOT_PAPER_ARTIFACT_DB_PATH: join(
        directory,
        "artifacts.sqlite",
      ),
      TRADEBOT_PAPER_REFLECTION_DB_PATH: join(
        directory,
        "reflection.sqlite",
      ),
      TRADEBOT_PAPER_MAX_CYCLES: "6",
      TRADEBOT_PAPER_CONTINUOUS: "true",
      TRADEBOT_PAPER_INTERVAL_SECONDS: "60",
      TRADEBOT_PAPER_MAX_CONSECUTIVE_FAILURES: "3",
      TRADEBOT_PAPER_COOLDOWN_SECONDS: "30",
      TRADEBOT_PAPER_MARKET_DATA_MODE: "local_fixture",
    },
  };
}
