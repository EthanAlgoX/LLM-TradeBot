"""
AI Trader - Configuration Management Module
"""
import os
import yaml
from pathlib import Path
from typing import Dict, Any
from dotenv import load_dotenv

# Load environment variables (use override=True to ensure settings in .env override current process environment variables)
load_dotenv(override=True)


class Config:
    """Configuration Management Class"""
    
    _instance = None
    _config: Dict[str, Any] = {}
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._load_config()
        return cls._instance
    
    def _load_config(self):
        """Load configuration file"""
        config_path = Path(__file__).parent.parent.parent / "config.yaml"
        
        if not config_path.exists():
            # If there is no config.yaml, use example
            example_path = Path(__file__).parent.parent.parent / "config.example.yaml"
            if example_path.exists():
                with open(example_path, 'r', encoding='utf-8') as f:
                    self._config = yaml.safe_load(f)
        else:
            with open(config_path, 'r', encoding='utf-8') as f:
                self._config = yaml.safe_load(f)
        
        # from环境变量覆盖敏感信息
        self._override_from_env()
    
    def _override_from_env(self):
        """从环境变量覆盖配置"""
        # Initialize sections if missing
        for section in ['binance', 'deepseek', 'redis']:
            if section not in self._config or self._config[section] is None:
                self._config[section] = {}

        # Binance
        if os.getenv('BINANCE_API_KEY'):
            self._config['binance']['api_key'] = os.getenv('BINANCE_API_KEY')
        # Support both BINANCE_API_SECRET (legacy) and BINANCE_SECRET_KEY (current docs/UI)
        binance_secret = os.getenv('BINANCE_API_SECRET') or os.getenv('BINANCE_SECRET_KEY')
        if binance_secret:
            self._config['binance']['api_secret'] = binance_secret
        
        # DeepSeek (向后兼容)
        if os.getenv('DEEPSEEK_API_KEY'):
            self._config['deepseek']['api_key'] = os.getenv('DEEPSEEK_API_KEY')
        
        # Redis
        if os.getenv('REDIS_HOST'):
            self._config['redis']['host'] = os.getenv('REDIS_HOST')
        if os.getenv('REDIS_PORT'):
            self._config['redis']['port'] = int(os.getenv('REDIS_PORT'))
        
        # LLM 多提供商支持
        if 'llm' not in self._config:
            self._config['llm'] = {}
        
        # API Keys for each provider
        # 支持 ANTHROPIC_API_KEY 作为 CLAUDE_API_KEY 的别名（优先级更高）
        claude_api_key = os.getenv('ANTHROPIC_API_KEY') or os.getenv('CLAUDE_API_KEY')
        
        llm_api_keys = {
            'openai': os.getenv('OPENAI_API_KEY'),
            'deepseek': os.getenv('DEEPSEEK_API_KEY'),
            'claude': claude_api_key,
            'qwen': os.getenv('QWEN_API_KEY'),
            'gemini': os.getenv('GEMINI_API_KEY'),
            'kimi': os.getenv('KIMI_API_KEY'),
            'minimax': os.getenv('MINIMAX_API_KEY'),
            'glm': os.getenv('GLM_API_KEY'),
            'openrouter': os.getenv('OPENROUTER_API_KEY'),
        }
        self._config['llm']['api_keys'] = {k: v for k, v in llm_api_keys.items() if v}

        # Provider/model override via environment
        llm_provider = os.getenv('LLM_PROVIDER')
        if llm_provider:
            self._config['llm']['provider'] = llm_provider.lower()

        llm_model = os.getenv('LLM_MODEL') or os.getenv('DEEPSEEK_MODEL')
        if llm_model:
            self._config['llm']['model'] = llm_model
        
        # Custom base URL (for proxies)
        # 支持 ANTHROPIC_BASE_URL 作为 LLM_BASE_URL 的别名（优先级更高）
        base_url = os.getenv('ANTHROPIC_BASE_URL') or os.getenv('LLM_BASE_URL')
        if base_url:
            self._config['llm']['base_url'] = base_url
    
    def get(self, key_path: str, default=None):
        """
        Get configuration value
        key_path: use dot-separated path, e.g., 'binance.api_key'
        """
        keys = key_path.split('.')
        value = self._config
        
        try:
            for key in keys:
                value = value[key]
            return value
        except (KeyError, TypeError):
            return default
    
    @property
    def binance(self):
        return self._config.get('binance', {})
    
    @property
    def deepseek(self):
        return self._config.get('deepseek', {})
    
    @property
    def trading(self):
        return self._config.get('trading', {})
    
    @property
    def risk(self):
        return self._config.get('risk', {})
    
    @property
    def redis(self):
        return self._config.get('redis', {})
    
    @property
    def logging(self):
        return self._config.get('logging', {})
    
    @property
    def backtest(self):
        return self._config.get('backtest', {})
    
    @property
    def llm(self):
        return self._config.get('llm', {})


# Global configuration instance
config = Config()
