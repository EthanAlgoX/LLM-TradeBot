"""
交易执行引擎
"""
from typing import Dict, Optional, List
from src.api.binance_client import BinanceClient
from src.risk.manager import RiskManager
from src.utils.logger import log
from datetime import datetime
import time


class ExecutionEngine:
    """交易执行引擎"""
    
    def __init__(self, binance_client: BinanceClient, risk_manager: RiskManager):
        self.client = binance_client
        self.risk_manager = risk_manager
        
        log.info("交易执行引擎初始化完成")
    
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
        
        action = decision['action']
        symbol = decision['symbol']
        
        result = {
            'success': False,
            'action': action,
            'timestamp': datetime.now().isoformat(),
            'orders': [],
            'message': ''
        }
        
        try:
            if action == 'hold':
                result['success'] = True
                result['message'] = '观望，不执行操作'
                log.info("执行hold，无操作")
                return result
            
            elif action == 'open_long':
                return self._open_long(decision, account_info, current_price)
            
            elif action == 'open_short':
                return self._open_short(decision, account_info, current_price)
            
            elif action == 'close_position':
                return self._close_position(decision, position_info)
            
            elif action == 'add_position':
                return self._add_position(decision, account_info, position_info, current_price)
            
            elif action == 'reduce_position':
                return self._reduce_position(decision, position_info)
            
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
            log.info(f"杠杆已设置为 {decision['leverage']}x")
        except Exception as e:
            log.warning(f"设置杠杆失败: {e}")
        
        # 下市价买单
        order = self.client.place_market_order(
            symbol=symbol,
            side='BUY',
            quantity=quantity
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
            take_profit_price=take_profit_price
        )
        
        log.info(f"开多仓成功: {quantity} {symbol} @ {entry_price}")
        
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
            log.warning(f"设置杠杆失败: {e}")
        
        # 下市价卖单
        order = self.client.place_market_order(
            symbol=symbol,
            side='SELL',
            quantity=quantity
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
            take_profit_price=take_profit_price
        )
        
        log.info(f"开空仓成功: {quantity} {symbol} @ {entry_price}")
        
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
    
    def _close_position(self, decision: Dict, position_info: Optional[Dict]) -> Dict:
        """平仓"""
        if not position_info or position_info.get('position_amt', 0) == 0:
            return {
                'success': False,
                'action': 'close_position',
                'timestamp': datetime.now().isoformat(),
                'message': '无持仓，无需平仓'
            }
        
        symbol = decision['symbol']
        position_amt = position_info['position_amt']
        
        # 取消所有挂单
        self.client.cancel_all_orders(symbol)
        
        # 平仓
        side = 'SELL' if position_amt > 0 else 'BUY'
        quantity = abs(position_amt)
        
        order = self.client.place_market_order(
            symbol=symbol,
            side=side,
            quantity=quantity,
            reduce_only=True
        )
        
        log.info(f"平仓成功: {quantity} {symbol}")
        
        return {
            'success': True,
            'action': 'close_position',
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
        
        log.info(f"减仓成功: {reduce_qty} {symbol}")
        
        return {
            'success': True,
            'action': 'reduce_position',
            'timestamp': datetime.now().isoformat(),
            'orders': [order],
            'quantity': reduce_qty,
            'message': '减仓成功'
        }
