from typing import Dict, List, Optional
from datetime import datetime
import json

from src.utils.logger import log

from .reflection_agent import ReflectionAgent
from .reflection_result import ReflectionResult

class ReflectionAgentNoLLM(ReflectionAgent):
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
