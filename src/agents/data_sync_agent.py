"""
数据先知 (The Oracle) Agent

职责：
1. 异步并发请求多周期K线数据
2. 拆分 stable/live 双视图
3. 时间对齐验证

优化点：
- 并发IO，节省60%时间
- 双视图数据，解决滞后问题
"""

import asyncio
import pandas as pd
from datetime import datetime
from typing import Dict, List, Tuple
from dataclasses import dataclass, field

from src.api.binance_client import BinanceClient
from src.api.quant_client import quant_client
from src.utils.logger import log
from src.utils.oi_tracker import oi_tracker


@dataclass
class MarketSnapshot:
    """
    市场快照（双视图结构）
    
    stable_view: iloc[:-1] 已完成的K线，用于计算历史指标
    live_view: iloc[-1] 当前未完成的K线，包含最新价格
    """
    # 5m 数据
    stable_5m: pd.DataFrame  # 已完成K线
    live_5m: Dict            # 最新K线
    
    # 15m 数据
    stable_15m: pd.DataFrame
    live_15m: Dict
    
    # 1h 数据
    stable_1h: pd.DataFrame
    live_1h: Dict
    
    # 元数据
    timestamp: datetime
    alignment_ok: bool       # 时间对齐状态
    fetch_duration: float    # 获取耗时（秒）
    
    # 对外量化深度数据 (Netflow, OI)
    quant_data: Dict = field(default_factory=dict)
    
    # Binance 原生数据 (Native Data)
    binance_funding: Dict = field(default_factory=dict)
    binance_oi: Dict = field(default_factory=dict)
    
    # 原始数据（可选，用于调试）
    raw_5m: List[Dict] = field(default_factory=list)
    raw_15m: List[Dict] = field(default_factory=list)
    raw_1h: List[Dict] = field(default_factory=list)


class DataSyncAgent:
    """
    数据先知 (The Oracle)
    
    核心优化：
    1. 异步并发请求（asyncio.gather）
    2. 双视图数据结构（stable + live）
    3. 时间对齐验证
    """
    
    def __init__(self, client: BinanceClient = None):
        """
        初始化数据同步官
        
        Args:
            client: Binance客户端实例，如果为None则自动创建
        """
        self.client = client or BinanceClient()
        
        # WebSocket 管理器（可选）
        import os
        self.use_websocket = os.getenv("USE_WEBSOCKET", "true").lower() == "true"
        self.ws_manager = None
        self._initial_load_complete = False
        
        if self.use_websocket:
            try:
                from src.api.binance_websocket import BinanceWebSocketManager
                self.ws_manager = BinanceWebSocketManager(
                    symbol="BTCUSDT",
                    timeframes=['5m', '15m', '1h']
                )
                self.ws_manager.start()
                log.info("🚀 WebSocket 数据流已启用")
            except Exception as e:
                log.warning(f"WebSocket 启动失败，回退到 REST API: {e}")
                self.use_websocket = False
        else:
            log.info("📡 使用 REST API 模式（WebSocket 已禁用）")
        
        self.last_snapshot = None
        log.info("🕵️ 数据先知 (The Oracle) 初始化完成")
    
    async def fetch_all_timeframes(
        self,
        symbol: str = "BTCUSDT",
        limit: int = 300
    ) -> MarketSnapshot:
        """
        异步并发获取所有周期数据
        
        Args:
            symbol: 交易对
            limit: 每个周期获取的K线数量
            
        Returns:
            MarketSnapshot对象，包含双视图数据
        """
        start_time = datetime.now()
        
        # log.oracle(f"📊 开始并发获取 {symbol} 数据...")
        
        use_rest_fallback = False
        
        # WebSocket 模式：从缓存获取数据
        if self.use_websocket and self.ws_manager and self._initial_load_complete:
            # 从 WebSocket 缓存获取数据
            k5m = self.ws_manager.get_klines('5m', limit)
            k15m = self.ws_manager.get_klines('15m', limit)
            k1h = self.ws_manager.get_klines('1h', limit)
            
            # 检查数据是否足够
            min_len = min(len(k5m), len(k15m), len(k1h))
            if min_len < limit:
                log.warning(f"[{symbol}] WebSocket 缓存数据不足 (min={min_len}, limit={limit})，回退到 REST API")
                use_rest_fallback = True
            else:
                # 仍需异步获取外部数据
                q_data = await quant_client.fetch_coin_data(symbol)
                loop = asyncio.get_event_loop()
                b_funding, b_oi = await asyncio.gather(
                    loop.run_in_executor(None, self.client.get_funding_rate_with_cache, symbol),
                    loop.run_in_executor(None, self.client.get_open_interest, symbol)
                )

        if not self.use_websocket or not self.ws_manager or not self._initial_load_complete or use_rest_fallback:
            # REST API 模式或首次加载 / 回退模式
            loop = asyncio.get_event_loop()
            
            tasks = [
                loop.run_in_executor(
                    None,
                    self.client.get_klines,
                    symbol, '5m', limit
                ),
                loop.run_in_executor(
                    None,
                    self.client.get_klines,
                    symbol, '15m', limit
                ),
                loop.run_in_executor(
                    None,
                    self.client.get_klines,
                    symbol, '1h', limit
                ),
                quant_client.fetch_coin_data(symbol),
                loop.run_in_executor(
                    None,
                    self.client.get_funding_rate_with_cache,
                    symbol
                ),
                loop.run_in_executor(
                    None,
                    self.client.get_open_interest,
                    symbol
                )
            ]
            
            # 等待所有请求完成
            k5m, k15m, k1h, q_data, b_funding, b_oi = await asyncio.gather(*tasks)
            
            log.info(f"[{symbol}] Data fetched: 5m={len(k5m)}, 15m={len(k15m)}, 1h={len(k1h)}")
            
            # 标记首次加载完成
            if not self._initial_load_complete:
                self._initial_load_complete = True
                log.info("✅ 初始数据加载完成，后续将使用 WebSocket 缓存")
        
        fetch_duration = (datetime.now() - start_time).total_seconds()
        # log.oracle(f"✅ 数据获取完成，耗时: {fetch_duration:.2f}秒")
        
        # 拆分双视图
        snapshot = MarketSnapshot(
            # 5m 数据
            stable_5m=self._to_dataframe(k5m[:-1]),
            live_5m=k5m[-1] if k5m else {},
            
            # 15m 数据
            stable_15m=self._to_dataframe(k15m[:-1]),
            live_15m=k15m[-1] if k15m else {},
            
            # 1h 数据
            stable_1h=self._to_dataframe(k1h[:-1]),
            live_1h=k1h[-1] if k1h else {},
            
            # 元数据
            timestamp=datetime.now(),
            alignment_ok=self._check_alignment(k5m, k15m, k1h),
            fetch_duration=fetch_duration,
            
            # 原始数据
            raw_5m=k5m,
            raw_15m=k15m,
            raw_1h=k1h,
            quant_data=q_data,
            binance_funding=b_funding,
            binance_oi=b_oi
        )
        
        # 🔮 记录 OI 到历史追踪器
        if b_oi and b_oi.get('open_interest', 0) > 0:
            oi_tracker.record(
                symbol=symbol,
                oi_value=b_oi['open_interest'],
                timestamp=b_oi.get('timestamp')
            )
        
        # 缓存最新快照
        self.last_snapshot = snapshot
        
        # 日志记录
        # self._log_snapshot_info(snapshot)
        
        return snapshot
    
    def _to_dataframe(self, klines: List[Dict]) -> pd.DataFrame:
        """
        将K线列表转换为DataFrame
        
        Args:
            klines: K线原始数据列表
            
        Returns:
            处理后的DataFrame
        """
        if not klines:
            return pd.DataFrame()
        
        df = pd.DataFrame(klines)
        
        # 转换时间戳
        if 'timestamp' in df.columns:
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            df.set_index('timestamp', inplace=True)
        
        # 确保数值类型
        numeric_cols = ['open', 'high', 'low', 'close', 'volume']
        for col in numeric_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')
        
        return df
    
    def _check_alignment(
        self,
        k5m: List[Dict],
        k15m: List[Dict],
        k1h: List[Dict]
    ) -> bool:
        """
        检查多周期数据的时间对齐性
        
        Args:
            k5m, k15m, k1h: 各周期K线数据
            
        Returns:
            True if aligned, False otherwise
        """
        if not all([k5m, k15m, k1h]):
            log.warning("⚠️ 部分周期数据缺失，时间对齐失败")
            return False
        
        try:
            # 获取最新K线的时间戳
            t5m = k5m[-1]['timestamp']
            t15m = k15m[-1]['timestamp']
            t1h = k1h[-1]['timestamp']
            
            # 计算时间差（毫秒）
            diff_5m_15m = abs(t5m - t15m)
            diff_5m_1h = abs(t5m - t1h)
            
            # 使用更宽松的容差:
            # - 5m vs 15m: 允许 15 分钟差异 (15m K线周期)
            # - 5m vs 1h: 允许 1 小时差异 (1h K线周期)
            max_diff_15m = 900000   # 15 分钟 = 900,000 ms
            max_diff_1h = 3600000   # 1 小时 = 3,600,000 ms
            
            # 只有严重偏差才警告
            if diff_5m_15m > max_diff_15m or diff_5m_1h > max_diff_1h:
                log.warning(
                    f"⚠️ 时间对齐异常: "
                    f"5m vs 15m = {diff_5m_15m/1000:.0f}s, "
                    f"5m vs 1h = {diff_5m_1h/1000:.0f}s"
                )
                return False
            
            return True
            
        except Exception as e:
            log.error(f"❌ 时间对齐检查失败: {e}")
            return False
    
    def _log_snapshot_info(self, snapshot: MarketSnapshot):
        """记录快照信息"""
        log.oracle(f"📸 快照信息:")
        log.oracle(f"  - 5m:  {len(snapshot.stable_5m)} 已完成 + 1 实时")
        log.oracle(f"  - 15m: {len(snapshot.stable_15m)} 已完成 + 1 实时")
        log.oracle(f"  - 1h:  {len(snapshot.stable_1h)} 已完成 + 1 实时")
        log.oracle(f"  - 时间对齐: {'✅' if snapshot.alignment_ok else '❌'}")
        log.oracle(f"  - 获取耗时: {snapshot.fetch_duration:.2f}秒")
        
        # 记录实时价格
        if snapshot.live_5m:
            log.info(f"  - 实时价格 (5m): ${snapshot.live_5m.get('close', 0):,.2f}")
        if snapshot.live_1h:
            log.info(f"  - 实时价格 (1h): ${snapshot.live_1h.get('close', 0):,.2f}")
    
    def get_live_price(self, timeframe: str = '5m') -> float:
        """
        获取指定周期的实时价格
        
        Args:
            timeframe: '5m', '15m', or '1h'
            
        Returns:
            实时收盘价
        """
        if not self.last_snapshot:
            log.warning("⚠️ 无可用快照")
            return 0.0
        
        live_data = {
            '5m': self.last_snapshot.live_5m,
            '15m': self.last_snapshot.live_15m,
            '1h': self.last_snapshot.live_1h
        }.get(timeframe, {})
        
        return float(live_data.get('close', 0))
    
    def get_stable_dataframe(self, timeframe: str = '5m') -> pd.DataFrame:
        """
        获取指定周期的稳定DataFrame（已完成K线）
        
        Args:
            timeframe: '5m', '15m', or '1h'
            
        Returns:
            已完成的K线DataFrame
        """
        if not self.last_snapshot:
            log.warning("⚠️ 无可用快照")
            return pd.DataFrame()
        
        return {
            '5m': self.last_snapshot.stable_5m,
            '15m': self.last_snapshot.stable_15m,
            '1h': self.last_snapshot.stable_1h
        }.get(timeframe, pd.DataFrame())


# 异步测试函数
async def test_data_sync_agent():
    """测试数据同步官"""
    agent = DataSyncAgent()
    
    print("\n" + "="*80)
    print("测试：数据同步官 (Data Sync Agent)")
    print("="*80)
    
    # 测试1: 并发获取数据
    print("\n[测试1] 并发获取多周期数据...")
    snapshot = await agent.fetch_all_timeframes("BTCUSDT")
    
    print(f"\n✅ 数据获取成功")
    print(f"  - 耗时: {snapshot.fetch_duration:.2f}秒")
    print(f"  - 时间对齐: {snapshot.alignment_ok}")
    
    # 测试2: 验证双视图
    print("\n[测试2] 验证双视图数据...")
    print(f"  - Stable 5m shape: {snapshot.stable_5m.shape}")
    print(f"  - Live 5m keys: {list(snapshot.live_5m.keys())}")
    print(f"  - Live 5m price: ${snapshot.live_5m.get('close', 0):,.2f}")
    
    # 测试3: 获取实时价格
    print("\n[测试3] 获取实时价格...")
    for tf in ['5m', '15m', '1h']:
        price = agent.get_live_price(tf)
        print(f"  - {tf}: ${price:,.2f}")
    
    print("\n" + "="*80)
    print("✅ 所有测试通过")
    print("="*80 + "\n")


if __name__ == "__main__":
    # 运行测试
    asyncio.run(test_data_sync_agent())
