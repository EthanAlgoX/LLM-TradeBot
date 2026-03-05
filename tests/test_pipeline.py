import asyncio

from orchestrator import MultiAgentTradeBot


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
