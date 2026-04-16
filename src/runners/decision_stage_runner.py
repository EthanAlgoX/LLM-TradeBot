import asyncio
from datetime import datetime
from typing import Dict, Optional, Any, Tuple

from dataclasses import asdict

from src.config import Config
from src.strategy.llm_engine import StrategyEngine
from src.agents.agent_config import AgentConfig
from src.agents.decision_core.decision_core_agent import VoteResult
from src.agents.agent_provider import AgentProvider
from src.utils.semantic_converter import SemanticConverter  # ✅ Global Import

from src.agents.runtime_events import emit_global_runtime_event
from src.utils.task_util import run_task_with_timeout
from src.utils.agents_util import get_agent_timeout

from src.trading import CycleContext
from src.agents.predict import PredictResult  # ✅ PredictResult Import
from src.utils.logger import log
from src.server.state import global_state
from .runner_decorators import log_run

from src.utils.action_protocol import (
    normalize_action
)

class DecisionStageRunner:
    def __init__(
        self,
        config: Config,
        agent_config: AgentConfig,
        strategy_engine: StrategyEngine,
        agent_provider: AgentProvider,
        max_position_size: float = 100.0,
    ):
        self.config = config
        self.agent_config = agent_config
        self.max_position_size = max_position_size
        self.agent_provider = agent_provider
        self.strategy_engine = strategy_engine
    
    @log_run
    async def run(
        self,
        context: CycleContext,
        headless_mode: bool
    ) -> Tuple[Dict[str, Any], str, Optional[Dict[str, Any]], Any, Dict[str, Any]]:
        """
        Build final decision payload (forced-exit/fast/LLM/rule) and convert to VoteResult.
        """
        emit_global_runtime_event(
            context,
            stream="lifecycle",
            agent="decision_router",
            phase="start"
        )

        selected_agent_outputs = self._collect_selected_agent_outputs(
            predict_result=context.predict_result,
            reflection_text=context.reflection_text
        )
        if isinstance(context.quant_analysis, dict):
            context.quant_analysis['agent_outputs'] = selected_agent_outputs

        market_data = {
            'df_5m': context.processed_dfs['5m'],
            'df_15m': context.processed_dfs['15m'],
            'df_1h': context.processed_dfs['1h'],
            'current_price': context.current_price
        }
        regime_info = context.quant_analysis.get('regime', {})

        fast_signal = None
        decision_source = 'llm'
        forced_exit = self._check_forced_exit(context.symbol, context.current_position_info)
        llm_enabled = self._is_llm_enabled()
        if llm_enabled and getattr(self.strategy_engine, 'disable_llm', False):
            llm_enabled = bool(self.strategy_engine.reload_config())

        if forced_exit:
            decision_source = 'forced_exit'
            decision_payload = forced_exit
            global_state.add_log(f"[🧯 FORCED EXIT] {forced_exit.get('reasoning', 'Forced close')}")
            try:
                conf_val = float(decision_payload.get('confidence', 0) or 0)
            except (TypeError, ValueError):
                conf_val = 0.0
            global_state.add_agent_message(
                "decision_core",
                f"Action: {decision_payload.get('action', '').upper()} | Conf: {conf_val:.1f}% | Reason: {decision_payload.get('reasoning', '')} | Source: FORCED",
                level="warning"
            )
        else:
            fast_signal = self._detect_fast_trend_signal(context.processed_dfs.get('5m'))

        if fast_signal:
            decision_source = 'fast_trend'
            change_pct = fast_signal['change_pct']
            volume_ratio = fast_signal['volume_ratio']
            fast_action = fast_signal['action']
            fast_confidence = fast_signal['confidence']
            fast_reason = f"30m trend {change_pct:+.2f}% | RVOL {volume_ratio:.2f}x"

            if not headless_mode:
                print("[Step 3/5] ⚡ Fast Trend Trigger - Immediate entry signal")

            global_state.add_log(f"[⚡ FAST] {fast_action.upper()} | {fast_reason}")

            if fast_action == 'open_long':
                bull_conf = fast_confidence
                bear_conf = max(0.0, 100.0 - fast_confidence)
                bull_stance = 'FAST_UP'
                bear_stance = 'HEDGE'
                bull_reason = fast_reason
                bear_reason = 'Short bias weak vs momentum'
            else:
                bull_conf = max(0.0, 100.0 - fast_confidence)
                bear_conf = fast_confidence
                bull_stance = 'HEDGE'
                bear_stance = 'FAST_DN'
                bull_reason = 'Long bias weak vs momentum'
                bear_reason = fast_reason

            decision_payload = {
                'action': fast_action,
                'confidence': fast_confidence,
                'position_size_pct': min(100.0, max(10.0, fast_confidence)),
                'reasoning': fast_reason,
                'bull_perspective': {
                    'bull_confidence': bull_conf,
                    'stance': bull_stance,
                    'bullish_reasons': bull_reason
                },
                'bear_perspective': {
                    'bear_confidence': bear_conf,
                    'stance': bear_stance,
                    'bearish_reasons': bear_reason
                }
            }
            try:
                conf_val = float(decision_payload.get('confidence', 0) or 0)
            except (TypeError, ValueError):
                conf_val = 0.0
            global_state.add_agent_message(
                "decision_core",
                f"Action: {decision_payload.get('action').upper()} | Conf: {conf_val:.1f}% | Reason: {decision_payload.get('reasoning')[:100]}... | Source: FAST",
                level="info"
            )
        elif not forced_exit:
            if llm_enabled:
                if not headless_mode:
                    print("[Step 3/5] 🧠 DeepSeek LLM - Making decision...")

                global_state.add_agent_message("decision_core", "🧠 DeepSeek LLM is weighing options...", level="info")

                market_context_text = self._build_market_context(
                    symbol=context.symbol,
                    quant_analysis=context.quant_analysis,
                    predict_result=context.predict_result,
                    market_data=market_data,
                    regime_info=regime_info,
                    position_info=context.current_position_info,
                    selected_agent_outputs=selected_agent_outputs
                )

                market_context_data = {
                    'symbol': context.symbol,
                    'timestamp': datetime.now().isoformat(),
                    'current_price': context.current_price,
                    'position_side': (context.current_position_info or {}).get('side')
                }

                log.info("🐂🐻 Gathering Bull/Bear perspectives in PARALLEL...")
                llm_perspective_timeout = get_agent_timeout(self.config, self.agent_config, 'llm_perspective', 45.0)
                loop = asyncio.get_running_loop()
                bull_p, bear_p = await asyncio.gather(
                    run_task_with_timeout(
                        context,
                        agent_name="bull_agent",
                        timeout_seconds=llm_perspective_timeout,
                        task_factory=lambda: loop.run_in_executor(
                            None, self.strategy_engine.get_bull_perspective, market_context_text
                        ),
                        fallback={
                            "stance": "NEUTRAL",
                            "bullish_reasons": "Perspective timeout",
                            "bull_confidence": 50
                        }
                    ),
                    run_task_with_timeout(
                        context,
                        agent_name="bear_agent",
                        timeout_seconds=llm_perspective_timeout,
                        task_factory=lambda: loop.run_in_executor(
                            None, self.strategy_engine.get_bear_perspective, market_context_text
                        ),
                        fallback={
                            "stance": "NEUTRAL",
                            "bearish_reasons": "Perspective timeout",
                            "bear_confidence": 50
                        }
                    )
                )

                bull_summary = bull_p.get('bullish_reasons', 'No reasons provided')
                bear_summary = bear_p.get('bearish_reasons', 'No reasons provided')
                global_state.add_agent_message("bull_agent", f"Stance: {bull_p.get('stance')} | Reason: {bull_summary}", level="success")
                global_state.add_agent_message("bear_agent", f"Stance: {bear_p.get('stance')} | Reason: {bear_summary}", level="warning")

                decision_payload = self.strategy_engine.make_decision(
                    market_context_text=market_context_text,
                    market_context_data=market_context_data,
                    reflection=context.reflection_text,
                    bull_perspective=bull_p,
                    bear_perspective=bear_p
                )

                try:
                    conf_val = float(decision_payload.get('confidence', 0) or 0)
                except (TypeError, ValueError):
                    conf_val = 0.0
                global_state.add_agent_message(
                    "decision_core",
                    f"Action: {decision_payload.get('action').upper()} | Conf: {conf_val:.1f}% | Reason: {decision_payload.get('reasoning')}",
                    level="info"
                )
            else:
                if not headless_mode:
                    print("[Step 3/5] ⚖️ DecisionCore - Rule-based decision...")

                global_state.add_agent_message("decision_core", "⚖️ Running rule-based decision logic...", level="info")
                decision_source = 'decision_core'
                vote_core = await self.agent_provider.decision_core.make_decision(
                    quant_analysis=context.quant_analysis,
                    predict_result=context.predict_result,
                    market_data=market_data
                )
                four_layer = getattr(global_state, 'four_layer_result', {}) or {}
                final_action = str(four_layer.get('final_action', 'wait') or 'wait').lower()
                layers_passed = bool(
                    four_layer.get('layer1_pass')
                    and four_layer.get('layer2_pass')
                    and four_layer.get('layer3_pass')
                    and four_layer.get('layer4_pass')
                )
                has_position = False
                if context.current_position_info:
                    try:
                        has_position = abs(float(context.current_position_info.get('quantity', 0) or 0)) > 0
                    except (TypeError, ValueError):
                        has_position = True

                if (
                    not has_position
                    and vote_core.action in ('wait', 'hold')
                    and layers_passed
                    and final_action in ('long', 'short')
                ):
                    override_action = 'open_long' if final_action == 'long' else 'open_short'
                    try:
                        boost = float(four_layer.get('confidence_boost', 0) or 0)
                    except (TypeError, ValueError):
                        boost = 0.0
                    override_conf = min(85.0, max(60.0, 60.0 + max(0.0, boost)))
                    vote_core.action = override_action
                    vote_core.confidence = max(float(vote_core.confidence or 0), override_conf)
                    base_reason = str(vote_core.reason or "DecisionCore wait")
                    vote_core.reason = f"{base_reason} | 4-Layer override: {override_action} (layers all pass)"
                    if not isinstance(vote_core.vote_details, dict):
                        vote_core.vote_details = {}
                    vote_core.vote_details['four_layer_override'] = 1.0 if final_action == 'long' else -1.0
                    log.info(
                        f"⚡ Decision override applied: {override_action} "
                        f"(confidence {vote_core.confidence:.1f}%, trigger={four_layer.get('trigger_pattern', 'unknown')})"
                    )

                size_pct = 0.0
                if vote_core.trade_params and self.max_position_size:
                    size_pct = min(
                        100.0,
                        max(5.0, (vote_core.trade_params.get('position_size', 0) / self.max_position_size) * 100)
                    )
                decision_payload = {
                    'action': vote_core.action,
                    'confidence': vote_core.confidence,
                    'position_size_pct': size_pct,
                    'reasoning': vote_core.reason,
                    'bull_perspective': {
                        'bull_confidence': 50,
                        'stance': 'NEUTRAL',
                        'bullish_reasons': 'LLM disabled'
                    },
                    'bear_perspective': {
                        'bear_confidence': 50,
                        'stance': 'NEUTRAL',
                        'bearish_reasons': 'LLM disabled'
                    }
                }
                try:
                    conf_val = float(decision_payload.get('confidence', 0) or 0)
                except (TypeError, ValueError):
                    conf_val = 0.0
                global_state.add_agent_message(
                    "decision_core",
                    f"Action: {decision_payload.get('action').upper()} | Conf: {conf_val:.1f}% | Reason: {decision_payload.get('reasoning')} | Source: RULE",
                    level="info"
                )

        if 'bull_perspective' not in decision_payload:
            decision_payload['bull_perspective'] = {
                'bull_confidence': 50,
                'stance': 'NEUTRAL',
                'bullish_reasons': 'N/A'
            }
        if 'bear_perspective' not in decision_payload:
            decision_payload['bear_perspective'] = {
                'bear_confidence': 50,
                'stance': 'NEUTRAL',
                'bearish_reasons': 'N/A'
            }
        decision_payload['action'] = normalize_action(
            decision_payload.get('action'),
            position_side=(context.current_position_info or {}).get('side')
        )

        q_trend = context.quant_analysis.get('trend', {})
        q_osc = context.quant_analysis.get('oscillator', {})
        q_sent = context.quant_analysis.get('sentiment', {})
        q_comp = context.quant_analysis.get('comprehensive', {})

        vote_details = {
            'deepseek': decision_payload.get('confidence', 0),
            'strategist_total': q_comp.get('score', 0),
            'trend_1h': q_trend.get('trend_1h_score', 0),
            'trend_15m': q_trend.get('trend_15m_score', 0),
            'trend_5m': q_trend.get('trend_5m_score', 0),
            'oscillator_1h': q_osc.get('osc_1h_score', 0),
            'oscillator_15m': q_osc.get('osc_15m_score', 0),
            'oscillator_5m': q_osc.get('osc_5m_score', 0),
            'sentiment': q_sent.get('total_sentiment_score', 0),
            'prophet': context.predict_result.probability_up if context.predict_result else 0.5,
            'bull_confidence': decision_payload.get('bull_perspective', {}).get('bull_confidence', 50),
            'bear_confidence': decision_payload.get('bear_perspective', {}).get('bear_confidence', 50),
            'bull_stance': decision_payload.get('bull_perspective', {}).get('stance', 'UNKNOWN'),
            'bear_stance': decision_payload.get('bear_perspective', {}).get('stance', 'UNKNOWN'),
            'bull_reasons': decision_payload.get('bull_perspective', {}).get('bullish_reasons', ''),
            'bear_reasons': decision_payload.get('bear_perspective', {}).get('bearish_reasons', '')
        }

        if fast_signal:
            vote_details['fast_trend_change_pct'] = fast_signal.get('change_pct')
            vote_details['fast_trend_volume_ratio'] = fast_signal.get('volume_ratio')
            vote_details['fast_trend_window'] = fast_signal.get('window_minutes')

        trend_score_total = context.quant_analysis.get('trend', {}).get('total_trend_score', 0)
        regime_desc = SemanticConverter.get_trend_semantic(trend_score_total)

        pos_pct = decision_payload.get('position_size_pct', 0)
        if not pos_pct and decision_payload.get('position_size_usd') and self.max_position_size:
            pos_pct = (decision_payload.get('position_size_usd') / self.max_position_size) * 100
            pos_pct = min(pos_pct, 100)

        price_position_info = context.regime_result.get('position', {}) if context.regime_result else {}

        vote_result = VoteResult(
            action=decision_payload.get('action', 'wait'),
            confidence=decision_payload.get('confidence', 0),
            weighted_score=decision_payload.get('confidence', 0) - 50,
            vote_details=vote_details,
            multi_period_aligned=True,
            reason=decision_payload.get('reasoning', 'DeepSeek LLM decision'),
            regime={
                'regime': regime_desc,
                'confidence': decision_payload.get('confidence', 0)
            },
            position=price_position_info
        )

        emit_global_runtime_event(
            context,
            stream="lifecycle",
            agent="decision_router",
            phase="end",
            data={
                "action": vote_result.action,
                "confidence": vote_result.confidence,
                "source": decision_source
            }
        )

        return decision_payload, decision_source, fast_signal, vote_result, selected_agent_outputs

    def _check_forced_exit(self, symbol: str, position_info: Optional[Dict]) -> Optional[Dict]:
        """Force exit for stale or losing positions to cap drawdowns."""
        if not position_info:
            return None
        symbol = position_info.get('symbol') or symbol
        side = str(position_info.get('side', '')).lower()
        close_action = 'close_long' if side == 'long' else ('close_short' if side == 'short' else 'wait')
        pnl_pct = position_info.get('pnl_pct')
        if pnl_pct is None:
            return None

        open_trade = self._get_open_trade_meta(symbol)
        hold_cycles = self._get_holding_cycles(open_trade)
        hold_hours = self._get_holding_hours(symbol, open_trade)
        max_hold_cycles = self.config.get('risk.max_holding_cycles')
        max_hold_hours = self.config.get('risk.max_holding_hours')
        if max_hold_cycles is None:
            max_hold_cycles = 180
        if max_hold_hours is None and hold_cycles is not None:
            cycle_interval = max(1, int(getattr(global_state, 'cycle_interval', 3) or 3))
            max_hold_hours = (max_hold_cycles * cycle_interval) / 60.0
        hold_tag = f"{hold_hours:.1f}h" if hold_hours is not None else "n/a"

        if hold_cycles is not None and isinstance(max_hold_cycles, (int, float)):
            if hold_cycles >= int(max_hold_cycles):
                return {
                    'action': close_action,
                    'confidence': 92,
                    'reasoning': f"Forced exit: holding cycles cap {int(max_hold_cycles)} hit ({hold_cycles} cycles, {hold_tag})"
                }
        if hold_hours is not None and isinstance(max_hold_hours, (int, float)):
            if hold_hours >= float(max_hold_hours):
                return {
                    'action': close_action,
                    'confidence': 92,
                    'reasoning': f"Forced exit: holding hours cap {float(max_hold_hours):.1f}h hit ({hold_tag})"
                }

        # Immediate loss cut
        if pnl_pct <= -5:
            return {
                'action': close_action,
                'confidence': 95,
                'reasoning': f"Forced exit: loss {pnl_pct:+.2f}% exceeds -5% cap (hold {hold_tag})"
            }

        # Time-based exit for losing/stale positions
        if hold_hours is not None:
            if hold_hours >= 6 and pnl_pct < -1:
                return {
                    'action': close_action,
                    'confidence': 90,
                    'reasoning': f"Forced exit: loss {pnl_pct:+.2f}% with stale hold {hold_tag}"
                }
            if hold_hours >= 12 and pnl_pct <= 0.3:
                return {
                    'action': close_action,
                    'confidence': 85,
                    'reasoning': f"Forced exit: capital tie-up {hold_tag} with low edge ({pnl_pct:+.2f}%)"
                }
        return None
    
    def _get_open_trade_meta(self, symbol: str) -> Optional[Dict]:
        """Return latest open trade record for symbol, if any."""
        history = global_state.trade_history or []
        for trade in history:
            if trade.get('symbol') != symbol:
                continue
            status = str(trade.get('status', '')).upper()
            close_cycle = trade.get('close_cycle', 0)
            exit_price = trade.get('exit_price', 0)
            is_closed = (
                'CLOSED' in status or
                (isinstance(close_cycle, (int, float)) and close_cycle > 0) or
                (isinstance(exit_price, (int, float)) and exit_price > 0)
            )
            if not is_closed:
                return trade
        return None

    def _get_holding_cycles(self, open_trade: Optional[Dict]) -> Optional[int]:
        """Estimate holding cycles from open trade metadata."""
        if not open_trade:
            return None
        open_cycle = open_trade.get('open_cycle')
        if isinstance(open_cycle, (int, float)):
            return max(0, int(global_state.cycle_counter) - int(open_cycle))
        return None

    def _get_holding_hours(self, symbol: str, open_trade: Optional[Dict]) -> Optional[float]:
        """Estimate holding duration in hours using cycle counter or entry_time."""
        if open_trade:
            hold_cycles = self._get_holding_cycles(open_trade)
            if hold_cycles is not None:
                cycle_interval = max(1, int(getattr(global_state, 'cycle_interval', 3) or 3))
                hold_minutes = hold_cycles * cycle_interval
                return hold_minutes / 60.0
        if self.test_mode:
            v_pos = global_state.virtual_positions.get(symbol)
            entry_time = v_pos.get('entry_time') if isinstance(v_pos, dict) else None
            if entry_time:
                try:
                    started = datetime.fromisoformat(entry_time)
                    return max(0.0, (datetime.now() - started).total_seconds() / 3600.0)
                except Exception:
                    pass
        return None
    
    def _collect_selected_agent_outputs(
        self,
        predict_result: PredictResult = None,
        reflection_text: Optional[str] = None
    ) -> Dict[str, Any]:
        outputs: Dict[str, Any] = {}

        if getattr(self.agent_config, 'symbol_selector_agent', False):
            if getattr(global_state, 'symbol_selector', None):
                outputs['symbol_selector'] = global_state.symbol_selector

        if getattr(self.agent_config, 'predict_agent', False) and predict_result:
            try:
                outputs['predict_agent'] = asdict(predict_result)
            except Exception:
                outputs['predict_agent'] = getattr(predict_result, '__dict__', str(predict_result))

        semantic = getattr(global_state, 'semantic_analyses', {}) or {}

        if self.agent_config.trend_agent_llm or self.agent_config.trend_agent_local:
            if 'trend' in semantic:
                outputs['trend_agent'] = semantic.get('trend')
        if self.agent_config.setup_agent_llm or self.agent_config.setup_agent_local:
            if 'setup' in semantic:
                outputs['setup_agent'] = semantic.get('setup')
        if self.agent_config.trigger_agent_llm or self.agent_config.trigger_agent_local:
            if 'trigger' in semantic:
                outputs['trigger_agent'] = semantic.get('trigger')

        if self.agent_config.reflection_agent_llm or self.agent_config.reflection_agent_local:
            outputs['reflection_agent'] = {
                'count': getattr(global_state, 'reflection_count', 0),
                'text': reflection_text,
                'raw': getattr(global_state, 'last_reflection', None)
            }

        multi_period = getattr(global_state, 'multi_period_result', {}) or {}
        if multi_period:
            outputs['multi_period_agent'] = multi_period

        return outputs

    def _is_llm_enabled(self) -> bool:
        """Return True if LLM-driven agents are enabled by runtime config."""
        return bool(
            self.agent_config.trend_agent_llm
            or self.agent_config.setup_agent_llm
            or self.agent_config.trigger_agent_llm
            or self.agent_config.reflection_agent_llm
        )

    def _detect_fast_trend_signal(
        self,
        df_5m: Optional["pd.DataFrame"],
        window_minutes: int = 30,
        threshold_pct: float = 0.8,
        volume_ratio_threshold: float = 1.2
    ) -> Optional[Dict]:
        """Detect short-term momentum over the last 30m and return a fast entry signal."""
        if df_5m is None or df_5m.empty:
            return None
        if 'close' not in df_5m.columns or 'volume' not in df_5m.columns:
            return None

        window_bars = max(2, int(window_minutes / 5))
        if len(df_5m) < window_bars * 2:
            return None

        recent = df_5m.iloc[-window_bars:]
        previous = df_5m.iloc[-window_bars * 2:-window_bars]
        first_close = float(recent['close'].iloc[0])
        last_close = float(recent['close'].iloc[-1])
        if first_close <= 0:
            return None

        change_pct = ((last_close - first_close) / first_close) * 100.0
        recent_volume = float(recent['volume'].sum())
        prev_volume = float(previous['volume'].sum()) if not previous.empty else 0.0
        volume_ratio = (recent_volume / prev_volume) if prev_volume > 0 else 1.0

        if change_pct >= threshold_pct and volume_ratio >= volume_ratio_threshold:
            action = 'open_long'
        elif change_pct <= -threshold_pct and volume_ratio >= volume_ratio_threshold:
            action = 'open_short'
        else:
            return None

        change_over = max(0.0, abs(change_pct) - threshold_pct)
        change_boost = min(15.0, change_over * 5.0)
        vol_over = max(0.0, volume_ratio - volume_ratio_threshold)
        vol_boost = min(10.0, vol_over * 10.0)
        confidence = min(92.0, 70.0 + change_boost + vol_boost)

        return {
            'action': action,
            'change_pct': change_pct,
            'volume_ratio': volume_ratio,
            'confidence': confidence,
            'window_minutes': window_minutes
        }

    def _build_market_context(
        self,
        symbol: str,
        quant_analysis: Dict,
        predict_result,
        market_data: Dict,
        regime_info: Dict = None,
        position_info: Dict = None,
        selected_agent_outputs: Optional[Dict] = None
    ) -> str:
        """
        构建 DeepSeek LLM 所需的市场上下文文本
        """
        # 提取关键数据
        current_price = market_data['current_price']
        
        # 格式化趋势分析
        trend = quant_analysis.get('trend', {})
        trend_details = trend.get('details', {})
        
        oscillator = quant_analysis.get('oscillator', {})
        
        sentiment = quant_analysis.get('sentiment', {})
        
        # Prophet 预测 (语义化转换)
        prob_pct = (predict_result.probability_up if predict_result else 0.5) * 100
        prophet_signal = predict_result.signal if predict_result else "neutral"
        
        # 语义转换逻辑 (Prophet)
        if prob_pct >= 80:
            prediction_desc = f"Strong Uptrend Forecast (High Probability of Rising > 80%, Value: {prob_pct:.1f}%)"
        elif prob_pct >= 60:
            prediction_desc = f"Bullish Bias (Likely to Rise 60-80%, Value: {prob_pct:.1f}%)"
        elif prob_pct <= 20:
            prediction_desc = f"Strong Downtrend Forecast (High Probability of Falling > 80%, Value: {prob_pct:.1f}%)"
        elif prob_pct <= 40:
            prediction_desc = f"Bearish Bias (Likely to Fall 60-80%, Value: {prob_pct:.1f}%)"
        else:
            prediction_desc = f"Uncertain/Neutral (40-60%, Value: {prob_pct:.1f}%)"

        # 语义化转换 (Technical Indicators)
        t_score_total = trend.get('total_trend_score')  # Default to None
        t_semantic = SemanticConverter.get_trend_semantic(t_score_total)
        # Individual Trend Scores
        t_1h_score = trend.get('trend_1h_score') 
        t_15m_score = trend.get('trend_15m_score')
        t_5m_score = trend.get('trend_5m_score')
        t_1h_sem = SemanticConverter.get_trend_semantic(t_1h_score)
        t_15m_sem = SemanticConverter.get_trend_semantic(t_15m_score)
        t_5m_sem = SemanticConverter.get_trend_semantic(t_5m_score)
        
        o_score_total = oscillator.get('total_osc_score')
        o_semantic = SemanticConverter.get_oscillator_semantic(o_score_total)
        
        s_score_total = sentiment.get('total_sentiment_score')
        s_semantic = SemanticConverter.get_sentiment_score_semantic(s_score_total)

        rsi_15m = oscillator.get('oscillator_15m', {}).get('details', {}).get('rsi_value')
        rsi_1h = oscillator.get('oscillator_1h', {}).get('details', {}).get('rsi_value')
        rsi_15m_semantic = SemanticConverter.get_rsi_semantic(rsi_15m)
        rsi_1h_semantic = SemanticConverter.get_rsi_semantic(rsi_1h)
        
        # MACD
        macd_15m = trend.get('details', {}).get('15m_macd_diff')
        macd_semantic = SemanticConverter.get_macd_semantic(macd_15m)
        
        oi_change = sentiment.get('oi_change_24h_pct', 0)
        oi_semantic = SemanticConverter.get_oi_change_semantic(oi_change)
        
        # 市场状态与价格位置
        regime_type = "Unknown"
        regime_confidence = 0
        price_position = "Unknown"
        price_position_pct = 50
        if regime_info:
            regime_type = regime_info.get('regime', 'unknown')
            regime_confidence = regime_info.get('confidence', 0)
            position_info_regime = regime_info.get('position', {})
            price_position = position_info_regime.get('location', 'unknown')
            price_position_pct = position_info_regime.get('position_pct', 50)
        
        # Helper to format values safely
        def fmt_val(val, fmt="{:.2f}"):
            return fmt.format(val) if val is not None else "N/A"

            
        # 构建持仓信息文本 (New)
        position_section = ""
        if position_info:
            side_icon = "🟢" if position_info['side'] == 'LONG' else "🔴"
            pnl_icon = "💰" if position_info['unrealized_pnl'] > 0 else "💸"
            position_section = f"""
## 💼 CURRENT POSITION STATUS (Virtual Sub-Agent Logic)
> ⚠️ CRITICAL: YOU ARE HOLDING A POSITION. EVALUATE EXIT CONDITIONS FIRST.

- **Status**: {side_icon} {position_info['side']}
- **Entry Price**: ${position_info['entry_price']:,.2f}
- **Current Price**: ${current_price:,.2f}
- **PnL**: {pnl_icon} ${position_info['unrealized_pnl']:.2f} ({position_info['pnl_pct']:+.2f}%)
- **Quantity**: {position_info['quantity']}
- **Leverage**: {position_info['leverage']}x

**EXIT JUDGMENT INSTRUCTION**:
1. **Trend Reversal**: If current trend contradicts position side (e.g. Long but Trend turned Bearish), consider CLOSE.
2. **Profit/Risk**: Check if PnL is satisfactory or risk is increasing.
3. **If Closing**:
   - current side is LONG -> return `close_long`
   - current side is SHORT -> return `close_short`
"""
        
        context = f"""
## 1. Snapshot
- Symbol: {symbol}
- Price: ${current_price:,.2f}
"""

        if position_section:
            context += f"\n{position_section}\n"

        context += "\n## 2. Four-Layer Status\n"
        # Build four-layer status summary with smart grouping
        blocking_reason = global_state.four_layer_result.get('blocking_reason', 'None')
        layer1_pass = global_state.four_layer_result.get('layer1_pass')
        layer2_pass = global_state.four_layer_result.get('layer2_pass')
        layer3_pass = global_state.four_layer_result.get('layer3_pass')
        layer4_pass = global_state.four_layer_result.get('layer4_pass')
        
        layer_status = []
        
        # Smart grouping: if both Layer 1 and 2 fail with same reason, merge them
        if not layer1_pass and not layer2_pass:
            layer_status.append(f"❌ **Layers 1-2 BLOCKED**: {blocking_reason}")
        else:
            if layer1_pass:
                layer_status.append("✅ **Trend/Fuel**: PASS")
            else:
                layer_status.append(f"❌ **Trend/Fuel**: FAIL - {blocking_reason}")
            
            if layer2_pass:
                layer_status.append("✅ **AI Filter**: PASS")
            else:
                layer_status.append(f"❌ **AI Filter**: VETO - {blocking_reason}")
        
        # Layer 3 & 4
        layer_status.append(f"{'✅' if layer3_pass else '⏳'} **Setup (15m)**: {'READY' if layer3_pass else 'WAIT'}")
        layer_status.append(f"{'✅' if layer4_pass else '⏳'} **Trigger (5m)**: {'CONFIRMED' if layer4_pass else 'WAITING'}")
        
        # Add risk adjustment
        tp_mult = global_state.four_layer_result.get('tp_multiplier', 1.0)
        sl_mult = global_state.four_layer_result.get('sl_multiplier', 1.0)
        if tp_mult != 1.0 or sl_mult != 1.0:
            layer_status.append(f"⚖️ **Risk Adjustment**: TP x{tp_mult} | SL x{sl_mult}")
        
        context += "\n".join(layer_status)
        
        # Add data anomaly warning
        if global_state.four_layer_result.get('data_anomalies'):
            anomalies = ', '.join(global_state.four_layer_result.get('data_anomalies', []))
            context += f"\n\n⚠️ **DATA ANOMALY**: {anomalies}"

        # Multi-Period Parser Summary (only if selected)
        multi_period = None
        if selected_agent_outputs and selected_agent_outputs.get('multi_period_agent'):
            multi_period = selected_agent_outputs.get('multi_period_agent') or {}
        if multi_period:
            trend_scores = multi_period.get('trend_scores', {}) or {}
            four_layer = multi_period.get('four_layer', {}) or {}
            layer_pass = four_layer.get('layer_pass', {}) or {}
            context += "\n\n## 3. Multi-Period\n"
            context += (
                f"- Alignment: {multi_period.get('alignment_reason', 'N/A')}\n"
                f"- Bias: {multi_period.get('bias', 'N/A')}\n"
                f"- Trend(1h/15m/5m): "
                f"{trend_scores.get('trend_1h', 0):+.0f}/"
                f"{trend_scores.get('trend_15m', 0):+.0f}/"
                f"{trend_scores.get('trend_5m', 0):+.0f}\n"
                f"- Four-Layer: {four_layer.get('final_action', 'WAIT')} "
                f"(L1:{'Y' if layer_pass.get('L1') else 'N'}, "
                f"L2:{'Y' if layer_pass.get('L2') else 'N'}, "
                f"L3:{'Y' if layer_pass.get('L3') else 'N'}, "
                f"L4:{'Y' if layer_pass.get('L4') else 'N'})"
            )

        # Selected agent outputs (explicitly inject for Decision Core)
        if selected_agent_outputs:
            context += "\n\n## 4. Enabled Agent Outputs (Compact)\n"
            for key, val in selected_agent_outputs.items():
                context += self._format_agent_output_for_context(key, val)

        context += "\n\n## 5. Market Summary\n"
        
        # Extract analysis results (respect selected agents)
        trend_result = {}
        setup_result = {}
        trigger_result = {}
        if selected_agent_outputs:
            trend_result = selected_agent_outputs.get('trend_agent', {})
            setup_result = selected_agent_outputs.get('setup_agent', {})
            trigger_result = selected_agent_outputs.get('trigger_agent', {})
        else:
            trend_result = getattr(global_state, 'semantic_analyses', {}).get('trend', {})
            setup_result = getattr(global_state, 'semantic_analyses', {}).get('setup', {})
            trigger_result = getattr(global_state, 'semantic_analyses', {}).get('trigger', {})
        
        if isinstance(trend_result, dict):
            trend_stance = trend_result.get('stance', 'UNKNOWN')
            trend_meta = trend_result.get('metadata', {})
            trend_line = f"- Trend: {trend_stance} | Strength={trend_meta.get('strength', 'N/A')} | ADX={trend_meta.get('adx', 'N/A')}"
        else:
            trend_line = "- Trend: N/A"

        if isinstance(setup_result, dict):
            setup_stance = setup_result.get('stance', 'UNKNOWN')
            setup_meta = setup_result.get('metadata', {})
            setup_line = f"- Setup: {setup_stance} | Zone={setup_meta.get('zone', 'N/A')} | KDJ={setup_meta.get('kdj_j', 'N/A')} | MACD={setup_meta.get('macd_signal', 'N/A')}"
        else:
            setup_line = "- Setup: N/A"

        if isinstance(trigger_result, dict):
            trigger_stance = trigger_result.get('stance', 'UNKNOWN')
            trigger_meta = trigger_result.get('metadata', {})
            trigger_line = f"- Trigger: {trigger_stance} | Pattern={trigger_meta.get('pattern', 'NONE')} | RVOL={trigger_meta.get('rvol', 'N/A')}x"
        else:
            trigger_line = "- Trigger: N/A"

        context += f"{trend_line}\n{setup_line}\n{trigger_line}\n"
        
        # Note: Market Regime and Price Position are already calculated by TREND and SETUP agents
        # and included in their respective analyses above, so we don't duplicate them here.
        
        return context

    def _format_agent_output_for_context(self, key: str, value: Any) -> str:
        import json
        try:
            payload = json.dumps(value, ensure_ascii=False, default=str)
        except Exception:
            payload = str(value)
        if len(payload) > 800:
            payload = payload[:800] + "...(truncated)"
        return f"- {key}: {payload}\n"
