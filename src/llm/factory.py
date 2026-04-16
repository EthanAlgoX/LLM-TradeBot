"""
LLM 客户端工厂
=============

提供统一的客户端创建接口，根据 provider 名称返回对应实现。
"""

from typing import Dict, Type
from .base import BaseLLMClient, LLMConfig
from .openai_client import OpenAIClient
from .deepseek_client import DeepSeekClient
from .claude_client import ClaudeClient
from .qwen_client import QwenClient
from .gemini_client import GeminiClient
from .kimi_client import KimiClient
from .minimax_client import MiniMaxClient
from .glm_client import GLMClient
from .openrouter_client import OpenRouterClient


# 注册所有支持的提供商
PROVIDERS: Dict[str, Type[BaseLLMClient]] = {
    "openai": OpenAIClient,
    "deepseek": DeepSeekClient,
    "claude": ClaudeClient,
    "qwen": QwenClient,
    "gemini": GeminiClient,
    "kimi": KimiClient,
    "minimax": MiniMaxClient,
    "glm": GLMClient,
    "openrouter": OpenRouterClient
}


def create_client(provider: str, config: LLMConfig) -> BaseLLMClient:
    """
    工厂方法：根据 provider 创建对应客户端
    
    Args:
        provider: 提供商名称 (openai, deepseek, claude, qwen, gemini, kimi, minimax, glm)
        config: LLM 配置
        
    Returns:
        对应的 LLM 客户端实例
        
    Raises:
        ValueError: 不支持的提供商
        
    Example:
        >>> config = LLMConfig(api_key="sk-xxx")
        >>> client = create_client("deepseek", config)
        >>> response = client.chat("You are helpful", "Hello!")
        >>> print(response.content)
    """
    provider_lower = provider.lower()
    
    client_class = PROVIDERS.get(provider_lower)
    if not client_class:
        supported = ", ".join(PROVIDERS.keys())
        raise ValueError(
            f"Unsupported provider: '{provider}'. "
            f"Supported providers: {supported}"
        )
    
    return client_class(config)


def get_supported_providers() -> list:
    """获取所有支持的提供商列表"""
    return list(PROVIDERS.keys())


def register_provider(name: str, client_class: Type[BaseLLMClient]):
    """
    注册自定义提供商
    
    Args:
        name: 提供商名称
        client_class: 客户端类（必须继承 BaseLLMClient）
    """
    if not issubclass(client_class, BaseLLMClient):
        raise TypeError("client_class must be a subclass of BaseLLMClient")
    
    PROVIDERS[name.lower()] = client_class
