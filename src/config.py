"""
AI Trader - 配置管理模块
"""
import os
import yaml
from pathlib import Path
from typing import Dict, Any
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()


class Config:
    """配置管理类"""
    
    _instance = None
    _config: Dict[str, Any] = {}
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._load_config()
        return cls._instance
    
    def _load_config(self):
        """加载配置文件"""
        config_path = Path(__file__).parent.parent / "config.yaml"
        
        if not config_path.exists():
            # 如果没有config.yaml,使用example
            example_path = Path(__file__).parent.parent / "config.example.yaml"
            if example_path.exists():
                with open(example_path, 'r', encoding='utf-8') as f:
                    self._config = yaml.safe_load(f)
        else:
            with open(config_path, 'r', encoding='utf-8') as f:
                self._config = yaml.safe_load(f)
        
        # 从环境变量覆盖敏感信息
        self._override_from_env()
    
    def _override_from_env(self):
        """从环境变量覆盖配置"""
        if os.getenv('BINANCE_API_KEY'):
            self._config['binance']['api_key'] = os.getenv('BINANCE_API_KEY')
        if os.getenv('BINANCE_API_SECRET'):
            self._config['binance']['api_secret'] = os.getenv('BINANCE_API_SECRET')
        if os.getenv('DEEPSEEK_API_KEY'):
            self._config['deepseek']['api_key'] = os.getenv('DEEPSEEK_API_KEY')
        if os.getenv('REDIS_HOST'):
            self._config['redis']['host'] = os.getenv('REDIS_HOST')
        if os.getenv('REDIS_PORT'):
            self._config['redis']['port'] = int(os.getenv('REDIS_PORT'))
    
    def get(self, key_path: str, default=None):
        """
        获取配置值
        key_path: 使用点分隔的路径，如 'binance.api_key'
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


# 全局配置实例
config = Config()
