import { z } from "zod";
import { PaperRuntimeRunStatusSchema } from "./paper-runtime-run.js";

export const RuntimeEvidenceSourceModeSchema = z.enum([
  "local_fixture",
  "binance_futures_public_read_only",
]);
export type RuntimeEvidenceSourceMode = z.infer<
  typeof RuntimeEvidenceSourceModeSchema
>;

export const RuntimeEvidencePositionSchema = z
  .object({
    symbol: z.string().min(1),
    side: z.enum(["long", "short"]),
    qty: z.number().positive(),
    entryPrice: z.number().positive(),
    leverage: z.number().positive(),
    margin: z.number().positive(),
    stopLoss: z.number().nonnegative(),
    takeProfit: z.number().nonnegative(),
    openedAt: z.string().datetime(),
    entryConfidence: z.number().min(0).max(100).optional(),
  })
  .strict();

export const RuntimeEvidenceAgentSummarySchema = z
  .object({
    artifactId: z.string().min(1),
    traceId: z.string().min(1),
    stage: z.string().min(1),
    agent: z.string().min(1),
    agentVersion: z.string().min(1),
    status: z.enum(["success", "fallback", "error"]),
    symbol: z.string().min(1).optional(),
    completedAt: z.string().datetime(),
    durationMs: z.number().nonnegative(),
    semanticSummary: z.string().min(1).max(600),
  })
  .strict();

export const RuntimeEvidenceDashboardSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    readModelId: z.string().min(1),
    humanVersion: z.string().min(1),
    fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    generatedAt: z.string().datetime(),
    evidenceStatus: z.enum(["active", "recent", "unavailable"]),
    sourceMode: RuntimeEvidenceSourceModeSchema,
    marketPackRef: z.string().min(1),
    paperAccountRef: z.string().min(1),
    paperOnly: z.literal(true),
    exchangeWriteAllowed: z.literal(false),
    clientSelectorsAccepted: z.literal(false),
    run: z
      .object({
        runId: z.string().min(1),
        planId: z.string().min(1),
        status: PaperRuntimeRunStatusSchema,
        strategyProfileRef: z.string().min(1),
        processedCycles: z.number().int().nonnegative(),
        plannedCycles: z.number().int().positive(),
        controlMode: z.enum([
          "normal",
          "pause_new_openings_close_only",
        ]),
        requestedAt: z.string().datetime(),
        startedAt: z.string().datetime().optional(),
        finishedAt: z.string().datetime().optional(),
        failureCode: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    cycle: z
      .object({
        cycle: z.number().int().positive(),
        traceId: z.string().min(1),
        status: z.enum([
          "ok",
          "partial",
          "blocked",
          "failed",
          "safety_blocked",
        ]),
        startedAt: z.string().datetime(),
        finishedAt: z.string().datetime(),
        decisionCount: z.number().int().nonnegative(),
        riskDecisionCount: z.number().int().nonnegative(),
        executionCount: z.number().int().nonnegative(),
        controlMode: z.enum([
          "normal",
          "pause_new_openings_close_only",
        ]),
      })
      .strict()
      .optional(),
    account: z
      .object({
        cash: z.number(),
        realizedPnl: z.number(),
        fees: z.number().nonnegative(),
        deployedMargin: z.number().nonnegative(),
        openPositionCount: z.number().int().nonnegative(),
        closedTradeCount: z.number().int().nonnegative(),
        positions: z.array(RuntimeEvidencePositionSchema),
      })
      .strict()
      .optional(),
    selection: z
      .object({
        topN: z.literal(1),
        candidateSymbols: z.array(z.string().min(1)),
        selectedSymbols: z.array(z.string().min(1)).max(1),
      })
      .strict()
      .optional(),
    positionMonitor: z
      .object({
        status: z.enum(["monitoring", "flat", "unavailable"]),
        monitoringSymbols: z.array(z.string().min(1)),
        semanticSummary: z.string().min(1).max(600).optional(),
      })
      .strict(),
    semanticTransfers: z
      .array(RuntimeEvidenceAgentSummarySchema)
      .max(50),
    decisionRiskExecution: z
      .object({
        decisionAction: z.string().min(1).optional(),
        decisionConfidence: z.number().optional(),
        riskPassed: z.boolean().optional(),
        riskBlockedReason: z.string().min(1).optional(),
        executionStatus: z.string().min(1).optional(),
        executionMessage: z.string().min(1).optional(),
      })
      .strict(),
    reflection: z
      .object({
        status: z.enum(["available", "unavailable"]),
        candidateOnly: z.literal(true),
        runtimeApplied: z.literal(false),
        reflectionId: z.string().min(1).optional(),
        asOf: z.string().datetime().optional(),
        recommendations: z.array(z.string().max(600)).max(20),
        adjustmentCount: z.number().int().nonnegative(),
      })
      .strict(),
    lineage: z
      .object({
        planFingerprint: z.string().min(1).optional(),
        traceId: z.string().min(1).optional(),
        artifactIds: z.array(z.string().min(1)).max(50),
        schemaRefs: z.array(z.string().min(1)).min(1),
        dataSourceRef: z.string().min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.evidenceStatus === "unavailable" && value.run) {
      context.addIssue({
        code: "custom",
        path: ["run"],
        message: "Unavailable evidence cannot contain a run.",
      });
    }
    if (value.evidenceStatus !== "unavailable" && !value.run) {
      context.addIssue({
        code: "custom",
        path: ["run"],
        message: "Available evidence requires a run.",
      });
    }
    const active = value.run
      ? ["queued", "running", "stop_requested"].includes(value.run.status)
      : false;
    if (
      (value.evidenceStatus === "active") !== active &&
      value.evidenceStatus !== "unavailable"
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceStatus"],
        message: "Evidence status must match the run lifecycle.",
      });
    }
  });
export type RuntimeEvidenceDashboard = z.infer<
  typeof RuntimeEvidenceDashboardSchema
>;
