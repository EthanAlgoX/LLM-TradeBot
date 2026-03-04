from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from decimal import Decimal, ROUND_DOWN


@dataclass
class BinanceSymbolRules:
    symbol: str
    step_size: float
    min_qty: float
    max_qty: float
    min_notional: float
    qty_precision: int


class BinanceFuturesRulesProvider:
    """Fetch and cache Binance Futures symbol trading rules from exchangeInfo."""

    def __init__(self, *, base_url: str = "https://fapi.binance.com", timeout_sec: float = 6.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec
        self._rules_cache: dict[str, BinanceSymbolRules] = {}

    def _get_json(self, path: str, query: dict[str, str] | None = None) -> object:
        qs = f"?{urllib.parse.urlencode(query)}" if query else ""
        req = urllib.request.Request(url=f"{self.base_url}{path}{qs}", method="GET", headers={"User-Agent": "TradeBot/0.1"})
        with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _parse_symbol_rules(self, row: dict[str, object]) -> BinanceSymbolRules:
        symbol = str(row.get("symbol", ""))
        qty_precision = int(row.get("quantityPrecision", 6) or 6)

        step_size = 0.0
        min_qty = 0.0
        max_qty = 0.0
        min_notional = 0.0

        filters = row.get("filters", [])
        if isinstance(filters, list):
            for f in filters:
                if not isinstance(f, dict):
                    continue
                ftype = str(f.get("filterType", ""))
                if ftype in {"LOT_SIZE", "MARKET_LOT_SIZE"}:
                    step_size = float(f.get("stepSize", step_size) or step_size)
                    min_qty = float(f.get("minQty", min_qty) or min_qty)
                    max_qty = float(f.get("maxQty", max_qty) or max_qty)
                if ftype in {"MIN_NOTIONAL", "NOTIONAL"}:
                    value = f.get("notional", f.get("minNotional", min_notional))
                    min_notional = float(value or min_notional)

        return BinanceSymbolRules(
            symbol=symbol,
            step_size=step_size,
            min_qty=min_qty,
            max_qty=max_qty,
            min_notional=min_notional,
            qty_precision=qty_precision,
        )

    def _load_all_rules(self) -> None:
        payload = self._get_json("/fapi/v1/exchangeInfo")
        if not isinstance(payload, dict):
            raise ValueError("invalid exchangeInfo payload")
        rows = payload.get("symbols", [])
        if not isinstance(rows, list):
            raise ValueError("invalid exchangeInfo symbols")

        for row in rows:
            if not isinstance(row, dict):
                continue
            rules = self._parse_symbol_rules(row)
            if rules.symbol:
                self._rules_cache[rules.symbol] = rules

    def get_symbol_rules(self, symbol: str) -> BinanceSymbolRules | None:
        if symbol in self._rules_cache:
            return self._rules_cache[symbol]
        self._load_all_rules()
        return self._rules_cache.get(symbol)


def quantize_quantity(raw_qty: float, rules: BinanceSymbolRules) -> float:
    qty = Decimal(str(max(0.0, raw_qty)))
    if qty <= 0:
        return 0.0

    if rules.step_size > 0:
        step = Decimal(str(rules.step_size))
        qty = (qty // step) * step

    if rules.qty_precision >= 0:
        quantum = Decimal("1").scaleb(-rules.qty_precision)
        qty = qty.quantize(quantum, rounding=ROUND_DOWN)

    if rules.max_qty > 0:
        max_qty = Decimal(str(rules.max_qty))
        if qty > max_qty:
            qty = max_qty

    if rules.step_size > 0:
        step = Decimal(str(rules.step_size))
        qty = (qty // step) * step

    min_qty = Decimal(str(max(0.0, rules.min_qty)))
    if min_qty > 0 and qty < min_qty:
        return 0.0

    return float(qty)


def format_quantity(qty: float, precision: int) -> str:
    if precision < 0:
        precision = 0
    text = f"{qty:.{precision}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"
