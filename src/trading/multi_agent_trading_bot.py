import os
import time
import asyncio
import threading
import logging

from datetime import datetime
from dotenv import load_dotenv
from typing import Dict, Optional, List, Any

from src.config import Config

from src.strategy.llm_engine import StrategyEngine
from src.api.binance_client import BinanceClient
from src.execution.engine import ExecutionEngine
from src.risk.manager import RiskManager
from src.utils.data_saver import DataSaver
from src.exchanges import AccountManager, ExchangeAccount, ExchangeType  # ✅ Multi-Account Support
from src.agents.contracts import SuggestedTrade
from src.agents.runtime_events import emit_global_runtime_event
from src.utils.helper import get_current_position, get_position_1h_veto_reason
from src.agents.agent_provider import AgentProvider

from src.utils.logger import log
from src.server.state import global_state

from .cycle_context import CycleContext
from .symbol_manager import SymbolManager
from .ai500_updater import Ai500Updater  # ✅ AI500 Dynamic Updater
from .trading_parameters import TradingParameters
from .headless_filter import HeadlessFilter

from src.runners import RunnerFactory

from src.utils.action_protocol import (
    normalize_action,
    is_open_action,
    is_passive_action,
)


class MultiAgentTradingBot:
    """
    多Agent交易机器人 (重构版)
    
    工作流程:
    1. DataSyncAgent: 异步采集5m/15m/1h数据
    2. QuantAnalystAgent: 生成量化信号（趋势+震荡）
    3. DecisionCoreAgent: 加权投票决策
    4. RiskAuditAgent: 风控审计拦截
    5. ExecutionEngine: 执行交易
    """
    
    def __init__(
        self,
        trading_parameters: TradingParameters
    ):
        """
        初始化多Agent交易机器人
        
        Args:
            max_position_size: 最大单笔金额 (USDT)
            leverage: 杠杆倍数
            stop_loss_pct: 止损百分比
            take_profit_pct: 止盈百分比
            test_mode: 测试模式（不执行真实交易）
        """
        print("\n" + "="*80)
        print(f"🤖 AI Trader - DeepSeek LLM Decision Mode")
        print("="*80)

        self.trading_parameters = trading_parameters

        self._headless_mode = False
        self._headless_filter = HeadlessFilter()
        
        self.config = Config()
        self.client = BinanceClient(test_mode=trading_parameters.test_mode)

        global_state.is_test_mode = trading_parameters.test_mode  # Set test mode in global state
        global_state.mode_switch_handler = self.switch_runtime_mode

        # Cycle logging (DB)
        self._cycle_logger = None
        self._last_cycle_realized_pnl = 0.0
        
        # 初始化客户端
        self.risk_manager = RiskManager()
        self.execution_engine = ExecutionEngine(self.client, self.risk_manager)
        self.saver = DataSaver() # ✅ 初始化 Multi-Agent 数据保存器
        
        # 🧹 启动时清除历史实盘数据，只保留当前周期
        self.saver.clear_live_data()

        # 💰 Persistent Virtual Account (Test Mode)
        if self.trading_parameters.test_mode:
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

        self.agent_provider = AgentProvider(
            self.config, 
            self.agent_config,
            self.client
        )
        
        # Symbol manager and ai500 updater
        self.symbol_manager = SymbolManager(
            self.config,
            self.agent_config,
            self.client,
            self.agent_provider,
            trading_parameters.test_mode)
        self.ai500_updater = Ai500Updater(self.symbol_manager, self.agent_provider)  # ✅ AI500 Updater

        self.agent_provider.initialize(self.symbol_manager.symbols)
        
        # 🧠 DeepSeek 决策引擎
        print("[DEBUG] Creating StrategyEngine...")
        self.strategy_engine = StrategyEngine()
        print("[DEBUG] StrategyEngine created")
        if self.strategy_engine.is_ready:
            print("  ✅ DeepSeek StrategyEngine ready")
        else:
            print("  ⚠️ DeepSeek StrategyEngine not ready (Awaiting API Key)")

        self.runner_factory = RunnerFactory(
            self.config,
            self.agent_config,
            self.client,
            self.agent_provider,
            self.strategy_engine,
            self.saver,
            self.trading_parameters
        )
        
        print(f"\n⚙️  Trading Config:")
        print(f"  - Symbols: {', '.join(self.symbol_manager.symbols)}")
        print(f"  - Max Position: ${trading_parameters.max_position_size:.2f} USDT")
        print(f"  - Leverage: {trading_parameters.leverage}x")
        print(f"  - Stop Loss: {trading_parameters.stop_loss_pct}%")
        print(f"  - Take Profit: {trading_parameters.take_profit_pct}%")
        print(f"  - Kline Limit: {trading_parameters.kline_limit}")
        print(f"  - Test Mode: {'✅ Yes' if trading_parameters.test_mode else '❌ No'}")
        
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
            # 1. Collect LLM Engine info (Decision Core)
            llm_info = {
                "provider": getattr(self.strategy_engine, 'provider', 'None'),
                "model": getattr(self.strategy_engine, 'model', 'None')
            }
            global_state.llm_info = llm_info
            
            # 2. Collect System Prompts
            prompts = {}
            
            # Decision Core Prompt
            prompts["decision_core"] = self.strategy_engine.get_system_prompt()
            
            # Trend Agent
            try:
                prompt = self.agent_provider.trend_agent.get_system_prompt()
                if prompt:
                    prompts["trend_agent"] = prompt
            except Exception: pass
            
            # Setup Agent
            try:
                prompt = self.agent_provider.setup_agent.get_system_prompt()
                if prompt:
                    prompts["setup_agent"] = prompt
            except Exception: pass
            
            # Trigger Agent
            try:
                prompt = self.agent_provider.trigger_agent.get_system_prompt()
                if prompt:
                    prompts["trigger_agent"] = prompt
            except Exception: pass
            
            # Reflection Agent
            if self.agent_provider.reflection_agent:
                prompt = self.agent_provider.reflection_agent.get_system_prompt()
                if prompt:
                    prompts["reflection_agent"] = prompt
            
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

        need_reload = self.symbol_manager.reload_symbols(self.config)
            
        if need_reload:
            # Refresh LLM metadata in case config changed
            self._update_llm_metadata()
    
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
        if self.trading_parameters.test_mode:
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
        normalized_agents = self.agent_config.get_enabled_agents()
        self._last_agent_config = dict(normalized_agents)
        global_state.agent_config = normalized_agents

        self.agent_provider.reload(self.client)

    async def resolve_auto3_symbols(self):
        """
        🔝 AUTO3 Dynamic Resolution via Backtest
        
        Gets AI500 Top 5 by volume, backtests each, and selects top 2
        """
        selector = self.agent_provider.symbol_selector_agent
        account_equity = self.client.get_account_equity_estimate()
        if hasattr(selector, 'account_equity') and account_equity:
            selector.account_equity = account_equity
        top3 = await selector.select_top3(force_refresh=False, account_equity=account_equity)
        
        log.info(f"🔝 AUTO3 resolved to: {', '.join(top3)}")
        return top3

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
                    testnet=testnet or self.trading_parameters.test_mode
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
    
    def _begin_cycle_context(self, analyze_only: bool) -> CycleContext:
        """Initialize cycle-scoped context and emit system-start observability."""
        if self._headless_mode:
            self._terminal_display.print_log(f"🔍 Analyzing {self.symbol_manager.current_symbol}...", "INFO")
        else:
            print(f"\n{'='*80}")
            print(f"🔄 启动交易审计循环 | {datetime.now().strftime('%H:%M:%S')} | {self.symbol_manager.current_symbol}")
            print(f"{'='*80}")

        global_state.is_running = True
        global_state.current_symbol = self.symbol_manager.current_symbol    # maybe not needed
        run_id = f"run_{int(time.time() * 1000)}:{self.symbol_manager.current_symbol}"

        cycle_num = global_state.cycle_counter
        cycle_id = global_state.current_cycle_id
        run_id = f"{cycle_id}:{self.symbol_manager.current_symbol}" if cycle_id else run_id
        snapshot_id = f"snap_{int(time.time())}"
        
        context = CycleContext(
            run_id=run_id,
            cycle_id=cycle_id,
            snapshot_id=snapshot_id,
            cycle_num=cycle_num,
            symbol=self.symbol_manager.current_symbol,
            analyze_only=analyze_only
        )
    
        emit_global_runtime_event(
            context,
            stream="lifecycle",
            agent="system",
            phase="start",
            data={"cycle": cycle_num, "symbol": self.symbol_manager.current_symbol}
        )

        global_state.add_log(f"[📊 SYSTEM] {self.symbol_manager.current_symbol} analysis started")
        global_state.agent_messages = [msg for msg in global_state.agent_messages if msg.get('symbol') != self.symbol_manager.current_symbol]

        return context

    async def _run_trading_cycle(self, analyze_only: bool = False) -> Dict:
        """
        执行完整的交易循环（异步版本）
        Returns:
            {
                'status': 'success/failed/wait/blocked/suggested',
                'action': 'open_long/open_short/close_long/close_short/wait/hold',
                'details': {...}
            }
        """
        cycle_context = self._begin_cycle_context(analyze_only)
        try:
            return await self.runner_factory.cycle_pipeline_runner.run(cycle_context, self._headless_mode)
        
        except Exception as e:
            log.error(f"Trading cycle exception: {e}", exc_info=True)
            global_state.add_log(f"Error: {e}")
            emit_global_runtime_event(
                cycle_context,
                stream="error",
                agent="system",
                phase="error",
                data={"status": "error", "error": str(e)}
            )
            return {
                'status': 'error',
                'details': {'error': str(e)}
            }
    
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
        cycle_id: Optional[str],
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

        if self.trading_parameters.test_mode:
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

    def _execute_suggested_open_trade(self, symbol: str, suggested: Any, cycle_id: Optional[str]) -> Dict:
        """Execute an already-audited open suggestion without re-running full analysis."""
        if isinstance(suggested, SuggestedTrade):
            suggestion_symbol = suggested.symbol
            order_params = dict(suggested.order_params or {})
            suggested_price = suggested.current_price
        else:
            suggestion_symbol = symbol
            order_params = dict((suggested or {}).get('order_params') or {})
            suggested_price = (suggested or {}).get('current_price')

        if not order_params:
            return {'status': 'failed', 'action': 'wait', 'details': {'error': 'missing_order_params'}}

        action = normalize_action(order_params.get('action'))
        if not is_open_action(action):
            return {'status': 'failed', 'action': action, 'details': {'error': 'not_open_action'}}

        order_params['action'] = action
        order_params['symbol'] = suggestion_symbol
        self.symbol_manager.current_symbol = suggestion_symbol

        try:
            current_price = float(
                suggested_price
                or order_params.get('entry_price')
                or global_state.current_price.get(suggestion_symbol, 0)
                or 0
            )
        except (TypeError, ValueError):
            current_price = 0.0
        if current_price <= 0:
            return {'status': 'failed', 'action': action, 'details': {'error': 'invalid_price'}}
        
        veto_reason = get_position_1h_veto_reason(order_params)
        if veto_reason:
            global_state.add_log(f"[🛡️ EXECUTION_VETO] {suggestion_symbol} {action}: {veto_reason}")
            return {'status': 'blocked', 'action': action, 'details': {'reason': veto_reason, 'stage': 'suggested_execution_gate'}}

        if self.trading_parameters.test_mode:
            side = 'LONG' if action == 'open_long' else 'SHORT'
            quantity = float(order_params.get('quantity', 0) or 0)
            position_value = quantity * current_price
            global_state.virtual_positions[suggestion_symbol] = {
                'entry_price': current_price,
                'quantity': quantity,
                'side': side,
                'entry_time': datetime.now().isoformat(),
                'stop_loss': order_params.get('stop_loss', 0),
                'take_profit': order_params.get('take_profit', 0),
                'leverage': order_params.get('leverage', 1),
                'position_value': position_value,
            }
            self._save_virtual_state()

            self.saver.save_execution({
                'symbol': suggestion_symbol,
                'action': 'SIMULATED_EXECUTION',
                'params': order_params,
                'status': 'success',
                'timestamp': datetime.now().isoformat(),
                'cycle_id': cycle_id,
            }, suggestion_symbol, cycle_id=cycle_id)

            trade_record = {
                'open_cycle': global_state.cycle_counter,
                'close_cycle': 0,
                'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                'action': action.upper(),
                'symbol': suggestion_symbol,
                'entry_price': current_price,
                'quantity': quantity,
                'cost': position_value,
                'exit_price': 0,
                'pnl': 0.0,
                'confidence': order_params.get('confidence'),
                'status': 'SIMULATED',
                'cycle': cycle_id,
            }
            self.saver.save_trade(trade_record)
            global_state.trade_history.insert(0, trade_record)
            if len(global_state.trade_history) > 50:
                global_state.trade_history.pop()
            global_state.cycle_positions_opened += 1
            global_state.add_log(f"[🚀 EXECUTOR] Test: {action.upper()} {quantity} @ {current_price:.2f}")
            return {'status': 'success', 'action': action, 'details': order_params, 'current_price': current_price}

        is_success = self._execute_order(order_params)
        self.saver.save_execution({
            'symbol': symbol,
            'action': 'REAL_EXECUTION',
            'params': order_params,
            'status': 'success' if is_success else 'failed',
            'timestamp': datetime.now().isoformat(),
            'cycle_id': cycle_id,
        }, suggestion_symbol, cycle_id=cycle_id)

        if not is_success:
            global_state.add_log(f"[🚀 EXECUTOR] Live: {action.upper()} => ❌ FAILED")
            return {'status': 'failed', 'action': action, 'details': {'error': 'execution_failed'}}

        quantity = float(order_params.get('quantity', 0) or 0)
        trade_record = {
            'open_cycle': global_state.cycle_counter,
            'close_cycle': 0,
            'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            'action': action.upper(),
            'symbol': suggestion_symbol,
            'entry_price': current_price,
            'quantity': quantity,
            'cost': current_price * quantity,
            'exit_price': 0,
            'pnl': 0.0,
            'confidence': order_params.get('confidence'),
            'status': 'EXECUTED',
            'cycle': cycle_id,
        }
        self.saver.save_trade(trade_record)
        global_state.trade_history.insert(0, trade_record)
        if len(global_state.trade_history) > 50:
            global_state.trade_history.pop()
        global_state.cycle_positions_opened += 1
        global_state.add_log(f"[🚀 EXECUTOR] Live: {action.upper()} {quantity} => ✅ SENT")
        return {'status': 'success', 'action': action, 'details': order_params, 'current_price': current_price}
    
    def _execute_order(self, order_params: Dict) -> bool:
        """
        执行订单
        
        Args:
            order_params: 订单参数
        
        Returns:
            是否成功
        """
        try:
            current_pos = get_current_position(self.client, self.symbol_manager.current_symbol, self.trading_parameters.test_mode)
            pos_side = current_pos.side if current_pos else None
            action = normalize_action(order_params.get('action'), position_side=pos_side)
            order_params['action'] = action

            if is_passive_action(action):
                return True

            # 设置杠杆
            self.client.set_leverage(
                symbol=self.symbol_manager.current_symbol,
                leverage=order_params['leverage']
            )
            
            # 市价开仓
            if action == 'open_long':
                side = 'BUY'
            elif action == 'open_short':
                side = 'SELL'
            elif action == 'close_long':
                side = 'SELL'
            elif action == 'close_short':
                side = 'BUY'
            else:
                return False
            order = self.client.place_futures_market_order(
                symbol=self.symbol_manager.current_symbol,
                side=side,
                quantity=order_params['quantity']
            )
            
            if not order:
                return False
            
            # 仅开仓动作设置止损止盈
            if action in ('open_long', 'open_short'):
                self.execution_engine.set_stop_loss_take_profit(
                    symbol=self.symbol_manager.current_symbol,
                    position_side='LONG' if action == 'open_long' else 'SHORT',
                    stop_loss=order_params['stop_loss'],
                    take_profit=order_params['take_profit']
                )
            
            return True
            
        except Exception as e:
            log.error(f"Order execution failed: {e}", exc_info=True)
            return False

# ... locating where vote_result is processed to add semantic analysis

    def run_once(self) -> Dict:
        """运行一次交易循环（同步包装）"""
        result = asyncio.run(self._run_trading_cycle())
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
            'risk_audit': self.agent_provider.risk_audit_agent.get_audit_report(),
        }
        # DeepSeek 模式下没有 decision_core
        if hasattr(self, 'strategy_engine'):
            # self.strategy_engine 目前没有 get_statistics 方法，但可以返回基本信息
            stats['strategy_engine'] = {
                'provider': self.strategy_engine.provider,
                'model': self.strategy_engine.model
            }
        return stats

    def switch_runtime_mode(self, target_mode: str, force_refresh: bool = False) -> Dict[str, Any]:
        """Switch test/live mode at runtime, or force refresh current mode account state."""
        mode = (target_mode or "").strip().lower()
        if mode not in {"test", "live"}:
            raise ValueError("Invalid mode. Must be 'test' or 'live'.")

        current_mode = "test" if self.trading_parameters.test_mode else "live"
        if mode == current_mode and not force_refresh:
            return {"trading_mode": current_mode, "is_test_mode": self.trading_parameters.test_mode}

        if global_state.execution_mode == "Running" and not force_refresh:
            raise RuntimeError("Please stop or pause the bot before switching mode.")

        if mode == "test":
            if not self.trading_parameters.test_mode:
                live_active = self._get_active_position_symbols()
                if live_active:
                    raise RuntimeError(
                        f"Cannot switch to TEST while LIVE positions are open: {', '.join(live_active)}"
                    )
            self.trading_parameters.test_mode = True
            global_state.is_test_mode = True
            global_state.virtual_initial_balance = 1000.0
            global_state.virtual_balance = 1000.0
            global_state.virtual_positions = {}
            global_state.cumulative_realized_pnl = 0.0
            self._save_virtual_state()
            global_state.init_balance(global_state.virtual_balance, initial_balance=global_state.virtual_initial_balance)
            global_state.update_account(
                equity=global_state.virtual_balance,
                available=global_state.virtual_balance,
                wallet=global_state.virtual_balance,
                pnl=0.0
            )
            if force_refresh and current_mode == "test":
                global_state.add_log("🧪 TEST mode restarted (paper account reset to $1000.00).")
            else:
                global_state.add_log("🧪 Switched to TEST mode (paper account reset to $1000.00).")
            return {"trading_mode": "test", "is_test_mode": True}

        # mode == "live"
        self.trading_parameters.test_mode = False
        global_state.is_test_mode = False
        # Prevent TEST session realized PnL from leaking into LIVE account display.
        global_state.cumulative_realized_pnl = 0.0
        
        # Force reload .env file to pick up latest API keys from settings
        from dotenv import load_dotenv
        import os
        load_dotenv(self._env_path, override=True)
        
        # Read fresh API keys from environment
        fresh_api_key = os.getenv('BINANCE_API_KEY')
        fresh_api_secret = os.getenv('BINANCE_SECRET_KEY') or os.getenv('BINANCE_API_SECRET')
        
        if not fresh_api_key or not fresh_api_secret:
            self.trading_parameters.test_mode = True
            global_state.is_test_mode = True
            raise RuntimeError("请在设置中配置 Binance API Key 和 Secret Key")
        
        # Update config with fresh values
        self.config._config['binance']['api_key'] = fresh_api_key
        self.config._config['binance']['api_secret'] = fresh_api_secret
        
        # Recreate client on mode switch to pick up latest env/config credentials.
        self.client = BinanceClient(api_key=fresh_api_key, api_secret=fresh_api_secret, test_mode=self.trading_parameters.test_mode)
        self.agent_provider.reload(self.client)
        self.runner_factory.client = self.client

        try:
            acc_info = self.client.get_futures_account()
        except Exception as e:
            self.trading_parameters.test_mode = True
            global_state.is_test_mode = True
            raise RuntimeError(f"Failed to fetch live account balance: {e}")

        wallet = float(acc_info.get('total_wallet_balance', 0) or 0.0)
        unrealized = float(acc_info.get('total_unrealized_profit', 0) or 0.0)
        avail = float(acc_info.get('available_balance', 0) or 0.0)
        equity = wallet + unrealized
        if equity <= 0:
            self.trading_parameters.test_mode = True
            global_state.is_test_mode = True
            raise RuntimeError("Fetched live account balance is zero/invalid. Check account/API permissions.")
        global_state.update_account(equity=equity, available=avail, wallet=wallet, pnl=unrealized)
        global_state.init_balance(equity, initial_balance=equity)
        self._sync_open_positions_to_trade_history()
        if force_refresh and current_mode == "live":
            global_state.add_log("💰 LIVE mode restarted (account balance reloaded).")
        else:
            global_state.add_log("💰 Switched to LIVE mode.")
        return {
            "trading_mode": "live",
            "is_test_mode": False,
            "available_balance": float(avail or 0.0),
            "wallet_balance": float(acc_info.get('total_wallet_balance') or 0.0),
            "total_equity": equity
        }

    def _start_account_monitor(self):
        """Start a background thread to monitor account equity in real-time"""
        def _monitor():
            log.info("💰 Account Monitor Thread Started")
            while True:
                if not global_state.is_running:
                    break

                # Keep thread alive while stopped/paused so mode switching remains responsive.
                if global_state.execution_mode == "Stopped":
                    time.sleep(1)
                    continue

                if self.trading_parameters.test_mode:
                    time.sleep(2)
                    continue

                try:
                    acc = self.client.get_futures_account()
                    wallet = float(acc.get('total_wallet_balance', 0))
                    pnl = float(acc.get('total_unrealized_profit', 0))
                    avail = float(acc.get('available_balance', 0))
                    equity = wallet + pnl
                    global_state.update_account(equity, avail, wallet, pnl)
                    global_state.record_account_success()
                except Exception as e:
                    log.error(f"Account Monitor Error: {e}")
                    global_state.record_account_failure()
                    global_state.add_log(f"❌ Account info fetch failed: {str(e)}")
                    time.sleep(5)

                time.sleep(3)

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
            self._terminal_display = get_display(self.symbol_manager.symbols)
            self._terminal_display.print_header(test_mode=self.trading_parameters.test_mode)
            
            # Add filter to root logger
            logging.getLogger().addFilter(self._headless_filter)
        
        # Logger is configured in src.utils.logger, no need to override here.
        # Dashboard logging is handled via global_state.add_log -> log.bind(dashboard=True)

        # Start Real-time Monitors
        self._start_account_monitor()
        
        # 🔮 启动 Prophet 自动训练器 (每 2 小时重新训练)
        from src.models.prophet_model import HAS_LIGHTGBM
        if HAS_LIGHTGBM and self.agent_config.predict_agent:
            self.agent_provider.predict_agents_provider.start_auto_trainer(
                self.symbol_manager.primary_symbol,
                self.symbol_manager.symbols[0] if self.symbol_manager.symbols else None)
        
        # 设置初始间隔 (优先使用 CLI 参数，后续 API 可覆盖)
        global_state.cycle_interval = interval_minutes
        
        log.info(f"🚀 Starting continuous trading mode (interval: {global_state.cycle_interval}m)")
        
        # 🧪 Test Mode: Initialize Virtual Account for Chart
        if self.trading_parameters.test_mode:
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

                # 🧹 Clear chatroom messages each cycle (show current cycle only)
                global_state.clear_agent_messages()
                global_state.clear_agent_events()

                # 🧪 Test Mode: reset per-cycle baseline for PnL display
                if self.trading_parameters.test_mode:
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
                active_symbols = self.symbol_manager.get_active_position_symbols()
                locked_symbols = [s for s in self.symbol_manager.symbols if s in active_symbols]
                if active_symbols and not locked_symbols:
                    locked_symbols = sorted(set(active_symbols))
                has_lock = bool(locked_symbols)

                # 🔝 Symbol Selector Agent: run once at startup, then every 10 minutes during wait
                if not has_lock:
                    self.symbol_manager.run_symbol_selector(reason="startup", check_for_startup_done=True)

                symbols_for_cycle = locked_symbols if has_lock else self.symbol_manager.symbols
                if has_lock:
                    self.symbol_manager.current_symbol = symbols_for_cycle[0]
                    global_state.add_log(f"[🔒 SYSTEM] Active position lock: {', '.join(symbols_for_cycle)}")

                # 🧪 Test Mode: Record start of cycle account state (for Net Value Curve)
                if self.trading_parameters.test_mode:
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
                all_decisions: List[SuggestedTrade] = []
                latest_prices = {}  # Store latest prices for PnL calculation
                for symbol in symbols_for_cycle:
                    self.symbol_manager.current_symbol = symbol  # 设置当前处理的交易对
                    
                    # Analyze each symbol first without executing OPEN actions
                    result = asyncio.run(self._run_trading_cycle(analyze_only=True))
                    
                    latest_prices[symbol] = global_state.current_price.get(symbol, 0)
                    
                    print(f"  [{symbol}] 结果: {result['status']}")
                    
                    # Collect viable open opportunities
                    suggested_trade = SuggestedTrade.from_cycle_result(symbol=symbol, result=result)
                    if suggested_trade:
                        all_decisions.append(suggested_trade)
                
                # Step 2: 从所有开仓决策中选择信心度最高的一个
                if all_decisions:
                    # 按置信度 + AUTO1 趋势质量加分排序（加分仅用于优先级微调）
                    all_decisions.sort(
                        key=lambda x: x.confidence + self._get_auto1_execution_bonus(x.symbol),
                        reverse=True
                    )
                    best_decision = all_decisions[0]
                    best_bonus = self._get_auto1_execution_bonus(best_decision.symbol)
                    best_adjusted = best_decision.confidence + best_bonus
                    
                    print(
                        f"\n🎯 本周期最优开仓机会: {best_decision.symbol} "
                        f"(信心度: {best_decision.confidence:.1f}% | AUTO1加分: +{best_bonus:.1f} | 调整后: {best_adjusted:.1f}%)"
                    )
                    global_state.add_log(
                        f"[🎯 SYSTEM] Best: {best_decision.symbol} "
                        f"(Conf: {best_decision.confidence:.1f}% + Bonus {best_bonus:.1f} = {best_adjusted:.1f}%)"
                    )
                    
                    # 只执行最优的一个（直接执行已审计建议，避免重复跑完整流程）
                    try:
                        self.symbol_manager.current_symbol = best_decision.symbol
                        exec_result = self._execute_suggested_open_trade(
                            symbol=self.symbol_manager.current_symbol,
                            suggested=best_decision,
                            cycle_id=cycle_id
                        )
                        exec_action = exec_result.get('action', 'unknown')
                        exec_status = exec_result.get('status', 'unknown')
                        if exec_action and str(exec_action).lower() != 'unknown' and not is_passive_action(exec_action):
                            cycle_traded = exec_status == 'success'
                            cycle_trade_symbol = self.symbol_manager.current_symbol
                            cycle_trade_action = exec_action
                            cycle_trade_status = exec_status
                        global_state.add_log(
                            f"[🎯 SYSTEM] Executed: {self.symbol_manager.current_symbol} {exec_action} ({exec_status})"
                        )
                    except Exception as e:
                        log.error(f"❌ Best decision execution failed: {e}", exc_info=True)
                        global_state.add_log(f"[🎯 SYSTEM] Execution failed: {e}")
                    
                    # 如果有其他开仓机会被跳过，记录下来
                    if len(all_decisions) > 1:
                        skipped = [
                            f"{d.symbol}({d.confidence:.1f}%+{self._get_auto1_execution_bonus(d.symbol):.1f})"
                            for d in all_decisions[1:]
                        ]
                        print(f"  ⏭️  跳过其他机会: {', '.join(skipped)}")
                        global_state.add_log(f"⏭️  Skipped opportunities: {', '.join(skipped)} (1 position per cycle limit)")
                
                # 💰 Update Virtual Account PnL (Mark-to-Market)
                if self.trading_parameters.test_mode:
                    self._update_virtual_account_stats(latest_prices)
                
                # 🖥️ Headless Mode: Print account summary after each cycle
                if self._headless_mode:
                    acc = global_state.account_overview
                    # Get current positions
                    positions = global_state.virtual_positions if self.trading_parameters.test_mode else {}
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

                    self.symbol_manager.run_symbol_selector(reason="scheduled")
                    
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
                logging.getLogger().removeFilter(self._headless_filter)
            else:
                print(f"\n\n⚠️  收到停止信号，退出...")
            global_state.is_running = False

    def _update_virtual_account_stats(self, latest_prices: Dict[str, float]):
        """
        [Test Mode] 更新虚拟账户统计 (权益、PnL) 并推送到 Global State
        """
        if not self.trading_parameters.test_mode:
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
        if self.trading_parameters.test_mode:
            self.saver.save_virtual_account(
                balance=global_state.virtual_balance,
                positions=global_state.virtual_positions
            )
