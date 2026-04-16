#!/usr/bin/env python3
"""
LLM-TradeBot 回测系统 CLI
==========================

用法:
    python backtest.py --start 2024-01-01 --end 2024-12-01 \
        --symbol BTCUSDT --capital 10000 --output reports/

参数:
    --start       回测开始日期 (YYYY-MM-DD)
    --end         回测结束日期 (YYYY-MM-DD)
    --symbol      交易对 (默认: BTCUSDT)
    --capital     初始资金 (USDT, 默认: 10000)
    --step        时间步长 (1=5分钟, 3=15分钟, 12=1小时, 默认: 3)
    --output      报告输出目录 (默认: reports/)
    --no-report   不生成 HTML 报告

Author: AI Trader Team
Date: 2025-12-31
"""

import argparse
import asyncio
import sys
import os

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from datetime import datetime


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description="LLM-TradeBot Backtester",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # 回测 2024 年全年 BTC
  python backtest.py --start 2024-01-01 --end 2024-12-31 --symbol BTCUSDT

  # 快速回测（每小时决策）
  python backtest.py --start 2024-12-01 --end 2024-12-31 --step 12

  # 指定初始资金
  python backtest.py --start 2024-06-01 --end 2024-12-01 --capital 50000
        """
    )
    
    parser.add_argument(
        "--start", "-s",
        type=str,
        required=True,
        help="回测开始日期 (YYYY-MM-DD)"
    )
    
    parser.add_argument(
        "--end", "-e",
        type=str,
        required=True,
        help="回测结束日期 (YYYY-MM-DD)"
    )
    
    parser.add_argument(
        "--symbol",
        type=str,
        default="AUTO1",  # 默认使用 AUTO1，与实盘一致
        help="交易对 (AUTO1=动量选币[默认], AUTO3=回测选币, 或指定如 BTCUSDT)"
    )
    
    parser.add_argument(
        "--no-auto3",
        action="store_true",
        help="禁用 AUTO3 自动选币，使用 --symbol 指定的币种"
    )
    
    parser.add_argument(
        "--capital",
        type=float,
        default=10000.0,
        help="初始资金 USDT (默认: 10000)"
    )
    
    parser.add_argument(
        "--step",
        type=int,
        default=3,
        choices=[1, 3, 12],
        help="时间步长: 1=5分钟, 3=15分钟, 12=1小时 (默认: 3)"
    )
    
    parser.add_argument(
        "--output", "-o",
        type=str,
        default="reports",
        help="报告输出目录 (默认: reports/)"
    )
    
    parser.add_argument(
        "--no-report",
        action="store_true",
        help="不生成 HTML 报告"
    )
    
    parser.add_argument(
        "--max-position",
        type=float,
        default=100.0,
        help="最大单笔仓位 USDT (默认: 100)"
    )
    
    parser.add_argument(
        "--stop-loss",
        type=float,
        default=1.0,
        help="止损百分比 (默认: 1.0%%)"
    )
    
    parser.add_argument(
        "--take-profit",
        type=float,
        default=2.0,
        help="止盈百分比 (默认: 2.0%%)"
    )
    
    parser.add_argument(
        "--strategy-mode",
        type=str,
        default="agent",
        choices=["technical", "agent"],
        help="策略模式: technical (简单EMA) 或 agent (多Agent框架, 默认: agent)"
    )
    
    parser.add_argument(
        "--use-llm",
        action="store_true",
        help="启用 LLM 增强 (仅在 agent 模式下有效，会产生 API 费用)"
    )
    
    parser.add_argument(
        "--llm-cache",
        action="store_true",
        default=True,
        help="缓存 LLM 响应以节省费用 (默认: True)"
    )
    
    return parser.parse_args()


def validate_dates(start: str, end: str):
    """验证日期格式"""
    try:
        start_date = datetime.strptime(start, "%Y-%m-%d")
        end_date = datetime.strptime(end, "%Y-%m-%d")
        
        if start_date >= end_date:
            print("❌ Error: Start date must be before end date")
            sys.exit(1)
        
        if end_date > datetime.now():
            print("⚠️ Warning: End date is in the future, using today's date")
            end_date = datetime.now()
        
        return start_date, end_date
        
    except ValueError as e:
        print(f"❌ Error: Invalid date format. Use YYYY-MM-DD")
        sys.exit(1)


async def main():
    """主函数"""
    args = parse_args()
    
    # 验证日期
    start_date, end_date = validate_dates(args.start, args.end)
    
    # 显示配置
    print("\n" + "=" * 60)
    print("🔬 LLM-TradeBot Backtester")
    print("=" * 60)
    print(f"📅 Period: {args.start} to {args.end}")
    print(f"💰 Symbol: {args.symbol}")
    print(f"💵 Initial Capital: ${args.capital:,.2f}")
    print(f"⏱️ Step: {args.step} ({['', '5min', '', '15min', '', '', '', '', '', '', '', '', '1hour'][args.step]})")
    print(f"🎯 Strategy Mode: {args.strategy_mode.upper()}")
    if args.strategy_mode == "agent":
        print(f"🤖 LLM Enhanced: {'Yes' if args.use_llm else 'No (Quant Only)'}")
        if args.use_llm:
            print(f"💾 LLM Cache: {'Enabled' if args.llm_cache else 'Disabled'}")
    print(f"🛡️ Stop Loss: {args.stop_loss}%")
    print(f"🎯 Take Profit: {args.take_profit}%")
    print("=" * 60)
    
    # 导入回测模块
    from src.backtest.engine import BacktestEngine, BacktestConfig
    from src.backtest.report import BacktestReport
    from src.agents.symbol_selector_agent import SymbolSelectorAgent
    
    # AUTO3/AUTO1 动态选币
    symbols_to_test = []
    use_auto3 = args.symbol == "AUTO3" and not args.no_auto3
    use_auto1 = args.symbol == "AUTO1"
    
    if use_auto3:
        print("\n🔝 AUTO3 启动中 - 正在选择最佳交易币种...")
        try:
            selector = SymbolSelectorAgent()
            selected = selector.get_symbols(force_refresh=False)
            if selected:
                symbols_to_test = selected
                print(f"✅ AUTO3 选中: {', '.join(symbols_to_test)}")
            else:
                print("⚠️ AUTO3 选币失败，使用默认 BTCUSDT")
                symbols_to_test = ['BTCUSDT']
        except Exception as e:
            print(f"⚠️ AUTO3 选币异常: {e}，使用默认 BTCUSDT")
            symbols_to_test = ['BTCUSDT']
    elif use_auto1:
        print("\n🎯 AUTO1 启动中 - 使用近期动量选币...")
        try:
            selector = SymbolSelectorAgent()
            selected = await selector.select_auto1_recent_momentum()
            if selected:
                symbols_to_test = selected
                print(f"✅ AUTO1 选中: {', '.join(symbols_to_test)}")
            else:
                print("⚠️ AUTO1 选币失败，使用默认 BTCUSDT")
                symbols_to_test = ['BTCUSDT']
        except Exception as e:
            print(f"⚠️ AUTO1 选币异常: {e}，使用默认 BTCUSDT")
            symbols_to_test = ['BTCUSDT']
    else:
        symbols_to_test = [args.symbol]
    
    # 运行多币种回测 (AUTO3 支持)
    all_results = []
    
    for symbol in symbols_to_test:
        print(f"\n{'='*60}")
        print(f"🔬 回测币种: {symbol}")
        print(f"{'='*60}")
        
        # 创建配置
        config = BacktestConfig(
            symbol=symbol,
            start_date=args.start,
            end_date=args.end,
            initial_capital=args.capital,
            max_position_size=args.max_position,
            stop_loss_pct=args.stop_loss,
            take_profit_pct=args.take_profit,
            step=args.step,
            strategy_mode=args.strategy_mode,
            use_llm=args.use_llm,
            llm_cache=args.llm_cache
        )
        
        # 创建引擎
        engine = BacktestEngine(config)
        
        # 进度显示
        last_pct = 0
        def progress_callback(data):
            nonlocal last_pct
            pct = data.get('progress', data.get('pct', 0))
            if int(pct) > last_pct:
                last_pct = int(pct)
                bar_len = 30
                filled = int(bar_len * pct / 100)
                bar = "█" * filled + "░" * (bar_len - filled)
                print(f"\r📊 Progress: [{bar}] {pct:.1f}%", end="", flush=True)
        
        # 运行回测
        try:
            result = await engine.run(progress_callback=progress_callback)
            print()  # 换行
            all_results.append((symbol, result, engine))
        except KeyboardInterrupt:
            print("\n\n⚠️ Backtest interrupted by user")
            sys.exit(0)
        except Exception as e:
            print(f"\n\n❌ Error during backtest for {symbol}: {e}")
            continue
    
    # 显示所有结果汇总
    if not all_results:
        print("\n❌ 没有成功完成的回测")
        sys.exit(1)
    
    print("\n" + "=" * 60)
    mode_label = ""
    if use_auto3:
        mode_label = " (AUTO3)"
    elif use_auto1:
        mode_label = " (AUTO1)"
    print(f"📊 回测结果汇总{mode_label}")
    print("=" * 60)
    
    total_return_sum = 0
    for symbol, result, engine in all_results:
        m = result.metrics
        total_return_sum += m.total_return
        
        print(f"\n🪙 {symbol}:")
        print(f"   收益: {m.total_return:+.2f}% | 回撤: {m.max_drawdown_pct:.2f}% | 胜率: {m.win_rate:.1f}% | 交易: {m.total_trades}")
        
        # 生成报告
        if not args.no_report:
            os.makedirs(args.output, exist_ok=True)
            report = BacktestReport(output_dir=args.output)
            filename = f"backtest_{symbol}_{args.start}_{args.end}"
            filepath = report.generate(
                metrics=m,
                equity_curve=result.equity_curve,
                trades_df=engine.portfolio.get_trades_dataframe(),
                config={
                    'symbol': symbol,
                    'initial_capital': args.capital,
                },
                filename=filename
            )
            print(f"   📄 报告: {filepath}")
    
    if len(all_results) > 1:
        print(f"\n📈 总收益 (所有币种): {total_return_sum:+.2f}%")
    
    print("\n" + "=" * 60)
    print("✅ 回测完成!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
