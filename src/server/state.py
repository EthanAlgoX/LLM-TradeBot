from src.utils.logger import log
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field
from datetime import datetime
import json
import threading

@dataclass
class SharedState:
    """Global state shared between Trading Loop and API Server"""
    
    # System Status
    is_running: bool = False
    execution_mode: str = "Running" # Running, Paused, Stopped
    is_test_mode: bool = False  # Test mode or live trading
    start_time: str = ""
    last_update: str = ""
    
    # Cycle Tracking
    cycle_counter: int = 0  # Total number of cycles since start
    current_cycle_id: str = ""  # Current cycle identifier (cycle_NNNN_timestamp)
    cycle_interval: int = 3  # Cycle interval in minutes (default 3)
    cycle_positions_opened: int = 0  # Positions opened in current cycle
    symbols: List[str] = field(default_factory=list)  # 🆕 Active trading symbols (supports AI500 Top5)
    current_symbol: str = ""  # 🆕 Symbol currently being analyzed
    
    # Config Reload Flag (for Railway runtime config changes)
    config_changed: bool = False  # Set to True when config is updated via API
    mode_switch_handler: Any = field(default=None, repr=False)  # Callable injected by runtime bot
    
    # Market Data
    current_price: Dict[str, float] = field(default_factory=dict)
    market_regime: Dict[str, str] = field(default_factory=dict)
    price_position: Dict[str, str] = field(default_factory=dict)
    
    # Agent Status
    oracle_status: str = "Waiting"
    prophet_probability: float = 0.0  # PredictAgent 上涨概率
    critic_confidence: Dict[str, float] = field(default_factory=dict)
    guardian_status: str = "Standing By"
    symbol_selector: Dict[str, Any] = field(default_factory=dict)
    
    # Account Data
    account_overview: Dict[str, float] = field(default_factory=lambda: {
        "total_equity": 0.0,
        "available_balance": 0.0,
        "wallet_balance": 0.0,
        "total_pnl": 0.0
    })
    
    # Virtual Account (Test Mode)
    virtual_initial_balance: float = 1000.0  # Starting balance for test mode
    virtual_balance: float = 1000.0  # Current balance in test mode
    virtual_positions: Dict[str, Dict] = field(default_factory=dict)  # {symbol: {entry_price, quantity, side, ...}}
    cumulative_realized_pnl: float = 0.0  # Total realized PnL from all closed trades
    
    # Account Failure Tracking
    account_failure_count: int = 0  # Consecutive failures
    account_last_success_time: Optional[float] = None  # Timestamp of last successful fetch
    account_alert_active: bool = False  # Whether alert is currently shown
    
    # Demo Mode Tracking (20-minute limit for default API)
    demo_mode_active: bool = False  # True if using default API key
    demo_start_time: Optional[float] = None  # Unix timestamp when demo started
    demo_expired: bool = False  # True if 20 minutes exceeded
    demo_limit_seconds: int = 20 * 60  # 20 minutes in seconds
    
    # Chart Data
    equity_history: List[Dict] = field(default_factory=list)  # [{'time': '12:00', 'value': 1000}, ...]
    balance_history: List[Dict] = field(default_factory=list)  # [{time, balance, pnl, action}]
    initial_balance: float = 0.0  # Initial balance when trading started
    
    # Latest Decision & History
    latest_decision: Dict[str, Any] = field(default_factory=dict) # Keyed by symbol now
    decision_history: List[Dict] = field(default_factory=list)
    
    # History
    trade_history: List[Dict] = field(default_factory=list)
    recent_logs: List[str] = field(default_factory=list)
    
    # Reflection Agent State
    reflection_count: int = 0
    last_reflection: Optional[Dict] = None
    last_reflection_text: Optional[str] = None

    # Indicator snapshot (for UI)
    indicator_snapshot: Dict[str, Any] = field(default_factory=dict)

    # Multi-Period Parser Agent Output
    multi_period_result: Dict[str, Any] = field(default_factory=dict)
    
    # [NEW] Multi-Agent Chatroom Messages
    agent_messages: List[Dict] = field(default_factory=list)
    last_agent_message: Dict[str, str] = field(default_factory=dict)
    last_agent_message_cycle: Dict[str, int] = field(default_factory=dict)
    agent_events: List[Dict] = field(default_factory=list)
    
    # [NEW] LLM Config & Prompts Display
    agent_prompts: Dict[str, str] = field(default_factory=dict)
    llm_info: Dict[str, str] = field(default_factory=dict)
    agent_settings: Dict[str, Any] = field(default_factory=dict)
    _lock: threading.RLock = field(default_factory=threading.RLock, init=False, repr=False)

    def locked(self):
        """Expose state lock for atomic external read/write blocks."""
        return self._lock
    
    def update_market(self, symbol: str, price: float, regime: str, position: str):
        with self._lock:
            self.current_price[symbol] = price
            self.market_regime[symbol] = regime
            self.price_position[symbol] = position
            self.last_update = datetime.now().strftime("%H:%M:%S")

    def update_account(self, equity: float, available: float, wallet: float, pnl: float):
        with self._lock:
            self.account_overview = {
                "total_equity": equity,
                "available_balance": available,
                "wallet_balance": wallet,
                "total_pnl": pnl
            }
            # Add to history (Real-time PnL tracking)
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            if not self.equity_history or self.equity_history[-1]['time'] != timestamp:
                self.equity_history.append({
                    'time': timestamp,
                    'value': equity,
                    'cycle': self.cycle_counter
                })

                # Keep last 200 points (e.g. ~10-20 mins of real-time data or 200 minutes of slow data)
                if len(self.equity_history) > 200:
                    self.equity_history.pop(0)

    def _serialize_obj(self, obj):
        """Recursively serialize non-JSON-compatible types (datetime, numpy, pd.Timestamp)"""
        import numpy as np
        import pandas as pd
        from datetime import datetime
        if isinstance(obj, datetime):
            return obj.strftime("%Y-%m-%d %H:%M:%S")
        if isinstance(obj, pd.Timestamp):
            return obj.strftime("%Y-%m-%d %H:%M:%S")
        if isinstance(obj, (np.integer, np.int32, np.int64)):
            return int(obj)
        if isinstance(obj, (np.floating, np.float32, np.float64)):
            return float(obj)
        if isinstance(obj, (np.bool_,)):
            return bool(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, dict):
            return {k: self._serialize_obj(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [self._serialize_obj(v) for v in obj]
        return obj

    def update_decision(self, decision: Dict):
        """Update the latest decision and add to history"""
        from datetime import datetime
        
        # Clean non-serializable objects to prevent JSON errors
        decision = self._serialize_obj(decision)
        with self._lock:
            symbol = decision.get('symbol', 'UNKNOWN')
            self.latest_decision[symbol] = decision
            self.critic_confidence[symbol] = decision.get('confidence', 0.0)

            # Add timestamp to decision if not present
            if 'timestamp' not in decision:
                decision['timestamp'] = datetime.now().strftime("%H:%M:%S")

            # Add to history
            self.decision_history.insert(0, decision)  # Prepend
            if len(self.decision_history) > 100:
                self.decision_history.pop()

            self.last_update = datetime.now().strftime("%H:%M:%S")

    def add_agent_message(self, agent: str, content: str, role: str = "assistant", level: str = "info", symbol: Optional[str] = None):
        """Add a message to the multi-agent chatroom"""
        with self._lock:
            # Avoid duplicate spam within the same cycle
            last_content = self.last_agent_message.get(agent)
            last_cycle = self.last_agent_message_cycle.get(agent)
            if last_content == content and last_cycle == self.cycle_counter:
                return

            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            message = {
                "timestamp": timestamp,
                "agent": agent,
                "content": content,
                "role": role,
                "level": level,
                "symbol": symbol or self.current_symbol,
                "cycle": self.cycle_counter
            }
            self.agent_messages.append(message)
            # Keep last 100 messages
            if len(self.agent_messages) > 100:
                self.agent_messages.pop(0)

            self.last_agent_message[agent] = content
            self.last_agent_message_cycle[agent] = self.cycle_counter
        
        # Also log to system logs
        self.add_log(f"[{agent.upper()}] {content}")

    def clear_agent_messages(self):
        """Clear chatroom messages for a new cycle"""
        with self._lock:
            self.agent_messages = []
            self.last_agent_message = {}
            self.last_agent_message_cycle = {}

    def add_agent_event(self, event: Dict[str, Any]):
        """Append structured runtime event for debugging/observability."""
        with self._lock:
            self.agent_events.append(self._serialize_obj(event))
            if len(self.agent_events) > 500:
                self.agent_events.pop(0)

    def clear_agent_events(self):
        """Clear runtime events for a new cycle."""
        with self._lock:
            self.agent_events = []
    
    def init_balance(self, balance: float, initial_balance: Optional[float] = None):
        """Initialize the starting balance for tracking."""
        with self._lock:
            if initial_balance is None:
                initial_balance = balance
            self.initial_balance = initial_balance
            if self.is_test_mode:
                self.virtual_initial_balance = initial_balance
                self.virtual_balance = balance
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            # Add initial point to balance history
            self.balance_history.append({
                'time': timestamp,
                'balance': balance,
                'pnl': 0.0,
                'pnl_pct': 0.0,
                'action': 'INIT',
                'cycle': 0
            })
            # Add initial point to equity history (for Net Value Curve)
            self.equity_history.append({
                'time': timestamp,
                'value': balance,
                'cycle': 0
            })
        log.info(f"[📊 SYSTEM] Balance tracking initialized: ${balance:.2f}")
    
    def record_trade(self, trade: Dict):
        """Record a trade and update balance history."""
        with self._lock:
            # Add to trade history
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            trade['recorded_at'] = timestamp
            self.trade_history.insert(0, trade)  # Prepend (newest first)

            # Keep last 100 trades
            if len(self.trade_history) > 100:
                self.trade_history.pop()

            # Update balance based on trade result
            current_balance = self.virtual_balance if self.is_test_mode else self.account_overview.get('total_equity', 0)
            pnl = trade.get('pnl', 0.0)

            # Accumulate realized PnL from closed trades
            if pnl != 0:
                self.cumulative_realized_pnl += pnl
                log.info(f"📊 Realized PnL updated: +${pnl:.2f}, Total: ${self.cumulative_realized_pnl:.2f}")

            # Calculate cumulative PnL (for balance history)
            cumulative_pnl = current_balance - self.initial_balance if self.initial_balance > 0 else 0
            pnl_pct = (cumulative_pnl / self.initial_balance * 100) if self.initial_balance > 0 else 0

            # Add to balance history
            self.balance_history.append({
                'time': timestamp,
                'balance': current_balance,
                'pnl': cumulative_pnl,
                'pnl_pct': pnl_pct,
                'action': trade.get('action', 'TRADE'),
                'symbol': trade.get('symbol', ''),
                'cycle': self.cycle_counter
            })

            # Keep last 500 balance points
            if len(self.balance_history) > 500:
                self.balance_history.pop(0)
    
    def record_account_success(self):
        """Record successful account info fetch"""
        import time
        with self._lock:
            self.account_failure_count = 0
            self.account_last_success_time = time.time()
            self.account_alert_active = False
    
    def record_account_failure(self):
        """Record failed account info fetch"""
        import time
        with self._lock:
            self.account_failure_count += 1
            
            # Check if we should trigger alert (5 minutes = 300 seconds)
            if self.account_last_success_time:
                time_since_success = time.time() - self.account_last_success_time
                if time_since_success >= 300 and not self.account_alert_active:
                    self.account_alert_active = True
                    log.error(f"⚠️ 账户信息获取失败已超过 5 分钟！连续失败次数: {self.account_failure_count}")
    
    def add_log(self, message: str):
        with self._lock:
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            # Ensure message has timestamp if not present
            if not message.startswith("["):
                message = f"[{timestamp}] {message}"
                
            self.recent_logs.append(message)
            if len(self.recent_logs) > 500:
                self.recent_logs.pop(0)
    
    def clear_init_logs(self):
        """Clear initialization logs when Cycle 1 starts to sync with Recent Decisions."""
        with self._lock:
            self.recent_logs.clear()
            # Log the fresh start
            msg = "[📊 SYSTEM] Cleared initialization logs - starting fresh from Cycle 1"
            self.recent_logs.append(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}")
        log.info(msg)
    
    def register_log_sink(self):
        """Register a sink to capture all system logs to dashboard"""
        def sink(message):
            record = message.record
            
            # Format: YYYY-MM-DD HH:mm:ss | LEVEL | module:func - message
            time_str = record["time"].strftime("%Y-%m-%d %H:%M:%S")
            level = record["level"].name
            module = record["name"]
            func = record["function"]
            msg = record["message"]
            
            formatted = f"{time_str} | {level:<8} | {module}:{func} - {msg}"
            
            # Directly append to recent_logs
            with self._lock:
                self.recent_logs.append(formatted)
                if len(self.recent_logs) > 500:
                    self.recent_logs.pop(0)
        
        # Add sink for INFO and above
        log.add(sink, level="INFO")

# Global Singleton
global_state = SharedState()
global_state.start_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
# Auto-register the sink
global_state.register_log_sink()
