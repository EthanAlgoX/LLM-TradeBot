"""
执行指挥官 (The Executor) 模块
"""
from typing import Dict, Optional, List
from src.api.binance_client import BinanceClient
from src.risk.manager import RiskManager
from src.utils.logger import log
from src.utils.action_protocol import (
    normalize_action,
    is_open_action,
    is_close_action,
    is_passive_action,
)
from datetime import datetime
import time


class ExecutionEngine:
    """
    执行指挥官 (The Executor)
"""
    
    def __init__(self, binance_client: BinanceClient, risk_manager: RiskManager):
        self.client = binance_client
        self.risk_manager = risk_manager
        
        log.info("🚀 The Executor (Execution Engine) initialized")
    
    def execute_decision(
        self,
        decision: Dict,
        account_info: Dict,
        position_info: Optional[Dict],
        current_price: float
    ) -> Dict:
        """
        执行交易决策
        
        Args:
            decision: 经过风控验证的决策
            account_info: 账户信息
            position_info: 持仓信息
            current_price: 当前价格
            
        Returns:
            执行结果
        """
        
        raw_action = str(decision.get('action', 'wait'))
        position_side = None
        if position_info and position_info.get('position_amt') is not None:
            try:
                amt = float(position_info.get('position_amt', 0))
                if amt > 0:
                    position_side = 'long'
                elif amt < 0:
                    position_side = 'short'
            except Exception:
                position_side = None

        action = normalize_action(raw_action, position_side=position_side)
        decision['action'] = action
        symbol = decision['symbol']
        
        result = {
            'success': False,
            'action': action,
            'timestamp': datetime.now().isoformat(),
            'orders': [],
            'message': ''
        }
        
        try:
            # Keep backward compatibility for legacy partial position commands.
            if raw_action in ('add_position', 'reduce_position'):
                if raw_action == 'add_position':
                    return self._add_position(decision, account_info, position_info, current_price)
                return self._reduce_position(decision, position_info)

            if is_passive_action(action):
                result['success'] = True
                result['message'] = '观望，不执行操作'
                log.info(f"执行{action}，无操作")
                return result
            
            elif is_open_action(action) and action == 'open_long':
                return self._open_long(decision, account_info, current_price)
            
            elif is_open_action(action) and action == 'open_short':
                return self._open_short(decision, account_info, current_price)
            
            elif is_close_action(action):
                return self._close_position(decision, position_info, close_action=action)
            
            else:
                result['message'] = f'未知操作: {action}'
                log.error(result['message'])
                return result
                
        except Exception as e:
            log.error(f"执行交易失败: {e}")
            result['message'] = f'执行失败: {str(e)}'
            return result
    
    def _open_long(self, decision: Dict, account_info: Dict, current_price: float) -> Dict:
        """开多仓"""
        symbol = decision['symbol']
        
        # 计算开仓数量
        quantity = self.risk_manager.calculate_position_size(
            account_balance=account_info['available_balance'],
            position_pct=decision['position_size_pct'],
            leverage=decision['leverage'],
            current_price=current_price
        )
        
        # 设置杠杆
        try:
            self.client.client.futures_change_leverage(
                symbol=symbol,
                leverage=decision['leverage']
            )
            log.executor(f"杠杆已设置为 {decision['leverage']}x")
        except Exception as e:
            log.executor(f"设置杠杆失败: {e}", success=False)
        
        # 下市价买单（开多仓）
        order = self.client.place_market_order(
            symbol=symbol,
            side='BUY',
            quantity=quantity,
            position_side='LONG'  # 双向持仓模式下明确指定为LONG
        )
        
        # 计算止损止盈价格
        entry_price = float(order.get('avgPrice', current_price))
        
        stop_loss_price = self.risk_manager.calculate_stop_loss_price(
            entry_price=entry_price,
            stop_loss_pct=decision['stop_loss_pct'],
            side='LONG'
        )
        
        take_profit_price = self.risk_manager.calculate_take_profit_price(
            entry_price=entry_price,
            take_profit_pct=decision['take_profit_pct'],
            side='LONG'
        )
        
        # 设置止损止盈
        sl_tp_orders = self.client.set_stop_loss_take_profit(
            symbol=symbol,
            stop_loss_price=stop_loss_price,
            take_profit_price=take_profit_price,
            position_side='LONG'  # 明确指定多仓
        )
        
        log.executor(f"开多仓成功: {quantity} {symbol} @ {entry_price}")
        
        return {
            'success': True,
            'action': 'open_long',
            'timestamp': datetime.now().isoformat(),
            'orders': [order] + sl_tp_orders,
            'entry_price': entry_price,
            'quantity': quantity,
            'stop_loss': stop_loss_price,
            'take_profit': take_profit_price,
            'message': '开多仓成功'
        }
    
    def _open_short(self, decision: Dict, account_info: Dict, current_price: float) -> Dict:
        """开空仓"""
        symbol = decision['symbol']
        
        quantity = self.risk_manager.calculate_position_size(
            account_balance=account_info['available_balance'],
            position_pct=decision['position_size_pct'],
            leverage=decision['leverage'],
            current_price=current_price
        )
        
        # 设置杠杆
        try:
            self.client.client.futures_change_leverage(
                symbol=symbol,
                leverage=decision['leverage']
            )
        except Exception as e:
            log.executor(f"设置杠杆失败: {e}", success=False)
        
        # 下市价卖单（开空仓）
        order = self.client.place_market_order(
            symbol=symbol,
            side='SELL',
            quantity=quantity,
            position_side='SHORT'  # 双向持仓模式下明确指定为SHORT
        )
        
        entry_price = float(order.get('avgPrice', current_price))
        
        stop_loss_price = self.risk_manager.calculate_stop_loss_price(
            entry_price=entry_price,
            stop_loss_pct=decision['stop_loss_pct'],
            side='SHORT'
        )
        
        take_profit_price = self.risk_manager.calculate_take_profit_price(
            entry_price=entry_price,
            take_profit_pct=decision['take_profit_pct'],
            side='SHORT'
        )
        
        sl_tp_orders = self.client.set_stop_loss_take_profit(
            symbol=symbol,
            stop_loss_price=stop_loss_price,
            take_profit_price=take_profit_price,
            position_side='SHORT'  # 明确指定空仓
        )
        
        log.executor(f"开空仓成功: {quantity} {symbol} @ {entry_price}")
        
        return {
            'success': True,
            'action': 'open_short',
            'timestamp': datetime.now().isoformat(),
            'orders': [order] + sl_tp_orders,
            'entry_price': entry_price,
            'quantity': quantity,
            'stop_loss': stop_loss_price,
            'take_profit': take_profit_price,
            'message': '开空仓成功'
        }

    def set_stop_loss_take_profit(
        self,
        symbol: str,
        position_side: str,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None
    ) -> List[Dict]:
        """兼容主流程调用，转发到 BinanceClient。"""
        return self.client.set_stop_loss_take_profit(
            symbol=symbol,
            stop_loss_price=stop_loss,
            take_profit_price=take_profit,
            position_side=position_side
        )
    
    def _close_position(
        self,
        decision: Dict,
        position_info: Optional[Dict],
        close_action: str = "close_position",
    ) -> Dict:
        """平仓"""
        if not position_info or position_info.get('position_amt', 0) == 0:
            return {
                'success': False,
                'action': close_action,
                'timestamp': datetime.now().isoformat(),
                'message': '无持仓，无需平仓'
            }
        
        symbol = decision['symbol']
        position_amt = position_info['position_amt']
        if close_action == "close_long" and position_amt < 0:
            return {
                'success': False,
                'action': close_action,
                'timestamp': datetime.now().isoformat(),
                'message': '持仓方向不匹配: 当前为空仓'
            }
        if close_action == "close_short" and position_amt > 0:
            return {
                'success': False,
                'action': close_action,
                'timestamp': datetime.now().isoformat(),
                'message': '持仓方向不匹配: 当前为多仓'
            }
        
        # 取消所有挂单
        self.client.cancel_all_orders(symbol)
        
        # 平仓
        side = 'SELL' if position_amt > 0 else 'BUY'
        quantity = abs(position_amt)
        
        log.executor(f"开始执行平仓: {side} {quantity} {symbol}")
        
        order = self.client.place_market_order(
            symbol=symbol,
            side=side,
            quantity=quantity,
            reduce_only=True
        )
        
        log.executor(f"平仓成功: {quantity} {symbol}")
        
        return {
            'success': True,
            'action': close_action,
            'timestamp': datetime.now().isoformat(),
            'orders': [order],
            'quantity': quantity,
            'message': '平仓成功'
        }
    
    def _add_position(
        self,
        decision: Dict,
        account_info: Dict,
        position_info: Optional[Dict],
        current_price: float
    ) -> Dict:
        """加仓"""
        if not position_info or position_info.get('position_amt', 0) == 0:
            return {
                'success': False,
                'action': 'add_position',
                'timestamp': datetime.now().isoformat(),
                'message': '无持仓，无法加仓'
            }
        
        # 判断当前是多还是空
        if position_info['position_amt'] > 0:
            return self._open_long(decision, account_info, current_price)
        else:
            return self._open_short(decision, account_info, current_price)
    
    def _reduce_position(self, decision: Dict, position_info: Optional[Dict]) -> Dict:
        """减仓"""
        if not position_info or position_info.get('position_amt', 0) == 0:
            return {
                'success': False,
                'action': 'reduce_position',
                'timestamp': datetime.now().isoformat(),
                'message': '无持仓，无法减仓'
            }
        
        symbol = decision['symbol']
        position_amt = position_info['position_amt']
        
        # 减半仓位
        reduce_qty = abs(position_amt) * 0.5
        side = 'SELL' if position_amt > 0 else 'BUY'
        
        order = self.client.place_market_order(
            symbol=symbol,
            side=side,
            quantity=reduce_qty,
            reduce_only=True
        )
        
        log.executor(f"减仓成功: {reduce_qty} {symbol}")
        
        return {
            'success': True,
            'action': 'reduce_position',
            'timestamp': datetime.now().isoformat(),
            'orders': [order],
            'quantity': reduce_qty,
            'message': '减仓成功'
        }
