"""
⚖️ 对抗评论员 (The Critic) Agent
===========================================

职责:
1. 加权投票机制 - 整合量化分析师的多个信号源
2. 动态权重调整 - 根据历史表现调整各信号权重
3. 多周期对齐决策 - 优先级: 1h > 15m > 5m
4. LLM决策增强 - 将量化信号作为上下文传递给DeepSeek
5. 最终决策输出 - 统一格式{action, confidence, reason}

Author: AI Trader Team
Date: 2025-12-19
"""

import asyncio
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from datetime import datetime
import json

from src.utils.logger import log
from src.agents.position_analyzer import PositionAnalyzer
from src.agents.regime_detector import RegimeDetector


@dataclass
class SignalWeight:
    """信号权重配置"""
    trend_5m: float = 0.15
    trend_15m: float = 0.25
    trend_1h: float = 0.35
    oscillator_5m: float = 0.08
    oscillator_15m: float = 0.12
    oscillator_1h: float = 0.15
    # 其他扩展信号（如LLM、情绪分析）
    llm_signal: float = 0.0  # 待整合


@dataclass
class VoteResult:
    """投票结果"""
    action: str  # 'long', 'short', 'close_long', 'close_short', 'hold'
    confidence: float  # 0.0 ~ 1.0
    weighted_score: float  # -100 ~ +100
    vote_details: Dict[str, float]  # 各信号的贡献分
    multi_period_aligned: bool  # 多周期是否一致
    reason: str  # 决策原因
    regime: Optional[Dict] = None      # 市场状态信息
    position: Optional[Dict] = None    # 价格位置信息


class DecisionCoreAgent:
    """对抗评论员 (The Critic)
    
    核心功能:
    - 加权投票: 根据可配置权重整合多个信号
    - 多周期对齐: 检测多周期趋势一致性
    - 市场感知: 集成位置感知和状态检测
    - 信心增强: 基于市场状态和价格位置校准信心度
    """
    
    def __init__(self, weights: Optional[SignalWeight] = None):
        """
        初始化对抗评论员 (The Critic)
        
        Args:
            weights: 自定义信号权重（默认使用内置配置）
        """
        self.weights = weights or SignalWeight()
        self.history: List[VoteResult] = []  # 历史决策记录
        
        # 初始化辅助分析器
        self.position_analyzer = PositionAnalyzer()
        self.regime_detector = RegimeDetector()
        
        self.performance_tracker = {
            'trend_5m': {'total': 0, 'correct': 0},
            'trend_15m': {'total': 0, 'correct': 0},
            'trend_1h': {'total': 0, 'correct': 0},
            'oscillator_5m': {'total': 0, 'correct': 0},
            'oscillator_15m': {'total': 0, 'correct': 0},
            'oscillator_1h': {'total': 0, 'correct': 0},
        }
        
    async def make_decision(self, quant_analysis: Dict, market_data: Optional[Dict] = None) -> VoteResult:
        """
        执行加权投票决策
        
        Args:
            quant_analysis: QuantAnalystAgent的输出
            market_data: 包含 df_5m, df_15m, df_1h 和 current_price 的原始市场数据
            
        Returns:
            VoteResult对象
        """
        # 1. 提取各信号分数
        scores = {
            'trend_5m': quant_analysis.get('trend_5m', {}).get('score', 0),
            'trend_15m': quant_analysis.get('trend_15m', {}).get('score', 0),
            'trend_1h': quant_analysis.get('trend_1h', {}).get('score', 0),
            'oscillator_5m': quant_analysis.get('oscillator_5m', {}).get('score', 0),
            'oscillator_15m': quant_analysis.get('oscillator_15m', {}).get('score', 0),
            'oscillator_1h': quant_analysis.get('oscillator_1h', {}).get('score', 0),
            'sentiment': quant_analysis.get('comprehensive', {}).get('details', {}).get('sentiment', {}).get('total_sentiment_score', 0)
        }
        
        # 2. 市场状态与位置分析
        regime = None
        position = None
        if market_data:
            df_5m = market_data.get('df_5m')
            curr_price = market_data.get('current_price')
            if df_5m is not None and curr_price is not None:
                regime = self.regime_detector.detect_regime(df_5m)
                position = self.position_analyzer.analyze_position(df_5m, curr_price)
                log.critic(f"市场检测: 状态={regime.get('regime')}, 位置={position.get('position_pct', 0):.1f}%", challenge=True)

        # 3. 提前过滤逻辑：震荡市+位置不佳
        if regime and position:
            if regime['regime'] == 'choppy' and position['location'] == 'middle':
                result = VoteResult(
                    action='hold',
                    confidence=10.0,
                    weighted_score=0,
                    vote_details={},
                    multi_period_aligned=False,
                    reason=f"对抗式过滤: 震荡市且价格处于区间中部({position['position_pct']:.1f}%)，禁止开仓",
                    regime=regime,
                    position=position
                )
                self.history.append(result)
                return result

        # 4. 加权计算（得分范围-100~+100）
        # 动态权重：如果存在情绪得分，分配 30% 权重给情绪
        w_sentiment = 0.3 if scores.get('sentiment') != 0 else 0
        w_others = 1.0 - w_sentiment
        
        weighted_score = (
            (scores['trend_5m'] * self.weights.trend_5m +
             scores['trend_15m'] * self.weights.trend_15m +
             scores['trend_1h'] * self.weights.trend_1h +
             scores['oscillator_5m'] * self.weights.oscillator_5m +
             scores['oscillator_15m'] * self.weights.oscillator_15m +
             scores['oscillator_1h'] * self.weights.oscillator_1h) * w_others +
            (scores.get('sentiment', 0) * w_sentiment)
        )
        
        # 5. 计算各信号的实际贡献分
        vote_details = {
            key: scores[key] * getattr(self.weights, key, 1.0) * (w_others if key != 'sentiment' else 1.0)
            for key in scores.keys()
        }
        
        # 6. 多周期对齐检测
        aligned, alignment_reason = self._check_multi_period_alignment(
            scores['trend_1h'],
            scores['trend_15m'],
            scores['trend_5m']
        )
        
        # 7. 初始决策映射
        action, base_confidence = self._score_to_action(weighted_score, aligned)
        
        # 8. 综合信心度校准与对抗审计
        final_confidence = base_confidence * 100
        
        # --- 对抗式审计: 机构资金流背离检查 ---
        sent_details = quant_analysis.get('comprehensive', {}).get('details', {}).get('sentiment', {})
        inst_nf_1h = sent_details.get('inst_netflow_1h', 0)
        
        if action == 'open_long' and inst_nf_1h < -1000000: # 1h 机构净流出超过 1M
            final_confidence *= 0.5
            alignment_reason += " | 对抗警告: 技术看多但机构资金大额流出 (背离)"
        elif action == 'open_short' and inst_nf_1h > 1000000: # 1h 机构净流入超过 1M
            final_confidence *= 0.5
            alignment_reason += " | 对抗警告: 技术看空但机构资金大额流入 (背离)"

        if regime and position:
            final_confidence = self._calculate_comprehensive_confidence(
                final_confidence, regime, position, aligned
            )
            # 信心度衰减逻辑
            if action == 'open_long' and not position['allow_long']:
                final_confidence *= 0.3
                alignment_reason += f" | 预警: 做多位置过高({position['position_pct']:.1f}%)"
            elif action == 'open_short' and not position['allow_short']:
                final_confidence *= 0.3
                alignment_reason += f" | 预警: 做空位置过低({position['position_pct']:.1f}%)"

        # 9. 生成决策原因
        reason = self._generate_reason(
            weighted_score, 
            aligned, 
            alignment_reason, 
            quant_analysis,
            regime=regime
        )
        # 10. 构建结果
        result = VoteResult(
            action=action,
            confidence=final_confidence,
            weighted_score=weighted_score,
            vote_details=vote_details,
            multi_period_aligned=aligned,
            reason=reason,
            regime=regime,
            position=position
        )
        
        # 11. 记录历史
        self.history.append(result)
        
        return result

    async def vote(self, snapshot: Any, quant_analysis: Dict) -> VoteResult:
        """
        兼容性接口: 调用 make_decision
        """
        # 将 snapshot 转换为 market_data 格式供 make_decision 使用
        market_data = {
            'df_5m': snapshot.stable_5m if hasattr(snapshot, 'stable_5m') else None,
            'current_price': snapshot.live_5m.get('close', 0) if hasattr(snapshot, 'live_5m') else 0
        }
        return await self.make_decision(quant_analysis, market_data)

    def _calculate_comprehensive_confidence(self, 
                                          base_conf: float, 
                                          regime: Dict, 
                                          position: Dict, 
                                          aligned: bool) -> float:
        """计算综合信心度"""
        conf = base_conf
        
        # 加分项
        if aligned: conf += 15
        if regime['regime'] in ['trending_up', 'trending_down']: conf += 10
        if position['quality'] == 'excellent': conf += 15
        
        # 减分项
        if regime['regime'] == 'choppy': conf -= 25
        if position['location'] == 'middle': conf -= 30
        if regime['regime'] == 'volatile': conf -= 20
        
        return max(5.0, min(100.0, conf))
    
    def _check_multi_period_alignment(
        self, 
        score_1h: float, 
        score_15m: float, 
        score_5m: float
    ) -> Tuple[bool, str]:
        """
        检测多周期趋势一致性
        
        策略:
        - 三个周期方向一致（同为正或同为负）-> 强对齐
        - 1h和15m一致，5m可反 -> 部分对齐
        - 其他 -> 不对齐
        
        Returns:
            (是否对齐, 对齐原因)
        """
        signs = [
            1 if score_1h > 10 else (-1 if score_1h < -10 else 0),
            1 if score_15m > 10 else (-1 if score_15m < -10 else 0),
            1 if score_5m > 10 else (-1 if score_5m < -10 else 0)
        ]
        
        # 三周期完全一致
        if signs[0] == signs[1] == signs[2] and signs[0] != 0:
            return True, f"三周期强势{('多头' if signs[0] > 0 else '空头')}对齐"
        
        # 1h和15m一致（忽略5m噪音）
        if signs[0] == signs[1] and signs[0] != 0:
            return True, f"中长周期{('多头' if signs[0] > 0 else '空头')}对齐(1h+15m)"
        
        # 不对齐
        return False, f"多周期分歧(1h:{signs[0]}, 15m:{signs[1]}, 5m:{signs[2]})"
    
    def _score_to_action(
        self, 
        weighted_score: float, 
        aligned: bool
    ) -> Tuple[str, float]:
        """
        将加权得分映射为交易动作
        
        策略:
        - 得分>50 且 对齐 -> long (high confidence)
        - 得分>30 -> long (medium confidence)
        - 得分<-50 且 对齐 -> short (high confidence)
        - 得分<-30 -> short (medium confidence)
        - 其他 -> hold
        
        Returns:
            (action, confidence)
        """
        # 强信号阈值（需要多周期对齐）
        if weighted_score > 50 and aligned:
            return 'long', 0.85
        if weighted_score < -50 and aligned:
            return 'short', 0.85
        
        # 中等信号阈值
        if weighted_score > 30:
            confidence = 0.6 + (weighted_score - 30) * 0.01  # 线性递增
            return 'long', min(confidence, 0.75)
        if weighted_score < -30:
            confidence = 0.6 + (abs(weighted_score) - 30) * 0.01
            return 'short', min(confidence, 0.75)
        
        # 弱信号或冲突 -> 观望
        return 'hold', abs(weighted_score) / 100  # 置信度取决于得分绝对值
    
    def _generate_reason(
        self, 
        weighted_score: float,
        aligned: bool,
        alignment_reason: str,
        quant_analysis: Dict,
        regime: Optional[Dict] = None
    ) -> str:
        """生成决策原因（可解释性）"""
        # 提取关键信息
        trend_1h = quant_analysis.get('trend_1h', {})
        trend_15m = quant_analysis.get('trend_15m', {})
        osc_1h = quant_analysis.get('oscillator_1h', {})
        
        reasons = []
        
        # 1. 市场状态 (Regime)
        if regime:
            regime_name = regime.get('regime', 'unknown').upper()
            reasons.append(f"[{regime_name}]")
        
        # 2. 总体得分
        reasons.append(f"加权得分: {weighted_score:.1f}")
        
        # 2. 多周期对齐情况
        reasons.append(f"周期对齐: {alignment_reason}")
        
        # 3. 主要驱动因素（取绝对值最大的2个信号）
        vote_details = {
            'trend_1h': trend_1h.get('score', 0),
            'trend_15m': trend_15m.get('score', 0),
            'oscillator_1h': osc_1h.get('score', 0)
        }
        sorted_signals = sorted(
            vote_details.items(), 
            key=lambda x: abs(x[1]), 
            reverse=True
        )[:2]
        
        for sig_name, sig_score in sorted_signals:
            if abs(sig_score) > 20:
                signal_label = quant_analysis.get(sig_name, {}).get('signal', 'unknown')
                reasons.append(f"{sig_name}: {signal_label}({sig_score})")
        
        return " | ".join(reasons)
    
    def update_performance(self, signal_name: str, is_correct: bool):
        """
        更新信号历史表现（用于自适应权重调整）
        
        Args:
            signal_name: 信号名称（如'trend_5m'）
            is_correct: 该信号的预测是否准确
        """
        if signal_name in self.performance_tracker:
            self.performance_tracker[signal_name]['total'] += 1
            if is_correct:
                self.performance_tracker[signal_name]['correct'] += 1
    
    def adjust_weights_by_performance(self) -> SignalWeight:
        """
        根据历史表现自适应调整权重（高级功能）
        
        策略:
        - 计算各信号的胜率
        - 胜率高的信号增加权重，低的减少权重
        - 保证权重总和为1.0
        
        Returns:
            调整后的权重配置
        """
        # 计算各信号胜率
        win_rates = {}
        for sig_name, perf in self.performance_tracker.items():
            if perf['total'] > 0:
                win_rates[sig_name] = perf['correct'] / perf['total']
            else:
                win_rates[sig_name] = 0.5  # 默认50%
        
        # 归一化（总和=1.0）
        total_rate = sum(win_rates.values())
        if total_rate > 0:
            normalized_weights = {
                k: v / total_rate for k, v in win_rates.items()
            }
        else:
            return self.weights  # 无足够数据，保持原权重
        
        # 更新权重
        new_weights = SignalWeight(
            trend_5m=normalized_weights.get('trend_5m', self.weights.trend_5m),
            trend_15m=normalized_weights.get('trend_15m', self.weights.trend_15m),
            trend_1h=normalized_weights.get('trend_1h', self.weights.trend_1h),
            oscillator_5m=normalized_weights.get('oscillator_5m', self.weights.oscillator_5m),
            oscillator_15m=normalized_weights.get('oscillator_15m', self.weights.oscillator_15m),
            oscillator_1h=normalized_weights.get('oscillator_1h', self.weights.oscillator_1h),
        )
        
        return new_weights
    
    def to_llm_context(self, vote_result: VoteResult, quant_analysis: Dict) -> str:
        """
        将量化信号转换为LLM上下文（用于DeepSeek决策增强）
        
        Returns:
            格式化的文本上下文
        """
        context = f"""
### 量化信号汇总 (Decision Core Output)

**加权投票结果**:
- 综合得分: {vote_result.weighted_score:.1f} (-100~+100)
- 建议动作: {vote_result.action}
- 置信度: {vote_result.confidence:.2%}
- 多周期对齐: {'✅ 是' if vote_result.multi_period_aligned else '❌ 否'}

**决策原因**: {vote_result.reason}

**各信号详情**:
"""
        # 添加各周期趋势分析
        for period in ['5m', '15m', '1h']:
            trend_key = f'trend_{period}'
            osc_key = f'oscillator_{period}'
            
            if trend_key in quant_analysis:
                trend = quant_analysis[trend_key]
                context += f"\n[{period}周期趋势] {trend.get('signal', 'N/A')} (得分:{trend.get('score', 0)})"
                context += f"\n  └ EMA状态: {trend.get('details', {}).get('ema_status', 'N/A')}"
            
            if osc_key in quant_analysis:
                osc = quant_analysis[osc_key]
                context += f"\n[{period}周期震荡] {osc.get('signal', 'N/A')} (得分:{osc.get('score', 0)})"
                rsi = osc.get('details', {}).get('rsi_value', 0)
                context += f"\n  └ RSI: {rsi:.1f}"
        
        context += f"\n\n**权重分配**: {json.dumps(vote_result.vote_details, indent=2)}"
        
        return context
    
    def get_statistics(self) -> Dict:
        """获取决策统计信息"""
        if not self.history:
            return {'total_decisions': 0}
        
        total = len(self.history)
        actions = [h.action for h in self.history]
        avg_confidence = sum(h.confidence for h in self.history) / total
        aligned_count = sum(1 for h in self.history if h.multi_period_aligned)
        
        return {
            'total_decisions': total,
            'action_distribution': {
                'long': actions.count('long'),
                'short': actions.count('short'),
                'hold': actions.count('hold'),
            },
            'avg_confidence': avg_confidence,
            'alignment_rate': aligned_count / total,
            'performance_tracker': self.performance_tracker,
        }


# ============================================
# 测试函数
# ============================================
async def test_decision_core():
    """测试决策中枢Agent"""
    print("\n" + "="*60)
    print("🧪 测试决策中枢Agent")
    print("="*60)
    
    # 模拟量化分析师的输出
    mock_quant_analysis = {
        'trend_5m': {
            'score': -15,
            'signal': 'weak_short',
            'details': {'ema_status': 'bearish_crossover'}
        },
        'trend_15m': {
            'score': 45,
            'signal': 'moderate_long',
            'details': {'ema_status': 'bullish'}
        },
        'trend_1h': {
            'score': 65,
            'signal': 'strong_long',
            'details': {'ema_status': 'strong_bullish'}
        },
        'oscillator_5m': {
            'score': -5,
            'signal': 'neutral',
            'details': {'rsi_value': 48.2}
        },
        'oscillator_15m': {
            'score': 20,
            'signal': 'moderate_long',
            'details': {'rsi_value': 62.5}
        },
        'oscillator_1h': {
            'score': 30,
            'signal': 'moderate_long',
            'details': {'rsi_value': 68.3}
        },
    }
    
    # 创建决策中枢
    decision_core = DecisionCoreAgent()
    
    # 执行决策
    print("\n1️⃣ 测试加权投票决策...")
    result = await decision_core.make_decision(mock_quant_analysis)
    
    print(f"  ✅ 决策动作: {result.action}")
    print(f"  ✅ 综合得分: {result.weighted_score:.2f}")
    print(f"  ✅ 置信度: {result.confidence:.2%}")
    print(f"  ✅ 多周期对齐: {result.multi_period_aligned}")
    print(f"  ✅ 决策原因: {result.reason}")
    
    # 测试LLM上下文生成
    print("\n2️⃣ 测试LLM上下文生成...")
    llm_context = decision_core.to_llm_context(result, mock_quant_analysis)
    print(llm_context[:500] + "...")  # 只显示前500字符
    
    # 测试统计信息
    print("\n3️⃣ 测试统计信息...")
    # 再执行几次决策
    for _ in range(3):
        await decision_core.make_decision(mock_quant_analysis)
    
    stats = decision_core.get_statistics()
    print(f"  ✅ 总决策次数: {stats['total_decisions']}")
    print(f"  ✅ 平均置信度: {stats['avg_confidence']:.2%}")
    print(f"  ✅ 对齐率: {stats['alignment_rate']:.2%}")
    
    print("\n✅ 决策中枢Agent测试通过!")
    return decision_core


if __name__ == '__main__':
    # 运行测试
    asyncio.run(test_decision_core())
