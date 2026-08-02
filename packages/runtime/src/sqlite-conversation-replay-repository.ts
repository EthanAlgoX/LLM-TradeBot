import { DatabaseSync } from "node:sqlite";
import {
  ConversationAssistantResponseSchema,
  ConversationCommandSchema,
  ConversationSummaryPageSchema,
  ConversationSummarySchema,
  ConversationTurnPageSchema,
  ConversationTurnSchema,
  projectToolActivity,
} from "../../contracts/src/index.js";
import type {
  ConversationDraftReference,
  ConversationAssistantResponse,
  ConversationListRequest,
  ConversationSummary,
  ConversationSummaryPage,
  ConversationTurn,
  ConversationTurnPage,
  ConversationTurnsRequest,
} from "../../contracts/src/index.js";
import type {
  ConversationReplayKey,
  ConversationReplayRecord,
  ConversationReplayRepository,
} from "../../core/src/orchestration-copilot-service.js";

interface ConversationReplayRow {
  actor_id: string;
  conversation_id: string;
  idempotency_key: string;
  command_json: string;
  response_json: string;
  created_at: string;
}

interface ConversationCursor {
  schemaVersion: "1.0.0";
  kind: "conversations" | "turns";
  createdAt: string;
  tieBreaker: string;
}

export class ConversationReplayReadError extends Error {
  constructor(readonly code: "INVALID_CONVERSATION_CURSOR" | "CORRUPT_CONVERSATION_REPLAY") {
    super(code);
    this.name = "ConversationReplayReadError";
  }
}

function encodeCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(
  cursor: string | undefined,
  kind: ConversationCursor["kind"],
): ConversationCursor | undefined {
  if (!cursor) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]{1,240}$/u.test(cursor)) throw new Error("invalid");
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (Buffer.from(decoded).toString("base64url") !== cursor) throw new Error("invalid");
    const parsed = JSON.parse(decoded);
    if (
      !parsed || typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 4 ||
      !Object.keys(parsed).every((key) => ["schemaVersion", "kind", "createdAt", "tieBreaker"].includes(key)) ||
      parsed.schemaVersion !== "1.0.0" || parsed.kind !== kind ||
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.tieBreaker !== "string" ||
      !/^[a-z0-9][a-z0-9._:@-]{2,239}$/u.test(parsed.tieBreaker)
    ) throw new Error("invalid");
    return parsed as ConversationCursor;
  } catch {
    throw new ConversationReplayReadError("INVALID_CONVERSATION_CURSOR");
  }
}

function displayTitle(message: string): string {
  const compact = message.replace(/\s+/gu, " ").trim();
  return compact.length <= 88 ? compact : `${compact.slice(0, 85)}...`;
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
      CREATE INDEX IF NOT EXISTS orchestration_conversation_replays_actor_created
      ON orchestration_conversation_replays (actor_id, created_at DESC, conversation_id DESC);
      CREATE INDEX IF NOT EXISTS orchestration_conversation_replays_actor_conversation_created
      ON orchestration_conversation_replays (actor_id, conversation_id, created_at DESC, idempotency_key DESC);
    `);
  }

  listConversations(
    actorId: string,
    request: ConversationListRequest,
  ): ConversationSummaryPage {
    const cursor = decodeCursor(request.cursor, "conversations");
    const rows = this.database.prepare(`
      WITH ranked AS (
        SELECT actor_id, conversation_id, idempotency_key, command_json, response_json, created_at,
          ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at DESC, idempotency_key DESC) AS row_number,
          COUNT(*) OVER (PARTITION BY conversation_id) AS turn_count,
          MIN(created_at) OVER (PARTITION BY conversation_id) AS first_created_at
        FROM orchestration_conversation_replays
        WHERE actor_id = ?
      )
      SELECT actor_id, conversation_id, idempotency_key, command_json, response_json, created_at, turn_count, first_created_at
      FROM ranked
      WHERE row_number = 1
        AND (? IS NULL OR created_at < ? OR (created_at = ? AND conversation_id < ?))
      ORDER BY created_at DESC, conversation_id DESC
      LIMIT ?
    `).all(actorId, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.tieBreaker ?? null, request.limit + 1) as unknown as Array<ConversationReplayRow & { turn_count: number; first_created_at: string }>;
    const summaries = rows.map((row) => {
      const turn = this.requireTurn(row);
      const summary: ConversationSummary = {
        schemaVersion: "1.0.0",
        conversationId: row.conversation_id,
        createdAt: row.first_created_at,
        updatedAt: row.created_at,
        turnCount: row.turn_count,
        displayTitle: displayTitle(turn.command.message),
        latestStatus: turn.response.status,
        selected: turn.response.selected,
        ...(turn.response.draftReference ? { latestDraftReference: turn.response.draftReference } : {}),
        ...(turn.response.evidenceGates.nextGate ? { nextGate: turn.response.evidenceGates.nextGate } : {}),
        runtimeApplied: false,
      };
      return ConversationSummarySchema.parse(summary);
    });
    const hasMore = summaries.length > request.limit;
    const items = hasMore ? summaries.slice(0, request.limit) : summaries;
    const last = items.at(-1);
    return ConversationSummaryPageSchema.parse({
      schemaVersion: "1.0.0", items, hasMore,
      ...(hasMore && last ? { nextCursor: encodeCursor({ schemaVersion: "1.0.0", kind: "conversations", createdAt: last.updatedAt, tieBreaker: last.conversationId }) } : {}),
    });
  }

  getConversation(actorId: string, conversationId: string): ConversationSummary | undefined {
    const rows = this.database.prepare(`
      SELECT actor_id, conversation_id, idempotency_key, command_json, response_json, created_at
      FROM orchestration_conversation_replays
      WHERE actor_id = ? AND conversation_id = ?
      ORDER BY created_at DESC, idempotency_key DESC
    `).all(actorId, conversationId) as unknown as ConversationReplayRow[];
    const latest = rows[0];
    if (!latest) return undefined;
    const turn = this.requireTurn(latest);
    return ConversationSummarySchema.parse({
      schemaVersion: "1.0.0",
      conversationId,
      createdAt: rows.at(-1)?.created_at ?? latest.created_at,
      updatedAt: latest.created_at,
      turnCount: rows.length,
      displayTitle: displayTitle(turn.command.message),
      latestStatus: turn.response.status,
      selected: turn.response.selected,
      ...(turn.response.draftReference ? { latestDraftReference: turn.response.draftReference } : {}),
      ...(turn.response.evidenceGates.nextGate ? { nextGate: turn.response.evidenceGates.nextGate } : {}),
      runtimeApplied: false,
    });
  }

  listTurns(actorId: string, conversationId: string, request: ConversationTurnsRequest): ConversationTurnPage {
    const cursor = decodeCursor(request.cursor, "turns");
    const rows = this.database.prepare(`
      SELECT actor_id, conversation_id, idempotency_key, command_json, response_json, created_at
      FROM orchestration_conversation_replays
      WHERE actor_id = ? AND conversation_id = ?
        AND (? IS NULL OR created_at < ? OR (created_at = ? AND idempotency_key < ?))
      ORDER BY created_at DESC, idempotency_key DESC
      LIMIT ?
    `).all(actorId, conversationId, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.tieBreaker ?? null, request.limit + 1) as unknown as ConversationReplayRow[];
    const turns = rows.map((row) => this.requireTurn(row));
    const hasMore = turns.length > request.limit;
    const items = hasMore ? turns.slice(0, request.limit) : turns;
    const last = items.at(-1);
    return ConversationTurnPageSchema.parse({
      schemaVersion: "1.0.0", conversationId, items, hasMore,
      ...(hasMore && last ? { nextCursor: encodeCursor({ schemaVersion: "1.0.0", kind: "turns", createdAt: last.createdAt, tieBreaker: last.idempotencyKey }) } : {}),
    });
  }

  getLatestTurn(actorId: string, conversationId: string): ConversationTurn | undefined {
    return this.listTurns(actorId, conversationId, { schemaVersion: "1.0.0", limit: 1 }).items[0];
  }

  getLatestDraftReference(actorId: string, conversationId: string): ConversationDraftReference | undefined {
    return this.getLatestTurn(actorId, conversationId)?.response.draftReference;
  }

  appendDraftReference(
    actorId: string,
    conversationId: string,
    idempotencyKey: string,
    draftReference: ConversationDraftReference,
    datasetBindings?: ConversationAssistantResponse["context"]["selected"]["datasetBindings"],
  ): void {
    if (this.get({ actorId, conversationId, idempotencyKey })) return;
    const latest = this.getLatestTurn(actorId, conversationId);
    if (!latest) throw new Error("CONVERSATION_NOT_FOUND");
    const record = this.get({ actorId, conversationId, idempotencyKey: latest.idempotencyKey });
    if (!record) throw new Error("CONVERSATION_NOT_FOUND");
    // Pagination orders immutable turns by timestamp then idempotency key. Keep
    // this append-only authority update strictly after its parent even when both
    // actions occur within one clock millisecond.
    const createdAt = new Date(Math.max(Date.now(), Date.parse(latest.createdAt) + 1)).toISOString();
    this.save({ actorId, conversationId, idempotencyKey }, {
      command: { ...record.command, idempotencyKey, message: "Dataset binding confirmed.", draftReference },
      response: { ...record.response, createdAt, assistantMessage: "Dataset binding confirmed. Runtime remains unchanged.", context: { ...record.response.context, selected: { ...record.response.context.selected, draftReference, ...(datasetBindings?.length ? { datasetBindings: [...datasetBindings] } : {}) } } },
    });
  }

  private requireTurn(row: ConversationReplayRow): ConversationTurn {
    try {
      const command = ConversationCommandSchema.parse(JSON.parse(row.command_json));
      const response = ConversationAssistantResponseSchema.parse(JSON.parse(row.response_json));
      return ConversationTurnSchema.parse({
        schemaVersion: "1.0.0",
        turnId: row.idempotency_key,
        idempotencyKey: row.idempotency_key,
        conversationId: row.conversation_id,
        createdAt: row.created_at,
        command: { message: command.message, locale: command.locale },
        response: {
          status: response.status,
          assistantMessage: response.assistantMessage,
          selected: response.context.selected,
          ...(response.context.selected.draftReference ? { draftReference: response.context.selected.draftReference } : {}),
          ...(response.proposal ? { proposal: response.proposal } : {}),
          toolActivity: projectToolActivity(response.toolCalls, response.toolResults),
          validation: response.validation,
          evidenceGates: response.evidenceGates,
        },
        runtimeApplied: false,
      });
    } catch {
      throw new ConversationReplayReadError("CORRUPT_CONVERSATION_REPLAY");
    }
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
