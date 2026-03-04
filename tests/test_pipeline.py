import asyncio

from tradebot.orchestrator import MultiAgentTradeBot


def test_pipeline_runs_and_selects_top10():
    bot = MultiAgentTradeBot()
    result = asyncio.run(bot.run_cycle())

    assert result.schema_version == "v2"
    assert len(result.selected_symbols) == 10
    assert result.status in {"success", "blocked", "wait"}
    assert result.action in {"open_long", "open_short", "close_long", "close_short", "wait", "hold"}
    assert "cash" in result.details
