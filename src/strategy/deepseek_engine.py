"""
DeepSeek 策略推理引擎
"""
import json
from typing import Dict, Optional
from openai import OpenAI
from src.config import config
from src.utils.logger import log


class StrategyEngine:
    """DeepSeek驱动的策略决策引擎"""
    
    def __init__(self):
        self.api_key = config.deepseek.get('api_key')
        self.base_url = config.deepseek.get('base_url', 'https://api.deepseek.com')
        self.model = config.deepseek.get('model', 'deepseek-chat')
        self.temperature = config.deepseek.get('temperature', 0.3)
        self.max_tokens = config.deepseek.get('max_tokens', 2000)
        
        # 初始化OpenAI客户端（DeepSeek兼容OpenAI API）
        self.client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url
        )
        
        log.info("DeepSeek策略引擎初始化完成")
    
    def make_decision(self, market_context_text: str, market_context_data: Dict) -> Dict:
        """
        基于市场上下文做出交易决策
        
        Args:
            market_context_text: 格式化的市场上下文文本
            market_context_data: 原始市场数据
            
        Returns:
            决策结果字典
        """
        
        system_prompt = self._build_system_prompt()
        user_prompt = self._build_user_prompt(market_context_text)
        
        # 记录 LLM 输入
        log.llm_input("正在发送市场数据到 DeepSeek...", market_context_text)
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                response_format={"type": "json_object"}
            )
            
            # 解析响应
            content = response.choices[0].message.content
            decision = json.loads(content)
            
            # 记录 LLM 输出
            log.llm_output("DeepSeek 返回决策结果", decision)
            
            # 记录决策
            log.llm_decision(
                action=decision.get('action', 'hold'),
                confidence=decision.get('confidence', 0),
                reasoning=decision.get('reasoning', '')
            )
            
            # 添加元数据
            decision['timestamp'] = market_context_data['timestamp']
            decision['symbol'] = market_context_data['symbol']
            decision['model'] = self.model
            decision['raw_response'] = content
            
            return decision
            
        except Exception as e:
            log.error(f"LLM决策失败: {e}")
            # 返回保守决策
            return self._get_fallback_decision(market_context_data)
    
    def _build_system_prompt(self) -> str:
        """构建系统提示词"""
        
        return """你是一个专业的加密货币合约交易 AI Agent。

## 核心目标
1. **保住本金优先** - 控制风险是第一要务
2. **最大化长期夏普比率** - 追求风险调整后收益
3. **严格遵守风险管理规则**

## 你的职责
- 分析多周期市场状态
- 判断趋势、动量、波动率
- 决定是否开仓/加仓/减仓/平仓/观望
- 设置止盈止损位置
- 给出清晰的决策理由

## 决策原则
1. **不允许超出最大风险敞口** - 永远不要让单笔交易风险超过账户的1.5%
2. **不允许逆大周期趋势重仓** - 只在趋势明确时加大仓位
3. **资金费率极端时谨慎** - 极端资金费率说明市场过热
4. **流动性不足时避免交易** - 低流动性可能导致滑点
5. **持仓时关注止盈止损** - 及时锁定利润或止损

## 输出格式
你必须输出严格的JSON格式，包含以下字段：

```json
{
  "action": "open_long | open_short | close_position | add_position | reduce_position | hold",
  "symbol": "BTCUSDT",
  "confidence": 75,
  "leverage": 3,
  "position_size_pct": 10.0,
  "stop_loss_pct": 2.0,
  "take_profit_pct": 4.0,
  "entry_price": 86000.0,
  "stop_loss_price": 84280.0,
  "take_profit_price": 89440.0,
  "risk_reward_ratio": 2.0,
  "reasoning": "详细分析",
  "analysis": {
    "trend_analysis": "多周期趋势分析：5m下跌，1h下跌，4h下跌，趋势一致向下",
    "technical_signals": "RSI超卖，MACD bearish，技术指标共振看空",
    "risk_assessment": "高波动率环境，流动性低，风险较高",
    "market_sentiment": "资金费率中性，持仓量稳定",
    "key_levels": "支撑位85000，阻力位90000",
    "decision_rationale": "综合判断后决定观望"
  },
  "metadata": {
    "analyzed_timeframes": ["5m", "15m", "1h", "4h", "1d"],
    "primary_indicators": ["RSI", "MACD", "ATR", "Volume"],
    "market_condition": "high_volatility_downtrend",
    "risk_level": "high"
  }
}
```

## 字段说明
- **action**: 交易动作（必填）
- **confidence**: 决策置信度 0-100（必填）
- **leverage**: 建议杠杆 1-5（必填）
- **position_size_pct**: 建议仓位占比 0-30%（必填）
- **stop_loss_pct**: 止损百分比（必填）
- **take_profit_pct**: 止盈百分比（必填）
- **entry_price**: 建议入场价（可选）
- **stop_loss_price**: 止损价位（可选）
- **take_profit_price**: 止盈价位（可选）
- **risk_reward_ratio**: 风险收益比（可选）
- **reasoning**: 简短决策理由（必填）
- **analysis**: 详细分析（必填，包含多个维度）
- **metadata**: 元数据（可选，用于记录分析过程）

## 动作说明
- **open_long**: 开多仓
- **open_short**: 开空仓
- **close_position**: 完全平仓
- **add_position**: 加仓（当前持仓方向）
- **reduce_position**: 减仓
- **hold**: 观望，不做操作

## 重要提醒
1. 低置信度(<50)时应该选择 hold
2. 高波动率环境降低仓位和杠杆
3. 确保风险收益比至少为 2:1
4. analysis 字段要包含完整的分析过程
5. 所有价格和百分比保留2位小数
"""
    
    def _build_user_prompt(self, market_context: str) -> str:
        """构建用户提示词"""
        
        return f"""请基于以下市场信息做出交易决策：

{market_context}

请严格按照JSON格式输出你的决策，包含完整的reasoning字段说明你的分析过程。
"""
    
    def _get_fallback_decision(self, context: Dict) -> Dict:
        """
        获取兜底决策（当LLM失败时）
        
        返回保守的hold决策
        """
        return {
            'action': 'hold',
            'symbol': context.get('symbol', 'BTCUSDT'),
            'confidence': 0,
            'leverage': 1,
            'position_size_pct': 0,
            'stop_loss_pct': 1.0,
            'take_profit_pct': 2.0,
            'reasoning': 'LLM决策失败，采用保守策略观望',
            'timestamp': context.get('timestamp'),
            'is_fallback': True
        }
    
    def validate_decision(self, decision: Dict) -> bool:
        """
        验证决策格式是否正确
        
        Returns:
            True if valid, False otherwise
        """
        required_fields = [
            'action', 'symbol', 'confidence', 'leverage',
            'position_size_pct', 'stop_loss_pct', 'take_profit_pct', 'reasoning'
        ]
        
        # 检查必需字段
        for field in required_fields:
            if field not in decision:
                log.error(f"决策缺少必需字段: {field}")
                return False
        
        # 检查action合法性
        valid_actions = [
            'open_long', 'open_short', 'close_position',
            'add_position', 'reduce_position', 'hold'
        ]
        if decision['action'] not in valid_actions:
            log.error(f"无效的action: {decision['action']}")
            return False
        
        # 检查数值范围
        if not (0 <= decision['confidence'] <= 100):
            log.error(f"confidence超出范围: {decision['confidence']}")
            return False
        
        if not (1 <= decision['leverage'] <= config.risk.get('max_leverage', 5)):
            log.error(f"leverage超出范围: {decision['leverage']}")
            return False
        
        if not (0 <= decision['position_size_pct'] <= 100):
            log.error(f"position_size_pct超出范围: {decision['position_size_pct']}")
            return False
        
        return True
