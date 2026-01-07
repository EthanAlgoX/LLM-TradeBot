#!/usr/bin/env python3
"""
Multi-Symbol Backtest Runner
Run backtests on multiple symbols and compare results
"""
import asyncio
import subprocess
import json
from datetime import datetime
from pathlib import Path

# AI500 Top 5 symbols
SYMBOLS = ['LINKUSDT', 'TAOUSDT', 'NEARUSDT', 'RENDERUSDT', 'JASMYUSDT']

# Backtest parameters
START_DATE = '2025-12-25'
END_DATE = '2026-01-06'
CAPITAL = 10000
STEP = 12  # 1 hour

async def run_backtest(symbol: str):
    """Run backtest for a single symbol"""
    print(f"\n{'='*60}")
    print(f"🔄 Running backtest for {symbol}...")
    print(f"{'='*60}")
    
    cmd = [
        'python', 'backtest.py',
        '--start', START_DATE,
        '--end', END_DATE,
        '--symbol', symbol,
        '--strategy-mode', 'agent',
        '--step', str(STEP),
        '--capital', str(CAPITAL)
    ]
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300  # 5 minutes timeout
        )
        
        if result.returncode == 0:
            # Extract key metrics from output
            output = result.stdout
            metrics = {}
            
            for line in output.split('\n'):
                if 'Total Return:' in line:
                    metrics['total_return'] = line.split(':')[1].strip()
                elif 'Sharpe Ratio:' in line:
                    metrics['sharpe_ratio'] = line.split(':')[1].strip()
                elif 'Win Rate:' in line:
                    metrics['win_rate'] = line.split(':')[1].strip()
                elif 'Total Trades:' in line:
                    metrics['total_trades'] = line.split(':')[1].strip()
                elif 'Max Drawdown:' in line:
                    metrics['max_drawdown'] = line.split(':')[1].strip()
            
            print(f"✅ {symbol} backtest completed")
            print(f"   Return: {metrics.get('total_return', 'N/A')}")
            print(f"   Sharpe: {metrics.get('sharpe_ratio', 'N/A')}")
            print(f"   Win Rate: {metrics.get('win_rate', 'N/A')}")
            print(f"   Trades: {metrics.get('total_trades', 'N/A')}")
            
            return {
                'symbol': symbol,
                'success': True,
                'metrics': metrics
            }
        else:
            print(f"❌ {symbol} backtest failed")
            print(f"   Error: {result.stderr[:200]}")
            return {
                'symbol': symbol,
                'success': False,
                'error': result.stderr
            }
            
    except subprocess.TimeoutExpired:
        print(f"⏱️ {symbol} backtest timed out")
        return {
            'symbol': symbol,
            'success': False,
            'error': 'Timeout'
        }
    except Exception as e:
        print(f"❌ {symbol} backtest error: {e}")
        return {
            'symbol': symbol,
            'success': False,
            'error': str(e)
        }

async def main():
    """Run backtests for all symbols"""
    print("\n" + "="*60)
    print("🚀 Multi-Symbol Backtest Analysis")
    print("="*60)
    print(f"Period: {START_DATE} to {END_DATE}")
    print(f"Symbols: {', '.join(SYMBOLS)}")
    print(f"Initial Capital: ${CAPITAL:,}")
    print("="*60)
    
    results = []
    
    # Run backtests sequentially to avoid resource conflicts
    for symbol in SYMBOLS:
        result = await run_backtest(symbol)
        results.append(result)
        await asyncio.sleep(2)  # Brief pause between backtests
    
    # Summary
    print("\n" + "="*60)
    print("📊 BACKTEST SUMMARY")
    print("="*60)
    
    successful = [r for r in results if r['success']]
    failed = [r for r in results if not r['success']]
    
    if successful:
        print(f"\n✅ Successful: {len(successful)}/{len(SYMBOLS)}")
        print("\nRanking by Total Return:")
        
        # Sort by total return
        ranked = sorted(
            successful,
            key=lambda x: float(x['metrics'].get('total_return', '0%').replace('%', '').replace('+', '')),
            reverse=True
        )
        
        for i, result in enumerate(ranked, 1):
            metrics = result['metrics']
            print(f"\n{i}. {result['symbol']}")
            print(f"   Return: {metrics.get('total_return', 'N/A')}")
            print(f"   Sharpe: {metrics.get('sharpe_ratio', 'N/A')}")
            print(f"   Win Rate: {metrics.get('win_rate', 'N/A')}")
            print(f"   Trades: {metrics.get('total_trades', 'N/A')}")
            print(f"   Max DD: {metrics.get('max_drawdown', 'N/A')}")
    
    if failed:
        print(f"\n❌ Failed: {len(failed)}/{len(SYMBOLS)}")
        for result in failed:
            print(f"   - {result['symbol']}: {result.get('error', 'Unknown error')[:100]}")
    
    # Save results
    output_file = f"backtest_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\n💾 Results saved to: {output_file}")
    print("="*60)

if __name__ == '__main__':
    asyncio.run(main())
