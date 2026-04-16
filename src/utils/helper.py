
from typing import Optional, Dict, Any

from src.agents.risk_audit_agent import PositionInfo

from src.api.binance_client import BinanceClient

from src.utils.logger import log
from src.server.state import global_state

from src.utils.action_protocol import normalize_action, is_open_action

def get_current_position(
    client: BinanceClient,
    symbol: str,
    test_mode: bool,
) -> Optional[PositionInfo]:
    """获取当前持仓 (支持实盘 + Test Mode)"""
    try:
        # 1. Test Mode Support
        if test_mode:
            if symbol in global_state.virtual_positions:
                v_pos = global_state.virtual_positions[symbol]
                return PositionInfo(
                    symbol=symbol,
                    side=v_pos['side'].lower(), # ensure lowercase 'long'/'short'
                    entry_price=v_pos['entry_price'],
                    quantity=v_pos['quantity'],
                    unrealized_pnl=v_pos.get('unrealized_pnl', 0)
                )
            return None

        # 2. Live Mode Support
        pos = client.get_futures_position(symbol)
        if pos and abs(pos['position_amt']) > 0:
            return PositionInfo(
                symbol=symbol,
                side='long' if pos['position_amt'] > 0 else 'short',
                entry_price=pos['entry_price'],
                quantity=abs(pos['position_amt']),
                unrealized_pnl=pos['unrealized_profit']
            )
        return None
    except Exception as e:
        log.error(f"Failed to get positions: {e}")
        return None
    
def get_position_1h_veto_reason(order_params: Dict[str, Any]) -> Optional[str]:
    """Final safety gate for opening actions based on 1h position permission."""
    action = normalize_action(order_params.get('action'))
    if not is_open_action(action):
        return None

    pos_1h = order_params.get('position_1h')
    if not isinstance(pos_1h, dict):
        return None

    allow_long = pos_1h.get('allow_long')
    allow_short = pos_1h.get('allow_short')
    location = pos_1h.get('location', 'unknown')
    position_pct = pos_1h.get('position_pct')
    location_txt = f"1h位置={location}"
    if isinstance(position_pct, (int, float)):
        location_txt = f"{location_txt}({position_pct:.1f}%)"

    if action == 'open_long' and allow_long is False:
        if not _allow_position_1h_override(order_params, action):
            return f"{location_txt} 禁止做多(allow_long=False)"
    if action == 'open_short' and allow_short is False:
        if not _allow_position_1h_override(order_params, action):
            return f"{location_txt} 禁止做空(allow_short=False)"
    return None

def _allow_position_1h_override(order_params: Dict[str, Any], action: str) -> bool:
    """Rare breakout override for execution gate, aligned with RiskAuditAgent."""
    regime_name = str((order_params.get('regime') or {}).get('regime', '')).lower()
    if any(k in regime_name for k in ('sideways', 'consolidation', 'choppy', 'range', 'directionless')):
        return False

    confidence = order_params.get('confidence', 0)
    try:
        confidence = float(confidence)
    except Exception:
        confidence = 0.0
    if confidence < 92:
        return False

    pos_1h = order_params.get('position_1h')
    if not isinstance(pos_1h, dict):
        return False
    location = str(pos_1h.get('location', '')).lower()
    pos_pct = pos_1h.get('position_pct')
    if not isinstance(pos_pct, (int, float)):
        return False

    trend_scores = order_params.get('trend_scores') if isinstance(order_params.get('trend_scores'), dict) else {}
    t_1h = trend_scores.get('trend_1h_score')
    t_15m = trend_scores.get('trend_15m_score')
    t_5m = trend_scores.get('trend_5m_score')
    if not all(isinstance(v, (int, float)) for v in (t_1h, t_15m, t_5m)):
        return False

    if action == 'open_long':
        return (
            location in {'upper', 'resistance'}
            and pos_pct >= 70
            and t_1h >= 55
            and t_15m >= 25
            and t_5m >= 10
        )
    if action == 'open_short':
        return (
            location in {'support', 'lower'}
            and pos_pct <= 30
            and t_1h <= -55
            and t_15m <= -25
            and t_5m <= -10
        )
    return False
