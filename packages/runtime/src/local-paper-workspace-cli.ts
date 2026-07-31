import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import { prepareLocalPaperWorkspace } from "./local-paper-workspace.js";

const projectRoot = resolve(process.cwd());
const workspace = prepareLocalPaperWorkspace(
  join(projectRoot, "data", "local-paper-workspace"),
);
const operatorToken = randomBytes(24).toString("base64url");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children: ChildProcess[] = [];
let shuttingDown = false;

function start(
  command: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
): ChildProcess {
  const child = spawn(command, [...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...environment,
    },
    stdio: "inherit",
  });
  children.push(child);
  return child;
}

function shutdown(exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

const runtime = start(
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
  {
    ...workspace.environment,
    TRADEBOT_ORCHESTRATION_TOKEN: operatorToken,
    TRADEBOT_LESSON_REVIEW_DB_PATH: join(
      workspace.directory,
      "lesson-reviews.sqlite",
    ),
  },
);
const web = start(
  npmCommand,
  [
    "run",
    "dev:web",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    "5174",
    "--strictPort",
  ],
  {
    VITE_TRADEBOT_ORCHESTRATION_API:
      "http://127.0.0.1:8787",
    VITE_TRADEBOT_ORCHESTRATION_TOKEN: operatorToken,
    VITE_TRADEBOT_MARKET_DATA_LABEL:
      workspace.paperMarketDataLabel,
  },
);

console.log(
  "TradeBot local Paper workspace starting on http://127.0.0.1:5174/.",
);
console.log(
  `${workspace.historicalSourceLabel} is used for evidence; ${workspace.paperMarketDataLabel} is used for Paper cycles.`,
);
console.log(
  "The development Operator Token is injected into the loopback-only Vite process and is not written to disk.",
);
console.log("Exchange write capability remains disabled.");

runtime.once("exit", (code) => shutdown(code ?? 1));
web.once("exit", (code) => shutdown(code ?? 1));
process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));
