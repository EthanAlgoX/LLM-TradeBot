
from typing import Optional

from src.config import Config
from src.agents.agent_config import AgentConfig

def get_agent_timeout(
    config: Config,
    agent_config: Optional[AgentConfig],
    key: str, 
    default_seconds: float
) -> float:
    """
    Resolve per-agent timeout in seconds from config.
    Uses AgentConfig runtime policy and falls back to legacy config path.
    """
    if agent_config is not None and hasattr(agent_config, 'get_timeout'):
        return agent_config.get_timeout(key, default_seconds)
    raw = config.get(f'agents.timeouts.{key}', default_seconds)
    try:
        val = float(raw)
        return val if val > 0 else float(default_seconds)
    except (TypeError, ValueError):
        return float(default_seconds)