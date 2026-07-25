import {
  OrderReconciliationReportSchema,
  type ExchangeOrderSnapshot,
  type LocalOrderSnapshot,
  type OrderReconciliationReport,
} from "../../contracts/src/index.js";

/** Read-only reconciliation for local pending/submitted orders and remote open orders. */
export class OrderReconciler {
  reconcile(accountId: string, localOrders: readonly LocalOrderSnapshot[], remoteOrders: readonly ExchangeOrderSnapshot[], checkedAt = new Date()): OrderReconciliationReport {
    const activeLocal = localOrders.filter((order) => order.status === "pending" || order.status === "submitted");
    const unmatchedRemote = new Map(remoteOrders.map((order) => [order.orderId, order]));
    const onlyLocal: LocalOrderSnapshot[] = [];
    const mismatches: { localOrderId: string; remoteOrderId: string; reason: string }[] = [];
    let matchedCount = 0;
    for (const local of activeLocal) {
      const remote = remoteOrders.find((candidate) => candidate.orderId === local.exchangeOrderId || (local.clientOrderId !== undefined && candidate.clientOrderId === local.clientOrderId));
      if (!remote) { onlyLocal.push(local); continue; }
      unmatchedRemote.delete(remote.orderId);
      const expectedSide = local.action === "open_long" || local.action === "close_short" ? "buy" : "sell";
      if (remote.symbol !== local.symbol) mismatches.push({ localOrderId: local.localOrderId, remoteOrderId: remote.orderId, reason: `symbol local=${local.symbol} remote=${remote.symbol}` });
      else if (remote.side !== expectedSide) mismatches.push({ localOrderId: local.localOrderId, remoteOrderId: remote.orderId, reason: `side local=${expectedSide} remote=${remote.side}` });
      else if (Math.abs(remote.originalQty - local.requestedQty) > 1e-12) mismatches.push({ localOrderId: local.localOrderId, remoteOrderId: remote.orderId, reason: `quantity local=${local.requestedQty} remote=${remote.originalQty}` });
      else matchedCount += 1;
    }
    return OrderReconciliationReportSchema.parse({ accountId, checkedAt, onlyLocal, onlyRemote: [...unmatchedRemote.values()], mismatches, matchedCount });
  }
}
