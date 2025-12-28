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

import asyncio
import sys
import os

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
from src.agents.regime_detector import RegimeDetector  # ✅ Market Regime Detection
from src.config import Config # Re-added Config as it's used later

# FastAPI dependencies
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# 导入多Agent
from src.agents import (
    DataSyncAgent,
    QuantAnalystAgent,
    DecisionCoreAgent,
    RiskAuditAgent,
    PositionInfo,
    SignalWeight,
    ReflectionAgent
)
from src.strategy.llm_engine import StrategyEngine
from src.agents.predict_agent import PredictAgent
from src.server.app import app
from src.server.state import global_state

# ✅ [新增] 导入 TradingLogger 以便初始化数据库
from src.monitoring.logger import TradingLogger

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
        test_mode: bool = False
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
        print(f"🤖 AI Trader - DeepSeek LLM Decision Mode")
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
                symbol_str = self.config.get('trading.symbol', 'BTCUSDT')
                if ',' in symbol_str:
                    self.symbols = [s.strip() for s in symbol_str.split(',') if s.strip()]
                else:
                    self.symbols = [symbol_str]
                
        self.primary_symbol = self.config.get('trading.primary_symbol', self.symbols[0])
        self.current_symbol = self.primary_symbol  # 当前处理的交易对
        self.test_mode = test_mode
        global_state.is_test_mode = test_mode  # Set test mode in global state
        
        # 交易参数
        self.max_position_size = max_position_size
        self.leverage = leverage
        self.stop_loss_pct = stop_loss_pct
        self.take_profit_pct = take_profit_pct
        
        
        # 初始化客户端
        self.client = BinanceClient()
        self.risk_manager = RiskManager()
        self.execution_engine = ExecutionEngine(self.client, self.risk_manager)
        self.saver = DataSaver() # ✅ 初始化 Multi-Agent 数据保存器
        global_state.saver = self.saver # ✅ 将 saver 共享到全局状态，供各 Agent 使用
        
        # ✅ 初始化多账户管理器
        self.account_manager = AccountManager()
        self._init_accounts()
        
        # 初始化共享 Agent (与币种无关)
        print("\n🚀 Initializing agents...")
        self.data_sync_agent = DataSyncAgent(self.client)
        self.quant_analyst = QuantAnalystAgent()
        # self.decision_core = DecisionCoreAgent() # Deprecated in DeepSeek Mode
        self.risk_audit = RiskAuditAgent(
            max_leverage=10.0,
            max_position_pct=0.3,
            min_stop_loss_pct=0.005,
            max_stop_loss_pct=0.05
        )
        self.processor = MarketDataProcessor()  # ✅ 初始化数据处理器
        self.feature_engineer = TechnicalFeatureEngineer()  # 🔮 特征工程器 for Prophet
        # self.regime_detector = RegimeDetector()  # 📊 市场状态检测器 (Integrated into QuantAnalystAgent)
        
        # 🔮 为每个币种创建独立的 PredictAgent
        self.predict_agents = {}
        for symbol in self.symbols:
            self.predict_agents[symbol] = PredictAgent(horizon='30m', symbol=symbol)
        
        print("  ✅ DataSyncAgent ready")
        print("  ✅ QuantAnalystAgent ready")
        print(f"  ✅ PredictAgent ready ({len(self.symbols)} symbols)")
        print("  ✅ RiskAuditAgent ready")
        
        # 🧠 DeepSeek 决策引擎
        self.strategy_engine = StrategyEngine()
        if self.strategy_engine.is_ready:
            print("  ✅ DeepSeek StrategyEngine ready")
        else:
            print("  ⚠️ DeepSeek StrategyEngine not ready (Awaiting API Key)")
        
        # 🧠 Reflection Agent - 交易反思
        self.reflection_agent = ReflectionAgent()
        print("  ✅ ReflectionAgent ready")
        
        print(f"\n⚙️  Trading Config:")
        print(f"  - Symbols: {', '.join(self.symbols)}")
        print(f"  - Max Position: ${self.max_position_size:.2f} USDT")
        print(f"  - Leverage: {self.leverage}x")
        print(f"  - Stop Loss: {self.stop_loss_pct}%")
        print(f"  - Take Profit: {self.take_profit_pct}%")
        print(f"  - Test Mode: {'✅ Yes' if self.test_mode else '❌ No'}")
        
        # ✅ Load initial trade history (Only in Live Mode)
        if not self.test_mode:
            recent_trades = self.saver.get_recent_trades(limit=20)
            global_state.trade_history = recent_trades
            print(f"  📜 Loaded {len(recent_trades)} historical trades")
        else:
            global_state.trade_history = []
            print("  🧪 Test mode: No history loaded, showing only current session")
    
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


    async def run_trading_cycle(self) -> Dict:
        """
        执行完整的交易循环（异步版本）
        Returns:
            {
                'status': 'success/failed/hold/blocked',
                'action': 'long/short/hold',
                'details': {...}
            }
        """
        print(f"\n{'='*80}")
        print(f"🔄 启动交易审计循环 | {datetime.now().strftime('%H:%M:%S')} | {self.current_symbol}")
        print(f"{'='*80}")
        
        # Update Dashboard Status
        global_state.is_running = True
        # Removed verbose log: Starting trading cycle
        
        try:
            # ✅ 使用 run_continuous 中已设置的周期信息
            cycle_num = global_state.cycle_counter
            cycle_id = global_state.current_cycle_id
            
            # 每个币种的子日志
            global_state.add_log(f"[📊 SYSTEM] {self.current_symbol} analysis started")
            
            # ✅ Generate snapshot_id for this cycle (legacy compatibility)
            snapshot_id = f"snap_{int(time.time())}"

            # Step 1: 采样 - 数据先知 (The Oracle)
            print("\n[Step 1/4] 🕵️ The Oracle (Data Agent) - Fetching data...")
            global_state.oracle_status = "Fetching Data..." 
            market_snapshot = await self.data_sync_agent.fetch_all_timeframes(self.current_symbol)
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
                        
                        if side == 'LONG':
                            unrealized_pnl = (current_price_5m - entry_price) * qty
                        else:
                            unrealized_pnl = (entry_price - current_price_5m) * qty
                        
                        pnl_pct = (unrealized_pnl / (entry_price * qty)) * 100 if entry_price > 0 else 0
                        
                        # Store in position_info
                        current_position_info = {
                            'symbol': self.current_symbol,
                            'side': side,
                            'quantity': qty,
                            'entry_price': entry_price,
                            'unrealized_pnl': unrealized_pnl,
                            'pnl_pct': pnl_pct,
                            'leverage': v_pos.get('leverage', 1),
                            'is_test': True
                        }
                        
                        # Also update local object for backward compatibility with display logic
                        v_pos['unrealized_pnl'] = unrealized_pnl
                        v_pos['pnl_pct'] = pnl_pct
                        v_pos['current_price'] = current_price_5m
                        log.info(f"💰 [Virtual Position] {side} {self.current_symbol} PnL: ${unrealized_pnl:.2f} ({pnl_pct:+.2f}%)")
                        
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
                            
                            pnl_pct = (unrealized_pnl / (entry_price * qty / int(raw_pos.get('leverage', 1)))) * 100 # Approx ROE
                            
                            current_position_info = {
                                'symbol': self.current_symbol,
                                'side': side,
                                'quantity': qty,
                                'entry_price': entry_price,
                                'unrealized_pnl': unrealized_pnl,
                                'pnl_pct': pnl_pct, # Note: this might be rough calc
                                'leverage': int(raw_pos.get('leverage', 1)),
                                'is_test': False
                            }
                            log.info(f"💰 [Real Position] {side} {self.current_symbol} Amt:{amt} PnL:${unrealized_pnl:.2f}")
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
                df_with_indicators = self.processor.extract_feature_snapshot(getattr(self.processor.process_klines(raw_klines, self.current_symbol, tf), "copy")())
                # Wait, process_klines returns df. Calling extract_feature_snapshot on it is for features.
                # The original code:
                # df_with_indicators = self.processor.process_klines(raw_klines, self.current_symbol, tf)
                # self.saver.save_indicators(df_with_indicators, self.current_symbol, tf, snapshot_id)
                # features_df = self.processor.extract_feature_snapshot(df_with_indicators)
                
                # Let's restore original lines carefully.
                df_with_indicators = self.processor.process_klines(raw_klines, self.current_symbol, tf)
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
            global_state.current_price = current_price
            
            # Step 2: Strategist
            print("[Step 2/4] 👨‍🔬 The Strategist (QuantAnalyst) - Analyzing data...")
            quant_analysis = await self.quant_analyst.analyze_all_timeframes(market_snapshot)
            
            # Save Context
            self.saver.save_context(quant_analysis, self.current_symbol, 'analytics', snapshot_id, cycle_id=cycle_id)
            
            # LOG 2: QuantAnalyst (The Strategist)
            trend_score = quant_analysis.get('trend', {}).get('total_trend_score', 0)
            osc_score = quant_analysis.get('oscillator', {}).get('total_osc_score', 0)
            sent_score = quant_analysis.get('sentiment', {}).get('total_sentiment_score', 0)
            global_state.add_log(f"[👨‍🔬 STRATEGIST] Trend={trend_score:+.0f} | Osc={osc_score:+.0f} | Sent={sent_score:+.0f}")
            
            # Step 2.5: Prophet
            print("[Step 2.5/5] 🔮 The Prophet (Predict Agent) - Calculating probability...")
            df_15m_features = self.feature_engineer.build_features(processed_dfs['15m'])
            if not df_15m_features.empty:
                latest = df_15m_features.iloc[-1].to_dict()
                predict_features = {k: v for k, v in latest.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
            else:
                 predict_features = {}
            
            predict_result = await self.predict_agents[self.current_symbol].predict(predict_features)
            global_state.prophet_probability = predict_result.probability_up
            
            # LOG 3: Prophet (The Prophet)
            p_up_pct = predict_result.probability_up * 100
            direction = "↗UP" if predict_result.probability_up > 0.55 else ("↘DN" if predict_result.probability_up < 0.45 else "➖NEU")
            global_state.add_log(f"[🔮 PROPHET] P(Up)={p_up_pct:.1f}% {direction}")
            
            # Save Prediction
            self.saver.save_prediction(asdict(predict_result), self.current_symbol, snapshot_id, cycle_id=cycle_id)
            
            # === 🎯 FOUR-LAYER STRATEGY FILTERING ===
            print("[Step 2.75/5] 🎯 Four-Layer Strategy Filter - 多层验证中...")
            
            # Extract timeframe data
            trend_6h = quant_analysis.get('timeframe_6h', {})
            trend_2h = quant_analysis.get('timeframe_2h', {})
            sentiment = quant_analysis.get('sentiment', {})
            oi_fuel = sentiment.get('oi_fuel', {})
            
            # 🆕 Get Funding Rate for crowding detection
            funding_rate = sentiment.get('details', {}).get('funding_rate', 0)
            
            # 🆕 Get ADX from RegimeDetector for trend strength validation
            from src.agents.regime_detector import RegimeDetector
            regime_detector = RegimeDetector()
            df_1h = processed_dfs['1h']
            regime_result = regime_detector.detect_regime(df_1h) if len(df_1h) >= 20 else {'adx': 20, 'regime': 'unknown'}
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
                # Specification: Close > EMA20 > EMA60 (long), Close < EMA20 < EMA60 (short)
                if close_1h > ema20_1h > ema60_1h:
                    trend_1h = 'long'
                elif close_1h < ema20_1h < ema60_1h:
                    trend_1h = 'short'
                else:
                    trend_1h = 'neutral'
                
                log.info(f"📊 1h EMA: Close=${close_1h:.2f}, EMA20=${ema20_1h:.2f}, EMA60=${ema60_1h:.2f} => {trend_1h.upper()}")
            
            if trend_1h == 'neutral':
                four_layer_result['blocking_reason'] = 'No clear 1h trend (EMA 20/60)'
                log.info("❌ Layer 1 FAIL: No clear trend")
            # 🆕 ADX Weak Trend Filter - Even if EMA aligned, weak trend is not tradeable
            elif adx_value < 20:
                four_layer_result['blocking_reason'] = f"Weak Trend Strength (ADX {adx_value:.0f} < 20)"
                log.info(f"❌ Layer 1 FAIL: ADX={adx_value:.0f} < 20, trend not strong enough")
            elif trend_1h == 'long' and oi_change < -5.0:
                four_layer_result['blocking_reason'] = f"OI Divergence: Trend UP but OI {oi_change:.1f}%"
                log.warning(f"🚨 Layer 1 FAIL: OI Divergence - Price up but OI {oi_change:.1f}%")
            elif trend_1h == 'short' and oi_change > 5.0:
                four_layer_result['blocking_reason'] = f"OI Divergence: Trend DOWN but OI +{oi_change:.1f}%"
                log.warning(f"🚨 Layer 1 FAIL: OI Divergence - Price down but OI +{oi_change:.1f}%")
            elif trend_1h == 'long' and oi_fuel.get('whale_trap_risk', False):
                four_layer_result['blocking_reason'] = f"Whale trap detected (OI {oi_change:.1f}%)"
                log.warning(f"🐋 Layer 1 FAIL: Whale exit trap")
            else:
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
                log.info(f"✅ Layer 1 PASS: {trend_1h.upper()} trend + {fuel_strength} Fuel (OI {oi_change:+.1f}%)")
                
                # Layer 2: AI Prediction Filter
                from src.agents.ai_filter import AIPredictionFilter
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
                    
                    # Layer 3: 15m Setup (Specification: KDJ + Bollinger Bands)
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
                            elif close_15m < bb_middle or kdj_j < 40:
                                setup_ready = True
                                four_layer_result['setup_quality'] = 'IDEAL'
                                log.info(f"✅ Layer 3 READY: IDEAL PULLBACK - J={kdj_j:.0f} < 40 or Close < BB_middle")
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
                            elif close_15m > bb_middle or kdj_j > 60:
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
                        from src.agents.trigger_detector import TriggerDetector
                        trigger_detector = TriggerDetector()
                        
                        df_5m = processed_dfs['5m']
                        trigger_result = trigger_detector.detect_trigger(df_5m, direction=trend_1h)
                        
                        # 🆕 Always store trigger data for LLM display
                        four_layer_result['trigger_pattern'] = trigger_result.get('pattern_type') or 'None'
                        four_layer_result['trigger_rvol'] = trigger_result.get('rvol', 1.0)
                        
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
            
            # Store for LLM context
            global_state.four_layer_result = four_layer_result
            
            # 🆕 MULTI-AGENT SEMANTIC ANALYSIS
            print("[Step 2.5/5] 🤖 Multi-Agent Semantic Analysis...")
            try:
                from src.agents.trend_agent import TrendAgent
                from src.agents.setup_agent import SetupAgent
                from src.agents.trigger_agent import TriggerAgent
                
                # Initialize agents (cached after first use)
                if not hasattr(self, '_trend_agent'):
                    self._trend_agent = TrendAgent()
                    self._setup_agent = SetupAgent()
                    self._trigger_agent = TriggerAgent()
                
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
                    'trend_direction': four_layer_result.get('final_action', 'neutral')
                }
                
                trigger_data = {
                    'symbol': self.current_symbol,
                    'pattern': four_layer_result.get('trigger_pattern'),
                    'rvol': four_layer_result.get('trigger_rvol', 1.0),
                    'trend_direction': four_layer_result.get('final_action', 'neutral')
                }
                
                # Run agents in parallel using asyncio
                loop = asyncio.get_event_loop()
                trend_analysis, setup_analysis, trigger_analysis = await asyncio.gather(
                    loop.run_in_executor(None, self._trend_agent.analyze, trend_data),
                    loop.run_in_executor(None, self._setup_agent.analyze, setup_data),
                    loop.run_in_executor(None, self._trigger_agent.analyze, trigger_data)
                )
                
                # Store semantic analyses in global_state
                global_state.semantic_analyses = {
                    'trend': trend_analysis,
                    'setup': setup_analysis,
                    'trigger': trigger_analysis
                }
                
                # Log summary via global_state for dashboard
                global_state.add_log(f"[⚖️ CRITIC] 4-Layer Analysis: Trend={len(trend_analysis)>100 and '✓' or '○'} | Setup={len(setup_analysis)>100 and '✓' or '○'} | Trigger={len(trigger_analysis)>100 and '✓' or '○'}")
                
            except Exception as e:
                log.error(f"❌ Multi-Agent analysis failed: {e}")
                global_state.semantic_analyses = {
                    'trend': f"Trend analysis unavailable: {e}",
                    'setup': f"Setup analysis unavailable: {e}",
                    'trigger': f"Trigger analysis unavailable: {e}"
                }
            
            # Step 3: DeepSeek
            market_data = {
                'df_5m': processed_dfs['5m'],
                'df_15m': processed_dfs['15m'],
                'df_1h': processed_dfs['1h'],
                'current_price': current_price
            }
            regime_info = quant_analysis.get('regime', {})
            
            print("[Step 3/5] 🧠 DeepSeek LLM - Making decision...")
            
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
            
            # 🧠 Check if reflection is needed (every 10 trades)
            reflection_text = None
            total_trades = len(global_state.trade_history)
            if self.reflection_agent.should_reflect(total_trades):
                log.info(f"🧠 Triggering reflection after {total_trades} trades...")
                trades_to_analyze = global_state.trade_history[-10:]
                reflection_result = await self.reflection_agent.generate_reflection(trades_to_analyze)
                if reflection_result:
                    reflection_text = reflection_result.to_prompt_text()
                    global_state.last_reflection = reflection_result.raw_response
                    global_state.last_reflection_text = reflection_text
                    global_state.reflection_count = self.reflection_agent.reflection_count
                    global_state.add_log(f"🧠 Reflection #{self.reflection_agent.reflection_count} generated")
            else:
                # Use cached reflection if available
                reflection_text = global_state.last_reflection_text
            
            # Call DeepSeek with optional reflection
            llm_decision = self.strategy_engine.make_decision(
                market_context_text=market_context_text,
                market_context_data=market_context_data,
                reflection=reflection_text
            )
            
            # ... Rest of logic stays similar ...
            
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
                'deepseek': llm_decision.get('confidence', 0),
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
                'prophet': predict_result.probability_up,
                # 🐂🐻 Bullish/Bearish Perspective Analysis
                'bull_confidence': llm_decision.get('bull_perspective', {}).get('bull_confidence', 50),
                'bear_confidence': llm_decision.get('bear_perspective', {}).get('bear_confidence', 50),
                'bull_stance': llm_decision.get('bull_perspective', {}).get('stance', 'UNKNOWN'),
                'bear_stance': llm_decision.get('bear_perspective', {}).get('stance', 'UNKNOWN'),
                'bull_reasons': llm_decision.get('bull_perspective', {}).get('bullish_reasons', ''),
                'bear_reasons': llm_decision.get('bear_perspective', {}).get('bearish_reasons', '')
            }
            
            # Determine Regime from Trend Score using Semantic Converter
            trend_score_total = quant_analysis.get('trend', {}).get('total_trend_score', 0)
            regime_desc = SemanticConverter.get_trend_semantic(trend_score_total)
            
            # Determine Position details from LLM Decision
            pos_pct = llm_decision.get('position_size_pct', 0)
            if not pos_pct and llm_decision.get('position_size_usd') and self.max_position_size:
                 # Fallback: estimate pct if usd is provided
                 pos_pct = (llm_decision.get('position_size_usd') / self.max_position_size) * 100
                 # Clamp to reasonable range (仓位大小不应超过100%)
                 pos_pct = min(pos_pct, 100)
            
            # 获取真正的价格位置信息（从 regime_info）
            price_position_info = regime_info.get('position', {}) if regime_info else {}
            
            vote_result = VoteResult(
                action=llm_decision.get('action', 'wait'),
                confidence=llm_decision.get('confidence', 0) / 100.0,  # 转换为 0-1
                weighted_score=llm_decision.get('confidence', 0) - 50,  # -50 to +50
                vote_details=vote_details,
                multi_period_aligned=True,
                reason=llm_decision.get('reasoning', 'DeepSeek LLM decision'),
                regime={
                    'regime': regime_desc,
                    'confidence': llm_decision.get('confidence', 0)
                },
                position=price_position_info  # 使用真正的价格位置信息
            )
            
            # 保存完整的 LLM 交互日志 (Input, Process, Output)
            # Only save detailed logs in local mode to conserve disk space on Railway
            if os.environ.get('ENABLE_DETAILED_LLM_LOGS', 'false').lower() == 'true':
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
{llm_decision.get('system_prompt', '(Missing System Prompt)')}

[USER PROMPT]
{llm_decision.get('user_prompt', '(Missing User Prompt)')}

--------------------------------------------------------------------------------
🧠 PROCESSING (REASONING)
--------------------------------------------------------------------------------
{llm_decision.get('reasoning_detail', '(No reasoning detail)')}

--------------------------------------------------------------------------------
📥 OUTPUT (DECISION)
--------------------------------------------------------------------------------
{llm_decision.get('raw_response', '(No raw response)')}
"""
                self.saver.save_llm_log(
                    content=full_log_content,
                    symbol=self.current_symbol,
                    snapshot_id=snapshot_id,
                    cycle_id=cycle_id
                )
            
            # LOG: Bullish/Bearish Perspective (show first for adversarial context)
            bull_conf = llm_decision.get('bull_perspective', {}).get('bull_confidence', 50)
            bear_conf = llm_decision.get('bear_perspective', {}).get('bear_confidence', 50)
            bull_stance = llm_decision.get('bull_perspective', {}).get('stance', 'UNKNOWN')
            bear_stance = llm_decision.get('bear_perspective', {}).get('stance', 'UNKNOWN')
            bull_reasons = llm_decision.get('bull_perspective', {}).get('bullish_reasons', '')[:120]
            bear_reasons = llm_decision.get('bear_perspective', {}).get('bearish_reasons', '')[:120]
            global_state.add_log(f"[🐂 Long Case] [{bull_stance}] Conf={bull_conf}%")
            global_state.add_log(f"[🐻 Short Case] [{bear_stance}] Conf={bear_conf}%")
            
            # LOG: LLM Decision Engine (generic, not tied to DeepSeek)
            global_state.add_log(f"[⚖️ Final Decision] Action={vote_result.action.upper()} | Conf={llm_decision.get('confidence', 0)}%")
            
            # ✅ Decision Recording moved after Risk Audit for complete context
            # Saved to file still happens here for "raw" decision
            self.saver.save_decision(asdict(vote_result), self.current_symbol, snapshot_id, cycle_id=cycle_id)

            # 如果是观望，也需要更新状态
            if vote_result.action in ('hold', 'wait'):
                print(f"\n✅ 决策: 观望 ({vote_result.action})")
                
                # GlobalState Logging of Logic
                regime_txt = vote_result.regime.get('regime', 'Unknown') if vote_result.regime else 'Unknown'
                pos_txt = f"{min(max(vote_result.position.get('position_pct', 0), 0), 100):.0f}%" if vote_result.position else 'N/A'
                
                # GlobalState Logging of Logic
                regime_txt = vote_result.regime.get('regime', 'Unknown') if vote_result.regime else 'Unknown'
                pos_txt = f"{min(max(vote_result.position.get('position_pct', 0), 0), 100):.0f}%" if vote_result.position else 'N/A'
                
                # LOG 3: Critic (Wait Case)
                global_state.add_log(f"⚖️ DecisionCoreAgent (The Critic): Context(Regime={regime_txt}, Pos={pos_txt}) => Vote: WAIT ({vote_result.reason})")
                # Check if there's an active position
                # For now, we assume no position in test mode (can be enhanced with real position check)
                actual_action = 'wait'  # No position → wait (观望)
                # If we had a position, it would be 'hold' (持有)
                
                # Check if there's an active position
                # For now, we assume no position in test mode (can be enhanced with real position check)
                actual_action = 'wait'  # No position → wait (观望)
                # If we had a position, it would be 'hold' (持有)
                
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
                decision_dict['prophet_probability'] = predict_result.probability_up  # 🔮 Prophet
                
                # ✅ Add Semantic Analysis for Dashboard
                decision_dict['vote_analysis'] = SemanticConverter.convert_analysis_map(decision_dict.get('vote_details', {}))
                
                # 🆕 Add Four-Layer Status for Dashboard
                decision_dict['four_layer_status'] = global_state.four_layer_result
                
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
            print(f"[Step 4/5] 👮 The Guardian (Risk Audit) - Final review...")
            
            # Critic Log for Action decision
            # Step 4: 审计 - 风控守护者 (The Guardian)
            print(f"[Step 4/5] 👮 The Guardian (Risk Audit) - Final review...")
            
            # LOG 3: Critic (Action Case) - if not already logged (Wait case returns early)
            regime_txt = vote_result.regime.get('regime', 'Unknown') if vote_result.regime else 'Unknown'
            # Note: Wait case returns, so if we are here, it's an action.
            global_state.add_log(f"⚖️ DecisionCoreAgent (The Critic): Context(Regime={regime_txt}) => Vote: {vote_result.action.upper()} (Conf: {vote_result.confidence*100:.0f}%)")
            
            global_state.guardian_status = "Auditing..."
            global_state.guardian_status = "Auditing..."
            
            order_params = self._build_order_params(
                action=vote_result.action,
                current_price=current_price,
                confidence=vote_result.confidence
            )
            
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
            
            # Step 5 (Embedded in Step 4 for clean output)
            
            # 获取账户信息
            # Using _get_full_account_info helper (we will create it or inline logic)
            # Fetch directly from client to get full details
            try:
                if self.test_mode:
                    # Test Mode: Use virtual balance
                    wallet_bal = global_state.virtual_balance
                    avail_bal = global_state.virtual_balance
                    unrealized_pnl = 0.0 # Updated at end of cycle
                    
                    # Log for debugging
                    # log.info(f"Test Mode: Using virtual balance ${avail_bal}")
                    
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
            
            # 执行审计
            audit_result = await self.risk_audit.audit_decision(
                decision=order_params,
                current_position=current_position,
                account_balance=account_balance,
                current_price=current_price
            )
            
            # Update Dashboard Guardian Status
            global_state.guardian_status = "PASSED" if audit_result.passed else "BLOCKED"
            
            # LOG 4: Guardian (Single Line)
            if not audit_result.passed:
                 global_state.add_log(f"[🛡️ GUARDIAN] ❌ BLOCKED ({audit_result.blocked_reason})")
            else:
                 global_state.add_log(f"[🛡️ GUARDIAN] ✅ PASSED (Risk: {audit_result.risk_level.value})")
            
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
            decision_dict['prophet_probability'] = predict_result.probability_up  # 🔮 Prophet
            
            # ✅ Add Semantic Analysis for Dashboard
            decision_dict['vote_analysis'] = SemanticConverter.convert_analysis_map(decision_dict.get('vote_details', {}))
            
            # 🆕 Add Four-Layer Status for Dashboard
            decision_dict['four_layer_status'] = global_state.four_layer_result
            
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
            
            # Update Market Context
            if vote_result.regime:
                global_state.market_regime = vote_result.regime.get('regime', 'Unknown')
            if vote_result.position:
                # Safety clamp: ensure position_pct is 0-100
                pos_pct = min(max(vote_result.position.get('position_pct', 0), 0), 100)
                global_state.price_position = f"{pos_pct:.1f}% ({vote_result.position.get('location', 'Unknown')})"
                
            global_state.update_decision(decision_dict)
            
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
            # Step 5: 执行引擎
            if self.test_mode:
                print("\n[Step 5/5] 🧪 TestMode - 模拟执行...")
                print(f"  模拟订单: {order_params['action']} {order_params['quantity']} @ {current_price}")
                
            if self.test_mode:
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
                            
                            log.info(f"💰 [TEST] Closed {side} {self.current_symbol}: PnL=${realized_pnl:.2f}, Bal=${global_state.virtual_balance:.2f}")
                            
                            # Record trade to history
                            global_state.record_trade({
                                'symbol': self.current_symbol,
                                'action': f'CLOSE_{side}',
                                'entry_price': entry_price,
                                'exit_price': current_price,
                                'quantity': qty,
                                'pnl': realized_pnl,
                                'cycle': global_state.cycle_counter
                            })
                        else:
                            log.warning(f"⚠️ [TEST] Close ignored - No position for {self.current_symbol}")
                    
                    # Open Logic
                    elif 'long' in action_lower or 'short' in action_lower:
                        side = 'LONG' if 'long' in action_lower else 'SHORT'
                        global_state.virtual_positions[self.current_symbol] = {
                            'entry_price': current_price,
                            'quantity': order_params['quantity'],
                            'side': side,
                            'entry_time': datetime.now().isoformat(),
                            'stop_loss': order_params.get('stop_loss_price', 0),
                            'take_profit': order_params.get('take_profit_price', 0),
                            'leverage': order_params.get('leverage', 1)
                        }
                        log.info(f"💰 [TEST] Opened {side} {self.current_symbol} @ ${current_price:,.2f}")
                        
                        # Record trade to history
                        global_state.record_trade({
                            'symbol': self.current_symbol,
                            'action': f'OPEN_{side}',
                            'entry_price': current_price,
                            'quantity': order_params['quantity'],
                            'pnl': 0.0,
                            'cycle': global_state.cycle_counter
                        })

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
                        'timestamp': datetime.now().strftime("%H:%M:%S"),
                        'action': order_params['action'].upper(),
                        'symbol': self.current_symbol,
                        'price': current_price,
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
            confidence: 决策置信度
        
        Returns:
            订单参数字典
        """
        # 计算仓位大小（根据置信度调整）
        position_multiplier = min(confidence * 1.2, 1.0)  # 最高100%仓位
        adjusted_position = self.max_position_size * position_multiplier
        
        # 计算数量
        quantity = adjusted_position / current_price
        
        # 计算止损止盈
        if action == 'long':
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
            'leverage': self.leverage,
            'confidence': confidence
        }
    
    def _get_account_balance(self) -> float:
        """获取账户可用余额"""
        try:
            return self.client.get_account_balance()
        except Exception as e:
            log.error(f"Failed to get balance: {e}")
            return 0.0
    
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
    
    
    def _build_market_context(self, quant_analysis: Dict, predict_result, market_data: Dict) -> str:
        """
        构建 DeepSeek LLM 所需的市场上下文文本
        """
        # 提取关键数据
        current_price = market_data['current_price']
        
    # ... existing code ...
    from src.utils.semantic_converter import SemanticConverter
    
    # Note: _format_choppy_analysis was removed as Market Regime analysis 
    # is now handled by TREND agent and included in trend_analysis above.

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
        prob_pct = predict_result.probability_up * 100
        prophet_signal = predict_result.signal
        
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
        
        o_score_total = oscillator.get('total_oscillator_score')
        o_semantic = SemanticConverter.get_oscillator_semantic(o_score_total)
        
        s_score_total = sentiment.get('total_sentiment_score')
        s_semantic = SemanticConverter.get_sentiment_score_semantic(s_score_total)

        rsi_15m = oscillator.get('rsi_15m')
        rsi_1h = oscillator.get('rsi_1h')
        rsi_1m_semantic = SemanticConverter.get_rsi_semantic(rsi_15m)
        rsi_1h_semantic = SemanticConverter.get_rsi_semantic(rsi_1h)
        
        # MACD
        macd_15m = trend.get('details', {}).get('15m_macd_diff')
        macd_semantic = SemanticConverter.get_macd_semantic(macd_15m)
        
        oi_change = sentiment.get('oi_change_24h_pct')
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

- **MACD (15m)**: {macd_semantic} (Diff: {macd_15m if macd_15m else 'N/A'})
  - Histogram: {'Expanding ↗' if macd_15m and macd_15m > 0 else 'Contracting ↘' if macd_15m else 'N/A'}

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

        context += "\n\n## 3. Detailed Market Analysis\n"
        
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

    def run_continuous(self, interval_minutes: int = 3):
        """
        持续运行模式
        
        Args:
            interval_minutes: 运行间隔（分钟）
        """
        log.info(f"🚀 Starting continuous mode (interval: {interval_minutes}min)")
        global_state.is_running = True
        
        # Logger is configured in src.utils.logger, no need to override here.
        # Dashboard logging is handled via global_state.add_log -> log.bind(dashboard=True)

        # Start Real-time Monitors
        self.start_account_monitor()
        
        # 🔮 启动 Prophet 自动训练器 (每 2 小时重新训练)
        from src.models.prophet_model import ProphetAutoTrainer, HAS_LIGHTGBM
        if HAS_LIGHTGBM:
            # 为主交易对创建自动训练器
            primary_agent = self.predict_agents[self.primary_symbol]
            self.auto_trainer = ProphetAutoTrainer(
                predict_agent=primary_agent,
                binance_client=self.client,
                interval_hours=2.0,  # 每 2 小时训练一次
                training_days=7,     # 使用最近 7 天数据
                symbol=self.primary_symbol
            )
            self.auto_trainer.start()
        
        # 设置初始间隔 (优先使用 CLI 参数，后续 API 可覆盖)
        global_state.cycle_interval = interval_minutes
        
        log.info(f"🚀 Starting continuous trading mode (interval: {global_state.cycle_interval}m)")
        
        # 🧪 Test Mode: Initialize Virtual Account for Chart
        if self.test_mode:
            log.info("🧪 Test Mode: Initializing Virtual Account...")
            initial_balance = global_state.virtual_balance
            global_state.init_balance(initial_balance)  # Initialize balance tracking
            global_state.update_account(
                equity=initial_balance,
                available=initial_balance,
                wallet=initial_balance,
                pnl=0.0
            )
        
        try:
            while global_state.is_running:
                # Check stop state FIRST - must break before continue
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
                
                # 🧹 Clear initialization logs when Cycle 1 starts (sync with Recent Decisions)
                if cycle_num == 1:
                    global_state.clear_init_logs()
                
                # 🧪 Test Mode: Record start of cycle account state (for Net Value Curve)
                if self.test_mode:
                    # Re-log current state with new cycle number so chart shows start of cycle
                    global_state.update_account(
                        equity=global_state.account_overview['total_equity'],
                        available=global_state.account_overview['available_balance'],
                        wallet=global_state.account_overview['wallet_balance'],
                        pnl=global_state.account_overview['total_pnl']
                    )
                
                print(f"\n{'='*80}")
                print(f"🔄 Cycle #{cycle_num} | 分析 {len(self.symbols)} 个交易对")
                print(f"{'='*80}")
                global_state.add_log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
                global_state.add_log(f"[📊 SYSTEM] Cycle #{cycle_num} | {', '.join(self.symbols)}")

                # 🎯 重置周期开仓计数器
                global_state.cycle_positions_opened = 0
                
                # 🔄 多币种顺序处理: 依次分析每个交易对
                # Step 1: 收集所有交易对的决策
                all_decisions = []
                latest_prices = {}  # Store latest prices for PnL calculation
                for symbol in self.symbols:
                    self.current_symbol = symbol  # 设置当前处理的交易对
                    
                    # Use asyncio.run for the async cycle
                    result = asyncio.run(self.run_trading_cycle())
                    
                    # Capture price from global state (updated inside run_trading_cycle)
                    latest_prices[symbol] = global_state.current_price
                    
                    print(f"  [{symbol}] 结果: {result['status']}")
                    
                    # 如果是开仓决策，收集起来
                    if result.get('action') in ['open_long', 'open_short'] and result.get('status') == 'success':
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
                    
                    # 只执行最优的一个
                    # 注意：实际执行已经在 run_trading_cycle 中完成了
                    # 这里只是记录和通知
                    
                    # 如果有其他开仓机会被跳过，记录下来
                    if len(all_decisions) > 1:
                        skipped = [f"{d['symbol']}({d['confidence']:.1f}%)" for d in all_decisions[1:]]
                        print(f"  ⏭️  跳过其他机会: {', '.join(skipped)}")
                        global_state.add_log(f"⏭️  Skipped opportunities: {', '.join(skipped)} (1 position per cycle limit)")
                
                        global_state.add_log(f"⏭️  Skipped opportunities: {', '.join(skipped)} (1 position per cycle limit)")
                
                # 💰 Update Virtual Account PnL (Mark-to-Market)
                if self.test_mode:
                    self._update_virtual_account_stats(latest_prices)
                
                # Dynamic Interval: specific to new requirement
                current_interval = global_state.cycle_interval
                
                # 等待下一次检查
                print(f"\n⏳ 等待 {current_interval} 分钟...")
                
                # Sleep in chunks to allow responsive PAUSE/STOP and INTERVAL changes
                # Check every 1 second during the wait interval
                elapsed_seconds = 0
                while True:
                    # 每秒检查当前间隔设置 (支持动态调整)
                    current_interval = global_state.cycle_interval
                    wait_seconds = current_interval * 60
                    
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

def start_server():
    """Start FastAPI server in a separate thread"""
    import os
    port = int(os.getenv("PORT", 8000))
    print(f"\n🌍 Starting Web Dashboard at http://0.0.0.0:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="error")

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
    parser.add_argument('--mode', choices=['once', 'continuous'], default='once', help='运行模式')
    parser.add_argument('--interval', type=float, default=3.0, help='持续运行间隔（分钟）')
    
    args = parser.parse_args()
    
    # [NEW] Check RUN_MODE from .env (Config Manager integration)
    import os
    env_run_mode = os.getenv('RUN_MODE', 'test').lower()
    
    # Priority: Command line > Env Var
    if not args.test and env_run_mode == 'test':
        args.test = True
    elif args.test and env_run_mode == 'live':
        pass # Command line override to force test? or live? Let's say explicit CLI wins.
        
    print(f"🔧 Startup Mode: {'TEST' if args.test else 'LIVE'} (Env: {env_run_mode})")
    
    # ==============================================================================
    # 🛠️ [修复核心]：强制初始化数据库表结构
    # 只要实例化 TradingLogger，就会自动执行 _init_database() 创建 PostgreSQL 表
    # ==============================================================================
    try:
        log.info("🛠️ Checking/initializing database tables...")
        # 这一步至关重要：它会连接数据库并运行 CREATE TABLE 语句
        _db_init = TradingLogger()
        log.info("✅ Database tables ready")
    except Exception as e:
        log.error(f"❌ Database init failed (non-fatal, continuing): {e}")
        # 注意：这里我们捕获异常但不退出，以免影响主程序启动，但请务必关注日志
    # ==============================================================================
    
    # 测试模式默认 1 分钟周期，实盘模式默认 3 分钟
    if args.test and args.interval == 3.0:  # 如果是测试模式且用户没有指定间隔
        args.interval = 1.0
    
    
    # 创建机器人
    bot = MultiAgentTradingBot(
        max_position_size=args.max_position,
        leverage=args.leverage,
        stop_loss_pct=args.stop_loss,
        take_profit_pct=args.take_profit,
        test_mode=args.test
    )
    
    # 启动 Dashboard Server (Only if in continuous mode or if explicitly requested, but let's do it always for now if deps exist)
    try:
        server_thread = threading.Thread(target=start_server, daemon=True)
        server_thread.start()
    except Exception as e:
        print(f"⚠️ Failed to start Dashboard: {e}")
    
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
        # [CHANGE] Default to Stopped to require user confirmation
        global_state.execution_mode = "Stopped"
        log.info("⏸️ System ready (Stopped). Waiting for user to START from Dashboard.")
        bot.run_continuous(interval_minutes=args.interval)

if __name__ == '__main__':
    main()
