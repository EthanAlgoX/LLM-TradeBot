import type { Agent, AnalysisBundle, MultiTimeframeSnapshot } from "../../contracts/src/index.js";
import {
  MultiPeriodParserAgent,
  RuleQuantAnalystAgent,
  RuleRegimeAgent,
  RuleSetupAgent,
  RuleTrendAgent,
  RuleTriggerAgent,
} from "./rule-based-analysis.js";

/** Composition-only Agent: each constituent agent remains independently replaceable. */
export class RuleAnalysisPipelineAgent implements Agent<MultiTimeframeSnapshot, AnalysisBundle> {
  readonly name = "rule_analysis_pipeline_agent";
  readonly version = "v1";
  private readonly quant = new RuleQuantAnalystAgent();
  private readonly regime = new RuleRegimeAgent();
  private readonly trend = new RuleTrendAgent();
  private readonly setup = new RuleSetupAgent();
  private readonly trigger = new RuleTriggerAgent();
  private readonly parser = new MultiPeriodParserAgent();

  async run(snapshot: MultiTimeframeSnapshot): Promise<AnalysisBundle> {
    const quant = await this.quant.run(snapshot);
    const regime = await this.regime.run(quant);
    const trend = await this.trend.run({ quant, regime });
    const setup = await this.setup.run({ quant, trend });
    const trigger = await this.trigger.run({ snapshot, quant, trend, setup });
    return this.parser.run({ quant, regime, trend, setup, trigger });
  }
}
