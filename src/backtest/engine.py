"""
Backtest Engine Core
================================

Coordinate data replay, strategy execution, and performance evaluation

Author: AI Trader Team
Date: 2025-12-31
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable
from dataclasses import dataclass, field
import pandas as pd

from src.backtest.data_replay import DataReplayAgent
from src.backtest.portfolio import BacktestPortfolio, Side, Trade
from src.backtest.metrics import PerformanceMetrics, MetricsResult
from src.backtest.report import BacktestReport
from src.agents.risk_audit_agent import RiskAuditAgent, PositionInfo
from src.utils.logger import log
from src.utils.action_protocol import (
    normalize_action,
    is_open_action,
    is_close_action,
    is_passive_action,
)


@dataclass
class BacktestConfig:
    """Backtest configuration"""
    symbol: str
    start_date: str
    end_date: str
    initial_capital: float = 10000.0
    max_position_size: float = 1000000.0
    leverage: int = 1
    stop_loss_pct: float = 0.8
    take_profit_pct: float = 1.5
    slippage: float = 0.001
    commission: float = 0.0004
    step: int = 1  # 1=5m, 3=15m, 12=1h
    margin_mode: str = "cross"  # "cross" 或 "isolated"
    contract_type: str = "linear"  # "linear" 或 "inverse"
    contract_size: float = 100.0  # Inverse contract notional value (BTC=100 USD)
    strategy_mode: str = "agent"  # "technical" (EMA) or "agent" (Multi-Agent) - Default: agent for prompt optimization
    use_llm: bool = False  # Whether to call LLM during backtest (expensive and slow)
    llm_cache: bool = True  # Cache LLM responses
    llm_throttle_ms: int = 100  # LLM call interval (milliseconds) to avoid rate limiting
    
    # 🔧 P0 Realism Improvements
    execution_latency_ms: int = 0  # Execution latency (milliseconds), simulate decision to execution latency, 0=off
    min_hold_hours: float = 1.0  # Minimum holding time (hours) to prevent overtrading
    
    def __post_init__(self):
        """Verify configuration parameters"""
        from datetime import datetime
        
        # Verify date format
        try:
            # Try full datetime format first
            try:
                start = datetime.strptime(self.start_date, '%Y-%m-%d %H:%M')
            except ValueError:
                # Fallback to date only
                start = datetime.strptime(self.start_date, '%Y-%m-%d')
            
            try:
                end = datetime.strptime(self.end_date, '%Y-%m-%d %H:%M')
            except ValueError:
                # Fallback to date only
                end = datetime.strptime(self.end_date, '%Y-%m-%d')
                
            if start >= end:
                raise ValueError(f"start_date ({self.start_date}) must be before end_date ({self.end_date})")
        except ValueError as e:
            if "does not match format" in str(e):
                raise ValueError(f"Invalid date format. Expected YYYY-MM-DD or YYYY-MM-DD HH:MM, got start_date={self.start_date}, end_date={self.end_date}")
            raise
        
        # Verify numeric ranges
        if self.initial_capital <= 0:
            raise ValueError(f"initial_capital must be positive, got {self.initial_capital}")
        
        if self.max_position_size <= 0:
            raise ValueError(f"max_position_size must be positive, got {self.max_position_size}")
        
        if self.leverage < 1 or self.leverage > 125:
            raise ValueError(f"leverage must be between 1 and 125, got {self.leverage}")
        
        if self.stop_loss_pct < 0 or self.stop_loss_pct > 100:
            raise ValueError(f"stop_loss_pct must be between 0 and 100, got {self.stop_loss_pct}")
        
        if self.take_profit_pct < 0:
            raise ValueError(f"take_profit_pct must be non-negative, got {self.take_profit_pct}")
        
        if self.slippage < 0 or self.slippage > 1:
            raise ValueError(f"slippage must be between 0 and 1, got {self.slippage}")
        
        if self.commission < 0 or self.commission > 1:
            raise ValueError(f"commission must be between 0 and 1, got {self.commission}")
        
        if self.step < 1:
            raise ValueError(f"step must be at least 1, got {self.step}")
        
        # Verify symbol format
        if not self.symbol or not isinstance(self.symbol, str):
            raise ValueError("symbol must be a non-empty string")
        
        # Verify strategy mode
        if self.strategy_mode not in ['technical', 'agent']:
            raise ValueError(f"strategy_mode must be 'technical' or 'agent', got {self.strategy_mode}")
        
        # Verify margin mode
        if self.margin_mode not in ['cross', 'isolated']:
            raise ValueError(f"margin_mode must be 'cross' or 'isolated', got {self.margin_mode}")
        
        # Verify contract type
        if self.contract_type not in ['linear', 'inverse']:
            raise ValueError(f"contract_type must be 'linear' or 'inverse', got {self.contract_type}")



@dataclass
class BacktestResult:
    """Backtest Result"""
    config: BacktestConfig
    metrics: MetricsResult
    equity_curve: pd.DataFrame
    trades: List[Trade]
    decisions: List[Dict] = field(default_factory=list)
    duration_seconds: float = 0.0
    
    def to_dict(self) -> Dict:
        # Get filtered and deduplicated decision list
        def _get_filtered_decisions():
            """Get filtered and deduplicated decision list"""
            # Get last 50 decisions
            recent = self.decisions[-50:] if len(self.decisions) > 50 else self.decisions
            # Get all non-passive decisions
            non_hold = [d for d in self.decisions if not is_passive_action(d.get('action'))]
            
            # Merge and deduplicate (based on timestamp)
            seen = set()
            result = []
            for d in recent + non_hold:
                # Use timestamp as unique key
                key = d.get('timestamp')
                if key and key not in seen:
                    seen.add(key)
                    # Keep only required fields
                    filtered = {k: v for k, v in d.items() if k in ['timestamp', 'action', 'confidence', 'reason', 'price', 'vote_details']}
                    result.append(filtered)
            return result
        
        return {
            'config': {
                'symbol': self.config.symbol,
                'start_date': self.config.start_date,
                'end_date': self.config.end_date,
                'initial_capital': self.config.initial_capital,
            },
            'metrics': self.metrics.to_dict(),
            'total_trades': len(self.trades),
            'duration_seconds': self.duration_seconds,
            'decisions': _get_filtered_decisions(),
        }


class BacktestEngine:
    """
    Backtest Engine Core
    
    Workflow:
    1. Load historical data
    2. Initialize virtual portfolio
    3. Iterate through each timestamp
    4. Execute strategy decision
    5. Simulate trade execution
    6. Record equity and trades
    7. Calculate performance metrics
    8. Generate report
    """
    
    def __init__(
        self,
        config: BacktestConfig,
        strategy_fn: Optional[Callable] = None
    ):
        """
        Initialize backtest engine
        
        Args:
            config: Backtest configuration
            strategy_fn: Strategy function, receives (snapshot, portfolio) returns {'action': 'long/short/hold', 'confidence': 0-100}
        """
        self.config = config
        self.strategy_fn = strategy_fn or self._default_strategy
        
        # Components
        self.data_replay: Optional[DataReplayAgent] = None
        self.portfolio: Optional[BacktestPortfolio] = None
        self.agent_runner = None
        self.risk_audit = RiskAuditAgent(max_leverage=self.config.leverage)
        
        # Initialize Agent Runner if needed
        if config.strategy_mode == "agent":
            from src.backtest.agent_wrapper import BacktestAgentRunner
            self.agent_runner = BacktestAgentRunner(config.__dict__)
        
        # State
        self.is_running = False
        self.current_timestamp: Optional[datetime] = None
        self.decisions: List[Dict] = []
        
        log.info(f"🔬 BacktestEngine initialized | {config.symbol} | "
                 f"{config.start_date} to {config.end_date}")
    
    async def run(self, progress_callback: Callable = None) -> BacktestResult:
        """
        Run complete backtest
        
        Args:
            progress_callback: Progress callback function (data: dict)
            
        Returns:
            BacktestResult object
        """
        start_time = datetime.now()
        self.is_running = True
        
        log.info("=" * 60)
        log.info("🚀 Starting Backtest")
        log.info("=" * 60)
        
        # 1. Initialize data replay agent
        self.data_replay = DataReplayAgent(
            symbol=self.config.symbol,
            start_date=self.config.start_date,
            end_date=self.config.end_date
        )
        
        success = await self.data_replay.load_data()
        if not success:
            raise RuntimeError("Failed to load historical data")
        
        # 2. Initialize portfolio
        self.portfolio = BacktestPortfolio(
            initial_capital=self.config.initial_capital,
            slippage=self.config.slippage,
            commission=self.config.commission
        )
        
        # 3. Iterate timestamps
        timestamps = list(self.data_replay.iterate_timestamps(step=self.config.step))
        total = len(timestamps)
        
        log.info(f"📊 Processing {total} timestamps (step={self.config.step})")
        log.info(f"⏱️  Estimated time: {total * 72 / 60:.1f} minutes (3 LLM calls per timepoint)")
        
        for i, timestamp in enumerate(timestamps):
            if not self.is_running:
                log.warning("Backtest stopped by user")
                break
            
            self.current_timestamp = timestamp
            
            try:
                # Get market snapshot
                snapshot = self.data_replay.get_snapshot_at(timestamp)
                current_price = self.data_replay.get_current_price()
                
                # 🆕 Check and apply funding rate settlement
                funding_rate = self.data_replay.get_funding_rate_for_settlement(timestamp)
                if funding_rate is not None:
                    # Get mark price (if available)
                    fr_record = self.data_replay.get_funding_rate_at(timestamp)
                    mark_price = fr_record.mark_price if fr_record and fr_record.mark_price > 0 else current_price
                    
                    # Apply funding rate to all positions
                    for symbol in list(self.portfolio.positions.keys()):
                        self.portfolio.apply_funding_fee(symbol, funding_rate, mark_price, timestamp)
                
                # 🆕 Check liquidation
                prices = {self.config.symbol: current_price}
                liquidated = self.portfolio.check_liquidation(prices, timestamp)
                if liquidated:
                    log.warning(f"⚠️ Positions liquidated: {liquidated}")
                    continue  # Skip strategy execution after liquidation

                # Execute strategy
                decision = await self._execute_strategy(snapshot, current_price)
                self.decisions.append(decision)
                
                # Execute trade
                await self._execute_decision(decision, current_price, timestamp)

                # Intrabar SL/TP after decisions using bar high/low
                bar = snapshot.live_5m if isinstance(snapshot.live_5m, dict) else {}
                self.portfolio.check_stop_loss_take_profit_intrabar(
                    {self.config.symbol: bar},
                    timestamp
                )
                
                # Record equity (OPTIMIZATION: Sample every 12 steps or on key events)
                should_record_equity = (i % 12 == 0) or (i == total - 1) or (not is_passive_action(decision.get('action')))
                if should_record_equity:
                    self.portfolio.record_equity(timestamp, prices)
                
                
                # Progress callback (includes real-time profit data and incremental visualization data)
                if progress_callback:
                    progress_pct = (i + 1) / total * 100  # +1 because we just completed this timepoint
                    
                    # Send progress update
                    current_equity = self.portfolio.get_current_equity(prices)
                    profit = current_equity - self.config.initial_capital
                    profit_pct = (profit / self.config.initial_capital) * 100
                    
                    # Calculate fresh equity point for real-time display (not from stale curve)
                    # Update peak for drawdown calculation
                    if current_equity > self.portfolio.peak_equity:
                        peak_equity = current_equity
                    else:
                        peak_equity = self.portfolio.peak_equity
                    
                    drawdown = peak_equity - current_equity
                    drawdown_pct = drawdown / peak_equity * 100 if peak_equity > 0 else 0
                    
                    latest_equity_point = {
                        'timestamp': timestamp.isoformat(),
                        'total_equity': float(current_equity),
                        'drawdown_pct': float(drawdown_pct)
                    }
                    
                    # Get latest trade (most recent)
                    latest_trade = None
                    if self.portfolio.trades:
                        trade = self.portfolio.trades[-1]
                        latest_trade = {
                            'timestamp': trade.timestamp.isoformat(),
                            'side': trade.side.value,
                                            'action': trade.action,
                            'price': float(trade.price),
                            'pnl': float(trade.pnl),
                            'pnl_pct': float(trade.pnl_pct)
                        }
                    
                    # Calculate real-time metrics
                    trades_count = len(self.portfolio.trades)
                    winning_trades = sum(1 for t in self.portfolio.trades if t.pnl > 0 and t.action == 'close')
                    win_rate = (winning_trades / trades_count * 100) if trades_count > 0 else 0
                    
                    callback_data = {
                        'progress': progress_pct,
                        'pct': progress_pct,
                        'current_timepoint': i + 1,  # Human-readable: 1-indexed
                        'total_timepoints': total,
                        'current_equity': current_equity,
                        'profit': profit,
                        'profit_pct': profit_pct,
                        'timestamp': timestamp.isoformat() if hasattr(timestamp, 'isoformat') else str(timestamp),
                        'equity_point': latest_equity_point,
                        'latest_equity_point': latest_equity_point,
                        'latest_trade': latest_trade,
                        'metrics': {
                            'total_trades': trades_count,
                            'win_rate': win_rate,
                            'max_drawdown_pct': self.portfolio.equity_curve[-1].drawdown_pct if self.portfolio.equity_curve else 0
                        }
                    }

                    if asyncio.iscoroutinefunction(progress_callback):
                        await progress_callback(callback_data)
                    else:
                        progress_callback(callback_data)
                
            except (KeyError, ValueError, IndexError) as e:
                # Recoverable data error: log warning and skip this timestamp
                log.warning(f"Data error at {timestamp}: {type(e).__name__}: {e}, skipping this timestamp")
                continue
            except Exception as e:
                # Fatal error: log error and terminate backtest
                log.error(f"Fatal error at {timestamp}: {type(e).__name__}: {e}")
                log.error(f"Backtest terminated due to fatal error")
                raise RuntimeError(f"Backtest failed at {timestamp}: {e}") from e
        
        # 4. Force close all positions
        await self._close_all_positions()
        
        # 5. Calculate performance metrics
        equity_curve = self.portfolio.get_equity_dataframe()
        trades = self.portfolio.trades
        
        metrics = PerformanceMetrics.calculate(
            equity_curve=equity_curve,
            trades=trades,
            initial_capital=self.config.initial_capital
        )
        
        # 6. Generate result
        duration = (datetime.now() - start_time).total_seconds()
        
        result = BacktestResult(
            config=self.config,
            metrics=metrics,
            equity_curve=equity_curve,
            trades=trades,
            decisions=self.decisions,
            duration_seconds=duration
        )
        
        self.is_running = False
        
        log.info("=" * 60)
        log.info("✅ Backtest Complete")
        log.info(f"   Duration: {duration:.1f}s")
        log.info(f"   Total Return: {metrics.total_return:+.2f}%")
        log.info(f"   Max Drawdown: {metrics.max_drawdown_pct:.2f}%")
        log.info(f"   Sharpe Ratio: {metrics.sharpe_ratio:.2f}")
        log.info(f"   Win Rate: {metrics.win_rate:.1f}%")
        log.info(f"   Total Trades: {metrics.total_trades}")
        log.info(f"   💸 Funding Paid: ${self.portfolio.total_funding_paid:.4f}")
        log.info(f"   💰 Fees Paid: ${self.portfolio.total_fees_paid:.2f}")
        log.info(f"   📉 Slippage Cost: ${self.portfolio.total_slippage_cost:.2f}")
        log.info(f"   🔥 Liquidations: {self.portfolio.liquidation_count}")
        log.info("=" * 60)
        
        return result
    
    async def _execute_strategy(
        self,
        snapshot,
        current_price: float
    ) -> Dict:
        """Execute strategy并返回决策"""
        try:
            # Call strategy function
            # DEBUG LOG
            log.info(f"DEBUG: execute_strategy mode={self.config.strategy_mode} runner={self.agent_runner}")
            
            if self.config.strategy_mode == "agent" and self.agent_runner:
                log.info("DEBUG: Entering agent runner step")
                decision = await self.agent_runner.step(snapshot, self.portfolio)
            else:
                decision = await self.strategy_fn(
                    snapshot=snapshot,
                    portfolio=self.portfolio,
                    current_price=current_price,
                    config=self.config
                )
            
            decision['timestamp'] = self.current_timestamp
            decision['price'] = current_price
            
            return decision
            
        except Exception as e:
            log.warning(f"Strategy error: {e}")
            return {
                'action': 'hold',
                'confidence': 0.0,
                'reason': f'strategy_error: {e}',
                'timestamp': self.current_timestamp,
                'price': current_price
            }
    
    async def _execute_decision(
        self,
        decision: Dict,
        current_price: float,
        timestamp: datetime
    ):
        """Execute trade决策"""
        action_raw = str(decision.get('action', 'hold'))
        position_side = None
        if self.config.symbol in self.portfolio.positions:
            position_side = self.portfolio.positions[self.config.symbol].side.value
        action = normalize_action(action_raw, position_side=position_side)
        confidence = decision.get('confidence', 0.0)
        if isinstance(confidence, (int, float)) and 0 < confidence <= 1:
            confidence *= 100

        if is_passive_action(action):
            decision['action'] = 'hold'
            decision.setdefault('reason', str(action_raw).lower() or 'wait')
            action = 'hold'
        
        # 0. Global Safety Check: Minimum Confidence 50%
        # Filters out weak mechanical signals when LLM yields (0% confidence)
        if (is_open_action(action) or action_raw == 'add_position') and confidence < 50:
            log.warning(f"🚫 Confidence {confidence}% < 50% for {action}. Forcing WAIT.")
            decision['action'] = 'hold'
            decision['reason'] = 'low_confidence_filtering'
            return
        
        # NOTE: Volatile Regime Guard REMOVED - was too strict, blocking all trades
        # The LLM already provides this context in the reason field
        
        # Normalize actions
        if action == 'open_long':
            action = 'long'
        if action == 'open_short':
            action = 'short'
        
        symbol = self.config.symbol
        has_position = symbol in self.portfolio.positions
        
        # Handle Add Position (Treat as increasing existing position)
        if action == 'add_position' and has_position:
            # Re-map to long/short based on current side
            current_side = self.portfolio.positions[symbol].side
            action = 'long' if current_side == Side.LONG else 'short'
            # Fall through to Open logic
            
        # Handle Reduce Position
        if action == 'reduce_position' and has_position:
            # Partial Close logic
            current_pos = self.portfolio.positions[symbol]
            reduce_pct = 0.5 # Default reduce by 50%
            
            # Check if LLM specified size
            params = decision.get('trade_params') or {}
            if params.get('position_size_pct', 0) > 0:
                # Interpret as "Reduce BY X%" or "Reduce TO X%"? 
                # Usually "Position Size" implies target. 
                # Let's assume Reduce means "Close 50%" unless specific instructions.
                # Simplest: Reduce 50%
                pass
            
            reduce_qty = current_pos.quantity * reduce_pct
            self.portfolio.close_position(
                symbol=symbol,
                price=current_price,
                timestamp=timestamp,
                quantity=reduce_qty,
                reason='reduce_position'
            )
            return

        # Basic Action Filtering
        if (action in ['close_short', 'close_long'] or is_close_action(action)) and has_position:
            # Close Position
            # Validate direction matches if specified (close_short for SHORT, close_long for LONG)
            current_side = self.portfolio.positions[symbol].side
            if action == 'close_short' and current_side != Side.SHORT:
                log.warning(f"⚠️ close_short signal but position is {current_side}, ignoring")
                return
            if action == 'close_long' and current_side != Side.LONG:
                log.warning(f"⚠️ close_long signal but position is {current_side}, ignoring")
                return
            
            # PHASE 2: Enforce Minimum Hold Time (3h) - Hard Block
            pos = self.portfolio.positions[symbol]
            current_pnl_pct = pos.get_pnl_pct(current_price)
            hold_hours = (timestamp - pos.entry_time).total_seconds() / 3600 if pos.entry_time else 0
            
            # Hard minimum hold: Block ALL closes before 3h unless severe loss
            if hold_hours < 3:
                # Only allow close if: (a) losing > 5%, or (b) reason contains stop_loss/trailing
                close_reason = decision.get('reason', '').lower()
                is_stop_loss = 'stop_loss' in close_reason or 'trailing' in close_reason
                is_severe_loss = current_pnl_pct < -5.0
                
                if not is_stop_loss and not is_severe_loss:
                    log.info(f"🛡️ HOLD ENFORCEMENT: {hold_hours:.1f}h < 3h min hold. PnL={current_pnl_pct:+.2f}%. Blocking close.")
                    return
            
            self.portfolio.close_position(
                symbol=symbol,
                price=current_price,
                timestamp=timestamp,
                reason='signal'
            )
            log.info(f"✅ Closed {current_side.value} position via {action} signal")
            return

        if action in ['long', 'short']:
            side = Side.LONG if action == 'long' else Side.SHORT

            # --- Dynamic parameter logic ---
            params = decision.get('trade_params') or {}
            leverage = params.get('leverage') or self.config.leverage
            sl_pct = params.get('stop_loss_pct') or self.config.stop_loss_pct
            tp_pct = params.get('take_profit_pct') or self.config.take_profit_pct
            trailing_pct = params.get('trailing_stop_pct')

            available_cash = self.portfolio.cash

            if params.get('position_size_pct', 0) > 0:
                use_cash = available_cash * (params['position_size_pct'] / 100)
                target_position_value = use_cash * leverage
                position_size = min(
                    target_position_value,
                    available_cash * 0.98 * leverage,
                    self.config.max_position_size * leverage
                )
            else:
                # 默认逻辑：与实盘一致（最大33%，按置信度缩放）
                base_position_pct = 1 / 3
                position_pct = base_position_pct * (confidence / 100)
                position_size = available_cash * position_pct

            quantity = position_size / current_price
            stop_loss = current_price * (1 - sl_pct / 100) if action == 'long' else current_price * (1 + sl_pct / 100)
            take_profit = current_price * (1 + tp_pct / 100) if action == 'long' else current_price * (1 - tp_pct / 100)

            osc_scores = decision.get('oscillator_scores')
            if not osc_scores and decision.get('vote_details'):
                vote_details = decision.get('vote_details', {})
                osc_scores = {
                    'osc_1h_score': vote_details.get('oscillator_1h'),
                    'osc_15m_score': vote_details.get('oscillator_15m'),
                    'osc_5m_score': vote_details.get('oscillator_5m')
                }

            current_position = None
            if has_position:
                pos = self.portfolio.positions[symbol]
                current_position = PositionInfo(
                    symbol=symbol,
                    side=pos.side.value,
                    entry_price=pos.entry_price,
                    quantity=pos.quantity,
                    unrealized_pnl=pos.get_pnl(current_price)
                )

            audit_decision = {
                'symbol': symbol,
                'action': action,
                'entry_price': current_price,
                'stop_loss': stop_loss,
                'take_profit': take_profit,
                'quantity': quantity,
                'leverage': leverage,
                'confidence': confidence,
                'regime': decision.get('regime'),
                'position': decision.get('position'),
                'position_1h': decision.get('position_1h'),
                'oscillator_scores': osc_scores,
                'trend_scores': decision.get('trend_scores')
            }
            audit_decision.update(self._get_symbol_trade_stats(symbol))

            audit_result = await self.risk_audit.audit_decision(
                decision=audit_decision,
                current_position=current_position,
                account_balance=available_cash,
                current_price=current_price,
                atr_pct=decision.get('atr_pct')
            )

            if not audit_result.passed:
                log.warning(f"🛡️ RiskAudit BLOCKED: {audit_result.blocked_reason}")
                return {'action': 'hold', 'reason': audit_result.blocked_reason}

            if audit_result.corrections and 'stop_loss' in audit_result.corrections:
                stop_loss = audit_result.corrections['stop_loss']
                sl_pct = abs(current_price - stop_loss) / current_price * 100

            # 处理反向持仓 (Reversal)
            if has_position:
                current_side = self.portfolio.positions[symbol].side
                if current_side != side:
                    # 反向信号，先平仓
                    self.portfolio.close_position(
                        symbol=symbol,
                        price=current_price,
                        timestamp=timestamp,
                        reason='reverse_signal'
                    )
                    has_position = False # 标记为No position，以便下面执行Open position

            if quantity > 0:
                self.portfolio.open_position(
                    symbol=symbol,
                    side=side,
                    quantity=quantity,
                    price=current_price,
                    timestamp=timestamp,
                    stop_loss_pct=sl_pct,
                    take_profit_pct=tp_pct,
                    trailing_stop_pct=trailing_pct
                )

    def _get_symbol_trade_stats(self, symbol: str, max_trades: int = 5) -> Dict:
        """Build symbol-level and direction-level recent trade stats from backtest history."""
        if not self.portfolio:
            return {}

        trades = getattr(self.portfolio, 'trades', []) or []
        closed_for_symbol = []
        for trade in reversed(trades):
            if getattr(trade, 'symbol', None) != symbol:
                continue
            if getattr(trade, 'action', None) != 'close':
                continue
            closed_for_symbol.append(trade)

        def _calc_bucket_stats(bucket: List[Trade]) -> Dict[str, Optional[float]]:
            pnls = []
            for trade in bucket:
                try:
                    pnls.append(float(getattr(trade, 'pnl', 0.0)))
                except Exception:
                    continue

            loss_streak = 0
            for value in pnls:
                if value < 0:
                    loss_streak += 1
                else:
                    break

            recent = pnls[:max_trades]
            recent_count = len(recent)
            recent_pnl = float(sum(recent)) if recent else 0.0
            wins = sum(1 for value in recent if value > 0)
            win_rate = (wins / recent_count) if recent_count > 0 else None
            return {
                'loss_streak': loss_streak,
                'recent_pnl': recent_pnl,
                'recent_trades': recent_count,
                'win_rate': win_rate,
            }

        def _trade_side_value(trade: Trade) -> str:
            side = getattr(trade, 'side', None)
            if isinstance(side, Side):
                return side.value
            side_str = str(side or '').lower()
            if side_str.endswith('long'):
                return 'long'
            if side_str.endswith('short'):
                return 'short'
            return side_str

        all_stats = _calc_bucket_stats(closed_for_symbol)
        long_stats = _calc_bucket_stats(
            [trade for trade in closed_for_symbol if _trade_side_value(trade) == 'long']
        )
        short_stats = _calc_bucket_stats(
            [trade for trade in closed_for_symbol if _trade_side_value(trade) == 'short']
        )

        return {
            'symbol_loss_streak': all_stats['loss_streak'],
            'symbol_recent_pnl': all_stats['recent_pnl'],
            'symbol_recent_trades': all_stats['recent_trades'],
            'symbol_win_rate': all_stats['win_rate'],
            'symbol_long_loss_streak': long_stats['loss_streak'],
            'symbol_long_recent_pnl': long_stats['recent_pnl'],
            'symbol_long_recent_trades': long_stats['recent_trades'],
            'symbol_long_win_rate': long_stats['win_rate'],
            'symbol_short_loss_streak': short_stats['loss_streak'],
            'symbol_short_recent_pnl': short_stats['recent_pnl'],
            'symbol_short_recent_trades': short_stats['recent_trades'],
            'symbol_short_win_rate': short_stats['win_rate'],
        }
    
    async def _close_all_positions(self):
        """平仓所有持仓"""
        if self.portfolio is None:
            return
        
        for symbol in list(self.portfolio.positions.keys()):
            current_price = self.data_replay.get_current_price()
            self.portfolio.close_position(
                symbol=symbol,
                price=current_price,
                timestamp=self.current_timestamp,
                reason='backtest_end'
            )
    
    async def _default_strategy(
        self,
        snapshot,
        portfolio: BacktestPortfolio,
        current_price: float,
        config: BacktestConfig
    ) -> Dict:
        """
        优化后的默认策略（趋势跟踪 + 过滤器）
        
        信号: RSI超卖买入 + 趋势持有 (优化后收益 +1.57%)
        
        核心逻辑:
        1. RSI < 30 时买入 (极度超卖)
        2. EMA12 > EMA26 时持有 (趋势确认)
        3. RSI > 70 或 EMA死叉时卖出
        """
        # 获取稳定数据
        df = snapshot.stable_5m.copy()
        
        if len(df) < 50:
            return {'action': 'hold', 'confidence': 0.0, 'reason': 'insufficient_data'}
        
        # 计算指标
        close = df['close'].astype(float)
        
        # EMA
        ema_12 = close.ewm(span=12, adjust=False).mean()
        ema_26 = close.ewm(span=26, adjust=False).mean()
        ema_fast = ema_12.iloc[-1]
        ema_slow = ema_26.iloc[-1]
        ema_fast_prev = ema_12.iloc[-2]
        ema_slow_prev = ema_26.iloc[-2]
        
        # RSI (14周期)
        delta = close.diff()
        gain = delta.where(delta > 0, 0).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss.replace(0, 1e-10)
        rsi = 100 - (100 / (1 + rs))
        current_rsi = rsi.iloc[-1]
        
        # RVOL
        volume = df['volume'].astype(float)
        avg_volume = volume.rolling(window=20).mean().iloc[-1]
        current_volume = volume.iloc[-1]
        rvol = current_volume / avg_volume if avg_volume > 0 else 1.0
        
        # MACD for momentum confirmation
        ema_12_full = close.ewm(span=12, adjust=False).mean()
        ema_26_full = close.ewm(span=26, adjust=False).mean()
        macd_line = ema_12_full - ema_26_full
        signal_line = macd_line.ewm(span=9, adjust=False).mean()
        macd_hist = macd_line - signal_line
        current_macd_hist = macd_hist.iloc[-1]
        prev_macd_hist = macd_hist.iloc[-2]
        macd_momentum = current_macd_hist > prev_macd_hist  # 动量增加
        
        # 持仓State
        symbol = config.symbol
        has_position = symbol in portfolio.positions
        
        # 趋势State
        is_uptrend = ema_fast > ema_slow
        golden_cross = ema_fast > ema_slow and ema_fast_prev <= ema_slow_prev
        death_cross = ema_fast < ema_slow and ema_fast_prev >= ema_slow_prev
        
        # ========== 策略逻辑 ==========
        
        # 1️⃣ RSI 极度超卖买入信号 (优先级最高)
        if current_rsi < 25 and is_uptrend and not has_position:
            confidence = 85
            if current_macd_hist > 0:  # MACD确认
                confidence = 90
            if rvol > 1.5:
                confidence = min(confidence + 5, 95)
            return {'action': 'long', 'confidence': confidence, 'reason': f'rsi_extreme_oversold_{current_rsi:.0f}_macd{"+" if current_macd_hist>0 else "-"}'}
        
        # 2️⃣ RSI 超卖 + 金叉确认 + MACD动量
        if current_rsi < 35 and golden_cross and not has_position:
            confidence = 75
            if current_macd_hist > 0:
                confidence = 85
            return {'action': 'long', 'confidence': confidence, 'reason': f'rsi_oversold_{current_rsi:.0f}_golden_cross_macd{"+" if current_macd_hist>0 else "-"}'}
        
        # 3️⃣ 金叉信号 + RSI适中 + MACD确认
        if golden_cross and not has_position:
            if current_rsi > 70:
                return {'action': 'hold', 'confidence': 30, 'reason': f'golden_cross_but_overbought_{current_rsi:.0f}'}
            if current_macd_hist <= 0:
                return {'action': 'hold', 'confidence': 40, 'reason': 'golden_cross_but_macd_negative'}
            confidence = 70 if current_rsi <= 50 else 60
            return {'action': 'long', 'confidence': confidence, 'reason': f'golden_cross_rsi{current_rsi:.0f}_macd+'}
        
        # 4️⃣ 持仓管理 (优化出场 + 持仓保护)
        if has_position:
            current_side = portfolio.positions[symbol].side
            current_price = close.iloc[-1]
            position = portfolio.positions[symbol]
            entry_price = position.entry_price
            unrealized_pnl_pct = (current_price / entry_price - 1) * 100 if current_side == Side.LONG else (entry_price / current_price - 1) * 100
            
            if current_side == Side.LONG:
                # 🎯 止盈条件1: RSI超买 + MACD动量减弱
                if current_rsi > 70 and not macd_momentum:
                    return {'action': 'close', 'confidence': 75, 'reason': f'take_profit_rsi_{current_rsi:.0f}_macd_weakening'}
                # 🎯 止盈条件2: RSI极度超买
                if current_rsi > 80:
                    return {'action': 'close', 'confidence': 80, 'reason': f'take_profit_rsi_extreme_{current_rsi:.0f}'}
                
                # 🛡️ 持仓保护: 死叉需要额外确认才退出
                if death_cross:
                    # 盈利中 + RSI仍健康 → 不退出，可能只是回调
                    if unrealized_pnl_pct > 0.3 and current_rsi > 40:
                        return {'action': 'hold', 'confidence': 55, 'reason': f'death_cross_but_profitable_{unrealized_pnl_pct:.1f}%_rsi{current_rsi:.0f}'}
                    # MACD柱线仍为正 → 趋势仍在
                    if current_macd_hist > 0:
                        return {'action': 'hold', 'confidence': 50, 'reason': 'death_cross_but_macd_still_positive'}
                    # RSI超卖区不退出 → 可能反弹
                    if current_rsi < 35:
                        return {'action': 'hold', 'confidence': 50, 'reason': f'death_cross_but_rsi_oversold_{current_rsi:.0f}'}
                    # 确认退出
                    return {'action': 'close', 'confidence': 70, 'reason': 'death_cross_confirmed_exit'}
                
                # 趋势持有
                return {'action': 'hold', 'confidence': 60, 'reason': f'holding_pnl{unrealized_pnl_pct:+.1f}%_rsi{current_rsi:.0f}'}
            
            elif current_side == Side.SHORT:
                if current_rsi < 25:
                    return {'action': 'close', 'confidence': 75, 'reason': f'take_profit_short_rsi_{current_rsi:.0f}'}
                if golden_cross:
                    return {'action': 'close', 'confidence': 70, 'reason': 'golden_cross_exit_short'}
        
        # 5️⃣ 死叉做空 (需要MACD确认)
        if death_cross and not has_position:
            if current_rsi < 30:
                return {'action': 'hold', 'confidence': 30, 'reason': f'death_cross_but_oversold_{current_rsi:.0f}'}
            if current_macd_hist >= 0:
                return {'action': 'hold', 'confidence': 40, 'reason': 'death_cross_but_macd_positive'}
            confidence = 70 if current_rsi > 60 else 60
            return {'action': 'short', 'confidence': confidence, 'reason': f'death_cross_rsi{current_rsi:.0f}_macd-'}
        
        return {'action': 'hold', 'confidence': 30, 'reason': 'no_signal'}
    
    def stop(self):
        """停止回测"""
        self.is_running = False
    
    def generate_report(self, result: BacktestResult, filename: str = None) -> str:
        """
        生成回测报告
        
        Args:
            result: Backtest Result
            filename: 文件名
            
        Returns:
            报告文件路径
        """
        report = BacktestReport()
        
        config_dict = {
            'symbol': self.config.symbol,
            'initial_capital': self.config.initial_capital,
            'start_date': self.config.start_date,
            'end_date': self.config.end_date,
        }
        
        trades_df = self.portfolio.get_trades_dataframe() if self.portfolio else pd.DataFrame()
        
        filepath = report.generate(
            metrics=result.metrics,
            equity_curve=result.equity_curve,
            trades_df=trades_df,
            config=config_dict,
            filename=filename
        )
        
        log.info(f"📄 Report saved to: {filepath}")
        return filepath


# CLI 入口支持
async def run_backtest_cli(
    symbol: str = "BTCUSDT",
    start_date: str = "2024-01-01",
    end_date: str = "2024-12-01",
    initial_capital: float = 10000,
    step: int = 3
) -> BacktestResult:
    """
    CLI 运行回测
    
    Args:
        symbol: Trading pair
        start_date: 开始日期
        end_date: 结束日期
        initial_capital: 初始Capital
        step: 时间步长
        
    Returns:
        BacktestResult
    """
    config = BacktestConfig(
        symbol=symbol,
        start_date=start_date,
        end_date=end_date,
        initial_capital=initial_capital,
        step=step
    )
    
    engine = BacktestEngine(config)
    
    def progress(data: dict):
        current = data.get('current_timepoint', 0)
        total = data.get('total_timepoints', 0)
        pct = data.get('progress', 0)
        print(f"\rProgress: {current}/{total} ({pct:.1f}%)", end="", flush=True)
    
    result = await engine.run(progress_callback=progress)
    print()  # 换行
    
    # Generate report
    report_path = engine.generate_report(result)
    print(f"\n📄 Report: {report_path}")
    
    return result


# 测试函数
async def test_backtest_engine():
    """测试回测引擎"""
    print("\n" + "=" * 60)
    print("🧪 Testing BacktestEngine")
    print("=" * 60)
    
    config = BacktestConfig(
        symbol="BTCUSDT",
        start_date="2024-12-01",
        end_date="2024-12-07",
        initial_capital=10000,
        step=12  # 每小时一个决策点
    )
    
    engine = BacktestEngine(config)
    
    def progress(data: dict):
        current = data.get('current_timepoint', 0)
        total = data.get('total_timepoints', 0)
        pct = data.get('progress', 0)
        if total and (current % 10 == 0 or current == total):
            print(f"   Progress: {pct:.1f}%")
    
    result = await engine.run(progress_callback=progress)
    
    print(f"\n📊 Results:")
    print(f"   Total Return: {result.metrics.total_return:+.2f}%")
    print(f"   Max Drawdown: {result.metrics.max_drawdown_pct:.2f}%")
    print(f"   Sharpe Ratio: {result.metrics.sharpe_ratio:.2f}")
    print(f"   Total Trades: {result.metrics.total_trades}")
    
    # Generate report
    report_path = engine.generate_report(result, "test_backtest")
    print(f"\n📄 Report: {report_path}")
    
    print("\n✅ BacktestEngine test complete!")
    return result


if __name__ == "__main__":
    asyncio.run(test_backtest_engine())
