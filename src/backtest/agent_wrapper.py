"""
Backtest Agent Wrapper
======================

Adapts the production Multi-Agent system for Backtesting.

Key Components:
1. BacktestSignalCalculator: Re-implements technical analysis logic locally (since we don't have the external DataSyncAgent in backtest).
2. BacktestAgentRunner: Orchestrates the agents (Critic, etc.) using simulated data.

Author: AI Trader Team
Date: 2025-12-31
"""

import pandas as pd
import numpy as np
import asyncio
from typing import Dict, Any, Optional
from dataclasses import dataclass

from src.agents.decision_core.decision_core_agent import DecisionCoreAgent
from src.strategy.composer import StrategyComposer # ✅ Shared Strategy Logic
from src.utils.logger import log

@dataclass
class MockPredictResult:
    probability_up: float = 0.5
    signal: str = 'neutral'
    confidence: float = 0.0


class BacktestSignalCalculator:
    """
    Re-implements core signal logic for Backtesting.
    Generates numeric scores compatible with DecisionCoreAgent.
    """
    
    @staticmethod
    def calculate_ema(series: pd.Series, span: int) -> pd.Series:
        return series.ewm(span=span, adjust=False).mean()
    
    @staticmethod
    def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
        delta = series.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        
        # 防止除零错误：将零值替换为极小值
        loss = loss.replace(0, 1e-10)
        rs = gain / loss
        return 100 - (100 / (1 + rs))
    
    @staticmethod
    def calculate_kdj(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 9, m1: int = 3, m2: int = 3):
        low_min = low.rolling(window=n).min()
        high_max = high.rolling(window=n).max()
        
        rsv = 100 * (close - low_min) / (high_max - low_min)
        
        # Use EWM for smooth K and D (classic KDJ uses SMA, but EWM is common in crypto)
        # Using com=m-1 which is equivalent to alpha=1/m
        k = rsv.ewm(alpha=1/m1, adjust=False).mean()
        d = k.ewm(alpha=1/m2, adjust=False).mean()
        j = 3 * k - 2 * d
        
        return k, d, j

    @staticmethod
    def calculate_macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
        ema_fast = close.ewm(span=fast, adjust=False).mean()
        ema_slow = close.ewm(span=slow, adjust=False).mean()
        macd_line = ema_fast - ema_slow
        signal_line = macd_line.ewm(span=signal, adjust=False).mean()
        macd_hist = (macd_line - signal_line) * 2
        return macd_line, signal_line, macd_hist

    def analyze_trend(self, df: pd.DataFrame) -> Dict:
        """Calculate trend score (-100 to +100)"""
        if df is None or len(df) < 60:
            return {'score': 0, 'signal': 'neutral', 'details': {}}
        
        close = df['close']
        ema20 = self.calculate_ema(close, 20)
        ema60 = self.calculate_ema(close, 60)
        
        curr_close = close.iloc[-1]
        curr_ema20 = ema20.iloc[-1]
        curr_ema60 = ema60.iloc[-1]
        
        score = 0
        details = {'ema_status': 'neutral'}
        
        # 📈 OPTIMIZED: Relaxed EMA conditions to match main.py Layer 1
        # Primary condition: EMA20 > EMA60 = Bullish, EMA20 < EMA60 = Bearish
        if curr_ema20 > curr_ema60:
            # Bullish - EMA arrangement
            if curr_close > curr_ema20:
                score = 80  # Strong confirmation: Close above both EMAs
                details['ema_status'] = 'strong_bullish'
            else:
                score = 60  # Moderate: EMA20>EMA60 but Close below EMA20
                details['ema_status'] = 'moderate_bullish'
        elif curr_ema20 < curr_ema60:
            # Bearish - EMA arrangement
            if curr_close < curr_ema20:
                score = -80  # Strong confirmation: Close below both EMAs
                details['ema_status'] = 'strong_bearish'
            else:
                score = -60  # Moderate: EMA20<EMA60 but Close above EMA20
                details['ema_status'] = 'moderate_bearish'
        
        return {'score': score, 'signal': 'long' if score > 0 else 'short', 'details': details}

    def analyze_oscillator(self, df: pd.DataFrame) -> Dict:
        """Calculate oscillator score (-100 to +100)"""
        if df is None or len(df) < 30:
            return {'score': 0, 'signal': 'neutral', 'details': {}}
            
        close = df['close']
        high = df['high']
        low = df['low']
        
        # RSI
        rsi = self.calculate_rsi(close, 14)
        curr_rsi = rsi.iloc[-1]
        
        # KDJ
        k, d, j = self.calculate_kdj(high, low, close)
        curr_j = j.iloc[-1]
        
        score = 0
        details = {'rsi_value': round(curr_rsi, 1), 'kdj_j': round(curr_j, 1)}
        
        # RSI Logic
        if curr_rsi < 30:
            score += 40 # Oversold -> Bullish
        elif curr_rsi > 70:
            score -= 40 # Overbought -> Bearish
            
        # KDJ Logic
        if curr_j < 20:
             score += 30
        elif curr_j > 80:
             score -= 30
             
        return {'score': score, 'signal': 'long' if score > 0 else 'short', 'details': details}

    def compute_all_signals(self, snapshot) -> Dict:
        """
        Compute full quant analysis structure compatible with DecisionCoreAgent
        """
        # Calculate Trend Scores
        t_5m = self.analyze_trend(snapshot.stable_5m)
        t_15m = self.analyze_trend(snapshot.stable_15m)
        t_1h = self.analyze_trend(snapshot.stable_1h)
        
        # Calculate Oscillator Scores
        o_5m = self.analyze_oscillator(snapshot.stable_5m)
        o_15m = self.analyze_oscillator(snapshot.stable_15m)
        o_1h = self.analyze_oscillator(snapshot.stable_1h)
        
        # Structure matches QuantAnalystAgent output
        return {
            'trend': {
                'trend_5m_score': t_5m['score'],
                'trend_15m_score': t_15m['score'],
                'trend_1h_score': t_1h['score'],
                'trend_5m': t_5m,
                'trend_15m': t_15m,
                'trend_1h': t_1h
            },
            'oscillator': {
                'osc_5m_score': o_5m['score'],
                'osc_15m_score': o_15m['score'],
                'osc_1h_score': o_1h['score'],
                'oscillator_5m': o_5m,
                'oscillator_15m': o_15m,
                'oscillator_1h': o_1h
            },
            'sentiment': {
                'total_sentiment_score': 0, # Placeholder, hard to simulate without global data
                'details': {'note': 'Sentiment neutral in backtest'}
            }
        }


class BacktestAgentRunner:
    """
    Wraps the Agent System for Backtesting.
    """
    
    def __init__(self, config: Dict = None):
        self.config = config or {}
        
        # Use production agents for 100% logic parity
        from src.agents.quant_analyst_agent import QuantAnalystAgent
        # We only need the DecisionCoreAgent (The Critic) to make final decisions
        self.decision_core = DecisionCoreAgent()
        self.quant_analyst = QuantAnalystAgent() # Replaces legacy calculator
        self.strategy_composer = StrategyComposer(use_llm=self.config.get('use_llm', False)) # ✅ Shared Strategy Logic
        
        # LLM log collection for backtest
        self.llm_logs = []  # Store LLM interaction logs
        
        # Initialize LLM engine if enabled
        if self.config.get('use_llm', False):
            from src.strategy.llm_engine import StrategyEngine
            self.llm_engine = StrategyEngine()
            log.info("🤖 BacktestAgentRunner initialized with LLM Engine enabled")
        else:
            self.llm_engine = None
            log.info("🤖 BacktestAgentRunner initialized (LLM disabled)")

    async def step(self, snapshot, portfolio=None) -> Dict:
        """
        Process one backtest step
        """
        try:
            # OPTIMIZATION: Skip expensive analysis during warmup period
            # When we don't have enough data, technical indicators are unreliable
            # Relaxed threshold: 20 candles minimum (was 60) to support shorter backtests
            is_warmup = len(snapshot.stable_1h) < 20
            
            if is_warmup:
                # Fast path: return neutral decision without analysis
                return {
                    'action': 'hold',
                    'confidence': 0,
                    'reason': 'Warmup period - insufficient data for analysis',
                    'vote_details': {},
                    'weighted_score': 0,
                    'llm_enhanced': False
                }
            
            # 1. Calculate Signals using REAL QuantAnalystAgent
            # Use await since analyze_all_timeframes is async
            quant_analysis = await self.quant_analyst.analyze_all_timeframes(snapshot)
            
            # 2. Make Decision via Critic
            # We mock the PredictResult (ML disabled for speed/simplicity in backtest for now)
            predict_result = MockPredictResult()
            
            live_price = snapshot.live_5m.get('open', snapshot.live_5m.get('close', 0))
            # 🔧 FIX: Pass complete market_data consistent with live trading environment
            market_data_for_critic = {
                 'df_5m': snapshot.stable_5m,
                 'df_15m': snapshot.stable_15m,  # Added for consistency
                 'df_1h': snapshot.stable_1h,    # Added for consistency
                 'current_price': live_price
            }
            
            vote_result = await self.decision_core.make_decision(
                quant_analysis=quant_analysis,
                predict_result=predict_result,
                market_data=market_data_for_critic
            )
            
            # 3. LLM Enhancement (if enabled)
            # OPTIMIZATION: Skip LLM during warmup (when trend scores are 0 due to insufficient data)
            is_warmup = (
                quant_analysis.get('trend', {}).get('total_trend_score', 0) == 0 and
                quant_analysis.get('oscillator', {}).get('total_osc_score', 0) == 0 and
                len(snapshot.stable_1h) < 60
            )
            
            if self.llm_engine and not is_warmup:
                # Throttle to avoid rate limits
                throttle_ms = self.config.get('llm_throttle_ms', 100)
                if throttle_ms > 0:
                    await asyncio.sleep(throttle_ms / 1000)
                
                # ✅ Run Shared Strategy Analysis (Four Layer + Semantics)
                processed_dfs = {
                    '5m': snapshot.stable_5m,
                    '15m': snapshot.stable_15m,
                    '1h': snapshot.stable_1h
                }
                
                analysis_result = await self.strategy_composer.run_four_layer_analysis(
                    quant_analysis=quant_analysis,
                    processed_dfs=processed_dfs,
                    current_price=live_price,
                    predict_result=predict_result
                )
                
                # Call LLM with full context
                llm_decision = await self._call_llm_with_context(
                    snapshot, quant_analysis, vote_result, portfolio, analysis_result, predict_result
                )
                
                # Merge LLM reasoning with quant signals
                final_decision = self._merge_decisions(vote_result, llm_decision)
            else:
                final_decision = vote_result
            
            osc_data = quant_analysis.get('oscillator', {})
            osc_scores = {
                'osc_1h_score': osc_data.get('osc_1h_score', 0),
                'osc_15m_score': osc_data.get('osc_15m_score', 0),
                'osc_5m_score': osc_data.get('osc_5m_score', 0)
            }
            trend_data = quant_analysis.get('trend', {})
            trend_scores = {
                'trend_1h_score': trend_data.get('trend_1h_score', 0),
                'trend_15m_score': trend_data.get('trend_15m_score', 0),
                'trend_5m_score': trend_data.get('trend_5m_score', 0)
            }
            regime_info = getattr(final_decision, 'regime', None) or getattr(vote_result, 'regime', None)
            position_info = getattr(final_decision, 'position', None) or getattr(vote_result, 'position', None)
            
            # Calculate ATR for risk audit
            atr_pct = None
            df_15m = snapshot.stable_15m
            if df_15m is not None and len(df_15m) > 20:
                try:
                    atr = self.quant_analyst.calculate_atr(
                        df_15m['high'], df_15m['low'], df_15m['close']
                    ).iloc[-1]
                    close = df_15m['close'].iloc[-1]
                    if close:
                        atr_pct = float(atr / close * 100)
                except Exception:
                    atr_pct = None
            
            # Calculate position_1h for context
            position_1h = None
            df_1h = snapshot.stable_1h
            if df_1h is not None and len(df_1h) > 5:
                try:
                    from src.agents.position_analyzer_agent import PositionAnalyzer
                    analyzer = PositionAnalyzer()
                    position_1h = analyzer.analyze_position(
                        df_1h,
                        live_price,
                        timeframe='1h'
                    )
                except Exception:
                    position_1h = None

            # 4. Format result
            return {
                'action': final_decision.action,
                'confidence': final_decision.confidence,
                'reason': final_decision.reason,
                'vote_details': getattr(final_decision, 'vote_details', {}),
                'weighted_score': getattr(final_decision, 'weighted_score', 0),
                'llm_enhanced': self.llm_engine is not None,
                'trade_params': getattr(final_decision, 'trade_params', None),
                'regime': regime_info,
                'position': position_info,
                'oscillator_scores': osc_scores,
                'trend_scores': trend_scores,
                'atr_pct': atr_pct,
                'position_1h': position_1h
            }
            
        except Exception as e:
            log.error(f"Backtest agent step error: {e}", exc_info=True) # Added exc_info
            return {
                'action': 'hold',
                'confidence': 0,
                'reason': f"Error: {str(e)}"
            }
    
    async def _call_llm_with_context(self, snapshot, quant_analysis, vote_result, portfolio, analysis_result, predict_result):
        """Call LLM with full market context using StrategyComposer"""
        import json
        from datetime import datetime
        
        current_price = snapshot.live_5m.get('open', snapshot.live_5m.get('close', 0))
        symbol = self.config.get('symbol', 'BTCUSDT')
        
        # Build Position Info dict for StrategyComposer
        position_info = None
        if portfolio and symbol in portfolio.positions:
             pos = portfolio.positions[symbol]
             # Parse Side
             side_str = 'LONG' if 'LONG' in str(pos.side).upper() else 'SHORT'
             position_info = {
                 'side': side_str,
                 'entry_price': pos.entry_price,
                 'quantity': pos.quantity,
                 'unrealized_pnl': pos.get_pnl(current_price), 
                 'pnl_pct': pos.get_pnl_pct(current_price),
                 'leverage': 1 # Default or from pos
             }

        # Build context string using Shared Logic
        context_text = self.strategy_composer.build_market_context(
            symbol=symbol,
            current_price=current_price,
            quant_analysis=quant_analysis,
            predict_result=predict_result,
            market_data={'current_price': current_price},
            four_layer_result=analysis_result['four_layer_result'],
            semantic_analyses=analysis_result['semantic_analyses'],
            position_info=position_info
        )
        
        # Build context data dict
        context_data = {
            'symbol': symbol,
            'timestamp': datetime.now().isoformat(),
            'current_price': current_price,
            'quant_analysis': quant_analysis,
            'vote_result': {
                'action': vote_result.action,
                'confidence': vote_result.confidence,
                'weighted_score': vote_result.weighted_score
            }
        }
        
        # Call LLM engine
        try:
            llm_result_dict = self.llm_engine.make_decision(
                market_context_text=context_text,
                market_context_data=context_data,
                reflection=None # TODO: Add Backtest Reflection Support
            )
            
            # Convert dict to VoteResult-like object
            from src.agents.decision_core.decision_core_agent import VoteResult
            llm_result = VoteResult(
                action=llm_result_dict.get('action', 'hold'),
                confidence=llm_result_dict.get('confidence', 0),
                reason=llm_result_dict.get('reasoning', 'LLM decision'),
                weighted_score=llm_result_dict.get('weighted_score', 0),
                vote_details={},
                multi_period_aligned=False,
                trade_params={
                    'stop_loss_pct': llm_result_dict.get('stop_loss_pct'),
                    'take_profit_pct': llm_result_dict.get('take_profit_pct'),
                    'trailing_stop_pct': llm_result_dict.get('trailing_stop_pct'), # Added
                    'leverage': llm_result_dict.get('leverage'),
                    'position_size_pct': llm_result_dict.get('position_size_pct')
                }
            )
            
            # Save LLM log for backtest
            log_entry = {
                'timestamp': datetime.now().isoformat(),
                'context': context_text,
                'llm_response': llm_result_dict,
                'final_decision': {
                    'action': llm_result.action,
                    'confidence': llm_result.confidence,
                    'reason': llm_result.reason
                }
            }
            self.llm_logs.append(log_entry)
            
            log.info(f"🤖 LLM Decision: {llm_result.action} (confidence: {llm_result.confidence}%)")
            return llm_result
        except Exception as e:
            log.warning(f"LLM call failed: {e}, falling back to quant decision")
            return vote_result
    
    def _merge_decisions(self, quant_vote, llm_decision):
        """Merge quantitative and LLM decisions"""
        from dataclasses import replace
        
        # Strategy: LLM can override if confidence > 40 (was 50), allowing Agent to lead more
        if llm_decision.confidence > 40:
            # LLM override with high confidence
            log.info(f"🎯 LLM override: {llm_decision.action} (confidence: {llm_decision.confidence}%)")
            return llm_decision
        else:
            # NEW: Boost confidence when LLM yields but quant signals are strong
            # This addresses the issue where LLM outputs 0% causing missed opportunities
            boosted_vote = quant_vote
            if quant_vote.weighted_score and abs(quant_vote.weighted_score) >= 8:  # Was 10
                # Strong quant signal, apply minimum confidence of 70%
                min_confidence = 70  # Was 65
                if quant_vote.confidence < min_confidence:
                    log.info(f"⚡ Confidence boost: {quant_vote.confidence}% -> {min_confidence}% (strong quant score: {quant_vote.weighted_score})")
                    try:
                        boosted_vote = replace(quant_vote, confidence=min_confidence)
                    except:
                        quant_vote.confidence = min_confidence
                        boosted_vote = quant_vote
            
            # Enhance quant decision with LLM reasoning
            enhanced_reason = f"{boosted_vote.reason} | LLM: {llm_decision.reason}"
            
            # Create a new VoteResult with enhanced reasoning
            try:
                enhanced_vote = replace(boosted_vote, reason=enhanced_reason)
            except:
                # Fallback if replace doesn't work
                boosted_vote.reason = enhanced_reason
                enhanced_vote = boosted_vote
            
            log.info(f"✨ Enhanced decision: {enhanced_vote.action} with LLM reasoning")
            return enhanced_vote
