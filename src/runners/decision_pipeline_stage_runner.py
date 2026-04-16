import os

from typing import Dict, Optional, Any
from datetime import datetime
from dataclasses import asdict

from src.runners.stage_result import StageResult
from src.trading import CycleContext
from src.runners.result_builder import ResultBuilder
from src.utils.data_saver import DataSaver
from src.server.state import global_state
from src.utils.action_protocol import (
    is_passive_action,
)

from .decision_stage_runner import DecisionStageRunner
from .runner_decorators import log_run

class DecisionPipelineStageRunner:
    def __init__(
        self,
        decision_stage_runner: DecisionStageRunner,
        saver: DataSaver,
        test_mode: bool = False
    ):
        self.decision_stage_runner = decision_stage_runner
        self.saver = saver
        self.result_builder = ResultBuilder(
            saver
        )
        self.test_mode = test_mode

    @log_run
    async def run(
        self,
        context: CycleContext,
        headless_mode: bool
    ) -> StageResult:
        """Run decision stage + observability + passive handling."""
        decision_payload, decision_source, fast_signal, vote_result, selected_agent_outputs = await self.decision_stage_runner.run(context, headless_mode)

        self._record_decision_observability(
            symbol=context.symbol,
            decision_payload=decision_payload,
            decision_source=decision_source,
            vote_result=vote_result,
            snapshot_id=context.snapshot_id,
            cycle_id=context.cycle_id
        )

        passive_result = self._handle_passive_decision(
            symbol=context.symbol,
            vote_result=vote_result,
            quant_analysis=context.quant_analysis,
            predict_result=context.predict_result,
            current_position_info=context.current_position_info
        )
        if passive_result is not None:
            return StageResult(early_result=passive_result)

        return StageResult(payload={
            'decision_payload': decision_payload,
            'decision_source': decision_source,
            'fast_signal': fast_signal,
            'vote_result': vote_result,
            'selected_agent_outputs': selected_agent_outputs
        })

    def _record_decision_observability(
        self,
        *,
        symbol: str,
        decision_payload: Dict[str, Any],
        decision_source: str,
        vote_result: Any,
        snapshot_id: str,
        cycle_id: Optional[str]
    ) -> None:
        """Persist LLM logs and emit decision observability logs."""
        if decision_source == 'llm' and os.environ.get('ENABLE_DETAILED_LLM_LOGS', 'false').lower() == 'true':
            full_log_content = f"""
================================================================================
🕐 Timestamp: {datetime.now().isoformat()}
💱 Symbol: {symbol}
🔄 Cycle: #{cycle_id}
================================================================================

--------------------------------------------------------------------------------
📤 INPUT (PROMPT)
--------------------------------------------------------------------------------
[SYSTEM PROMPT]
{decision_payload.get('system_prompt', '(Missing System Prompt)')}

[USER PROMPT]
{decision_payload.get('user_prompt', '(Missing User Prompt)')}

--------------------------------------------------------------------------------
🧠 PROCESSING (REASONING)
--------------------------------------------------------------------------------
{decision_payload.get('reasoning_detail', '(No reasoning detail)')}

--------------------------------------------------------------------------------
📥 OUTPUT (DECISION)
--------------------------------------------------------------------------------
{decision_payload.get('raw_response', '(No raw response)')}
"""
            self.saver.save_llm_log(
                content=full_log_content,
                symbol=symbol,
                snapshot_id=snapshot_id,
                cycle_id=cycle_id
            )

        bull_conf = decision_payload.get('bull_perspective', {}).get('bull_confidence', 50)
        bear_conf = decision_payload.get('bear_perspective', {}).get('bear_confidence', 50)
        bull_stance = decision_payload.get('bull_perspective', {}).get('stance', 'UNKNOWN')
        bear_stance = decision_payload.get('bear_perspective', {}).get('stance', 'UNKNOWN')
        global_state.add_log(f"[🐂 Long Case] [{bull_stance}] Conf={bull_conf}%")
        global_state.add_log(f"[🐻 Short Case] [{bear_stance}] Conf={bear_conf}%")

        decision_label = "FAST Decision" if decision_source == 'fast_trend' else ("RULE Decision" if decision_source == 'decision_core' else "Final Decision")
        global_state.add_log(f"[⚖️ {decision_label}] Action={vote_result.action.upper()} | Conf={decision_payload.get('confidence', 0)}%")

        self.saver.save_decision(asdict(vote_result), symbol, snapshot_id, cycle_id=cycle_id)

    def _handle_passive_decision(
        self,
        *,
        symbol: str,
        vote_result: Any,
        quant_analysis: Dict[str, Any],
        predict_result: Any,
        current_position_info: Optional[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        """Handle passive decision (wait/hold). Return cycle result if handled."""
        if not is_passive_action(vote_result.action):
            return None

        has_position = False
        if current_position_info:
            try:
                qty = float(current_position_info.get('quantity', 0) or 0)
                has_position = abs(qty) > 0
            except (TypeError, ValueError):
                has_position = True
        if not has_position and self.test_mode:
            has_position = symbol in global_state.virtual_positions
        actual_action = 'hold' if has_position else 'wait'

        action_display = '持仓观望' if actual_action == 'hold' else '观望'
        print(f"\n✅ 决策: {action_display} ({actual_action})")

        regime_txt = vote_result.regime.get('regime', 'Unknown') if vote_result.regime else 'Unknown'
        pos_txt = f"{min(max(vote_result.position.get('position_pct', 0), 0), 100):.0f}%" if vote_result.position else 'N/A'
        global_state.add_log(f"⚖️ DecisionCoreAgent (The Critic): Context(Regime={regime_txt}, Pos={pos_txt}) => Vote: {actual_action.upper()} ({vote_result.reason})")

        decision_dict = self.result_builder.build_decision_snapshot(
            symbol=symbol,
            vote_result=vote_result,
            quant_analysis=quant_analysis,
            predict_result=predict_result,
            risk_level='safe',
            guardian_passed=True,
            action_override=actual_action
        )
        global_state.update_decision(decision_dict)

        return {
            'status': actual_action,
            'action': actual_action,
            'details': {
                'reason': vote_result.reason,
                'confidence': vote_result.confidence
            }
        }
    