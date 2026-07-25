import {
  AccountReconciliationReportSchema,
  type AccountReconciliationReport,
  type PaperAccountState,
  type RemoteAccountSnapshot,
} from "../../contracts/src/index.js";
import { OrderReconciler } from "../../adapters/src/order-reconciler.js";
import { PositionReconciler } from "../../adapters/src/position-reconciler.js";

export interface RemoteAccountReadPort { getAccountSnapshot(): Promise<RemoteAccountSnapshot>; }

/** Composes read-only exchange data with local paper state; it has no repair path. */
export class ReconciliationService {
  constructor(private readonly positions = new PositionReconciler(), private readonly orders = new OrderReconciler()) {}

  async reconcile(accountId: string, local: PaperAccountState, remotePort: RemoteAccountReadPort, checkedAt = new Date()): Promise<AccountReconciliationReport> {
    const remote = await remotePort.getAccountSnapshot();
    const positionReport = this.positions.reconcile(accountId, local.positions, remote.positions, checkedAt);
    const orderReport = this.orders.reconcile(accountId, local.orders, remote.openOrders, checkedAt);
    const hasDrift = positionReport.onlyLocal.length > 0 || positionReport.onlyRemote.length > 0 || positionReport.mismatches.length > 0 || orderReport.onlyLocal.length > 0 || orderReport.onlyRemote.length > 0 || orderReport.mismatches.length > 0;
    return AccountReconciliationReportSchema.parse({ accountId, checkedAt, remoteAsOf: remote.asOf, positions: positionReport, orders: orderReport, hasDrift });
  }
}
