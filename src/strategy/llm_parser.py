"""
LLM 输出解析器
解析结构化的 LLM 输出（XML 标签 + JSON）

支持格式：
<reasoning>
分析过程...
</reasoning>

<decision>
```json
[{
  "symbol": "BTCUSDT",
  "action": "open_long",
  ...
}]
```
</decision>
"""

import re
import json
from typing import Dict, Optional, Tuple
from src.utils.logger import log
from src.utils.action_protocol import normalize_action


class LLMOutputParser:
    """
    LLM 输出解析器
    
    支持格式：
    <reasoning>
    分析过程...
    </reasoning>
    
    <decision>
    ```json
    [{
      "symbol": "BTCUSDT",
      "action": "open_long",
      ...
    }]
    ```
    </decision>
    
    特性：
    1. 优先从 XML 标签提取
    2. 支持 ```json 代码块
    3. 自动修复常见字符错误（中文引号、冒号、范围符号等）
    4. 解析失败时进入安全回退模式（返回 wait 决策）
    """
    
    def __init__(self):
        self.supported_tags = ['decision', 'final_vote']
        
    def parse(self, llm_response: str) -> Dict:
        """
        解析 LLM 输出
        
        Args:
            llm_response: LLM 原始响应
            
        Returns:
            {
                'reasoning': str,  # 推理过程
                'decision': dict,  # 决策结果
                'raw_response': str  # 原始响应
            }
        """
        try:
            # 1. 提取推理过程
            reasoning = self._extract_tag_content(llm_response, 'reasoning')
            
            # 2. 提取决策 JSON（优先从 XML 标签）
            decision_json = None
            for tag in self.supported_tags:
                decision_json = self._extract_tag_content(llm_response, tag)
                if decision_json:
                    break
            
            # 3. 如果标签内没找到，尝试在整个响应中搜索 JSON
            if not decision_json:
                decision_json = self._extract_json_from_text(llm_response)
            
            # 4. 解析 JSON（带容错和安全回退）
            if decision_json:
                decision = self._parse_json_with_fallback(decision_json)
            else:
                log.warning("未找到决策 JSON，进入安全回退模式")
                decision = self._get_fallback_decision()
            
            # 5. 确保决策有效，否则使用回退
            if not decision or 'action' not in decision:
                log.warning("决策无效，进入安全回退模式")
                decision = self._get_fallback_decision()
            
            return {
                'reasoning': reasoning or '',
                'decision': decision,
                'raw_response': llm_response
            }
            
        except Exception as e:
            log.error(f"LLM 输出解析失败: {e}，进入安全回退模式")
            return {
                'reasoning': '',
                'decision': self._get_fallback_decision(),
                'raw_response': llm_response,
                'parse_error': str(e)
            }
    
    def _extract_tag_content(self, text: str, tag: str) -> Optional[str]:
        """
        提取 XML 标签内容
        
        Args:
            text: 原始文本
            tag: 标签名（不含尖括号）
            
        Returns:
            标签内容，如果未找到返回 None
        """
        # 支持多种标签格式
        patterns = [
            rf'<{tag}>\s*```json\s*(.*?)\s*```\s*</{tag}>',  # 包含 ```json
            rf'<{tag}>\s*```\s*(.*?)\s*```\s*</{tag}>',  # 包含 ```
            rf'<{tag}>(.*?)</{tag}>',  # 标准格式
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
            if match:
                content = match.group(1).strip()
                # 如果是 JSON 标签，移除可能的 markdown 代码块标记
                if tag in self.supported_tags:
                    content = re.sub(r'^```json\s*', '', content)
                    content = re.sub(r'^```\s*', '', content)
                    content = re.sub(r'\s*```$', '', content)
                return content
        
        return None
    
    def _extract_json_from_text(self, text: str) -> Optional[str]:
        """
        从文本中提取 JSON 对象或数组
        
        使用括号计数算法正确处理嵌套结构
        
        Args:
            text: 原始文本
            
        Returns:
            JSON 字符串，如果未找到返回 None
        """
        # 方法1: 使用括号计数提取完整 JSON 数组 [{...}]
        json_str = self._extract_balanced_json(text, '[', ']')
        if json_str:
            return json_str
        
        # 方法2: 使用括号计数提取 JSON 对象 {...}
        json_str = self._extract_balanced_json(text, '{', '}')
        if json_str:
            return json_str
        
        # 方法3: 回退到原有正则匹配 (简单场景)
        arr_match = re.search(r'\[\s*\{.*?\}\s*\]', text, re.DOTALL)
        if arr_match:
            return arr_match.group(0)
        
        obj_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', text, re.DOTALL)
        if obj_match:
            return obj_match.group(0)
        
        return None
    
    def _extract_balanced_json(self, text: str, open_char: str, close_char: str) -> Optional[str]:
        """
        使用括号计数提取平衡的 JSON 结构
        
        Args:
            text: 原始文本
            open_char: 开始字符 ('{' 或 '[')
            close_char: 结束字符 ('}' 或 ']')
            
        Returns:
            完整的 JSON 字符串，如果未找到返回 None
        """
        start_idx = text.find(open_char)
        if start_idx == -1:
            return None
        
        count = 0
        in_string = False
        escape_next = False
        
        for i, char in enumerate(text[start_idx:], start_idx):
            # 处理字符串内部转义
            if escape_next:
                escape_next = False
                continue
            
            if char == '\\' and in_string:
                escape_next = True
                continue
            
            # 处理字符串边界
            if char == '"' and not escape_next:
                in_string = not in_string
                continue
            
            # 只在字符串外部计数括号
            if not in_string:
                if char == open_char:
                    count += 1
                elif char == close_char:
                    count -= 1
                    
                    if count == 0:
                        # 找到完整的 JSON 结构
                        json_str = text[start_idx:i + 1]
                        # 验证是否可解析
                        try:
                            json.loads(json_str)
                            return json_str
                        except json.JSONDecodeError:
                            # 继续寻找下一个可能的 JSON
                            return None
        
        return None

    
    def _parse_json_with_fallback(self, json_str: str) -> Dict:
        """
        带容错的 JSON 解析
        
        Args:
            json_str: JSON 字符串
            
        Returns:
            解析后的字典
        """
        # 1. 预处理：修正常见格式错误
        normalized = self._normalize_characters(json_str)
        
        # 2. 尝试直接解析
        try:
            data = json.loads(normalized)
            # 如果是数组，取第一个元素
            if isinstance(data, list) and len(data) > 0:
                data = data[0]
            return data
        except json.JSONDecodeError:
            pass
        
        # 3. 尝试移除尾部逗号后解析
        try:
            cleaned = re.sub(r',\s*}', '}', normalized)
            cleaned = re.sub(r',\s*\]', ']', cleaned)
            data = json.loads(cleaned)
            if isinstance(data, list) and len(data) > 0:
                data = data[0]
            return data
        except json.JSONDecodeError as e:
            log.error(f"JSON 解析失败（即使修正后）: {e}")
            return {}
    
    def _normalize_characters(self, text: str) -> str:
        """
        修正格式错误
        
        修正内容：
        1. 全角字符 -> 半角字符
        2. 中文引号 -> 英文引号
        3. 移除范围符号 ~
        4. 移除数字中的千位分隔符 ,
        
        Args:
            text: 原始文本
            
        Returns:
            修正后的文本
        """
        # 全角符号 -> 半角符号
        replacements = {
            '［': '[',
            '］': ']',
            '｛': '{',
            '｝': '}',
            '：': ':',
            '，': ',',
            # 中文引号 -> 英文引号
            '"': '"',
            '"': '"',
            ''': "'",
            ''': "'",
        }
        
        for old, new in replacements.items():
            text = text.replace(old, new)
        
        # 移除范围符号 ~ (如 "85000~86000" -> 取第一个值 "85000")
        text = re.sub(r'(\d+\.?\d*)\s*~\s*\d+\.?\d*', r'\1', text)
        
        # 移除数字中的千位分隔符 (如 "84,710" -> "84710")
        # 匹配字符串值中的带逗号数字
        text = re.sub(r'"(\d{1,3}(?:,\d{3})+(?:\.\d+)?)"', 
                      lambda m: '"' + m.group(1).replace(',', '') + '"', text)
        
        # 移除数字值（非字符串）中的千位分隔符
        # 这个正则匹配 : 后面的带逗号数字
        text = re.sub(r':\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?)\s*([,}\]])', 
                      lambda m: ': ' + m.group(1).replace(',', '') + m.group(2), text)
        
        return text
    
    def _get_fallback_decision(self) -> Dict:
        """
        获取安全回退决策
        
        当解析失败时返回 wait 决策
        
        Returns:
            安全的 wait 决策
        """
        return {
            'symbol': 'BTCUSDT',
            'action': 'wait',
            'confidence': 0,
            'reasoning': 'Parse error, fallback to safe wait decision'
        }
    
    def normalize_action(self, action: str) -> str:
        """
        标准化 action 字段
        
        支持多种变体：
        - long/buy -> open_long
        - short/sell -> open_short
        - close/exit -> close_long/close_short (if side known) else close_position
        
        Args:
            action: 原始 action
            
        Returns:
            标准化后的 action
        """
        return normalize_action(action)
    
    def validate_format(self, json_str: str) -> Tuple[bool, str]:
        """
        验证 JSON 格式是否符合要求
        
        验证规则：
        1. 必须以 [{ 开头
        2. 不能包含范围符号 ~
        3. 不能包含千位分隔符
        
        Args:
            json_str: JSON 字符串
            
        Returns:
            (is_valid, error_message)
        """
        # 检查是否以 [{ 开头
        stripped = json_str.strip()
        if not stripped.startswith('[{'):
            return False, "JSON 必须是数组格式，以 [{ 开头"
        
        # 检查范围符号
        if '~' in json_str:
            return False, "禁止使用范围符号 ~"
        
        # 检查千位分隔符（在数字上下文中）
        if re.search(r'\d{1,3},\d{3}', json_str):
            return False, "禁止使用千位分隔符 ,"
        
        return True, ""


# 测试代码
if __name__ == '__main__':
    parser = LLMOutputParser()
    
    # 测试用例 1: 标准格式
    test1 = """
    <reasoning>
    1h 周期分析：上涨趋势
    15m 周期分析：突破确认
    决策：开多仓
    </reasoning>
    
    <decision>
    {
      "symbol": "BTCUSDT",
      "action": "open_long",
      "leverage": 2,
      "position_size_usd": 200.0,
      "stop_loss": 84710.0,
      "take_profit": 88580.0,
      "confidence": 75,
      "risk_usd": 30.0
    }
    </decision>
    """
    
    result1 = parser.parse(test1)
    print("测试 1 - 标准格式:")
    print(f"  推理: {result1['reasoning'][:50]}...")
    print(f"  决策: {result1['decision']}")
    print()
    
    # 测试用例 2: 全角字符
    test2 = """
    <decision>
    ｛"symbol"："BTCUSDT"，"action"："hold"，"confidence"：50｝
    </decision>
    """
    
    result2 = parser.parse(test2)
    print("测试 2 - 全角字符:")
    print(f"  决策: {result2['decision']}")
    print()
    
    # 测试用例 3: action 变体
    test3 = """
    <decision>
    {"symbol": "BTCUSDT", "action": "long", "confidence": 80}
    </decision>
    """
    
    result3 = parser.parse(test3)
    action = result3['decision'].get('action', '')
    normalized = parser.normalize_action(action)
    print("测试 3 - action 变体:")
    print(f"  原始: {action}")
    print(f"  标准化: {normalized}")
