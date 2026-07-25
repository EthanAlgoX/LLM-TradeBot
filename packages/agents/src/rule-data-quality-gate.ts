import { DataQualityDecisionSchema, DataQualityPolicySchema, type DataQualityDecision, type DataQualityPolicy, type MultiTimeframeSnapshot } from "../../contracts/src/index.js";
import type { DataQualityAgent } from "../../core/src/ports.js";

/** Blocks downstream agents when the market snapshot is incomplete, misaligned, or stale. */
export class RuleDataQualityGate implements DataQualityAgent {
  readonly name = "rule_data_quality_gate";
  readonly version = "v1";
  private readonly policy: DataQualityPolicy;

  constructor(policy: Partial<DataQualityPolicy> = {}) { this.policy = DataQualityPolicySchema.parse(policy); }

  async run(snapshot: MultiTimeframeSnapshot): Promise<DataQualityDecision> {
    const reasons: string[] = [];
    if (this.policy.requireAlignment && !snapshot.quality.alignmentOk) reasons.push("timeframes are not aligned");
    if (snapshot.stableBars["5m"].length < this.policy.minBars5m) reasons.push(`insufficient closed 5m bars: ${snapshot.stableBars["5m"].length}/${this.policy.minBars5m}`);
    if (snapshot.stableBars["15m"].length < this.policy.minBars15m) reasons.push(`insufficient closed 15m bars: ${snapshot.stableBars["15m"].length}/${this.policy.minBars15m}`);
    if (snapshot.stableBars["1h"].length < this.policy.minBars1h) reasons.push(`insufficient closed 1h bars: ${snapshot.stableBars["1h"].length}/${this.policy.minBars1h}`);
    const ageMs = snapshot.asOf.getTime() - snapshot.liveQuote.observedAt.getTime();
    if (ageMs > this.policy.maxQuoteAgeMs) reasons.push(`live quote is stale: ${ageMs}ms/${this.policy.maxQuoteAgeMs}ms`);
    return DataQualityDecisionSchema.parse({ passed: reasons.length === 0, reasons });
  }
}
