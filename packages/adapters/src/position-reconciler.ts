import {
  ReconciliationReportSchema,
  type ExchangePositionSnapshot,
  type OpenPosition,
  type ReconciliationReport,
} from "../../contracts/src/index.js";

/** Read-only reconciliation. Repair decisions remain an explicit future workflow. */
export class PositionReconciler {
  reconcile(accountId: string, local: readonly OpenPosition[], remote: readonly ExchangePositionSnapshot[], checkedAt = new Date()): ReconciliationReport {
    const localBySymbol = new Map(local.map((position) => [position.symbol, position]));
    const remoteBySymbol = new Map(remote.map((position) => [position.symbol, position]));
    const onlyLocal = local.filter((position) => !remoteBySymbol.has(position.symbol));
    const onlyRemote = remote.filter((position) => !localBySymbol.has(position.symbol));
    const mismatches: { symbol: string; reason: string }[] = [];
    let matchedCount = 0;
    for (const [symbol, localPosition] of localBySymbol) {
      const remotePosition = remoteBySymbol.get(symbol);
      if (!remotePosition) continue;
      if (localPosition.side !== remotePosition.side) mismatches.push({ symbol, reason: `side local=${localPosition.side} remote=${remotePosition.side}` });
      else if (Math.abs(localPosition.qty - remotePosition.qty) > 1e-12) mismatches.push({ symbol, reason: `quantity local=${localPosition.qty} remote=${remotePosition.qty}` });
      else matchedCount += 1;
    }
    return ReconciliationReportSchema.parse({ accountId, checkedAt, onlyLocal, onlyRemote, mismatches, matchedCount });
  }
}
