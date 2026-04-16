from typing import Dict, List, Tuple
from datetime import datetime

from src.utils.logger import log
from src.utils.action_protocol import is_open_action

from .trade_record import TradeRecord

# ============================================
# 过度交易防护 (Overtrading Guard)
# ============================================
class OvertradingGuard:
    """
    过度交易防护 - 防止频繁交易和连续亏损
    
    规则:
    - 同一symbol最少间隔2个周期
    - 6小时内最多3个新仓位
    - 连续2次亏损后，需要等待4个周期
    """
    
    MIN_CYCLES_SAME_SYMBOL = 4        # 同symbol最小间隔周期 (1小时)
    MAX_POSITIONS_6H = 2              # 6小时内最多开仓数 (减少过度交易)
    LOSS_STREAK_COOLDOWN = 6          # 连续亏损后冷却周期 (增加冷却时间)
    CONSECUTIVE_LOSS_THRESHOLD = 2   # 触发冷却的连续亏损次数
    
    def __init__(self):
        self.trade_history: List[TradeRecord] = []
        self.consecutive_losses = 0
        self.last_trade_cycle: Dict[str, int] = {}  # symbol -> cycle
        self.cooldown_until_cycle: int = 0
    
    def record_trade(self, symbol: str, action: str, pnl: float = 0.0, current_cycle: int = 0):
        """记录一笔交易"""
        self.trade_history.append(TradeRecord(
            symbol=symbol,
            action=action,
            timestamp=datetime.now(),
            pnl=pnl
        ))
        self.last_trade_cycle[symbol] = current_cycle
        
        # 追踪连续亏损
        if pnl < 0:
            self.consecutive_losses += 1
            if self.consecutive_losses >= self.CONSECUTIVE_LOSS_THRESHOLD:
                self.cooldown_until_cycle = current_cycle + self.LOSS_STREAK_COOLDOWN
                log.warning(f"⚠️ 连续{self.consecutive_losses}次亏损，冷却至周期 {self.cooldown_until_cycle}")
        else:
            self.consecutive_losses = 0
    
    def can_open_position(self, symbol: str, current_cycle: int = 0) -> Tuple[bool, str]:
        """
        检查是否可以开仓
        
        Returns:
            (allowed, reason)
        """
        # 检查冷却期
        if current_cycle < self.cooldown_until_cycle:
            remaining = self.cooldown_until_cycle - current_cycle
            return False, f"⛔ 连续亏损冷却中，剩余{remaining}周期"
        
        # 检查同symbol间隔
        if symbol in self.last_trade_cycle:
            cycles_since = current_cycle - self.last_trade_cycle[symbol]
            if cycles_since < self.MIN_CYCLES_SAME_SYMBOL:
                return False, f"⛔ {symbol}交易间隔不足，需等待{self.MIN_CYCLES_SAME_SYMBOL - cycles_since}周期"
        
        # 检查6小时内开仓数
        six_hours_ago = datetime.now().timestamp() - 6 * 3600
        recent_opens = sum(
            1 for t in self.trade_history 
            if t.timestamp.timestamp() > six_hours_ago and is_open_action(t.action)
        )
        if recent_opens >= self.MAX_POSITIONS_6H:
            return False, f"⛔ 6小时内已开{recent_opens}仓，已达上限{self.MAX_POSITIONS_6H}"
        
        return True, "✅ 允许开仓"
    
    def get_status(self) -> Dict:
        """获取当前状态"""
        return {
            'consecutive_losses': self.consecutive_losses,
            'cooldown_until': self.cooldown_until_cycle,
            'recent_trades': len(self.trade_history),
            'symbols_traded': list(self.last_trade_cycle.keys())
        }
