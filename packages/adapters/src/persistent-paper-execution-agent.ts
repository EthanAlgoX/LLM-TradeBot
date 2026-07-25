import type { ClosedTrade, ExecutionResult, LocalOrderSnapshot, OpenPosition, PaperAccountState, PortfolioState } from "../../contracts/src/index.js";
import type { ExecutionAgent, ExecutionInput, PositionStatePort } from "../../core/src/ports.js";
import { SimulatedExecutionAgent, type SimulatedExecutionConfig } from "./simulated-execution-agent.js";
import { SQLitePaperAccountStore } from "./sqlite-paper-account-store.js";

/** Paper execution adapter that persists after every state-changing execution. */
export class PersistentPaperExecutionAgent implements ExecutionAgent, PositionStatePort {
  readonly name = "persistent_paper_execution_agent";
  readonly version = "v1";
  private constructor(private readonly accountId: string, private readonly store: SQLitePaperAccountStore, private readonly inner: SimulatedExecutionAgent) {}

  static async open(accountId: string, store: SQLitePaperAccountStore, config: SimulatedExecutionConfig): Promise<PersistentPaperExecutionAgent> {
    const state = await store.initialize(accountId, config.initialCash);
    return new PersistentPaperExecutionAgent(accountId, store, new SimulatedExecutionAgent({ ...config, state }));
  }

  async run(input: ExecutionInput): Promise<ExecutionResult> {
    const result = await this.inner.run(input);
    if (result.status === "filled") await this.persist();
    return result;
  }

  async getOpenPositions(): Promise<readonly OpenPosition[]> { return this.inner.getOpenPositions(); }
  getClosedTrades(): readonly ClosedTrade[] { return this.inner.getClosedTrades(); }
  getOrderJournal(): readonly LocalOrderSnapshot[] { return this.inner.getOrderJournal(); }
  markToMarket(markPrices: Readonly<Record<string, number>>): PortfolioState { return this.inner.markToMarket(markPrices); }
  forceCloseAll(markPrices: Readonly<Record<string, number>>, asOf: Date, traceId: string): ExecutionResult[] {
    const results = this.inner.forceCloseAll(markPrices, asOf, traceId);
    if (results.some((result) => result.status === "filled")) void this.persist();
    return results;
  }
  exportState(): PaperAccountState { return this.inner.exportState(); }

  private async persist(): Promise<void> { await this.store.save(this.accountId, this.inner.exportState()); }
}
