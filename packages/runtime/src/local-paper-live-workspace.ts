import { prepareLocalPaperWorkspace } from "./local-paper-workspace.js";

export const BINANCE_PUBLIC_PAPER_MARKET_DATA_LABEL =
  "BINANCE FUTURES PUBLIC READ ONLY";

export function prepareLocalPaperLiveWorkspace(directory: string) {
  const workspace = prepareLocalPaperWorkspace(directory);
  const environment: NodeJS.ProcessEnv = {
    ...workspace.environment,
    TRADEBOT_PAPER_MARKET_DATA_MODE: "binance_public",
  };

  return {
    ...workspace,
    paperMarketDataLabel: BINANCE_PUBLIC_PAPER_MARKET_DATA_LABEL,
    environment,
  };
}
