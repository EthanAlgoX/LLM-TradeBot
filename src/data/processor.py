"""
市场数据处理模块
"""
import pandas as pd
import numpy as np
import uuid
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from ta.trend import SMAIndicator, EMAIndicator, MACD
from ta.momentum import RSIIndicator, StochasticOscillator
from ta.volatility import BollingerBands, AverageTrueRange
from ta.volume import VolumeWeightedAveragePrice
from src.utils.logger import log
from src.utils.data_saver import DataSaver
from src.data.kline_validator import KlineValidator

class MarketDataProcessor:
    """市场数据处理器"""
    
    # 指标计算参数（透明化）
    INDICATOR_PARAMS = {
        'sma': [20, 50],
        'ema': [12, 26],
        'macd': {'fast': 12, 'slow': 26, 'signal': 9},
        'rsi': {'period': 14},
        'bollinger': {'period': 20, 'std_dev': 2},
        'atr': {'period': 14},
        'volume_sma': {'period': 20}
    }
    
    # 处理器版本（用于快照追踪）
    PROCESSOR_VERSION = 'processor_v2'

    def __init__(self):
        self.df_cache: Dict[str, pd.DataFrame] = {}
        self.validator = KlineValidator()
        self.saver = DataSaver()  # ✅ 初始化数据保存器
        self.last_snapshot_id: Optional[str] = None
        self.last_snapshot_data: Optional[Dict] = None
    
    def process_klines(
        self, 
        klines: List[Dict], 
        symbol: str, 
        timeframe: str,
        validate: bool = True
    ) -> pd.DataFrame:
        """
        处理K线数据，计算技术指标
        
        Args:
            klines: K线原始数据
            symbol: 交易对
            timeframe: 时间周期
            validate: 是否进行数据验证和清洗
            
        Returns:
            包含技术指标的DataFrame
        """
        if not klines:
            log.warning(f"[{symbol}] K线数据为空: {timeframe}")
            return pd.DataFrame()
        
        # ✅ Save Step 1: 原始K线数据
        self.saver.save_step1_klines(klines, symbol, timeframe)
        
        n_original = len(klines)
        
        # 1. 数据验证和清洗
        anomaly_details = None
        if validate:
            klines, validation_report = self.validator.validate_and_clean_klines(
                klines, 
                symbol,
                action='remove'
            )
            
            anomaly_details = {
                'removed_count': validation_report.get('removed_count', 0),
                'issues': validation_report.get('issues', []),
                'method': validation_report.get('method', 'Integrity-Check-Only')
            }
            
            if validation_report.get('removed_count', 0) > 0:
                log.warning(
                    f"[{symbol}] 数据验证: 原始={n_original}, "
                    f"清洗后={len(klines)}, "
                    f"删除={validation_report['removed_count']}, "
                    f"方法={validation_report['method']}"
                )
        
        # 2. 检查数据量是否足够
        required_bars = max(self.INDICATOR_PARAMS['sma'])  # 50
        if len(klines) < required_bars:
            log.error(
                f"[{symbol}] K线数量不足: 需要>={required_bars}, "
                f"实际={len(klines)}"
            )
            return pd.DataFrame()
        
        log.debug(
            f"[{symbol}] 处理K线: timeframe={timeframe}, "
            f"bars={len(klines)}, params={self.INDICATOR_PARAMS}"
        )
        
        # 3. 转换为DataFrame
        df = pd.DataFrame(klines)
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df.set_index('timestamp', inplace=True)
        
        # 4. 计算技术指标
        df = self._calculate_indicators(df)
        
        # 5. 添加指标 warm-up 标记
        df = self._mark_warmup_period(df)
        
        # 6. 生成快照ID
        snapshot_id = str(uuid.uuid4())[:8]
        df['snapshot_id'] = snapshot_id
        
        # ✅ Save Step 2: 技术指标数据
        self.saver.save_step2_indicators(df, symbol, timeframe, snapshot_id)
        
        # 7. 缓存
        cache_key = f"{symbol}_{timeframe}"
        self.df_cache[cache_key] = df
        
        # 8. 记录最后快照信息
        self.last_snapshot_id = snapshot_id
        latest = df.iloc[-1]
        self.last_snapshot_data = {
            'snapshot_id': snapshot_id,
            'timestamp': latest.name,
            'symbol': symbol,
            'timeframe': timeframe,
            'close': float(latest['close']),
            'volume': float(latest['volume']),
            'n_bars_used': len(df),
            'min_valid_index': self._get_min_valid_index(),
            'anomaly_details': anomaly_details
        }
        
        log.debug(
            f"[{symbol}] 快照生成: id={snapshot_id}, "
            f"timestamp={latest.name}, price={latest['close']:.2f}"
        )
        
        return df

    def get_market_state(self, df: pd.DataFrame) -> Dict:
        """获取市场状态摘要"""
        if df.empty:
            return {}
        
        latest = df.iloc[-1]
        
        # 基础指标
        state = {
            'timestamp': str(latest.name),
            'close': float(latest['close']),
            'price': float(latest['close']),
            'trend': self.detect_trend(df),
            'volatility': self.detect_volatility(df),
            'momentum': self.detect_momentum(df),
            'rsi': float(latest.get('rsi', 0)),
            'macd': float(latest.get('macd', 0)),
            'macd_signal': 'buy' if latest.get('macd', 0) > latest.get('macd_signal', 0) else 'sell',
            'volume_ratio': float(latest.get('volume_ratio', 1.0)),
            'volume_change_pct': 0.0,
            'atr_pct': float(latest.get('atr', 0)) / float(latest['close']) * 100 if latest['close'] != 0 else 0,
            'key_levels': self.find_support_resistance(df),
            'snapshot_id': latest.get('snapshot_id', 'unknown'),
            'indicator_completeness': self.check_indicator_completeness(df)
        }
        
        # Calculate volume change
        if len(df) >= 2:
            prev_vol = df['volume'].iloc[-2]
            curr_vol = df['volume'].iloc[-1]
            if prev_vol > 0:
                state['volume_change_pct'] = (curr_vol - prev_vol) / prev_vol * 100
        
        return state
    
    def _calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """计算技术指标"""
        
        # 移动平均线
        df['sma_20'] = SMAIndicator(close=df['close'], window=20).sma_indicator()
        df['sma_50'] = SMAIndicator(close=df['close'], window=50).sma_indicator()
        df['ema_12'] = EMAIndicator(close=df['close'], window=12).ema_indicator()
        df['ema_26'] = EMAIndicator(close=df['close'], window=26).ema_indicator()
        
        # MACD - 经典价差定义（恢复标准，2025-12-18修复）
        # 保存原始MACD价差（单位: USDT），符合经典技术分析定义
        # MACD = EMA12 - EMA26（价格差），非百分比
        # 参考: https://www.investopedia.com/terms/m/macd.asp
        macd_indicator = MACD(close=df['close'])
        df['macd'] = macd_indicator.macd()              # MACD线（价差，USDT）
        df['macd_signal'] = macd_indicator.macd_signal()  # 信号线（价差，USDT）
        df['macd_diff'] = macd_indicator.macd_diff()     # 柱状图（价差，USDT）
        
        # 注意: 归一化应在Step3特征工程中进行，而非Step2技术指标计算
        # 若需要归一化版本，请在特征工程部分添加：
        #   df['macd_pct'] = (df['macd'] / df['close']) * 100
        
        # RSI
        df['rsi'] = RSIIndicator(close=df['close'], window=14).rsi()
        
        # 布林带
        bb = BollingerBands(close=df['close'], window=20, window_dev=2)
        df['bb_upper'] = bb.bollinger_hband()
        df['bb_middle'] = bb.bollinger_mavg()
        df['bb_lower'] = bb.bollinger_lband()
        # 安全计算 bb_width，避免除以0
        df['bb_width'] = np.where(
            df['bb_middle'] > 0,
            (df['bb_upper'] - df['bb_lower']) / df['bb_middle'],
            np.nan
        )
        
        # ATR (波动率) - 修复前期 0 值问题
        # 先计算 True Range
        df['prev_close'] = df['close'].shift(1)
        df['tr1'] = df['high'] - df['low']
        df['tr2'] = abs(df['high'] - df['prev_close'])
        df['tr3'] = abs(df['low'] - df['prev_close'])
        df['true_range'] = df[['tr1', 'tr2', 'tr3']].max(axis=1)
        
        # 使用 ta 库计算 ATR
        atr_indicator = AverageTrueRange(
            high=df['high'],
            low=df['low'],
            close=df['close'],
            window=14
        )
        df['atr'] = atr_indicator.average_true_range()
        
        # 修复前 13 根 K 线的 ATR=0 问题
        # 用全局 True Range 的 EMA 来填充（更稳定）
        mask = df['atr'] == 0
        if mask.any():
            # 使用全局 True Range 的 EMA 来填充前期值
            tr_ema = df['true_range'].ewm(span=14, adjust=False).mean()
            df.loc[mask, 'atr'] = tr_ema[mask]
        
        # 清理临时列
        df.drop(['prev_close', 'tr1', 'tr2', 'tr3', 'true_range'], axis=1, inplace=True)
        
        # 成交量指标
        df['volume_sma'] = df['volume'].rolling(window=20).mean()
        # 安全计算 volume_ratio，避免除以0和NaN
        df['volume_ratio'] = np.where(
            (df['volume_sma'].notna()) & (df['volume_sma'] > 0),
            df['volume'] / df['volume_sma'],
            1.0  # 默认值1表示正常水平
        )
        
        # OBV (On Balance Volume)
        # OBV = 累积的(成交量 × 价格方向)
        # 价格上涨时加成交量，价格下跌时减成交量
        df['obv'] = (df['volume'] * np.sign(df['close'].diff())).fillna(0).cumsum()
        
        # VWAP - 使用20期滚动窗口（符合量化策略需求）
        # 修复原有全局累积逻辑，改为滚动窗口更有实际意义
        window = 20
        df['price_volume'] = df['close'] * df['volume']
        rolling_pv = df['price_volume'].rolling(window=window).sum()
        rolling_vol = df['volume'].rolling(window=window).sum()
        
        # 安全计算 VWAP，避免除以0
        df['vwap'] = np.where(
            rolling_vol > 0,
            rolling_pv / rolling_vol,
            df['close']  # 如果成交量为0，用close代替
        )
        df.drop('price_volume', axis=1, inplace=True)
        
        # 价格变化
        df['price_change_pct'] = df['close'].pct_change() * 100
        # 安全计算高低点振幅，避免除以0
        df['high_low_range'] = np.where(
            df['close'] > 0,
            (df['high'] - df['low']) / df['close'] * 100,
            0.0
        )
        
        return df
    
    def _mark_warmup_period(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        标记指标 warm-up 期，前期指标不稳定的数据应避免用于交易决策
        
        ✅ 修正：Warmup 期从 50 提升到 105 根，确保 MACD 完全收敛
        
        计算逻辑（基于 EMA 收敛理论）：
        - EMA 收敛公式：需要 3×周期 才能达到 95% 权重累积
        - EMA12: 3×12 = 36 根
        - EMA26: 3×26 = 78 根
        - MACD = EMA12 - EMA26，需要 78 根才稳定
        - MACD Signal = EMA9(MACD)，需要额外 3×9 = 27 根
        - **MACD 完全稳定需要：78 + 27 = 105 根**
        
        原问题：
        - 前 50 根标记为 warmup，第 51 根即认为 is_valid=True
        - 但此时 MACD/Signal 尚未完全收敛，数值有偏差
        - 导致 Step4 趋势判断基于伪稳定数据，产生错误信号
        
        修正方案：
        - Warmup 期提升至 105 根（保守策略）
        - 第 106 根及以后才标记 is_valid=True
        - 确保所有技术指标（SMA/EMA/MACD/RSI/ATR）完全稳定
        
        Returns:
            添加 is_valid 和 is_warmup 列的 DataFrame
        """
        # ✅ 核心修正：MACD 完全收敛需要 105 根
        # 计算方式：EMA26 收敛(78) + Signal EMA9 收敛(27) = 105
        WARMUP_PERIOD = 105  # ✅ 从 50 提升至 105
        
        # 保留原有逻辑作为最小值检查（防御性编程）
        min_bars_needed = max(
            max(self.INDICATOR_PARAMS['sma']),      # 50
            self.INDICATOR_PARAMS['macd']['slow'] + self.INDICATOR_PARAMS['macd']['signal'],  # 26 + 9 = 35
            self.INDICATOR_PARAMS['atr']['period']  # 14
        )
        
        # 使用更严格的 WARMUP_PERIOD
        effective_warmup = max(min_bars_needed, WARMUP_PERIOD)  # 结果必然是 105
        
        # 标记 warmup 期（前 effective_warmup 根）
        df['is_warmup'] = True
        df['is_valid'] = False
        
        if len(df) > effective_warmup:
            # ✅ 只有第 106 根及以后的数据才是有效的（索引 105+）
            df.iloc[effective_warmup:, df.columns.get_loc('is_warmup')] = False
            df.iloc[effective_warmup:, df.columns.get_loc('is_valid')] = True
            
        # 记录有效数据的起始索引
        self._min_valid_index = effective_warmup
        
        # 日志输出
        valid_count = df['is_valid'].sum()
        log.debug(
            f"✅ Warm-up标记（修正版）: 总数={len(df)}, "
            f"warm-up期={effective_warmup}根（MACD完全收敛）, "
            f"有效数据={valid_count}根"
        )
        
        return df
    
    def _get_min_valid_index(self) -> int:
        """获取最小有效索引（warm-up 边界）"""
        return getattr(self, '_min_valid_index', 50)  # 默认 50
    
    # === 新增辅助函数（步骤3相关） ===
    def _safe_div(self, numer: pd.Series, denom, eps: float = 1e-9, fill: float = 0.0) -> pd.Series:
        """安全除法，避免除以0或非常小数值导致 inf/NaN。

        denom 可以是 Series，也可以是标量（float/int）。
        """
        if numer is None:
            return pd.Series(dtype=float)

        # 处理标量 denom
        if isinstance(denom, (int, float, np.floating, np.integer)):
            denom_safe = pd.Series(float(denom), index=numer.index)
        else:
            # 尝试将 denom 转为 Series
            denom_safe = pd.Series(denom, index=numer.index).astype(float)

        small = denom_safe.abs() < eps
        denom_safe[small] = eps
        res = numer.astype(float) / denom_safe
        res = res.where(~small, fill)
        return res

    def _winsorize(self, s: pd.Series, lower_q: float = 0.01, upper_q: float = 0.99) -> pd.Series:
        """按分位数截断极端值（非破坏性）。"""
        if s.dropna().empty:
            return s
        lo = s.quantile(lower_q)
        hi = s.quantile(upper_q)
        return s.clip(lower=lo, upper=hi)

    def _check_time_gaps(self, df: pd.DataFrame, freq_minutes: int = 5, allowed_gap_bars: int = 2) -> Tuple[pd.DataFrame, pd.Series]:
        """检查并对小的时间缺口进行有限制地插值填充。

        返回值： (df_reindexed, imputed_mask)
        - df_reindexed: 重新索引并在小 gap 上插值后的 DataFrame
        - imputed_mask: 布尔 Series 标记哪些行是插值产生的
        """
        if df.empty:
            return df.copy(), pd.Series(False, dtype=bool)

        start = df.index.min()
        end = df.index.max()
        full_index = pd.date_range(start=start, end=end, freq=f'{freq_minutes}T')
        df_re = df.reindex(full_index)

        # 尝试推断对象类型为数值，减少 future warning
        try:
            df_re = df_re.infer_objects(copy=False)
        except Exception:
            pass

        # 标记原始缺失位置
        orig_na = df_re['close'].isna()

        # 只对小 gap 进行线性时间插值（limit=allowed_gap_bars）
        # 使用 method='time' 要求 DatetimeIndex
        df_re.interpolate(method='time', limit=allowed_gap_bars, inplace=True)

        # 标记插值成功的行（原本是NaN，现在有值）
        imputed_mask = orig_na.astype(bool) & df_re['close'].notna().astype(bool)

        # 记录 imputed 标识（便于下游过滤）
        df_re['is_imputed'] = imputed_mask

        return df_re, imputed_mask

    def extract_feature_snapshot(
        self,
        df: pd.DataFrame,
        lookback: int = 48,
        min_fraction: float = 0.5,
        winsor_limits: Tuple[float, float] = (0.01, 0.99),
        freq_minutes: int = 5,
        allowed_gap_bars: int = 2,
        feature_version: str = 'v1'
    ) -> pd.DataFrame:
        """从已计算指标的K线DataFrame中提取特征快照（逐行或最新行）。

        设计原则：
        - 不在特征计算中使用未来数据
        - 对除法操作进行安全处理
        - 对小 gap 允许有限的插值，但标记 is_imputed
        - 输出包含 feature_version、is_feature_valid、warm_up_bars_remaining
        """
        if df.empty:
            return pd.DataFrame()

        # 1) 时间对齐与小 gap 处理
        df_checked, imputed_mask = self._check_time_gaps(df, freq_minutes=freq_minutes, allowed_gap_bars=allowed_gap_bars)

        # 2) 准备窗口参数
        L = int(lookback)
        min_periods = int(max(1, L * min_fraction))

        # 3) 计算滚动特征（使用滚动窗口，不使用未来信息）
        features = pd.DataFrame(index=df_checked.index)
        features['close'] = df_checked['close']
        features['volume'] = df_checked['volume']

        # returns & log returns
        features['return_pct'] = df_checked['close'].pct_change(fill_method=None) * 100
        # 替换由除以0产生的 inf
        features['return_pct'].replace([np.inf, -np.inf], np.nan, inplace=True)
        # log on zeros will produce -inf; protect by replacing non-positive with NaN first
        safe_close = df_checked['close'].where(df_checked['close'] > 0)
        features['log_return'] = np.log(safe_close).diff()

        # 限制极端 return 的上限，避免后续 winsorize 受极端值影响过大
        features['return_pct'] = features['return_pct'].clip(lower=-1e4, upper=1e4)

        # rolling volatility
        features['rolling_vol'] = features['return_pct'].rolling(window=L, min_periods=min_periods).std(ddof=0)
        features['rolling_mean_price'] = df_checked['close'].rolling(window=L, min_periods=min_periods).mean()
        features['rolling_median_price'] = df_checked['close'].rolling(window=L, min_periods=min_periods).median()

        # momentum
        features['momentum_1'] = df_checked['close'].pct_change(periods=1, fill_method=None)
        features['momentum_12'] = df_checked['close'].pct_change(periods=min(12, L), fill_method=None)

        # MACD/ATR/VWAP 等相对值（使用安全除法）
        # 修复说明（2025-12-18）: MACD现在保存为原始价差（USDT），在特征工程时归一化
        if 'macd' in df_checked.columns:
            # 归一化为百分比（供模型训练使用）
            features['macd_pct'] = self._safe_div(df_checked['macd'], df_checked['close']) * 100
        else:
            features['macd_pct'] = pd.Series(np.nan, index=df_checked.index)

        if 'macd_signal' in df_checked.columns:
            features['macd_signal_pct'] = self._safe_div(df_checked['macd_signal'], df_checked['close']) * 100
        else:
            features['macd_signal_pct'] = pd.Series(np.nan, index=df_checked.index)

        if 'macd_diff' in df_checked.columns:
            features['macd_diff_pct'] = self._safe_div(df_checked['macd_diff'], df_checked['close']) * 100
        else:
            features['macd_diff_pct'] = pd.Series(np.nan, index=df_checked.index)

        features['atr_pct'] = self._safe_div(df_checked.get('atr', pd.Series(np.nan, index=df_checked.index)), df_checked['close']) * 100

        # VWAP relative
        features['vwap_rel'] = self._safe_div(df_checked['close'] - df_checked.get('vwap', df_checked['close']), df_checked.get('vwap', df_checked['close']))

        # Bollinger width relative to rolling_mean_price
        features['bb_width_pct'] = self._safe_div(df_checked.get('bb_width', pd.Series(np.nan, index=df_checked.index)), 1.0) * 100
        # high_low_range 已是百分比在 _calculate_indicators 中处理
        features['high_low_range_pct'] = df_checked.get('high_low_range', df_checked['high'] - df_checked['low'])

        # volume z-score （使用窗口内均值和std）
        rolling_vol_mean = df_checked['volume'].rolling(window=L, min_periods=min_periods).mean()
        rolling_vol_std = df_checked['volume'].rolling(window=L, min_periods=min_periods).std(ddof=0)
        features['volume_z'] = self._safe_div(df_checked['volume'] - rolling_vol_mean, rolling_vol_std, fill=0.0)

        # volume ratio safe
        features['volume_ratio'] = df_checked.get('volume_ratio', pd.Series(1.0, index=df_checked.index)).fillna(1.0)

        # winsorize 某些极端特征
        for col in ['return_pct', 'log_return', 'momentum_1', 'momentum_12', 'volume_z']:
            if col in features.columns:
                features[col] = self._winsorize(features[col], lower_q=winsor_limits[0], upper_q=winsor_limits[1])

        # 全局替换 inf 为 NaN，保证 downstream 不会遇到 inf
        features.replace([np.inf, -np.inf], np.nan, inplace=True)

        # 4) 标记特征有效性
        # 条件：原始 is_valid 为 True（warm-up已通过）、窗口内有效样本 >= min_periods、关键字段非NaN
        critical_cols = ['close', 'volume', 'macd_pct', 'atr_pct']
        has_critical = features[critical_cols].notna().all(axis=1)

        # 判断窗口连续性：计算窗口内有效计数
        window_count = features['close'].rolling(window=L, min_periods=1).count()
        has_enough_history = window_count >= min_periods

        # 合成 is_feature_valid
        src_is_valid = df_checked.get('is_valid') if 'is_valid' in df_checked.columns else pd.Series(True, index=features.index)
        is_feature_valid = src_is_valid.fillna(False) & has_critical & has_enough_history & (~df_checked.get('is_imputed', pd.Series(False, index=features.index)))

        features['is_feature_valid'] = is_feature_valid

        # 5) warm_up_bars_remaining
        # 计算到达 full lookback 还差多少条（基于当前末尾非缺失计数）
        recent_counts = features['close'].rolling(window=L, min_periods=1).count()
        features['warm_up_bars_remaining'] = (L - recent_counts).clip(lower=0).astype(int)

        # 6) 注入元数据与版本信息
        features['feature_version'] = feature_version
        # 使用传入DataFrame的 snapshot_id 作为 source reference（如果存在）
        source_ids = df_checked.get('snapshot_id', pd.Series(self.last_snapshot_id or 'unknown', index=features.index))
        features['source_snapshot_id'] = source_ids
        features['processor_version'] = self.PROCESSOR_VERSION
        # 保留插值标记以便审计/测试
        features['is_imputed'] = df_checked.get('is_imputed', pd.Series(False, index=features.index))

        # 7) 仅返回最新行的 snapshot（调用方可选择保留全表）
        # 保留完整DataFrame以便回测/审计，但常用场景会取尾行
        return features

    def detect_trend(self, df: pd.DataFrame) -> str:
        """
        判断趋势
        
        Returns:
            'strong_uptrend', 'uptrend', 'sideways', 'downtrend', 'strong_downtrend'
        """
        if df.empty or len(df) < 50:
            return 'unknown'
        
        latest = df.iloc[-1]
        
        # 使用多重指标判断
        conditions = []
        
        # 1. 均线排列
        if latest['close'] > latest['sma_20'] > latest['sma_50']:
            conditions.append(2)
        elif latest['close'] > latest['sma_20']:
            conditions.append(1)
        elif latest['close'] < latest['sma_20'] < latest['sma_50']:
            conditions.append(-2)
        elif latest['close'] < latest['sma_20']:
            conditions.append(-1)
        else:
            conditions.append(0)
        
        # 2. MACD
        if latest['macd'] > latest['macd_signal'] and latest['macd'] > 0:
            conditions.append(1)
        elif latest['macd'] < latest['macd_signal'] and latest['macd'] < 0:
            conditions.append(-1)
        else:
            conditions.append(0)
        
        # 3. 价格相对布林带位置
        if latest['close'] > latest['bb_upper']:
            conditions.append(1)
        elif latest['close'] < latest['bb_lower']:
            conditions.append(-1)
        else:
            conditions.append(0)
        
        # 综合评分
        score = sum(conditions)
        
        if score >= 3:
            return 'strong_uptrend'
        elif score >= 1:
            return 'uptrend'
        elif score <= -3:
            return 'strong_downtrend'
        elif score <= -1:
            return 'downtrend'
        else:
            return 'sideways'
    
    def detect_volatility(self, df: pd.DataFrame) -> str:
        """
        判断波动率
        
        Returns:
            'low', 'normal', 'high', 'extreme'
        """
        if df.empty or len(df) < 20:
            return 'unknown'
        
        latest = df.iloc[-1]
        
        # 使用ATR和布林带宽度
        atr_pct = latest['atr'] / latest['close'] * 100
        bb_width = latest['bb_width'] * 100
        
        # 历史分位数
        atr_percentile = (df['atr'] / df['close'] * 100).rank(pct=True).iloc[-1]
        
        if atr_percentile > 0.9 or bb_width > 5:
            return 'extreme'
        elif atr_percentile > 0.7 or bb_width > 3:
            return 'high'
        elif atr_percentile < 0.3:
            return 'low'
        else:
            return 'normal'
    
    def detect_momentum(self, df: pd.DataFrame) -> str:
        """
        判断动量
        
        Returns:
            'strong', 'moderate', 'weak', 'negative'
        """
        if df.empty or len(df) < 50:
            return 'unknown'
        
        latest = df.iloc[-1]
        
        # RSI
        rsi = latest['rsi']
        
        # MACD强度
        macd_strength = abs(latest['macd_diff'])
        macd_avg = df['macd_diff'].abs().rolling(20).mean().iloc[-1]
        
        # 价格动量
        price_momentum = df['close'].pct_change(10).iloc[-1] * 100
        
        if rsi > 70 and macd_strength > macd_avg and price_momentum > 5:
            return 'strong'
        elif rsi > 60 and price_momentum > 2:
            return 'moderate'
        elif rsi < 30 and price_momentum < -5:
            return 'negative'
        else:
            return 'weak'
    
    def find_support_resistance(
        self, 
        df: pd.DataFrame, 
        lookback: int = 50,
        max_distance_pct: float = 0.50  # 最大距离50%
    ) -> Dict:
        """
        寻找支撑位和阻力位（带异常过滤）
        
        方法：
        - 使用近期高低点
        - 使用布林带上下轨
        - 过滤距离当前价格过远的异常值
        
        Args:
            df: K线数据
            lookback: 回溯周期
            max_distance_pct: 最大距离百分比（过滤异常值）
            
        Returns:
            {
                'support': [价格列表],
                'resistance': [价格列表],
                'method': '计算方法说明',
                'lookback': 回溯周期
            }
        """
        if df.empty or len(df) < lookback:
            return {
                'support': [],
                'resistance': [],
                'method': 'insufficient_data',
                'lookback': 0
            }
        
        recent_df = df.tail(lookback)
        current_price = df['close'].iloc[-1]
        latest = df.iloc[-1]
        
        # 寻找局部高点和低点
        highs = recent_df['high'].values
        lows = recent_df['low'].values
        
        resistance_levels = []
        support_levels = []
        
        # 1. 历史高低点
        recent_high = np.max(highs)
        recent_low = np.min(lows)
        
        # 过滤异常值：距离当前价格不超过 max_distance_pct
        max_distance_up = current_price * (1 + max_distance_pct)
        max_distance_down = current_price * (1 - max_distance_pct)
        
        # 只添加合理范围内的价位
        if recent_high > current_price and recent_high < max_distance_up:
            resistance_levels.append(float(round(recent_high, 2)))
        
        if recent_low < current_price and recent_low > max_distance_down:
            support_levels.append(float(round(recent_low, 2)))
        
        # 2. 布林带作为动态支撑阻力
        bb_upper = latest['bb_upper']
        bb_lower = latest['bb_lower']
        
        # 布林带通常比较合理，但也要检查
        if bb_upper < max_distance_up:
            resistance_levels.append(float(round(bb_upper, 2)))
        
        if bb_lower > max_distance_down:
            support_levels.append(float(round(bb_lower, 2)))
        
        # 去重并排序
        support_levels = sorted(list(set(support_levels)))
        resistance_levels = sorted(list(set(resistance_levels)), reverse=True)
        
        return {
            'support': support_levels,
            'resistance': resistance_levels,
            'method': f'swing_highs_lows+bollinger, lookback={lookback}, max_distance={max_distance_pct:.0%}',
            'lookback': lookback,
            'filtered': {
                'high_filtered': recent_high >= max_distance_up,
                'low_filtered': recent_low <= max_distance_down
            }
        }
    
    def check_indicator_completeness(self, df: pd.DataFrame, min_coverage: float = 0.95) -> Dict:
        """
        检查技术指标完整性
        
        检查项:
        1. 关键指标是否包含 NaN/Inf
        2. 数据覆盖率是否达标
        3. warm-up期是否完成
        
        Args:
            df: 包含技术指标的DataFrame
            min_coverage: 最小覆盖率阈值（默认95%）
            
        Returns:
            {
                'is_complete': bool,
                'issues': List[str],
                'coverage': Dict[str, float],
                'overall_coverage': float
            }
        """
        if df.empty:
            return {
                'is_complete': False,
                'issues': ['DataFrame为空'],
                'coverage': {},
                'overall_coverage': 0.0
            }
        
        # 关键指标列表
        critical_indicators = [
            'sma_20', 'sma_50', 'ema_12', 'ema_26',
            'macd', 'macd_signal', 'macd_diff',
            'rsi', 'bb_upper', 'bb_middle', 'bb_lower',
            'atr', 'volume_sma', 'volume_ratio'
        ]
        
        issues = []
        coverage = {}
        
        # 1. 检查每个指标的完整性
        for indicator in critical_indicators:
            if indicator not in df.columns:
                issues.append(f'{indicator} 缺失')
                coverage[indicator] = 0.0
                continue
            
            series = df[indicator]
            
            # 检查 NaN
            nan_count = series.isna().sum()
            nan_pct = nan_count / len(series)
            
            # 检查 Inf
            inf_count = np.isinf(series).sum() if series.dtype in [np.float32, np.float64] else 0
            
            # 计算覆盖率
            valid_count = len(series) - nan_count - inf_count
            indicator_coverage = valid_count / len(series) if len(series) > 0 else 0.0
            coverage[indicator] = indicator_coverage
            
            # 记录问题
            if nan_count > 0:
                issues.append(f'{indicator} 包含 {nan_count} 个NaN值 (覆盖率: {indicator_coverage:.1%})')
            if inf_count > 0:
                issues.append(f'{indicator} 包含 {inf_count} 个Inf值')
        
        # 2. 检查 warm-up 状态
        if 'is_valid' in df.columns:
            valid_bars = df['is_valid'].sum()
            valid_ratio = valid_bars / len(df) if len(df) > 0 else 0.0
            
            if valid_ratio < min_coverage:
                issues.append(
                    f'warm-up期未完成: 有效数据占比={valid_ratio:.1%} < {min_coverage:.1%}'
                )
        else:
            issues.append('缺少 is_valid 标记')
        
        # 3. 计算总体覆盖率
        if coverage:
            overall_coverage = sum(coverage.values()) / len(coverage)
        else:
            overall_coverage = 0.0
        
        # 4. 判断是否完整
        is_complete = (
            len(issues) == 0 and
            overall_coverage >= min_coverage
        )
        
        return {
            'is_complete': is_complete,
            'issues': issues,
            'coverage': coverage,
            'overall_coverage': overall_coverage
        }
