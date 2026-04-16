"""
Trend Agent - 1h Trend Analysis

Analyzes 1h timeframe data and produces semantic analysis:
- EMA20/60 trend direction
- OI fuel status
- ADX trend strength
- Market regime
"""

from typing import Dict, Optional
from src.config import Config
from src.utils.logger import log
from src.llm import create_client, LLMConfig

from .trend_agent import TrendAgent


class TrendAgentLLM(TrendAgent):
    """
    1h Trend Analysis Agent
    
    Input: EMA, OI, ADX, Regime data
    Output: Semantic analysis paragraph
    """
    
    def __init__(
        self,
        config: Config
    ):
        """Initialize TrendAgent with LLM client"""
        llm_config = config.llm
        provider = llm_config.get('provider', 'deepseek')
        
        # Get API key for the provider
        api_keys = llm_config.get('api_keys', {})
        api_key = api_keys.get(provider)
        
        # Backward compatibility: use old deepseek config if needed
        if not api_key and provider == 'deepseek':
            api_key = config.deepseek.get('api_key')
        
        if not api_key:
            log.warning(f"📈 TrendAgentLLM: No API key for {provider}, using fallback")
            api_key = "dummy-key-will-fail"
        
        self.client = create_client(provider, LLMConfig(
            api_key=api_key,
            base_url=llm_config.get('base_url'),
            model=llm_config.get('model') or (config.deepseek.get('model', 'deepseek-chat') if provider == 'deepseek' else None),
            temperature=0.3,
            max_tokens=300
        ))
        
        log.info("📈 Trend Agent LLM initialized")
    
    def analyze(self, data: Dict) -> Dict:
        """
        Analyze 1h trend data and return semantic analysis with stance
        
        Args:
            data: {
                'symbol': 'BTCUSDT',
                'close_1h': 95000.0,
                'ema20_1h': 94500.0,
                'ema60_1h': 94000.0,
                'oi_change': 2.5,
                'adx': 25,
                'regime': 'trending_up'
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
            
            signals = self._compute_trend_signals(data)

            result = {
                'analysis': analysis,
                'stance': signals['stance'],
                'metadata': {
                    'strength': signals['strength'],
                    'adx': round(signals['adx'], 1),
                    'oi_fuel': signals['fuel'],
                    'oi_change': round(signals['oi_change'], 1)
                }
            }
            
            log.info(f"📈 Trend Agent LLM [{signals['stance']}] (Strength: {signals['strength']}, ADX: {signals['adx']:.1f}) for {data.get('symbol', 'UNKNOWN')}")
            
            # 🆕 保存日志
            try:
                from src.server.state import global_state
                if hasattr(global_state, 'saver') and hasattr(global_state, 'current_cycle_id'):
                    global_state.saver.save_trend_analysis(
                        analysis=analysis,
                        input_data=data,
                        symbol=data.get('symbol', 'UNKNOWN'),
                        cycle_id=global_state.current_cycle_id,
                        model=self.client.model if hasattr(self.client, 'model') else 'deepseek-chat'
                    )
            except Exception as e:
                log.warning(f"Failed to save trend analysis log: {e}")
            
            return result
            
        except Exception as e:
            log.error(f"❌ Trend Agent error: {e}")
            fallback = self._get_fallback_analysis(data)
            return {
                'analysis': fallback,
                'stance': 'ERROR',
                'metadata': {'error': str(e)}
            }
    
    def get_system_prompt(self) -> Optional[str]:
        """System prompt for trend analysis"""
        return """You are a professional crypto trend analyst. Your task is to analyze 1h timeframe data and provide a concise semantic analysis.

Output format: 2-3 sentences covering:
1. Trend direction (uptrend/downtrend/neutral) based on EMA alignment
2. Fuel status based on OI change
3. Trend strength based on ADX
4. Trading recommendation (suitable for trend trading or not)

Be concise, professional, and objective. Use trading terminology.
Do NOT use markdown formatting. Output plain text only."""

    def _build_prompt(self, data: Dict) -> str:
        """Build analysis prompt from data"""
        symbol = data.get('symbol', 'UNKNOWN')
        close = data.get('close_1h', 0)
        ema20 = data.get('ema20_1h', 0)
        ema60 = data.get('ema60_1h', 0)
        oi_change = data.get('oi_change', 0)
        adx = data.get('adx', 20)
        regime = data.get('regime', 'unknown')
        
        # Determine EMA relationship
        if close > ema20 > ema60:
            ema_status = "UPTREND (Close > EMA20 > EMA60)"
        elif close < ema20 < ema60:
            ema_status = "DOWNTREND (Close < EMA20 < EMA60)"
        else:
            ema_status = "NEUTRAL (EMAs not aligned)"
        
        # Determine fuel status
        if abs(oi_change) > 3:
            fuel_status = "STRONG FUEL"
        elif abs(oi_change) >= 1:
            fuel_status = "MODERATE FUEL"
        else:
            fuel_status = "WEAK FUEL"
        
        # Determine ADX status
        # Determine ADX status
        if adx > 20:  # OPTIMIZATION (Phase 2): Lowered from 25
            adx_status = "STRONG TREND"
        elif adx >= 15:  # OPTIMIZATION (Phase 2): Lowered from 20
            adx_status = "MODERATE TREND"
        else:
            adx_status = "WEAK/NO TREND"
        
        return f"""Analyze the following 1h trend data for {symbol}:

Price & EMA:
- 1h Close: ${close:,.2f}
- 1h EMA20: ${ema20:,.2f}
- 1h EMA60: ${ema60:,.2f}
- EMA Status: {ema_status}

Open Interest:
- OI Change (24h): {oi_change:+.1f}%
- Fuel Status: {fuel_status}

Trend Strength:
- ADX: {adx:.0f}
- ADX Status: {adx_status}

Market Regime: {regime.upper()}

Provide a 2-3 sentence semantic analysis of the trend situation."""

    def _get_fallback_analysis(self, data: Dict) -> str:
        """Fallback analysis when LLM fails"""
        close = data.get('close_1h', 0)
        ema20 = data.get('ema20_1h', 0)
        ema60 = data.get('ema60_1h', 0)
        oi_change = data.get('oi_change', 0)
        adx = data.get('adx', 20)
        
        if close > ema20 > ema60:
            trend = "uptrend"
        elif close < ema20 < ema60:
            trend = "downtrend"
        else:
            trend = "neutral"
        
        fuel = "strong" if abs(oi_change) > 3 else "moderate" if abs(oi_change) >= 1 else "weak"
        strength = "strong" if adx > 25 else "weak"
        
        return f"1h shows {trend} with {fuel} OI fuel ({oi_change:+.1f}%). ADX={adx:.0f} indicates {strength} trend strength. {'Suitable for trend trading.' if adx >= 20 and abs(oi_change) >= 1 else 'Not suitable for trend trading.'}"
