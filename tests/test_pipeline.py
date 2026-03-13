import asyncio

from config import RuntimeConfig
from contracts import ProposedAction, RankedSymbol, RiskDecision, SCHEMA_V2, UniverseSet
from orchestrator import MultiAgentTradeBot
from providers.execution import SimExecutionProvider
from state import ExchangeOrderRecord, RuntimeState


def test_pipeline_runs_and_selects_top10():
    bot = MultiAgentTradeBot()
    result = asyncio.run(bot.run_cycle())

    assert result.schema_version == "v2"
    assert len(result.selected_symbols) == 10
    assert result.status in {"success", "blocked", "wait"}
    assert result.action in {"open_long", "open_short", "close_long", "close_short", "wait", "hold"}
    assert "cash" in result.details
    executed = result.details.get("executed", [])
    assert isinstance(executed, list)
    for row in executed:
        assert "source" in row
        assert "confidence" in row
        assert "reason" in row


def test_pipeline_surfaces_execution_resolutions_in_details():
    cfg = RuntimeConfig(execution_auto_cancel_conflicting_pending_orders=True)
    state = RuntimeState(cycle=0, cash=10_000.0)
    state.exchange_orders.append(
        ExchangeOrderRecord(
            trace_id="t-pending",
            cycle=0,
            symbol="BTCUSDT",
            action="open_short",
            requested_qty=1.0,
            executed_qty=0.0,
            requested_price=100.0,
            status="NEW",
            provider="sim",
            reduce_only=False,
            is_active=True,
            exchange_order_id="sim-pending-5",
            side="SELL",
            order_type="LIMIT",
            message="pending short order",
            status_history=["NEW"],
        )
    )
    bot = MultiAgentTradeBot(cfg=cfg, state=state, execution_provider=SimExecutionProvider())

    bot.selector.select = lambda trace_id, state: UniverseSet(  # type: ignore[method-assign]
        schema_version=SCHEMA_V2,
        trace_id=trace_id,
        generated_at="2026-03-13T00:00:00Z",
        top_symbols=[RankedSymbol(symbol="BTCUSDT", rank=1, score=1.0, ai500_score=1.0, market_rank_score=1.0, feedback_score=0.0)],
    )

    async def _fake_analyze_symbol(*, trace_id: str, symbol: str, rank: int) -> ProposedAction:  # noqa: ARG001
        return ProposedAction(
            schema_version=SCHEMA_V2,
            trace_id=trace_id,
            symbol=symbol,
            source="rule",
            action="open_long",
            confidence=80.0,
            reason="test resolution",
            order_params={
                "entry_price": 100.0,
                "stop_loss": 98.0,
                "take_profit": 102.0,
                "leverage": 2.0,
                "quantity": 1.0,
            },
        )

    bot._analyze_symbol = _fake_analyze_symbol  # type: ignore[method-assign]
    bot.portfolio_agent.select = lambda proposals: proposals  # type: ignore[method-assign]
    bot.risk_agent.audit = lambda trace_id, proposal, state: RiskDecision(  # type: ignore[method-assign]
        schema_version=SCHEMA_V2,
        trace_id=trace_id,
        symbol=proposal.symbol,
        passed=True,
        risk_level="safe",
        blocked_reason=None,
    )
    bot.exec_planner.plan = lambda proposal, risk, cfg, state: proposal  # type: ignore[method-assign]

    result = asyncio.run(bot.run_cycle())

    assert len(result.details["execution_resolutions"]) == 1
    resolution = result.details["execution_resolutions"][0]
    assert resolution["kind"] == "cancel_conflicting_pending_order"
    assert result.details["executed"][0]["resolutions"][0]["resolution_result"]["status"] == "success"
