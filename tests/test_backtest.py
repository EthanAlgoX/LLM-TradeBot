from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from backtest import BacktestBar, BacktestExecutionProvider, BacktestMarketRankProvider, BacktestRunner, CSVBacktestDataset, render_backtest_markdown
from config import RuntimeConfig
from contracts import ProposedAction
from state import Position, RuntimeState


def _write_sample_csv(path):
    symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    base = datetime(2026, 1, 1, 0, 0, 0)
    lines = ["ts,symbol,close,quote_volume"]
    for i in range(60):
        ts = (base + timedelta(minutes=i)).isoformat()
        for j, sym in enumerate(symbols):
            # deterministic but different trend per symbol
            close = 100.0 + i * (0.2 + j * 0.1) + j * 5.0
            qv = 1000.0 + i * 15.0 + j * 70.0
            lines.append(f"{ts},{sym},{close:.6f},{qv:.2f}")
    path.write_text("\n".join(lines), encoding="utf-8")


def test_backtest_dataset_load_and_filter(tmp_path):
    csv_path = tmp_path / "bars.csv"
    _write_sample_csv(csv_path)

    dataset = CSVBacktestDataset.from_csv(str(csv_path), symbols=["BTCUSDT", "ETHUSDT"], max_steps=20)

    assert dataset.steps == 20
    assert dataset.symbols == ["BTCUSDT", "ETHUSDT"]
    assert dataset.start_ts().isoformat().startswith("2026-01-01T00:00:00")


def test_backtest_market_rank_no_lookahead_on_first_cycle(tmp_path):
    csv_path = tmp_path / "bars.csv"
    _write_sample_csv(csv_path)
    dataset = CSVBacktestDataset.from_csv(str(csv_path), symbols=["BTCUSDT"], max_steps=5)

    rank_provider = BacktestMarketRankProvider(dataset)
    out = rank_provider.snapshot(["BTCUSDT"], cycle=1)

    assert "BTCUSDT" in out
    assert "trend=0.00%" in out["BTCUSDT"].reason


def test_backtest_dataset_aligns_on_timestamp_intersection(tmp_path):
    csv_path = tmp_path / "misaligned.csv"
    csv_path.write_text(
        "\n".join(
            [
                "ts,symbol,close,quote_volume",
                "2026-01-01T00:00:00,BTCUSDT,100,1000",
                "2026-01-01T00:00:00,ETHUSDT,200,1200",
                "2026-01-01T00:01:00,BTCUSDT,101,1001",
                "2026-01-01T00:02:00,BTCUSDT,102,1002",
                "2026-01-01T00:02:00,ETHUSDT,202,1202",
            ]
        ),
        encoding="utf-8",
    )

    dataset = CSVBacktestDataset.from_csv(str(csv_path), symbols=["BTCUSDT", "ETHUSDT"])
    assert dataset.steps == 2
    assert dataset.start_ts().isoformat().startswith("2026-01-01T00:00:00")
    assert dataset.end_ts().isoformat().startswith("2026-01-01T00:02:00")
    assert [x.ts.isoformat() for x in dataset.bars_by_symbol["BTCUSDT"]] == [
        "2026-01-01T00:00:00",
        "2026-01-01T00:02:00",
    ]


def test_backtest_runner_outputs_report(tmp_path):
    csv_path = tmp_path / "bars.csv"
    _write_sample_csv(csv_path)

    cfg = RuntimeConfig()
    runner = BacktestRunner(
        cfg=cfg,
        csv_path=str(csv_path),
        symbols=["BTCUSDT", "ETHUSDT", "SOLUSDT"],
        max_steps=30,
    )
    out = runner.run(include_trades=True)

    assert out["mode"] == "backtest_csv"
    report = out["report"]
    assert report["steps"] == 30
    assert report["initial_cash"] == cfg.initial_cash
    assert report["fee_bps"] == cfg.backtest_fee_bps
    assert report["slippage_bps"] == cfg.backtest_slippage_bps
    assert "total_fees" in report
    assert "expectancy" in report
    assert "profit_factor" in report
    assert "sharpe" in report
    assert "final_cash" in report
    assert "max_drawdown_pct" in report
    assert "total_funding_pnl" in report
    assert "funding_rate_bps_per_cycle" in report
    assert "sharpe_equity" in report
    assert "max_drawdown_equity_pct" in report
    assert "unrealized_pnl" in report
    assert "final_equity" in report
    assert "open_positions_end" in report
    assert "forced_close_count" in report
    assert "auto_risk_close_count" in report
    assert "auto_risk_close_breakdown" in report
    assert "partial_open_count" in report
    assert "retried_open_count" in report
    assert "rejected_open_count" in report
    assert "cycle_status_counts" in report
    assert "execution_attempts" in report
    assert "execution_successes" in report
    assert "execution_success_rate" in report
    assert "directional_total" in report
    assert "directional_correct" in report
    assert "directional_flats" in report
    assert "directional_accuracy_pct" in report
    assert "open_source_match_rate_pct" in report
    assert "unmatched_close_count" in report
    assert "source_accuracy" in report
    assert isinstance(report["source_accuracy"], list)
    assert report["execution_attempts"] >= report["execution_successes"] >= 0
    if report["source_accuracy"]:
        top_source = report["source_accuracy"][0]
        assert "source" in top_source
        assert "accuracy_pct" in top_source
        assert "closed_trades" in top_source
    assert "equity_curve" in out
    assert "equity_curve_mtm" in out
    assert len(out["equity_curve"]) == len(out["equity_curve_mtm"])
    assert "forced_closes" in out
    assert report["open_positions_end"] == 0
    assert report["final_equity"] == pytest.approx(report["final_cash"], rel=0, abs=1e-6)
    assert "trades" in out
    assert out["last_cycle"]["cycle"] == 30


def test_backtest_execution_provider_applies_fee_and_slippage():
    provider = BacktestExecutionProvider(fee_bps=10.0, slippage_bps=0.0)
    state = RuntimeState(cycle=1, cash=10_000.0)

    open_long = ProposedAction(
        schema_version="v2",
        trace_id="t1",
        symbol="BTCUSDT",
        source="rule",
        action="open_long",
        confidence=80.0,
        reason="test",
        order_params={"entry_price": 100.0, "quantity": 1.0, "leverage": 1.0},
    )
    close_long = ProposedAction(
        schema_version="v2",
        trace_id="t2",
        symbol="BTCUSDT",
        source="rule",
        action="close_long",
        confidence=80.0,
        reason="test",
        order_params={"entry_price": 100.0, "quantity": 1.0, "leverage": 1.0},
    )

    r1 = provider.execute(trace_id="t1", planned=open_long, state=state)
    assert r1.status == "success"
    assert state.cash == pytest.approx(9_899.9, rel=0, abs=1e-9)

    state.cycle = 2
    r2 = provider.execute(trace_id="t2", planned=close_long, state=state)
    assert r2.status == "success"
    assert state.cash == pytest.approx(9_999.8, rel=0, abs=1e-9)
    assert provider.total_fees_paid == pytest.approx(0.2, rel=0, abs=1e-9)


def test_backtest_execution_provider_uses_next_bar_fill_with_dataset():
    bars = [
        BacktestBar(ts=datetime(2026, 1, 1, 0, 0, 0), symbol="BTCUSDT", close=100.0, quote_volume=1000.0),
        BacktestBar(ts=datetime(2026, 1, 1, 1, 0, 0), symbol="BTCUSDT", close=110.0, quote_volume=1100.0),
        BacktestBar(ts=datetime(2026, 1, 1, 2, 0, 0), symbol="BTCUSDT", close=120.0, quote_volume=1200.0),
    ]
    dataset = CSVBacktestDataset(bars_by_symbol={"BTCUSDT": bars}, steps=3, source_path="synthetic.csv")
    provider = BacktestExecutionProvider(fee_bps=0.0, slippage_bps=0.0, dataset=dataset)
    state = RuntimeState(cycle=1, cash=1_000.0)

    open_long = ProposedAction(
        schema_version="v2",
        trace_id="t1",
        symbol="BTCUSDT",
        source="rule",
        action="open_long",
        confidence=80.0,
        reason="test",
        order_params={"entry_price": 100.0, "quantity": 1.0, "leverage": 1.0},
    )
    close_long = ProposedAction(
        schema_version="v2",
        trace_id="t2",
        symbol="BTCUSDT",
        source="rule",
        action="close_long",
        confidence=80.0,
        reason="test",
        order_params={"entry_price": 110.0, "quantity": 1.0, "leverage": 1.0},
    )

    r1 = provider.execute(trace_id="t1", planned=open_long, state=state)
    assert r1.status == "success"
    assert r1.fill_price == pytest.approx(110.0, rel=0, abs=1e-9)
    assert state.positions["BTCUSDT"].entry_price == pytest.approx(110.0, rel=0, abs=1e-9)

    state.cycle = 2
    r2 = provider.execute(trace_id="t2", planned=close_long, state=state)
    assert r2.status == "success"
    assert r2.fill_price == pytest.approx(120.0, rel=0, abs=1e-9)
    assert state.cash == pytest.approx(1_010.0, rel=0, abs=1e-9)


def test_backtest_execution_provider_auto_take_profit_trigger():
    bars = [
        BacktestBar(ts=datetime(2026, 1, 1, 0, 0, 0), symbol="BTCUSDT", close=100.0, quote_volume=1000.0),
        BacktestBar(ts=datetime(2026, 1, 1, 1, 0, 0), symbol="BTCUSDT", close=110.0, quote_volume=1100.0),
        BacktestBar(ts=datetime(2026, 1, 1, 2, 0, 0), symbol="BTCUSDT", close=130.0, quote_volume=1200.0),
    ]
    dataset = CSVBacktestDataset(bars_by_symbol={"BTCUSDT": bars}, steps=3, source_path="synthetic.csv")
    provider = BacktestExecutionProvider(fee_bps=0.0, slippage_bps=0.0, dataset=dataset)
    state = RuntimeState(cycle=1, cash=1_000.0)

    open_long = ProposedAction(
        schema_version="v2",
        trace_id="t1",
        symbol="BTCUSDT",
        source="rule",
        action="open_long",
        confidence=80.0,
        reason="test",
        order_params={
            "entry_price": 100.0,
            "stop_loss": 90.0,
            "take_profit": 120.0,
            "quantity": 1.0,
            "leverage": 1.0,
        },
    )
    r1 = provider.execute(trace_id="t1", planned=open_long, state=state)
    assert r1.status == "success"
    assert state.positions["BTCUSDT"].entry_price == pytest.approx(110.0, rel=0, abs=1e-9)

    state.cycle = 2
    no_trigger = provider.auto_close_triggered_positions(state=state, cycle=state.cycle)
    assert no_trigger == []
    assert "BTCUSDT" in state.positions

    state.cycle = 3
    triggered = provider.auto_close_triggered_positions(state=state, cycle=state.cycle)
    assert len(triggered) == 1
    assert triggered[0]["trigger"] == "take_profit"
    assert triggered[0]["status"] == "success"
    assert "BTCUSDT" not in state.positions
    assert state.cash == pytest.approx(1_020.0, rel=0, abs=1e-9)


def test_backtest_execution_provider_rejects_duplicate_open():
    provider = BacktestExecutionProvider(fee_bps=0.0, slippage_bps=0.0)
    state = RuntimeState(cycle=1, cash=1_000.0)

    open_long = ProposedAction(
        schema_version="v2",
        trace_id="t1",
        symbol="BTCUSDT",
        source="rule",
        action="open_long",
        confidence=80.0,
        reason="test",
        order_params={"entry_price": 100.0, "stop_loss": 90.0, "take_profit": 120.0, "quantity": 1.0, "leverage": 1.0},
    )
    r1 = provider.execute(trace_id="t1", planned=open_long, state=state)
    assert r1.status == "success"

    state.cycle = 2
    open_short = ProposedAction(
        schema_version="v2",
        trace_id="t2",
        symbol="BTCUSDT",
        source="rule",
        action="open_short",
        confidence=80.0,
        reason="test",
        order_params={"entry_price": 100.0, "stop_loss": 110.0, "take_profit": 80.0, "quantity": 1.0, "leverage": 1.0},
    )
    r2 = provider.execute(trace_id="t2", planned=open_short, state=state)
    assert r2.status == "failed"
    assert "position already open" in r2.message


def test_backtest_execution_provider_checks_margin_before_open():
    provider = BacktestExecutionProvider(fee_bps=0.0, slippage_bps=0.0)
    state = RuntimeState(cycle=1, cash=10.0)

    open_long = ProposedAction(
        schema_version="v2",
        trace_id="t1",
        symbol="BTCUSDT",
        source="rule",
        action="open_long",
        confidence=80.0,
        reason="test",
        order_params={"entry_price": 100.0, "stop_loss": 90.0, "take_profit": 120.0, "quantity": 1.0, "leverage": 1.0},
    )
    r = provider.execute(trace_id="t1", planned=open_long, state=state)
    assert r.status == "failed"
    assert "insufficient cash for margin" in r.message
    assert "BTCUSDT" not in state.positions


def test_backtest_execution_provider_partial_fill_with_retry():
    bars = [
        BacktestBar(ts=datetime(2026, 1, 1, 0, 0, 0), symbol="BTCUSDT", close=100.0, quote_volume=1000.0),
        BacktestBar(ts=datetime(2026, 1, 1, 1, 0, 0), symbol="BTCUSDT", close=100.0, quote_volume=50.0),
        BacktestBar(ts=datetime(2026, 1, 1, 2, 0, 0), symbol="BTCUSDT", close=100.0, quote_volume=200.0),
    ]
    dataset = CSVBacktestDataset(bars_by_symbol={"BTCUSDT": bars}, steps=3, source_path="synthetic.csv")
    provider = BacktestExecutionProvider(
        fee_bps=0.0,
        slippage_bps=0.0,
        dataset=dataset,
        max_open_notional_share_of_bar=0.5,
        max_open_retries=1,
    )
    state = RuntimeState(cycle=1, cash=1_000.0)
    open_long = ProposedAction(
        schema_version="v2",
        trace_id="t1",
        symbol="BTCUSDT",
        source="rule",
        action="open_long",
        confidence=80.0,
        reason="test",
        order_params={"entry_price": 100.0, "stop_loss": 90.0, "take_profit": 120.0, "quantity": 1.0, "leverage": 1.0},
    )
    r = provider.execute(trace_id="t1", planned=open_long, state=state)
    assert r.status == "success"
    assert state.positions["BTCUSDT"].qty == pytest.approx(1.0, rel=0, abs=1e-9)
    assert "retries=1" in r.message
    assert provider.retried_open_count == 1
    assert provider.partial_open_count == 0


def test_backtest_execution_provider_rejects_when_no_liquidity():
    bars = [
        BacktestBar(ts=datetime(2026, 1, 1, 0, 0, 0), symbol="BTCUSDT", close=100.0, quote_volume=1000.0),
        BacktestBar(ts=datetime(2026, 1, 1, 1, 0, 0), symbol="BTCUSDT", close=100.0, quote_volume=0.0),
        BacktestBar(ts=datetime(2026, 1, 1, 2, 0, 0), symbol="BTCUSDT", close=100.0, quote_volume=0.0),
    ]
    dataset = CSVBacktestDataset(bars_by_symbol={"BTCUSDT": bars}, steps=3, source_path="synthetic.csv")
    provider = BacktestExecutionProvider(
        fee_bps=0.0,
        slippage_bps=0.0,
        dataset=dataset,
        max_open_notional_share_of_bar=0.5,
        max_open_retries=1,
    )
    state = RuntimeState(cycle=1, cash=1_000.0)
    open_long = ProposedAction(
        schema_version="v2",
        trace_id="t1",
        symbol="BTCUSDT",
        source="rule",
        action="open_long",
        confidence=80.0,
        reason="test",
        order_params={"entry_price": 100.0, "stop_loss": 90.0, "take_profit": 120.0, "quantity": 1.0, "leverage": 1.0},
    )
    r = provider.execute(trace_id="t1", planned=open_long, state=state)
    assert r.status == "failed"
    assert "insufficient liquidity" in r.message
    assert provider.rejected_open_count == 1
    assert "BTCUSDT" not in state.positions


def test_backtest_runner_apply_funding_positive_rate_long_pays(tmp_path):
    csv_path = tmp_path / "bars.csv"
    csv_path.write_text(
        "\n".join(
            [
                "ts,symbol,close,quote_volume",
                "2026-01-01T00:00:00,BTCUSDT,100,1000",
                "2026-01-01T01:00:00,BTCUSDT,100,1000",
            ]
        ),
        encoding="utf-8",
    )
    cfg = RuntimeConfig(backtest_funding_rate_bps_per_cycle=10.0)
    runner = BacktestRunner(cfg=cfg, csv_path=str(csv_path), symbols=["BTCUSDT"], max_steps=2)
    state = RuntimeState(cycle=1, cash=1_000.0)
    state.positions["BTCUSDT"] = Position(
        symbol="BTCUSDT",
        side="long",
        qty=1.0,
        entry_price=100.0,
        leverage=1.0,
        opened_cycle=1,
    )
    events: list[dict[str, object]] = []
    pnl = runner._apply_funding(state=state, cycle=1, funding_rate_bps=10.0, sink=events)
    assert pnl == pytest.approx(-0.1, rel=0, abs=1e-9)
    assert state.cash == pytest.approx(999.9, rel=0, abs=1e-9)
    assert len(events) == 1
    assert events[0]["symbol"] == "BTCUSDT"
    assert events[0]["pnl"] == pytest.approx(-0.1, rel=0, abs=1e-9)


def test_backtest_grid_runs_and_sorts(tmp_path):
    csv_path = tmp_path / "bars.csv"
    _write_sample_csv(csv_path)

    cfg = RuntimeConfig()
    runner = BacktestRunner(cfg=cfg, csv_path=str(csv_path), symbols=["BTCUSDT", "ETHUSDT", "SOLUSDT"], max_steps=20)
    out = runner.run_grid(fee_bps_grid=[0.0, 3.0], slippage_bps_grid=[0.0, 2.0], top_n=2)

    assert out["mode"] == "backtest_grid"
    assert out["runs"] == 4
    assert isinstance(out["results"], list)
    assert len(out["results"]) == 4
    assert out["best"] == out["results"][0]
    best_cash = float(out["results"][0]["final_cash"])
    worst_cash = float(out["results"][-1]["final_cash"])
    assert best_cash >= worst_cash
    assert "funding_rate_bps_per_cycle" in out["results"][0]
    assert "partial_open_count" in out["results"][0]
    assert "retried_open_count" in out["results"][0]
    assert "rejected_open_count" in out["results"][0]
    assert "total_funding_pnl" in out["results"][0]
    analysis = out["analysis"]
    assert isinstance(analysis, dict)
    assert len(analysis["top_results"]) == 2
    assert len(analysis["fee_sensitivity"]) == 2
    assert len(analysis["slippage_sensitivity"]) == 2
    assert len(analysis["funding_sensitivity"]) == 1
    assert float(analysis["spread_final_cash"]) >= 0
    assert "recommendations" in analysis
    rec = analysis["recommendations"]
    assert rec["recommended_params"] is not None
    assert "cost_tolerance" in rec
    assert "notes" in rec
    assert "command_templates" in rec
    assert len(rec["command_templates"]) >= 1
    assert "tradebot --backtest-csv" in rec["command_templates"][0]["command"]
    assert analysis["constrained_count"] == 4
    assert analysis["constrained_best_result"] is not None

    out2 = runner.run_grid(
        fee_bps_grid=[0.0, 3.0],
        slippage_bps_grid=[0.0, 2.0],
        top_n=2,
        max_drawdown_pct=0.0,
        min_closed_trades=999,
    )
    analysis2 = out2["analysis"]
    assert analysis2["constraint"]["max_drawdown_pct"] == 0.0
    assert analysis2["constraint"]["min_closed_trades"] == 999
    assert analysis2["constrained_count"] == 0
    assert analysis2["constrained_best_result"] is None
    assert len(analysis2["recommendations"]["command_templates"]) >= 1

    out3 = runner.run_grid(
        fee_bps_grid=[0.0, 3.0],
        slippage_bps_grid=[0.0, 2.0],
        top_n=2,
        rank_by="max_drawdown_pct",
    )
    assert out3["rank_by"] == "max_drawdown_pct"
    assert out3["rank_order"] == "asc"
    results3 = out3["results"]
    assert float(results3[0]["max_drawdown_pct"]) <= float(results3[-1]["max_drawdown_pct"])

    out4 = runner.run_grid(
        fee_bps_grid=[0.0, 3.0],
        slippage_bps_grid=[0.0, 2.0],
        funding_rate_bps_grid=[0.0, 1.0],
        top_n=2,
    )
    assert out4["runs"] == 8
    assert len(out4["analysis"]["funding_sensitivity"]) == 2

    md = render_backtest_markdown(out3, top_n=2)
    assert "# Backtest Summary (backtest_grid)" in md
    assert "## Top Results" in md


def test_render_backtest_markdown_csv(tmp_path):
    csv_path = tmp_path / "bars.csv"
    _write_sample_csv(csv_path)
    cfg = RuntimeConfig()
    runner = BacktestRunner(cfg=cfg, csv_path=str(csv_path), symbols=["BTCUSDT", "ETHUSDT", "SOLUSDT"], max_steps=10)
    out = runner.run()
    md = render_backtest_markdown(out)
    assert "# Backtest Summary (backtest_csv)" in md
    assert "## Report" in md
    assert "Directional Accuracy(%)" in md
