"""
LLM 抽象基类和配置
==================

提供统一的 LLM 客户端接口，支持多种 LLM 提供商。
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List
import httpx


@dataclass
class LLMConfig:
    """LLM 配置数据类"""
    api_key: str
    base_url: Optional[str] = None
    model: Optional[str] = None
    timeout: int = 120
    max_retries: int = 5
    temperature: float = 0.7
    max_tokens: int = 4096
    
    def __post_init__(self):
        if not self.api_key:
            raise ValueError("api_key is required")


@dataclass
class ChatMessage:
    """聊天消息"""
    role: str  # "system", "user", "assistant"
    content: str


@dataclass
class LLMResponse:
    """LLM 响应"""
    content: str
    model: str
    provider: str
    usage: Dict[str, int] = field(default_factory=dict)
    raw_response: Optional[Dict] = None


class BaseLLMClient(ABC):
    """
    LLM 客户端抽象基类
    
    所有 LLM 提供商客户端必须继承此类并实现抽象方法。
    """
    
    # 子类需要覆盖的默认值
    DEFAULT_BASE_URL: str = ""
    DEFAULT_MODEL: str = ""
    PROVIDER: str = "base"
    
    def __init__(self, config: LLMConfig):
        """
        初始化 LLM 客户端
        
        Args:
            config: LLM 配置
        """
        self.config = config
        self.base_url = config.base_url or self.DEFAULT_BASE_URL
        self.model = config.model or self.DEFAULT_MODEL
        self.client = httpx.Client(timeout=config.timeout)
    
    @abstractmethod
    def _build_headers(self) -> Dict[str, str]:
        """构建请求头（子类实现不同认证方式）"""
        pass
    
    @abstractmethod
    def _build_request_body(
        self, 
        messages: List[ChatMessage],
        **kwargs
    ) -> Dict[str, Any]:
        """构建请求体（子类可覆盖不同格式）"""
        pass
    
    @abstractmethod
    def _parse_response(self, response: Dict[str, Any]) -> LLMResponse:
        """解析响应（子类可覆盖不同格式）"""
        pass
    
    def _build_url(self) -> str:
        """构建请求 URL"""
        return f"{self.base_url}/chat/completions"
    
    def _messages_to_list(self, messages: List[ChatMessage]) -> List[Dict[str, str]]:
        """将 ChatMessage 列表转换为字典列表"""
        return [{"role": m.role, "content": m.content} for m in messages]
    
    def chat(
        self, 
        system_prompt: str, 
        user_prompt: str,
        **kwargs
    ) -> LLMResponse:
        """
        统一调用入口（简化版）
        
        Args:
            system_prompt: 系统提示词
            user_prompt: 用户提示词
            **kwargs: 额外参数（temperature, max_tokens 等）
            
        Returns:
            LLMResponse 对象
        """
        messages = [
            ChatMessage(role="system", content=system_prompt),
            ChatMessage(role="user", content=user_prompt)
        ]
        return self.chat_messages(messages, **kwargs)
    
    def chat_messages(
        self, 
        messages: List[ChatMessage],
        **kwargs
    ) -> LLMResponse:
        """
        多轮对话调用
        
        Args:
            messages: 消息列表
            **kwargs: 额外参数
            
        Returns:
            LLMResponse 对象
        """
        url = self._build_url()
        headers = self._build_headers()
        body = self._build_request_body(messages, **kwargs)
        
        last_error = None
        for attempt in range(self.config.max_retries):
            try:
                response = self.client.post(url, json=body, headers=headers)
                response.raise_for_status()
                return self._parse_response(response.json())
            except httpx.HTTPStatusError as e:
                last_error = e
                if e.response.status_code in [429, 500, 502, 503, 504]:
                    # 可重试的 HTTP 错误
                    import time
                    wait_time = 2 ** attempt
                    print(f"⚠️ LLM HTTP Error {e.response.status_code}, retrying in {wait_time}s (attempt {attempt + 1}/{self.config.max_retries})")
                    time.sleep(wait_time)
                    continue
                raise
            except (httpx.ConnectError, httpx.ReadError, httpx.WriteError, 
                    ConnectionResetError, ConnectionError, OSError) as e:
                # 网络连接错误，需要重试
                last_error = e
                import time
                wait_time = 2 ** attempt
                print(f"⚠️ LLM Connection Error: {type(e).__name__}, retrying in {wait_time}s (attempt {attempt + 1}/{self.config.max_retries})")
                time.sleep(wait_time)
                continue
            except Exception as e:
                last_error = e
                # 其他未知错误，最后一次尝试后抛出
                if attempt < self.config.max_retries - 1:
                    import time
                    wait_time = 2 ** attempt
                    print(f"⚠️ LLM Unexpected Error: {type(e).__name__}: {e}, retrying in {wait_time}s")
                    time.sleep(wait_time)
                    continue
                raise
        
        raise last_error or Exception("Max retries exceeded")

    
    def close(self):
        """关闭 HTTP 客户端"""
        self.client.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
