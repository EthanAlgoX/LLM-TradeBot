"""
Binance API 接入层
"""
from typing import Dict, List, Optional, Any
from binance.client import Client
from binance.exceptions import BinanceAPIException
from binance import ThreadedWebsocketManager
import asyncio
from datetime import datetime
from src.config import config
from src.utils.logger import log


class BinanceClient:
    """Binance API 客户端封装"""
    
    def __init__(self):
        self.api_key = config.binance.get('api_key')
        self.api_secret = config.binance.get('api_secret')
        self.testnet = config.binance.get('testnet', True)
        
        # 初始化客户端
        if self.testnet:
            self.client = Client(
                self.api_key,
                self.api_secret,
                testnet=True
            )
        else:
            self.client = Client(self.api_key, self.api_secret)
        
        self.ws_manager: Optional[ThreadedWebsocketManager] = None
        
        # 缓存层
        self._funding_cache = {} # {symbol: (rate, timestamp)}
        self._cache_duration = 3600 # 1小时缓存
        
        log.info(f"Binance客户端初始化完成 (测试网: {self.testnet})")
    
    def get_klines(self, symbol: str, interval: str, limit: int = 500) -> List[Dict]:
        """
        获取K线数据
        
        Args:
            symbol: 交易对，如 'BTCUSDT'
            interval: 时间周期，如 '1m', '5m', '15m', '1h'
            limit: 数量限制
            
        Returns:
            K线数据列表
        """
        try:
            klines = self.client.get_klines(
                symbol=symbol,
                interval=interval,
                limit=limit
            )
            
            # 格式化数据
            formatted_klines = []
            for k in klines:
                formatted_klines.append({
                    'timestamp': k[0],
                    'open': float(k[1]),
                    'high': float(k[2]),
                    'low': float(k[3]),
                    'close': float(k[4]),
                    'volume': float(k[5]),
                    'close_time': k[6],
                    'quote_volume': float(k[7]),
                    'trades': int(k[8]),
                    'taker_buy_base': float(k[9]),
                    'taker_buy_quote': float(k[10])
                })
            
            return formatted_klines
            
        except BinanceAPIException as e:
            log.error(f"获取K线数据失败: {e}")
            raise
    
    def get_ticker_price(self, symbol: str) -> Dict:
        """获取最新价格"""
        try:
            ticker = self.client.get_symbol_ticker(symbol=symbol)
            return {
                'symbol': ticker['symbol'],
                'price': float(ticker['price']),
                'timestamp': datetime.now().timestamp() * 1000
            }
        except BinanceAPIException as e:
            log.error(f"获取价格失败: {e}")
            raise
    
    def get_orderbook(self, symbol: str, limit: int = 20) -> Dict:
        """获取订单簿"""
        try:
            depth = self.client.get_order_book(symbol=symbol, limit=limit)
            return {
                'timestamp': datetime.now().timestamp() * 1000,
                'bids': [[float(p), float(q)] for p, q in depth['bids']],
                'asks': [[float(p), float(q)] for p, q in depth['asks']]
            }
        except BinanceAPIException as e:
            log.error(f"获取订单簿失败: {e}")
            raise
    
    def get_account_info(self) -> Dict:
        """获取账户信息"""
        try:
            account = self.client.get_account()
            
            # 提取USDT余额
            usdt_balance = 0
            for balance in account['balances']:
                if balance['asset'] == 'USDT':
                    usdt_balance = float(balance['free']) + float(balance['locked'])
                    break
            
            return {
                'timestamp': account['updateTime'],
                'can_trade': account['canTrade'],
                'balances': account['balances'],
                'usdt_balance': usdt_balance
            }
        except BinanceAPIException as e:
            log.error(f"获取账户信息失败: {e}")
            raise
    
    def get_futures_account(self) -> Dict:
        """获取合约账户信息"""
        try:
            account = self.client.futures_account()
            
            return {
                'timestamp': account['updateTime'],
                'total_wallet_balance': float(account['totalWalletBalance']),
                'total_unrealized_profit': float(account['totalUnrealizedProfit']),
                'total_margin_balance': float(account['totalMarginBalance']),
                'available_balance': float(account['availableBalance']),
                'max_withdraw_amount': float(account['maxWithdrawAmount']),
                'positions': account['positions']
            }
        except BinanceAPIException as e:
            log.error(f"获取合约账户失败: {e}")
            raise
    
    def get_futures_position(self, symbol: str) -> Optional[Dict]:
        """获取特定合约的持仓信息"""
        try:
            positions = self.client.futures_position_information(symbol=symbol)
            
            if not positions:
                return None
            
            pos = positions[0]
            return {
                'symbol': pos['symbol'],
                'position_amt': float(pos['positionAmt']),
                'entry_price': float(pos['entryPrice']),
                'mark_price': float(pos['markPrice']),
                'unrealized_profit': float(pos['unRealizedProfit']),
                'liquidation_price': float(pos['liquidationPrice']),
                'leverage': int(pos['leverage']),
                'margin_type': pos['marginType'],
                'isolated_margin': float(pos['isolatedMargin']),
                'position_side': pos['positionSide']
            }
        except BinanceAPIException as e:
            log.error(f"获取持仓信息失败: {e}")
            raise
    
    def get_account_balance(self) -> float:
        """
        获取合约账户可用余额
        
        Returns:
            float: 可用余额（USDT）
        """
        try:
            account = self.get_futures_account()
            return account['available_balance']
        except BinanceAPIException as e:
            log.error(f"获取账户余额失败: {e}")
            raise
    
    def get_funding_rate(self, symbol: str) -> Dict:
        """获取资金费率 (实时 - Premium Index)"""
        try:
            # 用户指定使用 premiumIndex 接口 (futures_mark_price)
            funding = self.client.futures_mark_price(symbol=symbol)
            
            return {
                'symbol': funding['symbol'],
                'funding_rate': float(funding['lastFundingRate']),
                'funding_time': funding['nextFundingTime']
            }
        except BinanceAPIException as e:
            log.error(f"获取资金费率失败: {e}")
            raise

    def get_funding_rate_with_cache(self, symbol: str) -> Dict:
        """获取带1小时缓存的资金费率"""
        now = datetime.now().timestamp()
        
        # 检查缓存
        if symbol in self._funding_cache:
            rate, ts = self._funding_cache[symbol]
            if now - ts < self._cache_duration:
                log.debug(f"使用缓存的资金费率: {symbol}")
                return {
                    'symbol': symbol,
                    'funding_rate': rate,
                    'is_cached': True
                }
        
        # 缓存失效或不存在，取新值
        try:
            data = self.get_funding_rate(symbol)
            self._funding_cache[symbol] = (data['funding_rate'], now)
            data['is_cached'] = False
            return data
        except Exception as e:
            log.error(f"刷新资金费率缓存失败: {e}")
            # 如果有旧缓存，勉强返回
            if symbol in self._funding_cache:
                return {'symbol': symbol, 'funding_rate': self._funding_cache[symbol][0], 'is_cached': True, 'error': 'refresh_failed'}
            return {'symbol': symbol, 'funding_rate': 0, 'is_cached': False, 'error': str(e)}
    
    def get_open_interest(self, symbol: str) -> Dict:
        """获取持仓量"""
        try:
            oi = self.client.futures_open_interest(symbol=symbol)
            return {
                'symbol': oi['symbol'],
                'open_interest': float(oi['openInterest']),
                'timestamp': oi['time']
            }
        except BinanceAPIException as e:
            log.error(f"获取持仓量失败: {e}")
            raise
    
    def place_market_order(
        self,
        symbol: str,
        side: str,
        quantity: float,
        reduce_only: bool = False,
        position_side: str = 'BOTH'
    ) -> Dict:
        """
        下市价单
        
        Args:
            symbol: 交易对
            side: BUY 或 SELL
            quantity: 数量
            reduce_only: 只减仓
            position_side: 持仓方向 (BOTH/LONG/SHORT), 双向持仓用LONG/SHORT
        """
        try:
            # 构建订单参数
            order_params = {
                'symbol': symbol,
                'side': side,
                'type': 'MARKET',
                'quantity': quantity,
                'positionSide': position_side
            }
            
            # 只在需要时添加 reduceOnly 参数
            if reduce_only:
                order_params['reduceOnly'] = True
            
            order = self.client.futures_create_order(**order_params)
            
            log.info(f"市价单已下: {side} {quantity} {symbol} (positionSide={position_side})")
            return order
            
        except BinanceAPIException as e:
            log.error(f"下单失败: {e}")
            raise
    
    def place_limit_order(
        self,
        symbol: str,
        side: str,
        quantity: float,
        price: float,
        time_in_force: str = 'GTC'
    ) -> Dict:
        """下限价单"""
        try:
            order = self.client.futures_create_order(
                symbol=symbol,
                side=side,
                type='LIMIT',
                quantity=quantity,
                price=price,
                timeInForce=time_in_force
            )
            
            log.info(f"限价单已下: {side} {quantity} {symbol} @ {price}")
            return order
            
        except BinanceAPIException as e:
            log.error(f"下单失败: {e}")
            raise
    
    def set_stop_loss_take_profit(
        self,
        symbol: str,
        stop_loss_price: Optional[float] = None,
        take_profit_price: Optional[float] = None,
        position_side: str = 'LONG'  # 新增：明确指定持仓方向
    ) -> List[Dict]:
        """
        设置止损止盈
        
        Args:
            symbol: 交易对
            stop_loss_price: 止损价格
            take_profit_price: 止盈价格
            position_side: 持仓方向 (LONG/SHORT)
        """
        orders = []
        
        try:
            # 获取当前持仓
            position = self.get_futures_position(symbol)
            if not position or position['position_amt'] == 0:
                log.warning("无持仓，无法设置止损止盈")
                return orders
            
            position_amt = abs(position['position_amt'])
            side = 'SELL' if position['position_amt'] > 0 else 'BUY'
            
            # 止损单
            if stop_loss_price:
                sl_order = self.client.futures_create_order(
                    symbol=symbol,
                    side=side,
                    type='STOP_MARKET',
                    stopPrice=stop_loss_price,
                    closePosition=True,
                    positionSide=position_side  # 添加持仓方向
                )
                orders.append(sl_order)
                log.info(f"止损单已设置: {stop_loss_price} (positionSide={position_side})")
            
            # 止盈单
            if take_profit_price:
                tp_order = self.client.futures_create_order(
                    symbol=symbol,
                    side=side,
                    type='TAKE_PROFIT_MARKET',
                    stopPrice=take_profit_price,
                    closePosition=True,
                    positionSide=position_side  # 添加持仓方向
                )
                orders.append(tp_order)
                log.info(f"止盈单已设置: {take_profit_price} (positionSide={position_side})")
            
            return orders
            
        except BinanceAPIException as e:
            log.error(f"设置止损止盈失败: {e}")
            raise
    
    def cancel_all_orders(self, symbol: str) -> Dict:
        """取消所有订单"""
        try:
            result = self.client.futures_cancel_all_open_orders(symbol=symbol)
            log.info(f"已取消所有{symbol}订单")
            return result
        except BinanceAPIException as e:
            log.error(f"取消订单失败: {e}")
            raise
    
    def get_market_data_snapshot(self, symbol: str) -> Dict:
        """
        获取市场数据快照（完整）
        这是提供给后续模块的标准接口
        
        注意：账户信息获取失败会在返回中标注错误，不会抛出异常
        """
        try:
            price = self.get_ticker_price(symbol)
            orderbook = self.get_orderbook(symbol)
            funding = self.get_funding_rate(symbol)
            oi = self.get_open_interest(symbol)
            
            # 合约账户信息（需要认证，如果失败则返回空）
            account = None
            position = None
            account_error = None
            
            try:
                account = self.get_futures_account()
                position = self.get_futures_position(symbol)
            except Exception as e:
                account_error = str(e)
                log.warning(f"获取账户/持仓信息失败（可能未配置有效API密钥）: {e}")
            
            return {
                'timestamp': datetime.now().isoformat(),
                'symbol': symbol,
                'price': price,
                'orderbook': orderbook,
                'funding': funding,
                'oi': oi,
                'account': account,
                'position': position,
                'account_error': account_error  # 传递错误信息
            }
            
        except Exception as e:
            log.error(f"获取市场快照失败: {e}")
            raise
    
    def get_symbol_info(self, symbol: str) -> Dict:
        """获取交易对信息（包含 filters）"""
        try:
            info = self.client.get_symbol_info(symbol)
            return info or {}
        except BinanceAPIException as e:
            log.error(f"获取交易对信息失败: {e}")
            raise
    
    def get_symbol_min_notional(self, symbol: str) -> float:
        """尝试从交易对信息中解析最小名义(minNotional 或 MIN_NOTIONAL)

        返回 float（找不到则返回 0.0）
        """
        try:
            info = self.get_symbol_info(symbol)
            filters = info.get('filters', []) if isinstance(info, dict) else []

            # 常见的过滤器字段: {'filterType': 'MIN_NOTIONAL', 'minNotional': '100'}
            for f in filters:
                if not isinstance(f, dict):
                    continue
                ft = f.get('filterType')
                if ft == 'MIN_NOTIONAL':
                    try:
                        return float(f.get('minNotional', 0))
                    except Exception:
                        continue

                # 有些接口直接返回 minNotional 字段
                if 'minNotional' in f:
                    try:
                        return float(f.get('minNotional', 0))
                    except Exception:
                        continue

            # 兼容性兜底：某些合约可能使用其他命名
            for f in filters:
                if not isinstance(f, dict):
                    continue
                for k in ['minNotional', 'minNotionalValue', 'minNotionalAmt', 'NOTIONAL', 'minNotionalUSD']:
                    if k in f:
                        try:
                            return float(f.get(k, 0))
                        except Exception:
                            continue

            return 0.0
        except Exception as e:
            log.warning(f"解析最小名义失败，返回0: {e}")
            return 0.0
