import { DatabaseSync } from "node:sqlite";
import {
  PipelineEvidenceJobSchema,
  type PipelineEvidenceJob,
} from "../../contracts/src/index.js";
import {
  ApprovedPaperPlanError,
  type ApprovedPaperEvidenceVerifier,
  type VerifiedPaperPlanEvidence,
} from "../../core/src/approved-paper-plan-service.js";
import type { StoredPipelineDraft } from "../../core/src/pipeline-orchestration.js";
import type { SqlitePipelineEvidenceRepository } from "./sqlite-pipeline-evidence-repository.js";
import {
  HistoricalEvidenceArtifactStore,
  SqliteHistoricalArtifactLedger,
} from "./registered-historical-evidence-executor.js";

interface JsonRow {
  record_json: string;
}

export class SqliteApprovedPaperEvidenceVerifier
  implements ApprovedPaperEvidenceVerifier
{
  constructor(
    private readonly database: DatabaseSync,
    private readonly evidenceRepository: SqlitePipelineEvidenceRepository,
    private readonly artifactStore?: HistoricalEvidenceArtifactStore,
    private readonly artifactLedger?: SqliteHistoricalArtifactLedger,
  ) {}

  verify(
    draft: StoredPipelineDraft,
    approvalId: string,
  ): VerifiedPaperPlanEvidence {
    if (!this.artifactStore || !this.artifactLedger) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_ARTIFACT_INTEGRITY_FAILED",
        "Historical artifact verification is unavailable; Paper Plan fails closed.",
        { draftId: draft.draftId },
      );
    }
    const approval = this.evidenceRepository.getApproval(approvalId);
    if (
      approval.draftId !== draft.draftId ||
      approval.graphId !== draft.graphId ||
      approval.graphFingerprint !== draft.contentFingerprint
    ) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_EVIDENCE_MISMATCH",
        "Approval audit does not match the requested Graph.",
        { draftId: draft.draftId, approvalId },
      );
    }
    const rows = this.database
      .prepare(`
        SELECT record_json
        FROM pipeline_evidence_jobs
        WHERE draft_id = ? AND status = 'succeeded'
      `)
      .all(draft.draftId) as unknown as JsonRow[];
    const jobs = rows.map((row) =>
      PipelineEvidenceJobSchema.parse(JSON.parse(row.record_json)),
    );
    const backtest = this.verifyJob(
      jobs,
      "backtest",
      draft,
      approval.evidenceRefs,
    );
    const walkForward = this.verifyJob(
      jobs,
      "walk_forward",
      draft,
      approval.evidenceRefs,
    );
    if (
      backtest.evidence?.lineage?.strategyProfileRef !==
        walkForward.evidence?.lineage?.strategyProfileRef ||
      backtest.evidence?.lineage?.dataSourceRef !==
        walkForward.evidence?.lineage?.dataSourceRef ||
      backtest.evidence?.lineage?.dataFingerprint !==
        walkForward.evidence?.lineage?.dataFingerprint
    ) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_EVIDENCE_MISMATCH",
        "Backtest and Walk-Forward artifacts do not share trusted lineage.",
        { draftId: draft.draftId },
      );
    }
    return {
      approval,
      backtest: backtest.evidence!,
      walkForward: walkForward.evidence!,
    };
  }

  private verifyJob(
    jobs: readonly PipelineEvidenceJob[],
    kind: "backtest" | "walk_forward",
    draft: StoredPipelineDraft,
    approvalEvidenceRefs: readonly string[],
  ): PipelineEvidenceJob {
    const job = jobs.find(
      (candidate) =>
        candidate.kind === kind &&
        candidate.evidence &&
        approvalEvidenceRefs.includes(candidate.evidence.evidenceId),
    );
    const evidence = job?.evidence;
    if (!job || !evidence || !evidence.lineage || !evidence.artifactSha256) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_EVIDENCE_MISSING",
        `Approved ${kind} evidence with artifact lineage was not found.`,
        { draftId: draft.draftId, kind },
      );
    }
    if (
      job.graphId !== draft.graphId ||
      job.graphFingerprint !== draft.contentFingerprint ||
      evidence.graphId !== draft.graphId ||
      evidence.graphFingerprint !== draft.contentFingerprint ||
      evidence.artifactSha256 !== evidence.lineage.manifestSha256
    ) {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_EVIDENCE_MISMATCH",
        `Approved ${kind} evidence does not match the Graph fingerprint.`,
        { draftId: draft.draftId, kind, jobId: job.jobId },
      );
    }
    try {
      const ledgerManifest = this.artifactLedger!.getByJobId(job.jobId);
      const storedManifest = this.artifactStore!.verify(
        evidence.lineage.artifactId,
      );
      if (
        ledgerManifest.artifactId !== evidence.lineage.artifactId ||
        ledgerManifest.artifactRef !== evidence.artifactRef ||
        ledgerManifest.graphFingerprint !== draft.contentFingerprint ||
        ledgerManifest.manifestSha256 !== evidence.lineage.manifestSha256 ||
        ledgerManifest.resultSha256 !== evidence.lineage.resultSha256 ||
        storedManifest.manifestSha256 !== ledgerManifest.manifestSha256 ||
        storedManifest.resultSha256 !== ledgerManifest.resultSha256
      ) {
        throw new Error("artifact lineage mismatch");
      }
    } catch {
      throw new ApprovedPaperPlanError(
        "PAPER_PLAN_ARTIFACT_INTEGRITY_FAILED",
        `Approved ${kind} artifact failed integrity verification.`,
        { draftId: draft.draftId, kind, jobId: job.jobId },
      );
    }
    return job;
  }
}
