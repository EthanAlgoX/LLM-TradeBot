import { createHmac } from "node:crypto";
import {
  ExchangeOrderSnapshotSchema,
  ExchangePositionSnapshotSchema,
  MarketBarSchema,
  RemoteAccountSnapshotSchema,
  type ExchangeOrderSnapshot,
  type ExchangePositionSnapshot,
  type MarketBar,
  type RemoteAccountSnapshot,
} from "../../contracts/src/index.js";

export type BinanceTimeframe = "5m" | "15m" | "1h";

export interface BinanceCredentials { readonly apiKey: string; readonly apiSecret: string; }
export interface HttpResponse { readonly status: number; readonly body: unknown; }
export interface HttpTransport { get(url: string, headers?: Readonly<Record<string, string>>): Promise<HttpResponse>; }

export interface BinanceFuturesReadPort {
  getKlines(symbol: string, timeframe: BinanceTimeframe, limit?: number): Promise<MarketBar[]>;
  getPositions(): Promise<ExchangePositionSnapshot[]>;
  getOpenOrders(): Promise<ExchangeOrderSnapshot[]>;
  getAccountSnapshot(): Promise<RemoteAccountSnapshot>;
}

export interface BinanceTicker24h {
  readonly symbol: string;
  readonly lastPrice: number;
  readonly quoteVolume: number;
  readonly priceChangePercent: number;
}

export class BinanceApiError extends Error {
  constructor(readonly status: number, readonly code: number | undefined, readonly payload: unknown) {
    super(`Binance Futures API error: status=${status}${code === undefined ? "" : ` code=${code}`}`);
    this.name = "BinanceApiError";
  }
}

export class FetchHttpTransport implements HttpTransport {
  constructor(private readonly timeoutMs = 5_000) {}

  async get(url: string, headers: Readonly<Record<string, string>> = {}): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      const body: unknown = await response.json();
      return { status: response.status, body };
    } finally { clearTimeout(timer); }
  }
}

/** Binance Futures REST adapter. Deliberately read-only: it exposes no mutation endpoint. */
export class BinanceFuturesReadClient implements BinanceFuturesReadPort {
  private readonly baseUrl: string;

  constructor(private readonly transport: HttpTransport = new FetchHttpTransport(), private readonly credentials?: BinanceCredentials, baseUrl = "https://fapi.binance.com") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async getKlines(symbol: string, timeframe: BinanceTimeframe, limit = 240): Promise<MarketBar[]> {
    const response = await this.transport.get(this.publicUrl("/fapi/v1/klines", { symbol, interval: timeframe, limit: String(limit) }));
    const body = this.assertSuccess(response);
    if (!Array.isArray(body)) throw new BinanceApiError(response.status, undefined, body);
    return body.map((row) => {
      if (!Array.isArray(row)) throw new BinanceApiError(response.status, undefined, row);
      return MarketBarSchema.parse({ openTime: new Date(Number(row[0])), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]), closeTime: new Date(Number(row[6])) });
    });
  }

  async getTicker24h(): Promise<BinanceTicker24h[]> {
    const body = this.assertSuccess(await this.transport.get(this.publicUrl("/fapi/v1/ticker/24hr", {})));
    if (!Array.isArray(body)) throw new BinanceApiError(200, undefined, body);
    return body.map((ticker) => {
      const source = ticker as Record<string, unknown>;
      return { symbol: String(source.symbol), lastPrice: Number(source.lastPrice), quoteVolume: Number(source.quoteVolume), priceChangePercent: Number(source.priceChangePercent) };
    }).filter((ticker) => ticker.symbol && Number.isFinite(ticker.lastPrice) && ticker.lastPrice > 0 && Number.isFinite(ticker.quoteVolume));
  }

  async getPositions(): Promise<ExchangePositionSnapshot[]> {
    const body = await this.privateGet("/fapi/v2/positionRisk");
    if (!Array.isArray(body)) throw new BinanceApiError(200, undefined, body);
    return body
      .filter((position) => typeof position === "object" && position !== null && Number((position as Record<string, unknown>).positionAmt) !== 0)
      .map((position) => {
        const source = position as Record<string, unknown>;
        const amount = Number(source.positionAmt);
        return ExchangePositionSnapshotSchema.parse({ symbol: String(source.symbol), side: amount > 0 ? "long" : "short", qty: Math.abs(amount), entryPrice: Number(source.entryPrice) });
      });
  }

  async getOpenOrders(): Promise<ExchangeOrderSnapshot[]> {
    const body = await this.privateGet("/fapi/v1/openOrders");
    if (!Array.isArray(body)) throw new BinanceApiError(200, undefined, body);
    return body.map((order) => {
      const source = order as Record<string, unknown>;
      return ExchangeOrderSnapshotSchema.parse({ orderId: String(source.orderId), clientOrderId: source.origClientOrderId ? String(source.origClientOrderId) : undefined, symbol: String(source.symbol), side: String(source.side).toLowerCase(), status: String(source.status), originalQty: Number(source.origQty), executedQty: Number(source.executedQty), price: Number(source.price), reduceOnly: source.reduceOnly === true || source.reduceOnly === "true" });
    });
  }

  async getAccountSnapshot(): Promise<RemoteAccountSnapshot> {
    const [account, positions, openOrders] = await Promise.all([this.privateGet("/fapi/v2/account"), this.getPositions(), this.getOpenOrders()]);
    const source = account as Record<string, unknown>;
    return RemoteAccountSnapshotSchema.parse({ asOf: new Date(Number(source.updateTime) || Date.now()), totalWalletBalance: Number(source.totalWalletBalance), availableBalance: Number(source.availableBalance), positions, openOrders });
  }

  private async privateGet(path: string): Promise<unknown> {
    if (!this.credentials) throw new Error("Binance credentials are required for private read endpoints");
    const timestamp = String(Date.now());
    const query = `timestamp=${encodeURIComponent(timestamp)}`;
    const signature = createHmac("sha256", this.credentials.apiSecret).update(query).digest("hex");
    const response = await this.transport.get(`${this.baseUrl}${path}?${query}&signature=${signature}`, { "X-MBX-APIKEY": this.credentials.apiKey });
    return this.assertSuccess(response);
  }

  private publicUrl(path: string, query: Readonly<Record<string, string>>): string {
    return `${this.baseUrl}${path}?${new URLSearchParams(query).toString()}`;
  }

  private assertSuccess(response: HttpResponse): unknown {
    if (response.status < 200 || response.status >= 300) {
      const payload = response.body as { code?: unknown } | undefined;
      throw new BinanceApiError(response.status, typeof payload?.code === "number" ? payload.code : undefined, response.body);
    }
    return response.body;
  }
}
