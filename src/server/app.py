from fastapi import FastAPI, Body, HTTPException, Request, Response, Depends, Cookie
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
import secrets
from typing import Optional, Dict, List
from pathlib import Path
import yaml

from src.server.state import global_state

# Input Model
from pydantic import BaseModel
class ControlCommand(BaseModel):
    action: str  # start, pause, stop, restart, set_interval
    interval: float = None  # Optional: interval in minutes for set_interval action

class LoginRequest(BaseModel):
    password: str

from fastapi import UploadFile, File
import shutil

app = FastAPI(title="LLM-TradeBot Dashboard")

# Enable CORS (rest unchanged)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Get absolute path to the web directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB_DIR = os.path.join(BASE_DIR, 'web')

# Authentication Configuration
WEB_PASSWORD = os.environ.get("WEB_PASSWORD", "EthanAlgoX")  # Admin password

# Auto-detect production environment (Railway sets RAILWAY_* env vars and PORT)
IS_RAILWAY = bool(os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RAILWAY_PROJECT_ID"))
IS_PRODUCTION = IS_RAILWAY or os.environ.get("DEPLOYMENT_MODE", "local") != "local"

SESSION_COOKIE_NAME = "tradebot_session"
# Session store: {session_id: role} where role is 'admin' or 'user'
VALID_SESSIONS = {}

def verify_auth(request: Request):
    """Dependency to verify login and return role"""
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_id or session_id not in VALID_SESSIONS:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return VALID_SESSIONS[session_id]  # Return 'admin' or 'user'

def verify_admin(role: str = Depends(verify_auth)):
    """Dependency to enforce Admin access"""
    if role != 'admin':
        raise HTTPException(status_code=403, detail="User mode: No permission to perform this action.")
    return True

import math

def clean_nans(obj):
    """Recursively replace NaN/Inf with None for JSON compliance"""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
    elif isinstance(obj, dict):
        return {k: clean_nans(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_nans(i) for i in obj]
    return obj

# Public endpoint for system info (no auth required)
@app.get("/api/info")
async def get_system_info():
    return {
        "deployment_mode": "railway" if IS_RAILWAY else ("production" if IS_PRODUCTION else "local"),
        "requires_auth": True
    }

# Authentication Endpoints
@app.post("/api/login")
async def login(response: Response, data: LoginRequest):
    role = None
    
    # Universal Login Logic (Robust for both Local and Railway)
    # 1. Admin Login: Password matches WEB_PASSWORD or hardcoded known admin passwords
    if data.password == WEB_PASSWORD or data.password == "admin" or data.password == "EthanAlgoX":
        role = 'admin'
    # 2. User Login: Password is 'guest' OR Empty -> Read Only
    elif not data.password or data.password == "guest":
        role = 'user'

    if role:
        session_id = secrets.token_urlsafe(32)
        VALID_SESSIONS[session_id] = role
        
        # Cookie settings for both local (HTTP) and Railway (HTTPS) deployment
        response.set_cookie(
            key=SESSION_COOKIE_NAME, 
            value=session_id, 
            httponly=True, 
            max_age=86400 * 7,  # 7 days
            samesite="none" if IS_PRODUCTION else "lax",  # "none" required for cross-site HTTPS
            secure=IS_PRODUCTION  # Must be True for HTTPS (Railway)
        )
        return {"status": "success", "role": role}
    else:
        raise HTTPException(status_code=401, detail="Invalid password")

@app.post("/api/logout")
async def logout(response: Response, request: Request):
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id in VALID_SESSIONS:
        del VALID_SESSIONS[session_id]
    response.delete_cookie(SESSION_COOKIE_NAME)
    return {"status": "success"}

@app.get("/api/auth/status")
async def check_auth_status(request: Request):
    try:
        verify_auth(request)
        return {"status": "authenticated"}
    except HTTPException:
        return {"status": "unauthenticated"}

# API Endpoints
@app.get("/api/status")
async def get_status(authenticated: bool = Depends(verify_auth)):
    import time
    import re

    def _get_strategy_timeframes():
        try:
            config_path = Path(__file__).resolve().parents[2] / 'config' / 'data_alignment.yaml'
            if not config_path.exists():
                return ['5m', '15m', '1h']
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = yaml.safe_load(f) or {}
            mode = cfg.get('mode', 'backtest')
            tf_map = (cfg.get(mode, {}) or {}).get('timeframes', {}) or {}
            timeframes = list(tf_map.keys())
            if timeframes:
                return timeframes
            fallback_map = cfg.get('timeframe_settings', {}) or {}
            timeframes = list(fallback_map.keys())
            return timeframes if timeframes else ['5m', '15m', '1h']
        except Exception:
            return ['5m', '15m', '1h']

    timeframes = _get_strategy_timeframes()
    
    # Check and update demo expiration status
    if global_state.demo_mode_active and global_state.demo_start_time:
        elapsed = time.time() - global_state.demo_start_time
        if elapsed >= global_state.demo_limit_seconds:
            global_state.demo_expired = True
            if global_state.execution_mode == "Running":
                global_state.execution_mode = "Stopped"
                global_state.add_log("⏰ Demo 时间已到 (20分钟限制)，系统已自动停止。请配置您自己的 API Key 继续使用。")
    
    # Calculate demo time remaining
    demo_time_remaining = 0
    if global_state.demo_mode_active and global_state.demo_start_time and not global_state.demo_expired:
        elapsed = time.time() - global_state.demo_start_time
        demo_time_remaining = max(0, global_state.demo_limit_seconds - elapsed)
    
    def _filter_simplified_logs(logs: List[str]) -> List[str]:
        agent_tags = [
            '[📊 SYSTEM]',
            '[🔄 CONFIG]',
            '[🎯 SYSTEM]',
            '[🕵️ ORACLE]',
            '[👨‍🔬 STRATEGIST]',
            '[🔮 PROPHET]',
            '[🐂 Long Case]',
            '[🐻 Short Case]',
            '[⚖️ CRITIC]',
            '[⚖️ Final Decision]',
            '[🛡️ GUARDIAN]',
            '[🚀 EXECUTOR]',
            '[Execution]',
            '[🧠 REFLECTION]'
        ]
        agent_keywords = [
            'DataSyncAgent',
            'QuantAnalystAgent',
            'PredictAgent',
            'DecisionCoreAgent',
            'RiskAuditAgent',
            'ExecutionEngine',
            'StrategyEngine',
            'ReflectionAgent',
            'ReflectionAgentLLM',
            'TrendAgent',
            'TrendAgentLLM',
            'SetupAgent',
            'SetupAgentLLM',
            'TriggerAgent',
            'TriggerAgentLLM'
        ]
        status_keywords = [
            '⏹️', '⏸️', '▶️',
            'STOPPED', 'PAUSED', 'RESUMED', 'START'
        ]
        
        def _clean_log_line(line: str) -> str:
            """Remove file:function patterns like 'src.api.binance_websocket:__init__' from log lines"""
            # Remove ANSI color codes first
            clean = re.sub(r'\x1b\[[0-9;]*m', '', line or '')
            # Remove timestamp pattern: 2026-01-08 00:00:00 | LEVEL    | module:func -
            # This captures everything up to and including the " - " after the function name
            clean = re.sub(r'^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*\|\s*\w+\s*\|\s*[\w\.]+:[\w_]+\s*-\s*', '', clean)
            # Fallback: if the above didn't match, try to remove just the module:func part
            clean = re.sub(r'^[\w\.]+:[\w_]+\s*-\s*', '', clean)
            return clean.strip()
        
        filtered = []
        for line in logs:
            clean_line = re.sub(r'\x1b\[[0-9;]*m', '', line or '')
            if ('WARNING' in clean_line or
                'ERROR' in clean_line or
                re.search(r'\bwarn\b', clean_line, re.IGNORECASE) or
                re.search(r'\berror\b', clean_line, re.IGNORECASE) or
                '⚠️' in clean_line or
                '❌' in clean_line):
                filtered.append(_clean_log_line(line))
                continue
            if any(tag in clean_line for tag in agent_tags):
                filtered.append(_clean_log_line(line))
                continue
            if any(keyword in clean_line for keyword in agent_keywords):
                filtered.append(_clean_log_line(line))
                continue
            if any(keyword in clean_line for keyword in status_keywords):
                filtered.append(_clean_log_line(line))
                continue
            if '━━━' in clean_line or 'Cycle #' in clean_line:
                filtered.append(_clean_log_line(line))
                continue
        return filtered

    log_tail = 200
    simplified_tail = 300
    logs_tail = global_state.recent_logs[-log_tail:]
    simplified_logs = _filter_simplified_logs(global_state.recent_logs[-simplified_tail:])
    if len(simplified_logs) > log_tail:
        simplified_logs = simplified_logs[-log_tail:]

    account_payload = dict(global_state.account_overview or {})
    realized_pnl = float(getattr(global_state, 'cumulative_realized_pnl', 0.0) or 0.0)
    unrealized_pnl = float(account_payload.get('total_pnl', 0.0) or 0.0)
    account_payload['realized_pnl'] = realized_pnl
    account_payload['unrealized_pnl'] = unrealized_pnl
    account_payload['total_pnl'] = realized_pnl + unrealized_pnl

    data = {
        "system": {
            "running": global_state.is_running,
            "mode": global_state.execution_mode,
            "is_test_mode": global_state.is_test_mode,
            "cycle_counter": global_state.cycle_counter,
            "cycle_interval": global_state.cycle_interval,
            "current_cycle_id": global_state.current_cycle_id,
            "uptime_start": global_state.start_time,
            "last_heartbeat": global_state.last_update,
            "symbols": global_state.symbols,  # 🆕 Active trading symbols (AI500 Top5 support)
            "timeframes": timeframes,
            "current_symbol": getattr(global_state, 'current_symbol', '')
        },
        "demo": {
            "demo_mode_active": global_state.demo_mode_active,
            "demo_expired": global_state.demo_expired,
            "demo_time_remaining": int(demo_time_remaining)
        },
        "market": {
            "price": global_state.current_price,
            "regime": global_state.market_regime,
            "position": global_state.price_position
        },
        "agents": {
            "critic_confidence": global_state.critic_confidence,
            "guardian_status": global_state.guardian_status,
            "symbol_selector": getattr(global_state, 'symbol_selector', {})
        },
        "account": account_payload,
        "virtual_account": {
            "is_test_mode": global_state.is_test_mode,
            "initial_balance": global_state.virtual_initial_balance,
            "current_balance": global_state.virtual_balance,
            "available_balance": global_state.virtual_balance - sum((pos.get('position_value', 0) / pos.get('leverage', 1)) for pos in global_state.virtual_positions.values()),
            "positions": global_state.virtual_positions,
            "total_unrealized_pnl": sum(pos.get('unrealized_pnl', 0) for pos in global_state.virtual_positions.values()),
            "cumulative_realized_pnl": global_state.cumulative_realized_pnl  # Total realized PnL from closed trades
        },
        "account_alert": {
            "active": global_state.account_alert_active,
            "failure_count": global_state.account_failure_count
        },
        "chart_data": {
            "equity": global_state.equity_history,
            "balance_history": global_state.balance_history,
            "initial_balance": global_state.initial_balance
        },
        "decision": global_state.latest_decision,
        "decision_history": global_state.decision_history[:10],
        "trade_history": global_state.trade_history[:20],
        "logs": logs_tail,
        "logs_simplified": simplified_logs
    }
    return clean_nans(global_state._serialize_obj(data))

@app.post("/api/control")
async def control_bot(cmd: ControlCommand, authenticated: bool = Depends(verify_admin)):
    import time
    action = cmd.action.lower()
    
    # Default API key detection (check if user has configured their own key)
    DEFAULT_API_KEY_PREFIX = "sk-"  # Most default keys start with this or are empty
    deepseek_key = os.environ.get("DEEPSEEK_API_KEY", "")
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    claude_key = os.environ.get("ANTHROPIC_API_KEY", "")
    
    # Consider using default API if all keys are empty or match known demo patterns
    is_using_default_api = (
        not deepseek_key or 
        deepseek_key.startswith("demo_") or 
        deepseek_key == "your_deepseek_api_key_here"
    ) and not openai_key and not claude_key
    
    if action == "start":
        was_stopped = global_state.execution_mode == "Stopped"
        # Check if demo has expired
        if global_state.demo_expired:
            raise HTTPException(
                status_code=403, 
                detail="Demo 时间已用尽 (20分钟限制)。请在 Settings > API Keys 中配置您自己的 API Key 后重试。"
            )
        
        # Activate demo mode if using default API
        if is_using_default_api:
            if not global_state.demo_mode_active:
                global_state.demo_mode_active = True
                global_state.demo_start_time = time.time()
                global_state.add_log("⚠️ 正在使用默认 API，20分钟后将自动停止。请配置您自己的 API Key 以解除限制。")
        else:
            # User has their own API key, disable demo mode
            global_state.demo_mode_active = False
            global_state.demo_expired = False
            global_state.demo_start_time = None
        
        global_state.execution_mode = "Running"
        if was_stopped:
            global_state.cycle_counter = 0
            global_state.current_cycle_id = ""
            global_state.cycle_positions_opened = 0
            # 🆕 清空交易记录，防止使用历史数据进行复盘
            global_state.trade_history = []
            global_state.decision_history = []
            global_state.balance_history = []
            global_state.add_log("🔁 Cycle counter reset after stop (history cleared)")
        global_state.add_log("▶️ System Resumed by User")
        
    elif action == "pause":
        global_state.execution_mode = "Paused"
        global_state.add_log("⏸️ System Paused by User")
        
    elif action == "stop":
        global_state.execution_mode = "Stopped"
        global_state.add_log("⏹️ System Stopped by User")

    elif action == "set_interval":
        if cmd.interval and cmd.interval in [0.5, 1, 3, 5, 15, 30, 60]:
            global_state.cycle_interval = cmd.interval
            global_state.add_log(f"⏱️ Cycle interval updated to {cmd.interval} minutes")
            return {"status": "success", "interval": cmd.interval}
        else:
            raise HTTPException(status_code=400, detail="Invalid interval. Must be 0.5, 1, 3, 5, 15, 30, or 60 minutes.")
    else:
        raise HTTPException(status_code=400, detail="Invalid action")
    
    return {
        "status": "success", 
        "mode": global_state.execution_mode,
        "demo_mode_active": global_state.demo_mode_active,
        "demo_expired": global_state.demo_expired
    }

@app.post("/api/test_log")
async def test_log(authenticated: bool = Depends(verify_auth)):
    """Test endpoint to inject logs for debugging"""
    from src.utils.logger import log
    global_state.add_log("[🧪 TEST] Manual test log from API")
    log.info("[🧪 TEST] Test log via logger")
    return {
        "status": "success",
        "logs_count": len(global_state.recent_logs),
        "latest_logs": global_state.recent_logs[-5:] if global_state.recent_logs else []
    }

@app.get("/api/symbol_stats")
async def get_symbol_stats(authenticated: bool = Depends(verify_auth)):
    """
    Get per-symbol performance statistics for current session only (cycle >= 1)
    Returns: List of symbol stats sorted by PnL descending
    """
    from collections import defaultdict
    
    # Filter trades from current session (cycle >= 1)
    def get_cycle_num(trade):
        """Safely get cycle as int, handling string values"""
        cycle = trade.get('cycle', 0)
        if isinstance(cycle, str):
            try:
                return int(cycle)
            except (ValueError, TypeError):
                return 0
        return cycle or 0
    
    current_session_trades = [
        trade for trade in global_state.trade_history 
        if get_cycle_num(trade) >= 1
    ]
    
    # Aggregate by symbol
    symbol_stats = defaultdict(lambda: {
        'total_pnl': 0.0,
        'total_cost': 0.0,
        'trade_count': 0,
        'win_count': 0,
        'loss_count': 0,
        'trades': []
    })
    
    for trade in current_session_trades:
        symbol = trade.get('symbol', 'UNKNOWN')
        pnl = trade.get('pnl', 0.0)
        cost = trade.get('cost', 0.0) or trade.get('position_size_usd', 0.0)
        
        stats = symbol_stats[symbol]
        stats['total_pnl'] += pnl
        stats['total_cost'] += cost
        stats['trade_count'] += 1
        stats['trades'].append(trade)
        
        if pnl > 0:
            stats['win_count'] += 1
        elif pnl < 0:
            stats['loss_count'] += 1
    
    # Calculate derived metrics
    result = []
    for symbol, stats in symbol_stats.items():
        win_rate = (stats['win_count'] / stats['trade_count'] * 100) if stats['trade_count'] > 0 else 0
        return_rate = (stats['total_pnl'] / stats['total_cost'] * 100) if stats['total_cost'] > 0 else 0
        
        result.append({
            'symbol': symbol,
            'total_pnl': round(stats['total_pnl'], 2),
            'return_rate': round(return_rate, 2),
            'trade_count': stats['trade_count'],
            'win_count': stats['win_count'],
            'loss_count': stats['loss_count'],
            'win_rate': round(win_rate, 1)
        })
    
    # Sort by total PnL descending
    result.sort(key=lambda x: x['total_pnl'], reverse=True)
    
    return {
        "status": "success",
        "data": result,
        "total_symbols": len(result),
        "session_trade_count": len(current_session_trades)
    }


@app.post("/api/upload_prompt")
async def upload_prompt(file: UploadFile = File(...), authenticated: bool = Depends(verify_admin)):
    try:
        # Determine config directory
        config_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'config')
        os.makedirs(config_dir, exist_ok=True)
        
        file_path = os.path.join(config_dir, 'custom_prompt.md')
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        global_state.add_log(f"📝 Custom prompt uploaded: {file.filename}")
        log.info(f"Custom prompt saved to: {file_path}")
        return {"status": "success", "message": "Custom prompt uploaded successfully. It will be used in the next decision cycle."}
    except Exception as e:
        log.error(f"Failed to upload prompt: {e}")
        raise HTTPException(status_code=500, detail=str(e))

from src.server.config_manager import ConfigManager
config_manager = ConfigManager(BASE_DIR)

@app.get("/api/config")
async def get_config(authenticated: bool = Depends(verify_auth)):
    """Get current configuration (masked)"""
    return config_manager.get_config()

@app.get("/api/config/prompt")
async def get_prompt_content(authenticated: bool = Depends(verify_auth)):
    """Get content of custom prompt file"""
    return {"content": config_manager.get_prompt()}

@app.post("/api/config")
async def update_config_endpoint(data: dict = Body(...), authenticated: bool = Depends(verify_admin)):
    """Update configuration. On Railway, applies to runtime environment only."""
    success = config_manager.update_config(data, railway_mode=IS_RAILWAY)
    if success:
        if IS_RAILWAY:
            return {
                "status": "success", 
                "message": "✅ Configuration applied to runtime! Note: Changes will take effect immediately but won't persist after Railway redeploys. For permanent settings, add them to Railway Dashboard → Variables."
            }
        else:
            return {"status": "success", "message": "Configuration updated. Please restart the bot if you changed API keys."}
    else:
        raise HTTPException(status_code=500, detail="Failed to update configuration")

@app.post("/api/agents/config")
async def update_agent_config(data: dict = Body(...), authenticated: bool = Depends(verify_auth)):
    """Update agent enable/disable configuration"""
    agents = data.get("agents", {})

    if not agents or not isinstance(agents, dict):
        raise HTTPException(status_code=400, detail="No agent configuration provided")

    # Filter/normalize keys and merge with persisted defaults
    from src.agents.agent_config import AgentConfig
    valid_keys = set(AgentConfig().get_enabled_agents().keys())
    filtered = {k: bool(v) for k, v in agents.items() if k in valid_keys}
    if not filtered:
        raise HTTPException(status_code=400, detail="No valid agent configuration provided")

    current = getattr(global_state, 'agent_config', None) or config_manager._get_agents_config()
    merged = {**current, **filtered}

    # Update global state with new agent config
    global_state.agent_config = merged
    # Persist to config.yaml for next restart and export env flags
    config_manager._update_agents_config(merged)
    
    # Log the change
    enabled = [k for k, v in merged.items() if v]
    disabled = [k for k, v in merged.items() if not v]
    global_state.add_log(f"🔧 Agent config updated: {len(enabled)} enabled, {len(disabled)} disabled")
    
    return {
        "status": "success",
        "message": f"Agent configuration updated. Enabled: {', '.join(enabled) if enabled else 'none'}",
        "agents": merged
    }

@app.get("/api/agents/config")
async def get_agent_config(authenticated: bool = Depends(verify_auth)):
    """Get current agent configuration"""
    # Return current agent config from global state
    agents = getattr(global_state, 'agent_config', None)
    if not agents:
        agents = config_manager._get_agents_config()
        global_state.agent_config = agents
    return {"agents": agents}

@app.post("/api/config/prompt")
async def update_prompt_text(data: dict = Body(...), authenticated: bool = Depends(verify_admin)):
    """Update custom prompt via text editor"""
    content = data.get("content", "")
    success = config_manager.update_prompt(content)
    if success:
        return {"status": "success", "message": "Prompt updated successfully. Will effect next cycle."}
    else:
        raise HTTPException(status_code=500, detail="Failed to save prompt")

@app.get("/api/config/default_prompt")
async def get_default_prompt(authenticated: bool = Depends(verify_auth)):
    """Get the system default prompt template"""
    try:
        from src.config.default_prompt_template import DEFAULT_SYSTEM_PROMPT
        return {"content": DEFAULT_SYSTEM_PROMPT}
    except ImportError:
         raise HTTPException(status_code=500, detail="Default prompt template not found")

# ============================================================================
# Multi-Account API Endpoints
# ============================================================================

from src.exchanges import AccountManager, ExchangeAccount, ExchangeType

# Initialize account manager for API use
_account_manager = None

def get_account_manager():
    """Lazy initialization of account manager"""
    global _account_manager
    if _account_manager is None:
        import os
        from pathlib import Path
        config_path = Path(BASE_DIR) / "config" / "accounts.json"
        _account_manager = AccountManager(str(config_path))
        _account_manager.load_from_file()
    return _account_manager

@app.get("/api/accounts")
async def list_accounts(authenticated: bool = Depends(verify_auth)):
    """List all configured trading accounts"""
    manager = get_account_manager()
    accounts = manager.list_accounts()
    return {
        "accounts": [acc.to_dict() for acc in accounts],
        "count": len(accounts)
    }

@app.get("/api/accounts/{account_id}")
async def get_account(account_id: str, authenticated: bool = Depends(verify_auth)):
    """Get details of a specific account"""
    manager = get_account_manager()
    account = manager.get_account(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account.to_dict()

class AccountCreate(BaseModel):
    id: str
    name: str
    exchange: str = "binance"
    enabled: bool = True
    testnet: bool = True

@app.post("/api/accounts")
async def create_account(data: AccountCreate, authenticated: bool = Depends(verify_auth)):
    """Create a new trading account"""
    manager = get_account_manager()
    
    # Validate exchange type
    try:
        exchange_type = ExchangeType(data.exchange.lower())
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unsupported exchange: {data.exchange}")
    
    # Check if ID already exists
    if manager.get_account(data.id):
        raise HTTPException(status_code=400, detail=f"Account ID already exists: {data.id}")
    
    # Create account (API keys should be set via .env)
    import os
    env_prefix = f"ACCOUNT_{data.id.upper().replace('-', '_')}"
    api_key = os.environ.get(f"{env_prefix}_API_KEY", "")
    secret_key = os.environ.get(f"{env_prefix}_SECRET_KEY", "")
    
    account = ExchangeAccount(
        id=data.id,
        exchange_type=exchange_type,
        account_name=data.name,
        enabled=data.enabled,
        testnet=data.testnet,
        api_key=api_key,
        secret_key=secret_key
    )
    
    manager.add_account(account)
    manager.save_to_file()
    
    global_state.add_log(f"➕ Added account: {data.name} ({data.exchange})")
    return {"status": "success", "account": account.to_dict()}

@app.delete("/api/accounts/{account_id}")
async def delete_account(account_id: str, authenticated: bool = Depends(verify_auth)):
    """Delete a trading account"""
    manager = get_account_manager()
    
    account = manager.get_account(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    name = account.account_name
    success = manager.remove_account(account_id)
    
    if success:
        manager.save_to_file()
        global_state.add_log(f"➖ Removed account: {name}")
        return {"status": "success", "message": f"Account '{name}' removed"}
    else:
        raise HTTPException(status_code=500, detail="Failed to remove account")

@app.get("/api/exchanges")
async def list_exchanges(authenticated: bool = Depends(verify_auth)):
    """List supported exchanges"""
    from src.exchanges import get_supported_exchanges
    return {"exchanges": get_supported_exchanges()}

# ============================================================================
# Backtest API Endpoints
# ============================================================================

# Global tracking for active backtest sessions
import asyncio
from collections import defaultdict
from typing import List
import uuid as uuid_lib
from datetime import datetime

class BacktestSession:
    """Track a running backtest session"""
    def __init__(self, session_id: str, config: dict):
        self.session_id = session_id
        self.config = config
        self.status = 'running'  # running, completed, error
        self.progress = 0
        self.current_timepoint = 0
        self.total_timepoints = 0
        self.start_time = datetime.now()
        self.result = None
        self.error = None
        self.subscribers: List[asyncio.Queue] = []  # Multiple clients can subscribe
        self.latest_data = {}  # Store latest progress data for new subscribers

ACTIVE_BACKTESTS: Dict[str, BacktestSession] = {}  # session_id -> BacktestSession

@app.get("/api/backtest/active")
async def get_active_backtests(authenticated: bool = Depends(verify_auth)):
    """Get list of currently running backtests"""
    result = []
    for session_id, session in ACTIVE_BACKTESTS.items():
        result.append({
            'session_id': session_id,
            'symbol': session.config.get('symbol'),
            'status': session.status,
            'progress': session.progress,
            'current_timepoint': session.current_timepoint,
            'total_timepoints': session.total_timepoints,
            'start_time': session.start_time.isoformat(),
            'latest_data': session.latest_data
        })
    return {'active_backtests': result}

@app.get("/api/backtest/subscribe/{session_id}")
async def subscribe_to_backtest(session_id: str, authenticated: bool = Depends(verify_auth)):
    """Subscribe to a running backtest's progress stream"""
    from fastapi.responses import StreamingResponse
    
    if session_id not in ACTIVE_BACKTESTS:
        raise HTTPException(status_code=404, detail="Backtest session not found")
    
    session = ACTIVE_BACKTESTS[session_id]
    
    async def event_generator():
        queue = asyncio.Queue()
        session.subscribers.append(queue)
        
        # First, send the latest state to catch up
        if session.latest_data:
            yield json.dumps({
                'type': 'progress',
                'session_id': session_id,
                **session.latest_data
            }) + '\n'
        
        try:
            while session.status == 'running':
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=30)
                    yield json.dumps(data) + '\n'
                except asyncio.TimeoutError:
                    # Send keepalive
                    yield json.dumps({'type': 'keepalive'}) + '\n'
            
            # Session completed, send final result if available
            if session.result:
                yield json.dumps({
                    'type': 'result',
                    'data': session.result,
                    'session_id': session_id
                }) + '\n'
            elif session.error:
                yield json.dumps({
                    'type': 'error',
                    'message': session.error,
                    'session_id': session_id
                }) + '\n'
        finally:
            if queue in session.subscribers:
                session.subscribers.remove(queue)
    
    return StreamingResponse(
        event_generator(),
        media_type="application/x-ndjson"
    )

class BacktestRequest(BaseModel):
    symbol: str = "BTCUSDT"
    start_date: str
    end_date: str
    initial_capital: float = 10000.0
    step: int = 3
    stop_loss_pct: float = 0.0
    take_profit_pct: float = 0.0
    strategy_mode: str = "technical" # "technical" or "agent"
    use_llm: bool = False  # Enable LLM calls in backtest
    llm_cache: bool = True  # Cache LLM responses
    llm_throttle_ms: int = 100  # Throttle between LLM calls (ms)

@app.post("/api/backtest/run")
async def run_backtest(config: BacktestRequest, authenticated: bool = Depends(verify_auth)):
    """Run a backtest with the given configuration (Streaming)"""
    from src.backtest.engine import BacktestEngine, BacktestConfig
    from fastapi.responses import StreamingResponse
    import asyncio
    import json
    from datetime import datetime
    import uuid
    import math
    import logging

    try:
        # Log received config for debugging
        import logging
        log = logging.getLogger(__name__)
        log.info(f"📋 Backtest request received: symbol={config.symbol}, step={config.step}, dates={config.start_date} to {config.end_date}")
        
        bt_config = BacktestConfig(
            symbol=config.symbol,
            start_date=config.start_date,
            end_date=config.end_date,
            initial_capital=config.initial_capital,
            step=config.step,
            stop_loss_pct=config.stop_loss_pct,
            take_profit_pct=config.take_profit_pct,
            strategy_mode='agent',  # Force Multi-Agent Mode
            use_llm=True,  # Force LLM ON for agent mode (required for prompt rules)
            llm_cache=config.llm_cache,  # Cache LLM responses
            llm_throttle_ms=config.llm_throttle_ms  # Rate limiting
        )
        
        engine = BacktestEngine(bt_config)
        
        # Create session for tracking
        session_id = str(uuid.uuid4())[:8]
        session = BacktestSession(session_id, {
            'symbol': config.symbol,
            'start_date': config.start_date,
            'end_date': config.end_date,
            'step': config.step
        })
        ACTIVE_BACKTESTS[session_id] = session
        
        # Generator for Streaming Response
        async def event_generator():
            queue = asyncio.Queue()
            
            # Progress callback (Async) - receives a dict from engine
            async def progress_callback(data: dict):
                # Extract data from the dict
                progress = data.get('progress', 0)
                current = data.get('current_timepoint', 0)
                total = data.get('total_timepoints', 0)
                
                # Update session state
                session.progress = progress
                session.current_timepoint = current
                session.total_timepoints = total
                
                progress_msg = {
                    "type": "progress",
                    "session_id": session_id,
                    "current": current,
                    "total": total,
                    "percent": round(progress, 1),
                    "current_timepoint": current,
                    "total_timepoints": total,
                    "current_equity": data.get('current_equity'),
                    "profit": data.get('profit'),
                    "profit_pct": data.get('profit_pct'),
                    "equity_point": data.get('latest_equity_point'),
                    "recent_trades": data.get('latest_trade'),
                    "metrics": data.get('metrics')
                }
                
                # Store latest data for reconnecting subscribers
                session.latest_data = progress_msg
                
                # Send to main queue
                await queue.put(progress_msg)
                
                # Notify all subscribers
                for subscriber_queue in session.subscribers:
                    try:
                        subscriber_queue.put_nowait(progress_msg)
                    except asyncio.QueueFull:
                        pass  # Skip if queue is full
            
            # Run engine in background task
            async def run_engine():
                try:
                    result = await engine.run(progress_callback=progress_callback)
                    
                    # --- Data Processing ---
                    equity_curve = []
                    for _, row in result.equity_curve.iterrows():
                        equity_curve.append({
                            'timestamp': row.name.isoformat() if hasattr(row.name, 'isoformat') else str(row.name),
                            'total_equity': float(row['total_equity']),
                            'drawdown_pct': float(row['drawdown_pct'])
                        })
                    
                    trades = []
                    for t in result.trades:
                        trades.append({
                            'trade_id': getattr(t, 'trade_id', str(uuid.uuid4())),
                            'symbol': t.symbol,
                            'side': t.side.value,
                            'action': t.action,
                            'quantity': float(t.quantity or 0),
                            'price': float(t.price or 0),
                            'timestamp': t.timestamp.isoformat(),
                            'pnl': float(t.pnl or 0),
                            'pnl_pct': float(t.pnl_pct or 0),
                            'entry_price': float(t.entry_price or 0),
                            'holding_time': float(t.holding_time or 0),
                            'close_reason': t.close_reason
                        })

                    # --- Extract Decisions ---
                    decisions = []
                    # Filter: Last 50 + any non-hold action
                    filtered_decisions = [d for d in result.decisions if d.get('action') != 'hold']
                    filtered_decisions += result.decisions[-50:] # Add last 50
                    
                    # Deduplicate by timestamp if needed, but simple list is fine for now
                    # Sanitize
                    for d in filtered_decisions:
                         decisions.append({
                            'timestamp': d.get('timestamp').isoformat() if hasattr(d.get('timestamp'), 'isoformat') else str(d.get('timestamp')),
                            'action': d.get('action'),
                            'confidence': d.get('confidence'),
                            'reason': d.get('reason'),
                            'vote_details': d.get('vote_details'),
                            'price': float(d.get('price', 0))
                         })
                    
                    # Helper for NaNs
                    def recursive_clean(obj):
                        if isinstance(obj, float):
                            if math.isnan(obj) or math.isinf(obj): return 0.0
                            return obj
                        if isinstance(obj, dict):
                            return {k: recursive_clean(v) for k, v in obj.items()}
                        if isinstance(obj, list):
                            return [recursive_clean(v) for v in obj]
                        return obj

                    response_data = recursive_clean({
                        'metrics': result.metrics.to_dict(),
                        'equity_curve': equity_curve,
                        'trades': trades,
                        'duration_seconds': result.duration_seconds,
                        'decisions': decisions
                    })

                    # --- 1. Database Storage (First to get ID) ---
                    db_id = None
                    run_id = f"bt_{uuid.uuid4().hex[:12]}"
                    
                    try:
                        from src.backtest.storage import BacktestStorage
                        storage = BacktestStorage()
                        
                        db_id = storage.save_backtest(
                            run_id=run_id,
                            config=config.dict(),
                            metrics=response_data['metrics'],
                            trades=trades,
                            equity_curve=equity_curve
                        )
                        
                        if db_id:
                             print(f"📊 Backtest saved to DB: #{db_id} ({run_id})")
                             response_data['run_id'] = run_id
                             response_data['id'] = db_id
                        else:
                             print(f"⚠️ Backtest save returned None")
                             
                    except Exception as db_err:
                        print(f"⚠️ DB save failed: {db_err}")

                    # --- 2. Comprehensive Folder Logging (Now uses DB ID) ---
                    try:
                        run_time = datetime.now()
                        clean_start = config.start_date.replace('-', '').replace('/', '')
                        clean_end = config.end_date.replace('-', '').replace('/', '')
                        id_str = f"id{db_id}" if db_id else "id_unknown"
                        
                        # Create dedicated folder for this backtest
                        folder_name = f"{run_time.strftime('%Y%m%d_%H%M%S')}_{id_str}_{clean_start}_{clean_end}"
                        backtest_dir = os.path.join(BASE_DIR, 'logs', 'backtest', folder_name)
                        os.makedirs(backtest_dir, exist_ok=True)
                        
                        # 1. Save config
                        config_path = os.path.join(backtest_dir, 'config.json')
                        with open(config_path, 'w', encoding='utf-8') as f:
                            json.dump({
                                'id': db_id,
                                'run_id': run_id,
                                'run_time': run_time.isoformat(),
                                'config': config.dict()
                            }, f, indent=2, ensure_ascii=False)
                        
                        # 2. Save results summary
                        results_path = os.path.join(backtest_dir, 'results.json')
                        with open(results_path, 'w', encoding='utf-8') as f:
                            json.dump({
                                'id': db_id,
                                'run_id': run_id,
                                'metrics': response_data['metrics'],
                                'duration_seconds': result.duration_seconds
                            }, f, indent=2, ensure_ascii=False)
                        
                        # 3. Save all trades
                        trades_path = os.path.join(backtest_dir, 'trades.json')
                        with open(trades_path, 'w', encoding='utf-8') as f:
                            json.dump({
                                'total_trades': len(trades),
                                'trades': trades
                            }, f, indent=2, ensure_ascii=False)
                        
                        # 4. Save equity curve
                        equity_path = os.path.join(backtest_dir, 'equity_curve.json')
                        with open(equity_path, 'w', encoding='utf-8') as f:
                            json.dump({
                                'equity_curve': equity_curve
                            }, f, indent=2, ensure_ascii=False)
                        
                        # 5. Save decisions (agent processing data)
                        decisions_path = os.path.join(backtest_dir, 'decisions.json')
                        with open(decisions_path, 'w', encoding='utf-8') as f:
                            json.dump({
                                'total_decisions': len(decisions),
                                'decisions': decisions
                            }, f, indent=2, ensure_ascii=False)
                        
                        # 6. Save K-line data (input data for analysis)
                        kline_dir = os.path.join(backtest_dir, 'kline_data')
                        os.makedirs(kline_dir, exist_ok=True)
                        
                        # Get K-line data from engine's data replay
                        if hasattr(engine, 'data_replay') and engine.data_replay:
                            data_cache = engine.data_replay.data_cache
                            
                            # Save 5m K-line data
                            if hasattr(data_cache, 'df_5m') and data_cache.df_5m is not None:
                                df_5m_path = os.path.join(kline_dir, 'kline_5m.csv')
                                data_cache.df_5m.to_csv(df_5m_path)
                            
                            # Save 15m K-line data
                            if hasattr(data_cache, 'df_15m') and data_cache.df_15m is not None:
                                df_15m_path = os.path.join(kline_dir, 'kline_15m.csv')
                                data_cache.df_15m.to_csv(df_15m_path)
                            
                            # Save 1h K-line data
                            if hasattr(data_cache, 'df_1h') and data_cache.df_1h is not None:
                                df_1h_path = os.path.join(kline_dir, 'kline_1h.csv')
                                data_cache.df_1h.to_csv(df_1h_path)
                        
                        # 7. Save LLM logs (if any)
                        llm_log_count = 0
                        if hasattr(engine, 'agent_runner') and engine.agent_runner and hasattr(engine.agent_runner, 'llm_logs'):
                            llm_logs = engine.agent_runner.llm_logs
                            if llm_logs:
                                llm_dir = os.path.join(backtest_dir, 'llm_logs')
                                os.makedirs(llm_dir, exist_ok=True)
                                
                                for idx, log_entry in enumerate(llm_logs):
                                    # Create markdown file for each LLM interaction
                                    log_filename = f"llm_log_{idx+1:04d}_{log_entry['timestamp'].replace(':', '').replace('-', '')[:15]}.md"
                                    log_path = os.path.join(llm_dir, log_filename)
                                    
                                    # Format as markdown
                                    md_content = f"""# LLM Decision Log #{idx+1}

**Timestamp**: {log_entry['timestamp']}

## Market Context

{log_entry['context']}

## LLM Response

```json
{json.dumps(log_entry['llm_response'], indent=2, ensure_ascii=False)}
```

## Final Decision

- **Action**: {log_entry['final_decision']['action']}
- **Confidence**: {log_entry['final_decision']['confidence']}%
- **Reason**: {log_entry['final_decision']['reason']}
"""
                                    with open(log_path, 'w', encoding='utf-8') as f:
                                        f.write(md_content)
                                
                                llm_log_count = len(llm_logs)
                        
                        print(f"📁 Backtest data saved to folder: {backtest_dir}")
                        print(f"   ├── config.json (input configuration)")
                        print(f"   ├── results.json (metrics summary)")
                        print(f"   ├── trades.json ({len(trades)} trades)")
                        print(f"   ├── equity_curve.json ({len(equity_curve)} points)")
                        print(f"   ├── decisions.json ({len(decisions)} agent decisions)")
                        print(f"   ├── kline_data/ (5m, 15m, 1h K-line CSV files)")
                        if llm_log_count > 0:
                            print(f"   └── llm_logs/ ({llm_log_count} LLM interactions)")
                    except Exception as log_err:
                        print(f"⚠️ Folder logging failed: {log_err}")

                    # --- 3. Send Final Result ---
                    result_msg = {
                        "type": "result",
                        "session_id": session_id,
                        "data": response_data
                    }
                    
                    # Update session status
                    session.status = 'completed'
                    session.result = response_data
                    
                    # Notify all subscribers
                    for subscriber_queue in session.subscribers:
                        try:
                            subscriber_queue.put_nowait(result_msg)
                        except asyncio.QueueFull:
                            pass
                    
                    await queue.put(result_msg)
                    
                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    error_msg = {"type": "error", "session_id": session_id, "message": str(e)}
                    
                    # Update session status
                    session.status = 'error'
                    session.error = str(e)
                    
                    # Notify subscribers
                    for subscriber_queue in session.subscribers:
                        try:
                            subscriber_queue.put_nowait(error_msg)
                        except asyncio.QueueFull:
                            pass
                    
                    await queue.put(error_msg)
                finally:
                    await queue.put(None) # End of stream
                    # Clean up session after 5 minutes
                    async def cleanup_session():
                        await asyncio.sleep(300)  # 5 minutes
                        if session_id in ACTIVE_BACKTESTS:
                            del ACTIVE_BACKTESTS[session_id]
                    asyncio.create_task(cleanup_session())

            # Start the engine task
            asyncio.create_task(run_engine())
            
            # Stream Loop
            while True:
                data = await queue.get()
                if data is None:
                    break
                yield json.dumps(data) + "\n"
        
        return StreamingResponse(event_generator(), media_type="application/x-ndjson")

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/backtest/history")
async def get_backtest_history(authenticated: bool = Depends(verify_auth)):
    """Get list of saved backtest reports"""
    reports_dir = os.path.join(BASE_DIR, 'reports')
    if not os.path.exists(reports_dir):
        return {"reports": []}
    
    reports = []
    for f in os.listdir(reports_dir):
        if f.endswith('.html') and f.startswith('backtest_'):
            path = os.path.join(reports_dir, f)
            reports.append({
                'filename': f,
                'path': f'/reports/{f}',
                'created': os.path.getmtime(path)
            })
    
    reports.sort(key=lambda x: x['created'], reverse=True)
    return {"reports": reports[:20]}

# Authentication middleware for protected static files
@app.middleware("http")
async def protect_backtest_page(request: Request, call_next):
    """Protect backtest.html from direct access without authentication"""
    # Check if accessing backtest.html directly
    # --- AUTHENTICATION MIDDLEWARE ---
    path = request.url.path
    
    # Define protected extensions and exempt paths
    is_protected_type = path.endswith('.html') or path == '/' or path == '/backtest'
    exempt_paths = ['/login', '/login.html', '/api/login', '/api/info']
    
    # Allow assets (js, css, etc.)
    is_asset = path.startswith('/static/') and not path.endswith('.html')
    
    if is_protected_type and path not in exempt_paths and not is_asset:
        try:
            # Check cookie
            verify_auth(request)
        except HTTPException:
            # Redirect to login if not authenticated
            return RedirectResponse("/login", status_code=302)
    
    response = await call_next(request)
    return response

# Serve root-level static files (CSS, JS) directly
@app.get("/style.css")
async def serve_style_css():
    return FileResponse(os.path.join(WEB_DIR, 'style.css'), media_type='text/css')

@app.get("/style-enhancements.css")
async def serve_style_enhancements_css():
    return FileResponse(os.path.join(WEB_DIR, 'style-enhancements.css'), media_type='text/css')

@app.get("/app.js")
async def serve_app_js():
    return FileResponse(os.path.join(WEB_DIR, 'app.js'), media_type='application/javascript')

@app.get("/i18n.js")
async def serve_i18n_js():
    return FileResponse(os.path.join(WEB_DIR, 'i18n.js'), media_type='application/javascript')

# Serve Static Files
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

# Serve Reports Directory
reports_dir = os.path.join(BASE_DIR, 'reports')
if os.path.exists(reports_dir):
    app.mount("/reports", StaticFiles(directory=reports_dir), name="reports")

# Root Route -> Checks login
@app.get("/")
async def read_root(request: Request):
    # Check if authenticated
    try:
        verify_auth(request)
        return FileResponse(os.path.join(WEB_DIR, 'index.html'))
    except HTTPException:
        return RedirectResponse("/login")

@app.get("/login")
async def read_login():
    return FileResponse(os.path.join(WEB_DIR, 'login.html'))

# ==================== Backtest Analytics APIs ====================

@app.get("/api/backtest/list")
async def list_backtests(symbol: Optional[str] = None, limit: int = 100, 
                        authenticated: bool = Depends(verify_auth)):
    """List all backtest runs with optional filtering"""
    try:
        from src.backtest.storage import BacktestStorage
        storage = BacktestStorage()
        results = storage.list_backtests(symbol=symbol, limit=limit)
        return {"status": "success", "backtests": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/backtest/compare")
async def compare_backtests(request: Dict, authenticated: bool = Depends(verify_auth)):
    """Compare multiple backtest runs"""
    try:
        from src.backtest.analytics import BacktestAnalytics
        
        run_ids = request.get('run_ids', [])
        if not run_ids:
            raise HTTPException(status_code=400, detail="run_ids required")
        
        analytics = BacktestAnalytics()
        comparison = analytics.compare_runs(run_ids)
        
        return {
            "status": "success",
            "comparison": comparison.to_dict(orient='records')
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/backtest/trends")
async def get_performance_trends(symbol: str, days: int = 30,
                                authenticated: bool = Depends(verify_auth)):
    """Get performance trends over time"""
    try:
        from src.backtest.analytics import BacktestAnalytics
        
        analytics = BacktestAnalytics()
        trends = analytics.get_performance_trends(symbol=symbol, days=days)
        
        return {"status": "success", "trends": trends}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/backtest/optimize/suggest")
async def suggest_optimal_parameters(symbol: str, target: str = 'sharpe',
                                    authenticated: bool = Depends(verify_auth)):
    """Get optimal parameter suggestions"""
    try:
        from src.backtest.analytics import BacktestAnalytics
        
        if target not in ['sharpe', 'return', 'drawdown']:
            raise HTTPException(status_code=400, detail="Invalid target")
        
        analytics = BacktestAnalytics()
        suggestions = analytics.suggest_optimal_parameters(symbol=symbol, target=target)
        
        return {"status": "success", "suggestions": suggestions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/backtest/analyze/{run_id}")
async def analyze_backtest(run_id: str, authenticated: bool = Depends(verify_auth)):
    """Get detailed analysis for a specific backtest"""
    try:
        from src.backtest.analytics import BacktestAnalytics
        
        analytics = BacktestAnalytics()
        
        # Get win rate analysis
        win_analysis = analytics.get_win_rate_analysis(run_id)
        
        # Get risk metrics
        risk_metrics = analytics.calculate_risk_metrics(run_id)
        
        return {
            "status": "success",
            "run_id": run_id,
            "win_rate_analysis": win_analysis,
            "risk_metrics": risk_metrics
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/backtest/export/{run_id}")
async def export_backtest(run_id: str, format: str = 'csv',
                         authenticated: bool = Depends(verify_auth)):
    """Export backtest data"""
    try:
        from src.backtest.storage import BacktestStorage
        import tempfile
        import shutil
        
        if format not in ['csv', 'json']:
            raise HTTPException(status_code=400, detail="Invalid format")
        
        storage = BacktestStorage()
        
        if format == 'csv':
            # Export to temporary directory
            temp_dir = tempfile.mkdtemp()
            storage.export_to_csv(run_id, temp_dir)
            
            # Create zip file
            import zipfile
            zip_path = f"{temp_dir}/{run_id}.zip"
            with zipfile.ZipFile(zip_path, 'w') as zipf:
                for file in os.listdir(temp_dir):
                    if file.endswith(('.csv', '.json')):
                        zipf.write(os.path.join(temp_dir, file), file)
            
            return FileResponse(zip_path, filename=f"{run_id}.zip")
        
        else:  # json
            data = storage.get_backtest(run_id)
            if not data:
                raise HTTPException(status_code=404, detail="Backtest not found")
            
            return {"status": "success", "data": data}
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/backtest/{run_id}")
async def delete_backtest(run_id: str, authenticated: bool = Depends(verify_auth)):
    """Delete a backtest"""
    try:
        from src.backtest.storage import BacktestStorage
        
        storage = BacktestStorage()
        success = storage.delete_backtest(run_id)
        
        if success:
            return {"status": "success", "message": "Backtest deleted"}
        else:
            raise HTTPException(status_code=404, detail="Backtest not found")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== Page Routes ====================

@app.get("/backtest")
async def read_backtest(request: Request):
    """Backtest page"""
    try:
        verify_auth(request)
        return FileResponse(os.path.join(WEB_DIR, 'backtest.html'))
    except HTTPException:
        return RedirectResponse("/login")
