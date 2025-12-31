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
        response.set_cookie(
            key=SESSION_COOKIE_NAME, 
            value=session_id, 
            httponly=True, 
            max_age=86400 * 7, # 7 days
            samesite="lax"
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
            "symbols": global_state.symbols  # 🆕 Active trading symbols (AI500 Top10 support)
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
        "logs": global_state.recent_logs[:50]
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

class BacktestRequest(BaseModel):
    symbol: str = "BTCUSDT"
    start_date: str
    end_date: str
    initial_capital: float = 10000.0
    step: int = 3
    stop_loss_pct: float = 1.0
    take_profit_pct: float = 2.0
    strategy_mode: str = "technical" # "technical" or "agent"

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
        bt_config = BacktestConfig(
            symbol=config.symbol,
            start_date=config.start_date,
            end_date=config.end_date,
            initial_capital=config.initial_capital,
            step=config.step,
            stop_loss_pct=config.stop_loss_pct,
            take_profit_pct=config.take_profit_pct,
            # strategy_mode=config.strategy_mode 
            strategy_mode='agent' # Force Multi-Agent Mode as per user request
        )
        
        engine = BacktestEngine(bt_config)
        
        # Generator for Streaming Response
        async def event_generator():
            queue = asyncio.Queue()
            
            # Progress callback (Async)
            async def progress_callback(current, total, pct):
                # Simple throttling: send every 2% or every 10 steps
                if current % 10 == 0 or current == total - 1:
                    await queue.put({
                        "type": "progress",
                        "current": current,
                        "total": total,
                        "percent": round(pct, 1)
                    })
            
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

                    # --- 1. JSON File Logging ---
                    try:
                        log_dir = os.path.join(BASE_DIR, 'logs', 'backtest')
                        os.makedirs(log_dir, exist_ok=True)
                        
                        run_time = datetime.now()
                        log_filename = f"backtest_{config.symbol}_{run_time.strftime('%Y%m%d_%H%M%S')}.json"
                        log_path = os.path.join(log_dir, log_filename)
                        
                        log_data = {
                            'run_time': run_time.isoformat(),
                            'config': config.dict(),
                            'metrics': response_data['metrics'],
                            'trades_summary': {
                                'total': len(trades),
                                'trades': trades[-20:] if len(trades) > 20 else trades
                            },
                            'duration_seconds': result.duration_seconds
                        }
                        
                        with open(log_path, 'w', encoding='utf-8') as f:
                            json.dump(log_data, f, indent=2, ensure_ascii=False)
                        print(f"📝 Backtest log saved: {log_path}")
                    except Exception as log_err:
                        print(f"⚠️ Log save failed: {log_err}")

                    # --- 2. Database Storage ---
                    try:
                        from src.backtest.storage import BacktestStorage
                        storage = BacktestStorage()
                        run_id = f"bt_{uuid.uuid4().hex[:12]}"
                        
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
                        # Log full traceback for DB error
                        # import traceback
                        # traceback.print_exc()
                        print(f"⚠️ DB save failed: {db_err}")

                    # --- 3. Send Final Result ---
                    await queue.put({
                        "type": "result",
                        "data": response_data
                    })
                    
                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    await queue.put({"type": "error", "message": str(e)})
                finally:
                    await queue.put(None) # End of stream

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
