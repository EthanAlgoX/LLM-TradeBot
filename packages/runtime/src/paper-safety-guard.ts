import { RuntimeSafetyDecisionSchema, RuntimeSafetyPolicySchema, RuntimeSafetyStateSchema, type RuntimeSafetyDecision, type RuntimeSafetyPolicy, type RuntimeSafetyState } from "../../contracts/src/index.js";
import type { RuntimeSafetyStore } from "../../core/src/ports.js";

export class PaperSafetyGuard {
  private readonly policy: RuntimeSafetyPolicy;
  private readonly now: () => Date;

  constructor(private readonly scope: string, private readonly store: RuntimeSafetyStore, policy: Partial<RuntimeSafetyPolicy> = {}, now: () => Date = () => new Date()) {
    this.policy = RuntimeSafetyPolicySchema.parse(policy);
    this.now = now;
  }

  async beforeCycle(): Promise<RuntimeSafetyDecision> {
    const state = await this.current();
    if (state.cooldownUntil && state.cooldownUntil.getTime() > this.now().getTime()) return RuntimeSafetyDecisionSchema.parse({ allowed: false, reason: "cooldown", state });
    if (state.cooldownUntil) {
      const cleared = RuntimeSafetyStateSchema.parse({ ...state, cooldownUntil: undefined, updatedAt: this.now() });
      await this.store.save(this.scope, cleared);
      return RuntimeSafetyDecisionSchema.parse({ allowed: true, state: cleared });
    }
    return RuntimeSafetyDecisionSchema.parse({ allowed: true, state });
  }

  async recordSuccess(): Promise<RuntimeSafetyState> {
    const state = RuntimeSafetyStateSchema.parse({ consecutiveFailures: 0, updatedAt: this.now() });
    await this.store.save(this.scope, state);
    return state;
  }

  async recordFailure(error: unknown): Promise<RuntimeSafetyState> {
    const prior = await this.current();
    const consecutiveFailures = prior.consecutiveFailures + 1;
    const state = RuntimeSafetyStateSchema.parse({
      consecutiveFailures,
      cooldownUntil: consecutiveFailures >= this.policy.maxConsecutiveFailures ? new Date(this.now().getTime() + this.policy.cooldownMs) : undefined,
      lastFailure: error instanceof Error ? error.message : String(error),
      updatedAt: this.now(),
    });
    await this.store.save(this.scope, state);
    return state;
  }

  private async current(): Promise<RuntimeSafetyState> {
    return (await this.store.load(this.scope)) ?? RuntimeSafetyStateSchema.parse({ consecutiveFailures: 0, updatedAt: this.now() });
  }
}
