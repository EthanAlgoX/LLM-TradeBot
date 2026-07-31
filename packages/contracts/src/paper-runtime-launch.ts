import { z } from "zod";
import {
  ApprovedPaperPlanSchema,
  PaperActivationRecordSchema,
  PaperRuntimeControlStateSchema,
} from "./approved-paper-plan.js";
import { PaperRuntimePreflightReportSchema } from "./paper-runtime-operations.js";
import { PaperRuntimeRunSchema } from "./paper-runtime-run.js";

export const PaperRuntimeLaunchPresetRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    idempotencyKey: z.string().min(8).max(200),
    confirmation: z.literal(
      "prepare_current_crypto_fixture_paper_plan",
    ),
  })
  .strict();
export type PaperRuntimeLaunchPresetRequest = z.infer<
  typeof PaperRuntimeLaunchPresetRequestSchema
>;

export const PaperRuntimeLaunchContextSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    generatedAt: z.string().datetime(),
    launchState: z.enum([
      "release_required",
      "preflight_required",
      "ready",
      "running",
      "only_close",
      "draining",
      "blocked",
    ]),
    preset: z
      .object({
        presetId: z.literal(
          "paper-launch-preset:current-crypto-local-fixture",
        ),
        humanVersion: z.literal("1.0.0"),
        availability: z.enum(["available", "unavailable"]),
        fixture: z.literal(true),
        graphId: z.string().min(1),
        observationWindows: z
          .array(z.string().min(1))
          .min(1),
      })
      .strict(),
    plan: ApprovedPaperPlanSchema.optional(),
    activation: PaperActivationRecordSchema.optional(),
    control: PaperRuntimeControlStateSchema.optional(),
    preflight: PaperRuntimePreflightReportSchema.optional(),
    run: PaperRuntimeRunSchema.optional(),
    blockerCode: z.string().min(1).optional(),
    paperOnly: z.literal(true),
    runtimeApplied: z.literal(false),
    exchangeWriteAllowed: z.literal(false),
    clientRuntimeParametersAccepted: z.literal(false),
  })
  .strict()
  .superRefine((context, refinement) => {
    if (
      (context.activation ||
        context.control ||
        context.preflight ||
        context.run) &&
      !context.plan
    ) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plan"],
        message: "Runtime launch references require an Approved Paper Plan.",
      });
    }
    if (
      (context.control || context.preflight || context.run) &&
      !context.activation
    ) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activation"],
        message: "Runtime state requires a Paper activation audit.",
      });
    }
  });
export type PaperRuntimeLaunchContext = z.infer<
  typeof PaperRuntimeLaunchContextSchema
>;
