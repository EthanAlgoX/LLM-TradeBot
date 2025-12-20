import asyncio
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '.')))

from src.api.binance_client import BinanceClient
from src.agents.data_sync_agent import DataSyncAgent
from src.agents.quant_analyst_agent import QuantAnalystAgent

async def test_integration():
    print("Testing Binance Native Data Integration...")
    client = BinanceClient()
    
    # Test 1: Funding Rate Cache
    print("\n[Test 1] Funding Rate Cache Check")
    f1 = client.get_funding_rate_with_cache("BTCUSDT")
    print(f"First call (Fresh): {f1}")
    f2 = client.get_funding_rate_with_cache("BTCUSDT")
    print(f"Second call (Cached): {f2}")
    
    # Test 2: Oracle Fetching
    print("\n[Test 2] Oracle Native Data Fetching")
    oracle = DataSyncAgent(client=client)
    snapshot = await oracle.fetch_all_timeframes("BTCUSDT", limit=10)
    print(f"Binance Funding: {snapshot.binance_funding}")
    print(f"Binance OI: {snapshot.binance_oi}")
    
    # Test 3: Sentiment Logic
    print("\n[Test 3] Sentiment Analysis Logic")
    analyst = QuantAnalystAgent()
    report = await analyst.analyze_all_timeframes(snapshot)
    sentiment = report['sentiment']
    print(f"Sentiment Analysis: {sentiment}")
    print(f"Total Sentiment Score: {sentiment.get('total_sentiment_score')}")

if __name__ == "__main__":
    asyncio.run(test_integration())
