from typing import Dict, List, Optional
from datetime import datetime
import json

from src.config import Config
from src.llm import create_client, LLMConfig
from src.utils.logger import log

from .reflection_agent import ReflectionAgent
from .reflection_result import ReflectionResult

class ReflectionAgentLLM(ReflectionAgent):
    """
    🧠 The Philosopher - Trading Retrospection Agent
    
    Analyzes completed trades every 10 trades and provides insights
    to improve future trading decisions.
    """
    
    REFLECTION_TRIGGER_COUNT = 10  # Trigger reflection every N trades
    
    def __init__(
        self,
        config: Config
    ):
        """Initialize ReflectionAgentLLM with LLM client"""
        # Get LLM config (same as StrategyEngine)
        llm_config = config.llm
        provider = llm_config.get('provider', 'deepseek')
        
        # Get API key for the provider
        api_keys = llm_config.get('api_keys', {})
        api_key = api_keys.get(provider)
        
        # Backward compatibility: use old deepseek config if needed
        if not api_key and provider == 'deepseek':
            api_key = config.deepseek.get('api_key')
        
        if not api_key:
            log.warning(f"🧠 ReflectionAgentLLM: No API key for {provider}, using fallback")
            api_key = "dummy-key-will-fail"
        
        # Create LLM client
        llm_cfg = LLMConfig(
            api_key=api_key,
            base_url=llm_config.get('base_url'),
            model=llm_config.get('model') or (config.deepseek.get('model', 'deepseek-chat') if provider == 'deepseek' else None),
            timeout=llm_config.get('timeout', 120),
            max_retries=2,
            temperature=0.7,  # Slightly creative for insights
            max_tokens=1500
        )
        self.llm_client = create_client(provider, llm_cfg)
        self.provider = provider
        
        # State tracking
        self.reflection_count = 0
        self.trades_since_last_reflection = 0
        self.last_reflected_trade_count = 0
        self.last_reflection: Optional[ReflectionResult] = None
        
        log.info(f"🧠 Reflection Agent LLM (The Philosopher) initialized (Provider: {provider})")
    
    def should_reflect(self, total_trades: int) -> bool:
        """
        Check if we should trigger a reflection.
        
        Args:
            total_trades: Total number of completed trades
            
        Returns:
            True if we should generate a new reflection
        """
        trades_since = total_trades - self.last_reflected_trade_count
        return trades_since >= self.REFLECTION_TRIGGER_COUNT
    
    async def generate_reflection(self, trades: List[Dict]) -> Optional[ReflectionResult]:
        """
        Generate trading reflection using LLM.
        
        Args:
            trades: List of recent trade dictionaries
            
        Returns:
            ReflectionResult with analysis and recommendations
        """
        if not trades or len(trades) < 3:
            log.warning("🧠 Not enough trades for reflection (minimum 3)")
            return None
        
        try:
            # Build prompts
            system_prompt = self.get_system_prompt()
            user_prompt = self.get_user_prompt(trades)
            
            log.info(f"🧠 Generating reflection for {len(trades)} trades...")
            
            # Call LLM
            response = await self.llm_client.chat(
                system_prompt=system_prompt,
                user_prompt=user_prompt
            )
            
            # Parse response
            result = self._parse_response(response, len(trades))
            
            if result:
                self.reflection_count += 1
                self.last_reflected_trade_count += len(trades)
                self.last_reflection = result

                log.info(f"🧠 Reflection LLM #{self.reflection_count} generated successfully")
                log.info(f"   Summary: {result.summary[:100]}...")
                
                # 🆕 保存反思日志
                try:
                    from src.server.state import global_state
                    if hasattr(global_state, 'saver'):
                        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                        global_state.saver.save_reflection(
                            reflection=json.dumps(result.raw_response, ensure_ascii=False, indent=2) if result.raw_response else result.summary,
                            trades_analyzed=len(trades),
                            timestamp=timestamp
                        )
                except Exception as e:
                    log.warning(f"Failed to save reflection log: {e}")
            
            return result
            
        except Exception as e:
            log.error(f"🧠 Reflection LLM generation failed: {e}")
            return None
    
    def get_latest_reflection(self) -> Optional[str]:
        """
        Get the most recent reflection as formatted text for Decision Agent.
        
        Returns:
            Formatted reflection text or None if no reflection available
        """
        if self.last_reflection:
            return self.last_reflection.to_prompt_text()
        return None
    
    def get_user_prompt(self) -> str:
        """Build system prompt for reflection LLM call"""
        return """You are a professional trading retrospection analyst specializing in cryptocurrency futures.
Analyze the provided trade history and generate actionable insights to improve future trading decisions.

Your analysis should focus on:
1. **Winning Patterns**: What market conditions, signals, or timing led to profitable trades?
2. **Losing Patterns**: What conditions or mistakes led to losses?
3. **Confidence Calibration**: Are decisions too aggressive or too conservative based on outcomes?
4. **Market Timing**: Observations about entry/exit timing
5. **Specific Recommendations**: Concrete, actionable improvements

Output your analysis as a valid JSON object with this structure:
{
  "summary": "Brief 1-2 sentence summary of overall trading performance",
  "patterns": {
    "winning_conditions": ["condition 1", "condition 2", "condition 3"],
    "losing_conditions": ["condition 1", "condition 2", "condition 3"]
  },
  "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"],
  "confidence_calibration": "Assessment of whether confidence scoring needs adjustment",
  "market_insights": "Key observations about current market behavior"
}

Be specific, data-driven, and focus on patterns that can be acted upon."""
    
    def get_user_prompt(self, trades: List[Dict]) -> str:
        """Build user prompt with trade history"""
        # Build trade table
        table_rows = []
        total_pnl = 0.0
        wins = 0
        losses = 0
        win_pnls = []
        loss_pnls = []
        
        for i, trade in enumerate(trades, 1):
            # Extract trade data (handle various formats)
            symbol = trade.get('symbol', 'UNKNOWN')
            action = trade.get('action', trade.get('side', 'UNKNOWN'))
            entry_price = trade.get('entry_price', 0)
            exit_price = trade.get('exit_price', trade.get('close_price', 0))
            pnl = trade.get('pnl', trade.get('realized_pnl', 0))
            pnl_pct = trade.get('pnl_pct', 0)
            timestamp = trade.get('timestamp', trade.get('time', ''))
            
            # Calculate stats
            total_pnl += pnl_pct if pnl_pct else 0
            if pnl_pct and pnl_pct > 0:
                wins += 1
                win_pnls.append(pnl_pct)
            elif pnl_pct and pnl_pct < 0:
                losses += 1
                loss_pnls.append(abs(pnl_pct))
            
            # Format row
            pnl_str = f"+{pnl_pct:.2f}%" if pnl_pct and pnl_pct > 0 else f"{pnl_pct:.2f}%" if pnl_pct else "N/A"
            table_rows.append(f"| {i} | {timestamp} | {symbol} | {action} | {entry_price:.2f} | {exit_price:.2f} | {pnl_str} |")
        
        # Calculate summary stats
        total_trades = wins + losses
        win_rate = (wins / total_trades * 100) if total_trades > 0 else 0
        avg_win = sum(win_pnls) / len(win_pnls) if win_pnls else 0
        avg_loss = sum(loss_pnls) / len(loss_pnls) if loss_pnls else 0
        
        prompt = f"""## Recent Trade History (Last {len(trades)} Trades)

| # | Time | Symbol | Action | Entry | Exit | PnL% |
|---|------|--------|--------|-------|------|------|
{chr(10).join(table_rows)}

## Summary Statistics
- **Total Trades**: {total_trades}
- **Win Rate**: {win_rate:.1f}% ({wins} wins, {losses} losses)
- **Average Win**: +{avg_win:.2f}%
- **Average Loss**: -{avg_loss:.2f}%
- **Total PnL**: {'+' if total_pnl >= 0 else ''}{total_pnl:.2f}%
- **Profit Factor**: {(avg_win * wins) / (avg_loss * losses) if losses > 0 and avg_loss > 0 else 'N/A'}

Please analyze these trades and provide your reflection in JSON format."""

        return prompt
    
    def _parse_response(self, response: str, trades_count: int) -> Optional[ReflectionResult]:
        """Parse LLM response into ReflectionResult"""
        try:
            # Try to extract JSON from response
            response = response.strip()
            
            # Handle markdown code blocks
            if "```json" in response:
                response = response.split("```json")[1].split("```")[0].strip()
            elif "```" in response:
                response = response.split("```")[1].split("```")[0].strip()
            
            data = json.loads(response)
            
            return ReflectionResult(
                reflection_id=f"ref_{self.reflection_count + 1:03d}",
                trades_analyzed=trades_count,
                timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                summary=data.get('summary', 'No summary available'),
                patterns=data.get('patterns', {'winning_conditions': [], 'losing_conditions': []}),
                recommendations=data.get('recommendations', []),
                confidence_calibration=data.get('confidence_calibration', 'No calibration advice'),
                market_insights=data.get('market_insights', 'No insights available'),
                raw_response=data
            )
            
        except json.JSONDecodeError as e:
            log.warning(f"🧠 Failed to parse reflection JSON: {e}")
            # Return a basic result with raw text
            return ReflectionResult(
                reflection_id=f"ref_{self.reflection_count + 1:03d}",
                trades_analyzed=trades_count,
                timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                summary=response[:200] if response else "Parse error",
                patterns={'winning_conditions': [], 'losing_conditions': []},
                recommendations=[],
                confidence_calibration="Unable to parse",
                market_insights=response if response else ""
            )
        except Exception as e:
            log.error(f"🧠 Reflection parsing error: {e}")
            return None
