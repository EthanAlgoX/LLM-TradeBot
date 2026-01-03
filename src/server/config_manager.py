import os
import re
from typing import Dict, Any, Optional

class ConfigManager:
    def __init__(self, root_dir: str):
        self.root_dir = root_dir
        self.env_path = os.path.join(root_dir, '.env')
        self.config_dir = os.path.join(root_dir, 'config')
        self.prompt_path = os.path.join(self.config_dir, 'custom_prompt.md')
        
    def get_config(self) -> Dict[str, Any]:
        """Read config from .env and return structured dict"""
        env_vars = {}
        if os.path.exists(self.env_path):
            with open(self.env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    if '=' in line:
                        key, val = line.split('=', 1)
                        env_vars[key.strip()] = val.strip()
        
        # Structure for Frontend
        return {
            "api_keys": {
                "binance_api_key": self._mask_key(env_vars.get('BINANCE_API_KEY', '')),
                "binance_secret_key": self._mask_key(env_vars.get('BINANCE_SECRET_KEY', '')),
                "deepseek_api_key": self._mask_key(env_vars.get('DEEPSEEK_API_KEY', '')),
                "openai_api_key": self._mask_key(env_vars.get('OPENAI_API_KEY', '')),
                "claude_api_key": self._mask_key(env_vars.get('CLAUDE_API_KEY', '')),
                "qwen_api_key": self._mask_key(env_vars.get('QWEN_API_KEY', '')),
                "gemini_api_key": self._mask_key(env_vars.get('GEMINI_API_KEY', ''))
            },
            "trading": {
                "symbol": env_vars.get('TRADING_SYMBOLS', env_vars.get('TRADING_SYMBOL', 'AI500_TOP5')),
                "timeframe": env_vars.get('TRADING_TIMEFRAME', '15m'),
                "leverage": int(env_vars.get('LEVERAGE', 5)),
                "run_mode": env_vars.get('RUN_MODE', 'test')
            },
            "llm": {
                "provider": env_vars.get('LLM_PROVIDER', 'deepseek'),
                "model": env_vars.get('DEEPSEEK_MODEL', 'deepseek-chat')
            }
        }

    def update_config(self, updates: Dict[str, Any]) -> bool:
        """Update .env file with new values"""
        try:
            if not os.path.exists(self.env_path):
                print(f"[ConfigManager] .env file not found at: {self.env_path}")
                return False
                
            # Map frontend keys to .env keys
            key_map = {
                "binance_api_key": "BINANCE_API_KEY",
                "binance_secret_key": "BINANCE_SECRET_KEY",
                "deepseek_api_key": "DEEPSEEK_API_KEY",
                "openai_api_key": "OPENAI_API_KEY",
                "claude_api_key": "CLAUDE_API_KEY",
                "qwen_api_key": "QWEN_API_KEY",
                "gemini_api_key": "GEMINI_API_KEY",
                "symbol": "TRADING_SYMBOLS",  # Support multiple symbols
                "leverage": "LEVERAGE",
                "run_mode": "RUN_MODE",
                "llm_provider": "LLM_PROVIDER"
            }
            
            # Flatten updates
            flat_updates = {}
            for section, values in updates.items():
                if not isinstance(values, dict):
                    continue
                for k, v in values.items():
                    if k in key_map and v:  # Only update if value is provided (ignore empty masked keys)
                        # Don't update if it's still masked
                        if self._is_masked(str(v)):
                            continue
                        flat_updates[key_map[k]] = str(v)

            if not flat_updates:
                return True # Nothing to update
                
            # Read all lines
            with open(self.env_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                
            new_lines = []
            updated_keys = set()
            
            for line in lines:
                stripped = line.strip()
                if not stripped or stripped.startswith('#'):
                    new_lines.append(line)
                    continue
                    
                if '=' in stripped:
                    key, _ = stripped.split('=', 1)
                    key = key.strip()
                    if key in flat_updates:
                        new_lines.append(f"{key}={flat_updates[key]}\n")
                        updated_keys.add(key)
                    else:
                        new_lines.append(line)
                else:
                    new_lines.append(line)
                    
            # Append new keys if any (though usually we expect them to exist)
            for key, val in flat_updates.items():
                if key not in updated_keys:
                    new_lines.append(f"{key}={val}\n")
                    
            with open(self.env_path, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
                
            print(f"[ConfigManager] Config updated successfully: {list(flat_updates.keys())}")
            return True
        except Exception as e:
            print(f"[ConfigManager] Error updating config: {e}")
            import traceback
            traceback.print_exc()
            return False

    def get_prompt(self) -> str:
        """Get current custom prompt or empty string"""
        if os.path.exists(self.prompt_path):
            try:
                with open(self.prompt_path, 'r', encoding='utf-8') as f:
                    return f.read()
            except:
                pass
        return ""

    def update_prompt(self, content: str) -> bool:
        """Save custom prompt"""
        try:
            os.makedirs(self.config_dir, exist_ok=True)
            with open(self.prompt_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        except Exception as e:
            print(f"Error saving prompt: {e}")
            return False

    def _mask_key(self, key: str) -> str:
        if not key or len(key) < 8:
            return "******"
        return f"{key[:4]}...{key[-4:]}"
        
    def _is_masked(self, val: str) -> bool:
        return "..." in val
