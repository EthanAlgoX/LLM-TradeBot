import json
from datetime import datetime, timezone

import pandas as pd
from fastapi.testclient import TestClient
from src.server.app import app
from unittest.mock import patch


def test_backtest_stream_endpoint():
    print("🧪 Testing Backtest Streaming Endpoint...")

    mock_request = {
        "symbol": "BTCUSDT",
        "start_date": "2024-01-01",
        "end_date": "2024-01-02",
        "initial_capital": 10000,
        "strategy_mode": "technical"
    }

    class FakeMetrics(dict):
        def to_dict(self):
            return dict(self)

    class FakeBacktestResult:
        def __init__(self):
            idx = [datetime(2024, 1, 1, tzinfo=timezone.utc)]
            self.metrics = FakeMetrics(
                total_return=0.05,
                max_drawdown_pct=1.2,
                total_trades=1,
                win_rate=100.0,
                sharpe_ratio=1.0,
            )
            self.equity_curve = pd.DataFrame(
                {"total_equity": [10050.0], "drawdown_pct": [0.0]},
                index=idx,
            )
            self.trades = []
            self.decisions = [
                {
                    "timestamp": idx[0],
                    "action": "open_long",
                    "confidence": 72,
                    "reason": "mocked decision",
                    "vote_details": {"trend_1h": 15},
                    "price": 42000.0,
                }
            ]
            self.duration_seconds = 0.01

    class FakeBacktestEngine:
        def __init__(self, config):
            self.config = config
            self.data_replay = None
            self.agent_runner = None

        async def run(self, progress_callback=None):
            if progress_callback is not None:
                await progress_callback(
                    {
                        "progress": 50,
                        "current_timepoint": 1,
                        "total_timepoints": 2,
                        "current_equity": 10020.0,
                        "profit": 20.0,
                        "profit_pct": 0.2,
                        "latest_equity_point": {
                            "timestamp": "2024-01-01T00:00:00+00:00",
                            "total_equity": 10020.0,
                            "drawdown_pct": 0.0,
                        },
                        "latest_trade": None,
                        "metrics": {"total_trades": 1},
                    }
                )
            return FakeBacktestResult()

    class FakeBacktestStorage:
        def save_backtest(self, **kwargs):
            return 1

    client = TestClient(app)
    from src.server.app import verify_auth
    app.dependency_overrides[verify_auth] = lambda: True

    try:
        with patch("src.backtest.engine.BacktestEngine", FakeBacktestEngine), patch(
            "src.backtest.storage.BacktestStorage", FakeBacktestStorage
        ):
            print("🚀 Sending request...")
            with client.stream("POST", "/api/backtest/run", json=mock_request) as response:
                print(f"📡 Status Code: {response.status_code}")
                assert response.status_code == 200

                progress_count = 0
                has_result = False

                for line in response.iter_lines():
                    if not line:
                        continue

                    data = json.loads(line)
                    print(f"📦 Received Chunk: {data.get('type')}")

                    if data["type"] == "progress":
                        progress_count += 1
                        assert "percent" in data
                    elif data["type"] == "result":
                        has_result = True
                        assert "metrics" in data["data"]
                        if "id" in data["data"]:
                            print(f"✅ Received Backtest ID: #{data['data']['id']}")
                    elif data["type"] == "error":
                        raise AssertionError(f"Unexpected error: {data['message']}")

                print(f"✅ Received {progress_count} progress updates")
                print(f"✅ Received Final Result: {has_result}")
                assert has_result
                assert progress_count >= 1
    finally:
        app.dependency_overrides.pop(verify_auth, None)

if __name__ == "__main__":
    # Manually run the async test logic if not using pytest runner
    # But TestClient is synchronous wrapper around ASGI.
    # The stream() method returns a sync iterator.
    
    test_backtest_stream_endpoint()
