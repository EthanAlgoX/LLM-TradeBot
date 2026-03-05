from agents.risk import RiskAuditAgent
from config import RuntimeConfig
from contracts import ProposedAction
from state import Position, RuntimeState


def test_risk_blocks_over_leverage():
    cfg = RuntimeConfig()
    cfg.risk.max_leverage = 2.0
    agent = RiskAuditAgent(cfg)
    state = RuntimeState(cash=10_000)

    proposal = ProposedAction(
        schema_version="v2",
        trace_id="t1",
        symbol="BTCUSDT",
        source="rule",
        action="open_long",
        confidence=70.0,
        reason="test",
        order_params={
            "entry_price": 100.0,
            "stop_loss": 98.0,
            "take_profit": 104.0,
            "leverage": 5.0,
            "quantity": 1.0,
        },
    )

    result = agent.audit(trace_id="t1", proposal=proposal, state=state)
    assert result.passed is False
    assert result.blocked_reason is not None


def test_risk_blocks_when_max_concurrent_positions_reached():
    """New open should be blocked when concurrent positions >= max_concurrent_positions."""
    cfg = RuntimeConfig()
    cfg.risk.max_concurrent_positions = 2
    agent = RiskAuditAgent(cfg)
    state = RuntimeState(cash=100_000)
    # Pre-fill 2 positions
    state.positions["ETHUSDT"] = Position(symbol="ETHUSDT", side="long", qty=1.0, entry_price=2000.0, leverage=3.0, opened_cycle=1)
    state.positions["SOLUSDT"] = Position(symbol="SOLUSDT", side="long", qty=10.0, entry_price=100.0, leverage=2.0, opened_cycle=1)

    proposal = ProposedAction(
        schema_version="v2",
        trace_id="t2",
        symbol="BTCUSDT",
        source="rule",
        action="open_long",
        confidence=80.0,
        reason="test",
        order_params={
            "entry_price": 50000.0,
            "stop_loss": 49000.0,
            "take_profit": 53000.0,
            "leverage": 3.0,
            "quantity": 0.04,
        },
    )

    result = agent.audit(trace_id="t2", proposal=proposal, state=state)
    assert result.passed is False
    assert "concurrent positions" in result.blocked_reason


def test_risk_blocks_on_drawdown_breaker():
    """New open should be blocked when account drawdown exceeds max_drawdown_pct."""
    cfg = RuntimeConfig()
    cfg.initial_cash = 100_000.0
    cfg.risk.max_drawdown_pct = 5.0
    agent = RiskAuditAgent(cfg)
    state = RuntimeState(cash=94_000.0)  # 6% drawdown > 5%

    proposal = ProposedAction(
        schema_version="v2",
        trace_id="t3",
        symbol="BTCUSDT",
        source="rule",
        action="open_long",
        confidence=80.0,
        reason="test",
        order_params={
            "entry_price": 50000.0,
            "stop_loss": 49000.0,
            "take_profit": 53000.0,
            "leverage": 2.0,
            "quantity": 0.04,
        },
    )

    result = agent.audit(trace_id="t3", proposal=proposal, state=state)
    assert result.passed is False
    assert "circuit breaker" in result.blocked_reason


def test_risk_allows_close_without_rr_check():
    """Close actions should pass risk audit without stop/take parameters."""
    cfg = RuntimeConfig()
    agent = RiskAuditAgent(cfg)
    state = RuntimeState(cash=100_000)
    state.positions["BTCUSDT"] = Position(symbol="BTCUSDT", side="long", qty=0.5, entry_price=50000.0, leverage=3.0, opened_cycle=1)

    proposal = ProposedAction(
        schema_version="v2",
        trace_id="t4",
        symbol="BTCUSDT",
        source="rule",
        action="close_long",
        confidence=72.0,
        reason="reversal",
        order_params={
            "entry_price": 49000.0,
            "stop_loss": 0.0,
            "take_profit": 0.0,
            "leverage": 1.0,
            "quantity": 0.5,
        },
    )

    result = agent.audit(trace_id="t4", proposal=proposal, state=state)
    assert result.passed is True
