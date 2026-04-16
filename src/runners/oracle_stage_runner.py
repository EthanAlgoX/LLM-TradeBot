import asyncio

from datetime import datetime
from typing import Dict, Optional, List, Any

from src.config import Config
from src.agents.agent_config import AgentConfig
from src.agents.agent_provider import AgentProvider
from src.data.processor import MarketDataProcessor  # ✅ Corrected Import

from src.agents.data_sync import MarketSnapshot

from src.api.binance_client import BinanceClient
from src.utils.data_saver import DataSaver

from src.runners.stage_result import StageResult
from src.runners.result_builder import ResultBuilder
from src.trading import CycleContext

from src.agents.runtime_events import emit_global_runtime_event
from src.utils.agents_util import get_agent_timeout

from src.utils.logger import log
from src.server.state import global_state

from .runner_decorators import log_run

class OracleStageRunner:
    def __init__(
        self,
        config: Config,
        agent_config: AgentConfig,
        client: BinanceClient,
        agent_provider: AgentProvider,
        saver: DataSaver,
        kline_limit: int,
        test_mode: bool
    ):
        self.config = config
        self.agent_config = agent_config
        self.client = client
        self.agent_provider = agent_provider
        self.saver = saver
        self.result_builder = ResultBuilder(
            saver
        )
        self.kline_limit = kline_limit
        self.test_mode = test_mode
        
        print("[DEBUG] Creating MarketDataProcessor...")
        self.processor = MarketDataProcessor()  # ✅ 初始化数据处理器
        print("[DEBUG] MarketDataProcessor created")

    @log_run
    async def run(
        self,
        context: CycleContext
    ) -> StageResult:
        """Run Step 1: fetch market data, validate, build position context, and process indicators."""
        global_state.oracle_status = "Fetching Data..."
        global_state.add_agent_message("system", f"Fetching market data for {context.symbol}...", level="info")
        emit_global_runtime_event(
            context,
            stream="lifecycle",
            agent="oracle",
            phase="start"
        )

        data_sync_timeout = get_agent_timeout(self.config, self.agent_config, 'data_sync', 200.0)
        try:
            market_snapshot = await asyncio.wait_for(
                self.agent_provider.data_sync_agent.fetch_all_timeframes(
                    context.symbol,
                    limit=self.kline_limit
                ),
                timeout=data_sync_timeout
            )
        except asyncio.TimeoutError:
            error_msg = f"❌ DATA FETCH TIMEOUT: oracle>{data_sync_timeout:.1f}s"
            log.error(error_msg)
            global_state.add_log(f"[🚨 CRITICAL] {error_msg}")
            global_state.oracle_status = "DATA ERROR"
            emit_global_runtime_event(
                context,
                stream="error",
                agent="oracle",
                phase="timeout",
                data={"error_type": "api_timeout", "timeout_seconds": data_sync_timeout}
            )
            return StageResult(early_result={
                'status': 'error',
                'action': 'blocked',
                'details': {
                    'reason': error_msg,
                    'error_type': 'api_timeout'
                }
            })
        except Exception as e:
            error_msg = f"❌ DATA FETCH FAILED: {str(e)}"
            log.error(error_msg)
            global_state.add_log(f"[🚨 CRITICAL] {error_msg}")
            global_state.oracle_status = "DATA ERROR"
            emit_global_runtime_event(
                context,
                stream="error",
                agent="oracle",
                phase="error",
                data={"error_type": "api_failure", "error": str(e)}
            )
            return StageResult(early_result={
                'status': 'error',
                'action': 'blocked',
                'details': {
                    'reason': f'Data API call failed: {str(e)}',
                    'error_type': 'api_failure'
                }
            })

        data_errors = self._validate_market_snapshot(market_snapshot)
        if data_errors:
            error_msg = f"❌ DATA INCOMPLETE: {'; '.join(data_errors)}"
            log.error(error_msg)
            global_state.add_log(f"[🚨 CRITICAL] {error_msg}")
            global_state.oracle_status = "DATA INCOMPLETE"
            print(f"\n{'='*60}")
            print("🚨 TRADING BLOCKED - DATA ERROR")
            print(f"{'='*60}")
            for err in data_errors:
                print(f"   ❌ {err}")
            print(f"{'='*60}\n")
            emit_global_runtime_event(
                context,
                stream="error",
                agent="oracle",
                phase="error",
                data={"error_type": "data_incomplete", "errors": data_errors}
            )
            return StageResult(early_result={
                'status': 'error',
                'action': 'blocked',
                'details': {
                    'reason': error_msg,
                    'error_type': 'data_incomplete',
                    'errors': data_errors
                }
            })

        global_state.oracle_status = "Data Ready"
        current_position_info = self._extract_position_info(context.symbol, market_snapshot)
        processed_dfs = self._process_market_snapshot(context, market_snapshot=market_snapshot)

        market_snapshot.stable_5m = processed_dfs['5m']
        market_snapshot.stable_15m = processed_dfs['15m']
        market_snapshot.stable_1h = processed_dfs['1h']

        current_price = market_snapshot.live_5m.get('close')
        print(f"  ✅ Data ready: ${current_price:,.2f} ({market_snapshot.timestamp.strftime('%H:%M:%S')})")
        global_state.add_log(f"[🕵️ ORACLE] Data ready: ${current_price:,.2f}")
        global_state.current_price[context.symbol] = current_price

        data_readiness = self._assess_data_readiness(processed_dfs)
        if not data_readiness['is_ready']:
            emit_global_runtime_event(
                context,
                stream="lifecycle",
                agent="oracle",
                phase="end",
                data={"status": "warmup"}
            )
            return StageResult(
                early_result=self.result_builder.build_warmup_wait_result(
                    context,
                    data_readiness=data_readiness)
                )

        indicator_snapshot = self._capture_indicator_snapshot(processed_dfs, timeframe='15m')
        if indicator_snapshot:
            snapshots = getattr(global_state, 'indicator_snapshot', {})
            if not isinstance(snapshots, dict) or 'ema_status' in snapshots:
                snapshots = {}
            snapshots[context.symbol] = indicator_snapshot
            global_state.indicator_snapshot = snapshots

        emit_global_runtime_event(
            context,
            stream="lifecycle",
            agent="oracle",
            phase="end",
            data={"status": "ok", "price": current_price}
        )
        return StageResult(payload={
            'market_snapshot': market_snapshot,
            'processed_dfs': processed_dfs,
            'current_price': current_price,
            'current_position_info': current_position_info
        })
    
    def _validate_market_snapshot(self, market_snapshot: MarketSnapshot) -> List[str]:
        """Validate mandatory market snapshot fields before analysis."""
        data_errors: List[str] = []

        if market_snapshot.stable_5m is None or (hasattr(market_snapshot.stable_5m, 'empty') and market_snapshot.stable_5m.empty):
            data_errors.append("5m data missing or empty")
        elif len(market_snapshot.stable_5m) < 50:
            data_errors.append(f"5m data incomplete ({len(market_snapshot.stable_5m)}/50 bars)")

        if market_snapshot.stable_15m is None or (hasattr(market_snapshot.stable_15m, 'empty') and market_snapshot.stable_15m.empty):
            data_errors.append("15m data missing or empty")
        elif len(market_snapshot.stable_15m) < 20:
            data_errors.append(f"15m data incomplete ({len(market_snapshot.stable_15m)}/20 bars)")

        if market_snapshot.stable_1h is None or (hasattr(market_snapshot.stable_1h, 'empty') and market_snapshot.stable_1h.empty):
            data_errors.append("1h data missing or empty")
        elif len(market_snapshot.stable_1h) < 10:
            data_errors.append(f"1h data incomplete ({len(market_snapshot.stable_1h)}/10 bars)")

        if not market_snapshot.live_5m or market_snapshot.live_5m.get('close', 0) <= 0:
            data_errors.append("Live price unavailable")

        return data_errors
    
    
    def _extract_position_info(self, symbol: str, market_snapshot: MarketSnapshot) -> Optional[Dict[str, Any]]:
        """Build unified position context for decision and risk stages."""
        current_position_info = None
        try:
            if self.test_mode:
                if symbol in global_state.virtual_positions:
                    v_pos = global_state.virtual_positions[symbol]
                    current_price_5m = market_snapshot.live_5m['close']
                    entry_price = v_pos['entry_price']
                    qty = v_pos['quantity']
                    side = v_pos['side']
                    leverage = v_pos.get('leverage', 1)

                    if side == 'LONG':
                        unrealized_pnl = (current_price_5m - entry_price) * qty
                    else:
                        unrealized_pnl = (entry_price - current_price_5m) * qty

                    margin = (entry_price * qty) / leverage if leverage > 0 else entry_price * qty
                    pnl_pct = (unrealized_pnl / margin) * 100 if margin > 0 else 0

                    current_position_info = {
                        'symbol': symbol,
                        'side': side,
                        'quantity': qty,
                        'entry_price': entry_price,
                        'unrealized_pnl': unrealized_pnl,
                        'pnl_pct': pnl_pct,
                        'leverage': leverage,
                        'is_test': True
                    }

                    v_pos['unrealized_pnl'] = unrealized_pnl
                    v_pos['pnl_pct'] = pnl_pct
                    v_pos['current_price'] = current_price_5m
                    log.info(f"💰 [Virtual Position] {side} {symbol} PnL: ${unrealized_pnl:.2f} (ROE: {pnl_pct:+.2f}%)")
            else:
                try:
                    raw_pos = self.client.get_futures_position(symbol)
                    if raw_pos and float(raw_pos.get('positionAmt', 0)) != 0:
                        amt = float(raw_pos.get('positionAmt', 0))
                        side = 'LONG' if amt > 0 else 'SHORT'
                        entry_price = float(raw_pos.get('entryPrice', 0))
                        unrealized_pnl = float(raw_pos.get('unRealizedProfit', 0))
                        qty = abs(amt)
                        leverage = int(raw_pos.get('leverage', 1))

                        margin = (entry_price * qty) / leverage if leverage > 0 else entry_price * qty
                        pnl_pct = (unrealized_pnl / margin) * 100 if margin > 0 else 0

                        current_position_info = {
                            'symbol': symbol,
                            'side': side,
                            'quantity': qty,
                            'entry_price': entry_price,
                            'unrealized_pnl': unrealized_pnl,
                            'pnl_pct': pnl_pct,
                            'leverage': leverage,
                            'is_test': False
                        }
                        log.info(f"💰 [Real Position] {side} {symbol} Amt:{amt} PnL:${unrealized_pnl:.2f} (ROE: {pnl_pct:+.2f}%)")
                except Exception as e:
                    log.error(f"Failed to fetch real position: {e}")
        except Exception as e:
            log.error(f"Error processing position info: {e}")

        return current_position_info

    def _capture_indicator_snapshot(self, processed_dfs: Dict[str, "pd.DataFrame"], timeframe: str = '15m') -> Optional[Dict]:
        """Capture lightweight indicator snapshot for UI."""
        df = processed_dfs.get(timeframe)
        if df is None or df.empty:
            return None

        latest = df.iloc[-1]

        def _safe_float(value):
            try:
                val = float(value)
            except (TypeError, ValueError):
                return None
            if val != val or val in (float('inf'), float('-inf')):
                return None
            return val

        close = _safe_float(latest.get('close'))
        ema20 = _safe_float(latest.get('ema_20'))
        ema60 = _safe_float(latest.get('ema_60'))
        rsi = _safe_float(latest.get('rsi'))
        macd_diff = _safe_float(latest.get('macd_diff'))
        bb_upper = _safe_float(latest.get('bb_upper'))
        bb_lower = _safe_float(latest.get('bb_lower'))
        bb_middle = _safe_float(latest.get('bb_middle'))

        ema_status = None
        if close is not None and ema20 is not None and ema60 is not None:
            if close > ema20 > ema60:
                ema_status = 'bullish'
            elif close < ema20 < ema60:
                ema_status = 'bearish'
            elif ema20 > ema60:
                ema_status = 'bullish_bias'
            elif ema20 < ema60:
                ema_status = 'bearish_bias'
            else:
                ema_status = 'mixed'

        bb_position = None
        if close is not None and bb_upper is not None and bb_lower is not None and bb_middle is not None:
            if close > bb_upper:
                bb_position = 'upper'
            elif close < bb_lower:
                bb_position = 'lower'
            else:
                bb_position = 'middle'

        return {
            'timeframe': timeframe,
            'ema_status': ema_status,
            'rsi': rsi,
            'macd_diff': macd_diff,
            'bb_position': bb_position
        }
  
    def _process_market_snapshot(
        self,
        context: CycleContext,
        *,
        market_snapshot: MarketSnapshot
    ) -> Dict[str, "pd.DataFrame"]:
        """Save raw/indicators/features and return processed dataframes."""
        processed_dfs: Dict[str, "pd.DataFrame"] = {}
        for tf in ['5m', '15m', '1h']:
            raw_klines = getattr(market_snapshot, f'raw_{tf}')
            self.saver.save_market_data(raw_klines, context.symbol, tf, cycle_id=context.cycle_id)

            stable_klines = self._get_closed_klines(raw_klines)
            df_with_indicators = self.processor.process_klines(
                stable_klines,
                context.symbol,
                tf,
                save_raw=False
            )
            self.saver.save_indicators(df_with_indicators, context.symbol, tf, context.snapshot_id, cycle_id=context.cycle_id)
            features_df = self.processor.extract_feature_snapshot(df_with_indicators)
            self.saver.save_features(features_df, context.symbol, tf, context.snapshot_id, cycle_id=context.cycle_id)
            processed_dfs[tf] = df_with_indicators
        return processed_dfs

    def _assess_data_readiness(self, processed_dfs: Dict[str, object]) -> Dict:
        """Check warmup/is_valid flags for all timeframes before making decisions."""
        readiness = {
            'is_ready': True,
            'details': {},
            'blocking_reason': None
        }

        min_valid_index = self.processor._get_min_valid_index()
        required_bars = min_valid_index + 1

        for tf in ['5m', '15m', '1h']:
            df = processed_dfs.get(tf)
            if df is None or df.empty:
                readiness['is_ready'] = False
                readiness['details'][tf] = {
                    'is_valid': False,
                    'bars': 0,
                    'bars_needed': required_bars,
                    'bars_remaining': required_bars,
                    'reason': 'no_data'
                }
                continue

            reason = None
            if 'is_valid' in df.columns:
                latest_valid = bool(df['is_valid'].iloc[-1] == True)
            elif 'is_warmup' in df.columns:
                latest_valid = bool(df['is_warmup'].iloc[-1] == False)
            else:
                latest_valid = False
                reason = 'missing_valid_flag'

            bars = len(df)
            bars_remaining = max(0, required_bars - bars)

            readiness['details'][tf] = {
                'is_valid': latest_valid,
                'bars': bars,
                'bars_needed': required_bars,
                'bars_remaining': bars_remaining,
                'reason': reason
            }

            if not latest_valid:
                readiness['is_ready'] = False

        if not readiness['is_ready']:
            reasons = []
            for tf, info in readiness['details'].items():
                if not info['is_valid']:
                    if info.get('reason'):
                        reasons.append(f"{tf}:{info['reason']}")
                    elif info.get('bars', 0) > 0:
                        reasons.append(f"{tf}:warmup {info['bars']}/{info['bars_needed']}")
                    else:
                        reasons.append(f"{tf}:no_data")
            readiness['blocking_reason'] = "data_warmup: " + ", ".join(reasons)

        return readiness   
    
    def _get_closed_klines(self, klines: List[Dict]) -> List[Dict]:
        """Return klines confirmed closed (avoid dropping already-closed bars)."""
        if not klines:
            return []

        last = klines[-1]
        if last.get('is_closed') is True:
            return klines

        close_time = last.get('close_time')
        if close_time is not None:
            try:
                now_ms = int(datetime.now().timestamp() * 1000)
                if int(close_time) <= now_ms:
                    return klines
            except (TypeError, ValueError):
                pass

        return klines[:-1]
