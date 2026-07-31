import type { GraphEvidenceJob } from "../../contracts/src/index.js";
import type {
  StrategyGraphEvidenceJobPort,
} from "../../core/src/strategy-evidence-approval-service.js";
import {
  DurableGraphEvidenceJobService,
  SqliteGraphEvidenceJobRepository,
} from "./sqlite-graph-evidence-jobs.js";

export class RegisteredStrategyGraphEvidenceJobPort
  implements StrategyGraphEvidenceJobPort
{
  constructor(
    private readonly service: DurableGraphEvidenceJobService,
    private readonly repository: SqliteGraphEvidenceJobRepository,
  ) {}

  submitBacktest(rawRequest: unknown): GraphEvidenceJob {
    return this.service.submitBacktest(rawRequest);
  }

  submitWalkForward(rawRequest: unknown): GraphEvidenceJob {
    return this.service.submitWalkForward(rawRequest);
  }

  run(jobId: string, ownerId: string): Promise<GraphEvidenceJob> {
    return this.service.run(jobId, ownerId);
  }

  get(jobId: string): GraphEvidenceJob {
    return this.repository.get(jobId);
  }
}
