
import asyncio
import pandas as pd
import numpy as np
from src.backtest.agent_wrapper import BacktestAgentRunner
from src.agents.data_sync_agent import MarketSnapshot

def create_mock_snapshot():
    """Create a mock market snapshot with trending data"""
    dates = pd.date_range(start='2024-01-01', periods=100, freq='5min')
    
    # Create an uptrend
    price = np.linspace(50000, 55000, 100)
    # Add some noise
    price += np.random.normal(0, 100, 100)
    
    df = pd.DataFrame({
        'open': price,
        'high': price + 50,
        'low': price - 50,
        'close': price,
        'volume': np.random.uniform(100, 1000, 100)
    }, index=dates)
    
    # 1h dataframe (resampled)
    df_1h = df.resample('1h').agg({
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last',
        'volume': 'sum'
    })
    
    snapshot = MarketSnapshot(
        stable_5m=df,
        stable_15m=df, # Reusing for simplicity
        stable_1h=df_1h,
        live_5m={'close': price[-1], 'open': price[-1]},
        live_15m={},
        live_1h={},
        timestamp=dates[-1],
        alignment_ok=True,
        fetch_duration=0
    )
    return snapshot

def test_agent_runner():
    print("🧪 Testing BacktestAgentRunner...")
    
    # 1. Initialize
    runner = BacktestAgentRunner()
    print("✅ Initialized")
    
    # 2. Create Data
    snapshot = create_mock_snapshot()
    print(f"📊 Created mock snapshot with close price: {snapshot.live_5m['close']:.2f}")
    
    # 3. Run Step
    print("🏃 Running step()...")
    decision = asyncio.run(runner.step(snapshot))
    
    # 4. Verify Output
    print("\n📋 Decision Result:")
    print(f"   Action: {decision.get('action')}")
    print(f"   Confidence: {decision.get('confidence')}")
    print(f"   Reason: {decision.get('reason')}")
    print(f"   Weighted Score: {decision.get('weighted_score')}")
    
    assert 'action' in decision
    assert 'confidence' in decision
    assert 'reason' in decision
    
    if decision['confidence'] > 0:
        print("✅ Decision logic produced a result with confidence")
    else:
        print("⚠️ Decision confidence is 0 (might be expected for short data)")
        
    print("\n✅ Test Passed!")

if __name__ == "__main__":
    test_agent_runner()
