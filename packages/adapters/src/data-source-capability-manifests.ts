import {
  SCHEMA_VERSION,
  type DataSourceCapability,
  type DataSourceDefinition,
  type ObservationWindow,
} from "../../contracts/src/index.js";

const createdAt = new Date("2026-07-26T00:00:00.000Z");
const cryptoMarketPackRef = "market-pack:crypto:v1";
const ohlcvSchemaRef = "tradebot.market.ohlcv.v1";

const bar = (value: number, unit: ObservationWindow["unit"]): ObservationWindow => ({
  kind: "bar_interval",
  value,
  unit,
});

export const BINANCE_FUTURES_PUBLIC_DATA_SOURCE: DataSourceDefinition = {
  schemaVersion: SCHEMA_VERSION,
  dataSourceId: "data-source:binance-futures-public",
  name: "Binance Futures Public",
  provider: "Binance",
  sourceKind: "public_api",
  connectorRef: "connector:binance-futures-public-rest:v1",
  humanReadableVersion: "1.0.0",
  fingerprint: "sha256:binance-futures-public-capability-v1",
  lifecycleStatus: "active",
  createdAt,
  marketPackRefs: [cryptoMarketPackRef],
  marketSchemaRefs: [ohlcvSchemaRef],
  capabilityRefs: ["capability:binance-futures-public:ohlcv:v1"],
  readOnly: true,
};

export const BINANCE_FUTURES_PUBLIC_CAPABILITY: DataSourceCapability = {
  schemaVersion: SCHEMA_VERSION,
  capabilityId: "capability:binance-futures-public:ohlcv:v1",
  dataSourceId: BINANCE_FUTURES_PUBLIC_DATA_SOURCE.dataSourceId,
  humanReadableVersion: "1.0.0",
  fingerprint: "sha256:binance-futures-public-ohlcv-5m-15m-1h-v1",
  lifecycleStatus: "active",
  createdAt,
  markets: ["crypto"],
  marketPackRefs: [cryptoMarketPackRef],
  schemaRefs: [ohlcvSchemaRef],
  dataTypes: ["ohlcv"],
  nativeObservationWindows: [bar(5, "minute"), bar(15, "minute"), bar(1, "hour")],
  supportsRealtime: true,
  updateCadence: bar(5, "minute"),
  timezone: "UTC",
  timestampSemantics: "close_time",
  tradingCalendar: "calendar:crypto-24x7:v1",
  aggregation: {
    allowed: true,
    transformerVersion: "ohlcv-closed-bar-aggregator:v1",
    closedWindowsOnly: true,
  },
  completeness: 1,
};

export const CSV_HISTORICAL_DATA_SOURCE: DataSourceDefinition = {
  schemaVersion: SCHEMA_VERSION,
  dataSourceId: "data-source:csv-historical",
  name: "CSV Historical Source",
  provider: "Local CSV",
  sourceKind: "historical_file",
  connectorRef: "connector:csv-historical-file:v1",
  humanReadableVersion: "1.0.0",
  fingerprint: "sha256:csv-historical-source-v1",
  lifecycleStatus: "active",
  createdAt,
  marketPackRefs: [cryptoMarketPackRef],
  marketSchemaRefs: [ohlcvSchemaRef],
  capabilityRefs: ["capability:csv-historical:ohlcv:v1"],
  readOnly: true,
};

export const CSV_HISTORICAL_CAPABILITY: DataSourceCapability = {
  schemaVersion: SCHEMA_VERSION,
  capabilityId: "capability:csv-historical:ohlcv:v1",
  dataSourceId: CSV_HISTORICAL_DATA_SOURCE.dataSourceId,
  humanReadableVersion: "1.0.0",
  fingerprint: "sha256:csv-historical-ohlcv-5m-15m-1h-v1",
  lifecycleStatus: "active",
  createdAt,
  markets: ["crypto"],
  marketPackRefs: [cryptoMarketPackRef],
  schemaRefs: [ohlcvSchemaRef],
  dataTypes: ["ohlcv"],
  nativeObservationWindows: [bar(5, "minute"), bar(15, "minute"), bar(1, "hour")],
  supportsRealtime: false,
  timezone: "UTC",
  timestampSemantics: "close_time",
  tradingCalendar: "calendar:crypto-24x7:v1",
  aggregation: {
    allowed: true,
    transformerVersion: "ohlcv-closed-bar-aggregator:v1",
    closedWindowsOnly: true,
  },
  completeness: 1,
};

export const DAILY_RESEARCH_DATA_SOURCE: DataSourceDefinition = {
  schemaVersion: SCHEMA_VERSION,
  dataSourceId: "data-source:daily-research",
  name: "Registered Daily Research Source",
  provider: "TradeBot Research",
  sourceKind: "historical_file",
  connectorRef: "connector:daily-research-readonly:v1",
  humanReadableVersion: "1.0.0",
  fingerprint: "sha256:daily-research-source-v1",
  lifecycleStatus: "active",
  createdAt,
  marketPackRefs: [cryptoMarketPackRef],
  marketSchemaRefs: [ohlcvSchemaRef],
  capabilityRefs: ["capability:daily-research:ohlcv:v1"],
  readOnly: true,
};

export const DAILY_RESEARCH_CAPABILITY: DataSourceCapability = {
  schemaVersion: SCHEMA_VERSION,
  capabilityId: "capability:daily-research:ohlcv:v1",
  dataSourceId: DAILY_RESEARCH_DATA_SOURCE.dataSourceId,
  humanReadableVersion: "1.0.0",
  fingerprint: "sha256:daily-research-ohlcv-1d-v1",
  lifecycleStatus: "active",
  createdAt,
  markets: ["crypto"],
  marketPackRefs: [cryptoMarketPackRef],
  schemaRefs: [ohlcvSchemaRef],
  dataTypes: ["ohlcv"],
  nativeObservationWindows: [bar(1, "day")],
  supportsRealtime: false,
  timezone: "UTC",
  timestampSemantics: "close_time",
  tradingCalendar: "calendar:crypto-24x7:v1",
  aggregation: {
    allowed: true,
    transformerVersion: "ohlcv-closed-bar-aggregator:v1",
    closedWindowsOnly: true,
  },
  completeness: 1,
};
