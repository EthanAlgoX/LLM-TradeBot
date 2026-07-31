import type { DatabaseSync } from "node:sqlite";

import {
  ExecutableStrategyConfigurationSchema,
  type ExecutableStrategyConfiguration,
} from "../../contracts/src/index.js";
import type {
  ExecutableStrategyConfigurationRepository,
} from "../../core/src/executable-strategy-configuration-service.js";

interface ExecutableStrategyRow {
  configuration_json: string;
}

export class SqliteExecutableStrategyConfigurationRepository
implements ExecutableStrategyConfigurationRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS executable_strategy_configurations (
        executable_strategy_id TEXT PRIMARY KEY,
        strategy_version_id TEXT NOT NULL UNIQUE,
        source_fingerprint TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        configuration_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS executable_strategy_configuration_update_forbidden
      BEFORE UPDATE ON executable_strategy_configurations
      BEGIN
        SELECT RAISE(ABORT, 'EXECUTABLE_STRATEGY_CONFIGURATION_IMMUTABLE');
      END;
      CREATE TRIGGER IF NOT EXISTS executable_strategy_configuration_delete_forbidden
      BEFORE DELETE ON executable_strategy_configurations
      BEGIN
        SELECT RAISE(ABORT, 'EXECUTABLE_STRATEGY_CONFIGURATION_IMMUTABLE');
      END;
    `);
  }

  save(
    configuration: ExecutableStrategyConfiguration,
  ): ExecutableStrategyConfiguration {
    const parsed =
      ExecutableStrategyConfigurationSchema.parse(configuration);
    const existing = this.findByStrategyVersionId(
      parsed.strategyConfigurationRef.versionId,
    );
    if (existing) {
      if (existing.fingerprint !== parsed.fingerprint) {
        throw new Error("EXECUTABLE_STRATEGY_CONFIGURATION_CONFLICT");
      }
      return existing;
    }
    this.database.prepare(`
      INSERT INTO executable_strategy_configurations (
        executable_strategy_id, strategy_version_id, source_fingerprint,
        fingerprint, configuration_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      parsed.executableStrategyId,
      parsed.strategyConfigurationRef.versionId,
      parsed.sourceFingerprint,
      parsed.fingerprint,
      JSON.stringify(parsed),
      parsed.createdAt,
    );
    return ExecutableStrategyConfigurationSchema.parse(parsed);
  }

  findByStrategyVersionId(
    strategyVersionId: string,
  ): ExecutableStrategyConfiguration | undefined {
    const row = this.database.prepare(`
      SELECT configuration_json
      FROM executable_strategy_configurations
      WHERE strategy_version_id = ?
    `).get(strategyVersionId) as unknown as
      | ExecutableStrategyRow
      | undefined;
    return row
      ? ExecutableStrategyConfigurationSchema.parse(
        JSON.parse(row.configuration_json),
      )
      : undefined;
  }

  get(
    executableStrategyId: string,
  ): ExecutableStrategyConfiguration {
    const row = this.database.prepare(`
      SELECT configuration_json
      FROM executable_strategy_configurations
      WHERE executable_strategy_id = ?
    `).get(executableStrategyId) as unknown as
      | ExecutableStrategyRow
      | undefined;
    if (!row) {
      throw new Error(
        `EXECUTABLE_STRATEGY_NOT_FOUND:${executableStrategyId}`,
      );
    }
    return ExecutableStrategyConfigurationSchema.parse(
      JSON.parse(row.configuration_json),
    );
  }
}

