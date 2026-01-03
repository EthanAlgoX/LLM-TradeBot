from src.utils.logger import log
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field
from datetime import datetime
import json

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
    
    # Config Reload Flag (for Railway runtime config changes)
    config_changed: bool = False  # Set to True when config is updated via API
    
    # Market Data
    current_price: float = 0.0
    market_regime: str = "Unknown"
    price_position: str = "Unknown"
    
    # Agent Status
    oracle_status: str = "Waiting"
    prophet_probability: float = 0.0  # PredictAgent 上涨概率
    critic_confidence: float = 0.0
    guardian_status: str = "Standing By"
    
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
    latest_decision: Dict[str, Any] = field(default_factory=dict)
    decision_history: List[Dict] = field(default_factory=list)
    
    # History
    trade_history: List[Dict] = field(default_factory=list)
    recent_logs: List[str] = field(default_factory=list)
    
    # Reflection Agent State
    reflection_count: int = 0
    last_reflection: Optional[Dict] = None
    last_reflection_text: Optional[str] = None
    
    def update_market(self, price: float, regime: str, position: str):
        self.current_price = price
        self.market_regime = regime
        self.price_position = position
        self.last_update = datetime.now().strftime("%H:%M:%S")

    def update_account(self, equity: float, available: float, wallet: float, pnl: float):
        self.account_overview = {
            "total_equity": equity,
            "available_balance": available,
            "wallet_balance": wallet,
            "total_pnl": pnl
        }
        # Add to history (Real-time PnL tracking)
        # We want to capture volatility, so we log more frequently.
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Add point if history is empty or last point is older than 5 seconds to prevent flood
        # For simplicity, we just check if timestamp is different (1s resolution) but maybe throttle slightly if needed.
        # Let's just append. The frontend handles the curve.
        
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
        
        self.latest_decision = decision
        self.critic_confidence = decision.get('confidence', 0.0)
        
        # Add timestamp to decision if not present
        if 'timestamp' not in decision:
            decision['timestamp'] = datetime.now().strftime("%H:%M:%S")
            
        # Add to history
        self.decision_history.insert(0, decision)  # Prepend
        if len(self.decision_history) > 100:
            self.decision_history.pop()
        
        self.last_update = datetime.now().strftime("%H:%M:%S")
    
    def init_balance(self, balance: float):
        """Initialize the starting balance for tracking."""
        self.initial_balance = balance
        if self.is_test_mode:
            self.virtual_initial_balance = balance
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
        log.info(f"[📊 SYSTEM] Balance tracking initialized: ${balance:.2f}")
    
    def record_trade(self, trade: Dict):
        """Record a trade and update balance history."""
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
        
        # Calculate cumulative PnL
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
        self.account_failure_count = 0
        self.account_last_success_time = time.time()
        self.account_alert_active = False
    
    def record_account_failure(self):
        """Record failed account info fetch"""
        import time
        self.account_failure_count += 1
        
        # Check if we should trigger alert (5 minutes = 300 seconds)
        if self.account_last_success_time:
            time_since_success = time.time() - self.account_last_success_time
            if time_since_success >= 300 and not self.account_alert_active:
                self.account_alert_active = True
                log.error(f"⚠️ 账户信息获取失败已超过 5 分钟！连续失败次数: {self.account_failure_count}")
        
    def add_log(self, message: str):
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        # Ensure message has timestamp if not present
        if not message.startswith("["):
            message = f"[{timestamp}] {message}"
            
        self.recent_logs.append(message)
        if len(self.recent_logs) > 500:
            self.recent_logs.pop(0)
    
    def clear_init_logs(self):
        """Clear initialization logs when Cycle 1 starts to sync with Recent Decisions."""
        self.recent_logs.clear()
        # Log the fresh start
        msg = "[📊 SYSTEM] Cleared initialization logs - starting fresh from Cycle 1"
        self.recent_logs.append(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}")
        log.info(msg)
    
    def register_log_sink(self):
        """Register a sink to capture all system logs to dashboard"""
        def sink(message):
            record = message.record
            # Skip logs that are already explicitly for dashboard (avoid duplicates/loops)
            if record["extra"].get("dashboard"):
                return
                
            # Format: YYYY-MM-DD HH:mm:ss | LEVEL | module:func - message
            time_str = record["time"].strftime("%Y-%m-%d %H:%M:%S")
            level = record["level"].name
            module = record["name"]
            func = record["function"]
            msg = record["message"]
            
            formatted = f"{time_str} | {level:<8} | {module}:{func} - {msg}"
            
            # Directly append to recent_logs (bypass add_log to avoid re-logging)
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
