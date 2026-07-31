import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BINANCE_PUBLIC_PAPER_MARKET_DATA_LABEL,
  prepareLocalPaperLiveWorkspace,
} from "../packages/runtime/src/local-paper-live-workspace.js";
import { prepareLocalPaperWorkspace } from "../packages/runtime/src/local-paper-workspace.js";

test("local Paper live mode is explicit, read-only, and isolated from fixture mode", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "tradebot-local-paper-live-"),
  );
  try {
    const fixture = prepareLocalPaperWorkspace(
      join(directory, "fixture"),
    );
    const live = prepareLocalPaperLiveWorkspace(
      join(directory, "live"),
    );

    assert.equal(
      fixture.environment.TRADEBOT_PAPER_MARKET_DATA_MODE,
      "local_fixture",
    );
    assert.equal(
      live.environment.TRADEBOT_PAPER_MARKET_DATA_MODE,
      "binance_public",
    );
    assert.equal(
      live.paperMarketDataLabel,
      BINANCE_PUBLIC_PAPER_MARKET_DATA_LABEL,
    );
    assert.equal(
      live.historicalSourceLabel,
      "CSV SYNTHETIC FIXTURE",
    );
    assert.deepEqual(live.symbols, ["BTCUSDT"]);
    assert.equal(
      live.environment["TRADEBOT_PAPER_SYMBOLS"],
      fixture.environment.TRADEBOT_PAPER_SYMBOLS,
    );
    assert.equal(
      live.environment["TRADEBOT_PAPER_ACCOUNT_ID"],
      fixture.environment.TRADEBOT_PAPER_ACCOUNT_ID,
    );
    assert.ok(
      Object.keys(live.environment).every(
        (key) =>
          !key.includes("API_KEY") &&
          !key.includes("SECRET") &&
          !key.includes("PRIVATE_KEY"),
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
