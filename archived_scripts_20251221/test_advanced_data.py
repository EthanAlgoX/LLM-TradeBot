import asyncio
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '.')))

from src.api.quant_client import quant_client
from src.api.websocket_client import ws_client

async def test_quant_client():
    print("Testing AI500 List...")
    ai500 = await quant_client.fetch_ai500_list()
    print(f"AI500 Count: {len(ai500)}")
    if ai500:
        print(f"Sample: {ai500[0]}")

    print("\nTesting OI Ranking...")
    oi_rank = await quant_client.fetch_oi_ranking(ranking_type='top')
    print(f"OI Rank Count: {len(oi_rank)}")
    if oi_rank:
        print(f"Sample: {oi_rank[0]}")
    await quant_client.close()

async def test_websocket():
    print("\nTesting WebSocket...")
    
    def on_message(data):
        # Flattened verify
        if data.get('e') == 'kline':
            k = data['k']
            print(f"WS Update: {data['s']} {k['i']} Close:{k['c']}")

    ws_client.add_callback(on_message)
    await ws_client.start()
    
    # Subscribe
    await ws_client.subscribe_kline("BTCUSDT", "1m")
    
    print("Waiting for messages (15s)...")
    await asyncio.sleep(15)
    await ws_client.stop()

async def main():
    await test_quant_client()
    await test_websocket()

if __name__ == "__main__":
    asyncio.run(main())
