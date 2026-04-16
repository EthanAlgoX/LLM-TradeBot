"""
🤖 LLM-TradeBot - 多Agent架构主循环
===========================================

集成:
1. 🕵️ DataSyncAgent - 异步并发数据采集
2. 👨‍🔬 QuantAnalystAgent - 量化信号分析
3. ⚖️ DecisionCoreAgent - 加权投票决策
4. 👮 RiskAuditAgent - 风控审计拦截

优化:
- 异步并发执行（减少60%等待时间）
- 双视图数据结构（stable + live）
- 分层信号分析（趋势 + 震荡）
- 多周期对齐决策
- 止损方向自动修正
- 一票否决风控

Author: AI Trader Team
Date: 2025-12-19
"""

# 版本号: v+日期+迭代次数
VERSION = "v20260111_3"

import sys
import os
from dotenv import load_dotenv

# 加载 .env 文件，但不覆盖已存在的系统环境变量
# 系统环境变量优先于 .env 文件配置
load_dotenv(override=False)

# Deployment mode detection: 'local' or 'railway'
# Railway deployment sets RAILWAY_ENVIRONMENT, use that as detection
DEPLOYMENT_MODE = os.environ.get('DEPLOYMENT_MODE', 'railway' if os.environ.get('RAILWAY_ENVIRONMENT') else 'local')

# Configure based on deployment mode
if DEPLOYMENT_MODE == 'local':
    # Local deployment: Prefer REST API for data fetching (more stable for local dev)
    if 'USE_WEBSOCKET' not in os.environ:
        os.environ['USE_WEBSOCKET'] = 'false'
    # Enable detailed LLM logging
    os.environ['ENABLE_DETAILED_LLM_LOGS'] = 'true'
else:
    # Railway deployment: Also use REST API for stability
    if 'USE_WEBSOCKET' not in os.environ:
        os.environ['USE_WEBSOCKET'] = 'false'
    # Disable detailed LLM logging to save disk space
    os.environ['ENABLE_DETAILED_LLM_LOGS'] = 'false'

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '.')))

import json
import threading

from src.utils.logger import log
from src.server.state import global_state

print("[DEBUG] Importing uvicorn...")
import uvicorn

# 导入多Agent
print("[DEBUG] Importing PredictAgent...")
from src.agents import PredictAgent
print("[DEBUG] Importing server.app...")
from src.server.app import app
print("[DEBUG] Importing global_state...")
from src.server.state import global_state
print("[DEBUG] Importing MultiAgentTradingBot")
from src.trading import MultiAgentTradingBot, TradingParameters

# ✅ [新增] 导入 TradingLogger 以便初始化数据库
# FIXME: TradingLogger 的 SQLAlchemy 导入会阻塞启动，改为延迟导入
# from src.monitoring.logger import TradingLogger
print("[DEBUG] All imports complete!")

def start_server():
    """Start FastAPI server in a separate thread"""
    import os
    port = int(os.getenv("PORT", 8000))
    is_railway = bool(os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_PROJECT_ID"))
    is_production = is_railway or os.getenv("DEPLOYMENT_MODE", "local") != "local"
    host = "0.0.0.0" if is_production else os.getenv("HOST", "127.0.0.1")
    print(f"\n🌍 Starting Web Dashboard at http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="error")

# ============================================
# 主入口
# ============================================
def main():
    """主函数"""
    import argparse
    
    parser = argparse.ArgumentParser(description='多Agent交易机器人')
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument('--test', action='store_true', help='测试模式')
    mode_group.add_argument('--live', action='store_true', help='实盘模式')
    parser.add_argument('--max-position', type=float, default=100.0, help='最大单笔金额')
    parser.add_argument('--leverage', type=int, default=1, help='杠杆倍数')
    parser.add_argument('--stop-loss', type=float, default=1.0, help='止损百分比')
    parser.add_argument('--take-profit', type=float, default=2.0, help='止盈百分比')
    parser.add_argument('--kline-limit', type=int, default=300, help='K线拉取数量 (用于 warmup 测试)')
    parser.add_argument('--symbols', type=str, default='', help='覆盖交易对 (CSV, 例如: BTCUSDT,ETHUSDT)')
    parser.add_argument('--skip-auto3', action='store_true', help='在 once 模式跳过 AUTO3 解析')
    parser.add_argument('--mode', choices=['once', 'continuous'], default='continuous', help='运行模式')
    parser.add_argument('--interval', type=float, default=3.0, help='持续运行间隔（分钟）')
    # CLI Headless Mode
    parser.add_argument('--headless', action='store_true', help='无头模式：不启动 Web Dashboard，在终端显示实时数据')
    
    args = parser.parse_args()
    
    # [NEW] Check RUN_MODE from .env (Config Manager integration)
    import os
    env_run_mode = os.getenv('RUN_MODE', 'test').lower()

    # Priority: explicit CLI (--test/--live) > Env Var
    if args.test:
        effective_test_mode = True
    elif args.live:
        effective_test_mode = False
    else:
        effective_test_mode = (env_run_mode != 'live')

    args.test = effective_test_mode

    if args.symbols:
        os.environ['TRADING_SYMBOLS'] = args.symbols.strip()
        
    print(f"🔧 Startup Mode: {'TEST' if args.test else 'LIVE'} (Env: {env_run_mode})")
    
    # ==============================================================================
    # 🛠️ [修复核心]：强制初始化数据库表结构
    # 只要实例化 TradingLogger，就会自动执行 _init_database() 创建 PostgreSQL 表
    # ==============================================================================
    try:
        log.info("🛠️ Checking/initializing database tables...")
        # 这一步至关重要：它会连接数据库并运行 CREATE TABLE 语句
        # Lazy import to avoid blocking startup (FIXME at line 112)
        from src.monitoring.logger import TradingLogger
        _db_init = TradingLogger()
        log.info("✅ Database tables ready")
    except Exception as e:
        log.error(f"❌ Database init failed (non-fatal, continuing): {e}")
        # 注意：这里我们捕获异常但不退出，以免影响主程序启动，但请务必关注日志
    # ==============================================================================
    
    # 根据部署模式设置默认周期间隔
    # Local: 1 分钟 (开发测试用)
    # Railway: 5 分钟 (生产环境)
    if args.interval == 3.0:  # 如果用户没有通过 CLI 指定间隔
        if DEPLOYMENT_MODE == 'local':
            args.interval = 1.0
            print(f"🏠 Local mode: Cycle interval set to 1 minute")
        else:
            args.interval = 5.0
            print(f"☁️ Railway mode: Cycle interval set to 5 minutes")
      
    # 交易参数
    used_kline_limit = int(args.kline_limit) if args.kline_limit and args.kline_limit > 0 else 300

    trading_parameters = TradingParameters(
        max_position_size=args.max_position,
        leverage=args.leverage,
        stop_loss_pct=args.stop_loss,
        take_profit_pct=args.take_profit,
        kline_limit=used_kline_limit,
        test_mode=args.test
    )
    
    # 创建机器人
    bot = MultiAgentTradingBot(trading_parameters)

    # Set initial execution mode before dashboard starts
    # Require explicit user action (Start button) to begin trading
    global_state.execution_mode = "Stopped"
    
    # 启动 Dashboard Server (跳过 headless 模式) - 优先启动，让用户能立即访问
    if not args.headless:
        try:
            server_thread = threading.Thread(target=start_server, daemon=True)
            server_thread.start()
            print("🌐 Dashboard server started at http://localhost:8000")
        except Exception as e:
            print(f"⚠️ Failed to start Dashboard: {e}")
    else:
        print("🖥️  Headless mode: Web Dashboard disabled")
    
    # 🔝 AUTO3 STARTUP EXECUTION (only for once mode; continuous uses selector loop)
    skip_auto3 = args.skip_auto3 and args.mode == 'once'
    if skip_auto3 and getattr(bot, 'use_auto3', False):
        log.info("⏭️ AUTO3 skipped for once mode")
        bot.use_auto3 = False

    if args.mode == 'once' and hasattr(bot, 'use_auto3') and bot.use_auto3:
        log.info("=" * 60)
        log.info("🔝 AUTO3 STARTUP - Getting AI500 Top5 and selecting Top2...")
        log.info("⏳ Dashboard available at http://localhost:8000 while backtest runs...")
        log.info("=" * 60)
        
        import asyncio
        loop = asyncio.get_event_loop()
        top2 = loop.run_until_complete(bot.resolve_auto3_symbols())
        
        # Update bot symbols
        bot.symbols = top2
        bot.current_symbol = top2[0] if top2 else 'FETUSDT'
        global_state.symbols = top2

        # Ensure PredictAgent exists for AUTO3 symbols
        for symbol in bot.symbols:
            if symbol not in bot.agent_provider.predict_agents_provider.predict_agents:
                bot.predict_agent_provider.predict_agents[symbol] = PredictAgent(horizon='30m', symbol=symbol)
                log.info(f"🆕 Initialized PredictAgent for {symbol} (AUTO3)")
        
        # Start auto-refresh thread (12h interval)
        bot.agent_provider.symbol_selector_agent.start_auto_refresh()
        
        log.info(f"✅ AUTO3 startup complete: {', '.join(top2)}")
        log.info("🔄 Auto-refresh started (12h interval)")
        log.info("=" * 60)
    
    # 运行
    if args.mode == 'once':
        result = bot.run_once()
        print(f"\n最终结果: {json.dumps(result, indent=2)}")
        
        # 显示统计
        stats = bot.get_statistics()
        print(f"\n统计信息:")
        print(json.dumps(stats, indent=2))
        
        # Keep alive briefly for server to be reachable if desired, 
        # or exit immediately. Usually 'once' implies run and exit.
        
    else:
        # Default to Stopped - Wait for user to click Start button
        if global_state.execution_mode != "Running":
            global_state.execution_mode = "Stopped"
            log.info("🚀 System ready (Stopped). Waiting for user to click Start button...")
        
        global_state.is_running = True  # Keep event loop running
        bot.run_continuous(interval_minutes=args.interval, headless=args.headless)

if __name__ == '__main__':
    main()
