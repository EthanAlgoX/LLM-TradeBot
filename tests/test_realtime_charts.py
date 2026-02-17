#!/usr/bin/env python3
"""
Test script to verify real-time backtest visualization with optimized charts.
This script runs a short backtest and monitors the streaming output.
"""

import requests
import json
from datetime import datetime, timedelta
import socket
import pytest


def _is_port_open(host: str, port: int, timeout: float = 0.5) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex((host, port)) == 0

def test_realtime_visualization():
    """Run a short backtest and verify streaming data."""
    if not _is_port_open("localhost", 8000):
        pytest.skip("Dashboard server is not running on localhost:8000")
    
    # Configure a short backtest (1 day)
    end_date = datetime.now()
    start_date = end_date - timedelta(days=1)
    
    config = {
        "symbol": "BTCUSDT",
        "start_date": start_date.strftime("%Y-%m-%d"),
        "end_date": end_date.strftime("%Y-%m-%d"),
        "initial_capital": 10000.0,
        "step": 3,
        "stop_loss_pct": 2.0,
        "take_profit_pct": 3.0,
        "leverage": 5,
        "margin_mode": "cross",
        "contract_type": "linear",
        "fee_tier": "vip0",
        "include_funding": True,
        "strategy_mode": "agent",
        "use_llm": True,
        "llm_cache": True,
        "llm_throttle_ms": 100
    }
    
    print(f"🚀 Starting backtest from {config['start_date']} to {config['end_date']}")
    print("=" * 60)
    
    # Stream the backtest
    response = requests.post(
        "http://localhost:8000/api/backtest/run",
        json=config,
        stream=True,
        timeout=300
    )
    
    if response.status_code != 200:
        print(f"❌ Error: HTTP {response.status_code}")
        print(response.text)
        return
    
    # Track statistics
    progress_updates = 0
    equity_points = 0
    trade_updates = 0
    metrics_updates = 0
    last_equity = None
    last_drawdown = None
    
    # Process stream
    buffer = ""
    for chunk in response.iter_content(chunk_size=1024, decode_unicode=True):
        if not chunk:
            continue
            
        buffer += chunk
        lines = buffer.split('\n')
        buffer = lines.pop()  # Keep incomplete line in buffer
        
        for line in lines:
            if not line.strip():
                continue
                
            try:
                msg = json.loads(line)
                
                if msg['type'] == 'progress':
                    progress_updates += 1
                    percent = msg.get('percent', 0)
                    
                    # Check for equity data
                    if 'current_equity' in msg and msg['current_equity'] is not None:
                        last_equity = msg['current_equity']
                        profit_pct = msg.get('profit_pct', 0)
                        print(f"📊 Progress: {percent}% | Equity: ${last_equity:.2f} | P/L: {profit_pct:+.2f}%")
                    
                    # Check for equity point (for charts)
                    if 'equity_point' in msg and msg['equity_point']:
                        equity_points += 1
                        ep = msg['equity_point']
                        last_drawdown = ep.get('drawdown_pct', 0)
                        if equity_points % 5 == 0:  # Print every 5th point
                            print(f"   📈 Chart Point #{equity_points}: Equity=${ep['total_equity']:.2f}, DD={last_drawdown:.2f}%")
                    
                    # Check for metrics
                    if 'metrics' in msg and msg['metrics']:
                        metrics_updates += 1
                        m = msg['metrics']
                        print(f"   📉 Metrics: Trades={m.get('total_trades', 0)}, Win Rate={m.get('win_rate', 0):.1f}%, Max DD={m.get('max_drawdown_pct', 0):.2f}%")
                    
                    # Check for recent trades
                    if 'recent_trades' in msg and msg['recent_trades']:
                        trade_updates += 1
                        trades_count = len(msg['recent_trades'])
                        print(f"   💼 Recent Trades: {trades_count} trades")
                
                elif msg['type'] == 'result':
                    print("\n" + "=" * 60)
                    print("✅ Backtest completed!")
                    result = msg['data']
                    metrics = result['metrics']
                    
                    print(f"\n📊 Final Results:")
                    print(f"   Total Return: {metrics['total_return']}")
                    print(f"   Max Drawdown: {metrics['max_drawdown_pct']}")
                    print(f"   Total Trades: {metrics['total_trades']}")
                    print(f"   Win Rate: {metrics['win_rate']}")
                    print(f"   Sharpe Ratio: {metrics['sharpe_ratio']}")
                    
                    print(f"\n📈 Streaming Statistics:")
                    print(f"   Progress Updates: {progress_updates}")
                    print(f"   Equity Points (for charts): {equity_points}")
                    print(f"   Trade Updates: {trade_updates}")
                    print(f"   Metrics Updates: {metrics_updates}")
                    
                    if last_equity:
                        print(f"\n💰 Last Equity: ${last_equity:.2f}")
                    if last_drawdown is not None:
                        print(f"📉 Last Drawdown: {last_drawdown:.2f}%")
                    
                    return True
                
                elif msg['type'] == 'error':
                    print(f"\n❌ Error: {msg['message']}")
                    return False
                    
            except json.JSONDecodeError as e:
                print(f"⚠️  JSON parse error: {e}")
                print(f"   Line: {line[:100]}")
                continue
    
    print("\n⚠️  Stream ended without result")
    return False

if __name__ == "__main__":
    try:
        success = test_realtime_visualization()
        exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n⏹️  Test cancelled by user")
        exit(130)
    except Exception as e:
        print(f"\n❌ Test failed with exception: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
