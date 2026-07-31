export const RELEASE_SESSION_STORAGE_KEY =
  "tradebot.release-session.v1";

export interface ReleaseSessionRefs {
  schemaVersion: "1.0.0";
  draftId?: string;
  paperPlanId?: string;
  paperRunId?: string;
}

export type ReleaseSessionParseResult =
  | {
      ok: true;
      refs: ReleaseSessionRefs;
    }
  | {
      ok: false;
      code: "RELEASE_SESSION_REFERENCE_INVALID";
    };

export interface RecoveredPromotionState {
  validationValid?: true;
  backtestStatus?: "succeeded";
  walkForwardStatus?: "succeeded";
}

export interface ServerReleaseReferenceChain {
  draftId?: string;
  planId?: string;
  planDraftId?: string;
  runPlanId?: string;
}

const allowedKeys = new Set([
  "schemaVersion",
  "draftId",
  "paperPlanId",
  "paperRunId",
]);

function stableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 500
  );
}

export function parseReleaseSessionRefs(
  raw: string,
): ReleaseSessionParseResult {
  try {
    const value = JSON.parse(raw) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      return {
        ok: false,
        code: "RELEASE_SESSION_REFERENCE_INVALID",
      };
    }
    const record = value as Record<string, unknown>;
    if (
      record.schemaVersion !== "1.0.0" ||
      Object.keys(record).some((key) => !allowedKeys.has(key))
    ) {
      return {
        ok: false,
        code: "RELEASE_SESSION_REFERENCE_INVALID",
      };
    }
    for (const key of ["draftId", "paperPlanId", "paperRunId"]) {
      if (record[key] !== undefined && !stableId(record[key])) {
        return {
          ok: false,
          code: "RELEASE_SESSION_REFERENCE_INVALID",
        };
      }
    }
    if (
      (record.paperPlanId !== undefined &&
        record.draftId === undefined) ||
      (record.paperRunId !== undefined &&
        record.paperPlanId === undefined)
    ) {
      return {
        ok: false,
        code: "RELEASE_SESSION_REFERENCE_INVALID",
      };
    }
    return {
      ok: true,
      refs: {
        schemaVersion: "1.0.0",
        ...(record.draftId
          ? { draftId: record.draftId as string }
          : {}),
        ...(record.paperPlanId
          ? { paperPlanId: record.paperPlanId as string }
          : {}),
        ...(record.paperRunId
          ? { paperRunId: record.paperRunId as string }
          : {}),
      },
    };
  } catch {
    return {
      ok: false,
      code: "RELEASE_SESSION_REFERENCE_INVALID",
    };
  }
}

export function serializeReleaseSessionRefs(
  refs: ReleaseSessionRefs,
): string {
  return JSON.stringify({
    schemaVersion: "1.0.0",
    ...(refs.draftId ? { draftId: refs.draftId } : {}),
    ...(refs.paperPlanId ? { paperPlanId: refs.paperPlanId } : {}),
    ...(refs.paperRunId ? { paperRunId: refs.paperRunId } : {}),
  });
}

export function releaseReferenceChainMatches(
  chain: ServerReleaseReferenceChain,
): boolean {
  if (
    chain.planId !== undefined &&
    (chain.draftId === undefined ||
      chain.planDraftId !== chain.draftId)
  ) {
    return false;
  }
  if (
    chain.runPlanId !== undefined &&
    (chain.planId === undefined ||
      chain.runPlanId !== chain.planId)
  ) {
    return false;
  }
  return true;
}

export function deriveRecoveredPromotionState(
  promotionStage: string,
): RecoveredPromotionState {
  const rank: Readonly<Record<string, number>> = {
    draft: 0,
    contract_validated: 1,
    backtested: 2,
    walk_forward_validated: 3,
    human_approved: 4,
    paper_running: 5,
  };
  const current = rank[promotionStage] ?? -1;
  return {
    ...(current >= 1 ? { validationValid: true as const } : {}),
    ...(current >= 2
      ? { backtestStatus: "succeeded" as const }
      : {}),
    ...(current >= 3
      ? { walkForwardStatus: "succeeded" as const }
      : {}),
  };
}
