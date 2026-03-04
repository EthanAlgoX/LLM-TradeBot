from agents.risk import RiskAuditAgent
from config import RuntimeConfig
from contracts import ProposedAction
from state import RuntimeState


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
