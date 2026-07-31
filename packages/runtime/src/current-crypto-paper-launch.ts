import {
  PaperRuntimeLaunchContextSchema,
  PaperRuntimeLaunchPresetRequestSchema,
  type ApprovedPaperPlan,
  type OrchestrationActor,
  type PaperRuntimeLaunchContext,
  type PipelineGraphVersion,
} from "../../contracts/src/index.js";
import type { ApprovedPaperPlanService } from "../../core/src/approved-paper-plan-service.js";
import type { PipelineEvidenceWorkflow } from "../../core/src/pipeline-evidence-workflow.js";
import type {
  PipelineOrchestrationService,
} from "../../core/src/pipeline-orchestration.js";
import type { PaperRuntimeActivationService } from "./paper-runtime-activation.js";

export class CurrentCryptoPaperLaunchError extends Error {
  readonly name = "CurrentCryptoPaperLaunchError";

  constructor(
    readonly code:
      | "PAPER_LAUNCH_REQUEST_INVALID"
      | "PAPER_LAUNCH_ACTOR_ROLE_REQUIRED"
      | "PAPER_LAUNCH_PRESET_UNAVAILABLE"
      | "PAPER_LAUNCH_EVIDENCE_FAILED",
    message: string,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }
}

export interface CurrentCryptoPaperLaunchOptions {
  available: boolean;
  graph: PipelineGraphVersion;
  draftVersion?: string;
  isCurrentPlan?: (plan: ApprovedPaperPlan) => boolean;
  orchestration: Pick<
    PipelineOrchestrationService,
    "createDraft" | "getDraft"
  >;
  evidenceWorkflow: Pick<
    PipelineEvidenceWorkflow,
    "validateContract" | "runEvidenceJob" | "approve"
  >;
  paperPlans: Pick<
    ApprovedPaperPlanService,
    | "createPlan"
    | "activate"
    | "assertReadyForRuntime"
    | "findLatestActivatedPlan"
    | "findCurrentControl"
  >;
  paperRuntime: Pick<
    PaperRuntimeActivationService,
    "findLatestPreflight" | "findActiveRun"
  >;
  now?: () => Date;
}

function requireLaunchActor(actor: OrchestrationActor): void {
  if (
    !actor.roles.includes("operator") ||
    !actor.roles.includes("approver")
  ) {
    throw new CurrentCryptoPaperLaunchError(
      "PAPER_LAUNCH_ACTOR_ROLE_REQUIRED",
      "Preparing a local Paper Plan requires operator and approver roles.",
      { actorId: actor.actorId },
    );
  }
}

export class CurrentCryptoPaperLaunchService {
  private readonly now: () => Date;

  constructor(private readonly options: CurrentCryptoPaperLaunchOptions) {
    this.now = options.now ?? (() => new Date());
  }

  getContext(): PaperRuntimeLaunchContext {
    const current = this.options.paperPlans.findLatestActivatedPlan();
    const base = {
      schemaVersion: "1.0.0" as const,
      generatedAt: this.now().toISOString(),
      preset: {
        presetId:
          "paper-launch-preset:current-crypto-local-fixture" as const,
        humanVersion: "1.0.0" as const,
        availability: this.options.available
          ? ("available" as const)
          : ("unavailable" as const),
        fixture: true as const,
        graphId: this.options.graph.pipelineGraphId,
        observationWindows: ["5m", "15m", "1h"],
      },
      paperOnly: true as const,
      runtimeApplied: false as const,
      exchangeWriteAllowed: false as const,
      clientRuntimeParametersAccepted: false as const,
    };
    if (
      !current ||
      (this.options.isCurrentPlan &&
        !this.options.isCurrentPlan(current.plan))
    ) {
      return PaperRuntimeLaunchContextSchema.parse({
        ...base,
        launchState: "release_required",
      });
    }

    try {
      this.options.paperPlans.assertReadyForRuntime(
        current.plan.planId,
      );
    } catch (error) {
      return PaperRuntimeLaunchContextSchema.parse({
        ...base,
        launchState: "blocked",
        plan: current.plan,
        activation: current.activation,
        blockerCode:
          error instanceof Error
            ? error.name === "ApprovedPaperPlanError" &&
              "code" in error &&
              typeof error.code === "string"
              ? error.code
              : "PAPER_LAUNCH_PLAN_NOT_READY"
            : "PAPER_LAUNCH_PLAN_NOT_READY",
      });
    }

    const planId = current.plan.planId;
    const control =
      this.options.paperPlans.findCurrentControl(planId);
    const preflight =
      this.options.paperRuntime.findLatestPreflight(planId);
    const run = this.options.paperRuntime.findActiveRun(planId);
    const preflightExpired =
      preflight !== undefined &&
      Date.parse(preflight.expiresAt) <= this.now().getTime();
    let launchState: PaperRuntimeLaunchContext["launchState"];
    if (run?.status === "stop_requested") {
      launchState = "draining";
    } else if (
      run &&
      control?.mode === "pause_new_openings_close_only"
    ) {
      launchState = "only_close";
    } else if (run) {
      launchState = "running";
    } else if (preflight?.status === "failed") {
      launchState = "blocked";
    } else if (
      preflight?.status === "passed" &&
      !preflightExpired
    ) {
      launchState = "ready";
    } else {
      launchState = "preflight_required";
    }

    return PaperRuntimeLaunchContextSchema.parse({
      ...base,
      launchState,
      plan: current.plan,
      activation: current.activation,
      ...(control ? { control } : {}),
      ...(preflight ? { preflight } : {}),
      ...(run ? { run } : {}),
      ...(preflightExpired
        ? { blockerCode: "PAPER_RUNTIME_PREFLIGHT_EXPIRED" }
        : {}),
    });
  }

  async prepare(
    rawRequest: unknown,
    actor: OrchestrationActor,
  ): Promise<PaperRuntimeLaunchContext> {
    const parsed =
      PaperRuntimeLaunchPresetRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new CurrentCryptoPaperLaunchError(
        "PAPER_LAUNCH_REQUEST_INVALID",
        "Paper launch preset request does not satisfy its strict contract.",
        { zodIssueCount: String(parsed.error.issues.length) },
      );
    }
    requireLaunchActor(actor);
    if (!this.options.available) {
      throw new CurrentCryptoPaperLaunchError(
        "PAPER_LAUNCH_PRESET_UNAVAILABLE",
        "The Current Crypto local fixture launch preset is not registered.",
      );
    }

    const existing = this.options.paperPlans.findLatestActivatedPlan();
    if (
      existing &&
      (!this.options.isCurrentPlan ||
        this.options.isCurrentPlan(existing.plan))
    ) {
      this.options.paperPlans.assertReadyForRuntime(
        existing.plan.planId,
      );
      return this.getContext();
    }

    const launchGraph = this.options.draftVersion
      ? {
          ...this.options.graph,
          humanReadableVersion: this.options.draftVersion,
          fingerprint: `sha256:${this.options.draftVersion}`,
        }
      : this.options.graph;
    const draft = this.options.orchestration.createDraft(launchGraph);
    this.options.evidenceWorkflow.validateContract(
      draft.draftId,
      actor,
    );
    for (const kind of ["backtest", "walk_forward"] as const) {
      const job =
        await this.options.evidenceWorkflow.runEvidenceJob(
          draft.draftId,
          kind,
          {
            schemaVersion: "1.0.0",
            idempotencyKey: `${parsed.data.idempotencyKey}:${kind}`,
            parameters: {},
          },
          actor,
        );
      if (job.status !== "succeeded") {
        throw new CurrentCryptoPaperLaunchError(
          "PAPER_LAUNCH_EVIDENCE_FAILED",
          "A registered evidence job failed while preparing the Paper Plan.",
          {
            draftId: draft.draftId,
            kind,
            status: job.status,
            ...(job.failureCode
              ? { failureCode: job.failureCode }
              : {}),
          },
        );
      }
    }
    this.options.evidenceWorkflow.approve(
      draft.draftId,
      {
        schemaVersion: "1.0.0",
        decision: "approve",
        note:
          "Explicit local fixture approval from the Paper launch control.",
      },
      actor,
    );
    const plan = this.options.paperPlans.createPlan(
      draft.draftId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: `${parsed.data.idempotencyKey}:plan`,
      },
      actor,
    );
    this.options.paperPlans.activate(
      plan.planId,
      {
        schemaVersion: "1.0.0",
        idempotencyKey: `${parsed.data.idempotencyKey}:activation`,
        confirmation: "activate_paper_plan",
      },
      actor,
    );
    return this.getContext();
  }
}
