from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from tradebot.providers.binance_rules import (
    BinanceFuturesRulesProvider,
    BinanceSymbolRules,
    format_quantity,
    quantize_quantity,
)
from tradebot.contracts import ExecutionResult, ProposedAction, SCHEMA_V2
from tradebot.state import Position, RuntimeState, TradeRecord


class ExecutionProvider:
    def execute(self, *, trace_id: str, planned: ProposedAction, state: RuntimeState) -> ExecutionResult:
        raise NotImplementedError


class SimExecutionProvider(ExecutionProvider):
    def execute(self, *, trace_id: str, planned: ProposedAction, state: RuntimeState) -> ExecutionResult:
        symbol = planned.symbol
        action = planned.action
        price = float(planned.order_params.get("entry_price", 0) or 0)
        qty = float(planned.order_params.get("quantity", 0) or 0)
        lev = float(planned.order_params.get("leverage", 1.0) or 1.0)

        if action in {"wait", "hold"}:
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "skipped", "passive action")

        if action == "open_long":
            state.positions[symbol] = Position(symbol=symbol, side="long", qty=qty, entry_price=price, leverage=lev, opened_cycle=state.cycle)
            state.trades.append(TradeRecord(state.cycle, symbol, action, qty, price, 0.0))
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", "long opened", price)

        if action == "open_short":
            state.positions[symbol] = Position(symbol=symbol, side="short", qty=qty, entry_price=price, leverage=lev, opened_cycle=state.cycle)
            state.trades.append(TradeRecord(state.cycle, symbol, action, qty, price, 0.0))
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", "short opened", price)

        if action in {"close_long", "close_short"}:
            pos = state.positions.get(symbol)
            if not pos:
                return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", "no position", price)
            sign = 1.0 if pos.side == "long" else -1.0
            pnl = (price - pos.entry_price) * pos.qty * sign
            state.cash += pnl
            state.trades.append(TradeRecord(state.cycle, symbol, action, pos.qty, price, pnl))
            del state.positions[symbol]
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", f"position closed pnl={pnl:.2f}", price)

        return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", "unknown action", price)


class PaperExecutionProvider(SimExecutionProvider):
    """Paper provider keeps local portfolio accounting but tags execution as paper."""

    def execute(self, *, trace_id: str, planned: ProposedAction, state: RuntimeState) -> ExecutionResult:
        result = super().execute(trace_id=trace_id, planned=planned, state=state)
        if result.status == "success":
            result.message = f"paper:{result.message}"
        return result


@dataclass
class BinanceCredentials:
    api_key: str
    api_secret: str


class BinanceFuturesExecutionProvider(ExecutionProvider):
    """Real order placement to Binance Futures.

    Safety gate: requires live_confirm_token == "YES".
    """

    def __init__(
        self,
        *,
        credentials: BinanceCredentials,
        base_url: str = "https://fapi.binance.com",
        timeout_sec: float = 6.0,
        live_confirm_token: str = "NO",
        rules_provider: BinanceFuturesRulesProvider | None = None,
    ) -> None:
        self.creds = credentials
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec
        self.live_confirm_token = live_confirm_token
        self.rules_provider = rules_provider or BinanceFuturesRulesProvider(base_url=self.base_url, timeout_sec=self.timeout_sec)

    def _signed_post(self, path: str, params: dict[str, str]) -> dict[str, object]:
        params["timestamp"] = str(int(time.time() * 1000))
        params["recvWindow"] = "5000"
        query = urllib.parse.urlencode(params)
        signature = hmac.new(self.creds.api_secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()
        body = f"{query}&signature={signature}".encode("utf-8")

        req = urllib.request.Request(
            url=f"{self.base_url}{path}",
            data=body,
            method="POST",
            headers={
                "X-MBX-APIKEY": self.creds.api_key,
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "TradeBot/0.1",
            },
        )
        with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("invalid order response")
        return payload

    def _to_order(self, action: str) -> tuple[str, bool]:
        if action == "open_long":
            return "BUY", False
        if action == "open_short":
            return "SELL", False
        if action == "close_long":
            return "SELL", True
        if action == "close_short":
            return "BUY", True
        raise ValueError(f"unsupported action={action}")

    def _adjust_quantity(self, *, action: str, qty: float, price: float, rules: BinanceSymbolRules | None) -> tuple[float, str | None]:
        if rules is None:
            return qty, None
        adjusted = quantize_quantity(qty, rules)
        if adjusted <= 0:
            return 0.0, f"quantity below min rule (min_qty={rules.min_qty}, step={rules.step_size})"
        if action in {"open_long", "open_short"} and rules.min_notional > 0 and adjusted * max(0.0, price) < rules.min_notional:
            return 0.0, f"notional below min rule (min_notional={rules.min_notional})"
        return adjusted, None

    def _format_qty(self, qty: float, rules: BinanceSymbolRules | None) -> str:
        if rules is None:
            return f"{qty:.6f}"
        return format_quantity(qty, rules.qty_precision)

    def execute(self, *, trace_id: str, planned: ProposedAction, state: RuntimeState) -> ExecutionResult:
        symbol = planned.symbol
        action = planned.action
        if action in {"wait", "hold"}:
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "skipped", "passive action")

        if self.live_confirm_token != "YES":
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", "live execution blocked: set TRADEBOT_LIVE_CONFIRM=YES")

        qty = float(planned.order_params.get("quantity", 0) or 0)
        if action in {"close_long", "close_short"} and symbol in state.positions:
            qty = state.positions[symbol].qty
        if qty <= 0:
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", "invalid quantity")
        price = float(planned.order_params.get("entry_price", 0) or 0)
        rules = self.rules_provider.get_symbol_rules(symbol)

        adjusted_qty, blocked_reason = self._adjust_quantity(action=action, qty=qty, price=price, rules=rules)
        if blocked_reason:
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", blocked_reason)
        qty = adjusted_qty

        side, reduce_only = self._to_order(action)
        params = {
            "symbol": symbol,
            "side": side,
            "type": "MARKET",
            "quantity": self._format_qty(qty, rules),
            "reduceOnly": "true" if reduce_only else "false",
            "newOrderRespType": "RESULT",
        }

        try:
            resp = self._signed_post("/fapi/v1/order", params)
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", f"live order failed: {exc}")

        avg_price = float(resp.get("avgPrice", 0.0) or planned.order_params.get("entry_price", 0.0) or 0.0)
        lev = float(planned.order_params.get("leverage", 1.0) or 1.0)

        if action == "open_long":
            state.positions[symbol] = Position(symbol=symbol, side="long", qty=qty, entry_price=avg_price, leverage=lev, opened_cycle=state.cycle)
            state.trades.append(TradeRecord(state.cycle, symbol, action, qty, avg_price, 0.0))
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", "live long opened", avg_price)

        if action == "open_short":
            state.positions[symbol] = Position(symbol=symbol, side="short", qty=qty, entry_price=avg_price, leverage=lev, opened_cycle=state.cycle)
            state.trades.append(TradeRecord(state.cycle, symbol, action, qty, avg_price, 0.0))
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", "live short opened", avg_price)

        if action in {"close_long", "close_short"}:
            pos = state.positions.get(symbol)
            if not pos:
                return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", "no local position")
            sign = 1.0 if pos.side == "long" else -1.0
            pnl = (avg_price - pos.entry_price) * pos.qty * sign
            state.cash += pnl
            state.trades.append(TradeRecord(state.cycle, symbol, action, pos.qty, avg_price, pnl))
            del state.positions[symbol]
            return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "success", f"live position closed pnl={pnl:.2f}", avg_price)

        return ExecutionResult(SCHEMA_V2, trace_id, symbol, action, "failed", "unknown action")
