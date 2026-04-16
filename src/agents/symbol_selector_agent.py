"""
🔝 Symbol Selector Agent - AUTO3 Backtest + AUTO1 Momentum Selection
====================================================================

Responsibilities:
1. Get AI500 Top 10 by volume
2. Stage 1: Coarse filter (1h backtest) → Top 5
3. Stage 2: Fine filter (15m backtest) → Top 3
4. 6-hour refresh cycle
5. Startup execution (mandatory)

AUTO1 (Lightweight):
1. Use last 30 minutes momentum (clear up/down)
2. Select the strongest mover as the single symbol

Author: AI Trader Team
Date: 2026-01-07
Updated: 2026-01-10 (Two-stage selection)
"""

import asyncio
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Dict, Optional
import threading
import time

from src.utils.logger import log
from src.config import config
from src.backtest.engine import BacktestEngine, BacktestConfig


def calculate_adx(klines: List[Dict], period: int = 14) -> float:
    """
    计算 ADX 趋势强度指标
    
    ADX > 25: 强趋势
    ADX 20-25: 趋势形成中
    ADX < 20: 无趋势/震荡
    """
    if len(klines) < period + 2:
        return 0.0
    
    try:
        highs = [float(k['high']) for k in klines]
        lows = [float(k['low']) for k in klines]
        closes = [float(k['close']) for k in klines]
        
        # TR, +DM, -DM 计算
        tr_list, plus_dm_list, minus_dm_list = [], [], []
        for i in range(1, len(klines)):
            high_diff = highs[i] - highs[i-1]
            low_diff = lows[i-1] - lows[i]
            
            tr = max(highs[i] - lows[i], 
                     abs(highs[i] - closes[i-1]), 
                     abs(lows[i] - closes[i-1]))
            
            plus_dm = high_diff if high_diff > low_diff and high_diff > 0 else 0
            minus_dm = low_diff if low_diff > high_diff and low_diff > 0 else 0
            
            tr_list.append(tr)
            plus_dm_list.append(plus_dm)
            minus_dm_list.append(minus_dm)
        
        if len(tr_list) < period:
            return 0.0
        
        # Wilder's smoothing
        def smooth(values, period):
            if len(values) < period:
                return []
            result = [sum(values[:period])]
            for v in values[period:]:
                result.append(result[-1] - result[-1]/period + v)
            return result
        
        atr = smooth(tr_list, period)
        if not atr:
            return 0.0
            
        smoothed_plus_dm = smooth(plus_dm_list, period)
        smoothed_minus_dm = smooth(minus_dm_list, period)
        
        if not smoothed_plus_dm or not smoothed_minus_dm:
            return 0.0
        
        # +DI, -DI
        plus_di = [(pdm / atr[i] * 100) if atr[i] > 0 else 0 
                   for i, pdm in enumerate(smoothed_plus_dm)]
        minus_di = [(mdm / atr[i] * 100) if atr[i] > 0 else 0 
                    for i, mdm in enumerate(smoothed_minus_dm)]
        
        # DX
        dx = []
        for i in range(len(plus_di)):
            di_sum = plus_di[i] + minus_di[i]
            if di_sum > 0:
                dx.append(abs(plus_di[i] - minus_di[i]) / di_sum * 100)
            else:
                dx.append(0)
        
        # ADX = smoothed DX
        if len(dx) >= period:
            adx = sum(dx[-period:]) / period
            return round(adx, 1)
        return 0.0
        
    except Exception as e:
        return 0.0


def calculate_ema(values: List[float], period: int) -> List[float]:
    """Simple EMA implementation returning the full EMA series tail."""
    if period <= 0 or len(values) < period:
        return []
    try:
        multiplier = 2 / (period + 1)
        ema_seed = sum(values[:period]) / period
        ema_values = [ema_seed]
        for v in values[period:]:
            ema_values.append((v - ema_values[-1]) * multiplier + ema_values[-1])
        return ema_values
    except Exception:
        return []


def calculate_rsi(values: List[float], period: int = 14) -> float:
    """Compute RSI from close prices; returns 50 on insufficient data."""
    if len(values) < period + 1:
        return 50.0
    gains = []
    losses = []
    for i in range(1, len(values)):
        delta = values[i] - values[i - 1]
        gains.append(max(delta, 0.0))
        losses.append(abs(min(delta, 0.0)))
    if len(gains) < period:
        return 50.0
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


class SymbolSelectorAgent:
    """
    Automated symbol selection based on backtest performance (AUTO3)
    
    Two-Stage Workflow:
    1. Get AI500 Top 10 by 24h volume
    2. Stage 1: Coarse filter (1h backtest, step=12) → Top 5
    3. Stage 2: Fine filter (15m backtest, step=3) → Top 3
    4. Cache results for 6 hours
    5. Auto-refresh every 6 hours
    """
    
    # AI500 Candidate Pool (30+ AI/Data/Compute coins)
    AI500_CANDIDATES = [
        "FETUSDT", "RENDERUSDT", "TAOUSDT", "NEARUSDT", "GRTUSDT", 
        "WLDUSDT", "ARKMUSDT", "LPTUSDT", "THETAUSDT", "ROSEUSDT",
        "PHBUSDT", "CTXCUSDT", "NMRUSDT", "RLCUSDT", "GLMUSDT",
        "IQUSDT", "MDTUSDT", "AIUSDT", "NFPUSDT", "XAIUSDT",
        "JASMYUSDT", "ICPUSDT", "FILUSDT", "VETUSDT", "LINKUSDT",
        "ACTUSDT", "GOATUSDT", "TURBOUSDT", "PNUTUSDT"
    ]
    
    
    FALLBACK_SYMBOLS = ["FETUSDT", "RENDERUSDT", "TAOUSDT"]  # AI500 fallback

    AUTO1_WINDOW_MINUTES = 30
    AUTO1_THRESHOLD_PCT = 0.8
    AUTO1_INTERVAL = "1m"
    AUTO1_VOLUME_RATIO_THRESHOLD = 1.2
    AUTO1_MIN_ADX = 20  # 最小 ADX 要求（>20 = 有趋势，<20 = 震荡）
    AUTO1_CANDIDATE_TOP_N = 15
    AUTO1_MIN_DIRECTIONAL_SCORE = 2.0
    AUTO1_MIN_ALIGNMENT_SCORE = 0.0
    AUTO1_RELAX_FACTOR = 0.75
    DEFAULT_MIN_QUOTE_VOL = 5_000_000  # 24h USDT quote volume
    DEFAULT_MIN_PRICE = 0.05  # Minimum last price to avoid ultra-low price coins
    DEFAULT_MIN_QUOTE_VOL_PER_USDT = 3000  # Dynamic volume floor per 1 USDT equity

    def __init__(
        self,
        candidate_symbols: Optional[List[str]] = None,
        cache_dir: str = "config",
        refresh_interval_hours: int = 6,
        lookback_hours: int = 24
    ):
        """
        Initialize Symbol Selector Agent
        
        Args:
            candidate_symbols: List of symbols to evaluate (default: 20 symbols)
            cache_dir: Directory for cache storage
            refresh_interval_hours: Auto-refresh interval (default: 6h)
            lookback_hours: Backtest lookback period (default: 24h)
        """
        self.ai500_candidates = self.AI500_CANDIDATES
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_file = self.cache_dir / "auto_top3_cache.json"
        
        self.refresh_interval = refresh_interval_hours
        self.lookback_hours = lookback_hours
        
        # Background refresh thread
        self._refresh_thread: Optional[threading.Thread] = None
        self._stop_refresh = threading.Event()
        self.last_auto1: Dict[str, Dict] = {}
        self.symbol_blacklist = set(
            s.upper() for s in (config.get('trading.symbol_blacklist', []) or [])
        )
        self.min_quote_volume = float(config.get('trading.selector_min_quote_volume', self.DEFAULT_MIN_QUOTE_VOL))
        self.min_price = float(config.get('trading.selector_min_price', self.DEFAULT_MIN_PRICE))
        self.min_quote_volume_per_usdt = float(
            config.get('trading.selector_min_quote_volume_per_usdt', self.DEFAULT_MIN_QUOTE_VOL_PER_USDT)
        )
        self.account_equity = None

        log.info(
            f"🔝 SymbolSelectorAgent initialized: AUTO3 backtest ({refresh_interval_hours}h refresh) + AUTO1 momentum"
        )

    def _compute_directional_consistency(self, closes: List[float], direction: int) -> float:
        """Return how consistently bars moved in the target direction (0~1)."""
        if direction == 0 or len(closes) < 3:
            return 0.5
        directional_moves = 0
        opposite_moves = 0
        for i in range(1, len(closes)):
            delta = closes[i] - closes[i - 1]
            if delta * direction > 0:
                directional_moves += 1
            elif delta * direction < 0:
                opposite_moves += 1
        total = directional_moves + opposite_moves
        if total <= 0:
            return 0.5
        return directional_moves / total

    def _compute_timeframe_alignment(self, closes: List[float], direction: int) -> float:
        """Estimate directional alignment on one timeframe using EMA20/EMA60 and slope."""
        if direction == 0 or len(closes) < 65:
            return 0.0

        ema20 = calculate_ema(closes, 20)
        ema60 = calculate_ema(closes, 60)
        if not ema20 or not ema60:
            return 0.0

        ema20_now = ema20[-1]
        ema60_now = ema60[-1]
        ema20_prev = ema20[-4] if len(ema20) >= 4 else ema20[0]
        ema60_prev = ema60[-4] if len(ema60) >= 4 else ema60[0]

        trend_diff = ema20_now - ema60_now
        slope20 = ema20_now - ema20_prev
        slope60 = ema60_now - ema60_prev

        score = 0.0
        if trend_diff * direction > 0:
            score += 0.65
        elif trend_diff * direction < 0:
            score -= 0.65

        if slope20 * direction > 0:
            score += 0.25
        elif slope20 * direction < 0:
            score -= 0.25

        if slope60 * direction > 0:
            score += 0.10
        elif slope60 * direction < 0:
            score -= 0.10

        return max(-1.0, min(1.0, score))

    def _compute_impulse_ratio(self, closes: List[float]) -> float:
        """
        Signal-to-noise for recent move.
        Higher value means move is cleaner relative to intrawindow noise.
        """
        if len(closes) < 4 or closes[0] == 0:
            return 0.0
        returns = []
        for i in range(1, len(closes)):
            prev = closes[i - 1]
            curr = closes[i]
            if prev == 0:
                continue
            returns.append((curr - prev) / prev * 100.0)
        if not returns:
            return 0.0

        mean_ret = sum(returns) / len(returns)
        variance = sum((r - mean_ret) ** 2 for r in returns) / len(returns)
        std_ret = math.sqrt(max(variance, 0.0))
        net_change_pct = abs((closes[-1] - closes[0]) / closes[0]) * 100.0
        expected_noise = std_ret * math.sqrt(max(1, len(returns)))

        if expected_noise <= 1e-8:
            return 2.0 if net_change_pct > 0 else 0.0
        return max(0.0, min(3.0, net_change_pct / expected_noise))

    def _build_directional_score(
        self,
        change_pct: float,
        volume_ratio: float,
        adx_15m: float,
        adx_1h: float,
        consistency: float,
        alignment_score: float,
        day_change_pct: float = 0.0
    ) -> float:
        """Composite directional score: movement × volume × trend quality."""
        magnitude = abs(change_pct)
        adx_ref = max(adx_15m, adx_1h)
        adx_boost = 1.0 + max(0.0, adx_ref - 18.0) / 40.0
        vol_boost = 1.0 + max(0.0, min(volume_ratio, 4.0) - 1.0) * 0.7
        consistency_boost = 0.8 + max(0.0, min(1.0, consistency)) * 0.6
        alignment_boost = 0.6 + max(0.0, alignment_score) * 0.8

        if change_pct * day_change_pct > 0:
            day_boost = 1.15
        elif change_pct * day_change_pct < 0:
            day_boost = 0.9
        else:
            day_boost = 1.0

        score = magnitude * adx_boost * vol_boost * consistency_boost * alignment_boost * day_boost
        if alignment_score < -0.3:
            score *= 0.45
        return score

    def _interval_to_minutes(self, interval: str) -> int:
        if not interval:
            return 1
        unit = interval[-1]
        try:
            value = int(interval[:-1])
        except ValueError:
            return 1
        if unit == 'm':
            return max(1, value)
        if unit == 'h':
            return max(1, value * 60)
        if unit == 'd':
            return max(1, value * 60 * 24)
        return 1

    def _get_effective_min_quote_volume(self, account_equity: Optional[float] = None) -> float:
        """Compute dynamic quote-volume floor based on account equity."""
        equity = account_equity
        if equity is None:
            equity = self.account_equity
        try:
            equity_val = float(equity) if equity is not None else 0.0
        except (TypeError, ValueError):
            equity_val = 0.0

        dynamic_floor = 0.0
        if equity_val > 0 and self.min_quote_volume_per_usdt > 0:
            dynamic_floor = equity_val * self.min_quote_volume_per_usdt

        return max(self.min_quote_volume, dynamic_floor)

    async def select_auto1_recent_momentum(
        self,
        candidates: Optional[List[str]] = None,
        window_minutes: int = AUTO1_WINDOW_MINUTES,
        interval: str = AUTO1_INTERVAL,
        threshold_pct: float = AUTO1_THRESHOLD_PCT,
        volume_ratio_threshold: float = AUTO1_VOLUME_RATIO_THRESHOLD,
        min_adx: Optional[float] = None,
        candidate_top_n: int = AUTO1_CANDIDATE_TOP_N,
        min_directional_score: float = AUTO1_MIN_DIRECTIONAL_SCORE,
        min_alignment_score: float = AUTO1_MIN_ALIGNMENT_SCORE,
        relax_factor: float = AUTO1_RELAX_FACTOR,
        account_equity: Optional[float] = None
    ) -> List[str]:
        """
        Select symbols by recent momentum (AUTO1).

        Picks the strongest UP and DOWN movers over the last N minutes.
        If a direction is not "clear" (below threshold), it will still
        return the strongest mover but log the weak signal.
        """
        try:
            from src.api.binance_client import BinanceClient
        except Exception as e:
            log.error(f"❌ AUTO1 failed: BinanceClient unavailable: {e}")
            return [self.FALLBACK_SYMBOLS[0]]

        try:
            min_adx_value = float(self.AUTO1_MIN_ADX if min_adx is None else min_adx)
        except (TypeError, ValueError):
            min_adx_value = float(self.AUTO1_MIN_ADX)
        try:
            top_n = max(5, int(candidate_top_n))
        except (TypeError, ValueError):
            top_n = self.AUTO1_CANDIDATE_TOP_N
        try:
            min_score = max(0.0, float(min_directional_score))
        except (TypeError, ValueError):
            min_score = self.AUTO1_MIN_DIRECTIONAL_SCORE
        try:
            min_align = max(-1.0, min(1.0, float(min_alignment_score)))
        except (TypeError, ValueError):
            min_align = self.AUTO1_MIN_ALIGNMENT_SCORE
        try:
            relax = max(0.5, min(1.0, float(relax_factor)))
        except (TypeError, ValueError):
            relax = self.AUTO1_RELAX_FACTOR
        min_impulse = 0.75

        effective_min_quote_volume = self._get_effective_min_quote_volume(account_equity)
        if account_equity is not None:
            self.account_equity = float(account_equity)

        symbols = candidates or await self._get_expanded_candidates(account_equity=account_equity, top_n=top_n)
        if self.symbol_blacklist:
            symbols = [s for s in symbols if s.upper() not in self.symbol_blacklist]
        if not symbols:
            return [self.FALLBACK_SYMBOLS[0]]

        interval_minutes = self._interval_to_minutes(interval)
        window_count = max(2, int(window_minutes / interval_minutes))
        limit = max(8, window_count * 3)
        client = BinanceClient()
        ticker_map = {}
        if effective_min_quote_volume > 0 or self.min_price > 0:
            try:
                tickers = client.get_all_tickers()
                ticker_map = {t.get('symbol'): t for t in tickers if t.get('symbol')}
            except Exception:
                ticker_map = {}

        results = []
        low_trend_symbols = []
        for symbol in symbols:
            try:
                if ticker_map:
                    t = ticker_map.get(symbol)
                    if t:
                        quote_vol = float(t.get('quoteVolume', 0) or 0)
                        last_price = float(t.get('lastPrice', 0) or 0)
                        if quote_vol < effective_min_quote_volume or last_price < self.min_price:
                            continue
                klines = client.get_klines(symbol, interval, limit=limit)
                if len(klines) < window_count + 1:
                    continue
                recent = klines[-window_count:]
                previous = klines[:-window_count] if len(klines) > window_count else []

                start_price = recent[0]['close']
                end_price = recent[-1]['close']
                if not start_price:
                    continue
                change_pct = ((end_price - start_price) / start_price) * 100
                recent_volume = sum(k.get('volume', 0.0) for k in recent)
                prev_volume = sum(k.get('volume', 0.0) for k in previous) if previous else 0.0
                recent_volume_avg = (recent_volume / len(recent)) if recent else 0.0
                prev_volume_avg = (prev_volume / len(previous)) if previous else 0.0
                # Compare per-bar volume to avoid window-size bias (recent window vs larger history window).
                volume_ratio = (recent_volume_avg / prev_volume_avg) if prev_volume_avg > 0 else 1.0
                
                day_change_pct = 0.0
                if ticker_map and ticker_map.get(symbol):
                    try:
                        day_change_pct = float(ticker_map[symbol].get('priceChangePercent', 0) or 0)
                    except (TypeError, ValueError):
                        day_change_pct = 0.0

                # 15m + 1h 趋势强度与方向一致性
                try:
                    klines_15m = client.get_klines(symbol, "15m", limit=80)
                    klines_1h = client.get_klines(symbol, "1h", limit=80)
                    adx_15m = calculate_adx(klines_15m, period=14)
                    adx_1h = calculate_adx(klines_1h, period=14)
                except Exception:
                    klines_15m = []
                    klines_1h = []
                    adx_15m = 0.0
                    adx_1h = 0.0

                direction = 1 if change_pct > 0 else (-1 if change_pct < 0 else 0)
                recent_closes = [float(k.get("close", 0.0) or 0.0) for k in recent]
                consistency = self._compute_directional_consistency(recent_closes, direction)
                freshness_score = 0.0
                if direction != 0 and len(recent_closes) >= 6 and abs(change_pct) > 1e-8:
                    prev_ref = recent_closes[-6]
                    if prev_ref:
                        tail_change_pct = ((recent_closes[-1] - prev_ref) / prev_ref) * 100.0
                        freshness_raw = (direction * tail_change_pct) / abs(change_pct)
                        freshness_score = max(0.0, min(2.0, freshness_raw))
                path_distance = 0.0
                for i in range(1, len(recent_closes)):
                    path_distance += abs(recent_closes[i] - recent_closes[i - 1])
                net_distance = abs(end_price - start_price)
                path_efficiency = (net_distance / path_distance) if path_distance > 0 else 0.0
                impulse_ratio = self._compute_impulse_ratio(recent_closes)
                recent_high = max(float(k.get("high", 0.0) or 0.0) for k in recent)
                recent_low = min(float(k.get("low", 0.0) or 0.0) for k in recent)
                if recent_high > recent_low:
                    range_position = (end_price - recent_low) / (recent_high - recent_low)
                else:
                    range_position = 0.5
                range_position = max(0.0, min(1.0, range_position))
                directional_range_position = range_position if direction > 0 else (1.0 - range_position)

                closes_15m = [float(k.get("close", 0.0) or 0.0) for k in klines_15m]
                closes_1h = [float(k.get("close", 0.0) or 0.0) for k in klines_1h]
                alignment_15m = self._compute_timeframe_alignment(closes_15m, direction)
                alignment_1h = self._compute_timeframe_alignment(closes_1h, direction)
                alignment_score = alignment_15m * 0.4 + alignment_1h * 0.6
                rsi_15m = calculate_rsi(closes_15m, period=14)

                adx_ref = max(adx_15m, adx_1h)
                low_trend = adx_ref < min_adx_value
                if low_trend:
                    low_trend_symbols.append(f"{symbol}(ADX={adx_ref:.0f})")

                score = self._build_directional_score(
                    change_pct=change_pct,
                    volume_ratio=volume_ratio,
                    adx_15m=adx_15m,
                    adx_1h=adx_1h,
                    consistency=consistency,
                    alignment_score=alignment_score,
                    day_change_pct=day_change_pct
                )
                # Prefer clean directional pushes over noisy chop with same % change.
                score *= (0.75 + max(0.0, min(1.0, path_efficiency)) * 0.5)
                score *= (0.75 + min(2.5, impulse_ratio) * 0.35)
                # Prefer moves still advancing in the latest bars.
                score *= (0.8 + min(1.5, freshness_score) * 0.25)
                # Favor symbols closing near directional edge of recent window range.
                score *= (0.8 + directional_range_position * 0.4)
                exhausted = False
                if direction > 0 and rsi_15m >= 72:
                    exhausted = True
                    score *= 0.55
                elif direction < 0 and rsi_15m <= 28:
                    exhausted = True
                    score *= 0.55
                if low_trend:
                    score *= 0.55

                results.append({
                    "symbol": symbol,
                    "change_pct": change_pct,
                    "volume_ratio": volume_ratio,
                    "adx": adx_ref,
                    "adx_15m": adx_15m,
                    "adx_1h": adx_1h,
                    "day_change_pct": day_change_pct,
                    "consistency": consistency,
                    "freshness_score": freshness_score,
                    "path_efficiency": path_efficiency,
                    "impulse_ratio": impulse_ratio,
                    "range_position": range_position,
                    "directional_range_position": directional_range_position,
                    "alignment_score": alignment_score,
                    "rsi_15m": rsi_15m,
                    "score": score,
                    "low_trend": low_trend,
                    "exhausted": exhausted
                })
            except Exception as e:
                log.warning(f"⚠️ AUTO1 skip {symbol}: {e}")
        
        if low_trend_symbols:
            log.info(f"📊 AUTO1 低趋势候选 (ADX<{min_adx_value:.0f}, 已降权): {', '.join(low_trend_symbols[:5])}{'...' if len(low_trend_symbols) > 5 else ''}")

        if not results:
            fallback = symbols[0] if symbols else self.FALLBACK_SYMBOLS[0]
            log.warning(f"⚠️ AUTO1 empty results, fallback to {fallback}")
            return [fallback]

        ups = [r for r in results if r["change_pct"] > 0]
        downs = [r for r in results if r["change_pct"] < 0]
        best_up = max(ups, key=lambda x: x["score"]) if ups else max(results, key=lambda x: x["score"])
        best_down = max(downs, key=lambda x: x["score"]) if downs else min(results, key=lambda x: x["change_pct"])

        strong_ups = [
            r for r in results
            if r["change_pct"] > 0
            and abs(r["change_pct"]) >= threshold_pct
            and r["volume_ratio"] >= volume_ratio_threshold
            and r["score"] >= min_score
            and r["alignment_score"] >= min_align
            and r.get("impulse_ratio", 0.0) >= min_impulse
            and r.get("directional_range_position", 0.0) >= 0.55
            and r.get("freshness_score", 0.0) >= 0.12
            and not r.get("exhausted", False)
        ]
        strong_downs = [
            r for r in results
            if r["change_pct"] < 0
            and abs(r["change_pct"]) >= threshold_pct
            and r["volume_ratio"] >= volume_ratio_threshold
            and r["score"] >= min_score
            and r["alignment_score"] >= min_align
            and r.get("impulse_ratio", 0.0) >= min_impulse
            and r.get("directional_range_position", 0.0) >= 0.55
            and r.get("freshness_score", 0.0) >= 0.12
            and not r.get("exhausted", False)
        ]

        if not strong_ups:
            strong_ups = [
                r for r in results
                if r["change_pct"] > 0
                and abs(r["change_pct"]) >= threshold_pct * relax
                and r["volume_ratio"] >= max(1.0, volume_ratio_threshold * relax)
                and r["score"] >= min_score * relax
                and r["alignment_score"] >= min_align - (1.0 - relax)
                and r.get("impulse_ratio", 0.0) >= max(0.45, min_impulse * relax)
                and r.get("directional_range_position", 0.0) >= 0.45
                and r.get("freshness_score", 0.0) >= 0.05
            ]
        if not strong_downs:
            strong_downs = [
                r for r in results
                if r["change_pct"] < 0
                and abs(r["change_pct"]) >= threshold_pct * relax
                and r["volume_ratio"] >= max(1.0, volume_ratio_threshold * relax)
                and r["score"] >= min_score * relax
                and r["alignment_score"] >= min_align - (1.0 - relax)
                and r.get("impulse_ratio", 0.0) >= max(0.45, min_impulse * relax)
                and r.get("directional_range_position", 0.0) >= 0.45
                and r.get("freshness_score", 0.0) >= 0.05
            ]

        if strong_ups:
            best_up = max(strong_ups, key=lambda x: x["score"])
        if strong_downs:
            best_down = max(strong_downs, key=lambda x: x["score"])

        selected = []
        min_select_score = min_score * relax
        min_select_align = min_align - (1.0 - relax)
        up_qualified = (
            best_up.get("change_pct", 0) > 0
            and best_up.get("score", 0) >= min_select_score
            and best_up.get("alignment_score", 0) >= min_select_align
            and best_up.get("impulse_ratio", 0) >= max(0.45, min_impulse * relax)
            and best_up.get("directional_range_position", 0) >= 0.45
            and best_up.get("freshness_score", 0) >= 0.05
        )
        down_qualified = (
            best_down.get("change_pct", 0) < 0
            and best_down.get("score", 0) >= min_select_score
            and best_down.get("alignment_score", 0) >= min_select_align
            and best_down.get("impulse_ratio", 0) >= max(0.45, min_impulse * relax)
            and best_down.get("directional_range_position", 0) >= 0.45
            and best_down.get("freshness_score", 0) >= 0.05
        )

        if up_qualified:
            selected.append(best_up["symbol"])
        if down_qualified and best_down["symbol"] not in selected:
            selected.append(best_down["symbol"])

        if not selected:
            results.sort(key=lambda x: x.get("score", 0), reverse=True)
            best = results[0]
            log.info(
                f"ℹ️ AUTO1 fallback to strongest directional score: {best['symbol']} "
                f"(chg {best['change_pct']:+.2f}% | score {best['score']:.2f} | align {best.get('alignment_score', 0):+.2f})"
            )
            selected.append(best["symbol"])

        def log_selection(label: str, entry: Dict[str, float], strong: bool) -> None:
            magnitude = abs(entry["change_pct"])
            direction = "UP" if entry["change_pct"] >= 0 else "DOWN"
            vol_ratio = entry.get("volume_ratio", 1.0)
            adx_val = entry.get("adx", 0)
            align_val = entry.get("alignment_score", 0.0)
            consistency = entry.get("consistency", 0.5)
            freshness_score = entry.get("freshness_score", 0.0)
            impulse_ratio = entry.get("impulse_ratio", 0.0)
            directional_range_position = entry.get("directional_range_position", 0.0)
            rsi_15m = entry.get("rsi_15m", 50.0)
            vol_text = f"VOL x{vol_ratio:.2f}"
            adx_text = f"ADX={adx_val:.0f}"
            align_text = f"ALIGN={align_val:+.2f}"
            consistency_text = f"CONS={consistency:.2f}"
            freshness_text = f"FRESH={freshness_score:.2f}"
            impulse_text = f"IMP={impulse_ratio:.2f}"
            edge_text = f"EDGE={directional_range_position:.2f}"
            rsi_text = f"RSI15={rsi_15m:.0f}"
            if strong:
                log.info(
                    f"🎯 AUTO1 {label}: {entry['symbol']} ({direction} {entry['change_pct']:+.2f}% | {vol_text} | {adx_text} | {align_text} | {consistency_text} | {freshness_text} | {impulse_text} | {edge_text} | {rsi_text} | SCORE={entry['score']:.2f})"
                )
            else:
                log.info(
                    f"ℹ️ AUTO1 {label} weak (<{threshold_pct:.2f}% or VOL<{volume_ratio_threshold:.2f}x): "
                    f"{entry['symbol']} ({direction} {entry['change_pct']:+.2f}% | {vol_text} | {adx_text} | {align_text} | {consistency_text} | {freshness_text} | {impulse_text} | {edge_text} | {rsi_text} | SCORE={entry['score']:.2f})"
                )

        if best_up["symbol"] in selected:
            is_strong = best_up in strong_ups
            up_label = "UP" if best_up.get("change_pct", 0) >= 0 else "DOWN"
            log_selection(up_label, best_up, is_strong)
        if best_down["symbol"] in selected and best_down["symbol"] != best_up["symbol"]:
            is_strong = best_down in strong_downs
            down_label = "DOWN" if best_down.get("change_pct", 0) <= 0 else "UP"
            log_selection(down_label, best_down, is_strong)

        self.last_auto1 = {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "window_minutes": window_minutes,
            "threshold_pct": threshold_pct,
            "volume_ratio_threshold": volume_ratio_threshold,
            "min_adx": min_adx_value,
            "min_directional_score": min_score,
            "min_alignment_score": min_align,
            "min_impulse_ratio": min_impulse,
            "relax_factor": relax,
            "candidate_top_n": top_n,
            "selected": list(selected),
            "results": {entry["symbol"]: dict(entry) for entry in results}
        }

        return selected
    
    async def select_top3(self, force_refresh: bool = False, account_equity: Optional[float] = None) -> List[str]:
        """
        Select top 3 symbols using two-stage filtering
        
        Stage 1: Coarse filter (1h backtest) on ~16 symbols → Top 5
        Stage 2: Fine filter (15m backtest) on Top 5 → Top 3
        
        Args:
            force_refresh: Force re-run backtests even if cache valid
            
        Returns:
            List of 3 symbol names
        """
        if account_equity is not None:
            self.account_equity = float(account_equity)
        # Check cache validity
        if not force_refresh and self._is_cache_valid():
            cached = self._load_cache()
            symbols = [item['symbol'] for item in cached.get('top3', cached.get('top2', []))]
            if symbols:
                log.info(f"🔝 Using cached AUTO3: {symbols} (age: {self._get_cache_age():.1f}h)")
                return symbols
            else:
                log.warning("⚠️ Cache has empty top3, forcing refresh...")
        
        start_time = time.time()
        
        try:
            # ============================================================
            # STAGE 1: Coarse Filter (1h backtest) → Top 5
            # ============================================================
            log.info("=" * 60)
            log.info("🔄 STAGE 1: Coarse Filter (1h backtest)")
            log.info("=" * 60)
            
            # Get AI500 Top 10
            candidates = await self._get_expanded_candidates(account_equity=account_equity)
            log.info(f"📊 Candidates ({len(candidates)}): {candidates}")
            
            # Run 1h backtests (step=12, faster)
            stage1_results = await self._run_backtests_stage(
                symbols=candidates,
                step=12,  # 1-hour intervals
                stage_name="Stage 1"
            )
            
            # Rank and get Top 5
            ranked_stage1 = self._rank_symbols(stage1_results)
            top5_symbols = [item['symbol'] for item in ranked_stage1[:5]]
            
            log.info(f"✅ Stage 1 complete: Top 5 = {top5_symbols}")
            
            # ============================================================
            # STAGE 2: Fine Filter (15m backtest) → Top 2
            # ============================================================
            log.info("=" * 60)
            log.info("🔄 STAGE 2: Fine Filter (15m backtest)")
            log.info("=" * 60)
            
            # Run 15m backtests on Top 5 (step=3, more precise)
            stage2_results = await self._run_backtests_stage(
                symbols=top5_symbols,
                step=3,  # 15-minute intervals
                stage_name="Stage 2"
            )
            
            # Rank and get Top 3
            ranked_stage2 = self._rank_symbols(stage2_results)
            top3_data = ranked_stage2[:3]
            top3_symbols = [item['symbol'] for item in top3_data]
            
            # Save to cache (include both stages for reference)
            self._save_cache(top3_data, {
                "stage1_results": stage1_results,
                "stage2_results": stage2_results,
                "top5": top5_symbols
            })
            
            elapsed = time.time() - start_time
            log.info("=" * 60)
            log.info(f"✅ AUTO3 Two-Stage Selection Complete in {elapsed:.1f}s")
            log.info(f"   Stage 1: {len(candidates)} → 5 symbols (1h backtest)")
            log.info(f"   Stage 2: 5 → 3 symbols (15m backtest)")
            log.info(f"   🎯 Selected: {top3_symbols}")
            log.info("=" * 60)
            
            return top3_symbols
            
        except Exception as e:
            log.error(f"❌ AUTO3 selection failed: {e}", exc_info=True)
            log.warning(f"⚠️ Falling back to default symbols: {self.FALLBACK_SYMBOLS}")
            return self.FALLBACK_SYMBOLS
    
    async def _get_expanded_candidates(self, account_equity: Optional[float] = None, top_n: int = 10) -> List[str]:
        """Get AI500 Top 10 by 24h volume"""
        try:
            from src.api.binance_client import BinanceClient
            
            client = BinanceClient()
            tickers = client.get_all_tickers()
            ticker_map = {t.get('symbol'): t for t in tickers if t.get('symbol')}
            effective_min_quote_volume = self._get_effective_min_quote_volume(account_equity)
            if account_equity is not None:
                self.account_equity = float(account_equity)
            
            # Filter AI500 candidates and sort by volume
            ai_stats = []
            skipped_blacklist = []
            skipped_liquidity = []
            for t in tickers:
                if t['symbol'] in self.ai500_candidates:
                    symbol = t['symbol']
                    if symbol in self.symbol_blacklist:
                        skipped_blacklist.append(symbol)
                        continue
                    try:
                        quote_vol = float(t.get('quoteVolume', 0))
                        last_price = float(t.get('lastPrice', 0))
                        if quote_vol < effective_min_quote_volume or last_price < self.min_price:
                            skipped_liquidity.append(f"{symbol}(vol={quote_vol:.0f},price={last_price:.4f})")
                            continue
                        ai_stats.append((symbol, quote_vol))
                    except (ValueError, TypeError):
                        pass
            
            # Sort by volume descending and get Top 10
            ai_stats.sort(key=lambda x: x[1], reverse=True)
            top_n = max(3, int(top_n))
            ai500_top10 = [x[0] for x in ai_stats[:top_n]]
            
            if skipped_blacklist:
                log.warning(f"🚫 AI500 blacklist excluded: {', '.join(skipped_blacklist)}")
            if skipped_liquidity:
                log.warning(f"⚠️ AI500 liquidity filter excluded: {', '.join(skipped_liquidity[:6])}{'...' if len(skipped_liquidity) > 6 else ''}")
            log.info(f"📊 AI500 Top {top_n} (filtered): {ai500_top10}")
            
            return ai500_top10
            
        except Exception as e:
            log.error(f"Failed to get expanded candidates: {e}")
            # Fallback: first 10 AI500
            return self.ai500_candidates[:10]
    
    async def _run_backtests_stage(
        self,
        symbols: List[str],
        step: int,
        stage_name: str
    ) -> List[Dict]:
        """Run backtests for a specific stage"""
        end_time = datetime.now()
        start_time = end_time - timedelta(hours=self.lookback_hours)
        
        valid_results = []
        total = len(symbols)
        
        for i, symbol in enumerate(symbols):
            log.info(f"🔄 [{stage_name}] [{i+1}/{total}] Backtesting {symbol}...")
            try:
                result = await self._backtest_symbol(symbol, start_time, end_time, step)
                if result:
                    valid_results.append(result)
                    log.info(f"   ✅ {symbol}: Return {result['total_return']:+.2f}%, Trades {result['trades']}")
            except Exception as e:
                log.warning(f"   ⚠️ {symbol} failed: {e}")
        
        return valid_results
    
    async def _backtest_symbol(
        self,
        symbol: str,
        start_time: datetime,
        end_time: datetime,
        step: int = 12
    ) -> Optional[Dict]:
        """Run backtest for a single symbol using thread executor"""
        try:
            config = BacktestConfig(
                symbol=symbol,
                start_date=start_time.strftime('%Y-%m-%d %H:%M'),
                end_date=end_time.strftime('%Y-%m-%d %H:%M'),
                initial_capital=10000.0,
                strategy_mode="technical",  # Use simple mode for speed
                use_llm=False,
                step=step
            )
            
            # Run sync backtest in thread executor to avoid blocking
            loop = asyncio.get_event_loop()
            engine = BacktestEngine(config)
            result = await loop.run_in_executor(None, lambda: asyncio.run(engine.run(progress_callback=None)))
            
            # BacktestResult has .metrics attribute with MetricsResult
            metrics = result.metrics
            
            return {
                "symbol": symbol,
                "total_return": metrics.total_return,
                "sharpe_ratio": metrics.sharpe_ratio,
                "win_rate": metrics.win_rate,
                "max_drawdown": metrics.max_drawdown_pct,
                "trades": metrics.total_trades,
                "profit_factor": metrics.profit_factor
            }
            
        except Exception as e:
            log.error(f"Backtest error for {symbol}: {e}")
            return None
    
    def _rank_symbols(self, results: List[Dict]) -> List[Dict]:
        """
        Rank symbols by composite score
        
        Scoring Formula:
        - Total Return: 30%
        - Sharpe Ratio: 20%
        - Win Rate: 25%
        - Max Drawdown: 15% (inverted penalty)
        - Trade Count: 10% (prefer 3-5 trades)
        """
        scored = []
        
        for result in results:
            # Extract metrics
            ret = result["total_return"]
            sharpe = max(result["sharpe_ratio"], 0)  # No negative Sharpe
            win_rate = result["win_rate"]
            dd = result["max_drawdown"]
            trades = result["trades"]
            
            # Composite score (0-100)
            score = (
                ret * 30 +                           # Return weight
                sharpe * 20 +                        # Sharpe weight
                win_rate * 0.25 +                    # Win rate weight
                max(0, 100 + dd) * 0.15 +           # Drawdown penalty
                min(trades / 5 * 10, 10)            # Trade frequency
            )
            
            result["composite_score"] = round(score, 2)
            scored.append(result)
        
        # Sort by score (descending)
        scored.sort(key=lambda x: x["composite_score"], reverse=True)
        
        return scored
    
    def _is_cache_valid(self) -> bool:
        """Check if cache exists and is still valid"""
        if not self.cache_file.exists():
            return False
        
        try:
            cache = self._load_cache()
            valid_until = datetime.fromisoformat(cache["valid_until"])
            return datetime.now() < valid_until
        except Exception:
            return False
    
    def _get_cache_age(self) -> float:
        """Get cache age in hours"""
        try:
            cache = self._load_cache()
            timestamp = datetime.fromisoformat(cache["timestamp"])
            return (datetime.now() - timestamp).total_seconds() / 3600
        except Exception:
            return 999
    
    def _load_cache(self) -> Dict:
        """Load cache from file"""
        with open(self.cache_file, 'r') as f:
            return json.load(f)
    
    def _save_cache(self, top3: List[Dict], all_results: Dict):
        """Save results to cache"""
        now = datetime.now()
        cache_data = {
            "timestamp": now.isoformat(),
            "valid_until": (now + timedelta(hours=self.refresh_interval)).isoformat(),
            "lookback_hours": self.lookback_hours,
            "selection_method": "two_stage",
            "top3": top3,
            "top5": all_results.get("top5", []),
            "stage1_results": all_results.get("stage1_results", []),
            "stage2_results": all_results.get("stage2_results", [])
        }
        
        with open(self.cache_file, 'w') as f:
            json.dump(cache_data, f, indent=2)
        
        log.info(f"💾 AUTO3 cache saved: valid until {cache_data['valid_until']}")
    
    def start_auto_refresh(self):
        """Start background thread for auto-refresh every 6 hours"""
        if self._refresh_thread and self._refresh_thread.is_alive():
            log.warning("Auto-refresh thread already running")
            return
        
        def refresh_loop():
            """Background refresh loop"""
            while not self._stop_refresh.is_set():
                # Wait for refresh interval
                if self._stop_refresh.wait(timeout=self.refresh_interval * 3600):
                    break  # Stop signal received
                
                # Run refresh
                log.info(f"🔄 AUTO3 auto-refresh triggered ({self.refresh_interval}h interval)")
                try:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    loop.run_until_complete(self.select_top3(force_refresh=True))
                    loop.close()
                except Exception as e:
                    log.error(f"❌ Auto-refresh failed: {e}", exc_info=True)
        
        self._refresh_thread = threading.Thread(target=refresh_loop, daemon=True, name="AUTO3-Refresh")
        self._refresh_thread.start()
        log.info(f"🔄 AUTO3 auto-refresh started ({self.refresh_interval}h interval)")
    
    def stop_auto_refresh(self):
        """Stop background refresh thread"""
        if self._refresh_thread and self._refresh_thread.is_alive():
            self._stop_refresh.set()
            self._refresh_thread.join(timeout=5)
            log.info("🛑 AUTO3 auto-refresh stopped")
    
    def get_symbols(self, force_refresh: bool = False) -> List[str]:
        """
        Synchronous wrapper for select_top3
        
        Args:
            force_refresh: Force re-run backtests even if cache valid
            
        Returns:
            List of 3 symbol names
        """
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # We're inside an async context
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(
                        lambda: asyncio.run(self.select_top3(force_refresh))
                    )
                    return future.result()
            else:
                return loop.run_until_complete(self.select_top3(force_refresh))
        except RuntimeError:
            # No event loop, create one
            return asyncio.run(self.select_top3(force_refresh))
