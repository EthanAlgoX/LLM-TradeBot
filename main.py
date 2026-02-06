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

import asyncio
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

from typing import Dict, Optional, List
from datetime import datetime
import json
import time
import threading
import signal
from dataclasses import asdict

from src.api.binance_client import BinanceClient
from src.execution.engine import ExecutionEngine
from src.risk.manager import RiskManager
from src.utils.logger import log, setup_logger
from src.utils.trade_logger import trade_logger
from src.utils.data_saver import DataSaver
from src.data.processor import MarketDataProcessor  # ✅ Corrected Import
from src.exchanges import AccountManager, ExchangeAccount, ExchangeType  # ✅ Multi-Account Support
from src.features.technical_features import TechnicalFeatureEngineer
from src.server.state import global_state
from src.utils.semantic_converter import SemanticConverter  # ✅ Global Import
from src.agents.regime_detector_agent import RegimeDetector  # ✅ Market Regime Detection
from src.config import Config # Re-added Config as it's used later

# FastAPI dependencies
print("[DEBUG] Importing FastAPI...")
from fastapi import FastAPI
print("[DEBUG] Importing StaticFiles...")
from fastapi.staticfiles import StaticFiles
print("[DEBUG] Importing CORSMiddleware...")
from fastapi.middleware.cors import CORSMiddleware
print("[DEBUG] Importing uvicorn...")
import uvicorn
print("[DEBUG] FastAPI imports complete")

# 导入多Agent
print("[DEBUG] Importing agents...")
from src.agents import (
    DataSyncAgent,
    QuantAnalystAgent,
    DecisionCoreAgent,
    RiskAuditAgent,
    PositionInfo,
    ReflectionAgent,
    ReflectionAgentLLM,
    MultiPeriodParserAgent
)
print("[DEBUG] Importing StrategyEngine...")
from src.strategy.llm_engine import StrategyEngine
print("[DEBUG] Importing PredictAgent...")
from src.agents.predict_agent import PredictAgent
print("[DEBUG] Importing symbol_selector_agent...")
from src.agents.symbol_selector_agent import get_selector  # 🔝 AUTO3 Support
print("[DEBUG] Importing server.app...")
from src.server.app import app
print("[DEBUG] Importing global_state...")
from src.server.state import global_state

# ✅ [新增] 导入 TradingLogger 以便初始化数据库
# FIXME: TradingLogger 的 SQLAlchemy 导入会阻塞启动，改为延迟导入
# from src.monitoring.logger import TradingLogger
print("[DEBUG] All imports complete!")

class MultiAgentTradingBot:
    """
    多Agent交易机器人（重构版）
    
    工作流程:
    1. DataSyncAgent: 异步采集5m/15m/1h数据
    2. QuantAnalystAgent: 生成量化信号（趋势+震荡）
    3. DecisionCoreAgent: 加权投票决策
    4. RiskAuditAgent: 风控审计拦截
    5. ExecutionEngine: 执行交易
    """
    
    def __init__(
        self,
        max_position_size: float = 100.0,
        leverage: int = 1,
        stop_loss_pct: float = 1.0,
        take_profit_pct: float = 2.0,
        test_mode: bool = False,
        kline_limit: int = 300
    ):
        """
        初始化多Agent交易机器人
        
        Args:
            max_position_size: 最大单笔金额（USDT）
            leverage: 杠杆倍数
            stop_loss_pct: 止损百分比
            take_profit_pct: 止盈百分比
            test_mode: 测试模式（不执行真实交易）
        """
        print("\n" + "="*80)
        print(f"🤖 AI Trader - DeepSeek LLM Decision Mode ({VERSION})")
        print("="*80)
        
        self.config = Config()
        
        # 多币种支持: 优先级顺序
        # 1. 环境变量 TRADING_SYMBOLS (来自 .env，Dashboard 设置会更新这个)
        # 2. config.yaml 中的 trading.symbols (list)
        # 3. config.yaml 中的 trading.symbol (str/csv, 向后兼容)
        env_symbols = os.environ.get('TRADING_SYMBOLS', '').strip()
        
        if env_symbols:
            # Dashboard 设置的币种 (逗号分隔)
            self.symbols = [s.strip() for s in env_symbols.split(',') if s.strip()]
        else:
            # 从 config.yaml 读取
            symbols_config = self.config.get('trading.symbols', None)
            
            if symbols_config and isinstance(symbols_config, list):
                self.symbols = symbols_config
            else:
                # 向后兼容: 使用旧版 trading.symbol 配置 (支持 CSV 字符串 "BTCUSDT,ETHUSDT")
                symbol_str = self.config.get('trading.symbol', 'AI500_TOP5')  # ✅ 默认 AI500 Top 5
                if ',' in symbol_str:
                    self.symbols = [s.strip() for s in symbol_str.split(',') if s.strip()]
                else:
                    self.symbols = [symbol_str]

        # Normalize legacy AUTO2 -> AUTO1
        if 'AUTO2' in self.symbols:
            self.symbols = ['AUTO1' if s == 'AUTO2' else s for s in self.symbols]

        # 🔝 AUTO3 Dynamic Resolution (takes priority)
        self.use_auto3 = 'AUTO3' in self.symbols
        if self.use_auto3:
            self.symbols = [s for s in self.symbols if s not in ('AUTO3', 'AUTO1')]
            # If AUTO3 was the only symbol, add temporary placeholder (will be replaced at startup)
            if not self.symbols:
                self.symbols = ['FETUSDT']  # Temporary, replaced by AUTO3 selection in main()
            log.info("🔝 AUTO3 mode enabled - Startup backtest will run")

        # AUTO1 Dynamic Selection (runtime)
        self.use_auto1 = (not self.use_auto3) and ('AUTO1' in self.symbols)
        if self.use_auto1:
            self.symbols = [s for s in self.symbols if s != 'AUTO1']
            if not self.symbols:
                self.symbols = ['BTCUSDT']  # Temporary placeholder before selector runs
            log.info("🎯 AUTO1 mode enabled - Symbol selector will run at startup")
        
        # 🤖 AI500 Dynamic Resolution
        self.use_ai500 = 'AI500_TOP5' in self.symbols and not self.use_auto3
        self.ai500_last_update = None
        self.ai500_update_interval = 6 * 3600  # 6 hours in seconds
        
        if self.use_ai500:
            self.symbols.remove('AI500_TOP5')
            ai_top5 = self._resolve_ai500_symbols()
            # Merge and deduplicate
            self.symbols = list(set(self.symbols + ai_top5))
            # Sort to keep stable order
            self.symbols.sort()
            self.ai500_last_update = time.time()
            
            # Start background thread for periodic updates
            self._start_ai500_updater()
                
        # 🔧 Primary symbol must be in the symbols list
        configured_primary = self.config.get('trading.primary_symbol', 'BTCUSDT')
        if configured_primary in self.symbols:
            self.primary_symbol = configured_primary
        else:
            # Use first symbol if configured primary not in list
            self.primary_symbol = self.symbols[0]
            log.info(f"Primary symbol {configured_primary} not in symbols list, using {self.primary_symbol}")
        
        self.current_symbol = self.primary_symbol  # 当前处理的交易对
        global_state.current_symbol = self.current_symbol
        self.test_mode = test_mode
        global_state.is_test_mode = test_mode  # Set test mode in global state
        global_state.symbols = self.symbols  # 🆕 Sync symbols to global state for API

        # Symbol selector cadence (AUTO1/AUTO3)
        self.selector_interval_sec = 10 * 60
        self.selector_last_run = 0.0
        self.selector_startup_done = False

        # Cycle logging (DB)
        self._cycle_logger = None
        self._last_cycle_realized_pnl = 0.0
        
        # 交易参数
        self.max_position_size = max_position_size
        self.leverage = leverage
        self.stop_loss_pct = stop_loss_pct
        self.take_profit_pct = take_profit_pct
        self.kline_limit = int(kline_limit) if kline_limit and kline_limit > 0 else 300
        
        
        # 初始化客户端
        self.client = BinanceClient()
        self.risk_manager = RiskManager()
        self.execution_engine = ExecutionEngine(self.client, self.risk_manager)
        self.saver = DataSaver() # ✅ 初始化 Multi-Agent 数据保存器
        
        # 🧹 启动时清除历史实盘数据，只保留当前周期
        self.saver.clear_live_data()

        # 💰 Persistent Virtual Account (Test Mode)
        if self.test_mode:
            saved_va = self.saver.load_virtual_account()
            if saved_va:
                log.info("💰 Found persistent virtual account. Resetting to initial balance for new session.")
            global_state.virtual_balance = global_state.virtual_initial_balance
            global_state.virtual_positions = {}
            self._save_virtual_state()
        global_state.saver = self.saver # ✅ 将 saver 共享到全局状态，供各 Agent 使用
        
        
        # ✅ 初始化多账户管理器
        self.account_manager = AccountManager()
        self._init_accounts()
        # Initialize mtime for .env tracking (skip if not exists, e.g. Railway)
        self._env_mtime = 0
        self._env_path = os.path.join(os.path.dirname(__file__), '.env')
        self._env_exists = os.path.exists(self._env_path)  # 🔧 Railway fix
        
        # 初始化共享 Agent (与币种无关)
        print("\n🚀 Initializing agents...")
        
        # 🆕 Load Agent Configuration
        from src.agents.agent_config import AgentConfig
        agents_config = self.config.get('agents', {})
        self.agent_config = AgentConfig.from_dict({'agents': agents_config})
        print(f"  📋 Agent Config: {self.agent_config}")
        global_state.agent_config = self.agent_config.get_enabled_agents()
        self._last_agent_config = dict(global_state.agent_config)
        
        # Core Agents (always enabled)
        self.data_sync_agent = DataSyncAgent(self.client)
        self.quant_analyst = QuantAnalystAgent()
        self.decision_core = DecisionCoreAgent()
        self.multi_period_agent = MultiPeriodParserAgent()
        self.risk_audit = RiskAuditAgent(
            max_leverage=10.0,
            max_position_pct=0.3,
            min_stop_loss_pct=0.005,
            max_stop_loss_pct=0.05
        )
        print("[DEBUG] Creating MarketDataProcessor...")
        self.processor = MarketDataProcessor()  # ✅ 初始化数据处理器
        print("[DEBUG] MarketDataProcessor created")
        print("[DEBUG] Creating TechnicalFeatureEngineer...")
        self.feature_engineer = TechnicalFeatureEngineer()  # 🔮 特征工程器 for Prophet
        print("[DEBUG] TechnicalFeatureEngineer created")
        
        # 🆕 Optional Agent: RegimeDetectorAgent
        self.regime_detector = None
        if self.agent_config.regime_detector_agent:
            print("[DEBUG] Creating RegimeDetector...")
            from src.agents.regime_detector_agent import RegimeDetector
            self.regime_detector = RegimeDetector()
            print("[DEBUG] RegimeDetector created")
            print("  ✅ RegimeDetectorAgent ready")
        else:
            print("  ⏭️ RegimeDetectorAgent disabled")
        
        # 🆕 Optional Agent: PredictAgent (per symbol)
        self.predict_agents = {}
        if self.agent_config.predict_agent:
            print("[DEBUG] Creating PredictAgents...")
            for symbol in self.symbols:
                print(f"[DEBUG] Creating PredictAgent for {symbol}...")
                self.predict_agents[symbol] = PredictAgent(horizon='30m', symbol=symbol)
                print(f"[DEBUG] PredictAgent for {symbol} created")
            print(f"  ✅ PredictAgent ready ({len(self.symbols)} symbols)")
        else:
            print("  ⏭️ PredictAgent disabled")
        
        print("  ✅ DataSyncAgent ready")
        print("  ✅ QuantAnalystAgent ready")
        print("  ✅ RiskAuditAgent ready")
        
        # 🧠 DeepSeek 决策引擎
        print("[DEBUG] Creating StrategyEngine...")
        self.strategy_engine = StrategyEngine()
        print("[DEBUG] StrategyEngine created")
        if self.strategy_engine.is_ready:
            print("  ✅ DeepSeek StrategyEngine ready")
        else:
            print("  ⚠️ DeepSeek StrategyEngine not ready (Awaiting API Key)")
            
        # 🆕 Optional Agent: ReflectionAgent
        self.reflection_agent = None
        if self.agent_config.reflection_agent_llm or self.agent_config.reflection_agent_local:
            print("[DEBUG] Creating ReflectionAgent...")
            if self.agent_config.reflection_agent_llm:
                self.reflection_agent = ReflectionAgentLLM()
                print("  ✅ ReflectionAgentLLM ready")
            else:
                self.reflection_agent = ReflectionAgent()
                print("  ✅ ReflectionAgent ready (no LLM)")
            print("[DEBUG] ReflectionAgent created")
        else:
            print("  ⏭️ ReflectionAgent disabled")
        
        print(f"\n⚙️  Trading Config:")
        print(f"  - Symbols: {', '.join(self.symbols)}")
        print(f"  - Max Position: ${self.max_position_size:.2f} USDT")
        print(f"  - Leverage: {self.leverage}x")
        print(f"  - Stop Loss: {self.stop_loss_pct}%")
        print(f"  - Take Profit: {self.take_profit_pct}%")
        print(f"  - Kline Limit: {self.kline_limit}")
        print(f"  - Test Mode: {'✅ Yes' if self.test_mode else '❌ No'}")
        
        # ✅ Load initial trade history
        recent_trades = self.saver.get_recent_trades(limit=20)
        global_state.trade_history = recent_trades
        print(f"  📜 Loaded {len(recent_trades)} historical trades")
        
        # 🆕 Initialize Chatroom with a boot message
        global_state.add_agent_message(
            "decision_core", 
            "**System initialized.** All agents are online and ready for parallel execution. Standing by for market data...", 
            level="success"
        )
        
        self._sync_open_positions_to_trade_history()
        # [NEW] Initialize LLM metadata
        self._update_llm_metadata()

    def _update_llm_metadata(self):
        """Collect current LLM provider/model and agent system prompts for UI display"""
        try:
            from src.agents.trend_agent import TrendAgentLLM
            from src.agents.setup_agent import SetupAgentLLM
            from src.agents.trigger_agent import TriggerAgentLLM
            from src.agents.reflection_agent import ReflectionAgentLLM
            
            # 1. Collect LLM Engine info (Decision Core)
            llm_info = {
                "provider": getattr(self.strategy_engine, 'provider', 'None'),
                "model": getattr(self.strategy_engine, 'model', 'None')
            }
            global_state.llm_info = llm_info
            
            # 2. Collect System Prompts
            prompts = {}
            
            # Decision Core Prompt
            prompts["decision_core"] = self.strategy_engine._build_system_prompt()
            
            # Trend Agent
            try:
                trend_agent = TrendAgentLLM()
                prompts["trend_agent"] = trend_agent._get_system_prompt()
            except Exception: pass
            
            # Setup Agent
            try:
                setup_agent = SetupAgentLLM()
                prompts["setup_agent"] = setup_agent._get_system_prompt()
            except Exception: pass
            
            # Trigger Agent
            try:
                trigger_agent = TriggerAgentLLM()
                prompts["trigger_agent"] = trigger_agent._get_system_prompt()
            except Exception: pass
            
            # Reflection Agent
            if self.reflection_agent and isinstance(self.reflection_agent, ReflectionAgentLLM):
                prompts["reflection_agent"] = self.reflection_agent._build_system_prompt()
            else:
                try:
                    reflection_llm = ReflectionAgentLLM()
                    prompts["reflection_agent"] = reflection_llm._build_system_prompt()
                except Exception: pass
            
            global_state.agent_prompts = prompts
            log.info(f"📊 LLM metadata updated: {llm_info['provider']} ({llm_info['model']}), {len(prompts)} prompts collected")
            
        except Exception as e:
            log.error(f"Failed to update LLM metadata: {e}")

    def _reload_symbols(self):
        """Reload trading symbols from environment/config without restart"""
        # Note: On Railway, os.environ is already updated by config_manager.
        # On local, load_dotenv refreshes from .env file.
        if self._env_exists:
            load_dotenv(override=True)
        # Reload full config to pick up updated LLM provider/keys and agents
        try:
            self.config._load_config()
        except Exception as e:
            log.warning(f"⚠️ Failed to reload config: {e}")
        # Reload LLM engine to pick up new provider/keys
        try:
            if hasattr(self, "strategy_engine"):
                self.strategy_engine.reload_config()
                self._update_llm_metadata()
        except Exception as e:
            log.warning(f"⚠️ Failed to reload LLM engine: {e}")
        
        env_symbols = os.environ.get('TRADING_SYMBOLS', '').strip()
        
        old_symbols = self.symbols.copy()
        
        if env_symbols:
            self.symbols = [s.strip() for s in env_symbols.split(',') if s.strip()]
        else:
            symbols_config = self.config.get('trading.symbols', None)
            if symbols_config and isinstance(symbols_config, list):
                self.symbols = symbols_config
            else:
                symbol_str = self.config.get('trading.symbol', 'AI500_TOP5')
                if ',' in symbol_str:
                    self.symbols = [s.strip() for s in symbol_str.split(',') if s.strip()]
                else:
                    self.symbols = [symbol_str]

        # Normalize legacy AUTO2 -> AUTO1
        if 'AUTO2' in self.symbols:
            self.symbols = ['AUTO1' if s == 'AUTO2' else s for s in self.symbols]

        # 🔝 AUTO3 Dynamic Resolution (takes priority)
        self.use_auto3 = 'AUTO3' in self.symbols
        if self.use_auto3:
            self.symbols = [s for s in self.symbols if s not in ('AUTO3', 'AUTO1')]
            if not self.symbols:
                self.symbols = ['FETUSDT']
            log.info("🔝 AUTO3 mode enabled - Startup backtest will run")

        # AUTO1 Dynamic Selection
        self.use_auto1 = (not self.use_auto3) and ('AUTO1' in self.symbols)
        if self.use_auto1:
            self.symbols = [s for s in self.symbols if s != 'AUTO1']
            if not self.symbols:
                self.symbols = ['BTCUSDT']
            log.info("🎯 AUTO1 mode enabled - Symbol selector will run at startup")

        # 🤖 AI500 Dynamic Resolution
        if 'AI500_TOP5' in self.symbols:
            self.symbols.remove('AI500_TOP5')
            ai_top5 = self._resolve_ai500_symbols()
            self.symbols = list(set(self.symbols + ai_top5))
            self.symbols.sort()
            
        if set(self.symbols) != set(old_symbols):
            log.info(f"🔄 Trading symbols reloaded: {', '.join(self.symbols)}")
            global_state.add_log(f"[🔄 CONFIG] Symbols reloaded: {', '.join(self.symbols)}")
            # Update global state
            global_state.symbols = self.symbols
            # Initialize PredictAgent for any new symbols
            if self.agent_config.predict_agent:
                for symbol in self.symbols:
                    if symbol not in self.predict_agents:
                        from src.agents.predict_agent import PredictAgent
                        self.predict_agents[symbol] = PredictAgent(symbol=symbol)
                        log.info(f"🆕 Initialized PredictAgent for {symbol}")
            
            # Refresh LLM metadata in case config changed
            self._update_llm_metadata()

    def _run_symbol_selector(self, reason: str = "scheduled") -> None:
        """Run symbol selector and update symbols (AUTO1/AUTO3)."""
        if not self.agent_config.symbol_selector_agent:
            return

        now_ts = time.time()
        if reason != "startup" and self.selector_last_run > 0 and (now_ts - self.selector_last_run) < self.selector_interval_sec:
            return

        active_symbols = self._get_active_position_symbols()
        if active_symbols:
            locked = [s for s in self.symbols if s in active_symbols]
            if not locked:
                locked = sorted(set(active_symbols))
            log.info(f"🔒 SymbolSelectorAgent skipped (active positions: {', '.join(locked)})")
            global_state.add_log(f"[🔒 SELECTOR] Skipped: active positions ({', '.join(locked)})")
            self.selector_last_run = now_ts
            if reason == "startup":
                self.selector_startup_done = True
            return

        selector_started = now_ts
        try:
            log.info(f"🎰 SymbolSelectorAgent ({reason}) running before analysis...")
            global_state.add_log(f"[🎰 SELECTOR] Symbol selection started ({reason})")
            selector = get_selector()
            account_equity = self._get_account_equity_estimate()
            if hasattr(selector, 'account_equity') and account_equity:
                selector.account_equity = account_equity
            if self.use_auto3:
                top_symbols = asyncio.run(selector.select_top3(force_refresh=False, account_equity=account_equity))
            else:
                top_symbols = asyncio.run(
                    selector.select_auto1_recent_momentum(account_equity=account_equity)
                ) or []

            if top_symbols:
                self.symbols = top_symbols
                self.current_symbol = top_symbols[0]
                global_state.symbols = top_symbols
                global_state.current_symbol = self.current_symbol
                selector_payload = {
                    "mode": "AUTO3" if self.use_auto3 else "AUTO1",
                    "symbols": list(top_symbols),
                    "symbol": self.current_symbol,
                    "direction": None,
                    "change_pct": None,
                    "volume_ratio": None,
                    "score": None,
                    "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                }
                if not self.use_auto3:
                    auto1 = getattr(selector, "last_auto1", {}) or {}
                    metrics = auto1.get("results", {}).get(self.current_symbol, {})
                    change_pct = metrics.get("change_pct")
                    if isinstance(change_pct, (int, float)):
                        if change_pct > 0:
                            selector_payload["direction"] = "UP"
                        elif change_pct < 0:
                            selector_payload["direction"] = "DOWN"
                        else:
                            selector_payload["direction"] = "FLAT"
                        selector_payload["change_pct"] = change_pct
                    volume_ratio = metrics.get("volume_ratio")
                    if isinstance(volume_ratio, (int, float)):
                        selector_payload["volume_ratio"] = volume_ratio
                    score = metrics.get("score")
                    if isinstance(score, (int, float)):
                        selector_payload["score"] = score
                    selector_payload["window_minutes"] = auto1.get("window_minutes")
                global_state.symbol_selector = selector_payload
                if self.primary_symbol not in self.symbols:
                    self.primary_symbol = self.current_symbol
                    log.info(f"🔄 Primary symbol updated to {self.primary_symbol} (selector)")

                if self.agent_config.predict_agent:
                    for symbol in top_symbols:
                        if symbol not in self.predict_agents:
                            self.predict_agents[symbol] = PredictAgent(horizon='30m', symbol=symbol)
                            log.info(f"🆕 Initialized PredictAgent for {symbol} (Selector)")

                if self.use_auto3:
                    selector.start_auto_refresh()
                log.info(f"✅ SymbolSelectorAgent ready: {', '.join(top_symbols)}")
                global_state.add_log(f"[🎰 SELECTOR] Selected: {', '.join(top_symbols)}")
                global_state.add_agent_message(
                    "symbol_selector",
                    f"Mode: {selector_payload.get('mode', 'AUTO')} | Symbols: {', '.join(top_symbols)}",
                    level="info"
                )
            else:
                log.warning("⚠️ SymbolSelectorAgent returned empty selection")
                global_state.add_log("[🎰 SELECTOR] Empty selection (fallback to configured symbols)")
        except Exception as e:
            log.error(f"❌ SymbolSelectorAgent failed: {e}")
            global_state.add_log(f"[🎰 SELECTOR] Failed: {e}")
        finally:
            self.selector_last_run = selector_started
            if reason == "startup":
                self.selector_startup_done = True

    def _get_active_position_symbols(self) -> List[str]:
        """Return symbols with active positions (test + live)."""
        if self.test_mode:
            active = []
            for symbol, pos in (global_state.virtual_positions or {}).items():
                try:
                    qty = float(pos.get('quantity', 0) or 0)
                except (TypeError, ValueError):
                    qty = 0
                if abs(qty) > 0:
                    active.append(symbol)
            return active

        try:
            account = self.client.get_futures_account()
            positions = account.get('positions', []) or []
            active = []
            for pos in positions:
                amt = pos.get('positionAmt')
                if amt is None:
                    amt = pos.get('position_amt', 0)
                try:
                    if abs(float(amt)) > 0:
                        symbol = pos.get('symbol')
                        if symbol:
                            active.append(symbol)
                except (TypeError, ValueError):
                    continue
            return active
        except Exception as e:
            log.warning(f"Failed to fetch active positions: {e}")
            return []

    def _sync_open_positions_to_trade_history(self) -> None:
        """Ensure open positions appear in trade history for the UI."""
        def has_open_record(symbol: str) -> bool:
            for trade in global_state.trade_history:
                if trade.get('symbol') != symbol:
                    continue
                exit_price = trade.get('exit_price')
                if exit_price in (None, "", "N/A"):
                    return True
                try:
                    if float(exit_price) == 0:
                        return True
                except (TypeError, ValueError):
                    return True
            return False

        added = []
        if self.test_mode:
            for symbol, pos in (global_state.virtual_positions or {}).items():
                try:
                    qty = float(pos.get('quantity', 0) or 0)
                except (TypeError, ValueError):
                    qty = 0
                if abs(qty) == 0 or has_open_record(symbol):
                    continue
                side = (pos.get('side') or '').upper()
                action = f"OPEN_{side}" if side else "OPEN"
                entry_price = float(pos.get('entry_price', 0) or 0)
                trade_record = {
                    'open_cycle': 0,
                    'close_cycle': 0,
                    'timestamp': pos.get('entry_time') or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    'action': action,
                    'symbol': symbol,
                    'entry_price': entry_price,
                    'quantity': qty,
                    'cost': entry_price * qty,
                    'exit_price': 0,
                    'pnl': 0.0,
                    'confidence': 'N/A',
                    'status': 'OPEN (SYNC)',
                    'cycle': global_state.current_cycle_id or 'N/A'
                }
                global_state.trade_history.insert(0, trade_record)
                added.append(symbol)
        else:
            try:
                account = self.client.get_futures_account()
                positions = account.get('positions', []) or []
            except Exception as e:
                log.warning(f"Failed to sync live positions: {e}")
                positions = []
            for pos in positions:
                amt = pos.get('positionAmt')
                if amt is None:
                    amt = pos.get('position_amt', 0)
                try:
                    amt_val = float(amt)
                except (TypeError, ValueError):
                    continue
                if abs(amt_val) == 0:
                    continue
                symbol = pos.get('symbol')
                if not symbol or has_open_record(symbol):
                    continue
                side = "LONG" if amt_val > 0 else "SHORT"
                entry_price = pos.get('entryPrice') or pos.get('entry_price') or 0
                try:
                    entry_price = float(entry_price)
                except (TypeError, ValueError):
                    entry_price = 0.0
                qty = abs(amt_val)
                trade_record = {
                    'open_cycle': 0,
                    'close_cycle': 0,
                    'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    'action': f"OPEN_{side}",
                    'symbol': symbol,
                    'entry_price': entry_price,
                    'quantity': qty,
                    'cost': entry_price * qty,
                    'exit_price': 0,
                    'pnl': 0.0,
                    'confidence': 'N/A',
                    'status': 'OPEN (SYNC)',
                    'cycle': global_state.current_cycle_id or 'N/A'
                }
                global_state.trade_history.insert(0, trade_record)
                added.append(symbol)

        if added:
            if len(global_state.trade_history) > 50:
                global_state.trade_history = global_state.trade_history[:50]
            log.info(f"📜 Synced open positions into trade history: {', '.join(added)}")
            global_state.add_log(f"[📜 SYSTEM] Synced open positions: {', '.join(added)}")

    def _apply_agent_config(self, agents: Dict[str, bool]) -> None:
        """Apply runtime agent config and sync optional agent instances."""
        from src.agents.agent_config import AgentConfig

        self.agent_config = AgentConfig.from_dict({'agents': agents})
        self._last_agent_config = dict(agents)
        global_state.agent_config = self.agent_config.get_enabled_agents()

        # Optional Agent: RegimeDetector
        if self.agent_config.regime_detector_agent:
            if self.regime_detector is None:
                from src.agents.regime_detector_agent import RegimeDetector
                self.regime_detector = RegimeDetector()
                log.info("✅ RegimeDetectorAgent enabled (runtime)")
        else:
            self.regime_detector = None

        # Optional Agent: PredictAgent (per symbol)
        if self.agent_config.predict_agent:
            for symbol in self.symbols:
                if symbol not in self.predict_agents:
                    from src.agents.predict_agent import PredictAgent
                    self.predict_agents[symbol] = PredictAgent(symbol=symbol)
                    log.info(f"🆕 Initialized PredictAgent for {symbol} (runtime)")
        else:
            self.predict_agents = {}

        # Optional Agent: ReflectionAgent
        if self.agent_config.reflection_agent_llm or self.agent_config.reflection_agent_local:
            if self.agent_config.reflection_agent_llm:
                from src.agents.reflection_agent import ReflectionAgentLLM
                if not isinstance(self.reflection_agent, ReflectionAgentLLM):
                    self.reflection_agent = ReflectionAgentLLM()
                    log.info("✅ ReflectionAgentLLM enabled (runtime)")
            else:
                from src.agents.reflection_agent import ReflectionAgent
                if not isinstance(self.reflection_agent, ReflectionAgent):
                    self.reflection_agent = ReflectionAgent()
                    log.info("✅ ReflectionAgent (no LLM) enabled (runtime)")
        else:
            self.reflection_agent = None

    def _is_llm_enabled(self) -> bool:
        """Return True if LLM-driven agents are enabled by runtime config."""
        return bool(
            self.agent_config.trend_agent_llm
            or self.agent_config.setup_agent_llm
            or self.agent_config.trigger_agent_llm
            or self.agent_config.reflection_agent_llm
        )

    def _attach_agent_ui_fields(self, decision_dict: Dict) -> None:
        """Attach optional agent fields used by the dashboard."""
        four_layer = getattr(global_state, 'four_layer_result', {}) or {}
        ai_check = four_layer.get('ai_check', {}) if isinstance(four_layer, dict) else {}
        if ai_check:
            decision_dict['ai_filter_passed'] = not ai_check.get('ai_veto', False)
            decision_dict['ai_filter_reason'] = ai_check.get('reason')
            decision_dict['ai_filter_signal'] = ai_check.get('ai_signal')
            decision_dict['ai_filter_confidence'] = ai_check.get('ai_confidence')

        decision_dict['trigger_pattern'] = four_layer.get('trigger_pattern')
        decision_dict['trigger_rvol'] = four_layer.get('trigger_rvol')

        position = decision_dict.get('position')
        if isinstance(position, dict) and position.get('location'):
            decision_dict['position_zone'] = position.get('location')

        semantic_analyses = getattr(global_state, 'semantic_analyses', None)
        if semantic_analyses:
            decision_dict['semantic_analyses'] = semantic_analyses

        reflection_text = getattr(global_state, 'last_reflection_text', None)
        reflection_count = getattr(global_state, 'reflection_count', 0)
        trades = getattr(global_state, 'trade_history', []) or []
        pnl_values = []
        for trade in trades:
            if not isinstance(trade, dict):
                continue
            pnl = trade.get('pnl', trade.get('realized_pnl'))
            if pnl is None:
                continue
            try:
                pnl_values.append(float(pnl))
            except (TypeError, ValueError):
                continue
        win_rate = None
        if pnl_values:
            wins = sum(1 for v in pnl_values if v > 0)
            win_rate = (wins / len(pnl_values)) * 100
        if reflection_text or reflection_count or pnl_values:
            decision_dict['reflection'] = {
                'count': reflection_count,
                'text': reflection_text,
                'trades': len(pnl_values),
                'win_rate': win_rate
            }

        indicator_snapshot = getattr(global_state, 'indicator_snapshot', None)
        if indicator_snapshot:
            snapshot = indicator_snapshot
            if isinstance(indicator_snapshot, dict) and 'ema_status' not in indicator_snapshot:
                symbol = decision_dict.get('symbol')
                snapshot = indicator_snapshot.get(symbol) if symbol else None
            if snapshot:
                decision_dict['indicator_snapshot'] = snapshot

    def _capture_indicator_snapshot(self, processed_dfs: Dict[str, "pd.DataFrame"], timeframe: str = '15m') -> Optional[Dict]:
        """Capture lightweight indicator snapshot for UI."""
        df = processed_dfs.get(timeframe)
        if df is None or df.empty:
            return None

        latest = df.iloc[-1]

        def _safe_float(value):
            try:
                val = float(value)
            except (TypeError, ValueError):
                return None
            if val != val or val in (float('inf'), float('-inf')):
                return None
            return val

        close = _safe_float(latest.get('close'))
        ema20 = _safe_float(latest.get('ema_20'))
        ema60 = _safe_float(latest.get('ema_60'))
        rsi = _safe_float(latest.get('rsi'))
        macd_diff = _safe_float(latest.get('macd_diff'))
        bb_upper = _safe_float(latest.get('bb_upper'))
        bb_lower = _safe_float(latest.get('bb_lower'))
        bb_middle = _safe_float(latest.get('bb_middle'))

        ema_status = None
        if close is not None and ema20 is not None and ema60 is not None:
            if close > ema20 > ema60:
                ema_status = 'bullish'
            elif close < ema20 < ema60:
                ema_status = 'bearish'
            elif ema20 > ema60:
                ema_status = 'bullish_bias'
            elif ema20 < ema60:
                ema_status = 'bearish_bias'
            else:
                ema_status = 'mixed'

        bb_position = None
        if close is not None and bb_upper is not None and bb_lower is not None and bb_middle is not None:
            if close > bb_upper:
                bb_position = 'upper'
            elif close < bb_lower:
                bb_position = 'lower'
            else:
                bb_position = 'middle'

        return {
            'timeframe': timeframe,
            'ema_status': ema_status,
            'rsi': rsi,
            'macd_diff': macd_diff,
            'bb_position': bb_position
        }

    def _detect_fast_trend_signal(
        self,
        df_5m: Optional["pd.DataFrame"],
        window_minutes: int = 30,
        threshold_pct: float = 0.8,
        volume_ratio_threshold: float = 1.2
    ) -> Optional[Dict]:
        """Detect short-term momentum over the last 30m and return a fast entry signal."""
        if df_5m is None or df_5m.empty:
            return None
        if 'close' not in df_5m.columns or 'volume' not in df_5m.columns:
            return None

        window_bars = max(2, int(window_minutes / 5))
        if len(df_5m) < window_bars * 2:
            return None

        recent = df_5m.iloc[-window_bars:]
        previous = df_5m.iloc[-window_bars * 2:-window_bars]
        first_close = float(recent['close'].iloc[0])
        last_close = float(recent['close'].iloc[-1])
        if first_close <= 0:
            return None

        change_pct = ((last_close - first_close) / first_close) * 100.0
        recent_volume = float(recent['volume'].sum())
        prev_volume = float(previous['volume'].sum()) if not previous.empty else 0.0
        volume_ratio = (recent_volume / prev_volume) if prev_volume > 0 else 1.0

        if change_pct >= threshold_pct and volume_ratio >= volume_ratio_threshold:
            action = 'open_long'
        elif change_pct <= -threshold_pct and volume_ratio >= volume_ratio_threshold:
            action = 'open_short'
        else:
            return None

        change_over = max(0.0, abs(change_pct) - threshold_pct)
        change_boost = min(15.0, change_over * 5.0)
        vol_over = max(0.0, volume_ratio - volume_ratio_threshold)
        vol_boost = min(10.0, vol_over * 10.0)
        confidence = min(92.0, 70.0 + change_boost + vol_boost)

        return {
            'action': action,
            'change_pct': change_pct,
            'volume_ratio': volume_ratio,
            'confidence': confidence,
            'window_minutes': window_minutes
        }

    def _resolve_ai500_symbols(self):
        """Dynamic resolution of AI500_TOP5 tag"""
        # AI Candidates List (30+ Major AI/Data/Compute Coins)
        AI_CANDIDATES = [
            "FETUSDT", "RENDERUSDT", "TAOUSDT", "NEARUSDT", "GRTUSDT", 
            "WLDUSDT", "ARKMUSDT", "LPTUSDT", "THETAUSDT", "ROSEUSDT",
            # Removed merged/renamed: AGIX, OCEAN, RNDR (now FET/RENDER)
            "PHBUSDT", "CTXCUSDT", "NMRUSDT", "RLCUSDT", "GLMUSDT",
            "IQUSDT", "MDTUSDT", "AIUSDT", "NFPUSDT", "XAIUSDT",
            "JASMYUSDT", "ICPUSDT", "FILUSDT", "VETUSDT", "LINKUSDT",
            "ACTUSDT", "GOATUSDT", "TURBOUSDT", "PNUTUSDT" 
        ]
        
        try:
            print("🤖 AI500 Dynamic Selection: Fetching 24h Volume Data...")
            # Use temporary client to fetch tickers
            temp_client = BinanceClient()
            tickers = temp_client.get_all_tickers()
            
            # Filter and Sort
            ai_stats = []
            for t in tickers:
                if t['symbol'] in AI_CANDIDATES:
                    try:
                        quote_vol = float(t['quoteVolume'])
                        ai_stats.append((t['symbol'], quote_vol))
                    except (KeyError, ValueError, TypeError) as e:
                        log.debug(f"Skipped {t.get('symbol', 'unknown')}: {e}")
            
            # Sort by Volume desc
            ai_stats.sort(key=lambda x: x[1], reverse=True)
            
            # Take Top 5
            top_5 = [x[0] for x in ai_stats[:5]]
            
            print(f"✅ AI500 Top 5 Selected (by Vol): {', '.join(top_5)}")
            return top_5
            
        except Exception as e:
            log.error(f"Failed to resolve AI500 symbols: {e}")
            # Fallback to defaults (Top 5)
            return ["FETUSDT", "RENDERUSDT", "TAOUSDT", "NEARUSDT", "GRTUSDT"]
    
    def _start_ai500_updater(self):
        """启动 AI500 定时更新后台线程"""
        def updater_loop():
            while True:
                try:
                    # Sleep for 6 hours
                    time.sleep(self.ai500_update_interval)
                    
                    if self.use_ai500:
                        log.info("🔄 AI500 Top5 - Starting scheduled update (every 6h)")
                        new_top5 = self._resolve_ai500_symbols()
                        
                        # Update symbols list
                        old_symbols = set(self.symbols)
                        # Remove old AI coins and add new ones
                        # Keep non-AI coins unchanged
                        major_coins = {'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'}
                        non_ai_symbols = [s for s in self.symbols if s in major_coins]
                        
                        # Merge with new AI top5
                        self.symbols = list(set(non_ai_symbols + new_top5))
                        self.symbols.sort()
                        
                        # Update global state
                        global_state.symbols = self.symbols
                        self.ai500_last_update = time.time()
                        
                        # Log changes
                        added = set(self.symbols) - old_symbols
                        removed = old_symbols - set(self.symbols)
                        if added or removed:
                            log.info(f"📊 AI500 Updated - Added: {added}, Removed: {removed}")
                            log.info(f"📋 Current symbols: {', '.join(self.symbols)}")
                            for symbol in added:
                                if symbol not in self.predict_agents:
                                    from src.agents.predict_agent import PredictAgent
                                    self.predict_agents[symbol] = PredictAgent(symbol=symbol)
                                    log.info(f"🆕 Initialized PredictAgent for {symbol}")
                        else:
                            log.info("✅ AI500 Updated - No changes in Top5")
                            
                except Exception as e:
                    log.error(f"AI500 updater error: {e}")
        
        # Start daemon thread
        updater_thread = threading.Thread(target=updater_loop, daemon=True, name="AI500-Updater")
        updater_thread.start()
        log.info(f"🚀 AI500 Auto-updater started (interval: 6 hours)")
    
    async def _resolve_auto3_symbols(self):
        """
        🔝 AUTO3 Dynamic Resolution via Backtest
        
        Gets AI500 Top 5 by volume, backtests each, and selects top 2
        """
        selector = get_selector()
        account_equity = self._get_account_equity_estimate()
        if hasattr(selector, 'account_equity') and account_equity:
            selector.account_equity = account_equity
        top2 = await selector.select_top3(force_refresh=False, account_equity=account_equity)
        
        log.info(f"🔝 AUTO3 resolved to: {', '.join(top2)}")
        return top2

    def _get_closed_klines(self, klines: List[Dict]) -> List[Dict]:
        """Return klines confirmed closed (avoid dropping already-closed bars)."""
        if not klines:
            return []

        last = klines[-1]
        if last.get('is_closed') is True:
            return klines

        close_time = last.get('close_time')
        if close_time is not None:
            try:
                now_ms = int(datetime.now().timestamp() * 1000)
                if int(close_time) <= now_ms:
                    return klines
            except (TypeError, ValueError):
                pass

        return klines[:-1]

    def _assess_data_readiness(self, processed_dfs: Dict[str, object]) -> Dict:
        """Check warmup/is_valid flags for all timeframes before making decisions."""
        readiness = {
            'is_ready': True,
            'details': {},
            'blocking_reason': None
        }

        min_valid_index = self.processor._get_min_valid_index()
        required_bars = min_valid_index + 1

        for tf in ['5m', '15m', '1h']:
            df = processed_dfs.get(tf)
            if df is None or df.empty:
                readiness['is_ready'] = False
                readiness['details'][tf] = {
                    'is_valid': False,
                    'bars': 0,
                    'bars_needed': required_bars,
                    'bars_remaining': required_bars,
                    'reason': 'no_data'
                }
                continue

            reason = None
            if 'is_valid' in df.columns:
                latest_valid = bool(df['is_valid'].iloc[-1] == True)
            elif 'is_warmup' in df.columns:
                latest_valid = bool(df['is_warmup'].iloc[-1] == False)
            else:
                latest_valid = False
                reason = 'missing_valid_flag'

            bars = len(df)
            bars_remaining = max(0, required_bars - bars)

            readiness['details'][tf] = {
                'is_valid': latest_valid,
                'bars': bars,
                'bars_needed': required_bars,
                'bars_remaining': bars_remaining,
                'reason': reason
            }

            if not latest_valid:
                readiness['is_ready'] = False

        if not readiness['is_ready']:
            reasons = []
            for tf, info in readiness['details'].items():
                if not info['is_valid']:
                    if info.get('reason'):
                        reasons.append(f"{tf}:{info['reason']}")
                    elif info.get('bars', 0) > 0:
                        reasons.append(f"{tf}:warmup {info['bars']}/{info['bars_needed']}")
                    else:
                        reasons.append(f"{tf}:no_data")
            readiness['blocking_reason'] = "data_warmup: " + ", ".join(reasons)

        return readiness
    
    
    
    def _init_accounts(self):
        """
        Initialize trading accounts from config or legacy .env
        
        Priority:
        1. Load from config/accounts.json if exists
        2. Auto-create default account from legacy .env if no accounts loaded
        """
        import os
        from pathlib import Path
        
        config_path = Path(__file__).parent / "config" / "accounts.json"
        
        # Try to load from config file
        loaded = self.account_manager.load_from_file(str(config_path))
        
        if loaded == 0:
            # No accounts.json found - create default from legacy .env
            log.info("No accounts.json found, creating default account from .env")
            
            api_key = os.environ.get('BINANCE_API_KEY', '')
            secret_key = os.environ.get('BINANCE_SECRET_KEY', '')
            testnet = os.environ.get('BINANCE_TESTNET', 'true').lower() == 'true'
            
            if api_key:
                default_account = ExchangeAccount(
                    id='main-binance',
                    user_id='default',
                    exchange_type=ExchangeType.BINANCE,
                    account_name='Main Binance Account',
                    enabled=True,
                    api_key=api_key,
                    secret_key=secret_key,
                    testnet=testnet or self.test_mode
                )
                self.account_manager.add_account(default_account)
                log.info(f"✅ Created default account: {default_account.account_name}")
            else:
                log.warning("No API key found in .env - running in demo mode")
        
        # Log summary
        accounts = self.account_manager.list_accounts(enabled_only=True)
        if accounts:
            print(f"  📊 Loaded {len(accounts)} trading accounts:")
            for acc in accounts:
                print(f"     - {acc.account_name} ({acc.exchange_type.value}, testnet={acc.testnet})")
    
    def get_accounts(self):
        """Get list of enabled trading accounts."""
        return self.account_manager.list_accounts(enabled_only=True)
    
    async def get_trader(self, account_id: str):
        """Get trader instance for a specific account."""
        return await self.account_manager.get_trader(account_id)


    async def run_trading_cycle(self, analyze_only: bool = False) -> Dict:
        """
        执行完整的交易循环（异步版本）
        Returns:
            {
                'status': 'success/failed/hold/blocked',
                'action': 'long/short/hold',
                'details': {...}
            }
        """
        # Headless mode: Simplified output
        if hasattr(self, '_headless_mode') and self._headless_mode:
            self._terminal_display.print_log(f"🔍 Analyzing {self.current_symbol}...", "INFO")
        else:
            print(f"\n{'='*80}")
            print(f"🔄 启动交易审计循环 | {datetime.now().strftime('%H:%M:%S')} | {self.current_symbol}")
            print(f"{'='*80}")
        
        # Update Dashboard Status
        global_state.is_running = True
        global_state.current_symbol = self.current_symbol
        # Removed verbose log: Starting trading cycle
        
        try:
            # ✅ 使用 run_continuous 中已设置的周期信息
            cycle_num = global_state.cycle_counter
            cycle_id = global_state.current_cycle_id
            
            # 每个币种的子日志
            global_state.add_log(f"[📊 SYSTEM] {self.current_symbol} analysis started")
            
            # [NEW] Clear chatroom messages for new symbol cycle
            global_state.agent_messages = [msg for msg in global_state.agent_messages if msg.get('symbol') != self.current_symbol]
            
            # ✅ Generate snapshot_id for this cycle (legacy compatibility)
            snapshot_id = f"snap_{int(time.time())}"

            # Step 1: 采样 - 数据先知 (The Oracle)
            if not (hasattr(self, '_headless_mode') and self._headless_mode):
                print("\n[Step 1/4] 🕵️ The Oracle (Data Agent) - Fetching data...")
            global_state.oracle_status = "Fetching Data..."
            global_state.add_agent_message("system", f"Fetching market data for {self.current_symbol}...", level="info")
            
            try:
                market_snapshot = await self.data_sync_agent.fetch_all_timeframes(
                    self.current_symbol,
                    limit=self.kline_limit
                )
            except Exception as e:
                error_msg = f"❌ DATA FETCH FAILED: {str(e)}"
                log.error(error_msg)
                global_state.add_log(f"[🚨 CRITICAL] {error_msg}")
                global_state.oracle_status = "DATA ERROR"
                
                # Block trading - return error
                return {
                    'status': 'error',
                    'action': 'blocked',
                    'details': {
                        'reason': f'Data API call failed: {str(e)}',
                        'error_type': 'api_failure'
                    }
                }
            
            # 🔒 CRITICAL: Validate data completeness before proceeding
            data_errors = []
            
            # Check 5m data
            if market_snapshot.stable_5m is None or (hasattr(market_snapshot.stable_5m, 'empty') and market_snapshot.stable_5m.empty):
                data_errors.append("5m data missing or empty")
            elif len(market_snapshot.stable_5m) < 50:
                data_errors.append(f"5m data incomplete ({len(market_snapshot.stable_5m)}/50 bars)")
            
            # Check 15m data
            if market_snapshot.stable_15m is None or (hasattr(market_snapshot.stable_15m, 'empty') and market_snapshot.stable_15m.empty):
                data_errors.append("15m data missing or empty")
            elif len(market_snapshot.stable_15m) < 20:
                data_errors.append(f"15m data incomplete ({len(market_snapshot.stable_15m)}/20 bars)")
            
            # Check 1h data
            if market_snapshot.stable_1h is None or (hasattr(market_snapshot.stable_1h, 'empty') and market_snapshot.stable_1h.empty):
                data_errors.append("1h data missing or empty")
            elif len(market_snapshot.stable_1h) < 10:
                data_errors.append(f"1h data incomplete ({len(market_snapshot.stable_1h)}/10 bars)")
            
            # Check live price
            if not market_snapshot.live_5m or market_snapshot.live_5m.get('close', 0) <= 0:
                data_errors.append("Live price unavailable")
            
            # If any data errors, block trading
            if data_errors:
                error_msg = f"❌ DATA INCOMPLETE: {'; '.join(data_errors)}"
                log.error(error_msg)
                global_state.add_log(f"[🚨 CRITICAL] {error_msg}")
                global_state.oracle_status = "DATA INCOMPLETE"
                
                # Persistent error display
                print(f"\n{'='*60}")
                print(f"🚨 TRADING BLOCKED - DATA ERROR")
                print(f"{'='*60}")
                for err in data_errors:
                    print(f"   ❌ {err}")
                print(f"{'='*60}\n")
                
                return {
                    'status': 'error',
                    'action': 'blocked',
                    'details': {
                        'reason': error_msg,
                        'error_type': 'data_incomplete',
                        'errors': data_errors
                    }
                }
            
            global_state.oracle_status = "Data Ready"
            
            # 💰 fetch_position_info logic (New Feature)
            # Create a unified position_info dict for Context
            current_position_info = None
            
            try:
                if self.test_mode:
                    if self.current_symbol in global_state.virtual_positions:
                        v_pos = global_state.virtual_positions[self.current_symbol]
                        # Calc PnL
                        current_price_5m = market_snapshot.live_5m['close']
                        entry_price = v_pos['entry_price']
                        qty = v_pos['quantity']
                        side = v_pos['side']
                        leverage = v_pos.get('leverage', 1)
                        
                        if side == 'LONG':
                            unrealized_pnl = (current_price_5m - entry_price) * qty
                        else:
                            unrealized_pnl = (entry_price - current_price_5m) * qty
                        
                        # 统一使用 ROE (Return on Equity) 计算方式
                        # ROE% = (unrealized_pnl / margin) * 100
                        # 其中 margin = (entry_price * qty) / leverage
                        margin = (entry_price * qty) / leverage if leverage > 0 else entry_price * qty
                        pnl_pct = (unrealized_pnl / margin) * 100 if margin > 0 else 0
                        
                        # Store in position_info
                        current_position_info = {
                            'symbol': self.current_symbol,
                            'side': side,
                            'quantity': qty,
                            'entry_price': entry_price,
                            'unrealized_pnl': unrealized_pnl,
                            'pnl_pct': pnl_pct,  # ROE 百分比
                            'leverage': leverage,
                            'is_test': True
                        }
                        
                        # Also update local object for backward compatibility with display logic
                        v_pos['unrealized_pnl'] = unrealized_pnl
                        v_pos['pnl_pct'] = pnl_pct
                        v_pos['current_price'] = current_price_5m
                        log.info(f"💰 [Virtual Position] {side} {self.current_symbol} PnL: ${unrealized_pnl:.2f} (ROE: {pnl_pct:+.2f}%)")
                        
                else:
                    # Live Mode
                    try:
                        raw_pos = self.client.get_futures_position(self.current_symbol)
                        # raw_pos returns dict if specific symbol, or list if not?
                        # BinanceClient.get_futures_position returns Optional[Dict]
                        
                        if raw_pos and float(raw_pos.get('positionAmt', 0)) != 0:
                            amt = float(raw_pos.get('positionAmt', 0))
                            side = 'LONG' if amt > 0 else 'SHORT'
                            entry_price = float(raw_pos.get('entryPrice', 0))
                            unrealized_pnl = float(raw_pos.get('unRealizedProfit', 0))
                            qty = abs(amt)
                            leverage = int(raw_pos.get('leverage', 1))
                            
                            # 统一使用 ROE (Return on Equity) 计算方式 - 与测试模式一致
                            margin = (entry_price * qty) / leverage if leverage > 0 else entry_price * qty
                            pnl_pct = (unrealized_pnl / margin) * 100 if margin > 0 else 0
                            
                            current_position_info = {
                                'symbol': self.current_symbol,
                                'side': side,
                                'quantity': qty,
                                'entry_price': entry_price,
                                'unrealized_pnl': unrealized_pnl,
                                'pnl_pct': pnl_pct,  # ROE 百分比
                                'leverage': leverage,
                                'is_test': False
                            }
                            log.info(f"💰 [Real Position] {side} {self.current_symbol} Amt:{amt} PnL:${unrealized_pnl:.2f} (ROE: {pnl_pct:+.2f}%)")
                    except Exception as e:
                        log.error(f"Failed to fetch real position: {e}")

            except Exception as e:
                 log.error(f"Error processing position info: {e}")

            # ✅ Save Market Data & Process Indicators
            processed_dfs = {}
            for tf in ['5m', '15m', '1h']:
                raw_klines = getattr(market_snapshot, f'raw_{tf}')
                # 保存原始数据
                self.saver.save_market_data(raw_klines, self.current_symbol, tf, cycle_id=cycle_id)
                
                # 处理并保存指标 (Process indicators)
                # Use stable (closed) klines for indicators to avoid look-ahead from live candle
                stable_klines = self._get_closed_klines(raw_klines)
                df_with_indicators = self.processor.process_klines(
                    stable_klines,
                    self.current_symbol,
                    tf,
                    save_raw=False
                )
                self.saver.save_indicators(df_with_indicators, self.current_symbol, tf, snapshot_id, cycle_id=cycle_id)
                features_df = self.processor.extract_feature_snapshot(df_with_indicators)
                self.saver.save_features(features_df, self.current_symbol, tf, snapshot_id, cycle_id=cycle_id)
                
                # 存入字典供后续步骤复用
                processed_dfs[tf] = df_with_indicators
            
            # ✅ 重要优化：更新快照中的 DataFrame
            market_snapshot.stable_5m = processed_dfs['5m']
            market_snapshot.stable_15m = processed_dfs['15m']
            market_snapshot.stable_1h = processed_dfs['1h']
            
            current_price = market_snapshot.live_5m.get('close')
            print(f"  ✅ Data ready: ${current_price:,.2f} ({market_snapshot.timestamp.strftime('%H:%M:%S')})")
            
            # LOG 1: Oracle
            global_state.add_log(f"[🕵️ ORACLE] Data ready: ${current_price:,.2f}")
            global_state.current_price[self.current_symbol] = current_price

            # Warmup / data validity gate (avoid decisions on unstable indicators)
            data_readiness = self._assess_data_readiness(processed_dfs)
            if not data_readiness['is_ready']:
                reason = data_readiness.get('blocking_reason') or "data_warmup"
                log.warning(f"[{self.current_symbol}] {reason}")
                global_state.add_log(f"[DATA] {reason}")
                global_state.oracle_status = "Warmup"
                global_state.guardian_status = "Warmup"
                global_state.four_layer_result = {
                    'layer1_pass': False,
                    'layer2_pass': False,
                    'layer3_pass': False,
                    'layer4_pass': False,
                    'final_action': 'wait',
                    'blocking_reason': reason,
                    'data_ready': False,
                    'data_validity': data_readiness['details']
                }

                decision_dict = {
                    'action': 'wait',
                    'confidence': 0,
                    'reason': reason,
                    'vote_details': {
                        'data_validity': data_readiness['details']
                    },
                    'symbol': self.current_symbol,
                    'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    'cycle_number': global_state.cycle_counter,
                    'cycle_id': global_state.current_cycle_id,
                    'risk_level': 'safe',
                    'guardian_passed': True
                }
                decision_dict['vote_analysis'] = SemanticConverter.convert_analysis_map(decision_dict.get('vote_details', {}))
                decision_dict['four_layer_status'] = global_state.four_layer_result
                self._attach_agent_ui_fields(decision_dict)

                global_state.update_decision(decision_dict)
                self.saver.save_decision(decision_dict, self.current_symbol, snapshot_id, cycle_id=cycle_id)

                return {
                    'status': 'wait',
                    'action': 'wait',
                    'details': {
                        'reason': reason,
                        'confidence': 0
                    }
                }

            indicator_snapshot = self._capture_indicator_snapshot(processed_dfs, timeframe='15m')
            if indicator_snapshot:
                snapshots = getattr(global_state, 'indicator_snapshot', {})
                if not isinstance(snapshots, dict) or 'ema_status' in snapshots:
                    snapshots = {}
                snapshots[self.current_symbol] = indicator_snapshot
                global_state.indicator_snapshot = snapshots

            # Step 2: Analysts in Parallel (Chatroom Mode)
            if not (hasattr(self, '_headless_mode') and self._headless_mode):
                print("[Step 2/4] 👥 Multi-Agent Analysis (Parallel)...")
            global_state.add_log(f"[📊 SYSTEM] Parallel analysis started for {self.current_symbol}")

            # Define Parallel Tasks with Immediate Message Dispatch Wrappers
            async def quant_task():
                res = await self.quant_analyst.analyze_all_timeframes(market_snapshot)
                # --- Post Quant Analyst Results Immediately ---
                trend_score = res.get('trend', {}).get('total_trend_score', 0)
                osc_score = res.get('oscillator', {}).get('total_osc_score', 0)
                sent_score = res.get('sentiment', {}).get('total_sentiment_score', 0)
                quant_msg = f"Analysis Complete. Trend={trend_score:+.0f} | Osc={osc_score:+.0f} | Sent={sent_score:+.0f}"
                global_state.add_agent_message("quant_analyst", quant_msg, level="success")
                return res

            async def predict_task():
                if self.agent_config.predict_agent and self.current_symbol in self.predict_agents:
                    df_15m_features = self.feature_engineer.build_features(processed_dfs['15m'])
                    latest_features = {}
                    if not df_15m_features.empty:
                        latest = df_15m_features.iloc[-1].to_dict()
                        latest_features = {k: v for k, v in latest.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
                    
                    res = await self.predict_agents[self.current_symbol].predict(latest_features)
                    # --- Post Predict Agent Results Immediately ---
                    global_state.prophet_probability = res.probability_up
                    p_up_pct = res.probability_up * 100
                    direction = "↗UP" if res.probability_up > 0.55 else ("↘DN" if res.probability_up < 0.45 else "➖NEU")
                    predict_msg = f"Probability Up: {p_up_pct:.1f}% {direction} (Conf: {res.confidence*100:.0f}%)"
                    global_state.add_agent_message("predict_agent", predict_msg, level="info")
                    self.saver.save_prediction(asdict(res), self.current_symbol, snapshot_id, cycle_id=cycle_id)
                    return res
                return None

            async def reflection_task_wrapper():
                total_trades = len(global_state.trade_history)
                if self.reflection_agent and self.reflection_agent.should_reflect(total_trades):
                    global_state.add_agent_message("reflection_agent", "🔍 Reflecting on recent trade performance...", level="info")
                    trades_to_analyze = global_state.trade_history[-10:]
                    res = await self.reflection_agent.generate_reflection(trades_to_analyze)
                    # --- Post Reflection Agent Results Immediately ---
                    if res:
                        reflection_text = res.to_prompt_text()
                        global_state.last_reflection = res.raw_response
                        global_state.last_reflection_text = reflection_text
                        global_state.reflection_count = self.reflection_agent.reflection_count
                        global_state.add_agent_message("reflection_agent", f"Reflected on {len(trades_to_analyze)} trades. Insight: {res.insight[:100]}...", level="info")
                    return res
                return None

            # Execute Parallel Tasks
            analysis_results = await asyncio.gather(
                quant_task(),
                predict_task(),
                reflection_task_wrapper()
            )
            
            # Process Results
            quant_analysis = analysis_results[0]
            predict_result = analysis_results[1]
            reflection_result = analysis_results[2]
            
            reflection_text = reflection_result.to_prompt_text() if reflection_result else global_state.last_reflection_text
            
            # 💉 INJECT MACD DATA (Fix for Missing Data)
            try:
                df_15m = processed_dfs['15m']
                # Check for macd_diff or calculate it if missing (though processor handles it)
                if 'macd_diff' in df_15m.columns:
                    macd_val = float(df_15m['macd_diff'].iloc[-1])
                    if 'trend' not in quant_analysis: quant_analysis['trend'] = {}
                    if 'details' not in quant_analysis['trend']: quant_analysis['trend']['details'] = {}
                    quant_analysis['trend']['details']['15m_macd_diff'] = macd_val
            except Exception as e:
                log.warning(f"Failed to inject MACD data: {e}")
            
            # Save Context
            self.saver.save_context(quant_analysis, self.current_symbol, 'analytics', snapshot_id, cycle_id=cycle_id)
            
            # LOG 2: QuantAnalyst (The Strategist)
            trend_score = quant_analysis.get('trend', {}).get('total_trend_score', 0)
            osc_score = quant_analysis.get('oscillator', {}).get('total_osc_score', 0)
            sent_score = quant_analysis.get('sentiment', {}).get('total_sentiment_score', 0)
            global_state.add_log(f"[👨‍🔬 STRATEGIST] Trend={trend_score:+.0f} | Osc={osc_score:+.0f} | Sent={sent_score:+.0f}")
            
            # Prophet already computed in Step 2 parallel block.
            
            # === 🎯 FOUR-LAYER STRATEGY FILTERING ===
            if not (hasattr(self, '_headless_mode') and self._headless_mode):
                print("[Step 2.75/5] 🎯 Four-Layer Strategy Filter - 多层验证中...")
            
            # Extract timeframe data
            trend_6h = quant_analysis.get('timeframe_6h', {})
            trend_2h = quant_analysis.get('timeframe_2h', {})
            sentiment = quant_analysis.get('sentiment', {})
            oi_fuel = sentiment.get('oi_fuel', {})
            
            # 🆕 Get Funding Rate for crowding detection
            funding_rate = sentiment.get('details', {}).get('funding_rate', 0)
            if funding_rate is None: funding_rate = 0
            
            # 🆕 Get ADX from RegimeDetector for trend strength validation
            # RegimeDetector is optional - use safe defaults if disabled
            df_1h = processed_dfs['1h']
            if self.regime_detector and len(df_1h) >= 20:
                regime_result = self.regime_detector.detect_regime(df_1h)
            else:
                # RegimeDetector disabled or insufficient data - use neutral defaults
                regime_result = {'adx': 20, 'regime': 'unknown', 'confidence': 0}
            adx_value = regime_result.get('adx', 20)
            
            # Initialize filter results with enhanced fields
            four_layer_result = {
                'layer1_pass': False,
                'layer2_pass': False,
                'layer3_pass': False,
                'layer4_pass': False,
                'final_action': 'wait',
                'blocking_reason': None,
                'confidence_boost': 0,
                'tp_multiplier': 1.0,
                'sl_multiplier': 1.0,
                # 🆕 Enhanced indicators
                'adx': adx_value,
                'funding_rate': funding_rate,
                'regime': regime_result.get('regime', 'unknown')
            }
            
            # Layer 1: 1h Trend + OI Fuel (Specification: EMA 20/60 on 1h data)
            df_1h = processed_dfs['1h']
            
            # 🆕 Always extract and store EMA values for display (even if blocking)
            if len(df_1h) >= 20:
                close_1h = df_1h['close'].iloc[-1]
                ema20_1h = df_1h['ema_20'].iloc[-1] if 'ema_20' in df_1h.columns else close_1h
                ema60_1h = df_1h['ema_60'].iloc[-1] if 'ema_60' in df_1h.columns else close_1h
                
                # Store for user prompt display
                four_layer_result['close_1h'] = close_1h
                four_layer_result['ema20_1h'] = ema20_1h
                four_layer_result['ema60_1h'] = ema60_1h
            else:
                close_1h = current_price
                ema20_1h = current_price
                ema60_1h = current_price
                four_layer_result['close_1h'] = close_1h
                four_layer_result['ema20_1h'] = ema20_1h
                four_layer_result['ema60_1h'] = ema60_1h
            
            # Extract OI change and store immediately
            oi_change = oi_fuel.get('oi_change_24h', 0)
            if oi_change is None: oi_change = 0
            four_layer_result['oi_change'] = oi_change
            
            # 🆕 DATA SANITY CHECKS - Flag statistically impossible values
            data_anomalies = []
            
            # OI Change sanity check: > 200% is likely a data error
            if abs(oi_change) > 200:
                data_anomalies.append(f"OI_ANOMALY: {oi_change:.1f}% (>200% likely data error)")
                log.warning(f"⚠️ DATA ANOMALY: OI Change {oi_change:.1f}% is abnormally high")
                # Clamp to reasonable value for downstream logic
                oi_change = max(min(oi_change, 100), -100)
                four_layer_result['oi_change'] = oi_change
                four_layer_result['oi_change_raw'] = oi_fuel.get('oi_change_24h', 0)  # Keep original
            
            # ADX sanity check: < 5 is likely calculation error or extreme edge case
            if adx_value < 5:
                data_anomalies.append(f"ADX_ANOMALY: {adx_value:.0f} (<5 may be unreliable)")
                log.warning(f"⚠️ DATA ANOMALY: ADX {adx_value:.0f} is abnormally low")
            
            # Funding Rate sanity check: > 1% per 8h is extreme
            if abs(funding_rate) > 1.0:
                data_anomalies.append(f"FUNDING_ANOMALY: {funding_rate:.3f}% (extreme)")
                log.warning(f"⚠️ DATA ANOMALY: Funding Rate {funding_rate:.3f}% is extreme")
            
            # 🆕 LOGIC PARADOX DETECTION - Contradictory data patterns
            regime = regime_result.get('regime', 'unknown')
            # Real paradox: trending regime with very low ADX (ADX < 15 means no trend)
            if adx_value < 15 and regime in ['trending_up', 'trending_down']:
                data_anomalies.append(f"LOGIC_PARADOX: ADX={adx_value:.0f} (no trend) + Regime={regime} (trending)")
                log.warning(f"⚠️ LOGIC PARADOX: ADX={adx_value:.0f} indicates NO trend, but Regime={regime}. Forcing to choppy.")
                # Force regime to 'choppy' when ADX is extremely low but regime says trending
                four_layer_result['regime'] = 'choppy'
                four_layer_result['regime_override'] = True
            
            # Store anomalies for LLM awareness
            four_layer_result['data_anomalies'] = data_anomalies if data_anomalies else None
            
            # Now check if we have enough data for trend analysis
            if len(df_1h) < 60:
                log.warning(f"⚠️ Insufficient 1h data: {len(df_1h)} bars (need 60+)")
                four_layer_result['blocking_reason'] = 'Insufficient 1h data'
                trend_1h = 'neutral'
            else:
                # 📈 OPTIMIZED: Relaxed trend detection
                # Primary: EMA20 > EMA60 = Bullish, EMA20 < EMA60 = Bearish
                # Bonus: Close above/below EMA20 adds confirmation strength
                if ema20_1h > ema60_1h:
                    trend_1h = 'long'
                    # Bonus confirmation: Close > EMA20
                    if close_1h > ema20_1h:
                        four_layer_result['trend_confirmation'] = 'strong'
                    else:
                        four_layer_result['trend_confirmation'] = 'moderate'
                elif ema20_1h < ema60_1h:
                    trend_1h = 'short'
                    if close_1h < ema20_1h:
                        four_layer_result['trend_confirmation'] = 'strong'
                    else:
                        four_layer_result['trend_confirmation'] = 'moderate'
                else:
                    trend_1h = 'neutral'
                
                log.info(f"📊 1h EMA: Close=${close_1h:.2f}, EMA20=${ema20_1h:.2f}, EMA60=${ema60_1h:.2f} => {trend_1h.upper()}")
            
            oi_divergence_warning = None
            oi_divergence_warn = 15.0
            oi_divergence_block = 60.0

            if trend_1h == 'neutral':
                four_layer_result['blocking_reason'] = 'No clear 1h trend (EMA 20/60)'
                log.info("❌ Layer 1 FAIL: No clear trend")
            # 🆕 ADX Weak Trend Filter - Even if EMA aligned, weak trend is not tradeable
            elif adx_value < 15: # OPTIMIZATION (Phase 2): Lowered from 20
                four_layer_result['blocking_reason'] = f"Weak Trend Strength (ADX {adx_value:.0f} < 15)"
                log.info(f"❌ Layer 1 FAIL: ADX={adx_value:.0f} < 15, trend not strong enough")
            elif trend_1h == 'long' and oi_change < -oi_divergence_block:
                four_layer_result['blocking_reason'] = f"OI Divergence: Trend UP but OI {oi_change:.1f}%"
                log.warning(f"🚨 Layer 1 FAIL: OI Divergence - Price up but OI {oi_change:.1f}%")
            elif trend_1h == 'short' and oi_change > oi_divergence_block:
                four_layer_result['blocking_reason'] = f"OI Divergence: Trend DOWN but OI +{oi_change:.1f}%"
                log.warning(f"🚨 Layer 1 FAIL: OI Divergence - Price down but OI +{oi_change:.1f}%")
            elif trend_1h == 'long' and oi_change < -oi_divergence_warn:
                oi_divergence_warning = f"OI Divergence: Trend UP but OI {oi_change:.1f}%"
                log.warning(f"⚠️ Layer 1 WARNING: OI Divergence - Price up but OI {oi_change:.1f}%")
            elif trend_1h == 'short' and oi_change > oi_divergence_warn:
                oi_divergence_warning = f"OI Divergence: Trend DOWN but OI +{oi_change:.1f}%"
                log.warning(f"⚠️ Layer 1 WARNING: OI Divergence - Price down but OI +{oi_change:.1f}%")
            elif trend_1h == 'long' and oi_fuel.get('whale_trap_risk', False):
                four_layer_result['blocking_reason'] = f"Whale trap detected (OI {oi_change:.1f}%)"
                log.warning(f"🐋 Layer 1 FAIL: Whale exit trap")

            if not four_layer_result.get('blocking_reason'):
                four_layer_result['layer1_pass'] = True
                
                # 🔴 Issue #3 Fix: Weak Fuel is WARNING, not BLOCK
                if abs(oi_change) < 1.0:
                    four_layer_result['fuel_warning'] = f"Weak Fuel (OI {oi_change:.1f}%)"
                    four_layer_result['confidence_penalty'] = -10
                    log.warning(f"⚠️ Layer 1 WARNING: Weak fuel - OI {oi_change:.1f}% (proceed with caution)")
                    fuel_strength = 'Weak'
                else:
                    # Specification: Strong Fuel > 3%, Moderate 1-3%
                    fuel_strength = 'Strong' if abs(oi_change) > 3.0 else 'Moderate'
                if oi_divergence_warning:
                    existing_warning = four_layer_result.get('fuel_warning')
                    if existing_warning:
                        four_layer_result['fuel_warning'] = f"{existing_warning} | {oi_divergence_warning}"
                    else:
                        four_layer_result['fuel_warning'] = oi_divergence_warning
                    current_penalty = four_layer_result.get('confidence_penalty', 0)
                    four_layer_result['confidence_penalty'] = min(current_penalty, -10) if current_penalty else -10
                log.info(f"✅ Layer 1 PASS: {trend_1h.upper()} trend + {fuel_strength} Fuel (OI {oi_change:+.1f}%)")
                
                # Layer 2: AI Prediction Filter (Optional - skip if disabled)
                if self.agent_config.ai_prediction_filter_agent and self.agent_config.predict_agent:
                    from src.agents.ai_prediction_filter_agent import AIPredictionFilter
                    ai_filter = AIPredictionFilter()
                    ai_check = ai_filter.check_divergence(trend_1h, predict_result)
                    
                    four_layer_result['ai_check'] = ai_check
                    
                    # 🆕 AI PREDICTION INVALIDATION: When ADX < 5, any directional AI prediction is noise
                    if adx_value < 5:
                        ai_check['ai_invalidated'] = True
                        ai_check['original_signal'] = ai_check.get('ai_signal', 'unknown')
                        ai_check['ai_signal'] = 'INVALID (ADX<5)'
                        four_layer_result['ai_prediction_note'] = f"AI prediction invalidated: ADX={adx_value:.0f} (<5), directional signals are statistically meaningless"
                        log.warning(f"⚠️ AI prediction invalidated: ADX={adx_value:.0f} is too low for any directional signal to be reliable")
                    
                    if ai_check['ai_veto']:
                        four_layer_result['blocking_reason'] = ai_check['reason']
                        log.warning(f"🚫 Layer 2 VETO: {ai_check['reason']}")
                    else:
                        four_layer_result['layer2_pass'] = True
                        four_layer_result['confidence_boost'] = ai_check['confidence_boost']
                        log.info(f"✅ Layer 2 PASS: AI {ai_check['ai_signal']} (boost: {ai_check['confidence_boost']:+d}%)")
                else:
                    # AIPredictionFilterAgent disabled - auto-pass Layer 2
                    four_layer_result['layer2_pass'] = True
                    four_layer_result['ai_check'] = {
                        'allow_trade': True,
                        'reason': 'AIPredictionFilter disabled',
                        'confidence_boost': 0,
                        'ai_veto': False,
                        'ai_signal': 'disabled',
                        'ai_confidence': 0
                    }
                    log.info(f"⏭️ Layer 2 SKIP: AIPredictionFilterAgent disabled")
                
                # Layer 3: 15m Setup (only if Layer 2 passed)
                if four_layer_result['layer2_pass']:
                    df_15m = processed_dfs['15m']
                    if len(df_15m) < 20:
                        log.warning(f"⚠️ Insufficient 15m data: {len(df_15m)} bars")
                        four_layer_result['blocking_reason'] = 'Insufficient 15m data'
                        setup_ready = False
                    else:
                        close_15m = df_15m['close'].iloc[-1]
                        bb_middle = df_15m['bb_middle'].iloc[-1]
                        bb_upper = df_15m['bb_upper'].iloc[-1]
                        bb_lower = df_15m['bb_lower'].iloc[-1]
                        kdj_j = df_15m['kdj_j'].iloc[-1]
                        kdj_k = df_15m['kdj_k'].iloc[-1]
                        
                        log.info(f"📊 15m Setup: Close=${close_15m:.2f}, BB[{bb_lower:.2f}/{bb_middle:.2f}/{bb_upper:.2f}], KDJ_J={kdj_j:.1f}")
                        
                        # 🆕 Store setup details for display
                        four_layer_result['setup_note'] = f"KDJ_J={kdj_j:.0f}, Close={'>' if close_15m > bb_middle else '<'}BB_mid"
                        four_layer_result['kdj_j'] = kdj_j
                        four_layer_result['bb_position'] = 'upper' if close_15m > bb_upper else 'lower' if close_15m < bb_lower else 'middle'
                        
                        # 🔴 Bug #3 Fix: Add explicit kdj_zone field
                        if kdj_j > 80 or close_15m > bb_upper:
                            four_layer_result['kdj_zone'] = 'overbought'
                        elif kdj_j < 20 or close_15m < bb_lower:
                            four_layer_result['kdj_zone'] = 'oversold'
                        else:
                            four_layer_result['kdj_zone'] = 'neutral'
                        
                        # 🔴 Issue #2 Fix: Pullback Strategy (Buy the Dip)
                        # Specification logic for long setup
                        if trend_1h == 'long':
                            # Filter: Too high (overbought) - WAIT for pullback
                            if close_15m > bb_upper or kdj_j > 80:
                                setup_ready = False
                                four_layer_result['blocking_reason'] = f"15m overbought (J={kdj_j:.0f}) - wait for pullback"
                                log.info(f"⏳ Layer 3 WAIT: Overbought - waiting for pullback")
                            # IDEAL: Pullback position (best entry in uptrend!)
                            elif close_15m < bb_middle or kdj_j < 50: # OPTIMIZATION (Phase 2): Relaxed from 40
                                setup_ready = True
                                four_layer_result['setup_quality'] = 'IDEAL'
                                log.info(f"✅ Layer 3 READY: IDEAL PULLBACK - J={kdj_j:.0f} < 50 or Close < BB_middle")
                            # Acceptable: Neutral/mid-range (not ideal but OK)
                            else:
                                setup_ready = True  # ✅ Changed from False
                                four_layer_result['setup_quality'] = 'ACCEPTABLE'
                                log.info(f"✅ Layer 3 READY: Acceptable mid-range entry (J={kdj_j:.0f})")
                        
                        # Specification logic for short setup
                        elif trend_1h == 'short':
                            # Filter: Too low (oversold) - WAIT for rally
                            if close_15m < bb_lower or kdj_j < 20:
                                setup_ready = False
                                four_layer_result['blocking_reason'] = f"15m oversold (J={kdj_j:.0f}) - wait for rally"
                                log.info(f"⏳ Layer 3 WAIT: Oversold - waiting for rally")
                            # IDEAL: Rally position (best entry in downtrend!)
                            elif close_15m > bb_middle or kdj_j > 50: # OPTIMIZATION (Phase 2): Relaxed from 60
                                setup_ready = True
                                four_layer_result['setup_quality'] = 'IDEAL'
                                log.info(f"✅ Layer 3 READY: IDEAL RALLY - J={kdj_j:.0f} > 60 or Close > BB_middle")
                            # Acceptable: Neutral/mid-range
                            else:
                                setup_ready = True  # ✅ Changed from False
                                four_layer_result['setup_quality'] = 'ACCEPTABLE'
                                log.info(f"✅ Layer 3 READY: Acceptable mid-range entry (J={kdj_j:.0f})")
                        else:
                            setup_ready = False
                    
                    if not setup_ready:
                        four_layer_result['blocking_reason'] = f"15m setup not ready"
                        log.info(f"⏳ Layer 3 WAIT: 15m setup not ready")
                    else:
                        four_layer_result['layer3_pass'] = True
                        log.info(f"✅ Layer 3 PASS: 15m setup ready")
                        
                        # Layer 4: 5min Trigger + Sentiment Risk (Specification Module 4)
                        if self.agent_config.trigger_detector_agent:
                            from src.agents.trigger_detector_agent import TriggerDetector
                            trigger_detector = TriggerDetector()
                            
                            df_5m = processed_dfs['5m']
                            trigger_result = trigger_detector.detect_trigger(df_5m, direction=trend_1h)
                            
                            # 🆕 Always store trigger data for LLM display
                            four_layer_result['trigger_pattern'] = trigger_result.get('pattern_type') or 'None'
                            rvol = trigger_result.get('rvol', 1.0)
                            four_layer_result['trigger_rvol'] = rvol
                            
                            # ⚠️ LOW VOLUME WARNING
                            if rvol < 0.5:
                                log.warning(f"⚠️ Low Volume Warning (RVOL {rvol:.1f}x < 0.5) - Trend validation may be unreliable")
                                if not four_layer_result.get('data_anomalies'): four_layer_result['data_anomalies'] = []
                                four_layer_result['data_anomalies'].append(f"Low Volume (RVOL {rvol:.1f}x)")
                            
                            if not trigger_result['triggered']:
                                four_layer_result['blocking_reason'] = f"5min trigger not confirmed (RVOL={trigger_result.get('rvol', 1.0):.1f}x)"
                                log.info(f"⏳ Layer 4 WAIT: No engulfing or breakout pattern (RVOL={trigger_result.get('rvol', 1.0):.1f}x)")
                            else:
                                log.info(f"🎯 Layer 4 TRIGGER: {trigger_result['pattern_type']} detected")
                                
                                # Sentiment Risk Adjustment (Specification: Score range -100 to +100)
                                # Normal zone: -60 to +60
                                # Extreme Greed: > +80 => TP减半 (防止随时崩盘)
                                # Extreme Fear: < -80 => 可适当放大仓位/TP
                                sentiment_score = sentiment.get('total_sentiment_score', 0)
                                
                                if sentiment_score > 80:  # Extreme Greed
                                    four_layer_result['tp_multiplier'] = 0.5  # 止盈减半
                                    four_layer_result['sl_multiplier'] = 1.0  # 止损不变
                                    log.warning(f"🔴 Extreme Greed ({sentiment_score:.0f}): TP target halved")
                                elif sentiment_score < -80:  # Extreme Fear
                                    four_layer_result['tp_multiplier'] = 1.5  # 可加大TP
                                    four_layer_result['sl_multiplier'] = 0.8  # 缩小SL
                                    log.info(f"🟢 Extreme Fear ({sentiment_score:.0f}): Be greedy when others are fearful")
                                else:
                                    four_layer_result['tp_multiplier'] = 1.0
                                    four_layer_result['sl_multiplier'] = 1.0
                                
                                # 🆕 Funding Rate Crowding Adjustment
                                if trend_1h == 'long' and funding_rate > 0.05:
                                    four_layer_result['tp_multiplier'] *= 0.7
                                    log.warning(f"💰 High Funding Rate ({funding_rate:.3f}%): Longs crowded, TP reduced")
                                elif trend_1h == 'short' and funding_rate < -0.05:
                                    four_layer_result['tp_multiplier'] *= 0.7
                                    log.warning(f"💰 Negative Funding Rate ({funding_rate:.3f}%): Shorts crowded, TP reduced")
                                
                                four_layer_result['layer4_pass'] = True
                                four_layer_result['final_action'] = trend_1h
                                four_layer_result['trigger_pattern'] = trigger_result['pattern_type']
                                log.info(f"✅ Layer 4 PASS: Sentiment {sentiment_score:.0f}, Trigger={trigger_result['pattern_type']}")
                                log.info(f"🎯 ALL LAYERS PASSED: {trend_1h.upper()} with {70 + four_layer_result['confidence_boost']}% confidence")
                        else:
                            four_layer_result['trigger_pattern'] = 'disabled'
                            four_layer_result['trigger_rvol'] = None
                            four_layer_result['layer4_pass'] = True
                            four_layer_result['final_action'] = trend_1h
                            log.info("⏭️ Layer 4 SKIP: TriggerDetectorAgent disabled")
            
            # Store for LLM context
            global_state.four_layer_result = four_layer_result
            
            # 🆕 MULTI-AGENT SEMANTIC ANALYSIS (LLM/Local)
            use_trend_llm = self.agent_config.trend_agent_llm
            use_trend_local = self.agent_config.trend_agent_local
            use_setup_llm = self.agent_config.setup_agent_llm
            use_setup_local = self.agent_config.setup_agent_local
            use_trigger_llm = self.agent_config.trigger_agent_llm
            use_trigger_local = self.agent_config.trigger_agent_local
            use_trend = use_trend_llm or use_trend_local
            use_setup = use_setup_llm or use_setup_local
            use_trigger = use_trigger_llm or use_trigger_local

            if use_trend and use_trend_llm and use_trend_local:
                log.info("⚠️ Both TrendAgentLLM and TrendAgent enabled; using LLM version only")
            if use_setup and use_setup_llm and use_setup_local:
                log.info("⚠️ Both SetupAgentLLM and SetupAgent enabled; using LLM version only")
            if use_trigger and use_trigger_llm and use_trigger_local:
                log.info("⚠️ Both TriggerAgentLLM and TriggerAgent enabled; using LLM version only")

            if use_trend or use_setup or use_trigger:
                if not (hasattr(self, '_headless_mode') and self._headless_mode):
                    print("[Step 2.5/5] 🤖 Multi-Agent Semantic Analysis...")
                try:
                    # Prepare data for each agent
                    trend_data = {
                        'symbol': self.current_symbol,
                        'close_1h': four_layer_result.get('close_1h', current_price),
                        'ema20_1h': four_layer_result.get('ema20_1h', current_price),
                        'ema60_1h': four_layer_result.get('ema60_1h', current_price),
                        'oi_change': four_layer_result.get('oi_change', 0),
                        'adx': four_layer_result.get('adx', 20),
                        'regime': four_layer_result.get('regime', 'unknown')
                    }
                    
                    setup_data = {
                        'symbol': self.current_symbol,
                        'close_15m': processed_dfs['15m']['close'].iloc[-1] if len(processed_dfs['15m']) > 0 else current_price,
                        'kdj_j': four_layer_result.get('kdj_j', 50),
                        'kdj_k': processed_dfs['15m']['kdj_k'].iloc[-1] if 'kdj_k' in processed_dfs['15m'].columns else 50,
                        'bb_upper': processed_dfs['15m']['bb_upper'].iloc[-1] if 'bb_upper' in processed_dfs['15m'].columns else current_price * 1.02,
                        'bb_middle': processed_dfs['15m']['bb_middle'].iloc[-1] if 'bb_middle' in processed_dfs['15m'].columns else current_price,
                        'bb_lower': processed_dfs['15m']['bb_lower'].iloc[-1] if 'bb_lower' in processed_dfs['15m'].columns else current_price * 0.98,
                        'trend_direction': trend_1h,  # Use actual 1h trend instead of 'final_action'
                        'macd_diff': processed_dfs['15m']['macd_diff'].iloc[-1] if 'macd_diff' in processed_dfs['15m'].columns else 0  # 🆕 MACD for 15m analysis
                    }
                    
                    trigger_data = {
                        'symbol': self.current_symbol,
                        'pattern': four_layer_result.get('trigger_pattern'),
                        'rvol': four_layer_result.get('trigger_rvol', 1.0),
                        'trend_direction': four_layer_result.get('final_action', 'neutral')
                    }
                    
                    # Initialize agents (cached after first use)
                    tasks = {}
                    loop = asyncio.get_event_loop()
                    if use_trend:
                        if use_trend_llm:
                            from src.agents.trend_agent import TrendAgentLLM
                            if not hasattr(self, '_trend_agent_llm'):
                                self._trend_agent_llm = TrendAgentLLM()
                            trend_agent = self._trend_agent_llm
                        else:
                            from src.agents.trend_agent import TrendAgent
                            if not hasattr(self, '_trend_agent_local'):
                                self._trend_agent_local = TrendAgent()
                            trend_agent = self._trend_agent_local
                        tasks['trend'] = loop.run_in_executor(None, trend_agent.analyze, trend_data)

                    if use_setup:
                        if use_setup_llm:
                            from src.agents.setup_agent import SetupAgentLLM
                            if not hasattr(self, '_setup_agent_llm'):
                                self._setup_agent_llm = SetupAgentLLM()
                            setup_agent = self._setup_agent_llm
                        else:
                            from src.agents.setup_agent import SetupAgent
                            if not hasattr(self, '_setup_agent_local'):
                                self._setup_agent_local = SetupAgent()
                            setup_agent = self._setup_agent_local
                        tasks['setup'] = loop.run_in_executor(None, setup_agent.analyze, setup_data)
                    
                    if use_trigger:
                        if use_trigger_llm:
                            from src.agents.trigger_agent import TriggerAgentLLM
                            if not hasattr(self, '_trigger_agent_llm'):
                                self._trigger_agent_llm = TriggerAgentLLM()
                            trigger_agent = self._trigger_agent_llm
                        else:
                            from src.agents.trigger_agent import TriggerAgent
                            if not hasattr(self, '_trigger_agent_local'):
                                self._trigger_agent_local = TriggerAgent()
                            trigger_agent = self._trigger_agent_local
                        tasks['trigger'] = loop.run_in_executor(None, trigger_agent.analyze, trigger_data)
                    
                    if tasks:
                        results = await asyncio.gather(*tasks.values())
                        global_state.semantic_analyses = dict(zip(tasks.keys(), results))
                    else:
                        global_state.semantic_analyses = {}
                    
                    if global_state.semantic_analyses:
                        # Log summary via global_state for dashboard
                        trend_mark = '✓' if global_state.semantic_analyses.get('trend') else '○'
                        setup_mark = '✓' if global_state.semantic_analyses.get('setup') else '○'
                        trigger_mark = '✓' if global_state.semantic_analyses.get('trigger') else '○'
                        global_state.add_log(f"[⚖️ CRITIC] 4-Layer Analysis: Trend={trend_mark} | Setup={setup_mark} | Trigger={trigger_mark}")

                        # Chatroom summaries for semantic agents
                        trend_result = global_state.semantic_analyses.get('trend')
                        if isinstance(trend_result, dict):
                            meta = trend_result.get('metadata', {}) or {}
                            summary = (
                                f"Stance: {trend_result.get('stance', 'UNKNOWN')} | "
                                f"Strength: {meta.get('strength', 'N/A')} | "
                                f"ADX: {meta.get('adx', 'N/A')} | "
                                f"OI Fuel: {meta.get('oi_fuel', 'N/A')}"
                            )
                            global_state.add_agent_message("trend_agent", summary, level="info")

                        setup_result = global_state.semantic_analyses.get('setup')
                        if isinstance(setup_result, dict):
                            meta = setup_result.get('metadata', {}) or {}
                            summary = (
                                f"Stance: {setup_result.get('stance', 'UNKNOWN')} | "
                                f"Zone: {meta.get('zone', 'N/A')} | "
                                f"KDJ: {meta.get('kdj_j', 'N/A')} | "
                                f"MACD: {meta.get('macd_signal', 'N/A')}"
                            )
                            global_state.add_agent_message("setup_agent", summary, level="info")

                        trigger_result = global_state.semantic_analyses.get('trigger')
                        if isinstance(trigger_result, dict):
                            meta = trigger_result.get('metadata', {}) or {}
                            summary = (
                                f"Stance: {trigger_result.get('stance', 'UNKNOWN')} | "
                                f"Pattern: {meta.get('pattern', 'NONE')} | "
                                f"RVOL: {meta.get('rvol', 'N/A')}x"
                            )
                            global_state.add_agent_message("trigger_agent", summary, level="info")
                
                except Exception as e:
                    log.error(f"❌ Multi-Agent analysis failed: {e}")
                    global_state.semantic_analyses = {
                        'trend': f"Trend analysis unavailable: {e}",
                        'setup': f"Setup analysis unavailable: {e}",
                        'trigger': f"Trigger analysis unavailable: {e}"
                    }
            else:
                global_state.semantic_analyses = {}

            # Step 2.6: Multi-Period Parser Agent (feeds Decision)
            try:
                multi_period_result = self.multi_period_agent.analyze(
                    quant_analysis=quant_analysis,
                    four_layer_result=four_layer_result,
                    semantic_analyses=getattr(global_state, 'semantic_analyses', {}) or {}
                )
                global_state.multi_period_result = multi_period_result
                summary = multi_period_result.get('summary')
                if summary:
                    global_state.add_agent_message("multi_period_agent", summary, level="info")
            except Exception as e:
                log.error(f"❌ Multi-Period Parser Agent failed: {e}")
                global_state.multi_period_result = {}

            # Step 3: Decision (Fast trend first, then LLM fallback)
            market_data = {
                'df_5m': processed_dfs['5m'],
                'df_15m': processed_dfs['15m'],
                'df_1h': processed_dfs['1h'],
                'current_price': current_price
            }
            regime_info = quant_analysis.get('regime', {})

            fast_signal = None
            decision_source = 'llm'
            forced_exit = self._check_forced_exit(current_position_info)
            llm_enabled = self._is_llm_enabled()
            if llm_enabled and getattr(self.strategy_engine, 'disable_llm', False):
                llm_enabled = bool(self.strategy_engine.reload_config())

            if forced_exit:
                decision_source = 'forced_exit'
                decision_payload = forced_exit
                global_state.add_log(f"[🧯 FORCED EXIT] {forced_exit.get('reasoning', 'Forced close')}")
                try:
                    conf_val = float(decision_payload.get('confidence', 0) or 0)
                except (TypeError, ValueError):
                    conf_val = 0.0
                global_state.add_agent_message(
                    "decision_core",
                    f"Action: {decision_payload.get('action', '').upper()} | Conf: {conf_val:.1f}% | Reason: {decision_payload.get('reasoning', '')[:100]}... | Source: FORCED",
                    level="warning"
                )
            else:
                fast_signal = self._detect_fast_trend_signal(processed_dfs.get('5m'))

            if fast_signal:
                decision_source = 'fast_trend'
                change_pct = fast_signal['change_pct']
                volume_ratio = fast_signal['volume_ratio']
                fast_action = fast_signal['action']
                fast_confidence = fast_signal['confidence']
                fast_reason = f"30m trend {change_pct:+.2f}% | RVOL {volume_ratio:.2f}x"

                if not (hasattr(self, '_headless_mode') and self._headless_mode):
                    print("[Step 3/5] ⚡ Fast Trend Trigger - Immediate entry signal")

                global_state.add_log(f"[⚡ FAST] {fast_action.upper()} | {fast_reason}")

                if fast_action == 'open_long':
                    bull_conf = fast_confidence
                    bear_conf = max(0.0, 100.0 - fast_confidence)
                    bull_stance = 'FAST_UP'
                    bear_stance = 'HEDGE'
                    bull_reason = fast_reason
                    bear_reason = 'Short bias weak vs momentum'
                else:
                    bull_conf = max(0.0, 100.0 - fast_confidence)
                    bear_conf = fast_confidence
                    bull_stance = 'HEDGE'
                    bear_stance = 'FAST_DN'
                    bull_reason = 'Long bias weak vs momentum'
                    bear_reason = fast_reason

                decision_payload = {
                    'action': fast_action,
                    'confidence': fast_confidence,
                    'position_size_pct': min(100.0, max(10.0, fast_confidence)),
                    'reasoning': fast_reason,
                    'bull_perspective': {
                        'bull_confidence': bull_conf,
                        'stance': bull_stance,
                        'bullish_reasons': bull_reason
                    },
                    'bear_perspective': {
                        'bear_confidence': bear_conf,
                        'stance': bear_stance,
                        'bearish_reasons': bear_reason
                    }
                }
                try:
                    conf_val = float(decision_payload.get('confidence', 0) or 0)
                except (TypeError, ValueError):
                    conf_val = 0.0
                global_state.add_agent_message(
                    "decision_core",
                    f"Action: {decision_payload.get('action').upper()} | Conf: {conf_val:.1f}% | Reason: {decision_payload.get('reasoning')[:100]}... | Source: FAST",
                    level="info"
                )
            elif not forced_exit:
                if llm_enabled:
                    if not (hasattr(self, '_headless_mode') and self._headless_mode):
                        print("[Step 3/5] 🧠 DeepSeek LLM - Making decision...")

                    global_state.add_agent_message("decision_core", "🧠 DeepSeek LLM is weighing options...", level="info")

                    # Build Context with POSITION INFO
                    market_context_text = self._build_market_context(
                        quant_analysis=quant_analysis,
                        predict_result=predict_result,
                        market_data=market_data,
                        regime_info=regime_info,
                        position_info=current_position_info  # ✅ Pass Position Info
                    )

                    market_context_data = {
                        'symbol': self.current_symbol,
                        'timestamp': datetime.now().isoformat(),
                        'current_price': current_price
                    }

                    # 🐂🐻 Parallel Perspectives (Chatroom Mode)
                    log.info("🐂🐻 Gathering Bull/Bear perspectives in PARALLEL...")
                    bull_task = loop.run_in_executor(None, self.strategy_engine.get_bull_perspective, market_context_text)
                    bear_task = loop.run_in_executor(None, self.strategy_engine.get_bear_perspective, market_context_text)

                    bull_p, bear_p = await asyncio.gather(bull_task, bear_task)

                    # Post to Chatroom
                    bull_summary = bull_p.get('bullish_reasons', 'No reasons provided')[:150] + "..."
                    bear_summary = bear_p.get('bearish_reasons', 'No reasons provided')[:150] + "..."
                    global_state.add_agent_message("bull_agent", f"Stance: {bull_p.get('stance')} | Reason: {bull_summary}", level="success")
                    global_state.add_agent_message("bear_agent", f"Stance: {bear_p.get('stance')} | Reason: {bear_summary}", level="warning")

                    # Call DeepSeek with pre-computed perspectives
                    decision_payload = self.strategy_engine.make_decision(
                        market_context_text=market_context_text,
                        market_context_data=market_context_data,
                        reflection=reflection_text,
                        bull_perspective=bull_p,
                        bear_perspective=bear_p
                    )

                    # Post Decision to Chatroom
                    try:
                        conf_val = float(decision_payload.get('confidence', 0) or 0)
                    except (TypeError, ValueError):
                        conf_val = 0.0
                    global_state.add_agent_message(
                        "decision_core",
                        f"Action: {decision_payload.get('action').upper()} | Conf: {conf_val:.1f}% | Reason: {decision_payload.get('reasoning')[:100]}...",
                        level="info"
                    )
                else:
                    if not (hasattr(self, '_headless_mode') and self._headless_mode):
                        print("[Step 3/5] ⚖️ DecisionCore - Rule-based decision...")
                    
                    global_state.add_agent_message("decision_core", "⚖️ Running rule-based decision logic...", level="info")
                    decision_source = 'decision_core'
                    vote_core = await self.decision_core.make_decision(
                        quant_analysis=quant_analysis,
                        predict_result=predict_result,
                        market_data=market_data
                    )
                    size_pct = 0.0
                    if vote_core.trade_params and self.max_position_size:
                        size_pct = min(
                            100.0,
                            max(5.0, (vote_core.trade_params.get('position_size', 0) / self.max_position_size) * 100)
                        )
                    decision_payload = {
                        'action': vote_core.action,
                        'confidence': vote_core.confidence,
                        'position_size_pct': size_pct,
                        'reasoning': vote_core.reason,
                        'bull_perspective': {
                            'bull_confidence': 50,
                            'stance': 'NEUTRAL',
                            'bullish_reasons': 'LLM disabled'
                        },
                        'bear_perspective': {
                            'bear_confidence': 50,
                            'stance': 'NEUTRAL',
                            'bearish_reasons': 'LLM disabled'
                        }
                    }
                    try:
                        conf_val = float(decision_payload.get('confidence', 0) or 0)
                    except (TypeError, ValueError):
                        conf_val = 0.0
                    global_state.add_agent_message(
                        "decision_core",
                        f"Action: {decision_payload.get('action').upper()} | Conf: {conf_val:.1f}% | Reason: {decision_payload.get('reasoning')[:100]}... | Source: RULE",
                        level="info"
                    )

            # ... Rest of logic stays similar ...
            if 'bull_perspective' not in decision_payload:
                decision_payload['bull_perspective'] = {
                    'bull_confidence': 50,
                    'stance': 'NEUTRAL',
                    'bullish_reasons': 'N/A'
                }
            if 'bear_perspective' not in decision_payload:
                decision_payload['bear_perspective'] = {
                    'bear_confidence': 50,
                    'stance': 'NEUTRAL',
                    'bearish_reasons': 'N/A'
                }
            
            # 转换为 VoteResult 兼容格式
            # (Need to check if i need to include rest of the function)

            
            # 转换为 VoteResult 兼容格式
            from src.agents.decision_core_agent import VoteResult
            
            # Extract scores for dashboard
            q_trend = quant_analysis.get('trend', {})
            q_osc = quant_analysis.get('oscillator', {})
            q_sent = quant_analysis.get('sentiment', {})
            q_comp = quant_analysis.get('comprehensive', {})
            
            # Construct vote_details similar to DecisionCore
            vote_details = {
                'deepseek': decision_payload.get('confidence', 0),
                'strategist_total': q_comp.get('score', 0),
                # Trend
                'trend_1h': q_trend.get('trend_1h_score', 0),
                'trend_15m': q_trend.get('trend_15m_score', 0),
                'trend_5m': q_trend.get('trend_5m_score', 0),
                # Oscillator
                'oscillator_1h': q_osc.get('osc_1h_score', 0),
                'oscillator_15m': q_osc.get('osc_15m_score', 0),
                'oscillator_5m': q_osc.get('osc_5m_score', 0),
                # Sentiment
                'sentiment': q_sent.get('total_sentiment_score', 0),
                # Prophet
                'prophet': predict_result.probability_up if predict_result else 0.5,
                # 🐂🐻 Bullish/Bearish Perspective Analysis
                'bull_confidence': decision_payload.get('bull_perspective', {}).get('bull_confidence', 50),
                'bear_confidence': decision_payload.get('bear_perspective', {}).get('bear_confidence', 50),
                'bull_stance': decision_payload.get('bull_perspective', {}).get('stance', 'UNKNOWN'),
                'bear_stance': decision_payload.get('bear_perspective', {}).get('stance', 'UNKNOWN'),
                'bull_reasons': decision_payload.get('bull_perspective', {}).get('bullish_reasons', ''),
                'bear_reasons': decision_payload.get('bear_perspective', {}).get('bearish_reasons', '')
            }

            if fast_signal:
                vote_details['fast_trend_change_pct'] = fast_signal.get('change_pct')
                vote_details['fast_trend_volume_ratio'] = fast_signal.get('volume_ratio')
                vote_details['fast_trend_window'] = fast_signal.get('window_minutes')
            
            # Determine Regime from Trend Score using Semantic Converter
            trend_score_total = quant_analysis.get('trend', {}).get('total_trend_score', 0)
            regime_desc = SemanticConverter.get_trend_semantic(trend_score_total)
            
            # Determine Position details from LLM Decision
            pos_pct = decision_payload.get('position_size_pct', 0)
            if not pos_pct and decision_payload.get('position_size_usd') and self.max_position_size:
                 # Fallback: estimate pct if usd is provided
                 pos_pct = (decision_payload.get('position_size_usd') / self.max_position_size) * 100
                 # Clamp to reasonable range (仓位大小不应超过100%)
                 pos_pct = min(pos_pct, 100)
            
            # 获取真正的价格位置信息（从 regime_result - Python calculated）
            # Note: regime_info (from quant_analysis) is empty because we separated logic.
            # Use regime_result calculated in Step 2.75 instead for accurate Position Data.
            price_position_info = regime_result.get('position', {}) if regime_result else {}
            
            vote_result = VoteResult(
                action=decision_payload.get('action', 'wait'),
                confidence=decision_payload.get('confidence', 0),
                weighted_score=decision_payload.get('confidence', 0) - 50,  # -50 to +50
                vote_details=vote_details,
                multi_period_aligned=True,
                reason=decision_payload.get('reasoning', 'DeepSeek LLM decision'),
                regime={
                    'regime': regime_desc,
                    'confidence': decision_payload.get('confidence', 0)
                },
                position=price_position_info  # 使用真正的价格位置信息
            )
            
            # 保存完整的 LLM 交互日志 (Input, Process, Output)
            # Only save detailed logs in local mode to conserve disk space on Railway
            if decision_source == 'llm' and os.environ.get('ENABLE_DETAILED_LLM_LOGS', 'false').lower() == 'true':
                full_log_content = f"""
================================================================================
🕐 Timestamp: {datetime.now().isoformat()}
💱 Symbol: {self.current_symbol}
🔄 Cycle: #{cycle_id}
================================================================================

--------------------------------------------------------------------------------
📤 INPUT (PROMPT)
--------------------------------------------------------------------------------
[SYSTEM PROMPT]
{decision_payload.get('system_prompt', '(Missing System Prompt)')}

[USER PROMPT]
{decision_payload.get('user_prompt', '(Missing User Prompt)')}

--------------------------------------------------------------------------------
🧠 PROCESSING (REASONING)
--------------------------------------------------------------------------------
{decision_payload.get('reasoning_detail', '(No reasoning detail)')}

--------------------------------------------------------------------------------
📥 OUTPUT (DECISION)
--------------------------------------------------------------------------------
{decision_payload.get('raw_response', '(No raw response)')}
"""
                self.saver.save_llm_log(
                    content=full_log_content,
                    symbol=self.current_symbol,
                    snapshot_id=snapshot_id,
                    cycle_id=cycle_id
                )
            
            # LOG: Bullish/Bearish Perspective (show first for adversarial context)
            bull_conf = decision_payload.get('bull_perspective', {}).get('bull_confidence', 50)
            bear_conf = decision_payload.get('bear_perspective', {}).get('bear_confidence', 50)
            bull_stance = decision_payload.get('bull_perspective', {}).get('stance', 'UNKNOWN')
            bear_stance = decision_payload.get('bear_perspective', {}).get('stance', 'UNKNOWN')
            bull_reasons = decision_payload.get('bull_perspective', {}).get('bullish_reasons', '')[:120]
            bear_reasons = decision_payload.get('bear_perspective', {}).get('bearish_reasons', '')[:120]
            global_state.add_log(f"[🐂 Long Case] [{bull_stance}] Conf={bull_conf}%")
            global_state.add_log(f"[🐻 Short Case] [{bear_stance}] Conf={bear_conf}%")
            
            # LOG: Decision Engine (LLM or Fast trend)
            decision_label = "FAST Decision" if decision_source == 'fast_trend' else ("RULE Decision" if decision_source == 'decision_core' else "Final Decision")
            global_state.add_log(f"[⚖️ {decision_label}] Action={vote_result.action.upper()} | Conf={decision_payload.get('confidence', 0)}%")
            
            # ✅ Decision Recording moved after Risk Audit for complete context
            # Saved to file still happens here for "raw" decision
            self.saver.save_decision(asdict(vote_result), self.current_symbol, snapshot_id, cycle_id=cycle_id)

            # 如果是观望，也需要更新状态
            if vote_result.action in ('hold', 'wait'):
                # Check if there's an active position to distinguish hold vs wait.
                # ✅ 先检查持仓，再显示正确的 action
                has_position = False
                if current_position_info:
                    try:
                        qty = float(current_position_info.get('quantity', 0) or 0)
                        has_position = abs(qty) > 0
                    except (TypeError, ValueError):
                        has_position = True
                if not has_position and self.test_mode:
                    has_position = self.current_symbol in global_state.virtual_positions
                actual_action = 'hold' if has_position else 'wait'  # Position → hold, no position → wait
                
                # ✅ 使用修正后的 action 显示
                action_display = '持仓观望' if actual_action == 'hold' else '观望'
                print(f"\n✅ 决策: {action_display} ({actual_action})")
                
                # GlobalState Logging of Logic
                regime_txt = vote_result.regime.get('regime', 'Unknown') if vote_result.regime else 'Unknown'
                pos_txt = f"{min(max(vote_result.position.get('position_pct', 0), 0), 100):.0f}%" if vote_result.position else 'N/A'
                
                # LOG 3: Critic (Wait/Hold Case) - 使用修正后的 action
                global_state.add_log(f"⚖️ DecisionCoreAgent (The Critic): Context(Regime={regime_txt}, Pos={pos_txt}) => Vote: {actual_action.upper()} ({vote_result.reason})")
                
                # Update State with WAIT/HOLD decision
                decision_dict = asdict(vote_result)
                decision_dict['action'] = actual_action  # ✅ Use 'wait' instead of 'hold'
                decision_dict['symbol'] = self.current_symbol
                decision_dict['timestamp'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                decision_dict['cycle_number'] = global_state.cycle_counter
                decision_dict['cycle_id'] = global_state.current_cycle_id
                # Add implicit safe risk for Wait/Hold
                decision_dict['risk_level'] = 'safe'
                decision_dict['guardian_passed'] = True
                decision_dict['prophet_probability'] = predict_result.probability_up if predict_result else 0.5  # 🔮 Prophet
                
                # ✅ Add Semantic Analysis for Dashboard
                decision_dict['vote_analysis'] = SemanticConverter.convert_analysis_map(decision_dict.get('vote_details', {}))
                
                # 🆕 Add Four-Layer Status for Dashboard
                decision_dict['four_layer_status'] = global_state.four_layer_result
                self._attach_agent_ui_fields(decision_dict)
                
                # 🆕 Add OI Fuel and KDJ Zone to vote_details for Dashboard
                if 'vote_details' not in decision_dict:
                    decision_dict['vote_details'] = {}
                decision_dict['vote_details']['oi_fuel'] = quant_analysis.get('sentiment', {}).get('oi_fuel', {})
                
                # 🔴 Bug #6 Fix: Use explicit kdj_zone if available, else map bb_position
                kdj_zone = global_state.four_layer_result.get('kdj_zone')
                if not kdj_zone:
                    bb_position = global_state.four_layer_result.get('bb_position', 'unknown')
                    bb_to_zone_map = {
                        'upper': 'overbought',
                        'lower': 'oversold',
                        'middle': 'neutral',
                        'unknown': 'unknown'
                    }
                    kdj_zone = bb_to_zone_map.get(bb_position, 'unknown')
                decision_dict['vote_details']['kdj_zone'] = kdj_zone
                
                # 🔧 Fix: Inject ADX into regime object for Dashboard display
                if 'regime' in decision_dict and decision_dict['regime']:
                    decision_dict['regime']['adx'] = global_state.four_layer_result.get('adx', 20)
                
                # Update Market Context
                if vote_result.regime:
                    global_state.market_regime = vote_result.regime.get('regime', 'Unknown')
                if vote_result.position:
                    # Safety clamp: ensure position_pct is 0-100
                    pos_pct = min(max(vote_result.position.get('position_pct', 0), 0), 100)
                    global_state.price_position = f"{pos_pct:.1f}% ({vote_result.position.get('location', 'Unknown')})"
                    
                global_state.update_decision(decision_dict)

                return {
                    'status': actual_action,
                    'action': actual_action,
                    'details': {
                        'reason': vote_result.reason,
                        'confidence': vote_result.confidence
                    }
                }
            
            # Step 4: 审计 - 风控守护者 (The Guardian)
            if not (hasattr(self, '_headless_mode') and self._headless_mode):
                print(f"[Step 4/5] 👮 The Guardian (Risk Audit) - Final review...")
            
            # LOG 3: Critic (Action Case) - if not already logged (Wait case returns early)
            regime_txt = vote_result.regime.get('regime', 'Unknown') if vote_result.regime else 'Unknown'
            # Note: Wait case returns, so if we are here, it's an action.
            global_state.add_log(f"⚖️ DecisionCoreAgent (The Critic): Context(Regime={regime_txt}) => Vote: {vote_result.action.upper()} (Conf: {vote_result.confidence:.0f}%)")
            
            global_state.guardian_status = "Auditing..."
            global_state.guardian_status = "Auditing..."
            
            order_params = self._build_order_params(
                action=vote_result.action,
                current_price=current_price,
                confidence=vote_result.confidence
            )
            order_params['symbol'] = self.current_symbol
            
            print(f"  ✅ 信号方向: {vote_result.action}")
            print(f"  ✅ 综合信心: {vote_result.confidence:.1f}%")
            if vote_result.regime:
                print(f"  📊 市场状态: {vote_result.regime['regime']}")
            if vote_result.position:
                print(f"  📍 价格位置: {min(max(vote_result.position['position_pct'], 0), 100):.1f}% ({vote_result.position['location']})")
            
            # 将对抗式上下文注入订单参数，以便风控审计使用
            order_params['regime'] = vote_result.regime
            order_params['position'] = vote_result.position
            order_params['confidence'] = vote_result.confidence
            osc_data = quant_analysis.get('oscillator', {}) if isinstance(quant_analysis, dict) else {}
            order_params['oscillator_scores'] = {
                'osc_1h_score': osc_data.get('osc_1h_score', 0),
                'osc_15m_score': osc_data.get('osc_15m_score', 0),
                'osc_5m_score': osc_data.get('osc_5m_score', 0)
            }
            sentiment_data = quant_analysis.get('sentiment', {}) if isinstance(quant_analysis, dict) else {}
            order_params['sentiment_score'] = sentiment_data.get('total_sentiment_score', 0)
            order_params.update(self._get_symbol_trade_stats(self.current_symbol))
            trend_data = quant_analysis.get('trend', {}) if isinstance(quant_analysis, dict) else {}
            order_params['trend_scores'] = {
                'trend_1h_score': trend_data.get('trend_1h_score', 0),
                'trend_15m_score': trend_data.get('trend_15m_score', 0),
                'trend_5m_score': trend_data.get('trend_5m_score', 0)
            }
            try:
                if self.agent_config.position_analyzer_agent:
                    from src.agents.position_analyzer_agent import PositionAnalyzer
                    df_1h = processed_dfs.get('1h')
                    if df_1h is not None and len(df_1h) > 5:
                        analyzer = PositionAnalyzer()
                        order_params['position_1h'] = analyzer.analyze_position(
                            df_1h,
                            current_price,
                            timeframe='1h'
                        )
            except Exception:
                pass
            
            # Step 5 (Embedded in Step 4 for clean output)
            
            # 获取账户信息
            # Using _get_full_account_info helper (we will create it or inline logic)
            # Fetch directly from client to get full details
            try:
                if self.test_mode:
                    # Test Mode: Use virtual balance
                    wallet_bal = global_state.virtual_balance
                    avail_bal = global_state.virtual_balance
                    
                    # Calculate unrealized PnL from open positions
                    unrealized_pnl = sum(
                        pos.get('unrealized_pnl', 0) 
                        for pos in global_state.virtual_positions.values()
                    )
                    
                    # Total Equity = Balance + Unrealized PnL
                    total_equity = wallet_bal + unrealized_pnl
                    
                    # Total PnL = Current Equity - Initial Balance
                    initial_balance = global_state.virtual_initial_balance
                    total_pnl = total_equity - initial_balance
                    
                    # Update State (must call to sync with frontend)
                    global_state.update_account(
                        equity=total_equity,
                        available=avail_bal,
                        wallet=wallet_bal,
                        pnl=total_pnl  # ✅ Fix: Pass total PnL, not unrealized only
                    )
                    
                    account_balance = avail_bal
                else:
                    acc_info = self.client.get_futures_account()
                    # acc_info keys: 'total_wallet_balance', 'total_unrealized_profit', 'available_balance', etc. (snake_case)
                    wallet_bal = float(acc_info.get('total_wallet_balance', 0))
                    unrealized_pnl = float(acc_info.get('total_unrealized_profit', 0))
                    avail_bal = float(acc_info.get('available_balance', 0))
                    total_equity = wallet_bal + unrealized_pnl
                    
                    # Update State
                    global_state.update_account(
                        equity=total_equity,
                        available=avail_bal,
                        wallet=wallet_bal,
                        pnl=unrealized_pnl
                    )
                    global_state.record_account_success()  # Track success
                    
                    account_balance = avail_bal # For backward compatibility with audit
            except Exception as e:
                log.error(f"Failed to fetch account info: {e}")
                global_state.record_account_failure()  # Track failure
                global_state.add_log(f"❌ Account info fetch failed: {str(e)}")  # Dashboard log
                account_balance = 0.0

            current_position = self._get_current_position()
            
            # 提取 ATR 百分比用于动态止损计算
            atr_pct = regime_result.get('atr_pct', None) if regime_result else None
            
            global_state.add_agent_message("risk_audit", "🛡️ Guardian is auditing risk and positions...", level="info")
            # 执行审计
            audit_result = await self.risk_audit.audit_decision(
                decision=order_params,
                current_position=current_position,
                account_balance=account_balance,
                current_price=current_price,
                atr_pct=atr_pct  # 传递 ATR 用于动态止损计算
            )
            
            # Update Dashboard Guardian Status
            global_state.guardian_status = "PASSED" if audit_result.passed else "BLOCKED"
            
            # LOG 4: Guardian (Single Line)
            if not audit_result.passed:
                 global_state.add_log(f"[🛡️ GUARDIAN] ❌ BLOCKED ({audit_result.blocked_reason})")
            else:
                 global_state.add_log(f"[🛡️ GUARDIAN] ✅ PASSED (Risk: {audit_result.risk_level.value})")
            
            # Chatroom: Risk Audit summary
            if audit_result.passed:
                global_state.add_agent_message(
                    "risk_audit",
                    f"PASSED | Risk: {audit_result.risk_level.value}",
                    level="success"
                )
            else:
                global_state.add_agent_message(
                    "risk_audit",
                    f"BLOCKED | {audit_result.blocked_reason}",
                    level="warning"
                )
            
            # ✅ Update Global State with FULL Decision info (Vote + Audit)
            decision_dict = asdict(vote_result)
            decision_dict['symbol'] = self.current_symbol
            decision_dict['timestamp'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            decision_dict['cycle_number'] = global_state.cycle_counter
            decision_dict['cycle_id'] = global_state.current_cycle_id
            
            # Inject Risk Data
            decision_dict['risk_level'] = audit_result.risk_level.value
            decision_dict['guardian_passed'] = audit_result.passed
            decision_dict['guardian_reason'] = audit_result.blocked_reason
            decision_dict['prophet_probability'] = predict_result.probability_up if predict_result else 0.5  # 🔮 Prophet
            
            # ✅ Add Semantic Analysis for Dashboard
            decision_dict['vote_analysis'] = SemanticConverter.convert_analysis_map(decision_dict.get('vote_details', {}))
            
            # 🆕 Add Four-Layer Status for Dashboard
            decision_dict['four_layer_status'] = global_state.four_layer_result
            self._attach_agent_ui_fields(decision_dict)
            
            # 🆕 Add OI Fuel and KDJ Zone to vote_details for Dashboard
            if 'vote_details' not in decision_dict:
                decision_dict['vote_details'] = {}
            decision_dict['vote_details']['oi_fuel'] = quant_analysis.get('sentiment', {}).get('oi_fuel', {})
            
            # 🔴 Bug #6 Fix: Use explicit kdj_zone if available, else map bb_position
            kdj_zone = global_state.four_layer_result.get('kdj_zone')
            if not kdj_zone:
                bb_position = global_state.four_layer_result.get('bb_position', 'unknown')
                bb_to_zone_map = {
                    'upper': 'overbought',
                    'lower': 'oversold',
                    'middle': 'neutral',
                    'unknown': 'unknown'
                }
                kdj_zone = bb_to_zone_map.get(bb_position, 'unknown')
            decision_dict['vote_details']['kdj_zone'] = kdj_zone
            
            # 🔧 Fix: Inject ADX into regime object for Dashboard display
            if 'regime' in decision_dict and decision_dict['regime']:
                decision_dict['regime']['adx'] = global_state.four_layer_result.get('adx', 20)
            
            # Update Market Context
            if vote_result.regime:
                global_state.market_regime = vote_result.regime.get('regime', 'Unknown')
            if vote_result.position:
                # Safety clamp: ensure position_pct is 0-100
                pos_pct = min(max(vote_result.position.get('position_pct', 0), 0), 100)
                global_state.price_position = f"{pos_pct:.1f}% ({vote_result.position.get('location', 'Unknown')})"
            
            # ✅ Save Risk Audit Report
            from dataclasses import asdict as dc_asdict
            self.saver.save_risk_audit(
                audit_result={
                    'passed': audit_result.passed,
                    'risk_level': audit_result.risk_level.value,
                    'blocked_reason': audit_result.blocked_reason,
                    'corrections': audit_result.corrections,
                    'warnings': audit_result.warnings,
                    'order_params': order_params,
                    'cycle_id': cycle_id
                },
                symbol=self.current_symbol,
                snapshot_id=snapshot_id,
                cycle_id=cycle_id
            )
            
            print(f"  ✅ 审计结果: {'✅ 通过' if audit_result.passed else '❌ 拦截'}")
            print(f"  ✅ 风险等级: {audit_result.risk_level.value}")
            
            # 如果有修正
            if audit_result.corrections:
                print(f"  ⚠️  自动修正:")
                for key, value in audit_result.corrections.items():
                    print(f"     {key}: {order_params[key]} -> {value}")
                    order_params[key] = value  # 应用修正
            
            # 如果有警告
            if audit_result.warnings:
                print(f"  ⚠️  警告信息:")
                for warning in audit_result.warnings:
                    print(f"     {warning}")

            decision_dict['order_params'] = order_params
            global_state.update_decision(decision_dict)
            
            # 如果被拦截
            if not audit_result.passed:
                print(f"\n❌ 决策被风控拦截: {audit_result.blocked_reason}")
                return {
                    'status': 'blocked',
                    'action': vote_result.action,
                    'details': {
                        'reason': audit_result.blocked_reason,
                        'risk_level': audit_result.risk_level.value
                    },
                    'current_price': current_price
                }

            # Decoupling: If analyze_only is True, skip execution for OPEN actions
            if analyze_only and vote_result.action in ('open_long', 'open_short'):
                log.info(f"🔍 [Analyze Only] Strategy suggests {vote_result.action.upper()} for {self.current_symbol}, skipping execution for selector")
                return {
                    'status': 'suggested',
                    'action': vote_result.action,
                    'confidence': vote_result.confidence,
                    'order_params': order_params,
                    'vote_result': vote_result,
                    'current_price': current_price
                }
            # Step 5: 执行引擎
            if self.test_mode:
                if not (hasattr(self, '_headless_mode') and self._headless_mode):
                    print("\n[Step 5/5] 🧪 TestMode - 模拟执行...")
                print(f"  模拟订单: {order_params['action']} {order_params['quantity']} @ {current_price}")
                
                # LOG 5: Executor (Test)
                global_state.add_log(f"[🚀 EXECUTOR] Test: {order_params['action'].upper()} {order_params['quantity']} @ {current_price:.2f}")

                 # ✅ Save Execution (Simulated)
                self.saver.save_execution({
                    'symbol': self.current_symbol,
                    'action': 'SIMULATED_EXECUTION',
                    'params': order_params,
                    'status': 'success',
                    'timestamp': datetime.now().isoformat(),
                    'cycle_id': cycle_id
                }, self.current_symbol, cycle_id=cycle_id)
                
                # 💰 测试模式逻辑: 计算 PnL 和更新状态 (Virtual Account)
                realized_pnl = 0.0
                exit_test_price = 0.0
                
                if self.test_mode:
                    action_lower = vote_result.action.lower()
                    
                    # Close Logic
                    if 'close' in action_lower:
                        if self.current_symbol in global_state.virtual_positions:
                            pos = global_state.virtual_positions[self.current_symbol]
                            entry_price = pos['entry_price']
                            qty = pos['quantity']
                            side = pos['side']
                            
                            # Calc Realized PnL
                            if side.upper() == 'LONG':
                                realized_pnl = (current_price - entry_price) * qty
                            else:
                                realized_pnl = (entry_price - current_price) * qty
                            
                            exit_test_price = current_price
                            # Update Virtual Balance
                            global_state.virtual_balance += realized_pnl
                            
                            # Remove position
                            del global_state.virtual_positions[self.current_symbol]
                            self._save_virtual_state()
                            
                            log.info(f"💰 [TEST] Closed {side} {self.current_symbol}: PnL=${realized_pnl:.2f}, Bal=${global_state.virtual_balance:.2f}")
                            
                            # Record trade to history -> MOVED TO UNIFIED BLOCK BELOW
                            # global_state.record_trade({ ... })
                        else:
                            log.warning(f"⚠️ [TEST] Close ignored - No position for {self.current_symbol}")
                    
                    # Open Logic
                    elif 'long' in action_lower or 'short' in action_lower:
                        side = 'LONG' if 'long' in action_lower else 'SHORT'
                        # 计算持仓价值
                        position_value = order_params['quantity'] * current_price
                        global_state.virtual_positions[self.current_symbol] = {
                            'entry_price': current_price,
                            'quantity': order_params['quantity'],
                            'side': side,
                            'entry_time': datetime.now().isoformat(),
                            'stop_loss': order_params.get('stop_loss_price', 0),
                            'take_profit': order_params.get('take_profit_price', 0),
                            'leverage': order_params.get('leverage', 1),
                            'position_value': position_value  # 用于计算可用余额
                        }
                        self._save_virtual_state()
                        log.info(f"💰 [TEST] Opened {side} {self.current_symbol} @ ${current_price:,.2f}")
                        
                        # Record trade to history -> MOVED TO UNIFIED BLOCK BELOW
                        # global_state.record_trade({ ... })

                # ✅ Save Trade in persistent history
                # Logic Update: If CLOSING, try to update previous OPEN record. If failing, save new.
                
                is_close_action = 'close' in vote_result.action.lower()
                update_success = False
                
                if is_close_action:
                    update_success = self.saver.update_trade_exit(
                        symbol=self.current_symbol,
                        exit_price=exit_test_price,
                        pnl=realized_pnl,
                        exit_time=datetime.now().strftime("%H:%M:%S"),
                        close_cycle=global_state.cycle_counter
                    )
                    
                    # ✅ Sync global_state.trade_history if CSV update succeeded
                    if update_success:
                        for trade in global_state.trade_history:
                            if trade.get('symbol') == self.current_symbol and trade.get('exit_price', 0) == 0:
                                trade['exit_price'] = exit_test_price
                                trade['pnl'] = realized_pnl
                                trade['close_cycle'] = global_state.cycle_counter
                                trade['status'] = 'CLOSED'
                                log.info(f"✅ Synced global_state.trade_history: {self.current_symbol} PnL ${realized_pnl:.2f}")
                                break
                        
                        # 🆕 Accumulate realized PnL for dashboard Total PnL calculation
                        global_state.cumulative_realized_pnl += realized_pnl
                        log.info(f"📊 Cumulative Realized PnL: ${global_state.cumulative_realized_pnl:.2f}")
                
                # Only save NEW record if it's OPEN action OR if Update Failed (Fallback)
                if not update_success:
                    is_open_action = 'open' in order_params['action'].lower()
                    
                    # For CLOSE actions, find the original open_cycle from trade_history
                    original_open_cycle = 0
                    if not is_open_action:
                        for trade in global_state.trade_history:
                            if trade.get('symbol') == self.current_symbol and trade.get('exit_price', 0) == 0:
                                original_open_cycle = trade.get('open_cycle', 0)
                                break
                    
                    trade_record = {
                        'open_cycle': global_state.cycle_counter if is_open_action else original_open_cycle,
                        'close_cycle': 0 if is_open_action else global_state.cycle_counter,
                        'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        'action': order_params['action'].upper(),
                        'symbol': self.current_symbol,
                        'entry_price': current_price, # ✅ Fixed field name (was price)
                        'quantity': order_params['quantity'],
                        'cost': current_price * order_params['quantity'],
                        'exit_price': exit_test_price,
                        'pnl': realized_pnl,
                        'confidence': order_params['confidence'],
                        'status': 'SIMULATED',
                        'cycle': cycle_id
                    }
                    if is_close_action:
                         trade_record['status'] = 'CLOSED (Fallback)'
                         
                    self.saver.save_trade(trade_record)
                    # Update Global State History
                    global_state.trade_history.insert(0, trade_record)
                    if len(global_state.trade_history) > 50:
                        global_state.trade_history.pop()

                # 🎯 递增周期开仓计数器
                if 'open' in vote_result.action.lower():
                     global_state.cycle_positions_opened += 1
                     log.info(f"Positions opened this cycle: {global_state.cycle_positions_opened}/1")
                
                return {
                    'status': 'success',
                    'action': vote_result.action,
                    'details': order_params,
                    'current_price': current_price
                }
            else:
                # Live Execution
                if not (hasattr(self, '_headless_mode') and self._headless_mode):
                    print("\n[Step 5/5] 🚀 LiveTrade - 实盘执行...")
                
                try:
                    # _execute_order returns bool
                    is_success = self._execute_order(order_params)
                    
                    status_icon = "✅" if is_success else "❌"
                    status_txt = "SENT" if is_success else "FAILED"
                    
                    # LOG 5: Executor (Live)
                    global_state.add_log(f"[🚀 EXECUTOR] Live: {order_params['action'].upper()} {order_params['quantity']} => {status_icon} {status_txt}")
                        
                    executed = {'status': 'filled' if is_success else 'failed', 'avgPrice': current_price, 'executedQty': order_params['quantity']}
                        
                except Exception as e:
                    log.error(f"Live order execution failed: {e}", exc_info=True)
                    global_state.add_log(f"[Execution] ❌ Live Order Failed: {e}")
                    return {
                        'status': 'failed',
                        'action': vote_result.action,
                        'details': {'error': str(e)}
                    }
            
            # ✅ Save Execution
            self.saver.save_execution({
                'symbol': self.current_symbol,
                'action': 'REAL_EXECUTION',
                'params': order_params,
                'status': 'success' if executed else 'failed',
                'timestamp': datetime.now().isoformat(),
                'cycle_id': cycle_id
            }, self.current_symbol, cycle_id=cycle_id)
            
            if executed:
                print("  ✅ 订单执行成功!")
                global_state.add_log(f"✅ Order: {order_params['action'].upper()} {order_params['quantity']} @ ${order_params['price']}")
                
                # 记录交易日志
                trade_logger.log_open_position(
                    symbol=self.current_symbol,
                    side=order_params['action'].upper(),
                    decision=order_params,
                    execution_result={
                        'success': True,
                        'entry_price': order_params['entry_price'],
                        'quantity': order_params['quantity'],
                        'stop_loss': order_params['stop_loss'],
                        'take_profit': order_params['take_profit'],
                        'order_id': 'real_order' # Placeholder if actual ID not captured
                    },
                    market_state=market_snapshot.live_5m,
                    account_info={'available_balance': account_balance}
                )
                
                # 计算盈亏 (如果是平仓)
                pnl = 0.0
                exit_price = 0.0
                entry_price = order_params['entry_price']
                if order_params['action'] == 'close_position' and current_position:
                    exit_price = current_price
                    entry_price = current_position.entry_price
                    # PnL = (Exit - Entry) * Qty (Multiplied by 1 if long, -1 if short)
                    direction = 1 if current_position.side == 'long' else -1
                    pnl = (exit_price - entry_price) * current_position.quantity * direction
                
                # ✅ Save Trade in persistent history
                # Logic Update: If CLOSING, try to update previous OPEN record. If failing, save new.
                
                is_close_action = 'close' in order_params['action'].lower()
                update_success = False
                
                if is_close_action:
                    update_success = self.saver.update_trade_exit(
                        symbol=self.current_symbol,
                        exit_price=exit_price,
                        pnl=pnl,
                        exit_time=datetime.now().strftime("%H:%M:%S"),
                        close_cycle=global_state.cycle_counter
                    )
                    
                    # ✅ Sync global_state.trade_history if CSV update succeeded
                    if update_success:
                        for trade in global_state.trade_history:
                            if trade.get('symbol') == self.current_symbol and trade.get('exit_price', 0) == 0:
                                trade['exit_price'] = exit_price
                                trade['pnl'] = pnl
                                trade['close_cycle'] = global_state.cycle_counter
                                trade['status'] = 'CLOSED'
                                log.info(f"✅ Synced global_state.trade_history: {self.current_symbol} PnL ${pnl:.2f}")
                                break
                        
                        # 🆕 Accumulate realized PnL for dashboard Total PnL calculation
                        global_state.cumulative_realized_pnl += pnl
                        log.info(f"📊 Cumulative Realized PnL: ${global_state.cumulative_realized_pnl:.2f}")
                
                if not update_success:
                    is_open_action = 'open' in order_params['action'].lower()
                    
                    # For CLOSE actions, find the original open_cycle from trade_history
                    original_open_cycle = 0
                    if not is_open_action:
                        for trade in global_state.trade_history:
                            if trade.get('symbol') == self.current_symbol and trade.get('exit_price', 0) == 0:
                                original_open_cycle = trade.get('open_cycle', 0)
                                break
                    
                    trade_record = {
                        'open_cycle': global_state.cycle_counter if is_open_action else original_open_cycle,
                        'close_cycle': 0 if is_open_action else global_state.cycle_counter,
                        'action': order_params['action'].upper(),
                        'symbol': self.current_symbol,
                        'price': entry_price,
                        'quantity': order_params['quantity'],
                        'cost': entry_price * order_params['quantity'],
                        'exit_price': exit_price,
                        'pnl': pnl,
                        'confidence': order_params['confidence'],
                        'status': 'EXECUTED',
                        'cycle': cycle_id
                    }
                    if is_close_action:
                         trade_record['status'] = 'CLOSED (Fallback)'
                         
                    self.saver.save_trade(trade_record)
                    
                    # Update Global State History
                    global_state.trade_history.insert(0, trade_record)
                    if len(global_state.trade_history) > 50:
                        global_state.trade_history.pop()
                
                return {
                    'status': 'success',
                    'action': vote_result.action,
                    'details': order_params,
                    'current_price': current_price
                }
            else:
                print("  ❌ 订单执行失败")
                global_state.add_log(f"❌ Order Failed: {order_params['action'].upper()}")
                return {
                    'status': 'failed',
                    'action': vote_result.action,
                    'details': {'error': 'execution_failed'},
                    'current_price': current_price
                }
        
        except Exception as e:
            log.error(f"Trading cycle exception: {e}", exc_info=True)
            global_state.add_log(f"Error: {e}")
            return {
                'status': 'error',
                'details': {'error': str(e)}
            }
    
    def _build_order_params(
        self, 
        action: str, 
        current_price: float,
        confidence: float
    ) -> Dict:
        """
        构建订单参数
        
        Args:
            action: 'long' or 'short'
            current_price: 当前价格
            confidence: 决策置信度 (0-100)
        
        Returns:
            订单参数字典
        """
        # 获取可用余额
        if self.test_mode:
            available_balance = global_state.virtual_balance
        else:
            available_balance = self._get_account_balance()
        
        # 动态仓位计算：置信度 100% 时使用可用余额的 33%
        # 公式: 仓位比例 = 基础比例(33%) × 置信度
        base_position_pct = 1 / 3  # 最大仓位比例 33%
        conf_pct = confidence
        if isinstance(conf_pct, (int, float)) and 0 < conf_pct <= 1:
            conf_pct *= 100
        conf_pct = max(0.0, min(float(conf_pct or 0.0), 100.0))
        position_pct = base_position_pct * (conf_pct / 100)  # 根据置信度调整
        
        # 计算仓位金额（完全基于可用余额百分比）
        adjusted_position = available_balance * position_pct
        
        # 计算数量
        quantity = adjusted_position / current_price
        
        # 计算止损止盈
        if action in ('long', 'open_long'):
            stop_loss = current_price * (1 - self.stop_loss_pct / 100)
            take_profit = current_price * (1 + self.take_profit_pct / 100)
        else:  # short
            stop_loss = current_price * (1 + self.stop_loss_pct / 100)
            take_profit = current_price * (1 - self.take_profit_pct / 100)
        
        return {
            'action': action,
            'entry_price': current_price,
            'stop_loss': stop_loss,
            'take_profit': take_profit,
            'quantity': quantity,
            'position_value': adjusted_position,  # 新增：实际仓位金额
            'position_pct': position_pct * 100,   # 新增：仓位百分比
            'leverage': self.leverage,
            'confidence': confidence
        }

    def _get_symbol_trade_stats(self, symbol: str, max_trades: int = 5) -> Dict:
        """Summarize recent closed trades for symbol to support risk filters."""
        history = global_state.trade_history or []
        loss_streak = 0
        loss_streak_active = True
        recent_pnl = 0.0
        recent_count = 0
        recent_wins = 0

        for trade in history:
            if trade.get('symbol') != symbol:
                continue

            pnl = trade.get('pnl')
            if pnl is None:
                continue

            status = str(trade.get('status', '')).upper()
            close_cycle = trade.get('close_cycle', 0)
            exit_price = trade.get('exit_price', 0)
            is_closed = (
                'CLOSED' in status or
                (isinstance(close_cycle, (int, float)) and close_cycle > 0) or
                (isinstance(exit_price, (int, float)) and exit_price > 0)
            )
            if not is_closed:
                continue

            try:
                pnl_value = float(pnl)
            except Exception:
                continue

            if loss_streak_active:
                if pnl_value < 0:
                    loss_streak += 1
                else:
                    loss_streak_active = False

            if recent_count < max_trades:
                recent_pnl += pnl_value
                recent_count += 1
                if pnl_value > 0:
                    recent_wins += 1

            if not loss_streak_active and recent_count >= max_trades:
                break

        win_rate = (recent_wins / recent_count) if recent_count > 0 else None
        return {
            'symbol_loss_streak': loss_streak,
            'symbol_recent_pnl': recent_pnl,
            'symbol_recent_trades': recent_count,
            'symbol_win_rate': win_rate
        }

    def _get_open_trade_meta(self, symbol: str) -> Optional[Dict]:
        """Return latest open trade record for symbol, if any."""
        history = global_state.trade_history or []
        for trade in history:
            if trade.get('symbol') != symbol:
                continue
            status = str(trade.get('status', '')).upper()
            close_cycle = trade.get('close_cycle', 0)
            exit_price = trade.get('exit_price', 0)
            is_closed = (
                'CLOSED' in status or
                (isinstance(close_cycle, (int, float)) and close_cycle > 0) or
                (isinstance(exit_price, (int, float)) and exit_price > 0)
            )
            if not is_closed:
                return trade
        return None

    def _get_holding_cycles(self, open_trade: Optional[Dict]) -> Optional[int]:
        """Estimate holding cycles from open trade metadata."""
        if not open_trade:
            return None
        open_cycle = open_trade.get('open_cycle')
        if isinstance(open_cycle, (int, float)):
            return max(0, int(global_state.cycle_counter) - int(open_cycle))
        return None

    def _get_holding_hours(self, symbol: str, open_trade: Optional[Dict]) -> Optional[float]:
        """Estimate holding duration in hours using cycle counter or entry_time."""
        if open_trade:
            hold_cycles = self._get_holding_cycles(open_trade)
            if hold_cycles is not None:
                cycle_interval = max(1, int(getattr(global_state, 'cycle_interval', 3) or 3))
                hold_minutes = hold_cycles * cycle_interval
                return hold_minutes / 60.0
        if self.test_mode:
            v_pos = global_state.virtual_positions.get(symbol)
            entry_time = v_pos.get('entry_time') if isinstance(v_pos, dict) else None
            if entry_time:
                try:
                    started = datetime.fromisoformat(entry_time)
                    return max(0.0, (datetime.now() - started).total_seconds() / 3600.0)
                except Exception:
                    pass
        return None

    def _check_forced_exit(self, position_info: Optional[Dict]) -> Optional[Dict]:
        """Force exit for stale or losing positions to cap drawdowns."""
        if not position_info:
            return None
        symbol = position_info.get('symbol') or self.current_symbol
        pnl_pct = position_info.get('pnl_pct')
        if pnl_pct is None:
            return None

        open_trade = self._get_open_trade_meta(symbol)
        hold_cycles = self._get_holding_cycles(open_trade)
        hold_hours = self._get_holding_hours(symbol, open_trade)
        max_hold_cycles = self.config.get('risk.max_holding_cycles')
        max_hold_hours = self.config.get('risk.max_holding_hours')
        if max_hold_cycles is None:
            max_hold_cycles = 180
        if max_hold_hours is None and hold_cycles is not None:
            cycle_interval = max(1, int(getattr(global_state, 'cycle_interval', 3) or 3))
            max_hold_hours = (max_hold_cycles * cycle_interval) / 60.0
        hold_tag = f"{hold_hours:.1f}h" if hold_hours is not None else "n/a"

        if hold_cycles is not None and isinstance(max_hold_cycles, (int, float)):
            if hold_cycles >= int(max_hold_cycles):
                return {
                    'action': 'close_position',
                    'confidence': 92,
                    'reasoning': f"Forced exit: holding cycles cap {int(max_hold_cycles)} hit ({hold_cycles} cycles, {hold_tag})"
                }
        if hold_hours is not None and isinstance(max_hold_hours, (int, float)):
            if hold_hours >= float(max_hold_hours):
                return {
                    'action': 'close_position',
                    'confidence': 92,
                    'reasoning': f"Forced exit: holding hours cap {float(max_hold_hours):.1f}h hit ({hold_tag})"
                }

        # Immediate loss cut
        if pnl_pct <= -5:
            return {
                'action': 'close_position',
                'confidence': 95,
                'reasoning': f"Forced exit: loss {pnl_pct:+.2f}% exceeds -5% cap (hold {hold_tag})"
            }

        # Time-based exit for losing/stale positions
        if hold_hours is not None:
            if hold_hours >= 6 and pnl_pct < -1:
                return {
                    'action': 'close_position',
                    'confidence': 90,
                    'reasoning': f"Forced exit: loss {pnl_pct:+.2f}% with stale hold {hold_tag}"
                }
            if hold_hours >= 12 and pnl_pct <= 0.3:
                return {
                    'action': 'close_position',
                    'confidence': 85,
                    'reasoning': f"Forced exit: capital tie-up {hold_tag} with low edge ({pnl_pct:+.2f}%)"
                }
        return None
    
    def _get_account_balance(self) -> float:
        """获取账户可用余额"""
        try:
            return self.client.get_account_balance()
        except Exception as e:
            log.error(f"Failed to get balance: {e}")
            return 0.0

    def _get_account_equity_estimate(self) -> float:
        """Best-effort account equity for selector filtering."""
        if self.test_mode:
            return float(global_state.virtual_balance or 0.0)

        acc = global_state.account_overview or {}
        for key in ('total_equity', 'wallet_balance', 'available_balance'):
            val = acc.get(key)
            try:
                if val is not None and float(val) > 0:
                    return float(val)
            except (TypeError, ValueError):
                continue

        try:
            acc_info = self.client.get_futures_account()
            wallet = float(acc_info.get('total_wallet_balance', 0) or 0)
            unrealized = float(acc_info.get('total_unrealized_profit', 0) or 0)
            equity = wallet + unrealized
            return equity if equity > 0 else float(wallet)
        except Exception:
            return 0.0

    def _get_cycle_logger(self):
        if self._cycle_logger is None:
            try:
                from src.monitoring.logger import TradingLogger
                self._cycle_logger = TradingLogger()
            except Exception as e:
                log.error(f"Cycle logger init failed: {e}")
                self._cycle_logger = False
        return self._cycle_logger if self._cycle_logger is not False else None

    def _record_cycle_summary(
        self,
        cycle_number: int,
        cycle_id: str,
        timestamp_start: str,
        timestamp_end: str,
        symbols: List[str],
        traded: bool,
        trade_symbol: Optional[str],
        trade_action: Optional[str],
        trade_status: Optional[str]
    ) -> None:
        logger = self._get_cycle_logger()
        if not logger:
            return

        realized_total = float(getattr(global_state, 'cumulative_realized_pnl', 0.0) or 0.0)
        cycle_realized = realized_total - (self._last_cycle_realized_pnl or 0.0)
        self._last_cycle_realized_pnl = realized_total

        if self.test_mode:
            unrealized = sum(
                float(pos.get('unrealized_pnl', 0) or 0)
                for pos in global_state.virtual_positions.values()
            )
            balance = float(global_state.virtual_balance or 0.0)
            equity = balance + unrealized
        else:
            acc = global_state.account_overview or {}
            balance = float(acc.get('wallet_balance') or acc.get('available_balance') or 0.0)
            equity = float(acc.get('total_equity') or 0.0)
            if balance and equity:
                unrealized = equity - balance
            else:
                unrealized = float(acc.get('total_pnl') or 0.0)

        total_pnl = realized_total + unrealized

        try:
            logger.log_cycle({
                'cycle_number': cycle_number,
                'cycle_id': cycle_id,
                'timestamp_start': timestamp_start,
                'timestamp_end': timestamp_end,
                'symbols': ','.join(symbols) if symbols else '',
                'traded': traded,
                'trade_symbol': trade_symbol,
                'trade_action': trade_action,
                'trade_status': trade_status,
                'realized_pnl': realized_total,
                'unrealized_pnl': unrealized,
                'total_pnl': total_pnl,
                'cycle_realized_pnl': cycle_realized,
                'equity': equity,
                'balance': balance,
                'notes': None
            })
        except Exception as e:
            log.error(f"Cycle log insert failed: {e}")
    
    def _get_current_position(self) -> Optional[PositionInfo]:
        """获取当前持仓 (支持实盘 + Test Mode)"""
        try:
            # 1. Test Mode Support
            if self.test_mode:
                if self.current_symbol in global_state.virtual_positions:
                    v_pos = global_state.virtual_positions[self.current_symbol]
                    return PositionInfo(
                        symbol=self.current_symbol,
                        side=v_pos['side'].lower(), # ensure lowercase 'long'/'short'
                        entry_price=v_pos['entry_price'],
                        quantity=v_pos['quantity'],
                        unrealized_pnl=v_pos.get('unrealized_pnl', 0)
                    )
                return None

            # 2. Live Mode Support
            pos = self.client.get_futures_position(self.current_symbol)
            if pos and abs(pos['position_amt']) > 0:
                return PositionInfo(
                    symbol=self.current_symbol,
                    side='long' if pos['position_amt'] > 0 else 'short',
                    entry_price=pos['entry_price'],
                    quantity=abs(pos['position_amt']),
                    unrealized_pnl=pos['unrealized_profit']
                )
            return None
        except Exception as e:
            log.error(f"Failed to get positions: {e}")
            return None
    
    def _execute_order(self, order_params: Dict) -> bool:
        """
        执行订单
        
        Args:
            order_params: 订单参数
        
        Returns:
            是否成功
        """
        try:
            # 设置杠杆
            self.client.set_leverage(
                symbol=self.current_symbol,
                leverage=order_params['leverage']
            )
            
            # 市价开仓
            side = 'BUY' if order_params['action'] == 'long' else 'SELL'
            order = self.client.place_futures_market_order(
                symbol=self.current_symbol,
                side=side,
                quantity=order_params['quantity']
            )
            
            if not order:
                return False
            
            # 设置止损止盈
            self.execution_engine.set_stop_loss_take_profit(
                symbol=self.current_symbol,
                position_side='LONG' if order_params['action'] == 'long' else 'SHORT',
                stop_loss=order_params['stop_loss'],
                take_profit=order_params['take_profit']
            )
            
            return True
            
        except Exception as e:
            log.error(f"Order execution failed: {e}", exc_info=True)
            return False
    
    
    

    def _build_market_context(self, quant_analysis: Dict, predict_result, market_data: Dict, regime_info: Dict = None, position_info: Dict = None) -> str:
        """
        构建 DeepSeek LLM 所需的市场上下文文本
        """
        # 提取关键数据
        current_price = market_data['current_price']
        
        # 格式化趋势分析
        trend = quant_analysis.get('trend', {})
        trend_details = trend.get('details', {})
        
        oscillator = quant_analysis.get('oscillator', {})
        
        sentiment = quant_analysis.get('sentiment', {})
        
        # Prophet 预测 (语义化转换)
        prob_pct = (predict_result.probability_up if predict_result else 0.5) * 100
        prophet_signal = predict_result.signal if predict_result else "neutral"
        
        # 语义转换逻辑 (Prophet)
        if prob_pct >= 80:
            prediction_desc = f"Strong Uptrend Forecast (High Probability of Rising > 80%, Value: {prob_pct:.1f}%)"
        elif prob_pct >= 60:
            prediction_desc = f"Bullish Bias (Likely to Rise 60-80%, Value: {prob_pct:.1f}%)"
        elif prob_pct <= 20:
            prediction_desc = f"Strong Downtrend Forecast (High Probability of Falling > 80%, Value: {prob_pct:.1f}%)"
        elif prob_pct <= 40:
            prediction_desc = f"Bearish Bias (Likely to Fall 60-80%, Value: {prob_pct:.1f}%)"
        else:
            prediction_desc = f"Uncertain/Neutral (40-60%, Value: {prob_pct:.1f}%)"

        # 语义化转换 (Technical Indicators)
        t_score_total = trend.get('total_trend_score')  # Default to None
        t_semantic = SemanticConverter.get_trend_semantic(t_score_total)
        # Individual Trend Scores
        t_1h_score = trend.get('trend_1h_score') 
        t_15m_score = trend.get('trend_15m_score')
        t_5m_score = trend.get('trend_5m_score')
        t_1h_sem = SemanticConverter.get_trend_semantic(t_1h_score)
        t_15m_sem = SemanticConverter.get_trend_semantic(t_15m_score)
        t_5m_sem = SemanticConverter.get_trend_semantic(t_5m_score)
        
        o_score_total = oscillator.get('total_osc_score')
        o_semantic = SemanticConverter.get_oscillator_semantic(o_score_total)
        
        s_score_total = sentiment.get('total_sentiment_score')
        s_semantic = SemanticConverter.get_sentiment_score_semantic(s_score_total)

        rsi_15m = oscillator.get('oscillator_15m', {}).get('details', {}).get('rsi_value')
        rsi_1h = oscillator.get('oscillator_1h', {}).get('details', {}).get('rsi_value')
        rsi_15m_semantic = SemanticConverter.get_rsi_semantic(rsi_15m)
        rsi_1h_semantic = SemanticConverter.get_rsi_semantic(rsi_1h)
        
        # MACD
        macd_15m = trend.get('details', {}).get('15m_macd_diff')
        macd_semantic = SemanticConverter.get_macd_semantic(macd_15m)
        
        oi_change = sentiment.get('oi_change_24h_pct', 0)
        oi_semantic = SemanticConverter.get_oi_change_semantic(oi_change)
        
        # 市场状态与价格位置
        regime_type = "Unknown"
        regime_confidence = 0
        price_position = "Unknown"
        price_position_pct = 50
        if regime_info:
            regime_type = regime_info.get('regime', 'unknown')
            regime_confidence = regime_info.get('confidence', 0)
            position_info_regime = regime_info.get('position', {})
            price_position = position_info_regime.get('location', 'unknown')
            price_position_pct = position_info_regime.get('position_pct', 50)
        
        # Helper to format values safely
        def fmt_val(val, fmt="{:.2f}"):
            return fmt.format(val) if val is not None else "N/A"
            
        # 构建持仓信息文本 (New)
        position_section = ""
        if position_info:
            side_icon = "🟢" if position_info['side'] == 'LONG' else "🔴"
            pnl_icon = "💰" if position_info['unrealized_pnl'] > 0 else "💸"
            position_section = f"""
## 💼 CURRENT POSITION STATUS (Virtual Sub-Agent Logic)
> ⚠️ CRITICAL: YOU ARE HOLDING A POSITION. EVALUATE EXIT CONDITIONS FIRST.

- **Status**: {side_icon} {position_info['side']}
- **Entry Price**: ${position_info['entry_price']:,.2f}
- **Current Price**: ${current_price:,.2f}
- **PnL**: {pnl_icon} ${position_info['unrealized_pnl']:.2f} ({position_info['pnl_pct']:+.2f}%)
- **Quantity**: {position_info['quantity']}
- **Leverage**: {position_info['leverage']}x

**EXIT JUDGMENT INSTRUCTION**:
1. **Trend Reversal**: If current trend contradicts position side (e.g. Long but Trend turned Bearish), consider CLOSE.
2. **Profit/Risk**: Check if PnL is satisfactory or risk is increasing.
3. **If Closing**: Return `close_position` action.
"""
        
        context = f"""
## 1. Price & Position Overview
- Symbol: {self.current_symbol}
- Current Price: ${current_price:,.2f}

{position_section}

## 2. Four-Layer Strategy Status
"""
        # Build four-layer status summary with smart grouping
        blocking_reason = global_state.four_layer_result.get('blocking_reason', 'None')
        layer1_pass = global_state.four_layer_result.get('layer1_pass')
        layer2_pass = global_state.four_layer_result.get('layer2_pass')
        layer3_pass = global_state.four_layer_result.get('layer3_pass')
        layer4_pass = global_state.four_layer_result.get('layer4_pass')
        
        layer_status = []
        
        # Smart grouping: if both Layer 1 and 2 fail with same reason, merge them
        if not layer1_pass and not layer2_pass:
            layer_status.append(f"❌ **Layers 1-2 BLOCKED**: {blocking_reason}")
        else:
            if layer1_pass:
                layer_status.append("✅ **Trend/Fuel**: PASS")
            else:
                layer_status.append(f"❌ **Trend/Fuel**: FAIL - {blocking_reason}")
            
            if layer2_pass:
                layer_status.append("✅ **AI Filter**: PASS")
            else:
                layer_status.append(f"❌ **AI Filter**: VETO - {blocking_reason}")
        
        # Layer 3 & 4
        layer_status.append(f"{'✅' if layer3_pass else '⏳'} **Setup (15m)**: {'READY' if layer3_pass else 'WAIT'}")
        layer_status.append(f"{'✅' if layer4_pass else '⏳'} **Trigger (5m)**: {'CONFIRMED' if layer4_pass else 'WAITING'}")
        
        # Add risk adjustment
        tp_mult = global_state.four_layer_result.get('tp_multiplier', 1.0)
        sl_mult = global_state.four_layer_result.get('sl_multiplier', 1.0)
        if tp_mult != 1.0 or sl_mult != 1.0:
            layer_status.append(f"⚖️ **Risk Adjustment**: TP x{tp_mult} | SL x{sl_mult}")
        
        context += "\n".join(layer_status)
        
        # Add data anomaly warning
        if global_state.four_layer_result.get('data_anomalies'):
            anomalies = ', '.join(global_state.four_layer_result.get('data_anomalies', []))
            context += f"\n\n⚠️ **DATA ANOMALY**: {anomalies}"

        # Multi-Period Parser Summary
        multi_period = getattr(global_state, 'multi_period_result', {}) or {}
        if multi_period:
            trend_scores = multi_period.get('trend_scores', {}) or {}
            four_layer = multi_period.get('four_layer', {}) or {}
            layer_pass = four_layer.get('layer_pass', {}) or {}
            context += "\n\n## 3. Multi-Period Parser\n"
            context += (
                f"- Alignment: {multi_period.get('alignment_reason', 'N/A')}\n"
                f"- Bias: {multi_period.get('bias', 'N/A')}\n"
                f"- Trend Scores (1h/15m/5m): "
                f"{trend_scores.get('trend_1h', 0):+.0f}/"
                f"{trend_scores.get('trend_15m', 0):+.0f}/"
                f"{trend_scores.get('trend_5m', 0):+.0f}\n"
                f"- Four-Layer: {four_layer.get('final_action', 'WAIT')} "
                f"(L1:{'Y' if layer_pass.get('L1') else 'N'}, "
                f"L2:{'Y' if layer_pass.get('L2') else 'N'}, "
                f"L3:{'Y' if layer_pass.get('L3') else 'N'}, "
                f"L4:{'Y' if layer_pass.get('L4') else 'N'})"
            )

        context += "\n\n## 4. Detailed Market Analysis\n"
        
        # Extract analysis results
        trend_result = getattr(global_state, 'semantic_analyses', {}).get('trend', {})
        setup_result = getattr(global_state, 'semantic_analyses', {}).get('setup', {})
        trigger_result = getattr(global_state, 'semantic_analyses', {}).get('trigger', {})
        
        # Trend Analysis (formerly TREND AGENT)
        if isinstance(trend_result, dict):
            trend_analysis = trend_result.get('analysis', 'Not available')
            trend_stance = trend_result.get('stance', 'UNKNOWN')
            trend_meta = trend_result.get('metadata', {})
            trend_header = f"### 🔮 Trend & Direction Analysis [{trend_stance}] (Strength: {trend_meta.get('strength', 'N/A')}, ADX: {trend_meta.get('adx', 'N/A')})"
        else:
            trend_analysis = trend_result if trend_result else 'Not available'
            trend_header = "🔮 Trend & Direction Analysis"
            
        # Entry Zone Analysis (formerly SETUP AGENT)
        if isinstance(setup_result, dict):
            setup_analysis = setup_result.get('analysis', 'Not available')
            setup_stance = setup_result.get('stance', 'UNKNOWN')
            setup_meta = setup_result.get('metadata', {})
            setup_header = f"### 📊 Entry Zone Analysis [{setup_stance}] (Zone: {setup_meta.get('zone', 'N/A')}, KDJ: {setup_meta.get('kdj_j', 'N/A')})"
        else:
            setup_analysis = setup_result if setup_result else 'Not available'
            setup_header = "### 📊 Entry Zone Analysis"

        # Entry Timing Signal (formerly TRIGGER AGENT)
        if isinstance(trigger_result, dict):
            trigger_analysis = trigger_result.get('analysis', 'Not available')
            trigger_stance = trigger_result.get('stance', 'UNKNOWN')
            trigger_meta = trigger_result.get('metadata', {})
            trigger_header = f"### ⚡ Entry Timing Signal [{trigger_stance}] (Pattern: {trigger_meta.get('pattern', 'NONE')}, RVOL: {trigger_meta.get('rvol', 'N/A')}x)"
        else:
            trigger_analysis = trigger_result if trigger_result else 'Not available'
            trigger_header = "### ⚡ Entry Timing Signal"

        context += f"\n{trend_header}\n{trend_analysis}\n"
        context += f"\n{setup_header}\n{setup_analysis}\n"
        context += f"\n{trigger_header}\n{trigger_analysis}\n"
        
        # Note: Market Regime and Price Position are already calculated by TREND and SETUP agents
        # and included in their respective analyses above, so we don't duplicate them here.
        
        return context

# ... locating where vote_result is processed to add semantic analysis


    def run_once(self) -> Dict:
        """运行一次交易循环（同步包装）"""
        result = asyncio.run(self.run_trading_cycle())
        self._display_recent_trades()
        return result

    def _display_recent_trades(self):
        """显示最近的交易记录 (增强版表格)"""
        trades = self.saver.get_recent_trades(limit=10)
        if not trades:
            return
            
        print("\n" + "─"*100)
        print("📜 最近 10 次成交审计 (The Executor History)")
        print("─"*100)
        header = f"{'时间':<12} | {'币种':<8} | {'方向':<10} | {'成交价':<10} | {'成本':<10} | {'卖出价':<10} | {'盈亏':<10} | {'状态'}"
        print(header)
        print("─"*100)
        
        for t in trades:
            # 简化时间
            fmt_time = str(t.get('record_time', 'N/A'))[5:16]
            symbol = t.get('symbol', 'BTC')[:7]
            action = t.get('action', 'N/A')
            price = f"${float(t.get('price', 0)):,.1f}"
            cost = f"${float(t.get('cost', 0)):,.1f}"
            exit_p = f"${float(t.get('exit_price', 0)):,.1f}" if float(t.get('exit_price', 0)) > 0 else "-"
            
            pnl_val = float(t.get('pnl', 0))
            pnl_str = f"{'+' if pnl_val > 0 else ''}${pnl_val:,.2f}" if pnl_val != 0 else "-"
            
            status = t.get('status', 'N/A')
            
            row = f"{fmt_time:<12} | {symbol:<8} | {action:<10} | {price:<10} | {cost:<10} | {exit_p:<10} | {pnl_str:<10} | {status}"
            print(row)
        print("─"*100)
    
    def get_statistics(self) -> Dict:
        """获取统计信息"""
        stats = {
            'risk_audit': self.risk_audit.get_audit_report(),
        }
        # DeepSeek 模式下没有 decision_core
        if hasattr(self, 'strategy_engine'):
            # self.strategy_engine 目前没有 get_statistics 方法，但可以返回基本信息
            stats['strategy_engine'] = {
                'provider': self.strategy_engine.provider,
                'model': self.strategy_engine.model
            }
        return stats

    def start_account_monitor(self):
        """Start a background thread to monitor account equity in real-time"""
        def _monitor():
            if self.test_mode:
                log.info("💰 Account Monitor Thread: Disabled in Test Mode")
                return
                
            log.info("💰 Account Monitor Thread Started")
            while True:
                # Check Control State
                if global_state.execution_mode == "Stopped":
                    break
                
                # We update even if Paused, to see PnL of open positions
                try:
                    acc = self.client.get_futures_account()
                    
                    wallet = float(acc.get('total_wallet_balance', 0))
                    pnl = float(acc.get('total_unrealized_profit', 0))
                    avail = float(acc.get('available_balance', 0))
                    equity = wallet + pnl
                    
                    global_state.update_account(equity, avail, wallet, pnl)
                    global_state.record_account_success()  # Track success
                except Exception as e:
                    log.error(f"Account Monitor Error: {e}")
                    global_state.record_account_failure()  # Track failure
                    global_state.add_log(f"❌ Account info fetch failed: {str(e)}")  # Dashboard log
                    time.sleep(5) # Backoff on error
                
                time.sleep(3) # Update every 3 seconds

        t = threading.Thread(target=_monitor, daemon=True)
        t.start()

    def run_continuous(self, interval_minutes: int = 3, headless: bool = False):
        """
        持续运行模式
        
        Args:
            interval_minutes: 运行间隔（分钟）
            headless: 是否为无头模式（不使用 Web Dashboard，在终端显示）
        """
        log.info(f"🚀 Starting continuous mode (interval: {interval_minutes}min)")
        global_state.is_running = True
        
        # 🖥️ Headless Mode: Initialize terminal display and configure logging
        self._headless_mode = headless
        if headless:
            from src.cli.terminal_display import get_display
            self._terminal_display = get_display(self.symbols)
            self._terminal_display.print_header(test_mode=self.test_mode)
            
            # Configure minimal logging for headless mode using a custom filter
            # This ensures Web Dashboard mode is not affected
            import logging
            
            class HeadlessFilter(logging.Filter):
                """Filter to suppress verbose logs only in headless mode"""
                def filter(self, record):
                    # Only suppress INFO level logs from specific modules
                    if record.levelno == logging.INFO:
                        suppressed_modules = [
                            'src.features.technical_features',
                            'src.utils.logger',
                            'src.agents.data_sync_agent',
                            'src.agents.trend_agent',
                            'src.agents.setup_agent',
                            'src.agents.trigger_agent',
                            'src.strategy.llm_engine',
                            'src.models.prophet_model',
                            'src.server.state',
                            '__main__'
                        ]
                        return record.name not in suppressed_modules
                    return True  # Allow WARNING and above
            
            # Add filter to root logger
            headless_filter = HeadlessFilter()
            logging.getLogger().addFilter(headless_filter)
            
            # Store filter reference for cleanup
            self._headless_filter = headless_filter
        
        # Logger is configured in src.utils.logger, no need to override here.
        # Dashboard logging is handled via global_state.add_log -> log.bind(dashboard=True)

        # Start Real-time Monitors
        self.start_account_monitor()
        
        # 🔮 启动 Prophet 自动训练器 (每 2 小时重新训练)
        from src.models.prophet_model import ProphetAutoTrainer, HAS_LIGHTGBM
        if HAS_LIGHTGBM and self.agent_config.predict_agent:
            # 为主交易对创建自动训练器 (容错: 主交易对未初始化时切换)
            if self.primary_symbol not in self.predict_agents:
                fallback_symbol = next(iter(self.predict_agents.keys()), None) or (self.symbols[0] if self.symbols else None)
                if fallback_symbol and fallback_symbol not in self.predict_agents:
                    from src.agents.predict_agent import PredictAgent
                    self.predict_agents[fallback_symbol] = PredictAgent(horizon='30m', symbol=fallback_symbol)
                    log.info(f"🆕 Initialized PredictAgent for {fallback_symbol} (auto-trainer fallback)")
                if fallback_symbol:
                    self.primary_symbol = fallback_symbol
                else:
                    log.warning("⚠️ Prophet auto-trainer skipped: no PredictAgent available")

            if self.primary_symbol in self.predict_agents:
                primary_agent = self.predict_agents[self.primary_symbol]
                self.auto_trainer = ProphetAutoTrainer(
                    predict_agent=primary_agent,
                    binance_client=self.client,
                    interval_hours=2.0,  # 每 2 小时训练一次
                    training_days=70,    # 使用最近 70 天数据 (10x samples)
                    symbol=self.primary_symbol
                )
                self.auto_trainer.start()
        
        # 设置初始间隔 (优先使用 CLI 参数，后续 API 可覆盖)
        global_state.cycle_interval = interval_minutes
        
        log.info(f"🚀 Starting continuous trading mode (interval: {global_state.cycle_interval}m)")
        
        # 🧪 Test Mode: Initialize Virtual Account for Chart
        if self.test_mode:
            log.info("🧪 Test Mode: Initializing Virtual Account...")
            initial_balance = global_state.virtual_initial_balance
            current_balance = global_state.virtual_balance
            global_state.init_balance(current_balance, initial_balance=initial_balance)  # Initialize balance tracking
            global_state.update_account(
                equity=current_balance,
                available=current_balance,
                wallet=current_balance,
                pnl=current_balance - initial_balance
            )
        
        try:
            while global_state.is_running:
                # 🔄 Check for configuration changes
                # Method 1: .env file changed (Local mode)
                if self._env_exists:
                    try:
                        current_mtime = os.path.getmtime(self._env_path)
                        if current_mtime > self._env_mtime:
                            if self._env_mtime > 0: # Avoid reload on first pass as it's already loaded
                                log.info("📝 .env file change detected, reloading symbols...")
                                self._reload_symbols()
                            self._env_mtime = current_mtime
                    except Exception as e:
                        log.warning(f"Error checking .env mtime: {e}")
                
                # Method 2: Runtime config changed (Railway mode)
                if global_state.config_changed:
                    log.info("⚙️ Runtime config change detected, reloading symbols...")
                    self._reload_symbols()
                    # Reload LLM engine after config updates
                    try:
                        if hasattr(self, "strategy_engine"):
                            self.strategy_engine.reload_config()
                            self._update_llm_metadata()
                    except Exception as e:
                        log.warning(f"⚠️ Failed to reload LLM engine: {e}")
                    # Re-evaluate agent config from env/config on runtime updates
                    from src.agents.agent_config import AgentConfig
                    refreshed = AgentConfig.from_dict({'agents': self.config.get('agents', {})})
                    refreshed_map = refreshed.get_enabled_agents()
                    if refreshed_map != self._last_agent_config:
                        log.info(f"🔧 Runtime agent config refreshed: {refreshed_map}")
                        self._apply_agent_config(refreshed_map)
                    global_state.config_changed = False  # Reset flag
                
                runtime_agents = getattr(global_state, 'agent_config', None)
                if runtime_agents and runtime_agents != self._last_agent_config:
                    log.info(f"🔧 Runtime agent config updated: {runtime_agents}")
                    self._apply_agent_config(runtime_agents)

                # Check stop state FIRST - must break before continue
                if global_state.execution_mode == 'Stopped':
                    # Fix: Do not break, just wait.
                    if not hasattr(self, '_stop_logged') or not self._stop_logged:
                        print("\n⏹️ System stopped (waiting for start)")
                        global_state.add_log("⏹️ System STOPPED - Waiting for Start...")
                        self._stop_logged = True
                    time.sleep(1)
                    continue
                else:
                    self._stop_logged = False
                
                # Check pause state - continue waiting
                if global_state.execution_mode == 'Paused':
                    # 首次进入暂停时打印日志
                    if not hasattr(self, '_pause_logged') or not self._pause_logged:
                        print("\n⏸️ System paused, waiting to resume...")
                        global_state.add_log("⏸️ System PAUSED - waiting for resume...")
                        self._pause_logged = True
                    time.sleep(1)
                    continue
                else:
                    self._pause_logged = False  # 重置暂停日志标记

                # ✅ 统一周期计数: 在遍历币种前递增一次
                global_state.cycle_counter += 1
                cycle_num = global_state.cycle_counter
                cycle_id = f"cycle_{cycle_num:04d}_{int(time.time())}"
                global_state.current_cycle_id = cycle_id
                cycle_start_ts = datetime.now().isoformat()
                cycle_traded = False
                cycle_trade_symbol = None
                cycle_trade_action = None
                cycle_trade_status = None

                # 🧪 Test Mode: reset per-cycle baseline for PnL display
                if self.test_mode:
                    baseline = global_state.account_overview.get('total_equity', 0)
                    if not baseline:
                        unrealized = sum(
                            float(pos.get('unrealized_pnl', 0) or 0)
                            for pos in global_state.virtual_positions.values()
                        )
                        baseline = global_state.virtual_balance + unrealized
                    global_state.virtual_initial_balance = baseline
                    global_state.initial_balance = baseline

                # 🧹 Clear initialization logs when Cycle 1 starts (sync with Recent Decisions)
                if cycle_num == 1:
                    global_state.clear_init_logs()

                # 🔒 Position lock: if any active position exists, lock analysis to it.
                active_symbols = self._get_active_position_symbols()
                locked_symbols = [s for s in self.symbols if s in active_symbols]
                if active_symbols and not locked_symbols:
                    locked_symbols = sorted(set(active_symbols))
                has_lock = bool(locked_symbols)

                # 🔝 Symbol Selector Agent: run once at startup, then every 10 minutes during wait
                if (not has_lock
                        and not self.selector_startup_done
                        and self.agent_config.symbol_selector_agent):
                    self._run_symbol_selector(reason="startup")

                symbols_for_cycle = locked_symbols if has_lock else self.symbols
                if has_lock:
                    self.current_symbol = symbols_for_cycle[0]
                    global_state.current_symbol = self.current_symbol
                    global_state.add_log(f"[🔒 SYSTEM] Active position lock: {', '.join(symbols_for_cycle)}")

                # 🧪 Test Mode: Record start of cycle account state (for Net Value Curve)
                if self.test_mode:
                    # Re-log current state with new cycle number so chart shows start of cycle
                    global_state.update_account(
                        equity=global_state.account_overview['total_equity'],
                        available=global_state.account_overview['available_balance'],
                        wallet=global_state.account_overview['wallet_balance'],
                        pnl=global_state.account_overview['total_pnl']
                    )
                
                # 🖥️ Headless Mode: Use terminal display
                if self._headless_mode:
                    self._terminal_display.print_cycle_start(cycle_num, symbols_for_cycle)
                else:
                    print(f"\n{'='*80}")
                    print(f"🔄 Cycle #{cycle_num} | 分析 {len(symbols_for_cycle)} 个交易对")
                    print(f"{'='*80}")
                global_state.add_log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
                global_state.add_log(f"[📊 SYSTEM] Cycle #{cycle_num} | {', '.join(symbols_for_cycle)}")

                # 🎯 重置周期开仓计数器
                global_state.cycle_positions_opened = 0
                
                # 🔄 多币种顺序处理: 依次分析每个交易对
                # Step 1: 收集所有交易对的决策
                all_decisions = []
                latest_prices = {}  # Store latest prices for PnL calculation
                for symbol in symbols_for_cycle:
                    self.current_symbol = symbol  # 设置当前处理的交易对
                    global_state.current_symbol = symbol
                    
                    # Analyze each symbol first without executing OPEN actions
                    result = asyncio.run(self.run_trading_cycle(analyze_only=True))
                    
                    latest_prices[symbol] = global_state.current_price.get(symbol, 0)
                    
                    print(f"  [{symbol}] 结果: {result['status']}")
                    
                    # Collect viable open opportunities
                    if result.get('status') == 'suggested':
                        all_decisions.append({
                            'symbol': symbol,
                            'result': result,
                            'confidence': result.get('confidence', 0)
                        })
                
                # Step 2: 从所有开仓决策中选择信心度最高的一个
                if all_decisions:
                    # 按信心度排序
                    all_decisions.sort(key=lambda x: x['confidence'], reverse=True)
                    best_decision = all_decisions[0]
                    
                    print(f"\n🎯 本周期最优开仓机会: {best_decision['symbol']} (信心度: {best_decision['confidence']:.1f}%)")
                    global_state.add_log(f"[🎯 SYSTEM] Best: {best_decision['symbol']} (Conf: {best_decision['confidence']:.1f}%)")
                    
                    # 只执行最优的一个（重新运行完整执行流程）
                    try:
                        self.current_symbol = best_decision['symbol']
                        global_state.current_symbol = self.current_symbol
                        exec_result = asyncio.run(self.run_trading_cycle(analyze_only=False))
                        exec_action = exec_result.get('action', 'unknown')
                        exec_status = exec_result.get('status', 'unknown')
                        if exec_action and str(exec_action).lower() not in ('hold', 'wait', 'unknown'):
                            cycle_traded = exec_status == 'success'
                            cycle_trade_symbol = self.current_symbol
                            cycle_trade_action = exec_action
                            cycle_trade_status = exec_status
                        global_state.add_log(
                            f"[🎯 SYSTEM] Executed: {self.current_symbol} {exec_action} ({exec_status})"
                        )
                    except Exception as e:
                        log.error(f"❌ Best decision execution failed: {e}", exc_info=True)
                        global_state.add_log(f"[🎯 SYSTEM] Execution failed: {e}")
                    
                    # 如果有其他开仓机会被跳过，记录下来
                    if len(all_decisions) > 1:
                        skipped = [f"{d['symbol']}({d['confidence']:.1f}%)" for d in all_decisions[1:]]
                        print(f"  ⏭️  跳过其他机会: {', '.join(skipped)}")
                        global_state.add_log(f"⏭️  Skipped opportunities: {', '.join(skipped)} (1 position per cycle limit)")
                
                        global_state.add_log(f"⏭️  Skipped opportunities: {', '.join(skipped)} (1 position per cycle limit)")
                
                # 💰 Update Virtual Account PnL (Mark-to-Market)
                if self.test_mode:
                    self._update_virtual_account_stats(latest_prices)
                
                # 🖥️ Headless Mode: Print account summary after each cycle
                if self._headless_mode:
                    acc = global_state.account_overview
                    # Get current positions
                    positions = global_state.virtual_positions if self.test_mode else {}
                    self._terminal_display.print_account_summary(
                        equity=acc['total_equity'],
                        available=acc['available_balance'],
                        pnl=acc['total_pnl'],
                        initial=global_state.initial_balance,
                        cycle=global_state.cycle_counter,
                        positions=positions,
                        symbols=symbols_for_cycle
                    )

                # 📋 Persist cycle summary to DB
                self._record_cycle_summary(
                    cycle_number=cycle_num,
                    cycle_id=cycle_id,
                    timestamp_start=cycle_start_ts,
                    timestamp_end=datetime.now().isoformat(),
                    symbols=symbols_for_cycle,
                    traded=cycle_traded,
                    trade_symbol=cycle_trade_symbol,
                    trade_action=cycle_trade_action,
                    trade_status=cycle_trade_status
                )
                
                # Dynamic Interval: specific to new requirement
                current_interval = global_state.cycle_interval
                
                # 等待下一次检查
                if self._headless_mode:
                    self._terminal_display.print_waiting(current_interval)
                else:
                    print(f"\n⏳ 等待 {current_interval} 分钟...")
                
                # Sleep in chunks to allow responsive PAUSE/STOP and INTERVAL changes
                # Check every 1 second during the wait interval
                elapsed_seconds = 0
                while True:
                    # 每秒检查当前间隔设置 (支持动态调整)
                    current_interval = global_state.cycle_interval
                    wait_seconds = current_interval * 60

                    # Run symbol selector on schedule (every 10 minutes, skip if holding positions)
                    # Note: _run_symbol_selector also has internal position check for safety
                    has_positions = bool(self._get_active_position_symbols())
                    if (self.agent_config.symbol_selector_agent
                            and (time.time() - self.selector_last_run) >= self.selector_interval_sec
                            and global_state.execution_mode == "Running"
                            and not has_positions):
                        self._run_symbol_selector(reason="scheduled")
                    
                    # 如果已经等待足够时间，结束等待
                    if elapsed_seconds >= wait_seconds:
                        break
                    
                    # 检查执行模式
                    if global_state.execution_mode != "Running":
                        break
                    
                    # Heartbeat every 60s
                    if elapsed_seconds > 0 and elapsed_seconds % 60 == 0:
                        remaining = int((wait_seconds - elapsed_seconds) / 60)
                        if remaining > 0:
                             print(f"⏳ Next cycle in {remaining}m...")
                             global_state.add_log(f"[📊 SYSTEM] Waiting next cycle... ({remaining}m)")

                    time.sleep(1)
                    elapsed_seconds += 1
                
        except KeyboardInterrupt:
            if self._headless_mode:
                # Display shutdown summary
                stats = {
                    'cycles': global_state.cycle_counter,
                    'trades': len(global_state.trade_history),
                    'total_pnl': global_state.account_overview.get('total_pnl', 0)
                }
                self._terminal_display.print_shutdown(stats)
                
                # Clean up headless filter
                import logging
                if hasattr(self, '_headless_filter'):
                    logging.getLogger().removeFilter(self._headless_filter)
            else:
                print(f"\n\n⚠️  收到停止信号，退出...")
            global_state.is_running = False

    def _update_virtual_account_stats(self, latest_prices: Dict[str, float]):
        """
        [Test Mode] 更新虚拟账户统计 (权益、PnL) 并推送到 Global State
        """
        if not self.test_mode:
            return

        total_unrealized_pnl = 0.0
        
        # 遍历持仓计算未实现盈亏
        for symbol, pos in global_state.virtual_positions.items():
            current_price = latest_prices.get(symbol)
            if not current_price:
                 # Fallback to stored price if current not available
                 current_price = pos.get('current_price', pos['entry_price'])
                
            entry_price = pos['entry_price']
            quantity = pos['quantity']
            side = pos['side']  # LONG or SHORT
            
            # PnL Calc
            if side.upper() == 'LONG':
                pnl = (current_price - entry_price) * quantity
            else:
                pnl = (entry_price - current_price) * quantity
                
            pos['unrealized_pnl'] = pnl
            pos['current_price'] = current_price
            total_unrealized_pnl += pnl

        # 更新权益
        # Equity = Balance (Realized) + Unrealized PnL
        total_equity = global_state.virtual_balance + total_unrealized_pnl
        
        # 计算真实总盈亏 (相比初始资金)
        # Total PnL = Current Equity - Initial Balance
        real_total_pnl = total_equity - global_state.virtual_initial_balance
        
        # 更新 Global State
        global_state.update_account(
            equity=total_equity,
            available=global_state.virtual_balance,
            wallet=global_state.virtual_balance,
            pnl=real_total_pnl  # ✅ Fix: Pass total profit/loss from start
        )


    def _save_virtual_state(self):
        """Helper to persist virtual account state"""
        if self.test_mode:
            self.saver.save_virtual_account(
                balance=global_state.virtual_balance,
                positions=global_state.virtual_positions
            )

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
    parser.add_argument('--test', action='store_true', help='测试模式')
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
    
    # Priority: Command line > Env Var
    if not args.test and env_run_mode == 'test':
        args.test = True
    elif args.test and env_run_mode == 'live':
        pass # Command line override to force test? or live? Let's say explicit CLI wins.

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
    
    
    # 创建机器人
    bot = MultiAgentTradingBot(
        max_position_size=args.max_position,
        leverage=args.leverage,
        stop_loss_pct=args.stop_loss,
        take_profit_pct=args.take_profit,
        test_mode=args.test,
        kline_limit=args.kline_limit
    )

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
        top2 = loop.run_until_complete(bot._resolve_auto3_symbols())
        
        # Update bot symbols
        bot.symbols = top2
        bot.current_symbol = top2[0] if top2 else 'FETUSDT'
        global_state.symbols = top2

        # Ensure PredictAgent exists for AUTO3 symbols
        for symbol in bot.symbols:
            if symbol not in bot.predict_agents:
                bot.predict_agents[symbol] = PredictAgent(horizon='30m', symbol=symbol)
                log.info(f"🆕 Initialized PredictAgent for {symbol} (AUTO3)")
        
        # Start auto-refresh thread (12h interval)
        selector = get_selector()
        selector.start_auto_refresh()
        
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
