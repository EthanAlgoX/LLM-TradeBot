import { DatabaseSync } from "node:sqlite";
import {
  ConfigurationDraftVersionSchema,
  type ConfigurationDraftVersion,
} from "../../contracts/src/index.js";
import type { ConfigurationDraftRepository } from "../../core/src/configuration-draft-service.js";

interface ConfigurationDraftRow {
  version_json: string;
}

export class SqliteConfigurationDraftRepository implements ConfigurationDraftRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS configuration_draft_versions (
        version_id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        version_index INTEGER NOT NULL,
        parent_version_id TEXT,
        fingerprint TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        version_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(draft_id, version_index)
      );
      CREATE INDEX IF NOT EXISTS configuration_draft_versions_by_draft
      ON configuration_draft_versions(draft_id, version_index);
      CREATE TRIGGER IF NOT EXISTS configuration_draft_version_update_forbidden
      BEFORE UPDATE ON configuration_draft_versions
      BEGIN
        SELECT RAISE(ABORT, 'CONFIGURATION_DRAFT_IMMUTABLE');
      END;
      CREATE TRIGGER IF NOT EXISTS configuration_draft_version_delete_forbidden
      BEFORE DELETE ON configuration_draft_versions
      BEGIN
        SELECT RAISE(ABORT, 'CONFIGURATION_DRAFT_IMMUTABLE');
      END;
    `);
  }

  save(version: ConfigurationDraftVersion): void {
    const parsed = ConfigurationDraftVersionSchema.parse(version);
    this.database.prepare(`
      INSERT INTO configuration_draft_versions (
        version_id, draft_id, version_index, parent_version_id,
        fingerprint, kind, version_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.versionId,
      parsed.draftId,
      parsed.versionIndex,
      parsed.parentVersionId ?? null,
      parsed.fingerprint,
      parsed.payload.kind,
      JSON.stringify(parsed),
      parsed.createdAt,
    );
  }

  get(versionId: string): ConfigurationDraftVersion {
    const row = this.database
      .prepare("SELECT version_json FROM configuration_draft_versions WHERE version_id = ?")
      .get(versionId) as unknown as ConfigurationDraftRow | undefined;
    if (!row) throw new Error(`CONFIGURATION_DRAFT_NOT_FOUND:${versionId}`);
    return ConfigurationDraftVersionSchema.parse(JSON.parse(row.version_json));
  }

  latest(draftId: string): ConfigurationDraftVersion {
    const row = this.database.prepare(`
      SELECT version_json FROM configuration_draft_versions
      WHERE draft_id = ? ORDER BY version_index DESC LIMIT 1
    `).get(draftId) as unknown as ConfigurationDraftRow | undefined;
    if (!row) throw new Error(`CONFIGURATION_DRAFT_NOT_FOUND:${draftId}`);
    return ConfigurationDraftVersionSchema.parse(JSON.parse(row.version_json));
  }

  listVersions(draftId: string): ConfigurationDraftVersion[] {
    const rows = this.database.prepare(`
      SELECT version_json FROM configuration_draft_versions
      WHERE draft_id = ? ORDER BY version_index ASC
    `).all(draftId) as unknown as ConfigurationDraftRow[];
    return rows.map((row) => ConfigurationDraftVersionSchema.parse(JSON.parse(row.version_json)));
  }

  findLatestStrategyVersionsByPipelineDraftId(
    pipelineDraftId: string,
  ): ConfigurationDraftVersion[] {
    const rows = this.database.prepare(`
      SELECT current.version_json
      FROM configuration_draft_versions current
      INNER JOIN (
        SELECT draft_id, MAX(version_index) AS version_index
        FROM configuration_draft_versions
        GROUP BY draft_id
      ) latest
        ON latest.draft_id = current.draft_id
       AND latest.version_index = current.version_index
      WHERE current.kind = 'strategy'
      ORDER BY current.draft_id ASC
    `).all() as unknown as ConfigurationDraftRow[];
    return rows
      .map((row) => ConfigurationDraftVersionSchema.parse(JSON.parse(row.version_json)))
      .filter((version) =>
        version.payload.kind === "strategy" &&
        version.payload.pipelineDraftId === pipelineDraftId,
      );
  }
}
