"""
Trigger Agent - 5m Trigger Analysis

Analyzes 5m timeframe data and produces semantic analysis:
- Candlestick patterns (engulfing, etc.)
- Volume analysis (RVOL)
- Entry trigger assessment
"""

from typing import Dict, Optional
from src.llm import create_client, LLMConfig
from src.config import Config
from src.utils.logger import log

from .trigger_agent import TriggerAgent

class TriggerAgentLLM(TriggerAgent):
    """
    5m Trigger Analysis Agent
    
    Input: Pattern detection, RVOL, candle data
    Output: Semantic analysis paragraph
    """
    
    def __init__(
        self,
        config: Config
    ):
        """Initialize TriggerAgentLLM with LLM client"""
        llm_config = config.llm
        provider = llm_config.get('provider', 'deepseek')
        
        # Get API key for the provider
        api_keys = llm_config.get('api_keys', {})
        api_key = api_keys.get(provider)
        
        # Backward compatibility: use old deepseek config if needed
        if not api_key and provider == 'deepseek':
            api_key = config.deepseek.get('api_key')
        
        if not api_key:
            log.warning(f"⚡ TriggerAgentLLM: No API key for {provider}, using fallback")
            api_key = "dummy-key-will-fail"
        
        self.client = create_client(provider, LLMConfig(
            api_key=api_key,
            base_url=llm_config.get('base_url'),
            model=llm_config.get('model') or (config.deepseek.get('model', 'deepseek-chat') if provider == 'deepseek' else None),
            temperature=0.3,
            max_tokens=300
        ))
        
        log.info("⚡ Trigger Agent LLM initialized")
    
    def analyze(self, data: Dict) -> Dict:
        """
        Analyze 5m trigger data and return semantic analysis with stance
        
        Args:
            data: {
                'symbol': 'BTCUSDT',
                'pattern': 'engulfing' or None,
                'pattern_type': 'bullish_engulfing' or None,
                'rvol': 1.5,
                'volume_breakout': False,
                'trend_direction': 'long'
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
            
            signals = self._compute_trigger_signals(data)
            
            result = {
                'analysis': analysis,
                'stance': signals['stance'],
                'metadata': {
                    'status': signals['status'],
                    'pattern': signals['pattern'],
                    'rvol': round(signals['rvol'], 1),
                    'volume_breakout': signals['volume_breakout']
                }
            }
            
            log.info(f"⚡ Trigger Agent LLM [{signals['stance']}] (Pattern: {result['metadata']['pattern']}, RVOL: {signals['rvol']:.1f}x) for {data.get('symbol', 'UNKNOWN')}")
            
            # 🆕 保存日志
            try:
                from src.server.state import global_state
                if hasattr(global_state, 'saver') and hasattr(global_state, 'current_cycle_id'):
                    global_state.saver.save_trigger_analysis(
                        analysis=analysis,
                        input_data=data,
                        symbol=data.get('symbol', 'UNKNOWN'),
                        cycle_id=global_state.current_cycle_id,
                        model=self.client.model if hasattr(self.client, 'model') else 'deepseek-chat'
                    )
            except Exception as e:
                log.warning(f"Failed to save trigger analysis log: {e}")
            
            return result
            
        except Exception as e:
            log.error(f"❌ Trigger Agent error: {e}")
            fallback = self._get_fallback_analysis(data)
            return {
                'analysis': fallback,
                'stance': 'ERROR',
                'metadata': {'error': str(e)}
            }
    
    def get_system_prompt(self) -> Optional[str]:
        """System prompt for trigger analysis"""
        return """You are a professional crypto trigger analyst. Your task is to analyze 5m timeframe data and assess entry triggers using candlestick patterns and volume.

Output format: 2-3 sentences covering:
1. Pattern detection status (engulfing, volume breakout, or none)
2. Volume analysis (RVOL status)
3. Trigger confirmation (confirmed or waiting)
4. Specific action recommendation

Be concise, professional, and objective. Use trading terminology.
Do NOT use markdown formatting. Output plain text only."""

    def _build_prompt(self, data: Dict) -> str:
        """Build analysis prompt from data"""
        symbol = data.get('symbol', 'UNKNOWN')
        pattern = data.get('pattern') or data.get('trigger_pattern')
        pattern_type = data.get('pattern_type', '')
        rvol = data.get('rvol') or data.get('trigger_rvol', 1.0)
        volume_breakout = data.get('volume_breakout', False)
        trend = data.get('trend_direction', 'neutral')
        
        # Pattern status
        if pattern and pattern != 'None':
            pattern_status = f"DETECTED: {pattern_type or pattern}"
        else:
            pattern_status = "NO PATTERN DETECTED"
        
        # RVOL status
        if rvol > 1.8:  # OPTIMIZATION (Phase 2): Lowered from 2.0
            rvol_status = f"VERY HIGH VOLUME ({rvol:.1f}x average)"
        elif rvol > 1.2:  # OPTIMIZATION (Phase 2): Lowered from 1.5
            rvol_status = f"HIGH VOLUME ({rvol:.1f}x average)"
        elif rvol >= 1.0:
            rvol_status = f"NORMAL VOLUME ({rvol:.1f}x average)"
        else:
            rvol_status = f"LOW VOLUME ({rvol:.1f}x average)"
        
        # Volume breakout
        breakout_status = "YES - Price broke recent highs/lows with volume" if volume_breakout else "NO"
        
        return f"""Analyze the following 5m trigger data for {symbol}:

Trend Direction (from Layer 1): {trend.upper()}

Candlestick Pattern:
- Pattern: {pattern_status}
- For LONG: Looking for bullish engulfing (阳包阴)
- For SHORT: Looking for bearish engulfing (阴包阳)

Volume Analysis:
- RVOL: {rvol:.1f}x
- Status: {rvol_status}
- Volume Breakout: {breakout_status}

Trigger Requirement:
- Need engulfing pattern OR volume breakout (RVOL > 1.5x + price breakout)

Provide a 2-3 sentence semantic analysis of the trigger situation."""

    def _get_fallback_analysis(self, data: Dict) -> str:
        """Fallback analysis when LLM fails"""
        pattern = data.get('pattern') or data.get('trigger_pattern')
        rvol = data.get('rvol') or data.get('trigger_rvol', 1.0)
        trend = data.get('trend_direction', 'neutral')
        
        if pattern and pattern != 'None':
            return f"5m trigger CONFIRMED: {pattern} pattern detected with RVOL={rvol:.1f}x. Entry signal is valid for {trend} position."
        elif rvol > 1.5:
            return f"5m shows high volume activity (RVOL={rvol:.1f}x) but no clear pattern. Monitor for pattern formation."
        else:
            return f"5m shows no trigger pattern. RVOL={rvol:.1f}x is normal. Wait for engulfing pattern or volume breakout before entry."
