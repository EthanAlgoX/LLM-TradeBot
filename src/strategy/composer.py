"""
Strategy Composer
=================

Centralizes the "Four-Layer Strategy" logic and LLM Context Construction.
Ensures consistency between Live Trading and Backtesting.

Extracted from main.py to promote code reuse and consistency.
"""

import asyncio
from typing import Dict, Any, Optional
from datetime import datetime
import json

from src.utils.logger import log
from src.utils.semantic_converter import SemanticConverter
from src.agents.regime_detector_agent import RegimeDetector
from src.agents.trigger_detector_agent import TriggerDetector
from src.server.state import global_state

class StrategyComposer:
    def __init__(self, use_llm: bool = False):
        self.use_llm = use_llm
        self.regime_detector = RegimeDetector()
        self.trigger_detector = TriggerDetector()
        
        # Semantic Agents (Lazy initialization or init here)
        if self.use_llm:
            from src.agents.trend_agent import TrendAgentLLM
            from src.agents.setup_agent import SetupAgentLLM
            from src.agents.trigger_agent import TriggerAgentLLM
            self.trend_agent = TrendAgentLLM()
            self.setup_agent = SetupAgentLLM()
            self.trigger_agent = TriggerAgentLLM()
        else:
            from src.agents.trend_agent import TrendAgent
            from src.agents.setup_agent import SetupAgent
            from src.agents.trigger_agent import TriggerAgent
            self.trend_agent = TrendAgent()
            self.setup_agent = SetupAgent()
            self.trigger_agent = TriggerAgent()
        
    async def run_four_layer_analysis(self, 
                                      quant_analysis: Dict, 
                                      processed_dfs: Dict[str, Any], 
                                      current_price: float,
                                      predict_result: Any) -> Dict:
        """
        Run the rule-based "Four-Layer Strategy Filter" logic.
        
        Args:
            quant_analysis: Output from QuantAnalystAgent
            processed_dfs: Dict with '5m', '15m', '1h' DataFrames
            current_price: Current market price
            predict_result: Output from PredictAgent
            
        Returns:
            Dict containing 'four_layer_result' and 'semantic_analyses'
        """
        
        # --- PREPARATION ---
        df_1h = processed_dfs['1h']
        df_15m = processed_dfs['15m']
        df_5m = processed_dfs['5m']
        
        trend_1h_data = quant_analysis.get('timeframe_6h', {}) # Naming mismatch in main? check main.py usage
        # In main.py: trend_6h = quant_analysis.get('timeframe_6h', {}) which is unused in logic
        
        sentiment = quant_analysis.get('sentiment', {})
        oi_fuel = sentiment.get('oi_fuel', {})
        funding_rate = sentiment.get('details', {}).get('funding_rate', 0) or 0
        
        # Get ADX and Regime
        if len(df_1h) >= 20:
            regime_result = self.regime_detector.detect_regime(df_1h)
        else:
            regime_result = {'adx': 20, 'regime': 'unknown'}
        
        adx_value = regime_result.get('adx', 20)
        
        # Initialize Result Dict
        result = {
            'layer1_pass': False,
            'layer2_pass': False,
            'layer3_pass': False,
            'layer4_pass': False,
            'final_action': 'wait',
            'blocking_reason': None,
            'confidence_boost': 0,
            'tp_multiplier': 1.0,
            'sl_multiplier': 1.0,
            'adx': adx_value,
            'funding_rate': funding_rate,
            'regime': regime_result.get('regime', 'unknown')
        }
        
        # --- LAYER 1: Trend & Fuel ---
        if len(df_1h) < 20: # Modified from 60 for backtest safety
            close_1h = current_price
            ema20_1h = current_price
            ema60_1h = current_price
        else:
            close_1h = df_1h['close'].iloc[-1]
            ema20_1h = df_1h['ema_20'].iloc[-1] if 'ema_20' in df_1h.columns else close_1h
            ema60_1h = df_1h['ema_60'].iloc[-1] if 'ema_60' in df_1h.columns else close_1h
            
        result['close_1h'] = close_1h
        result['ema20_1h'] = ema20_1h
        result['ema60_1h'] = ema60_1h
        
        oi_change = oi_fuel.get('oi_change_24h', 0) or 0
        result['oi_change'] = oi_change
        
        # Trend Logic
        if close_1h > ema20_1h > ema60_1h:
            trend_1h = 'long'
        elif close_1h < ema20_1h < ema60_1h:
            trend_1h = 'short'
        else:
            trend_1h = 'neutral'
            
        # Layer 1 Checks
        if trend_1h == 'neutral':
            result['blocking_reason'] = 'No clear 1h trend (EMA 20/60)'
        elif adx_value < 15:
            result['blocking_reason'] = f"Weak Trend Strength (ADX {adx_value:.0f} < 15)"
        elif trend_1h == 'long' and oi_change < -5.0:
            # result['blocking_reason'] = f"OI Divergence: Trend UP but OI {oi_change:.1f}%"
            pass  # Allow trend following even with OI drop
        elif trend_1h == 'short' and oi_change > 5.0:
            # result['blocking_reason'] = f"OI Divergence: Trend DOWN but OI +{oi_change:.1f}%"
            pass
        elif trend_1h == 'long' and oi_fuel.get('whale_trap_risk', False):
             result['blocking_reason'] = f"Whale trap detected (OI {oi_change:.1f}%)"
        else:
            result['layer1_pass'] = True
            
            # Layer 2: AI Filter
            from src.agents.ai_prediction_filter_agent import AIPredictionFilter
            ai_filter = AIPredictionFilter()
            ai_check = ai_filter.check_divergence(trend_1h, predict_result)
            
            # Invalidation Check
            if adx_value < 5:
                ai_check['ai_invalidated'] = True
                ai_check['ai_signal'] = 'INVALID (ADX<5)'
                result['ai_prediction_note'] = "AI prediction invalidated: ADX<5"
                
            if ai_check['ai_veto']:
                result['blocking_reason'] = ai_check['reason']
            else:
                result['layer2_pass'] = True
                result['confidence_boost'] = ai_check['confidence_boost']
                
                # Layer 3: 15m Setup
                if len(df_15m) < 20:
                    result['blocking_reason'] = 'Insufficient 15m data'
                else:
                    close_15m = df_15m['close'].iloc[-1]
                    bb_middle = df_15m['bb_middle'].iloc[-1] if 'bb_middle' in df_15m.columns else close_15m
                    bb_upper = df_15m['bb_upper'].iloc[-1] if 'bb_upper' in df_15m.columns else close_15m * 1.02
                    bb_lower = df_15m['bb_lower'].iloc[-1] if 'bb_lower' in df_15m.columns else close_15m * 0.98
                    kdj_j = df_15m['kdj_j'].iloc[-1] if 'kdj_j' in df_15m.columns else 50
                    
                    result['kdj_j'] = kdj_j
                    result['bb_position'] = 'upper' if close_15m > bb_upper else 'lower' if close_15m < bb_lower else 'middle'
                    
                    if kdj_j > 80 or close_15m > bb_upper:
                         result['kdj_zone'] = 'overbought'
                    elif kdj_j < 20 or close_15m < bb_lower:
                         result['kdj_zone'] = 'oversold'
                    else:
                         result['kdj_zone'] = 'neutral'
                    
                    setup_ready = False
                    
                    if trend_1h == 'long':
                        if result['kdj_zone'] == 'overbought':
                            result['blocking_reason'] = f"15m overbought (J={kdj_j:.0f}) - wait for pullback"
                        else:
                            setup_ready = True
                            if close_15m < bb_middle or kdj_j < 50:
                                result['setup_quality'] = 'IDEAL'
                            else:
                                result['setup_quality'] = 'ACCEPTABLE'
                                
                    elif trend_1h == 'short':
                        if result['kdj_zone'] == 'oversold':
                            result['blocking_reason'] = f"15m oversold (J={kdj_j:.0f}) - wait for rally"
                        else:
                            setup_ready = True
                            if close_15m > bb_middle or kdj_j > 50:
                                result['setup_quality'] = 'IDEAL'
                            else:
                                result['setup_quality'] = 'ACCEPTABLE'
                    
                    if not setup_ready:
                        pass # blocking reason already set
                    else:
                        result['layer3_pass'] = True
                        
                        # Layer 4: Trigger
                        trigger_res = self.trigger_detector.detect_trigger(df_5m, direction=trend_1h)
                        result['trigger_pattern'] = trigger_res.get('pattern_type') or 'None'
                        result['trigger_rvol'] = trigger_res.get('rvol', 1.0)
                        
                        if not trigger_res['triggered']:
                             result['blocking_reason'] = f"5min trigger not confirmed (RVOL={result['trigger_rvol']:.1f}x)"
                        else:
                             result['layer4_pass'] = True
                             result['final_action'] = trend_1h
                             
                             # Sentiment Adjustments
                             sent_score = sentiment.get('total_sentiment_score', 0)
                             if sent_score > 80:
                                 result['tp_multiplier'] = 0.5
                             elif sent_score < -80:
                                 result['tp_multiplier'] = 1.5
                                 result['sl_multiplier'] = 0.8
                                 
                             # Funding Rate Adjustments
                             if trend_1h == 'long' and funding_rate > 0.05:
                                 result['tp_multiplier'] *= 0.7
                             elif trend_1h == 'short' and funding_rate < -0.05:
                                 result['tp_multiplier'] *= 0.7
                                 
        # --- SEMANTIC AGENTS ---
        try:
            # Prepare data objects
            trend_data = {
                'symbol': 'BTCUSDT', # Placeholder
                'close_1h': result.get('close_1h', current_price),
                'ema20_1h': result.get('ema20_1h', current_price),
                'ema60_1h': result.get('ema60_1h', current_price),
                'oi_change': result.get('oi_change', 0),
                'adx': result.get('adx', 20),
                'regime': result.get('regime', 'unknown')
            }
            
            setup_data = {
                'symbol': 'BTCUSDT',
                'close_15m': df_15m['close'].iloc[-1] if len(df_15m) > 0 else current_price,
                'kdj_j': result.get('kdj_j', 50),
                'kdj_k': df_15m['kdj_k'].iloc[-1] if len(df_15m) > 0 and 'kdj_k' in df_15m.columns else 50,
                'bb_upper': df_15m['bb_upper'].iloc[-1] if len(df_15m)>0 and 'bb_upper' in df_15m.columns else current_price*1.02,
                'bb_middle': df_15m['bb_middle'].iloc[-1] if len(df_15m)>0 and 'bb_middle' in df_15m.columns else current_price,
                'bb_lower': df_15m['bb_lower'].iloc[-1] if len(df_15m)>0 and 'bb_lower' in df_15m.columns else current_price*0.98,
                'trend_direction': trend_1h if result['layer1_pass'] else 'neutral',
                'macd_diff': 0 # simplify for now
            }
            
            trigger_data = {
                'symbol': 'BTCUSDT',
                'pattern': result.get('trigger_pattern'),
                'rvol': result.get('trigger_rvol', 1.0),
                'trend_direction': result.get('final_action', 'neutral')
            }
            
            # Execute Agents
            # Note: In synchronous context (backtest loop might be async but we call this from async step), 
            # we can use await directly or use loop.run_in_executor if they are blocking.
            # The agents 'analyze' methods are usually synchronous (CPU bound).
            
            trend_analysis = self.trend_agent.analyze(trend_data)
            setup_analysis = self.setup_agent.analyze(setup_data)
            trigger_analysis = self.trigger_agent.analyze(trigger_data)
            
            semantic_analyses = {
                'trend': trend_analysis,
                'setup': setup_analysis,
                'trigger': trigger_analysis
            }
            
        except Exception as e:
            log.error(f"Semantic analysis failed: {e}")
            semantic_analyses = {}
            
        return {
            'four_layer_result': result,
            'semantic_analyses': semantic_analyses,
            'regime_result': regime_result # Expose regime result for position info
        }

    def build_market_context(self, 
                             symbol: str, 
                             current_price: float,
                             quant_analysis: Dict, 
                             predict_result: Any, 
                             market_data: Dict, 
                             four_layer_result: Dict,
                             semantic_analyses: Dict,
                             position_info: Dict = None) -> str:
        """
        Build the FULL Market Context for LLM found in main.py
        """
        
        # --- 1. Position Section ---
        position_section = ""
        if position_info:
            side_icon = "🟢" if position_info['side'].upper() == 'LONG' else "🔴"
            pnl = position_info.get('unrealized_pnl', 0)
            pnl_icon = "💰" if pnl > 0 else "💸"
            position_section = f"""
## 💼 CURRENT POSITION STATUS (Virtual Sub-Agent Logic)
> ⚠️ CRITICAL: YOU ARE HOLDING A POSITION. EVALUATE EXIT CONDITIONS FIRST.

- **Status**: {side_icon} {position_info['side']}
- **Entry Price**: ${position_info.get('entry_price', 0):,.2f}
- **Current Price**: ${current_price:,.2f}
- **PnL**: {pnl_icon} ${pnl:.2f} ({position_info.get('pnl_pct', 0):+.2f}%)
- **Quantity**: {position_info.get('quantity', 0)}
- **Leverage**: {position_info.get('leverage', 1)}x

**EXIT JUDGMENT INSTRUCTION**:
1. **Trend Reversal**: If current trend contradicts position side (e.g. Long but Trend turned Bearish), consider CLOSE.
2. **Profit/Risk**: Check if PnL is satisfactory or risk is increasing.
3. **If Closing**: Return `close_position` action.
"""

        # --- 2. Four Layer Status ---
        blocking_reason = four_layer_result.get('blocking_reason', 'None')
        layer1 = four_layer_result.get('layer1_pass')
        layer2 = four_layer_result.get('layer2_pass')
        layer3 = four_layer_result.get('layer3_pass')
        layer4 = four_layer_result.get('layer4_pass')
        
        layer_status = []
        
        if not layer1 and not layer2:
             layer_status.append(f"❌ **Layers 1-2 BLOCKED**: {blocking_reason}")
        else:
             layer_status.append(f"{'✅' if layer1 else '❌'} **Trend/Fuel**: {'PASS' if layer1 else 'FAIL - ' + str(blocking_reason)}")
             layer_status.append(f"{'✅' if layer2 else '❌'} **AI Filter**: {'PASS' if layer2 else 'VETO - ' + str(blocking_reason)}")
             
        layer_status.append(f"{'✅' if layer3 else '⏳'} **Setup (15m)**: {'READY' if layer3 else 'WAIT'}")
        layer_status.append(f"{'✅' if layer4 else '⏳'} **Trigger (5m)**: {'CONFIRMED' if layer4 else 'WAITING'}")
        
        tp_mult = four_layer_result.get('tp_multiplier', 1.0)
        sl_mult = four_layer_result.get('sl_multiplier', 1.0)
        if tp_mult != 1.0 or sl_mult != 1.0:
            layer_status.append(f"⚖️ **Risk Adjustment**: TP x{tp_mult} | SL x{sl_mult}")

        status_text = "\n".join(layer_status)
        
        # --- 3. Semantic Analysis ---
        trend_res = semantic_analyses.get('trend', {})
        setup_res = semantic_analyses.get('setup', {})
        
        if isinstance(trend_res, dict):
             trend_stance = trend_res.get('stance', 'UNKNOWN')
             trend_meta = trend_res.get('metadata', {})
             trend_header = f"### 🔮 Trend & Direction Analysis [{trend_stance}] (Strength: {trend_meta.get('strength', 'N/A')})"
             trend_body = trend_res.get('analysis', 'N/A')
        else:
             trend_header = "### 🔮 Trend & Direction Analysis"
             trend_body = str(trend_res)

        if isinstance(setup_res, dict):
             setup_stance = setup_res.get('stance', 'UNKNOWN')
             setup_meta = setup_res.get('metadata', {})
             setup_header = f"### 📊 Entry Zone Analysis [{setup_stance}] (Zone: {setup_meta.get('zone', 'N/A')})"
             setup_body = setup_res.get('analysis', 'N/A')
        else:
             setup_header = "### 📊 Entry Zone Analysis"
             setup_body = str(setup_res)

        # --- Assemble Context ---
        context = f"""
## 1. Price & Position Overview
- Symbol: {symbol}
- Current Price: ${current_price:,.2f}

{position_section}

## 2. Four-Layer Strategy Status
{status_text}

## 3. Detailed Market Analysis

{trend_header}
{trend_body}

{setup_header}
{setup_body}

"""
        # Append Quant Analysis details if needed (simplified from main.py's implementation for brevity but capturing essence)
        # main.py appends more details, but the Semantic Agents usually cover the important parts.
        
        return context
