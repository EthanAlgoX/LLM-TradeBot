"""
Execution Commander (The Executor) Module
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
    Execution Commander (The Executor)
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
        Execute trading decision
        
        Args:
            decision: Decision verified by risk control
            account_info: Account information
            position_info: Position information
            current_price: Current price
            
        Returns:
            Execution result
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
                result['message'] = 'Wait and observe, do not execute'
                log.info(f"Execute {action}, no operation")
                return result
            
            elif is_open_action(action) and action == 'open_long':
                return self._open_long(decision, account_info, current_price)
            
            elif is_open_action(action) and action == 'open_short':
                return self._open_short(decision, account_info, current_price)
            
            elif is_close_action(action):
                return self._close_position(decision, position_info, close_action=action)
            
            else:
                result['message'] = f'Unknown action: {action}'
                log.error(result['message'])
                return result
                
        except Exception as e:
            log.error(f"Trade execution failed: {e}")
            result['message'] = f'Execution failed: {str(e)}'
            return result
    
    def _open_long(self, decision: Dict, account_info: Dict, current_price: float) -> Dict:
        """Open long position"""
        symbol = decision['symbol']
        
        # Calculate position size
        quantity = self.risk_manager.calculate_position_size(
            account_balance=account_info['available_balance'],
            position_pct=decision['position_size_pct'],
            leverage=decision['leverage'],
            current_price=current_price
        )
        
        # Set leverage
        try:
            self.client.client.futures_change_leverage(
                symbol=symbol,
                leverage=decision['leverage']
            )
            log.executor(f"Leverage set to {decision['leverage']}x")
        except Exception as e:
            log.executor(f"Failed to set leverage: {e}", success=False)
        
        # Place market buy order (open long)
        order = self.client.place_market_order(
            symbol=symbol,
            side='BUY',
            quantity=quantity,
            position_side='LONG'  # Explicitly specify as LONG in two-way position mode
        )
        
        # Calculate stop loss and take profit prices
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
        
        # Set stop loss and take profit
        sl_tp_orders = self.client.set_stop_loss_take_profit(
            symbol=symbol,
            stop_loss_price=stop_loss_price,
            take_profit_price=take_profit_price,
            position_side='LONG'  # Explicitly specify long position
        )
        
        log.executor(f"Open long position successful: {quantity} {symbol} @ {entry_price}")
        
        return {
            'success': True,
            'action': 'open_long',
            'timestamp': datetime.now().isoformat(),
            'orders': [order] + sl_tp_orders,
            'entry_price': entry_price,
            'quantity': quantity,
            'stop_loss': stop_loss_price,
            'take_profit': take_profit_price,
            'message': 'Open long position successful'
        }
    
    def _open_short(self, decision: Dict, account_info: Dict, current_price: float) -> Dict:
        """Open short position"""
        symbol = decision['symbol']
        
        quantity = self.risk_manager.calculate_position_size(
            account_balance=account_info['available_balance'],
            position_pct=decision['position_size_pct'],
            leverage=decision['leverage'],
            current_price=current_price
        )
        
        # Set leverage
        try:
            self.client.client.futures_change_leverage(
                symbol=symbol,
                leverage=decision['leverage']
            )
        except Exception as e:
            log.executor(f"Failed to set leverage: {e}", success=False)
        
        # Place market sell order (open short)
        order = self.client.place_market_order(
            symbol=symbol,
            side='SELL',
            quantity=quantity,
            position_side='SHORT'  # Explicitly specify as SHORT in two-way position mode
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
            position_side='SHORT'  # Explicitly specify short position
        )
        
        log.executor(f"Open short position successful: {quantity} {symbol} @ {entry_price}")
        
        return {
            'success': True,
            'action': 'open_short',
            'timestamp': datetime.now().isoformat(),
            'orders': [order] + sl_tp_orders,
            'entry_price': entry_price,
            'quantity': quantity,
            'stop_loss': stop_loss_price,
            'take_profit': take_profit_price,
            'message': 'Open short position successful'
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
        """Close position"""
        if not position_info or position_info.get('position_amt', 0) == 0:
            return {
                'success': False,
                'action': close_action,
                'timestamp': datetime.now().isoformat(),
                'message': 'No position, no need to close'
            }
        
        symbol = decision['symbol']
        position_amt = position_info['position_amt']
        if close_action == "close_long" and position_amt < 0:
            return {
                'success': False,
                'action': close_action,
                'timestamp': datetime.now().isoformat(),
                'message': 'Position direction mismatch: current position is short'
            }
        if close_action == "close_short" and position_amt > 0:
            return {
                'success': False,
                'action': close_action,
                'timestamp': datetime.now().isoformat(),
                'message': 'Position direction mismatch: current position is long'
            }
        
        # Cancel all pending orders
        self.client.cancel_all_orders(symbol)
        
        # Close position
        side = 'SELL' if position_amt > 0 else 'BUY'
        quantity = abs(position_amt)
        
        log.executor(f"Start executing close position: {side} {quantity} {symbol}")
        
        order = self.client.place_market_order(
            symbol=symbol,
            side=side,
            quantity=quantity,
            reduce_only=True
        )
        
        log.executor(f"Close position successful: {quantity} {symbol}")
        
        return {
            'success': True,
            'action': close_action,
            'timestamp': datetime.now().isoformat(),
            'orders': [order],
            'quantity': quantity,
            'message': 'Close position successful'
        }
    
    def _add_position(
        self,
        decision: Dict,
        account_info: Dict,
        position_info: Optional[Dict],
        current_price: float
    ) -> Dict:
        """Add position"""
        if not position_info or position_info.get('position_amt', 0) == 0:
            return {
                'success': False,
                'action': 'add_position',
                'timestamp': datetime.now().isoformat(),
                'message': 'No position, cannot add position'
            }
        
        # Determine whether current is long or short
        if position_info['position_amt'] > 0:
            return self._open_long(decision, account_info, current_price)
        else:
            return self._open_short(decision, account_info, current_price)
    
    def _reduce_position(self, decision: Dict, position_info: Optional[Dict]) -> Dict:
        """Reduce position"""
        if not position_info or position_info.get('position_amt', 0) == 0:
            return {
                'success': False,
                'action': 'reduce_position',
                'timestamp': datetime.now().isoformat(),
                'message': 'No position, cannot reduce position'
            }
        
        symbol = decision['symbol']
        position_amt = position_info['position_amt']
        
        # Reduce position by half
        reduce_qty = abs(position_amt) * 0.5
        side = 'SELL' if position_amt > 0 else 'BUY'
        
        order = self.client.place_market_order(
            symbol=symbol,
            side=side,
            quantity=reduce_qty,
            reduce_only=True
        )
        
        log.executor(f"Reduce position successful: {reduce_qty} {symbol}")
        
        return {
            'success': True,
            'action': 'reduce_position',
            'timestamp': datetime.now().isoformat(),
            'orders': [order],
            'quantity': reduce_qty,
            'message': 'Reduce position successful'
        }
