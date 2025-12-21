from fastapi import FastAPI, Body, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os

from src.server.state import global_state

# Input Model
from pydantic import BaseModel
class ControlCommand(BaseModel):
    action: str  # start, pause, stop, restart, set_interval
    interval: int = None  # Optional: interval in minutes for set_interval action

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

# API Endpoints
@app.get("/api/status")
async def get_status():
    data = {
        "system": {
            "running": global_state.is_running,
            "mode": global_state.execution_mode,
            "cycle_counter": global_state.cycle_counter,
            "cycle_interval": global_state.cycle_interval,  # 添加当前间隔
            "current_cycle_id": global_state.current_cycle_id,
            "uptime_start": global_state.start_time,
            "last_heartbeat": global_state.last_update
        },
        "market": {
            "price": global_state.current_price,
            "regime": global_state.market_regime,
            "position": global_state.price_position
        },
        "agents": {
            "strategist_score": global_state.strategist_score,
            "critic_confidence": global_state.critic_confidence,
            "guardian_status": global_state.guardian_status
        },
        "account": global_state.account_overview,
        "chart_data": {
            "equity": global_state.equity_history
        },
        "decision": global_state.latest_decision,
        "decision_history": global_state.decision_history[:10],
        "trade_history": global_state.trade_history[:20],  # Return recent 20 trades
        "logs": global_state.recent_logs[:50]
    }
    return clean_nans(data)

@app.post("/api/control")
async def control_bot(cmd: ControlCommand):
    action = cmd.action.lower()
    if action == "start":
        global_state.execution_mode = "Running"
        global_state.add_log("▶️ System Resumed by User")
    elif action == "pause":
        global_state.execution_mode = "Paused"
        global_state.add_log("⏸️ System Paused by User")
    elif action == "stop":
        global_state.execution_mode = "Stopped"
        global_state.add_log("⏹️ System Stopped by User")
    elif action == "restart":
        global_state.execution_mode = "Restarting"
        global_state.add_log("🔄 System Restarting by User...")
        # Note: Actual restart requires external process management
        # This just sets the flag for the main loop to handle
    elif action == "set_interval":
        if cmd.interval and cmd.interval in [1, 3, 5]:
            global_state.cycle_interval = cmd.interval
            global_state.add_log(f"⏱️ Cycle interval updated to {cmd.interval} minutes")
            return {"status": "success", "interval": cmd.interval}
        else:
            raise HTTPException(status_code=400, detail="Invalid interval. Must be 1, 3, or 5 minutes.")
    else:
        raise HTTPException(status_code=400, detail="Invalid action")
    
    return {"status": "success", "mode": global_state.execution_mode}

# Serve Static Files
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

# Root Route -> Index
@app.get("/")
async def read_root():
    return FileResponse(os.path.join(WEB_DIR, 'index.html'))
