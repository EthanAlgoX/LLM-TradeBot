import assert from "node:assert/strict";
import test from "node:test";
import { resolveOrchestrationSessionConfiguration } from "../apps/web/src/orchestration-session.js";

test("Operator session configuration prioritizes runtime injection", () => {
  assert.deepEqual(
    resolveOrchestrationSessionConfiguration({
      globalApiBase: "http://runtime.test",
      globalToken: "runtime-token",
      viteEnvironment: {
        DEV: true,
        VITE_TRADEBOT_ORCHESTRATION_API: "http://vite.test",
        VITE_TRADEBOT_ORCHESTRATION_TOKEN: "vite-token",
      },
    }),
    { apiBase: "http://runtime.test", token: "runtime-token" },
  );
});

test("Operator session configuration uses the Vite credential only in development", () => {
  assert.deepEqual(
    resolveOrchestrationSessionConfiguration({
      viteEnvironment: {
        DEV: true,
        VITE_TRADEBOT_ORCHESTRATION_API: "http://vite.test",
        VITE_TRADEBOT_ORCHESTRATION_TOKEN: "vite-token",
      },
    }),
    { apiBase: "http://vite.test", token: "vite-token" },
  );
  assert.deepEqual(
    resolveOrchestrationSessionConfiguration({
      viteEnvironment: {
        DEV: false,
        VITE_TRADEBOT_ORCHESTRATION_API: "http://vite.test",
        VITE_TRADEBOT_ORCHESTRATION_TOKEN: "vite-token",
      },
    }),
    { apiBase: "http://vite.test", token: undefined },
  );
});

test("Operator session configuration fails closed without a token", () => {
  assert.deepEqual(
    resolveOrchestrationSessionConfiguration({}),
    { apiBase: "http://127.0.0.1:8787", token: undefined },
  );
});
