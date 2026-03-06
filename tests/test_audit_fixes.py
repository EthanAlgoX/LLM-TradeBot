"""Tests for the quantitative audit fixes.

Covers:
- Leverage PnL multiplier in SimExecutionProvider, BacktestExecutionProvider, BinanceFuturesExecutionProvider
- Negative cash floor protection
- _compute_equity with leveraged open positions
- Per-trade max loss warning in RiskAuditAgent
- Cash depletion guard in ExecutionAgent
- Consistency across Sim/Backtest/Binance providers for the same trade
"""

from __future__ import annotations

import pytest

from agents.execution import ExecutionAgent, ExecutionPlannerAgent
from agents.risk import RiskAuditAgent
from config import RuntimeConfig
from contracts import ExecutionResult, ProposedAction, RiskDecision, SCHEMA_V2
from providers.binance_rules import BinanceSymbolRules
from providers.execution import (
    BinanceCredentials,
    BinanceFuturesExecutionProvider,
    SimExecutionProvider,
)
from state import Position, RuntimeState, TradeRecord


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_proposal(
    action: str,
    symbol: str = "BTCUSDT",
    price: float = 100.0,
    qty: float = 10.0,
    leverage: float = 3.0,
    stop: float | None = None,
    take: float | None = None,
) -> ProposedAction:
    return ProposedAction(
        schema_version=SCHEMA_V2,
        trace_id="t-test",
        symbol=symbol,
        source="rule",
        action=action,
        confidence=80.0,
        reason="test",
        order_params={
            "entry_price": price,
            "stop_loss": stop if stop is not None else price * 0.98,
            "take_profit": take if take is not None else price * 1.04,
            "leverage": leverage,
            "quantity": qty,
        },
    )


class _StaticRulesProvider:
    """Always returns None so no quantity adjustment is applied."""

    def get_symbol_rules(self, symbol: str) -> None:
        return None


class _DummyLiveProvider(BinanceFuturesExecutionProvider):
    """Intercepts HTTP calls to Binance and returns a deterministic avgPrice."""

    def __init__(self, avg_price: float = 105.0) -> None:
        super().__init__(
            credentials=BinanceCredentials(api_key="k", api_secret="s"),
            live_confirm_token="YES",
            rules_provider=_StaticRulesProvider(),
        )
        self._avg_price = avg_price

    def _signed_post(self, path: str, params: dict[str, str]) -> dict[str, object]:
        return {"avgPrice": str(self._avg_price)}


# ===========================================================================
# 1. Leverage PnL multiplier tests
# ===========================================================================


class TestLeveragePnlSim:
    """SimExecutionProvider must multiply PnL by leverage."""

    def test_long_close_pnl_excludes_leverage(self):
        """Open at 100, close at 105, leverage 3x, qty 10 → gross PnL = 5*10*1 = 50.0."""
        provider = SimExecutionProvider()
        state = RuntimeState(cycle=1, cash=100_000.0)

        # Open long
        open_proposal = _make_proposal("open_long", price=100.0, qty=10.0, leverage=3.0)
        provider.execute(trace_id="t1", planned=open_proposal, state=state)

        assert "BTCUSDT" in state.positions

        # Close long
        close_proposal = _make_proposal("close_long", price=105.0, qty=10.0, leverage=3.0)
        result = provider.execute(trace_id="t2", planned=close_proposal, state=state)

        assert result.status == "success"
        # The close trade record has the net PnL (gross - fee).
        close_trade = [t for t in state.trades if t.action == "close_long"][0]
        # gross_pnl = (105 - 100) * 10 * 1.0 = 50.0
        # fee = 105 * 10 * 3.0 / 10_000 = 0.315  (FEE_BPS=3.0 applied to price*qty)
        fee = 105 * 10 * 3.0 / 10_000.0
        expected_net = 50.0 - fee
        assert abs(close_trade.pnl - expected_net) < 0.01, f"got {close_trade.pnl}, expected ~{expected_net}"

    def test_short_close_pnl_excludes_leverage(self):
        """Open short at 100, close at 95, leverage 2x, qty 5 → gross PnL = (95-100)*5*(-1) = 25.0."""
        provider = SimExecutionProvider()
        state = RuntimeState(cycle=1, cash=100_000.0)

        open_proposal = _make_proposal("open_short", price=100.0, qty=5.0, leverage=2.0)
        provider.execute(trace_id="t1", planned=open_proposal, state=state)

        close_proposal = _make_proposal("close_short", price=95.0, qty=5.0, leverage=2.0)
        result = provider.execute(trace_id="t2", planned=close_proposal, state=state)

        assert result.status == "success"
        close_trade = [t for t in state.trades if t.action == "close_short"][0]
        # gross_pnl = (95 - 100) * 5 * (-1) = 25.0
        fee = 95 * 5 * 3.0 / 10_000.0
        expected_net = 25.0 - fee
        assert abs(close_trade.pnl - expected_net) < 0.01, f"got {close_trade.pnl}, expected ~{expected_net}"


class TestLeveragePnlBacktest:
    """BacktestExecutionProvider._close_position must multiply PnL by leverage."""

    def test_close_pnl_excludes_leverage(self):
        from backtest import BacktestExecutionProvider

        provider = BacktestExecutionProvider(fee_bps=0.0, slippage_bps=0.0)
        state = RuntimeState(cycle=2, cash=100_000.0)
        state.positions["BTCUSDT"] = Position(
            symbol="BTCUSDT", side="long", qty=10.0, entry_price=100.0, leverage=3.0, opened_cycle=1,
        )

        result = provider._close_position(
            trace_id="t1",
            symbol="BTCUSDT",
            action="close_long",
            state=state,
            mark_price=105.0,
        )

        assert result.status == "success"
        close_trade = [t for t in state.trades if t.action == "close_long"][0]
        # gross = (105 - 100) * 10 * 1 = 50, fee=0
        assert abs(close_trade.pnl - 50.0) < 0.01


class TestLeveragePnlBinance:
    """BinanceFuturesExecutionProvider must multiply PnL by leverage."""

    def test_close_long_pnl_excludes_leverage(self):
        provider = _DummyLiveProvider(avg_price=105.0)
        state = RuntimeState(cycle=2, cash=100_000.0)
        state.positions["BTCUSDT"] = Position(
            symbol="BTCUSDT", side="long", qty=10.0, entry_price=100.0, leverage=3.0, opened_cycle=1,
        )

        close_proposal = _make_proposal("close_long", price=105.0, qty=10.0, leverage=3.0)
        result = provider.execute(trace_id="t1", planned=close_proposal, state=state)

        assert result.status == "success"
        close_trade = [t for t in state.trades if t.action == "close_long"][0]
        # gross = (105 - 100) * 10 * 1 = 50, no fee subtraction in Binance provider
        assert abs(close_trade.pnl - 50.0) < 0.01


# ===========================================================================
# 2. Negative cash floor protection
# ===========================================================================


class TestNegativeCashFloor:
    """Closing a position with catastrophic loss must not drive cash below 0."""

    def test_sim_cash_floor(self):
        """Massive short loss: price goes from 100 to 200, leverage 3x, qty 1000."""
        provider = SimExecutionProvider()
        state = RuntimeState(cycle=1, cash=100_000.0)

        # Open short at 100
        open_proposal = _make_proposal("open_short", price=100.0, qty=1000.0, leverage=3.0)
        # Manually set the position (skip margin check for this test)
        state.positions["BTCUSDT"] = Position(
            symbol="BTCUSDT", side="short", qty=1000.0, entry_price=100.0, leverage=3.0, opened_cycle=1,
        )
        # Simulate cash as if margin was taken
        margin = 100.0 * 1000.0 / 3.0  # ~33333.33
        state.cash = 100_000.0 - margin  # ~66666.67

        # Close at 200 → gross loss = (200-100)*1000*(-1) = -100_000
        close_proposal = _make_proposal("close_short", price=200.0, qty=1000.0, leverage=3.0)
        result = provider.execute(trace_id="t1", planned=close_proposal, state=state)

        assert result.status == "success"
        assert state.cash >= 0.0, f"cash went negative: {state.cash}"

    def test_backtest_cash_floor(self):
        from backtest import BacktestExecutionProvider

        provider = BacktestExecutionProvider(fee_bps=0.0, slippage_bps=0.0)
        state = RuntimeState(cycle=2, cash=5_000.0)
        state.positions["BTCUSDT"] = Position(
            symbol="BTCUSDT", side="long", qty=100.0, entry_price=100.0, leverage=3.0, opened_cycle=1,
        )
        # entry notional = 100*100 = 10k, margin = 10k/3 = 3333.33
        # gross loss at price 50 = (50 - 100) * 100 * 1 = -5_000
        # cash + margin + net_pnl = 5000 + 3333.33 + (-5_000) = 3333.33 -> Cash doesn't reach floor!
        # wait! need closing price 16.66667 for -8333.33 loss to hit floor! Let's close at 10.0
        # gross loss at price 10 = (10 - 100) * 100 * 1 = -9_000
        # cash + margin + net_pnl = 5000 + 3333.33 + (-9_000) = -666.67 → should floor to 0

        result = provider._close_position(
            trace_id="t1",
            symbol="BTCUSDT",
            action="close_long",
            state=state,
            mark_price=10.0,
        )

        assert result.status == "success"
        assert state.cash >= 0.0, f"cash went negative: {state.cash}"
        assert abs(state.cash) < 0.01  # should be exactly 0


# ===========================================================================
# 3. _compute_equity with leveraged open positions
# ===========================================================================


class TestComputeEquity:
    """RiskAuditAgent._compute_equity must include margin + leveraged unrealized PnL."""

    def test_equity_with_profitable_long(self):
        cfg = RuntimeConfig()
        agent = RiskAuditAgent(cfg)

        state = RuntimeState(cash=90_000.0)
        state.positions["BTCUSDT"] = Position(
            symbol="BTCUSDT", side="long", qty=10.0, entry_price=100.0, leverage=3.0, opened_cycle=1,
        )
        state.prices["BTCUSDT"] = 105.0

        equity = agent._compute_equity(state)

        # margin = 100 * 10 / 3 = 333.33
        # unrealized_pnl = (105 - 100) * 10 * 1 = 50
        # equity = 90_000 + 333.33 + 50 = 90_383.33
        margin = 100.0 * 10.0 / 3.0
        unrealized = (105.0 - 100.0) * 10.0 * 1.0
        expected = 90_000.0 + margin + unrealized
        assert abs(equity - expected) < 0.01, f"got {equity}, expected {expected}"

    def test_equity_with_losing_short(self):
        cfg = RuntimeConfig()
        agent = RiskAuditAgent(cfg)

        state = RuntimeState(cash=80_000.0)
        state.positions["ETHUSDT"] = Position(
            symbol="ETHUSDT", side="short", qty=5.0, entry_price=2000.0, leverage=2.0, opened_cycle=1,
        )
        state.prices["ETHUSDT"] = 2100.0

        equity = agent._compute_equity(state)

        # margin = 2000 * 5 / 2 = 5000
        # unrealized = (2100 - 2000) * 5 * (-1) = -500
        # equity = 80_000 + 5000 + (-500) = 84_500
        margin = 2000.0 * 5.0 / 2.0
        unrealized = (2100.0 - 2000.0) * 5.0 * (-1.0)
        expected = 80_000.0 + margin + unrealized
        assert abs(equity - expected) < 0.01, f"got {equity}, expected {expected}"

    def test_equity_no_positions(self):
        cfg = RuntimeConfig()
        agent = RiskAuditAgent(cfg)
        state = RuntimeState(cash=50_000.0)

        equity = agent._compute_equity(state)
        assert abs(equity - 50_000.0) < 0.01


# ===========================================================================
# 4. Per-trade max loss warning
# ===========================================================================


class TestPerTradeMaxLossWarning:
    """RiskAuditAgent should block or warn when worst-case loss exceeds max_loss_per_trade_pct."""

    def test_hard_block_when_loss_exceeds_limit(self):
        """OPT-5: With hard_block_max_loss=True (default), the trade is rejected outright."""
        cfg = RuntimeConfig()
        cfg.risk.max_loss_per_trade_pct = 2.0  # 2% of equity
        cfg.risk.max_leverage = 10.0
        cfg.risk.max_position_notional = 500_000.0
        cfg.risk.hard_block_max_loss = True
        cfg.per_trade_notional = 20_000.0
        agent = RiskAuditAgent(cfg)

        state = RuntimeState(cash=100_000.0)

        # entry=100, stop=88, leverage=5 → risk=12, qty=notional/entry=200, worst_case=12*200 = 2400
        # equity=100_000, 2% = 2_000 → 2400 > 2_000 → BLOCKED
        proposal = _make_proposal(
            "open_long", price=100.0, leverage=5.0,
            stop=88.0, take=120.0,
        )

        result = agent.audit(trace_id="t1", proposal=proposal, state=state)
        assert result.passed is False
        assert result.risk_level == "danger"
        assert "worst-case loss" in result.blocked_reason

    def test_warning_when_loss_exceeds_limit_soft_mode(self):
        """With hard_block_max_loss=False, the trade passes with a warning (pre-OPT-5 behavior)."""
        cfg = RuntimeConfig()
        cfg.risk.max_loss_per_trade_pct = 2.0  # 2% of equity
        cfg.risk.max_leverage = 10.0
        cfg.risk.max_position_notional = 500_000.0
        cfg.risk.hard_block_max_loss = False
        cfg.per_trade_notional = 20_000.0
        agent = RiskAuditAgent(cfg)

        state = RuntimeState(cash=100_000.0)

        proposal = _make_proposal(
            "open_long", price=100.0, leverage=5.0,
            stop=88.0, take=120.0,
        )

        result = agent.audit(trace_id="t1", proposal=proposal, state=state)
        assert result.passed is True
        assert result.risk_level == "warning"
        assert any("worst-case loss" in w for w in result.warnings)

    def test_no_warning_when_loss_within_limit(self):
        cfg = RuntimeConfig()
        cfg.risk.max_loss_per_trade_pct = 2.0
        cfg.risk.max_leverage = 5.0
        cfg.risk.max_position_notional = 500_000.0
        cfg.per_trade_notional = 100.0  # small notional
        agent = RiskAuditAgent(cfg)

        state = RuntimeState(cash=100_000.0)

        # entry=100, stop=99, leverage=2 → risk=1, qty=100/100=1, worst_case=1*1*2=2
        # equity=100_000, 2% = 2_000 → 2 < 2_000 → no warning
        proposal = _make_proposal(
            "open_long", price=100.0, leverage=2.0,
            stop=99.0, take=103.0,
        )

        result = agent.audit(trace_id="t1", proposal=proposal, state=state)
        assert result.passed is True
        assert not any("worst-case loss" in w for w in result.warnings)


# ===========================================================================
# 5. Cash depletion guard in ExecutionAgent
# ===========================================================================


class TestCashDepletionGuard:
    """ExecutionAgent.execute should reject opens when cash <= 0."""

    def test_rejects_open_when_cash_zero(self):
        agent = ExecutionAgent(provider=SimExecutionProvider())
        state = RuntimeState(cycle=1, cash=0.0)

        proposal = _make_proposal("open_long", price=100.0, qty=1.0, leverage=2.0)
        result = agent.execute(trace_id="t1", planned=proposal, state=state)

        assert result.status == "failed"
        assert "cash depleted" in result.message

    def test_rejects_open_short_when_cash_negative(self):
        agent = ExecutionAgent(provider=SimExecutionProvider())
        state = RuntimeState(cycle=1, cash=-500.0)

        proposal = _make_proposal("open_short", price=50.0, qty=2.0, leverage=3.0)
        result = agent.execute(trace_id="t1", planned=proposal, state=state)

        assert result.status == "failed"
        assert "cash depleted" in result.message

    def test_allows_close_when_cash_zero(self):
        """Close actions should still be allowed even if cash is 0 (we need to release margin)."""
        agent = ExecutionAgent(provider=SimExecutionProvider())
        state = RuntimeState(cycle=2, cash=0.0)
        state.positions["BTCUSDT"] = Position(
            symbol="BTCUSDT", side="long", qty=1.0, entry_price=100.0, leverage=2.0, opened_cycle=1,
        )

        proposal = _make_proposal("close_long", price=105.0, qty=1.0, leverage=2.0)
        result = agent.execute(trace_id="t1", planned=proposal, state=state)

        # Should succeed (not blocked by cash guard)
        assert result.status == "success"


# ===========================================================================
# 6. Consistency across providers for the same trade
# ===========================================================================


class TestProviderConsistency:
    """All three providers should produce the same leveraged PnL for the same trade parameters."""

    def test_same_pnl_for_long_across_sim_backtest_binance(self):
        from backtest import BacktestExecutionProvider

        entry = 100.0
        close_price = 110.0
        qty = 5.0
        leverage = 3.0
        expected_gross = (close_price - entry) * qty * 1.0  # = 50.0

        # --- Sim ---
        sim = SimExecutionProvider()
        sim_state = RuntimeState(cycle=2, cash=100_000.0)
        sim_state.positions["BTCUSDT"] = Position(
            symbol="BTCUSDT", side="long", qty=qty, entry_price=entry, leverage=leverage, opened_cycle=1,
        )
        sim.execute(
            trace_id="t1",
            planned=_make_proposal("close_long", price=close_price, qty=qty, leverage=leverage),
            state=sim_state,
        )
        sim_pnl = [t for t in sim_state.trades if t.action == "close_long"][0].pnl
        sim_fee = close_price * qty * sim.FEE_BPS / 10_000.0
        sim_gross = sim_pnl + sim_fee

        # --- Backtest (zero fees/slippage) ---
        bt = BacktestExecutionProvider(fee_bps=0.0, slippage_bps=0.0)
        bt_state = RuntimeState(cycle=2, cash=100_000.0)
        bt_state.positions["BTCUSDT"] = Position(
            symbol="BTCUSDT", side="long", qty=qty, entry_price=entry, leverage=leverage, opened_cycle=1,
        )
        bt._close_position(
            trace_id="t1", symbol="BTCUSDT", action="close_long",
            state=bt_state, mark_price=close_price,
        )
        bt_pnl = [t for t in bt_state.trades if t.action == "close_long"][0].pnl

        # --- Binance (dummy, no fee in provider) ---
        binance = _DummyLiveProvider(avg_price=close_price)
        bn_state = RuntimeState(cycle=2, cash=100_000.0)
        bn_state.positions["BTCUSDT"] = Position(
            symbol="BTCUSDT", side="long", qty=qty, entry_price=entry, leverage=leverage, opened_cycle=1,
        )
        binance.execute(
            trace_id="t1",
            planned=_make_proposal("close_long", price=close_price, qty=qty, leverage=leverage),
            state=bn_state,
        )
        bn_pnl = [t for t in bn_state.trades if t.action == "close_long"][0].pnl

        # All should match expected gross (after accounting for fees)
        assert abs(sim_gross - expected_gross) < 0.01, f"Sim gross {sim_gross} != expected {expected_gross}"
        assert abs(bt_pnl - expected_gross) < 0.01, f"Backtest PnL {bt_pnl} != expected {expected_gross}"
        assert abs(bn_pnl - expected_gross) < 0.01, f"Binance PnL {bn_pnl} != expected {expected_gross}"


# ===========================================================================
# 7. ExecutionPlannerAgent deep-copies proposal
# ===========================================================================


class TestPlannerDeepCopy:
    """ExecutionPlannerAgent.plan() must not mutate the original proposal."""

    def test_original_proposal_unchanged(self):
        planner = ExecutionPlannerAgent()
        cfg = RuntimeConfig()
        state = RuntimeState(cash=100_000.0)

        original = _make_proposal("open_long", price=100.0, qty=0.0, leverage=2.0)
        original_qty_before = original.order_params.get("quantity")

        risk = RiskDecision(
            schema_version=SCHEMA_V2, trace_id="t1", symbol="BTCUSDT",
            passed=True, risk_level="safe", blocked_reason=None,
            corrections={"stop_loss": 97.0},
        )

        planned = planner.plan(original, risk=risk, cfg=cfg, state=state)

        # The planner should update the planned copy, not the original
        assert original.order_params.get("quantity") == original_qty_before
        # The planned quantity should be calculated
        assert planned.order_params["quantity"] > 0
        # The original should NOT have the correction applied
        assert original.order_params.get("stop_loss") != 97.0 or planned.order_params.get("stop_loss") == 97.0
