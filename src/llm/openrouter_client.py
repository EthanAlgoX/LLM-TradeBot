"""
DeepSeek 客户端实现
==================

DeepSeek 使用 OpenAI 兼容 API，只需修改默认配置。
"""

from .openai_client import OpenAIClient


class OpenRouterClient(OpenAIClient):
    """
    OpenRouter 客户端
    
    继承 OpenAI 客户端，使用 OpenAI 兼容 API。
    """
    
    DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
    DEFAULT_MODEL = "z-ai/glm-4.5-air:free"
    PROVIDER = "openrouter"
