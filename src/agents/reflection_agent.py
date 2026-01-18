"""
Reflection Agent - The Philosopher
===================================

Trading retrospection agent that analyzes every 10 completed trades
and provides actionable insights to improve future decisions.
"""

from typing import Dict, List, Optional
from datetime import datetime
from dataclasses import dataclass
import json

from src.llm import create_client, LLMConfig
from src.config import config
from src.utils.logger import log


@dataclass
class ReflectionResult:
    """Result from trading reflection analysis"""
    reflection_id: str
    trades_analyzed: int
    timestamp: str
    summary: str
    patterns: Dict[str, List[str]]
    recommendations: List[str]
    confidence_calibration: str
    market_insights: str
    raw_response: Dict = None
    
    def to_prompt_text(self) -> str:
        """Format reflection for inclusion in Decision Agent prompt"""
        lines = [
            f"**Summary**: {self.summary}",
            "",
            "**Winning Patterns**:",
        ]
        for pattern in self.patterns.get('winning_conditions', [])[:3]:
            lines.append(f"  - {pattern}")
        
        lines.append("")
        lines.append("**Losing Patterns**:")
        for pattern in self.patterns.get('losing_conditions', [])[:3]:
            lines.append(f"  - {pattern}")
        
        lines.append("")
        lines.append("**Recommendations**:")
        for rec in self.recommendations[:3]:
            lines.append(f"  - {rec}")
        
        lines.append("")
        lines.append(f"**Confidence Calibration**: {self.confidence_calibration}")
        
        return "\n".join(lines)


class ReflectionAgentLLM:
    """
    🧠 The Philosopher - Trading Retrospection Agent
    
    Analyzes completed trades every 10 trades and provides insights
    to improve future trading decisions.
    """
    
    REFLECTION_TRIGGER_COUNT = 10  # Trigger reflection every N trades
    
    def __init__(self):
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
            model=llm_config.get('model') or config.deepseek.get('model', 'deepseek-chat'),
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
            system_prompt = self._build_system_prompt()
            user_prompt = self._build_user_prompt(trades)
            
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
    
    def _build_system_prompt(self) -> str:
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
    
    def _build_user_prompt(self, trades: List[Dict]) -> str:
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


class ReflectionAgent:
    """
    🧠 The Philosopher - Trading Retrospection Agent (no LLM)

    Generates rule-based reflections every N trades.
    """

    REFLECTION_TRIGGER_COUNT = 10

    def __init__(self):
        self.reflection_count = 0
        self.trades_since_last_reflection = 0
        self.last_reflected_trade_count = 0
        self.last_reflection: Optional[ReflectionResult] = None
        log.info("🧠 Reflection Agent (no LLM) initialized")

    def should_reflect(self, total_trades: int) -> bool:
        trades_since = total_trades - self.last_reflected_trade_count
        return trades_since >= self.REFLECTION_TRIGGER_COUNT

    async def generate_reflection(self, trades: List[Dict]) -> Optional[ReflectionResult]:
        if not trades or len(trades) < 3:
            log.warning("🧠 Not enough trades for reflection (minimum 3)")
            return None

        pnls = []
        win_pnls = []
        loss_pnls = []
        wins = 0
        losses = 0
        action_stats: Dict[str, List[float]] = {}
        conf_wins = []
        conf_losses = []

        def _to_float(value) -> Optional[float]:
            try:
                if value is None:
                    return None
                return float(value)
            except (TypeError, ValueError):
                return None

        def _extract_pnl(trade: Dict) -> float:
            for key in ('pnl_pct', 'pnl', 'realized_pnl', 'profit', 'profit_pct'):
                val = _to_float(trade.get(key))
                if val is not None:
                    return val
            return 0.0

        def _extract_confidence(trade: Dict) -> Optional[float]:
            for key in ('confidence', 'conf', 'confidence_score', 'score'):
                val = _to_float(trade.get(key))
                if val is not None:
                    return val
            return None

        for trade in trades:
            pnl = _extract_pnl(trade)
            pnls.append(pnl)
            if pnl > 0:
                wins += 1
                win_pnls.append(pnl)
            elif pnl < 0:
                losses += 1
                loss_pnls.append(abs(pnl))

            action = (trade.get('action') or trade.get('side') or 'UNKNOWN').upper()
            action_stats.setdefault(action, []).append(pnl)

            confidence = _extract_confidence(trade)
            if confidence is not None:
                if pnl > 0:
                    conf_wins.append(confidence)
                elif pnl < 0:
                    conf_losses.append(confidence)

        total_trades = wins + losses if wins + losses > 0 else len(trades)
        win_rate = (wins / total_trades * 100) if total_trades > 0 else 0
        avg_win = sum(win_pnls) / len(win_pnls) if win_pnls else 0
        avg_loss = sum(loss_pnls) / len(loss_pnls) if loss_pnls else 0
        total_pnl = sum(pnls) if pnls else 0

        avg_conf_win = sum(conf_wins) / len(conf_wins) if conf_wins else None
        avg_conf_loss = sum(conf_losses) / len(conf_losses) if conf_losses else None
        if avg_conf_win is not None and avg_conf_loss is not None:
            confidence_calibration = (
                "Confidence aligns with outcomes."
                if avg_conf_win >= avg_conf_loss
                else "Confidence mis-calibrated: losing trades carry higher confidence."
            )
        else:
            confidence_calibration = "Confidence calibration unavailable."

        winning_conditions = []
        losing_conditions = []

        if win_rate >= 55:
            winning_conditions.append("Win rate above 55% suggests current filters are effective.")
        if avg_win > avg_loss and avg_win > 0:
            winning_conditions.append("Average win exceeds average loss, risk-reward is healthy.")

        if win_rate <= 45:
            losing_conditions.append("Win rate below 45% indicates edge is weak.")
        if avg_loss > avg_win:
            losing_conditions.append("Average loss exceeds average win, risk-reward needs tightening.")
        if total_pnl < 0:
            losing_conditions.append("Recent trades are net negative on PnL.")

        best_action = None
        best_action_avg = None
        for action, pnl_list in action_stats.items():
            if len(pnl_list) < 2:
                continue
            avg_action = sum(pnl_list) / len(pnl_list)
            if best_action_avg is None or avg_action > best_action_avg:
                best_action_avg = avg_action
                best_action = action
        if best_action and best_action_avg is not None and best_action_avg > 0:
            winning_conditions.append(f"{best_action} trades show stronger average PnL.")

        recommendations = []
        if win_rate < 50:
            recommendations.append("Tighten entry filters and reduce low-confidence trades.")
        if avg_loss > avg_win:
            recommendations.append("Improve risk-reward: trim size or wait for cleaner setups.")
        if avg_conf_win is not None and avg_conf_loss is not None and avg_conf_win < avg_conf_loss:
            recommendations.append("Recalibrate confidence scoring; avoid high-confidence overrides.")
        if best_action and best_action_avg is not None and best_action_avg > 0:
            recommendations.append(f"Favor {best_action} setups until regime shifts.")
        if not recommendations:
            recommendations.append("Maintain discipline; prioritize high-conviction, trend-aligned setups.")

        summary = (
            f"{total_trades} trades: win rate {win_rate:.1f}%, "
            f"avg win {avg_win:.2f}, avg loss {avg_loss:.2f}, total PnL {total_pnl:.2f}."
        )

        market_insights = (
            "Recent sample suggests reinforcing trend-aligned entries and avoiding noisy signals."
            if total_trades >= 3
            else "Sample size is limited; maintain conservative risk."
        )

        raw_response = {
            "summary": summary,
            "patterns": {
                "winning_conditions": winning_conditions,
                "losing_conditions": losing_conditions
            },
            "recommendations": recommendations,
            "confidence_calibration": confidence_calibration,
            "market_insights": market_insights
        }

        result = ReflectionResult(
            reflection_id=f"ref_{self.reflection_count + 1:03d}",
            trades_analyzed=len(trades),
            timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            summary=summary,
            patterns={
                'winning_conditions': winning_conditions,
                'losing_conditions': losing_conditions
            },
            recommendations=recommendations,
            confidence_calibration=confidence_calibration,
            market_insights=market_insights,
            raw_response=raw_response
        )

        self.reflection_count += 1
        self.last_reflected_trade_count += len(trades)
        self.last_reflection = result

        log.info(f"🧠 Reflection (no LLM) #{self.reflection_count} generated successfully")

        try:
            from src.server.state import global_state
            if hasattr(global_state, 'saver'):
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                global_state.saver.save_reflection(
                    reflection=json.dumps(raw_response, ensure_ascii=False, indent=2),
                    trades_analyzed=len(trades),
                    timestamp=timestamp
                )
        except Exception as e:
            log.warning(f"Failed to save reflection log: {e}")

        return result

    def get_latest_reflection(self) -> Optional[str]:
        if self.last_reflection:
            return self.last_reflection.to_prompt_text()
        return None
