import os
import re
from typing import Dict, Any, Optional

class ConfigManager:
    # Runtime storage for Railway deployments (in-memory, not persisted)
    _runtime_config: Dict[str, str] = {}
    
    def __init__(self, root_dir: str):
        self.root_dir = root_dir
        self.env_path = os.path.join(root_dir, '.env')
        self.config_dir = os.path.join(root_dir, 'config')
        self.prompt_path = os.path.join(self.config_dir, 'custom_prompt.md')
        
        # Check if running on Railway
        self.is_railway = bool(os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RAILWAY_PROJECT_ID"))
        
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
                "gemini_api_key": self._mask_key(env_vars.get('GEMINI_API_KEY', '')),
                "kimi_api_key": self._mask_key(env_vars.get('KIMI_API_KEY', '')),
                "minimax_api_key": self._mask_key(env_vars.get('MINIMAX_API_KEY', '')),
                "glm_api_key": self._mask_key(env_vars.get('GLM_API_KEY', '')),
                "openrouter_api_key": self._mask_key(env_vars.get('OPENROUTER_API_KEY', ''))
            },
            "trading": {
                "symbol": env_vars.get('TRADING_SYMBOLS', env_vars.get('TRADING_SYMBOL', 'AI500_TOP5')),
                "timeframe": env_vars.get('TRADING_TIMEFRAME', '15m'),
                "leverage": int(env_vars.get('LEVERAGE', 5)),
                "run_mode": env_vars.get('RUN_MODE', 'test')
            },
            "llm": {
                "provider": env_vars.get('LLM_PROVIDER', 'none'),
                "model": env_vars.get('LLM_MODEL', env_vars.get('DEEPSEEK_MODEL', ''))
            },
            "agents": self._get_agents_config()
        }

    def update_config(self, updates: Dict[str, Any], railway_mode: bool = False) -> bool:
        """Update configuration. On Railway, applies to runtime environment only."""
        try:
            # Map frontend keys to .env keys
            key_map = {
                "binance_api_key": "BINANCE_API_KEY",
                "binance_secret_key": "BINANCE_SECRET_KEY",
                "deepseek_api_key": "DEEPSEEK_API_KEY",
                "openai_api_key": "OPENAI_API_KEY",
                "claude_api_key": "CLAUDE_API_KEY",
                "qwen_api_key": "QWEN_API_KEY",
                "gemini_api_key": "GEMINI_API_KEY",
                "kimi_api_key": "KIMI_API_KEY",
                "minimax_api_key": "MINIMAX_API_KEY",
                "glm_api_key": "GLM_API_KEY",
                "openrouter_api_key": "OPENROUTER_API_KEY",
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
                agents_update = updates.get('agents')
                if isinstance(agents_update, dict):
                    self._update_agents_config(agents_update)
                return True  # Nothing else to update
            
            # === Railway Mode: Apply to runtime environment ===
            if railway_mode or self.is_railway:
                for key, val in flat_updates.items():
                    # Store in runtime config
                    ConfigManager._runtime_config[key] = val
                    # Also apply to os.environ for immediate effect
                    os.environ[key] = val
                
                # Signal to main loop that config has changed
                try:
                    from src.server.state import global_state
                    global_state.config_changed = True
                except Exception as e:
                    print(f"[ConfigManager] Warning: Could not set config_changed flag: {e}")
                # Reload runtime config (same process)
                try:
                    from src.config import config
                    config._load_config()
                except Exception as e:
                    print(f"[ConfigManager] Warning: Could not reload config: {e}")
                
                print(f"[ConfigManager] Runtime config applied (Railway mode): {list(flat_updates.keys())}")
                return True
            
            # === Local Mode: Update .env file ===
            if not os.path.exists(self.env_path):
                print(f"[ConfigManager] .env file not found at: {self.env_path} (applying runtime config only)")
                for key, val in flat_updates.items():
                    ConfigManager._runtime_config[key] = val
                    os.environ[key] = val
                try:
                    from src.server.state import global_state
                    global_state.config_changed = True
                except Exception as e:
                    print(f"[ConfigManager] Warning: Could not set config_changed flag: {e}")
                try:
                    from src.config import config
                    config._load_config()
                except Exception as e:
                    print(f"[ConfigManager] Warning: Could not reload config: {e}")
                return True
                
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
                # Ensure os.environ reflects the new values for the current process
                os.environ[key] = str(val)
                    
            with open(self.env_path, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
                
            print(f"[ConfigManager] Config updated successfully: {list(flat_updates.keys())}")
            
            # === Handle agents config ===
            if 'agents' in updates and isinstance(updates['agents'], dict):
                self._update_agents_config(updates['agents'])
            
            # Signal to main loop that config has changed (local mode)
            try:
                from src.server.state import global_state
                global_state.config_changed = True
            except Exception as e:
                print(f"[ConfigManager] Warning: Could not set config_changed flag: {e}")
            # Reload runtime config (same process)
            try:
                from src.config import config
                config._load_config()
            except Exception as e:
                print(f"[ConfigManager] Warning: Could not reload config: {e}")
            return True
        except Exception as e:
            print(f"[ConfigManager] Error updating config: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def _update_agents_config(self, agents: Dict[str, Any]) -> bool:
        """Update agents configuration in config.yaml"""
        import yaml
        try:
            config_yaml_path = os.path.join(self.root_dir, 'config.yaml')
            
            # Read existing config.yaml
            config_data = {}
            if os.path.exists(config_yaml_path):
                with open(config_yaml_path, 'r', encoding='utf-8') as f:
                    config_data = yaml.safe_load(f) or {}
            
            # Update agents section while preserving non-toggle policy keys (e.g. timeouts).
            existing_agents = config_data.get('agents', {})
            if not isinstance(existing_agents, dict):
                existing_agents = {}
            merged_agents = dict(existing_agents)
            for key, value in agents.items():
                merged_agents[key] = value
            config_data['agents'] = merged_agents
            
            # Write back to config.yaml
            with open(config_yaml_path, 'w', encoding='utf-8') as f:
                yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)
            
            # Also set environment variables for immediate effect
            for agent_name, enabled in agents.items():
                if not isinstance(enabled, bool):
                    continue
                env_key = f"AGENT_{agent_name.upper()}"
                os.environ[env_key] = 'true' if enabled else 'false'
            
            print(f"[ConfigManager] Agents config updated: {list(agents.keys())}")
            return True
        except Exception as e:
            print(f"[ConfigManager] Error updating agents config: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def _get_agents_config(self) -> Dict[str, bool]:
        """Read agents configuration from config.yaml, return defaults if not found"""
        import yaml
        from src.agents.agent_config import AgentConfig
        
        # Default values come from AgentConfig to avoid drift.
        defaults = AgentConfig().get_enabled_agents()
        
        try:
            config_yaml_path = os.path.join(self.root_dir, 'config.yaml')
            if os.path.exists(config_yaml_path):
                with open(config_yaml_path, 'r', encoding='utf-8') as f:
                    config_data = yaml.safe_load(f) or {}
                agents = config_data.get('agents', {})
                if 'trend_agent' in agents and 'trend_agent_llm' not in agents:
                    agents['trend_agent_llm'] = agents['trend_agent']
                if 'setup_agent' in agents and 'setup_agent_llm' not in agents:
                    agents['setup_agent_llm'] = agents['setup_agent']
                if 'trigger_agent' in agents and 'trigger_agent_llm' not in agents:
                    agents['trigger_agent_llm'] = agents['trigger_agent']
                if 'reflection_agent' in agents and 'reflection_agent_llm' not in agents:
                    agents['reflection_agent_llm'] = agents['reflection_agent']
                # Merge with defaults (config values override defaults) while
                # returning toggle fields only for UI compatibility.
                normalized = {}
                for key in defaults.keys():
                    if key in agents:
                        normalized[key] = bool(agents.get(key))
                return {**defaults, **normalized}
        except Exception as e:
            print(f"[ConfigManager] Error reading agents config: {e}")
        
        return defaults

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
