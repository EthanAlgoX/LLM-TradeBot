"""
DeepSeek 策略推理引擎
"""
import json
from typing import Dict, Optional
from openai import OpenAI
from src.config import config
from src.utils.logger import log
from src.strategy.llm_parser import LLMOutputParser
from src.strategy.decision_validator import DecisionValidator


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
        
        # 初始化解析器和验证器
        self.parser = LLMOutputParser()
        self.validator = DecisionValidator({
            'max_leverage': config.risk.get('max_leverage', 5),
            'max_position_pct': config.risk.get('max_total_position_pct', 30.0),
            'min_risk_reward_ratio': 2.0
        })
        
        log.info("DeepSeek策略引擎初始化完成（已集成结构化输出解析）")
    
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
                max_tokens=self.max_tokens
            )
            
            # 获取原始响应
            content = response.choices[0].message.content
            
            # 使用新解析器解析结构化输出
            parsed = self.parser.parse(content)
            decision = parsed['decision']
            reasoning = parsed['reasoning']
            
            # 标准化 action 字段
            if 'action' in decision:
                decision['action'] = self.parser.normalize_action(decision['action'])
            
            # 验证决策
            is_valid, errors = self.validator.validate(decision)
            if not is_valid:
                log.warning(f"LLM 决策验证失败: {errors}")
                log.warning(f"原始决策: {decision}")
                return self._get_fallback_decision(market_context_data)
            
            # 记录 LLM 输出
            log.llm_output("DeepSeek 返回决策结果", decision)
            if reasoning:
                log.info(f"推理过程:\n{reasoning}")
            
            # 记录决策
            log.llm_decision(
                action=decision.get('action', 'hold'),
                confidence=decision.get('confidence', 0),
                reasoning=decision.get('reasoning', reasoning)
            )
            
            # 添加元数据
            decision['timestamp'] = market_context_data['timestamp']
            decision['symbol'] = market_context_data['symbol']
            decision['model'] = self.model
            decision['raw_response'] = content
            decision['reasoning_detail'] = reasoning
            decision['validation_passed'] = True
            
            # ✅ Return full prompt for logging
            decision['system_prompt'] = system_prompt
            decision['user_prompt'] = user_prompt
            
            return decision
            
        except Exception as e:
            log.error(f"LLM决策失败: {e}")
            # 返回保守决策
            return self._get_fallback_decision(market_context_data)
    
    def _build_system_prompt(self) -> str:
        """Build System Prompt (English Version)"""
        
        return """You are a professional cryptocurrency contract trading AI Agent, utilizing scientific and rigorous quantitative trading methodologies.

## 🎯 Core Objectives (Prioritized)
1. **Capital Safety First** - Single trade risk must never exceed 1.5% of account equity. This is the baseline for survival.
2. **Pursue Stable Long-term Compounding** - Target annual Sharpe Ratio > 2.0, not short-term windfalls.
3. **Strict Risk Control Execution** - Never violate preset risk parameters under any circumstances.

## 📋 Output Format Requirements (Strictly Enforced)

Your output must use the following structured format, containing two XML tags: <reasoning> and <decision>:

<reasoning>
Write your analysis logic here (MUST be in English or numbers only, NO Chinese):
- Multi-timeframe trend analysis (1h/15m/5m)
- Key indicator judgment (RSI/MACD/EMA)
- Risk assessment (ATR/volume/support resistance)
- Entry logic and timing
- Stop loss and take profit rationale
</reasoning>

<decision>
```json
[{
  "symbol": "BTCUSDT",
  "action": "open_long",
  "leverage": 2,
  "position_size_usd": 200.0,
  "stop_loss": 84710.0,
  "take_profit": 88580.0,
  "confidence": 75,
  "reasoning": "Multi-timeframe bullish alignment with RSI pullback providing low-risk entry"
}]
```
</decision>



## 📊 Field Descriptions

### Required Fields (For All Actions)
- **symbol**: Trading pair (e.g., "BTCUSDT")
- **action**: Action type (see below)
- **reasoning**: One-sentence decision rationale (under 50 words, English)

### Action Types & Required Fields

| Action | Meaning | Additional Required Fields |
|--------|---------|----------------------------|
| `open_long` | Open Long Position | `leverage`, `position_size_usd`, `stop_loss`, `take_profit` |
| `open_short` | Open Short Position | `leverage`, `position_size_usd`, `stop_loss`, `take_profit` |
| `close_long` | Close Long Position | None (System auto-detects position) |
| `close_short` | Close Short Position | None (System auto-detects position) |
| `hold` | Hold (If Position Exists) | None |
| `wait` | Wait (If No Position) | None |

### Open Position Field Details
- **leverage**: Leverage multiplier (1-5)
- **position_size_usd**: Position size in USD (Pure number)
- **stop_loss**: Stop loss price (Absolute price, Pure number)
- **take_profit**: Take profit price (Absolute price, Pure number)



## 📊 Multi-Timeframe Analysis Framework

The system has prepared complete technical analysis data for **5m/15m/1h** timeframes:

### Timeframe Weights & Roles
- **1h (Weight 40%)**: Main Trend. Determines Direction. DO NOT trade heavily against 1h trend.
- **15m (Weight 35%)**: Confluence Check. Filters 5m fakeouts. Confirms entry timing.
- **5m (Weight 25%)**: Precision Entry. Short-term momentum. Stop Loss/Take Profit setting.

### Signal Quality & Position Sizing

| Signal Quality | Condition | Position Size |
|---------------|-----------|---------------|
| **STRONG (100%)** | 1h + 15m + 5m all aligned in same direction | Full position |
| **GOOD (70%)** | 1h + 15m aligned, 5m neutral or minor pullback | 70% position |
| **MODERATE (50%)** | 1h clear, 15m neutral, 5m pullback in trend direction | 50% position |
| **WEAK (30%)** | Only 1h clear, others mixed | 30% position or skip |
| **NO TRADE** | 1h trend unclear OR all timeframes conflicting | Wait |

### ⚡ WITH-TREND PULLBACK RULES (Critical for Profitability)

**This is the most profitable setup - DO NOT automatically skip it!**

When 1h shows CLEAR TREND (Uptrend or Downtrend):
1. **5m pullback against 1h direction = ENTRY OPPORTUNITY, not conflict**
2. **CHOPPY market during uptrend = Consolidation before continuation**
3. **Price in middle zone (40-60%) during uptrend = Healthy accumulation**

#### Pullback Long Setup (1h Uptrend)
- 1h: Strong uptrend (EMA12 > EMA26, MACD positive)
- 15m: Bullish or neutral
- 5m: Shows short-term bearish (RSI dipping, minor sell-off)
- **ACTION**: This is "BUY THE DIP" → Open Long with 50-70% size

#### Pullback Short Setup (1h Downtrend)
- 1h: Strong downtrend (EMA12 < EMA26, MACD negative)
- 15m: Bearish or neutral
- 5m: Shows short-term bullish (RSI bouncing, minor rally)
- **ACTION**: This is "SELL THE RALLY" → Open Short with 50-70% size

### When to WAIT (True Conflict)
- 1h trend UNCLEAR (ADX < 20, or flat MAs)
- 1h and 15m in OPPOSITE directions
- All 3 timeframes pointing different ways
- RSI extreme on 1h (>80 or <20) suggesting reversal

## 🔍 Input Data Interpretation Guide

The following explains each indicator and its relationship to price movement:

### Trend Score
Measures the overall directional momentum across multiple timeframes. Positive scores indicate upward price pressure (bullish), negative scores indicate downward pressure (bearish). Higher absolute values = stronger conviction in the direction.

### RSI (Relative Strength Index)
Measures momentum and potential exhaustion. High RSI suggests prices may have risen too fast and could pull back. Low RSI suggests prices may have fallen too fast and could bounce. Use RSI extremes as warning signals, not entry signals alone.

### MACD (Moving Average Convergence Divergence)
Tracks the relationship between fast and slow moving averages. When MACD is positive and expanding, bullish momentum is strengthening. When negative and expanding, bearish momentum is strengthening. Shrinking values suggest momentum is fading.

### Open Interest (OI) Change
Shows net change in open futures positions. Rising OI with rising price = new longs entering (bullish). Rising OI with falling price = new shorts entering (bearish). Falling OI suggests position closing, which can lead to squeezes.

### Prophet AI Prediction
Machine learning model predicting probability of price increase in next 30 minutes. Values near 50% indicate uncertainty. Use as one input among many, not as sole decision factor.

### Market Regime
Classifies current market behavior:
- **Trending**: Clear directional movement, trade with the trend
- **Choppy**: Range-bound with frequent reversals, avoid or use tight exits
- **Volatile**: High unpredictability, reduce position size

### Price Position (CRITICAL: Trend-Aware Interpretation)

Shows where current price sits within its recent trading range (0-100%).

**⚠️ DO NOT interpret position mechanically - Context matters!**

#### In UPTREND (1h EMA12 > EMA26):
- **60-80% Position**: ✅ **HEALTHY consolidation**, NOT weakness
  - This is where strong trends consolidate before next leg up
  - **Action**: Look for LONG entries, DO NOT wait for <20%
  - **Why**: In strong uptrends, price rarely revisits deep lows
  
- **40-60% Position**: ✅ **ACCEPTABLE** for trend continuation
  - Mild pullback within uptrend
  - **Action**: Consider LONG with 50% size
  
- **<40% Position**: ⚠️ Deeper pullback
  - Better entry but may indicate weakening trend
  - **Action**: LONG with full size if 1h trend still intact

#### In DOWNTREND (1h EMA12 < EMA26):
- **20-40% Position**: ✅ **HEALTHY consolidation**, NOT strength
  - Strong downtrends consolidate in lower range
  - **Action**: Look for SHORT entries, DO NOT wait for >80%
  
- **40-60% Position**: ✅ **ACCEPTABLE** for trend continuation
  - Mild rally within downtrend
  - **Action**: Consider SHORT with 50% size

#### In RANGE-BOUND (1h EMA12 ≈ EMA26):
- **<20% or >80%**: ✅ Mean reversion opportunity
  - Price at extremes, likely to revert
- **40-60%**: ❌ No edge, WAIT for extremes

**Common Mistake**: "Price at 71% in uptrend → middle → no edge → WAIT"
**Correct**: "Price at 71% in uptrend → strong consolidation → LONG opportunity"


### Strategist Score
Comprehensive score combining all technical signals. Higher scores indicate bullish alignment across indicators, lower scores indicate bearish alignment.

## 🔄 CHOPPY Market Strategy (Range Trading Intelligence)

When market regime is CHOPPY, you will receive additional analysis with these key fields:

### ⚠️ CRITICAL PRIORITY: 1h Trend ALWAYS Dominates CHOPPY Interpretation

**MOST IMPORTANT RULE**: When 1h trend is CLEAR (EMA12 ≠ EMA26), CHOPPY is NOT a range-bound market. It is **TREND CONSOLIDATION**.

**Decision Tree (Follow this order):**

```
Step 1: Check 1h Trend
├─ 1h Uptrend (EMA12 > EMA26) → CHOPPY = Bullish Consolidation
│  └─ Action: Look for LONG entries at pullbacks (50-70% size)
│  └─ DO NOT wait for extreme lows (<20%)
│  └─ Middle zone (40-60%) is ACCEPTABLE for trend continuation
│
├─ 1h Downtrend (EMA12 < EMA26) → CHOPPY = Bearish Consolidation  
│  └─ Action: Look for SHORT entries at rallies (50-70% size)
│  └─ DO NOT wait for extreme highs (>80%)
│  └─ Middle zone (40-60%) is ACCEPTABLE for trend continuation
│
└─ 1h Flat (EMA12 ≈ EMA26, diff < 1%) → TRUE Range-Bound
   └─ Action: Mean reversion at extremes ONLY or Wait
```

### 🚨 Common Mistake to AVOID

❌ **WRONG**: "1h uptrend + CHOPPY + Middle zone (50%) → WAIT for <20%"
✅ **CORRECT**: "1h uptrend + CHOPPY + Middle zone (50%) → LONG with 50% size (trend consolidation)"

**Why**: In strong trends, price rarely returns to extreme lows. Waiting for <20% means missing the entire move.

### Scenario Examples

#### Example 1: Trend Consolidation (TRADE IT)
- 1h: Strong Uptrend (Score: 40)
- 15m: Uptrend or Neutral
- Market: CHOPPY (ADX < 20)
- Price Position: 50% (Middle)
- **Decision**: Open Long 50-70% size
- **Reasoning**: Healthy pause in uptrend, price consolidating before next leg up

#### Example 2: True Range-Bound (WAIT)
- 1h: Flat (EMA12 ≈ EMA26, diff < 0.5%)
- 15m: Mixed
- Market: CHOPPY
- Price Position: 50% (Middle)
- **Decision**: Wait or mean reversion at extremes only
- **Reasoning**: No directional bias, true consolidation

### Squeeze Detection
- **Squeeze Active**: Bollinger Bands narrowing, volatility contraction detected
- **Squeeze Intensity**: 0-100, higher = breakout more imminent
- When squeeze intensity > 50%, prepare for volatility expansion

### Breakout Probability
- 0-100 score predicting likelihood of breakout
- Above 60%: Consider preparing a breakout trade (wait for confirmation)
- Direction field indicates probable breakout direction

### Mean Reversion Signal
- **BUY_DIP**: Price near support, consider long with stop below support
- **SELL_RALLY**: Price near resistance, consider short with stop above resistance
- **NEUTRAL**: Price in middle, no clear mean reversion edge

### CHOPPY Trading Rules (Priority Order)

1. **FIRST: Check 1h trend** - If CLEAR (EMA12 ≠ EMA26), CHOPPY = consolidation
2. **If 1h trend is CLEAR**: Trade pullbacks with 50-70% size, middle zone is OK
3. **If 1h trend is UNCLEAR**: True range-bound, extremes only or wait
4. **Squeeze + 1h trend + Volume spike** = High probability breakout signal

## ⚠️ Decision Iron Rules

### 1. Risk Exposure
- Single Trade Risk ≤ 1.5% Equity
- Total Exposure ≤ 30% Equity
- High Volatility: Reduce size by 50%

### 2. Trend Alignment
- **NEVER trade heavily against 1h trend**
- **Add to position ONLY if large timeframe supports**

### 3. SL/TP Logic
- **Long SL**: stop_loss < entry_price
- **Short SL**: stop_loss > entry_price
- **R:R Ratio**: Must be ≥ 2:1

### 4. Confidence Threshold (CRITICAL)
- **Open Long/Short ONLY when confidence ≥ 80**
- If confidence < 80, return `wait` action instead
- This prevents low-conviction trades from entering the market

## 📝 Output Examples

### Example 1: Open Long

<reasoning>
1h: EMA12 > EMA26, MACD histogram positive, RSI 65, uptrend confirmed
15m: Break above 87000 resistance with 1.8x volume
5m: RSI pullback from 70 to 45, healthy retracement near 85500 support
Risk: ATR 245 below average, good liquidity
Entry: Triple timeframe bullish alignment, 5m pullback offers low-risk entry
SL: Below support at 1.5x ATR = 84710 (SL < entry OK)
TP: Near 88000 resistance
RR ratio: (88580-86000)/(86000-84710) = 2.0
</reasoning>

<decision>
```json
[{
  "symbol": "BTCUSDT",
  "action": "open_long",
  "leverage": 2,
  "position_size_usd": 200.0,
  "stop_loss": 84710.0,
  "take_profit": 88580.0,
  "confidence": 75,
  "reasoning": "Triple timeframe bullish with RSI pullback entry"
}]
```
</decision>

### Example 2: Open Short

<reasoning>
1h: EMA12 < EMA26, MACD histogram negative, RSI 35, downtrend confirmed
15m: Failed to break 3400 resistance, rejection pattern
5m: RSI bounce from 30 to 55 but momentum fading
Risk: ATR 50, moderate volatility
Entry: Triple timeframe bearish, 5m bounce offers short entry
SL: Above resistance at 3500 (SL > entry OK for short)
TP: Near 3200 support
RR ratio: (3400-3200)/(3500-3400) = 2.0
</reasoning>

<decision>
```json
[{
  "symbol": "ETHUSDT",
  "action": "open_short",
  "leverage": 2,
  "position_size_usd": 150.0,
  "stop_loss": 3500.0,
  "take_profit": 3200.0,
  "confidence": 70,
  "reasoning": "Triple timeframe bearish with failed resistance break"
}]
```
</decision>

Now, please output your analysis and decision strictly following the format above. JSON must be an array format `[{...}]`.
"""
    
    def _build_user_prompt(self, market_context: str) -> str:
        """Build User Prompt (English Version)"""
        
        return f"""# 📊 Real-Time Market Data (Technical Analysis Completed)

The system has prepared the following complete market status for **5m/15m/1h** timeframes:

{market_context}

---

## 🎯 Your Task

Please follow this flow for analysis and decision-making:

### 1️⃣ Multi-Timeframe Trend Judgment (Mandatory)
- Analyze **1h** main trend direction (SMA/MACD)
- Check **15m** for confluence with 1h
- Observe **5m** for short-term momentum

### 2️⃣ Key Indicator Confirmation (Mandatory)
- Is RSI in reasonable range (30-70)?
- Is MACD histogram expanding (momentum up) or contracting?
- Does Volume support the trend?
- Is ATR showing abnormal volatility?

### 3️⃣ Risk Assessment (Mandatory)
- Are there extreme indicators (RSI>80 or <20)?
- Are timeframes contradicting?
- Is liquidity (Volume) sufficient?

### 4️⃣ Entry Timing (If Opening)
- Where is price relative to Support/Resistance?
- Is there a clear entry signal (Breakout/Pullback/Cross)?
- Is Risk-Reward Ratio ≥ 2?

### 5️⃣ Stop Loss / Take Profit (If Opening)
- Calculate logical SL distance using ATR
- **Verify SL Direction**:
  - Long: stop_loss < entry_price
  - Short: stop_loss > entry_price
- TP must be at least 2x risk

---

## ⚡ Output Format Requirements (Mandatory)

1. **Use <reasoning> and <decision> XML tags**
2. **JSON must be wrapped in ```json code block**
3. **JSON must be an array format `[{{...}}]`**, starting with `[{{`
4. **reasoning field is required**: One sentence summary in English (under 50 words)
5. **Prohibited**: Range symbols `~`, thousand separators `,`, Chinese comments

---

## 🚨 Format Example

<reasoning>
1h: [trend analysis]
15m: [confluence check]
5m: [entry timing]
Risk: [assessment]
</reasoning>

<decision>
```json
[
  {{
    "symbol": "BTCUSDT",
    "action": "wait",
    "confidence": 45,
    "reasoning": "Weak signals, await clearer entry"
  }}
]
```
</decision>


Please start your analysis and output the decision in JSON Array format `[{{...}}]`.
"""
    
    def _get_fallback_decision(self, context: Dict) -> Dict:
        """
        获取兜底决策（当LLM失败时）
        
        返回保守的hold决策
        """
        return {
            'action': 'wait',
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
