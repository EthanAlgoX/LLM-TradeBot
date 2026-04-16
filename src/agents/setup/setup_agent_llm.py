"""
Setup Agent - 15m Setup Analysis

Analyzes 15m timeframe data and produces semantic analysis:
- KDJ oscillator position
- Bollinger Band position
- MACD momentum (15m)
- Entry zone assessment
"""

from typing import Dict, Optional
from src.llm import create_client, LLMConfig
from src.config import Config
from src.utils.logger import log

from .setup_agent import SetupAgent

class SetupAgentLLM(SetupAgent):
    """
    15m Setup Analysis Agent
    
    Input: KDJ, Bollinger Bands, MACD (15m), price position
    Output: Semantic analysis paragraph
    """
    
    def __init__(
        self,
        config: Config
    ):
        """Initialize SetupAgentLLM with LLM client"""
        llm_config = config.llm
        provider = llm_config.get('provider', 'deepseek')
        
        # Get API key for the provider
        api_keys = llm_config.get('api_keys', {})
        api_key = api_keys.get(provider)
        
        # Backward compatibility: use old deepseek config if needed
        if not api_key and provider == 'deepseek':
            api_key = config.deepseek.get('api_key')
        
        if not api_key:
            log.warning(f"📊 SetupAgentLLM: No API key for {provider}, using fallback")
            api_key = "dummy-key-will-fail"
        
        self.client = create_client(provider, LLMConfig(
            api_key=api_key,
            base_url=llm_config.get('base_url'),
            model=llm_config.get('model') or (config.deepseek.get('model', 'deepseek-chat') if provider == 'deepseek' else None),
            temperature=0.3,
            max_tokens=300
        ))
        
        log.info("📊 Setup Agent LLM initialized")
    
    def analyze(self, data: Dict) -> Dict:
        """
        Analyze 15m setup data and return semantic analysis with stance
        
        Args:
            data: {
                'symbol': 'BTCUSDT',
                'close_15m': 95000.0,
                'kdj_j': 45,
                'kdj_k': 50,
                'bb_upper': 96000.0,
                'bb_middle': 95000.0,
                'bb_lower': 94000.0,
                'trend_direction': 'long'  # From Layer 1
            }
            
        Returns:
            Dict with 'analysis', 'stance', and 'metadata'
        """
        try:
            prompt = self._build_prompt(data)
            
            # Use unified LLM interface
            response = self.client.chat(
                system_prompt=self.get_system_prompt(),
                user_prompt=prompt
            )
            
            analysis = response.content.strip()
            
            signals = self._compute_setup_signals(data)
            
            result = {
                'analysis': analysis,
                'stance': signals['stance'],
                'metadata': {
                    'zone': signals['zone'],
                    'kdj_j': round(signals['kdj_j'], 1),
                    'trend': signals['trend'].upper(),
                    'bb_position': signals['bb_position'],
                    'macd_signal': signals['macd_signal'],
                    'macd_diff': round(signals['macd_diff'], 2)
                }
            }
            
            log.info(f"📊 Setup Agent LLM [{signals['stance']}] (Zone: {signals['zone']}, KDJ: {signals['kdj_j']:.1f}) for {data.get('symbol', 'UNKNOWN')}")
            
            # 🆕 保存日志
            try:
                from src.server.state import global_state
                if hasattr(global_state, 'saver') and hasattr(global_state, 'current_cycle_id'):
                    global_state.saver.save_setup_analysis(
                        analysis=analysis,
                        input_data=data,
                        symbol=data.get('symbol', 'UNKNOWN'),
                        cycle_id=global_state.current_cycle_id,
                        model=self.client.model if hasattr(self.client, 'model') else 'deepseek-chat'
                    )
            except Exception as e:
                log.warning(f"Failed to save setup analysis log: {e}")
            
            return result
            
        except Exception as e:
            log.error(f"❌ Setup Agent error: {e}")
            fallback = self._get_fallback_analysis(data)
            return {
                'analysis': fallback,
                'stance': 'ERROR',
                'metadata': {'error': str(e)}
            }
    
    def get_system_prompt(self) -> Optional[str]:
        """System prompt for setup analysis"""
        return """You are a professional crypto setup analyst. Your task is to analyze 15m timeframe data and assess entry positions using KDJ, Bollinger Bands, and MACD.

Output format: 2-3 sentences covering:
1. KDJ oscillator status (overbought/oversold/neutral)
2. MACD momentum direction and strength
3. Price position relative to Bollinger Bands
4. Entry zone assessment (good entry zone or wait)

Be concise, professional, and objective. Use trading terminology.
Do NOT use markdown formatting. Output plain text only."""

    def _build_prompt(self, data: Dict) -> str:
        """Build analysis prompt from data"""
        symbol = data.get('symbol', 'UNKNOWN')
        close = data.get('close_15m', 0)
        kdj_j = data.get('kdj_j', 50)
        kdj_k = data.get('kdj_k', 50)
        bb_upper = data.get('bb_upper', 0)
        bb_middle = data.get('bb_middle', 0)
        bb_lower = data.get('bb_lower', 0)
        trend = data.get('trend_direction', 'neutral')
        macd_diff = data.get('macd_diff', 0)  # 🆕 MACD data
        
        # Determine KDJ status
        if kdj_j > 80:
            kdj_status = "OVERBOUGHT (J > 80)"
        elif kdj_j < 20:
            kdj_status = "OVERSOLD (J < 20)"
        elif kdj_j < 50:  # OPTIMIZATION (Phase 2): Relaxed from 40
            kdj_status = "PULLBACK ZONE (J < 50)"
        elif kdj_j > 50:  # OPTIMIZATION (Phase 2): Relaxed from 60
            kdj_status = "RALLY ZONE (J > 50)"
        else:
            kdj_status = "NEUTRAL (40 < J < 60)"
        
        # Determine BB position
        if close > bb_upper:
            bb_status = "ABOVE UPPER BAND (extended)"
        elif close < bb_lower:
            bb_status = "BELOW LOWER BAND (extended)"
        elif close > bb_middle:
            bb_status = "ABOVE MIDDLE BAND"
        else:
            bb_status = "BELOW MIDDLE BAND"
        
        # 🆕 Determine MACD status
        if macd_diff > 0:
            macd_status = f"BULLISH (Diff: {macd_diff:+.2f})"
        elif macd_diff < 0:
            macd_status = f"BEARISH (Diff: {macd_diff:+.2f})"
        else:
            macd_status = "NEUTRAL"
        
        return f"""Analyze the following 15m setup data for {symbol}:

1h Trend Direction: {trend.upper()}

KDJ Oscillator:
- KDJ_J: {kdj_j:.1f}
- KDJ_K: {kdj_k:.1f}
- Status: {kdj_status}

MACD (15m):
- Histogram Diff: {macd_diff:+.2f}
- Status: {macd_status}

Bollinger Bands:
- Upper: ${bb_upper:,.2f}
- Middle: ${bb_middle:,.2f}
- Lower: ${bb_lower:,.2f}
- 15m Close: ${close:,.2f}
- Position: {bb_status}

Provide a 2-3 sentence semantic analysis of the setup situation.
Consider: For LONG, we want pullback (KDJ<40 or near lower BB) + bullish MACD. For SHORT, we want rally (KDJ>60 or near upper BB) + bearish MACD."""

    def _get_fallback_analysis(self, data: Dict) -> str:
        """Fallback analysis when LLM fails"""
        kdj_j = data.get('kdj_j', 50)
        trend = data.get('trend_direction', 'neutral')
        close = data.get('close_15m', 0)
        bb_middle = data.get('bb_middle', 0)
        
        if trend == 'long':
            if kdj_j < 40:
                return f"15m setup shows pullback zone with KDJ_J={kdj_j:.0f}. Good entry area for long positions. Price is {'below' if close < bb_middle else 'above'} BB middle."
            elif kdj_j > 80:
                return f"15m is overbought with KDJ_J={kdj_j:.0f}. Wait for pullback before entering long positions."
            else:
                return f"15m is in neutral zone with KDJ_J={kdj_j:.0f}. Wait for clearer pullback signal."
        elif trend == 'short':
            if kdj_j > 60:
                return f"15m setup shows rally zone with KDJ_J={kdj_j:.0f}. Good entry area for short positions."
            elif kdj_j < 20:
                return f"15m is oversold with KDJ_J={kdj_j:.0f}. Wait for rally before entering short positions."
            else:
                return f"15m is in neutral zone with KDJ_J={kdj_j:.0f}. Wait for clearer rally signal."
