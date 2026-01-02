
import os
import sys
import pandas as pd
from datetime import datetime, timedelta

# Add src to path
sys.path.append(os.getcwd())

from src.backtest.data_replay import DataReplayAgent, DataCache

def verify_fix():
    print("🧪 Verifying DataReplayAgent Lookback Fix...")
    
    # Setup Mock Data
    end_date = datetime(2026, 1, 2)
    start_date = datetime(2026, 1, 1)
    
    # Generate 40 days of 1h data (approx 960 hours)
    dates_1h = pd.date_range(end=end_date, periods=1000, freq="1h")
    df_1h = pd.DataFrame(index=dates_1h, data={
        "open": 100, "high": 105, "low": 95, "close": 102, "volume": 1000
    })
    
    # Generate corresponding 5m data (just needed to avoid errors)
    dates_5m = pd.date_range(end=end_date, periods=12000, freq="5min")
    df_5m = pd.DataFrame(index=dates_5m, data={
        "open": 100, "high": 105, "low": 95, "close": 102, "volume": 100
    })
    
     # Generate corresponding 15m data
    dates_15m = pd.date_range(end=end_date, periods=4000, freq="15min")
    df_15m = pd.DataFrame(index=dates_15m, data={
        "open": 100, "high": 105, "low": 95, "close": 102, "volume": 100
    })

    # Instantiate Agent
    agent = DataReplayAgent("BTCUSDT", "2026-01-01", "2026-01-02")
    
    # Inject Mock Cache
    agent.data_cache = DataCache(
        symbol="BTCUSDT",
        df_5m=df_5m,
        df_15m=df_15m,
        df_1h=df_1h,
        start_date=start_date,
        end_date=end_date
    )
    
    # Test get_snapshot_at with default lookback (which was 300)
    # Passed explicitly as 300 to mimic potential old calls, or let it use default 1000
    # Let's test with lookback=300 to prove the `max(..., 100)` logic works
    
    timestamp = datetime(2026, 1, 1, 12, 0, 0)
    print(f"\nTesting snapshot at {timestamp} with lookback=300 (Old bug scenario)...")
    
    snapshot = agent.get_snapshot_at(timestamp, lookback=300)
    
    len_1h = len(snapshot.stable_1h)
    len_15m = len(snapshot.stable_15m)
    
    print(f"📉 1h Data Length: {len_1h}")
    print(f"📉 15m Data Length: {len_15m}")
    
    # Verification
    # Requirement: QuantAnalystAgent needs 60 candles for EMA60
    # Our fix asks for 100 candles total, so stable history is 99 candles.
    
    if len_1h >= 60:
        print(f"\n✅ PASS: 1h data length is {len_1h} (Requirement >= 60)")
    else:
        print(f"\n❌ FAIL: 1h data length is {len_1h} (Requirement >= 60)")

    if len_15m >= 60:
         print(f"✅ PASS: 15m data length is {len_15m} (Requirement >= 60)")
    else:
        print(f"❌ FAIL: 15m data length is {len_15m}")

if __name__ == "__main__":
    verify_fix()
