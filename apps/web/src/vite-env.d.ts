interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_TRADEBOT_ORCHESTRATION_API?: string;
  readonly VITE_TRADEBOT_ORCHESTRATION_TOKEN?: string;
  readonly VITE_TRADEBOT_MARKET_DATA_LABEL?: string;
  readonly VITE_TRADEBOT_EVIDENCE_DATA_LABEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
