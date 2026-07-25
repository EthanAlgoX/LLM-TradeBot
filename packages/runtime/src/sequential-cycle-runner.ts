import { PaperWatchPlanSchema, PaperWatchReportSchema, SCHEMA_VERSION, type PaperWatchPlan, type PaperWatchReport } from "../../contracts/src/index.js";

export interface SequentialCycleRunnerOptions {
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/** Bounded sequential runner. It deliberately never starts concurrent trading cycles. */
export class SequentialCycleRunner {
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: SequentialCycleRunnerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async run(rawPlan: PaperWatchPlan, cycle: (index: number) => Promise<void>): Promise<PaperWatchReport> {
    const plan = PaperWatchPlanSchema.parse(rawPlan);
    const cycles = [];
    let stoppedEarly = false;
    for (let index = 1; index <= plan.cycles; index += 1) {
      const startedAt = this.now();
      try {
        await cycle(index);
        cycles.push({ cycle: index, startedAt, finishedAt: this.now(), status: "ok" as const });
      } catch (error) {
        cycles.push({ cycle: index, startedAt, finishedAt: this.now(), status: "error" as const, error: error instanceof Error ? error.message : String(error) });
        if (!plan.continueOnError) { stoppedEarly = true; break; }
      }
      if (index < plan.cycles && plan.intervalMs > 0) await this.sleep(plan.intervalMs);
    }
    return PaperWatchReportSchema.parse({ schemaVersion: SCHEMA_VERSION, plan, cycles, successCount: cycles.filter((item) => item.status === "ok").length, errorCount: cycles.filter((item) => item.status === "error").length, stoppedEarly });
  }
}
