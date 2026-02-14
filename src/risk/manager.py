"""
风险管理模块
"""
from typing import Dict, Optional, List, Any, Tuple
from datetime import datetime, timedelta
from src.config import config
from src.utils.logger import log
from src.utils.action_protocol import (
    normalize_action,
    is_open_action,
    VALID_ACTIONS,
    OPEN_ACTIONS,
)


class RiskManager:
    """风险管理器 - 硬编码风控规则"""
    
    def __init__(self):
        self.max_risk_per_trade_pct = config.risk.get('max_risk_per_trade_pct', 1.5)
        self.max_total_position_pct = config.risk.get('max_total_position_pct', 30.0)
        self.max_leverage = config.risk.get('max_leverage', 5)
        self.max_consecutive_losses = config.risk.get('max_consecutive_losses', 3)
        self.stop_trading_drawdown_pct = config.risk.get('stop_trading_on_drawdown_pct', 10.0)
        
        # 交易历史记录（用于计算连续亏损）
        self.trade_history: List[Dict] = []
        self.consecutive_losses = 0
        self.total_drawdown_pct = 0
        
        log.info("Risk Manager initialized")
    
    def validate_format(self, decision: Dict, raw_response: str = "") -> Tuple[bool, str]:
        """
        验证 DeepSeek 输出格式
        
        Args:
            decision: 解析后的决策字典
            raw_response: 原始 LLM 响应文本（可选，用于检查标签）
            
        Returns:
            (is_valid, error_message)
        """
        action = normalize_action(
            decision.get('action', ''),
            position_side=decision.get('position_side')
        )
        decision['action'] = action
        
        # 1. 检查必需字段
        required_fields = ['symbol', 'action', 'reasoning']
        for field in required_fields:
            if field not in decision or not decision[field]:
                return False, f"格式错误: 缺少必需字段 '{field}'"
        
        # 2. 检查 reasoning 长度（应该简洁）
        reasoning = decision.get('reasoning', '')
        if len(reasoning.split()) > 50:
            return False, f"格式错误: reasoning 过长 ({len(reasoning.split())} 词 > 50 词)"
        
        # 3. 检查 action 类型
        if action not in VALID_ACTIONS:
            return False, f"格式错误: 无效的 action '{action}'"
        
        # 4. 检查开仓动作的必需字段
        if action in OPEN_ACTIONS:
            open_required = ['leverage', 'position_size_usd', 'stop_loss', 'take_profit']
            for field in open_required:
                if field not in decision:
                    return False, f"格式错误: {action} 缺少必需字段 '{field}'"
                
                # 检查是否为数字类型
                value = decision[field]
                if not isinstance(value, (int, float)):
                    return False, f"格式错误: '{field}' 必须是纯数字，不能是字符串或公式 (当前值: {value})"
                
                # 检查是否包含非法字符（如果是从字符串转换来的）
                value_str = str(value)
                if '~' in value_str:
                    return False, f"格式错误: '{field}' 包含范围符号 '~' (值: {value})"
                if ',' in value_str and value_str.replace(',', '').replace('.', '').isdigit():
                    return False, f"格式错误: '{field}' 包含千位分隔符 ',' (值: {value})"
                if any(op in value_str for op in ['*', '/', '+', '-']) and not value_str.replace('.', '').replace('-', '').isdigit():
                    return False, f"格式错误: '{field}' 包含运算符，必须是计算后的纯数字 (值: {value})"
            
            # 5. 检查杠杆范围
            leverage = decision.get('leverage')
            if not (1 <= leverage <= 5):
                return False, f"格式错误: leverage 必须在 1-5 之间 (当前值: {leverage})"
            
            # 6. 检查止损方向
            entry_price = decision.get('current_price') or decision.get('entry_price', 0)
            stop_loss = decision.get('stop_loss')
            take_profit = decision.get('take_profit')
            
            if entry_price and stop_loss and take_profit:
                if action == 'open_long':
                    if stop_loss >= entry_price:
                        return False, f"格式错误: 做多止损必须 < 入场价 (SL:{stop_loss} >= Entry:{entry_price})"
                    if take_profit <= entry_price:
                        return False, f"格式错误: 做多止盈必须 > 入场价 (TP:{take_profit} <= Entry:{entry_price})"
                elif action == 'open_short':
                    if stop_loss <= entry_price:
                        return False, f"格式错误: 做空止损必须 > 入场价 (SL:{stop_loss} <= Entry:{entry_price})"
                    if take_profit >= entry_price:
                        return False, f"格式错误: 做空止盈必须 < 入场价 (TP:{take_profit} >= Entry:{entry_price})"
                
                # 7. 检查风险回报比
                risk = abs(entry_price - stop_loss)
                reward = abs(take_profit - entry_price)
                if risk > 0:
                    rr_ratio = reward / risk
                    if rr_ratio < 2.0:
                        return False, f"格式错误: 风险回报比不足 (R:R = {rr_ratio:.2f} < 2.0)"
        
        # 8. 检查原始响应格式（如果提供）
        if raw_response:
            if '<reasoning>' not in raw_response or '</reasoning>' not in raw_response:
                return False, "格式错误: 缺少 <reasoning> 标签"
            if '<decision>' not in raw_response or '</decision>' not in raw_response:
                return False, "格式错误: 缺少 <decision> 标签"
            if '```json' not in raw_response:
                return False, "格式错误: JSON 必须包裹在 ```json 代码块中"
            
            # 检查 JSON 数组格式
            import re
            json_match = re.search(r'```json\s*(\[.*?\])\s*```', raw_response, re.DOTALL)
            if json_match:
                json_str = json_match.group(1).strip()
                if not json_str.startswith('[{'):
                    return False, f"格式错误: JSON 必须是数组格式，以 '[{{' 开头 (当前: {json_str[:10]}...)"
        
        return True, "格式验证通过"
    
    def validate_decision(
        self, 
        decision: Dict, 
        account_info: Dict, 
        position_info: Optional[Dict],
        market_snapshot: Any
    ) -> Tuple[bool, Dict, str]:
        """
        验证并修正决策 (增强风控审计 - 70% 过滤逻辑)
        
        Args:
            decision: 原始决策 (可能包含 regime 和 position 信息)
            account_info: 账户信息
            position_info: 当前持仓
            market_snapshot: 市场快照
            
        Returns:
            (is_valid, modified_decision, reason)
        """
        modified_decision = decision.copy()
        
        # 0. 格式验证 (最优先检查)
        format_valid, format_error = self.validate_format(decision)
        if not format_valid:
            log.error(f"格式验证失败: {format_error}")
            return False, decision, format_error
        
        # 1. 持仓数量限制检查 (最多3个同时持仓)
        position_side = decision.get('position_side')
        if not position_side and position_info and position_info.get('position_amt') is not None:
            try:
                amt = float(position_info.get('position_amt', 0))
                if amt > 0:
                    position_side = 'long'
                elif amt < 0:
                    position_side = 'short'
            except Exception:
                position_side = None
        action = normalize_action(decision.get('action'), position_side=position_side)
        decision['action'] = action
        modified_decision['action'] = action

        # 非开仓动作直接放行（关闭/观望不应套用开仓字段与资金门槛）
        if not is_open_action(action):
            log.info(f"风控验证通过（非开仓动作）: {action}")
            return True, modified_decision, "通过"

        if is_open_action(action):
            # 检查本周期是否已经开过仓
            try:
                from src.server.state import global_state
                if global_state.cycle_positions_opened >= 1:
                    log.warning(f"本周期已开仓 {global_state.cycle_positions_opened} 次，拒绝新开仓")
                    return False, decision, f"风控拦截: 本周期已开仓 ({global_state.cycle_positions_opened}/1)，每周期最多开一个新仓位"
            except Exception as e:
                log.warning(f"无法检查周期开仓计数: {e}")
            
            # 获取当前所有持仓数量
            try:
                from src.server.state import global_state
                
                # 测试模式: 使用虚拟持仓
                if global_state.is_test_mode:
                    position_count = len(global_state.virtual_positions)
                    if position_count >= 3:
                        log.warning(f"虚拟持仓数量已达上限: {position_count}/3，拒绝新开仓")
                        return False, decision, f"风控拦截: 持仓数量已达上限 ({position_count}/3)，禁止新开仓"
                # 实盘模式: 使用真实账户信息
                elif account_info and 'positions' in account_info:
                    active_positions = [p for p in account_info['positions'] if abs(float(p.get('positionAmt', 0))) > 0]
                    position_count = len(active_positions)
                    
                    if position_count >= 3:
                        log.warning(f"持仓数量已达上限: {position_count}/3，拒绝新开仓")
                        return False, decision, f"风控拦截: 持仓数量已达上限 ({position_count}/3)，禁止新开仓"
            except Exception as e:
                log.warning(f"无法检查持仓数量: {e}")
        
        # 2. 提取对抗式数据
        regime = decision.get('regime')
        position = decision.get('position')
        confidence = decision.get('confidence', 0)
        if isinstance(confidence, (int, float)) and 0 < confidence <= 1:
            confidence *= 100
        
        # 2. 市场状态检查 (一票否决)
        if regime:
            r_type = regime.get('regime')
            if r_type == 'unknown':
                return False, decision, "风控拦截: 市场状态不明确，禁止交易"
            if r_type == 'volatile':
                return False, decision, f"风控拦截: 市场高波动(ATR {regime.get('atr_pct', 0):.2f}%)，风险过大"
            if r_type == 'choppy' and confidence < 80:
                # 震荡市需要极高信心才开仓
                if is_open_action(action):
                    return False, decision, f"风控拦截: 震荡市且信心不足({confidence:.1f} < 80)，禁止开仓"
        
        # 3. 逆势交易检查 (Contra-Trend Check)
        # 检查是否逆 1h 趋势交易
        if market_snapshot and is_open_action(action):
            # 从 market_snapshot 获取 1h 趋势信息
            stable_1h = market_snapshot.get('stable_1h')
            if stable_1h is not None and not stable_1h.empty and len(stable_1h) > 13:
                # Fast Trend: 使用 EMA5/EMA13 加快响应 (2025-12-23 update)
                if 'ema_5' in stable_1h.columns and 'ema_13' in stable_1h.columns:
                    ema5 = stable_1h['ema_5'].iloc[-1]
                    ema13 = stable_1h['ema_13'].iloc[-1]
                    
                    # 判断 1h 趋势
                    trend_1h = 'up' if ema5 > ema13 else 'down'
                    
                    # 检查是否逆势
                    if trend_1h == 'down' and action == 'open_long':
                        return False, decision, f"风控拦截: 1h 下跌趋势中禁止做多 (EMA5:{ema5:.2f} < EMA13:{ema13:.2f})"
                    elif trend_1h == 'up' and action == 'open_short':
                        return False, decision, f"风控拦截: 1h 上涨趋势中禁止做空 (EMA5:{ema5:.2f} > EMA13:{ema13:.2f})"

        # 4. 位置检查 (位置感应过滤)
        if position:
            pos_pct = position.get('position_pct', 50)
            location = position.get('location')
            
            # 检查是否为趋势整理 (Trend Consolidation)
            is_trend_consolidation = False
            if regime and market_snapshot:
                r_type = regime.get('regime')
                stable_1h = market_snapshot.get('stable_1h')
                
                # 如果是 CHOPPY 且 1h 有明确趋势，则为趋势整理
                if r_type == 'choppy' and stable_1h is not None and not stable_1h.empty and len(stable_1h) > 13:
                    if 'ema_5' in stable_1h.columns and 'ema_13' in stable_1h.columns:
                        ema5 = stable_1h['ema_5'].iloc[-1]
                        ema13 = stable_1h['ema_13'].iloc[-1]
                        ema_diff_pct = abs(ema5 - ema13) / ema13 * 100
                        
                        # 如果 EMA 差异 > 1%，认为趋势明确
                        if ema_diff_pct > 1.0:
                            is_trend_consolidation = True
                            log.info(f"检测到趋势整理: CHOPPY + 1h趋势明确 (EMA差异: {ema_diff_pct:.2f}%)")
            
            # 禁止在区间中部开仓 (除非是趋势整理)
            if location == 'middle' or 40 <= pos_pct <= 60:
                if is_open_action(action):
                    if not is_trend_consolidation:
                        return False, decision, f"风控拦截: 价格处于区间中部({pos_pct:.1f}%)，盈亏比极差，禁止开仓"
                    else:
                        log.info(f"趋势整理模式: 允许中部位置({pos_pct:.1f}%)开仓")
            
            # 做多位置检查
            if action == 'open_long' and pos_pct > 70:
                return False, decision, f"风控拦截: 做多位置过高({pos_pct:.1f}%)，接近阻力位"
            
            # 做空位置检查
            if action == 'open_short' and pos_pct < 30:
                return False, decision, f"风控拦截: 做空位置过低({pos_pct:.1f}%)，接近支撑位"

        # 3. 信心阈值检查
        MIN_CONF_TO_OPEN = 70.0 # 提升开仓门槛
        if is_open_action(action):
            if confidence < MIN_CONF_TO_OPEN:
                return False, decision, f"风控拦截: 综合信心度不足({confidence:.1f} < {MIN_CONF_TO_OPEN})"

        # 4. R/R 风险回报比检查 (硬约束)
        # 如果是开仓动作，且包含价格信息，则计算 R/R
        if is_open_action(action):
            curr_price = decision.get('current_price') or decision.get('entry_price')
            sl_price = decision.get('stop_loss_price') or decision.get('stop_loss')
            tp_price = decision.get('take_profit_price') or decision.get('take_profit')
            
            if curr_price and sl_price and tp_price:
                risk = abs(curr_price - sl_price)
                reward = abs(tp_price - curr_price)
                if risk > 0:
                    rr_ratio = reward / risk
                    if rr_ratio < 1.5: # 至少 1.5 倍
                        return False, decision, f"风控拦截: 风险回报比不足({rr_ratio:.2f} < 1.5)"

        # 5. 基础账户风险检查
        balance = account_info.get('total_wallet_balance', 0)
        
        # 1. 检查连续亏损
        if self.consecutive_losses >= self.max_consecutive_losses:
            if is_open_action(action):
                log.warning(f"连续亏损{self.consecutive_losses}次，拒绝新仓位")
                return False, modified_decision, "连续亏损过多，暂停交易"
        
        # 2. 检查回撤
        if self.total_drawdown_pct >= self.stop_trading_drawdown_pct:
            if is_open_action(action):
                log.warning(f"账户回撤{self.total_drawdown_pct:.2f}%，拒绝新仓位")
                return False, modified_decision, "回撤过大，暂停交易"
        
        # 3. 检查资金费率极端情况
        funding_rate = market_snapshot.get('funding', {}).get('funding_rate', 0)
        if abs(funding_rate) > 0.001:  # 极端资金费率
            if is_open_action(action):
                # 极端正费率不开多，极端负费率不开空
                if funding_rate > 0.001 and action == 'open_long':
                    log.warning("资金费率过高，拒绝开多")
                    return False, modified_decision, "资金费率极端，不适合开多"
                elif funding_rate < -0.001 and action == 'open_short':
                    log.warning("资金费率过低，拒绝开空")
                    return False, modified_decision, "资金费率极端，不适合开空"
        
        leverage = modified_decision.get('leverage')
        if not isinstance(leverage, (int, float)) or leverage <= 0:
            return False, modified_decision, "缺少有效 leverage"
        leverage = float(leverage)
        modified_decision['leverage'] = leverage

        position_size_pct = modified_decision.get('position_size_pct')
        if not isinstance(position_size_pct, (int, float)):
            # 兼容仅给出 position_size_usd 的场景
            available_balance_hint = float(account_info.get('available_balance', 0) or 0)
            position_size_usd = modified_decision.get('position_size_usd')
            if isinstance(position_size_usd, (int, float)) and available_balance_hint > 0:
                position_size_pct = float(position_size_usd) / available_balance_hint * 100
            else:
                return False, modified_decision, "缺少有效 position_size_pct"
        position_size_pct = float(position_size_pct)
        modified_decision['position_size_pct'] = position_size_pct

        stop_loss_pct = modified_decision.get('stop_loss_pct')
        if not isinstance(stop_loss_pct, (int, float)):
            curr_price = modified_decision.get('current_price') or modified_decision.get('entry_price')
            stop_loss = modified_decision.get('stop_loss')
            if isinstance(curr_price, (int, float)) and curr_price > 0 and isinstance(stop_loss, (int, float)):
                stop_loss_pct = abs((float(curr_price) - float(stop_loss)) / float(curr_price) * 100)
            else:
                return False, modified_decision, "缺少有效 stop_loss_pct"
        stop_loss_pct = float(stop_loss_pct)
        modified_decision['stop_loss_pct'] = stop_loss_pct

        # 4. 检查杠杆
        if leverage > self.max_leverage:
            log.warning(f"杠杆{leverage}超过最大值{self.max_leverage}，已修正")
            modified_decision['leverage'] = self.max_leverage
            leverage = float(self.max_leverage)
        
        # 5. 检查仓位大小
        if position_size_pct > self.max_total_position_pct:
            log.warning(
                f"仓位{position_size_pct:.1f}%超过最大值{self.max_total_position_pct}%，已修正"
            )
            modified_decision['position_size_pct'] = self.max_total_position_pct
            position_size_pct = float(self.max_total_position_pct)
        
        # 6. 计算实际风险
        available_balance = account_info.get('available_balance', 0)
        if available_balance <= 0:
            return False, modified_decision, "账户余额不足"
        
        # 计算开仓金额
        position_value = available_balance * (position_size_pct / 100)
        
        # 计算止损风险
        risk_amount = position_value * leverage * (stop_loss_pct / 100)
        risk_pct = (risk_amount / available_balance) * 100
        
        # 7. 检查单笔风险
        if risk_pct > self.max_risk_per_trade_pct:
            # 修正仓位大小
            max_position_value = (
                available_balance * self.max_risk_per_trade_pct / 100
            ) / (leverage * stop_loss_pct / 100)
            
            corrected_position_pct = (max_position_value / available_balance) * 100
            
            log.warning(
                f"风险{risk_pct:.2f}%超过最大值{self.max_risk_per_trade_pct}%，"
                f"仓位从{modified_decision['position_size_pct']:.1f}%修正为{corrected_position_pct:.1f}%"
            )
            
            modified_decision['position_size_pct'] = corrected_position_pct
        
        # 8. 检查是否有足够资金
        final_position_value = available_balance * (modified_decision['position_size_pct'] / 100)
        required_margin = final_position_value / leverage
        
        if required_margin > available_balance:
            log.warning("保证金不足，降低仓位")
            modified_decision['position_size_pct'] = (
                available_balance * modified_decision['leverage'] / available_balance
            ) * 100 * 0.95  # 留5%缓冲
        
        # 9. 检查流动性
        liquidity = market_snapshot.get('market_overview', {}).get('liquidity', 'unknown')
        if liquidity == 'low' and is_open_action(action):
            log.warning("流动性不足，建议观望")
            # 不强制拒绝，但记录警告
        
        # 10. 检查持仓冲突
        if position_info and position_info.get('position_amt', 0) != 0:
            current_side = 'LONG' if position_info['position_amt'] > 0 else 'SHORT'
            
            # 不允许同时做多做空
            if current_side == 'LONG' and action == 'open_short':
                log.warning("当前持有多仓，不允许开空仓")
                return False, modified_decision, "持仓冲突"
            elif current_side == 'SHORT' and action == 'open_long':
                log.warning("当前持有空仓，不允许开多仓")
                return False, modified_decision, "持仓冲突"
        
        log.info("风控验证通过")
        return True, modified_decision, "通过"
    
    def calculate_position_size(
        self,
        account_balance: float,
        position_pct: float,
        leverage: int,
        current_price: float
    ) -> float:
        """
        计算实际开仓数量
        
        Args:
            account_balance: 账户余额
            position_pct: 仓位百分比
            leverage: 杠杆
            current_price: 当前价格
            
        Returns:
            开仓数量（已舍入到合适精度）
        """
        position_value = account_balance * (position_pct / 100)
        position_value_with_leverage = position_value * leverage
        quantity = position_value_with_leverage / current_price
        
        # 舍入到3位小数（BTC合约的标准精度）
        # 确保不小于最小交易量0.001
        quantity = max(round(quantity, 3), 0.001)
        
        log.info(f"计算仓位: 余额=${account_balance:.2f}, 仓位={position_pct}%, 杠杆={leverage}x, 价格=${current_price:.2f} -> 数量={quantity}")
        
        return quantity
    
    def calculate_stop_loss_price(
        self,
        entry_price: float,
        stop_loss_pct: float,
        side: str
    ) -> float:
        """
        计算止损价格
        
        Args:
            entry_price: 入场价
            stop_loss_pct: 止损百分比
            side: LONG or SHORT
            
        Returns:
            止损价格（四舍五入到2位小数，符合BTCUSDT精度要求）
        """
        if side == 'LONG':
            price = entry_price * (1 - stop_loss_pct / 100)
        else:  # SHORT
            price = entry_price * (1 + stop_loss_pct / 100)
        
        # 四舍五入到2位小数（BTCUSDT的价格精度）
        return round(price, 2)
    
    def calculate_take_profit_price(
        self,
        entry_price: float,
        take_profit_pct: float,
        side: str
    ) -> float:
        """
        计算止盈价格（四舍五入到2位小数，符合BTCUSDT精度要求）
        """
        if side == 'LONG':
            price = entry_price * (1 + take_profit_pct / 100)
        else:  # SHORT
            price = entry_price * (1 - take_profit_pct / 100)
        
        # 四舍五入到2位小数（BTCUSDT的价格精度）
        return round(price, 2)
    
    def record_trade(self, trade: Dict):
        """记录交易结果"""
        self.trade_history.append(trade)
        
        # 更新连续亏损计数
        if trade.get('pnl', 0) < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0
        
        log.info(f"交易记录: PnL={trade.get('pnl', 0):.2f}, 连续亏损={self.consecutive_losses}")
    
    def update_drawdown(self, current_balance: float, peak_balance: float):
        """更新回撤"""
        if peak_balance > 0:
            self.total_drawdown_pct = ((peak_balance - current_balance) / peak_balance) * 100
        
        if self.total_drawdown_pct > 0:
            log.warning(f"当前回撤: {self.total_drawdown_pct:.2f}%")
    
    def get_risk_status(self) -> Dict:
        """获取风险状态"""
        return {
            'consecutive_losses': self.consecutive_losses,
            'total_drawdown_pct': self.total_drawdown_pct,
            'can_trade': (
                self.consecutive_losses < self.max_consecutive_losses and
                self.total_drawdown_pct < self.stop_trading_drawdown_pct
            ),
            'total_trades': len(self.trade_history)
        }
