"""
历史数据回放器 (Data Replay Agent)
===================================

模拟 DataSyncAgent，从历史数据生成 MarketSnapshot
用于回测时提供与实盘相同的数据接口

Author: AI Trader Team
Date: 2025-12-31
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Iterator, Optional, Tuple
from dataclasses import dataclass, field
import pandas as pd
import numpy as np
import os

from src.api.binance_client import BinanceClient
from src.agents.data_sync_agent import MarketSnapshot
from src.utils.logger import log


@dataclass
class FundingRateRecord:
    """资金费率记录"""
    timestamp: datetime
    funding_rate: float
    mark_price: float


@dataclass
class DataCache:
    """历史数据缓存"""
    symbol: str
    df_5m: pd.DataFrame
    df_15m: pd.DataFrame
    df_1h: pd.DataFrame
    start_date: datetime
    end_date: datetime
    funding_rates: List['FundingRateRecord'] = field(default_factory=list)  # 资金费率历史



class DataReplayAgent:
    """
    历史数据回放器
    
    功能：
    1. 从 Binance 获取历史 K 线数据
    2. 本地缓存（Parquet 格式）
    3. 在指定时间点生成 MarketSnapshot
    4. 模拟实时数据流用于回测
    """
    
    CACHE_DIR = "data/backtest_cache"
    
    def __init__(
        self,
        symbol: str,
        start_date: str,
        end_date: str,
        client: BinanceClient = None
    ):
        """
        初始化数据回放器
        
        Args:
            symbol: 交易对 (e.g., "BTCUSDT")
            start_date: 开始日期 "YYYY-MM-DD"
            end_date: 结束日期 "YYYY-MM-DD"
            client: Binance 客户端（可选）
        """
        self.symbol = symbol
        self.start_date = datetime.strptime(start_date, "%Y-%m-%d")
        # CRITICAL FIX: Add 1 day to end_date to include all K-lines from that day
        # end_date "2026-01-01" becomes "2026-01-02 00:00:00", so filter with < includes all of 2026-01-01
        self.end_date = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
        self.client = client or BinanceClient()
        
        # 数据缓存
        self.data_cache: Optional[DataCache] = None
        
        # 当前回放位置
        self.current_idx = 0
        self.timestamps: List[datetime] = []
        
        # 最新快照（模拟 DataSyncAgent.latest_snapshot）
        self.latest_snapshot: Optional[MarketSnapshot] = None
        
        # 确保缓存目录存在
        os.makedirs(self.CACHE_DIR, exist_ok=True)
        
        log.info(f"📼 DataReplayAgent initialized | {symbol} | {start_date} to {end_date}")
    
    async def load_data(self) -> bool:
        """
        加载历史数据（优先从缓存读取）
        
        Returns:
            是否成功加载
        """
        cache_file = self._get_cache_path()
        
        # 尝试从缓存加载
        if os.path.exists(cache_file):
            log.info(f"📂 Loading cached data from {cache_file}")
            try:
                self._load_from_cache(cache_file)
                log.info(f"✅ Loaded {len(self.timestamps)} timestamps from cache")
                return True
            except Exception as e:
                log.warning(f"Cache load failed: {e}, fetching from API...")
        
        # 从 API 获取
        log.info(f"📥 Fetching historical data from Binance API...")
        try:
            await self._fetch_from_api()
            # 保存到缓存
            self._save_to_cache(cache_file)
            log.info(f"✅ Fetched and cached {len(self.timestamps)} timestamps")
            return True
        except Exception as e:
            log.error(f"❌ Failed to fetch historical data: {e}")
            return False
    
    def _get_cache_path(self) -> str:
        """生成缓存文件路径"""
        start_str = self.start_date.strftime("%Y%m%d")
        # Use the original end_date for cache file name, not the extended one
        original_end_date_str = (self.end_date - timedelta(days=1)).strftime("%Y%m%d")
        return os.path.join(
            self.CACHE_DIR,
            f"{self.symbol}_{start_str}_{original_end_date_str}.parquet"
        )
    
    async def _fetch_from_api(self):
        """从 Binance API 获取历史数据"""
        # 计算需要的 K 线数量
        # Use the original end_date for calculation, not the extended one
        days = (self.end_date - timedelta(days=1) - self.start_date).days + 1
        
        # 5m K线：每天 288 根
        limit_5m = days * 288
        # 15m K线：每天 96 根
        limit_15m = days * 96
        # 1h K线：每天 24 根
        limit_1h = days * 24
        
        # Binance API 限制单次最多 1500 根，需要分批获取
        df_5m = await self._fetch_klines_batched("5m", limit_5m)
        df_15m = await self._fetch_klines_batched("15m", limit_15m)
        df_1h = await self._fetch_klines_batched("1h", limit_1h)
        
        # 获取资金费率历史
        funding_rates = await self._fetch_funding_rates()
        
        # 过滤日期范围
        df_5m = self._filter_date_range(df_5m)
        df_15m = self._filter_date_range(df_15m)
        df_1h = self._filter_date_range(df_1h)
        
        # 创建缓存对象
        self.data_cache = DataCache(
            symbol=self.symbol,
            df_5m=df_5m,
            df_15m=df_15m,
            df_1h=df_1h,
            start_date=self.start_date,
            end_date=self.end_date,
            funding_rates=funding_rates
        )
        
        # 生成时间戳列表（基于 5m K线）
        self.timestamps = df_5m.index.tolist()
        
        log.info(f"   5m: {len(df_5m)} candles")
        log.info(f"   15m: {len(df_15m)} candles")
        log.info(f"   1h: {len(df_1h)} candles")
        log.info(f"   Funding rates: {len(funding_rates)} records")
    
    async def _fetch_funding_rates(self) -> List[FundingRateRecord]:
        """获取资金费率历史数据"""
        funding_records = []
        
        try:
            # 计算时间范围
            start_ts = int(self.start_date.timestamp() * 1000)
            end_ts = int(self.end_date.timestamp() * 1000)
            
            # Binance API 每次最多返回 1000 条
            current_start = start_ts
            
            while current_start < end_ts:
                funding_data = self.client.client.futures_funding_rate(
                    symbol=self.symbol,
                    startTime=current_start,
                    endTime=end_ts,
                    limit=1000
                )
                
                if not funding_data:
                    break
                
                for record in funding_data:
                    fr = FundingRateRecord(
                        timestamp=datetime.fromtimestamp(record['fundingTime'] / 1000),
                        funding_rate=float(record['fundingRate']),
                        mark_price=float(record.get('markPrice', 0))
                    )
                    funding_records.append(fr)
                
                if len(funding_data) < 1000:
                    break
                
                # 下一批从最后一条时间 +1 开始
                current_start = funding_data[-1]['fundingTime'] + 1
                await asyncio.sleep(0.1)  # 避免请求过快
            
            log.info(f"📊 Fetched {len(funding_records)} funding rate records")
            
        except Exception as e:
            log.warning(f"⚠️ Failed to fetch funding rates: {e}")
        
        return funding_records
    
    async def _fetch_klines_batched(self, interval: str, total_limit: int) -> pd.DataFrame:
        """分批获取 K 线数据"""
        all_klines = []
        batch_size = 1000  # Binance 推荐的批次大小
        
        # 计算结束时间戳
        end_ts = int(self.end_date.timestamp() * 1000)
        
        remaining = total_limit
        current_end = end_ts
        
        while remaining > 0:
            limit = min(batch_size, remaining)
            
            try:
                klines = self.client.client.futures_klines(
                    symbol=self.symbol,
                    interval=interval,
                    endTime=current_end,
                    limit=limit
                )
                
                if not klines:
                    break
                
                all_klines = klines + all_klines  # 倒序插入
                
                # 更新下一批的结束时间（取最早一根的开始时间 - 1）
                current_end = klines[0][0] - 1
                remaining -= len(klines)
                
                # 避免请求过快
                await asyncio.sleep(0.1)
                
            except Exception as e:
                log.warning(f"Batch fetch error: {e}")
                break
        
        # 转换为 DataFrame
        return self._klines_to_dataframe(all_klines)
    
    def _klines_to_dataframe(self, klines: List) -> pd.DataFrame:
        """将 K 线列表转换为 DataFrame"""
        if not klines:
            return pd.DataFrame()
        
        df = pd.DataFrame(klines, columns=[
            'timestamp', 'open', 'high', 'low', 'close', 'volume',
            'close_time', 'quote_volume', 'trades', 'taker_buy_base',
            'taker_buy_quote', 'ignore'
        ])
        
        # 转换数据类型
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df.set_index('timestamp', inplace=True)
        
        for col in ['open', 'high', 'low', 'close', 'volume', 'quote_volume']:
            df[col] = df[col].astype(float)
        
        df['trades'] = df['trades'].astype(int)
        
        return df[['open', 'high', 'low', 'close', 'volume', 'quote_volume', 'trades']]
    
    def _filter_date_range(self, df: pd.DataFrame) -> pd.DataFrame:
        """过滤日期范围"""
        if df.empty:
            return df
        # Use < instead of <= since end_date is now start of next day
        return df[(df.index >= self.start_date) & (df.index < self.end_date)]
    
    def _save_to_cache(self, cache_path: str):
        """保存数据到缓存"""
        if self.data_cache is None:
            return
        
        # 合并所有数据
        cache_data = {
            'df_5m': self.data_cache.df_5m,
            'df_15m': self.data_cache.df_15m,
            'df_1h': self.data_cache.df_1h,
            'funding_rates': [
                {'timestamp': fr.timestamp, 'funding_rate': fr.funding_rate, 'mark_price': fr.mark_price}
                for fr in self.data_cache.funding_rates
            ],
        }
        
        # 使用 pickle 保存（支持多个 DataFrame）
        import pickle
        with open(cache_path, 'wb') as f:
            pickle.dump(cache_data, f)
    
    def _load_from_cache(self, cache_path: str):
        """从缓存加载数据"""
        import pickle
        with open(cache_path, 'rb') as f:
            cache_data = pickle.load(f)
        
        # 加载资金费率（兼容旧缓存）
        funding_rates = []
        if 'funding_rates' in cache_data:
            for fr_dict in cache_data['funding_rates']:
                funding_rates.append(FundingRateRecord(
                    timestamp=fr_dict['timestamp'],
                    funding_rate=fr_dict['funding_rate'],
                    mark_price=fr_dict.get('mark_price', 0)
                ))
        
        self.data_cache = DataCache(
            symbol=self.symbol,
            df_5m=cache_data['df_5m'],
            df_15m=cache_data['df_15m'],
            df_1h=cache_data['df_1h'],
            start_date=self.start_date,
            end_date=self.end_date,
            funding_rates=funding_rates
        )
        
        self.timestamps = self.data_cache.df_5m.index.tolist()
    
    def get_snapshot_at(self, timestamp: datetime, lookback: int = 300) -> MarketSnapshot:
        """
        获取指定时间点的市场快照
        
        Args:
            timestamp: 目标时间点
            lookback: 回看的 K 线数量
            
        Returns:
            MarketSnapshot 对象（与 DataSyncAgent 兼容）
        """
        if self.data_cache is None:
            raise ValueError("Data not loaded. Call load_data() first.")
        
        # 获取截止到 timestamp 的数据
        df_5m = self.data_cache.df_5m[self.data_cache.df_5m.index <= timestamp].tail(lookback)
        df_15m = self.data_cache.df_15m[self.data_cache.df_15m.index <= timestamp].tail(lookback // 3)
        df_1h = self.data_cache.df_1h[self.data_cache.df_1h.index <= timestamp].tail(lookback // 12)
        
        # Stable view: 排除最后一根（未完成）
        # Live view: 最后一根（作为 Dict）
        live_5m_dict = df_5m.iloc[-1].to_dict() if len(df_5m) > 0 else {}
        live_15m_dict = df_15m.iloc[-1].to_dict() if len(df_15m) > 0 else {}
        live_1h_dict = df_1h.iloc[-1].to_dict() if len(df_1h) > 0 else {}
        
        snapshot = MarketSnapshot(
            stable_5m=df_5m.iloc[:-1] if len(df_5m) > 1 else df_5m,
            stable_15m=df_15m.iloc[:-1] if len(df_15m) > 1 else df_15m,
            stable_1h=df_1h.iloc[:-1] if len(df_1h) > 1 else df_1h,
            live_5m=live_5m_dict,
            live_15m=live_15m_dict,
            live_1h=live_1h_dict,
            timestamp=timestamp,
            alignment_ok=True,
            fetch_duration=0.0
        )
        
        self.latest_snapshot = snapshot
        return snapshot
    
    def iterate_timestamps(self, step: int = 1) -> Iterator[datetime]:
        """
        迭代所有回测时间点
        
        Args:
            step: 步长（1 = 每 5 分钟，3 = 每 15 分钟，12 = 每小时）
            
        Yields:
            datetime 时间点
        """
        for i in range(0, len(self.timestamps), step):
            self.current_idx = i
            yield self.timestamps[i]
    
    def get_current_price(self) -> float:
        """
        获取当前价格
        
        CRITICAL FIX (Cycle 2):
        防止 Look-ahead Bias：
        返回当前 K 线的 Open 价格，而不是 Close 价格。
        在回测时刻 T，我们只能看到 T 时刻的开盘价，看不到 T+5m 的收盘价。
        """
        if self.latest_snapshot is None:
            return 0.0
        
        live = self.latest_snapshot.live_5m
        if isinstance(live, dict):
            # 使用 OPEN 价格
            return float(live.get('open', 0.0))
        elif hasattr(live, 'empty') and not live.empty:
            # 使用 OPEN 价格
            return float(live['open'].iloc[-1])
        return 0.0
    
    def get_open_price(self) -> float:
        """
        获取当前 K 线的开盘价
        
        用于防止 Look-ahead Bias：
        - 信号计算使用 bar[i-1] 的数据
        - 交易执行使用 bar[i] 的开盘价
        """
        if self.latest_snapshot is None:
            return 0.0
        
        live = self.latest_snapshot.live_5m
        if isinstance(live, dict):
            return float(live.get('open', 0.0))
        elif hasattr(live, 'empty') and not live.empty:
            return float(live['open'].iloc[-1])
        return 0.0
    
    def get_previous_close_price(self) -> float:
        """
        获取上一根 K 线的收盘价
        
        用于 Look-ahead Bias 防护的信号计算
        """
        if self.latest_snapshot is None:
            return 0.0
        
        stable = self.latest_snapshot.stable_5m
        if hasattr(stable, 'empty') and not stable.empty:
            return float(stable['close'].iloc[-1])
        return self.get_open_price()
    
    def get_progress(self) -> Tuple[int, int, float]:
        """获取回放进度"""
        total = len(self.timestamps)
        current = self.current_idx
        pct = (current / total * 100) if total > 0 else 0
        return current, total, pct
    
    def get_funding_rate_at(self, timestamp: datetime) -> Optional[FundingRateRecord]:
        """
        获取指定时间点或之前最近的资金费率
        
        Binance 资金费率每 8 小时结算（UTC 00:00, 08:00, 16:00）
        """
        if self.data_cache is None or not self.data_cache.funding_rates:
            return None
        
        # 找到时间戳之前最近的资金费率
        latest_fr = None
        for fr in self.data_cache.funding_rates:
            if fr.timestamp <= timestamp:
                latest_fr = fr
            else:
                break
        
        return latest_fr
    
    def is_funding_settlement_time(self, timestamp: datetime) -> bool:
        """
        检查是否是资金费率结算时间
        
        Binance 合约资金费率结算时间：UTC 00:00, 08:00, 16:00
        """
        utc_hour = (timestamp.hour - 8) % 24  # 假设本地时区为 UTC+8
        utc_minute = timestamp.minute
        
        # 检查是否为结算时刻（允许几分钟误差）
        if utc_hour in [0, 8, 16] and utc_minute < 10:
            return True
        return False
    
    def get_funding_rate_for_settlement(self, timestamp: datetime) -> Optional[float]:
        """
        获取结算时刻适用的资金费率（仅在结算时刻返回，否则返回None）
        """
        if not self.is_funding_settlement_time(timestamp):
            return None
        
        fr = self.get_funding_rate_at(timestamp)
        if fr and abs((fr.timestamp - timestamp).total_seconds()) < 600:  # 10分钟内
            return fr.funding_rate
        return None
    
    # ========== DataSyncAgent 兼容接口 ==========
    
    async def fetch_all_timeframes(self, symbol: str = None, limit: int = 300) -> MarketSnapshot:
        """
        兼容 DataSyncAgent.fetch_all_timeframes 接口
        
        在回测模式下，返回当前时间点的快照
        """
        if self.current_idx < len(self.timestamps):
            timestamp = self.timestamps[self.current_idx]
            return self.get_snapshot_at(timestamp, lookback=limit)
        else:
            raise IndexError("Replay finished, no more data")
    
    def get_live_price(self, timeframe: str = '5m') -> float:
        """兼容 DataSyncAgent.get_live_price 接口"""
        return self.get_current_price()
    
    def get_stable_dataframe(self, timeframe: str = '5m') -> pd.DataFrame:
        """兼容 DataSyncAgent.get_stable_dataframe 接口"""
        if self.latest_snapshot is None:
            return pd.DataFrame()
        
        if timeframe == '5m':
            return self.latest_snapshot.stable_5m
        elif timeframe == '15m':
            return self.latest_snapshot.stable_15m
        elif timeframe == '1h':
            return self.latest_snapshot.stable_1h
        else:
            return self.latest_snapshot.stable_5m


# 测试函数
async def test_data_replay():
    """测试数据回放器"""
    print("\n" + "=" * 60)
    print("🧪 Testing DataReplayAgent")
    print("=" * 60)
    
    # 创建回放器（测试 7 天数据）
    replay = DataReplayAgent(
        symbol="BTCUSDT",
        start_date="2024-12-01",
        end_date="2024-12-07"
    )
    
    # 加载数据
    success = await replay.load_data()
    print(f"\n✅ Data loaded: {success}")
    
    if success:
        # 迭代前 5 个时间点
        print("\n📊 First 5 timestamps:")
        for i, ts in enumerate(replay.iterate_timestamps()):
            if i >= 5:
                break
            snapshot = replay.get_snapshot_at(ts)
            price = replay.get_current_price()
            print(f"   {i+1}. {ts} | Price: ${price:.2f}")
        
        # 显示进度
        current, total, pct = replay.get_progress()
        print(f"\n📈 Progress: {current}/{total} ({pct:.1f}%)")
    
    print("\n✅ DataReplayAgent test complete!")


if __name__ == "__main__":
    asyncio.run(test_data_replay())
