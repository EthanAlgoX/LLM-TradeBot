from datetime import datetime
from typing import Dict, Optional, Any

from dataclasses import asdict
from src.agents import PredictResult
from src.agents import VoteResult
from src.utils.data_saver import DataSaver
from src.utils.semantic_converter import SemanticConverter  # ✅ Global Import

from src.utils.logger import log
from src.server.state import global_state
from src.trading import CycleContext

class ResultBuilder:
    def __init__(
        self,
        saver: DataSaver
    ):
        self.saver = saver

    def build_decision_snapshot(
        self,
        *,
        symbol: str,
        vote_result: VoteResult,
        quant_analysis: Dict[str, Any],
        predict_result: PredictResult,
        risk_level: str,
        guardian_passed: bool,
        guardian_reason: Optional[str] = None,
        action_override: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create dashboard-ready decision payload with shared enrichment fields."""
        decision_dict = asdict(vote_result)
        if action_override:
            decision_dict['action'] = action_override
        decision_dict['symbol'] = symbol
        decision_dict['timestamp'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        decision_dict['cycle_number'] = global_state.cycle_counter
        decision_dict['cycle_id'] = global_state.current_cycle_id
        decision_dict['risk_level'] = risk_level
        decision_dict['guardian_passed'] = guardian_passed
        if guardian_reason is not None:
            decision_dict['guardian_reason'] = guardian_reason
        decision_dict['prophet_probability'] = predict_result.probability_up if predict_result else 0.5
        decision_dict['vote_analysis'] = SemanticConverter.convert_analysis_map(decision_dict.get('vote_details', {}))
        decision_dict['four_layer_status'] = global_state.four_layer_result
        self._attach_agent_ui_fields(decision_dict)

        if 'vote_details' not in decision_dict:
            decision_dict['vote_details'] = {}
        decision_dict['vote_details']['oi_fuel'] = quant_analysis.get('sentiment', {}).get('oi_fuel', {})

        kdj_zone = global_state.four_layer_result.get('kdj_zone')
        if not kdj_zone:
            bb_position = global_state.four_layer_result.get('bb_position', 'unknown')
            bb_to_zone_map = {
                'upper': 'overbought',
                'lower': 'oversold',
                'middle': 'neutral',
                'unknown': 'unknown'
            }
            kdj_zone = bb_to_zone_map.get(bb_position, 'unknown')
        decision_dict['vote_details']['kdj_zone'] = kdj_zone

        if 'regime' in decision_dict and decision_dict['regime']:
            decision_dict['regime']['adx'] = global_state.four_layer_result.get('adx', 20)

        if vote_result.regime:
            global_state.market_regime = vote_result.regime.get('regime', 'Unknown')
        if vote_result.position:
            pos_pct = min(max(vote_result.position.get('position_pct', 0), 0), 100)
            global_state.price_position = f"{pos_pct:.1f}% ({vote_result.position.get('location', 'Unknown')})"

        return decision_dict

    def build_warmup_wait_result(
        self,
        context: CycleContext,
        *,
        data_readiness: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Create wait result when indicators are still warming up."""
        reason = data_readiness.get('blocking_reason') or "data_warmup"
        log.warning(f"[{context.symbol}] {reason}")
        global_state.add_log(f"[DATA] {reason}")
        global_state.oracle_status = "Warmup"
        global_state.guardian_status = "Warmup"
        global_state.four_layer_result = {
            'layer1_pass': False,
            'layer2_pass': False,
            'layer3_pass': False,
            'layer4_pass': False,
            'final_action': 'wait',
            'blocking_reason': reason,
            'data_ready': False,
            'data_validity': data_readiness['details']
        }

        decision_dict = {
            'action': 'wait',
            'confidence': 0,
            'reason': reason,
            'vote_details': {
                'data_validity': data_readiness['details']
            },
            'symbol': context.symbol,
            'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            'cycle_number': global_state.cycle_counter,
            'cycle_id': global_state.current_cycle_id,
            'risk_level': 'safe',
            'guardian_passed': True
        }
        decision_dict['vote_analysis'] = SemanticConverter.convert_analysis_map(decision_dict.get('vote_details', {}))
        decision_dict['four_layer_status'] = global_state.four_layer_result
        self._attach_agent_ui_fields(decision_dict)

        global_state.update_decision(decision_dict)
        self.saver.save_decision(decision_dict, context.symbol, context.snapshot_id, cycle_id=context.cycle_id)

        return {
            'status': 'wait',
            'action': 'wait',
            'details': {
                'reason': reason,
                'confidence': 0
            }
        }
    
    def _attach_agent_ui_fields(self, decision_dict: Dict) -> None:
        """Attach optional agent fields used by the dashboard."""
        four_layer = getattr(global_state, 'four_layer_result', {}) or {}
        ai_check = four_layer.get('ai_check', {}) if isinstance(four_layer, dict) else {}
        if ai_check:
            decision_dict['ai_filter_passed'] = not ai_check.get('ai_veto', False)
            decision_dict['ai_filter_reason'] = ai_check.get('reason')
            decision_dict['ai_filter_signal'] = ai_check.get('ai_signal')
            decision_dict['ai_filter_confidence'] = ai_check.get('ai_confidence')

        decision_dict['trigger_pattern'] = four_layer.get('trigger_pattern')
        decision_dict['trigger_rvol'] = four_layer.get('trigger_rvol')

        position = decision_dict.get('position')
        if isinstance(position, dict) and position.get('location'):
            decision_dict['position_zone'] = position.get('location')

        semantic_analyses = getattr(global_state, 'semantic_analyses', None)
        if semantic_analyses:
            decision_dict['semantic_analyses'] = semantic_analyses

        reflection_text = getattr(global_state, 'last_reflection_text', None)
        reflection_count = getattr(global_state, 'reflection_count', 0)
        trades = getattr(global_state, 'trade_history', []) or []
        pnl_values = []
        for trade in trades:
            if not isinstance(trade, dict):
                continue
            pnl = trade.get('pnl', trade.get('realized_pnl'))
            if pnl is None:
                continue
            try:
                pnl_values.append(float(pnl))
            except (TypeError, ValueError):
                continue
        win_rate = None
        if pnl_values:
            wins = sum(1 for v in pnl_values if v > 0)
            win_rate = (wins / len(pnl_values)) * 100
        if reflection_text or reflection_count or pnl_values:
            decision_dict['reflection'] = {
                'count': reflection_count,
                'text': reflection_text,
                'trades': len(pnl_values),
                'win_rate': win_rate
            }

        indicator_snapshot = getattr(global_state, 'indicator_snapshot', None)
        if indicator_snapshot:
            snapshot = indicator_snapshot
            if isinstance(indicator_snapshot, dict) and 'ema_status' not in indicator_snapshot:
                symbol = decision_dict.get('symbol')
                snapshot = indicator_snapshot.get(symbol) if symbol else None
            if snapshot:
                decision_dict['indicator_snapshot'] = snapshot
