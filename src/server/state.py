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
    
    # Market Data
    current_price: float = 0.0
    market_regime: str = "Unknown"
    price_position: str = "Unknown"
    
    # Agent Status
    oracle_status: str = "Waiting"
    strategist_score: float = 0.0
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
    virtual_initial_balance: float = 10000.0  # Starting balance for test mode
    virtual_balance: float = 10000.0  # Current balance in test mode
    virtual_positions: Dict[str, Dict] = field(default_factory=dict)  # {symbol: {entry_price, quantity, side, ...}}
    
    # Account Failure Tracking
    account_failure_count: int = 0  # Consecutive failures
    account_last_success_time: Optional[float] = None  # Timestamp of last successful fetch
    account_alert_active: bool = False  # Whether alert is currently shown
    
    # Chart Data
    equity_history: List[Dict] = field(default_factory=list)  # [{'time': '12:00', 'value': 1000}, ...]
    
    # Latest Decision & History
    latest_decision: Dict[str, Any] = field(default_factory=dict)
    decision_history: List[Dict] = field(default_factory=list)
    
    # History
    trade_history: List[Dict] = field(default_factory=list)
    recent_logs: List[str] = field(default_factory=list)
    
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
        timestamp = datetime.now().strftime("%H:%M:%S")
        
        # Add point if history is empty or last point is older than 5 seconds to prevent flood
        # For simplicity, we just check if timestamp is different (1s resolution) but maybe throttle slightly if needed.
        # Let's just append. The frontend handles the curve.
        
        if not self.equity_history or self.equity_history[-1]['time'] != timestamp:
            self.equity_history.append({'time': timestamp, 'value': equity})
            
            # Keep last 200 points (e.g. ~10-20 mins of real-time data or 200 minutes of slow data)
            if len(self.equity_history) > 200:
                self.equity_history.pop(0)

    def update_decision(self, decision: Dict):
        self.latest_decision = decision
        self.critic_confidence = decision.get('confidence', 0.0)
        
        # Add timestamp to decision if not present
        if 'timestamp' not in decision:
            decision['timestamp'] = datetime.now().strftime("%H:%M:%S")
            
        # Add to history
        self.decision_history.insert(0, decision) # Prepend
        if len(self.decision_history) > 100:
            self.decision_history.pop()
        self.last_update = datetime.now().strftime("%H:%M:%S")
    
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
        self.recent_logs.append(f"[{timestamp}] {message}")
        if len(self.recent_logs) > 500:
            self.recent_logs.pop(0)
            
        # Push to file logger (Clean Trading Log)
        log.bind(dashboard=True).info(message)

# Global Singleton
global_state = SharedState()
global_state.start_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
