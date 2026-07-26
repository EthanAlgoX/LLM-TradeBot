import { DatabaseSync } from "node:sqlite";
import type {
  PipelineDraftRepository,
  PipelinePromotionEvidence,
  PipelinePromotionStage,
  StoredPipelineDraft,
} from "../../core/src/pipeline-orchestration.js";
import {
  InMemoryPipelineDraftRepository,
  PipelineOrchestrationError,
} from "../../core/src/pipeline-orchestration.js";

interface PipelineDraftRow {
  draft_id: string;
  graph_id: string;
  human_version: string;
  content_fingerprint: string;
  graph_json: string;
  promotion_stage: PipelinePromotionStage;
  promotion_evidence_json: string;
  runtime_applied: number;
}

export class SqlitePipelineDraftRepository implements PipelineDraftRepository {
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_graph_drafts (
        draft_id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL,
        human_version TEXT NOT NULL,
        content_fingerprint TEXT NOT NULL,
        graph_json TEXT NOT NULL,
        promotion_stage TEXT NOT NULL,
        promotion_evidence_json TEXT NOT NULL,
        runtime_applied INTEGER NOT NULL DEFAULT 0 CHECK (runtime_applied = 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (graph_id, human_version)
      ) STRICT
    `);
  }

  save(rawGraph: unknown): StoredPipelineDraft {
    const candidate = new InMemoryPipelineDraftRepository().save(rawGraph);
    const existing = this.find(candidate.draftId);
    if (existing) {
      if (existing.contentFingerprint !== candidate.contentFingerprint) {
        throw new PipelineOrchestrationError(
          "PIPELINE_VERSION_CONFLICT",
          "A graph version is immutable once stored.",
          {
            graphId: candidate.graphId,
            humanVersion: candidate.humanVersion,
          },
        );
      }
      return existing;
    }

    const now = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO pipeline_graph_drafts (
          draft_id,
          graph_id,
          human_version,
          content_fingerprint,
          graph_json,
          promotion_stage,
          promotion_evidence_json,
          runtime_applied,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `)
      .run(
        candidate.draftId,
        candidate.graphId,
        candidate.humanVersion,
        candidate.contentFingerprint,
        JSON.stringify(candidate.graph),
        candidate.promotionStage,
        JSON.stringify(candidate.promotionEvidence),
        now,
        now,
      );
    return this.get(candidate.draftId);
  }

  get(draftId: string): StoredPipelineDraft {
    const stored = this.find(draftId);
    if (!stored) {
      throw new PipelineOrchestrationError(
        "PIPELINE_DRAFT_NOT_FOUND",
        `Pipeline draft ${draftId} was not found.`,
        { draftId },
      );
    }
    return stored;
  }

  replacePromotionState(
    draftId: string,
    promotionStage: PipelinePromotionStage,
    evidence: readonly PipelinePromotionEvidence[],
  ): StoredPipelineDraft {
    this.get(draftId);
    this.database
      .prepare(`
        UPDATE pipeline_graph_drafts
        SET promotion_stage = ?,
            promotion_evidence_json = ?,
            updated_at = ?
        WHERE draft_id = ?
      `)
      .run(
        promotionStage,
        JSON.stringify(evidence),
        new Date().toISOString(),
        draftId,
      );
    return this.get(draftId);
  }

  private find(draftId: string): StoredPipelineDraft | undefined {
    const row = this.database
      .prepare(`
        SELECT
          draft_id,
          graph_id,
          human_version,
          content_fingerprint,
          graph_json,
          promotion_stage,
          promotion_evidence_json,
          runtime_applied
        FROM pipeline_graph_drafts
        WHERE draft_id = ?
      `)
      .get(draftId) as unknown as PipelineDraftRow | undefined;

    if (!row) {
      return undefined;
    }
    if (row.runtime_applied !== 0) {
      throw new PipelineOrchestrationError(
        "INVALID_PIPELINE_DRAFT",
        "Persisted draft violates the runtime isolation invariant.",
        { draftId },
      );
    }

    return {
      draftId: row.draft_id,
      graphId: row.graph_id,
      humanVersion: row.human_version,
      contentFingerprint: row.content_fingerprint,
      graph: JSON.parse(row.graph_json),
      promotionStage: row.promotion_stage,
      promotionEvidence: JSON.parse(
        row.promotion_evidence_json,
      ) as PipelinePromotionEvidence[],
      runtimeApplied: false,
    };
  }
}
