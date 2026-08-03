import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ConnectionService, SqliteConnectionRepository } from "../packages/runtime/src/index.js";

test("connections are actor-scoped, immutable, registry-only, and survive SQLite restart", () => {
  const folder = mkdtempSync(join(tmpdir(), "tradebot-connections-")); const path = join(folder, "connections.sqlite"); let db = new DatabaseSync(path); let service = new ConnectionService(new SqliteConnectionRepository(db));
  try {
    const data = service.materialize("actor:one", "data_source", "data-source:binance-futures-public");
    assert.equal(data.version.runtimeApplied, false); assert.equal(data.version.exchangeWriteAllowed, false); assert.equal(data.version.secretReferenceStatus, "not_required");
    assert.equal(service.materialize("actor:one", "data_source", "data-source:binance-futures-public").version.versionId, data.version.versionId);
    assert.equal(service.list("actor:two").length, 0);
    assert.throws(() => service.materialize("actor:one", "data_source", "https://injected.invalid"), /CONNECTION_REF_UNREGISTERED/);
    assert.throws(() => db.prepare("UPDATE connection_versions SET version_json='{}'").run(), /CONNECTION_VERSION_IMMUTABLE/);
    db.close(); db = new DatabaseSync(path); service = new ConnectionService(new SqliteConnectionRepository(db));
    assert.equal(service.list("actor:one")[0]!.version.fingerprint, data.version.fingerprint);
  } finally { db.close(); rmSync(folder, { recursive: true, force: true }); }
});
