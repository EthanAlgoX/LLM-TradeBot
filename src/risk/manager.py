"""
风险管理模块
"""
from typing import Dict, Optional, List
from datetime import datetime, timedelta
from src.config import config
from src.utils.logger import log


class RiskManager:
    """风险管理器 - 硬编码风控规则"""
    
    def __init__(self):
        self.max_risk_per_trade_pct = config.risk.get('max_risk_per_trade_pct', 1.5)
        self.max_total_position_pct = config.risk.get('max_total_position_pct', 30.0)
        self.max_leverage = config.risk.get('max_leverage', 5)
        self.max_consecutive_losses = config.risk.get('max_consecutive_losses', 3)
        self.stop_trading_drawdown_pct = config.risk.get('stop_trading_on_drawdown_pct', 10.0)
        
        # 交易历史记录（用于计算连续亏损）
        self.trade_history: List[Dict] = []
        self.consecutive_losses = 0
        self.total_drawdown_pct = 0
        
        log.info("风险管理器初始化完成")
    
    def validate_decision(
        self,
        decision: Dict,
        account_info: Dict,
        position_info: Optional[Dict],
        market_snapshot: Dict
    ) -> tuple[bool, Dict, str]:
        """
        验证并修正LLM决策
        
        Args:
            decision: LLM原始决策
            account_info: 账户信息
            position_info: 当前持仓
            market_snapshot: 市场快照
            
        Returns:
            (is_valid, modified_decision, reason)
        """
        
        modified_decision = decision.copy()
        action = decision['action']
        
        # 1. 检查连续亏损
        if self.consecutive_losses >= self.max_consecutive_losses:
            if action in ['open_long', 'open_short', 'add_position']:
                log.warning(f"连续亏损{self.consecutive_losses}次，拒绝新仓位")
                return False, modified_decision, "连续亏损过多，暂停交易"
        
        # 2. 检查回撤
        if self.total_drawdown_pct >= self.stop_trading_drawdown_pct:
            if action in ['open_long', 'open_short', 'add_position']:
                log.warning(f"账户回撤{self.total_drawdown_pct:.2f}%，拒绝新仓位")
                return False, modified_decision, "回撤过大，暂停交易"
        
        # 3. 检查资金费率极端情况
        funding_rate = market_snapshot.get('funding', {}).get('funding_rate', 0)
        if abs(funding_rate) > 0.001:  # 极端资金费率
            if action in ['open_long', 'open_short']:
                # 极端正费率不开多，极端负费率不开空
                if funding_rate > 0.001 and action == 'open_long':
                    log.warning("资金费率过高，拒绝开多")
                    return False, modified_decision, "资金费率极端，不适合开多"
                elif funding_rate < -0.001 and action == 'open_short':
                    log.warning("资金费率过低，拒绝开空")
                    return False, modified_decision, "资金费率极端，不适合开空"
        
        # 4. 检查杠杆
        if decision['leverage'] > self.max_leverage:
            log.warning(f"杠杆{decision['leverage']}超过最大值{self.max_leverage}，已修正")
            modified_decision['leverage'] = self.max_leverage
        
        # 5. 检查仓位大小
        if decision['position_size_pct'] > self.max_total_position_pct:
            log.warning(
                f"仓位{decision['position_size_pct']:.1f}%超过最大值{self.max_total_position_pct}%，已修正"
            )
            modified_decision['position_size_pct'] = self.max_total_position_pct
        
        # 6. 计算实际风险
        available_balance = account_info.get('available_balance', 0)
        if available_balance <= 0:
            return False, modified_decision, "账户余额不足"
        
        # 计算开仓金额
        position_value = available_balance * (modified_decision['position_size_pct'] / 100)
        
        # 计算止损风险
        stop_loss_pct = modified_decision['stop_loss_pct']
        risk_amount = position_value * modified_decision['leverage'] * (stop_loss_pct / 100)
        risk_pct = (risk_amount / available_balance) * 100
        
        # 7. 检查单笔风险
        if risk_pct > self.max_risk_per_trade_pct:
            # 修正仓位大小
            max_position_value = (
                available_balance * self.max_risk_per_trade_pct / 100
            ) / (modified_decision['leverage'] * stop_loss_pct / 100)
            
            corrected_position_pct = (max_position_value / available_balance) * 100
            
            log.warning(
                f"风险{risk_pct:.2f}%超过最大值{self.max_risk_per_trade_pct}%，"
                f"仓位从{modified_decision['position_size_pct']:.1f}%修正为{corrected_position_pct:.1f}%"
            )
            
            modified_decision['position_size_pct'] = corrected_position_pct
        
        # 8. 检查是否有足够资金
        final_position_value = available_balance * (modified_decision['position_size_pct'] / 100)
        required_margin = final_position_value / modified_decision['leverage']
        
        if required_margin > available_balance:
            log.warning("保证金不足，降低仓位")
            modified_decision['position_size_pct'] = (
                available_balance * modified_decision['leverage'] / available_balance
            ) * 100 * 0.95  # 留5%缓冲
        
        # 9. 检查流动性
        liquidity = market_snapshot.get('market_overview', {}).get('liquidity', 'unknown')
        if liquidity == 'low' and action in ['open_long', 'open_short']:
            log.warning("流动性不足，建议观望")
            # 不强制拒绝，但记录警告
        
        # 10. 检查持仓冲突
        if position_info and position_info.get('position_amt', 0) != 0:
            current_side = 'LONG' if position_info['position_amt'] > 0 else 'SHORT'
            
            # 不允许同时做多做空
            if current_side == 'LONG' and action == 'open_short':
                log.warning("当前持有多仓，不允许开空仓")
                return False, modified_decision, "持仓冲突"
            elif current_side == 'SHORT' and action == 'open_long':
                log.warning("当前持有空仓，不允许开多仓")
                return False, modified_decision, "持仓冲突"
        
        log.info("风控验证通过")
        return True, modified_decision, "通过"
    
    def calculate_position_size(
        self,
        account_balance: float,
        position_pct: float,
        leverage: int,
        current_price: float
    ) -> float:
        """
        计算实际开仓数量
        
        Args:
            account_balance: 账户余额
            position_pct: 仓位百分比
            leverage: 杠杆
            current_price: 当前价格
            
        Returns:
            开仓数量
        """
        position_value = account_balance * (position_pct / 100)
        position_value_with_leverage = position_value * leverage
        quantity = position_value_with_leverage / current_price
        
        return quantity
    
    def calculate_stop_loss_price(
        self,
        entry_price: float,
        stop_loss_pct: float,
        side: str
    ) -> float:
        """
        计算止损价格
        
        Args:
            entry_price: 入场价
            stop_loss_pct: 止损百分比
            side: LONG or SHORT
            
        Returns:
            止损价格
        """
        if side == 'LONG':
            return entry_price * (1 - stop_loss_pct / 100)
        else:  # SHORT
            return entry_price * (1 + stop_loss_pct / 100)
    
    def calculate_take_profit_price(
        self,
        entry_price: float,
        take_profit_pct: float,
        side: str
    ) -> float:
        """计算止盈价格"""
        if side == 'LONG':
            return entry_price * (1 + take_profit_pct / 100)
        else:  # SHORT
            return entry_price * (1 - take_profit_pct / 100)
    
    def record_trade(self, trade: Dict):
        """记录交易结果"""
        self.trade_history.append(trade)
        
        # 更新连续亏损计数
        if trade.get('pnl', 0) < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0
        
        log.info(f"交易记录: PnL={trade.get('pnl', 0):.2f}, 连续亏损={self.consecutive_losses}")
    
    def update_drawdown(self, current_balance: float, peak_balance: float):
        """更新回撤"""
        if peak_balance > 0:
            self.total_drawdown_pct = ((peak_balance - current_balance) / peak_balance) * 100
        
        if self.total_drawdown_pct > 0:
            log.warning(f"当前回撤: {self.total_drawdown_pct:.2f}%")
    
    def get_risk_status(self) -> Dict:
        """获取风险状态"""
        return {
            'consecutive_losses': self.consecutive_losses,
            'total_drawdown_pct': self.total_drawdown_pct,
            'can_trade': (
                self.consecutive_losses < self.max_consecutive_losses and
                self.total_drawdown_pct < self.stop_trading_drawdown_pct
            ),
            'total_trades': len(self.trade_history)
        }
