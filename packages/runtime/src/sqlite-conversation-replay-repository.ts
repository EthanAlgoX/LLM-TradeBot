import { DatabaseSync } from "node:sqlite";
import {
  ConversationAssistantResponseSchema,
  ConversationCommandSchema,
} from "../../contracts/src/index.js";
import type {
  ConversationReplayKey,
  ConversationReplayRecord,
  ConversationReplayRepository,
} from "../../core/src/orchestration-copilot-service.js";

interface ConversationReplayRow {
  command_json: string;
  response_json: string;
}

export class SqliteConversationReplayRepository
  implements ConversationReplayRepository
{
  constructor(private readonly database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS orchestration_conversation_replays (
        actor_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        command_json TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (actor_id, conversation_id, idempotency_key)
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS orchestration_conversation_replay_update_forbidden
      BEFORE UPDATE ON orchestration_conversation_replays
      BEGIN
        SELECT RAISE(ABORT, 'CONVERSATION_REPLAY_IMMUTABLE');
      END;
      CREATE TRIGGER IF NOT EXISTS orchestration_conversation_replay_delete_forbidden
      BEFORE DELETE ON orchestration_conversation_replays
      BEGIN
        SELECT RAISE(ABORT, 'CONVERSATION_REPLAY_IMMUTABLE');
      END;
    `);
  }

  get(key: ConversationReplayKey): ConversationReplayRecord | undefined {
    const row = this.database
      .prepare(`
        SELECT command_json, response_json
        FROM orchestration_conversation_replays
        WHERE actor_id = ? AND conversation_id = ? AND idempotency_key = ?
      `)
      .get(
        key.actorId,
        key.conversationId,
        key.idempotencyKey,
      ) as unknown as ConversationReplayRow | undefined;
    if (!row) return undefined;
    return {
      command: ConversationCommandSchema.parse(JSON.parse(row.command_json)),
      response: ConversationAssistantResponseSchema.parse(
        JSON.parse(row.response_json),
      ),
    };
  }

  save(
    key: ConversationReplayKey,
    record: ConversationReplayRecord,
  ): void {
    const command = ConversationCommandSchema.parse(record.command);
    const response = ConversationAssistantResponseSchema.parse(record.response);
    const existing = this.get(key);
    if (existing) {
      if (JSON.stringify(existing.command) !== JSON.stringify(command)) {
        throw new Error("COPILOT_IDEMPOTENCY_CONFLICT");
      }
      return;
    }
    this.database
      .prepare(`
        INSERT INTO orchestration_conversation_replays (
          actor_id, conversation_id, idempotency_key,
          command_json, response_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        key.actorId,
        key.conversationId,
        key.idempotencyKey,
        JSON.stringify(command),
        JSON.stringify(response),
        response.createdAt,
      );
  }
}
