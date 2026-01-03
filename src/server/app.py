from fastapi import FastAPI, Body, HTTPException, Request, Response, Depends, Cookie
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
import secrets
from typing import Optional, Dict

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
DEPLOYMENT_MODE = os.environ.get("DEPLOYMENT_MODE", "local")

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
        "deployment_mode": DEPLOYMENT_MODE,
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
        is_production = DEPLOYMENT_MODE != "local"
        response.set_cookie(
            key=SESSION_COOKIE_NAME, 
            value=session_id, 
            httponly=True, 
            max_age=86400 * 7,  # 7 days
            samesite="none" if is_production else "lax",  # "none" required for cross-site HTTPS
            secure=is_production  # Must be True for HTTPS (Railway)
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
            "symbols": global_state.symbols  # 🆕 Active trading symbols (AI500 Top5 support)
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
            "guardian_status": global_state.guardian_status
        },
        "account": global_state.account_overview,
        "virtual_account": {
            "is_test_mode": global_state.is_test_mode,
            "initial_balance": global_state.virtual_initial_balance,
            "current_balance": global_state.virtual_balance,
            "positions": global_state.virtual_positions,
            "total_unrealized_pnl": sum(pos.get('unrealized_pnl', 0) for pos in global_state.virtual_positions.values())
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
        "logs": global_state.recent_logs[-50:]  # Return latest 50 logs (reversed: newest at end)
    }
    return clean_nans(data)

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
        global_state.add_log("▶️ System Resumed by User")
        
    elif action == "pause":
        global_state.execution_mode = "Paused"
        global_state.add_log("⏸️ System Paused by User")
        
    elif action == "stop":
        global_state.execution_mode = "Stopped"
        global_state.add_log("⏹️ System Stopped by User")

    elif action == "set_interval":
        if cmd.interval and cmd.interval in [0.5, 1, 3, 5]:
            global_state.cycle_interval = cmd.interval
            global_state.add_log(f"⏱️ Cycle interval updated to {cmd.interval} minutes")
            return {"status": "success", "interval": cmd.interval}
        else:
            raise HTTPException(status_code=400, detail="Invalid interval. Must be 0.5, 1, 3, or 5 minutes.")
    else:
        raise HTTPException(status_code=400, detail="Invalid action")
    
    return {
        "status": "success", 
        "mode": global_state.execution_mode,
        "demo_mode_active": global_state.demo_mode_active,
        "demo_expired": global_state.demo_expired
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
    """Update .env configuration"""
    success = config_manager.update_config(data)
    if success:
        return {"status": "success", "message": "Configuration updated. Please restart the bot if you changed API keys."}
    else:
        raise HTTPException(status_code=500, detail="Failed to update configuration")

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
