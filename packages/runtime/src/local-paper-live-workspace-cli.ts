import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import {
  BINANCE_PUBLIC_PAPER_MARKET_DATA_LABEL,
  prepareLocalPaperLiveWorkspace,
} from "./local-paper-live-workspace.js";

const projectRoot = process.cwd();
const workspace = prepareLocalPaperLiveWorkspace(
  join(projectRoot, "data", "local-paper-live-workspace"),
);
const operatorToken = randomBytes(32).toString("hex");
let shuttingDown = false;

const apiEnvironment = {
  ...process.env,
  ...workspace.environment,
  TRADEBOT_ORCHESTRATION_TOKEN: operatorToken,
};
const webEnvironment = {
  ...process.env,
  VITE_TRADEBOT_ORCHESTRATION_API: "http://127.0.0.1:8787",
  VITE_TRADEBOT_ORCHESTRATION_TOKEN: operatorToken,
  VITE_TRADEBOT_MARKET_DATA_LABEL:
    BINANCE_PUBLIC_PAPER_MARKET_DATA_LABEL,
};

function start(
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): ChildProcess {
  return spawn(command, args, {
    cwd: projectRoot,
    env: environment,
    stdio: "inherit",
  });
}

const api = start(
  process.execPath,
  [
    join(
      projectRoot,
      "dist",
      "packages",
      "runtime",
      "src",
      "pipeline-orchestration-server-cli.js",
    ),
  ],
  apiEnvironment,
);
const web = start("npm", ["run", "dev:web"], webEnvironment);
const children = [api, web];

function terminate(exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    terminate(1);
  });
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    if (code === 0 || signal === "SIGTERM") {
      terminate(0);
      return;
    }
    terminate(code ?? 1);
  });
}

process.once("SIGINT", () => terminate(0));
process.once("SIGTERM", () => terminate(0));

console.log(
  "TradeBot Binance Public read-only Paper workspace starting on http://127.0.0.1:5174/.",
);
console.log(
  `${workspace.historicalSourceLabel} is used for release evidence; ${workspace.paperMarketDataLabel} is used for Paper cycles.`,
);
console.log(
  "The development Operator Token is injected into the loopback-only Vite process and is not written to disk.",
);
console.log(
  "No Binance credentials are loaded; exchange write capability remains disabled.",
);
