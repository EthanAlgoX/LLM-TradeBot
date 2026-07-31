import { z } from "zod";

const StableIdSchema = z.string().min(3).max(240).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u, "stable_id_format");
const FingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u, "fingerprint_format");

export const HistoricalSemanticEvaluationCommandSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  executionId: StableIdSchema,
  action: z.enum(["create_binding", "run_backtest", "run_walk_forward", "submit_approval"]),
  idempotencyKey: StableIdSchema,
}).strict();

const GateStateSchema = z.enum(["blocked", "required", "passed"]);

export const HistoricalSemanticEvaluationResponseSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  evaluationId: StableIdSchema,
  fingerprint: FingerprintSchema,
  createdAt: z.string().datetime({ offset: true }),
  lifecycleStatus: z.enum([
    "stale",
    "contract_validated",
    "backtest_passed",
    "walk_forward_passed",
    "approval_ready",
    "approved_not_applied",
  ]),
  semanticExecutionRef: z.object({ id: StableIdSchema, fingerprint: FingerprintSchema }).strict(),
  strategyEvidenceBindingRef: z.object({ id: StableIdSchema, versionId: StableIdSchema, fingerprint: FingerprintSchema }).strict().optional(),
  inputKinds: z.array(z.enum(["bar_interval", "rolling_window", "event_batch", "reporting_period"])),
  lineageFingerprints: z.array(FingerprintSchema),
  issueCodes: z.array(z.string().min(1).max(160)),
  gates: z.object({
    contractValidation: GateStateSchema,
    backtest: GateStateSchema,
    walkForward: GateStateSchema,
    humanApproval: GateStateSchema,
  }).strict(),
  historicalEngine: z.literal("existing_graph_evidence"),
  runtimeApplied: z.literal(false),
  exchangeWriteAllowed: z.literal(false),
}).strict();

export type HistoricalSemanticEvaluationCommand = z.infer<typeof HistoricalSemanticEvaluationCommandSchema>;
export type HistoricalSemanticEvaluationResponse = z.infer<typeof HistoricalSemanticEvaluationResponseSchema>;
