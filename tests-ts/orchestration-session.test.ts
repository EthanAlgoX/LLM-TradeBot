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

test("Operator session configuration never exposes a Vite credential to the bundle", () => {
  assert.deepEqual(
    resolveOrchestrationSessionConfiguration({
      viteEnvironment: {
        DEV: true,
        VITE_TRADEBOT_ORCHESTRATION_API: "http://vite.test",
        VITE_TRADEBOT_ORCHESTRATION_TOKEN: "vite-token",
      },
    }),
    { apiBase: "http://vite.test", token: undefined },
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
