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
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '.')))

from typing import Dict, Optional
from datetime import datetime
import json
import time

from src.api.binance_client import BinanceClient
from src.execution.engine import ExecutionEngine
from src.risk.manager import RiskManager
from src.config import Config
from src.utils.logger import log
from src.utils.trade_logger import trade_logger
from src.utils.data_saver import DataSaver
from src.data.processor import MarketDataProcessor
from src.features.technical_features import TechnicalFeatureEngineer
from dataclasses import asdict

# 导入多Agent
from src.agents import (
    DataSyncAgent,
    QuantAnalystAgent,
    DecisionCoreAgent,
    RiskAuditAgent,
    PredictAgent,
    PositionInfo,
    SignalWeight
)
import threading
import uvicorn
from src.server.app import app
from src.server.state import global_state

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
        print("🤖 AI Trader - 多Agent架构版本")
        print("="*80)
        
        self.config = Config()
        self.symbol = self.config.get('trading.symbol', 'BTCUSDT')
        self.test_mode = test_mode
        
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
        
        # 初始化4大Agent
        print("\n🚀 初始化Agent...")
        self.data_sync_agent = DataSyncAgent(self.client)
        self.quant_analyst = QuantAnalystAgent()
        self.predict_agent = PredictAgent(horizon='30m')  # 🔮 预测预言家 (30分钟预测)
        self.decision_core = DecisionCoreAgent()
        self.risk_audit = RiskAuditAgent(
            max_leverage=10.0,
            max_position_pct=0.3,
            min_stop_loss_pct=0.005,
            max_stop_loss_pct=0.05
        )
        self.processor = MarketDataProcessor()  # ✅ 初始化数据处理器
        self.feature_engineer = TechnicalFeatureEngineer()  # 🔮 特征工程器 for Prophet
        
        print("  ✅ DataSyncAgent 已就绪")
        print("  ✅ QuantAnalystAgent 已就绪")
        print("  ✅ PredictAgent 已就绪")
        print("  ✅ DecisionCoreAgent 已就绪")
        print("  ✅ RiskAuditAgent 已就绪")
        
        print(f"\n⚙️  交易配置:")
        print(f"  - 交易对: {self.symbol}")
        print(f"  - 最大单笔: ${self.max_position_size:.2f} USDT")
        print(f"  - 杠杆倍数: {self.leverage}x")
        print(f"  - 止损: {self.stop_loss_pct}%")
        print(f"  - 止盈: {self.take_profit_pct}%")
        print(f"  - 测试模式: {'✅ 是' if self.test_mode else '❌ 否'}")
        
        # ✅ Load initial trade history
        recent_trades = self.saver.get_recent_trades(limit=20)
        global_state.trade_history = recent_trades
        print(f"  📜 已加载 {len(recent_trades)} 条历史交易记录")
    


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
        print(f"🔄 启动交易审计循环 | {datetime.now().strftime('%H:%M:%S')} | {self.symbol}")
        print(f"{'='*80}")
        
        # Update Dashboard Status
        global_state.is_running = True
        # Removed verbose log: Starting trading cycle
        
        try:
            # ✅ Increment cycle counter and generate cycle ID
            global_state.cycle_counter += 1
            cycle_num = global_state.cycle_counter
            cycle_id = f"cycle_{cycle_num:04d}_{int(time.time())}"
            global_state.current_cycle_id = cycle_id
            
            print(f"🔄 Cycle #{cycle_num} | ID: {cycle_id}")
            global_state.add_log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            global_state.add_log(f"🔄 Cycle #{cycle_num} started | ID: {cycle_id}")
            
            # ✅ Generate snapshot_id for this cycle (legacy compatibility)
            snapshot_id = f"snap_{int(time.time())}"

            # Step 1: 采样 - 数据先知 (The Oracle)
            print("\n[Step 1/4] 🕵️ 数据先知 (The Oracle) - 异步数据采集...")
            global_state.oracle_status = "Fetching Data..." 
            market_snapshot = await self.data_sync_agent.fetch_all_timeframes(self.symbol)
            global_state.oracle_status = "Data Ready"

            # ✅ Save Market Data & Process Indicators
            processed_dfs = {}
            for tf in ['5m', '15m', '1h']:
                raw_klines = getattr(market_snapshot, f'raw_{tf}')
                # 保存原始数据
                self.saver.save_market_data(raw_klines, self.symbol, tf)
                
                # 处理并保存指标 (Process indicators)
                df_with_indicators = self.processor.process_klines(raw_klines, self.symbol, tf)
                self.saver.save_indicators(df_with_indicators, self.symbol, tf, snapshot_id)
                
                # 提取并保存特征 (Extract features)
                features_df = self.processor.extract_feature_snapshot(df_with_indicators)
                self.saver.save_features(features_df, self.symbol, tf, snapshot_id)
                
                # 存入字典供后续步骤复用
                processed_dfs[tf] = df_with_indicators
                
            # ✅ 重要优化：更新快照中的 DataFrame，使其携带技术指标
            # 这样 QuantAnalystAgent 内部就不需要再次计算指标了
            market_snapshot.stable_5m = processed_dfs['5m']
            market_snapshot.stable_15m = processed_dfs['15m']
            market_snapshot.stable_1h = processed_dfs['1h']
            
            current_price = market_snapshot.live_5m.get('close')
            print(f"  ✅ 采样完毕: ${current_price:,.2f} ({market_snapshot.timestamp.strftime('%H:%M:%S')})")
            
            # LOG 1: Oracle (Single Line)
            global_state.add_log(f"🕵️ DataSyncAgent (The Oracle): Action=Fetch[5m,15m,1h] | Snapshot=${current_price:,.2f}")
            
            # Update Dashboard Market Data (Initial)
            global_state.current_price = current_price
            
            # Step 2: 假设 - 量化策略师 (The Strategist)
            print("[Step 2/4] 👨‍🔬 量化策略师 (The Strategist) - 评估数据中...")
            # Removed verbose log: Strategist analyzing
            quant_analysis = await self.quant_analyst.analyze_all_timeframes(market_snapshot)
            
            # Update Dashboard Strategist Score
            s_score = quant_analysis['comprehensive']['score']
            global_state.strategist_score = s_score
            
            # --- Detailed Multi-Agent Logging ---
            # --- Single Line Strategist Log ---
            # Trend
            t_res = quant_analysis.get('trend', {})
            t_score = t_res.get('total_trend_score', 0)
            t_str = f"Trend({t_res.get('1h_trend','N/A')},{t_score})"
            
            # Oscillator
            o_res = quant_analysis.get('oscillator', {})
            o_score = o_res.get('total_oscillator_score', 0)
            o_str = f"Osc(RSI:{o_res.get('rsi_15m',0):.0f},{o_score})"

            # Sentiment
            s_res = quant_analysis.get('sentiment', {})
            sent_score = s_res.get('total_sentiment_score', 0)
            s_str = f"Sent(OI:{s_res.get('oi_change_24h_pct',0):.1f}%,{sent_score})"
            
            # LOG 2: Strategist
            global_state.add_log(f"👨‍🔬 QuantAnalystAgent (The Strategist): {t_str} | {o_str} | {s_str} => Score: {s_score:.0f}/100")
            
            # ✅ Save Quant Analysis (Analytics)
            self.saver.save_context(quant_analysis, self.symbol, 'analytics', snapshot_id)
            
            # Step 2.5: 预测 - 预测预言家 (The Prophet)
            print("[Step 2.5/5] 🔮 预测预言家 (The Prophet) - 计算上涨概率...")
            
            # 使用 15m 数据构建高级特征供预测
            df_15m_features = self.feature_engineer.build_features(processed_dfs['15m'])
            
            # 提取最新行的特征值作为字典
            if not df_15m_features.empty:
                latest_features = df_15m_features.iloc[-1].to_dict()
                # 过滤非数值类型
                predict_features = {k: v for k, v in latest_features.items() 
                                   if isinstance(v, (int, float)) and not isinstance(v, bool)}
            else:
                predict_features = {}
            
            # 调用 PredictAgent
            predict_result = await self.predict_agent.predict(predict_features)
            
            # 更新全局状态
            global_state.prophet_probability = predict_result.probability_up
            
            # 保存预测结果（包含输入特征）
            # 转换 numpy 类型为 Python 原生类型
            import numpy as np
            def to_serializable(obj):
                if isinstance(obj, np.integer):
                    return int(obj)
                elif isinstance(obj, np.floating):
                    return float(obj)
                elif isinstance(obj, np.ndarray):
                    return obj.tolist()
                elif isinstance(obj, dict):
                    return {k: to_serializable(v) for k, v in obj.items()}
                elif isinstance(obj, list):
                    return [to_serializable(v) for v in obj]
                else:
                    return obj

            prediction_record = {
                'input_features': predict_features,  # 记录输入特征
                'output': predict_result.to_dict()   # 预测输出
            }
            # 彻底转换整个字典
            prediction_record = to_serializable(prediction_record)
            self.saver.save_prediction(prediction_record, self.symbol, snapshot_id)
            
            # LOG 2.5: Prophet
            prob_pct = predict_result.probability_up * 100
            prob_symbol = "📈" if prob_pct > 55 else ("📉" if prob_pct < 45 else "➡️")
            global_state.add_log(f"🔮 PredictAgent (The Prophet): {prob_symbol} P(Up)={prob_pct:.1f}% | Signal: {predict_result.signal} | Conf: {predict_result.confidence:.0%}")
            
            print(f"  ✅ 预测完毕: P(上涨)={prob_pct:.1f}%, 信号={predict_result.signal}")
            
            # Step 3: 对抗 - 对抗评论员 (The Critic)
            print("[Step 3/5] ⚖️ 对抗评论员 (The Critic) - 极速审理信号...")
            # LOG 3: Critic (Log later after decision)
            # ✅ 复用 Step 1 已处理的数据，避免第三次计算
            market_data = {
                'df_5m': processed_dfs['5m'],
                'df_15m': processed_dfs['15m'],
                'df_1h': processed_dfs['1h'],
                'current_price': current_price
            }
            
            vote_result = await self.decision_core.make_decision(
                quant_analysis,
                market_data=market_data
            )
            
            # ✅ Decision Recording moved after Risk Audit for complete context
            # Saved to file still happens here for "raw" decision
            self.saver.save_decision(asdict(vote_result), self.symbol, snapshot_id, cycle_id=cycle_id)
            
            # ✅ Generate and Save LLM Context (LLM Logs)
            # 记录输入给决策引擎的完整上下文以及最终投票结果
            llm_context = self.decision_core.to_llm_context(
                vote_result=vote_result, 
                quant_analysis=quant_analysis
            )
            self.saver.save_llm_log(
                content=f"PROMPT: N/A (Agent Voting Consensus)\n\n{llm_context}",
                symbol=self.symbol,
                snapshot_id=snapshot_id
            )
            

            # 如果是观望，也需要更新状态
            if vote_result.action == 'hold':
                print("\n✅ 决策: 观望")
                
                # GlobalState Logging of Logic
                regime_txt = vote_result.regime.get('regime', 'Unknown') if vote_result.regime else 'Unknown'
                pos_txt = f"{vote_result.position.get('position_pct', 0):.0f}%" if vote_result.position else 'N/A'
                
                # GlobalState Logging of Logic
                regime_txt = vote_result.regime.get('regime', 'Unknown') if vote_result.regime else 'Unknown'
                pos_txt = f"{vote_result.position.get('position_pct', 0):.0f}%" if vote_result.position else 'N/A'
                
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
                decision_dict['symbol'] = self.symbol
                decision_dict['timestamp'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                decision_dict['cycle_number'] = global_state.cycle_counter
                decision_dict['cycle_id'] = global_state.current_cycle_id
                # Add implicit safe risk for Wait/Hold
                decision_dict['risk_level'] = 'safe'
                decision_dict['guardian_passed'] = True
                decision_dict['prophet_probability'] = predict_result.probability_up  # 🔮 Prophet
                
                # Update Market Context
                if vote_result.regime:
                    global_state.market_regime = vote_result.regime.get('regime', 'Unknown')
                if vote_result.position:
                    global_state.price_position = f"{vote_result.position.get('position_pct', 0):.1f}% ({vote_result.position.get('location', 'Unknown')})"
                    
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
            print(f"[Step 4/5] 👮 风控守护者 (The Guardian) - 进行终审...")
            
            # Critic Log for Action decision
            # Step 4: 审计 - 风控守护者 (The Guardian)
            print(f"[Step 4/5] 👮 风控守护者 (The Guardian) - 进行终审...")
            
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
            
            print(f"  ✅ 信号方向: {vote_result.action}")
            print(f"  ✅ 综合信心: {vote_result.confidence:.1f}%")
            if vote_result.regime:
                print(f"  📊 市场状态: {vote_result.regime['regime']}")
            if vote_result.position:
                print(f"  📍 价格位置: {vote_result.position['position_pct']:.1f}% ({vote_result.position['location']})")
            
            # 将对抗式上下文注入订单参数，以便风控审计使用
            order_params['regime'] = vote_result.regime
            order_params['position'] = vote_result.position
            order_params['confidence'] = vote_result.confidence
            
            # Step 5 (Embedded in Step 4 for clean output)
            
            # 获取账户信息
            # Using _get_full_account_info helper (we will create it or inline logic)
            # Fetch directly from client to get full details
            try:
                acc_info = self.client.get_futures_account()
                # acc_info keys: 'totalWalletBalance', 'totalUnrealizedProfit', 'availableBalance', etc.
                wallet_bal = float(acc_info.get('totalWalletBalance', 0))
                unrealized_pnl = float(acc_info.get('totalUnrealizedProfit', 0))
                avail_bal = float(acc_info.get('availableBalance', 0))
                total_equity = wallet_bal + unrealized_pnl
                
                # Update State
                global_state.update_account(
                    equity=total_equity,
                    available=avail_bal,
                    wallet=wallet_bal,
                    pnl=unrealized_pnl
                )
                
                account_balance = avail_bal # For backward compatibility with audit
            except Exception as e:
                log.error(f"Failed to fetch account info: {e}")
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
                 global_state.add_log(f"🛡️ RiskAuditAgent (The Guardian): Result: ❌ BLOCKED ({audit_result.blocked_reason})")
            else:
                 warn_txt = f" | Corrections: {audit_result.corrections}" if audit_result.corrections else ""
                 global_state.add_log(f"🛡️ RiskAuditAgent (The Guardian): Result: ✅ PASSED (Risk: {audit_result.risk_level.value}){warn_txt}")
            
            # ✅ Update Global State with FULL Decision info (Vote + Audit)
            decision_dict = asdict(vote_result)
            decision_dict['symbol'] = self.symbol
            decision_dict['timestamp'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            decision_dict['cycle_number'] = global_state.cycle_counter
            decision_dict['cycle_id'] = global_state.current_cycle_id
            
            # Inject Risk Data
            decision_dict['risk_level'] = audit_result.risk_level.value
            decision_dict['guardian_passed'] = audit_result.passed
            decision_dict['guardian_reason'] = audit_result.blocked_reason
            decision_dict['prophet_probability'] = predict_result.probability_up  # 🔮 Prophet
            
            # Update Market Context
            if vote_result.regime:
                global_state.market_regime = vote_result.regime.get('regime', 'Unknown')
            if vote_result.position:
                global_state.price_position = f"{vote_result.position.get('position_pct', 0):.1f}% ({vote_result.position.get('location', 'Unknown')})"
                
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
                    'order_params': order_params
                },
                symbol=self.symbol,
                snapshot_id=snapshot_id
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
                    }
                }
            # Step 5: 执行引擎
            if self.test_mode:
                print("\n[Step 5/5] 🧪 TestMode - 模拟执行...")
                print(f"  模拟订单: {order_params['action']} {order_params['quantity']} @ {current_price}")
                
            if self.test_mode:
                print("\n[Step 5/5] 🧪 TestMode - 模拟执行...")
                print(f"  模拟订单: {order_params['action']} {order_params['quantity']} @ {current_price}")
                
                # LOG 5: Executor (Test)
                global_state.add_log(f"🚀 ExecutionEngine (The Executor): Mode=Test => Command: {order_params['action'].upper()} {order_params['quantity']} @ {current_price:.2f}")

                 # ✅ Save Execution (Simulated)
                self.saver.save_execution({
                    'symbol': self.symbol,
                    'action': 'SIMULATED_EXECUTION',
                    'params': order_params,
                    'status': 'success',
                    'timestamp': datetime.now().isoformat()
                }, self.symbol)
                
                # ✅ Save Trade in persistent history
                trade_record = {
                    'action': order_params['action'].upper(),
                    'symbol': self.symbol,
                    'price': current_price,
                    'quantity': order_params['quantity'],
                    'cost': current_price * order_params['quantity'],
                    'exit_price': 0,
                    'pnl': 0,
                    'confidence': order_params['confidence'],
                    'status': 'SIMULATED'
                }
                self.saver.save_trade(trade_record)
                
                # Update Global State History
                global_state.trade_history.insert(0, trade_record)
                if len(global_state.trade_history) > 50:
                    global_state.trade_history.pop()
                
                return {
                    'status': 'success',
                    'action': vote_result.action,
                    'details': order_params
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
                    global_state.add_log(f"🚀 ExecutionEngine (The Executor): Mode=Live | Command={order_params['action'].upper()} {order_params['quantity']} => Result: {status_icon} {status_txt}")
                        
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
                'symbol': self.symbol,
                'action': 'REAL_EXECUTION',
                'params': order_params,
                'status': 'success' if executed else 'failed',
                'timestamp': datetime.now().isoformat()
            }, self.symbol)
            
            if executed:
                print("  ✅ 订单执行成功!")
                global_state.add_log(f"✅ Order: {order_params['action'].upper()} {order_params['quantity']} @ ${order_params['price']}")
                
                # 记录交易日志
                trade_logger.log_open_position(
                    symbol=self.symbol,
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
                trade_record = {
                    'action': order_params['action'].upper(),
                    'symbol': self.symbol,
                    'price': entry_price,
                    'quantity': order_params['quantity'],
                    'cost': entry_price * order_params['quantity'],
                    'exit_price': exit_price,
                    'pnl': pnl,
                    'confidence': order_params['confidence'],
                    'status': 'EXECUTED'
                }
                self.saver.save_trade(trade_record)
                
                # Update Global State History
                global_state.trade_history.insert(0, trade_record)
                if len(global_state.trade_history) > 50:
                    global_state.trade_history.pop()
                
                return {
                    'status': 'success',
                    'action': vote_result.action,
                    'details': order_params
                }
            else:
                print("  ❌ 订单执行失败")
                global_state.add_log(f"❌ Order Failed: {order_params['action'].upper()}")
                return {
                    'status': 'failed',
                    'action': vote_result.action,
                    'details': {'error': 'execution_failed'}
                }
        
        except Exception as e:
            log.error(f"计交易循环异常: {e}", exc_info=True)
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
            log.error(f"获取余额失败: {e}")
            return 0.0
    
    def _get_current_position(self) -> Optional[PositionInfo]:
        """获取当前持仓"""
        try:
            pos = self.client.get_futures_position(self.symbol)
            if pos and abs(pos['position_amt']) > 0:
                return PositionInfo(
                    symbol=self.symbol,
                    side='long' if pos['position_amt'] > 0 else 'short',
                    entry_price=pos['entry_price'],
                    quantity=abs(pos['position_amt']),
                    unrealized_pnl=pos['unrealized_profit']
                )
            return None
        except Exception as e:
            log.error(f"获取持仓失败: {e}")
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
                symbol=self.symbol,
                leverage=order_params['leverage']
            )
            
            # 市价开仓
            side = 'BUY' if order_params['action'] == 'long' else 'SELL'
            order = self.client.place_futures_market_order(
                symbol=self.symbol,
                side=side,
                quantity=order_params['quantity']
            )
            
            if not order:
                return False
            
            # 设置止损止盈
            self.execution_engine.set_stop_loss_take_profit(
                symbol=self.symbol,
                position_side='LONG' if order_params['action'] == 'long' else 'SHORT',
                stop_loss=order_params['stop_loss'],
                take_profit=order_params['take_profit']
            )
            
            return True
            
        except Exception as e:
            log.error(f"订单执行失败: {e}", exc_info=True)
            return False
    
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
        return {
            'decision_core': self.decision_core.get_statistics(),
            'risk_audit': self.risk_audit.get_audit_report(),
        }

    def start_account_monitor(self):
        """Start a background thread to monitor account equity in real-time"""
        def _monitor():
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
                except Exception as e:
                    log.error(f"Account Monitor Error: {e}")
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
        log.info(f"🚀 启动持续运行模式 (间隔: {interval_minutes}分钟)")
        global_state.is_running = True
        
        # Logger is configured in src.utils.logger, no need to override here.
        # Dashboard logging is handled via global_state.add_log -> log.bind(dashboard=True)

        # Start Real-time Monitors
        self.start_account_monitor()
        
        # 🔮 启动 Prophet 自动训练器 (每 2 小时重新训练)
        from src.models.prophet_model import ProphetAutoTrainer, HAS_LIGHTGBM
        if HAS_LIGHTGBM:
            self.auto_trainer = ProphetAutoTrainer(
                predict_agent=self.predict_agent,
                binance_client=self.client,
                interval_hours=2.0,  # 每 2 小时训练一次
                training_days=7,     # 使用最近 7 天数据
                symbol=self.symbol
            )
            self.auto_trainer.start()
        
        # 设置初始间隔 (优先使用 CLI 参数，后续 API 可覆盖)
        global_state.cycle_interval = interval_minutes
        
        log.info(f"🚀 启动持续交易模式 (间隔: {global_state.cycle_interval}m)")
        
        try:
            while global_state.is_running:
                # Check pause state
                if global_state.execution_mode == 'Paused':
                    time.sleep(1)
                    continue
                
                if global_state.execution_mode == 'Stopped':
                    break

                # Use asyncio.run for the async cycle
                result = asyncio.run(self.run_trading_cycle())
                
                print(f"\n循环结果: {result['status']}")
                
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
                             global_state.add_log(f"⏳ Waiting next cycle... ({remaining}m)")

                    time.sleep(1)
                    elapsed_seconds += 1
                
        except KeyboardInterrupt:
            print(f"\n\n⚠️  收到停止信号，退出...")
            global_state.is_running = False

def start_server():
    """Start FastAPI server in a separate thread"""
    print("\n🌍 Starting Web Dashboard at http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="error")

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
    parser.add_argument('--interval', type=int, default=3, help='持续运行间隔（分钟）')
    
    args = parser.parse_args()
    
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
        bot.run_continuous(interval_minutes=args.interval)

if __name__ == '__main__':
    main()
