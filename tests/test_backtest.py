from __future__ import annotations

from datetime import datetime, timedelta

from tradebot.backtest import BacktestRunner, CSVBacktestDataset
from tradebot.config import RuntimeConfig


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
    out = runner.run()

    assert out["mode"] == "backtest_csv"
    report = out["report"]
    assert report["steps"] == 30
    assert report["initial_cash"] == cfg.initial_cash
    assert "final_cash" in report
    assert "max_drawdown_pct" in report
    assert "cycle_status_counts" in report
    assert out["last_cycle"]["cycle"] == 30
