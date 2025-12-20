import asyncio
import json
import logging
from typing import Callable, Dict, List, Optional
import aiohttp
from src.utils.logger import log

class BinanceWebSocketClient:
    """
    Binance WebSocket Client (Futures)
    
    使用 wss://fstream.binance.com/ws 原始流接口
    通过 JSON-RPC 发送 SUBSCRIBE 消息进行动态订阅
    """
    BASE_URL = "wss://fstream.binance.com/ws"
    
    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
        self.ws: Optional[aiohttp.ClientWebSocketResponse] = None
        self.callbacks: List[Callable[[Dict], None]] = []
        self.running = False
        self._subscriptions = []
        self._lock = asyncio.Lock()

    async def start(self):
        """启动 WebSocket 连接"""
        if self.running:
            return
        self.running = True
        self.session = aiohttp.ClientSession()
        asyncio.create_task(self._connect_loop())
        log.info("🚀 Binance WebSocket Client (Futures) Started")

    async def _connect_loop(self):
        """连接维护循环"""
        while self.running:
            try:
                log.info(f"Connecting to Binance WS: {self.BASE_URL}")
                async with self.session.ws_connect(self.BASE_URL) as ws:
                    self.ws = ws
                    log.info("✅ Binance WS Connected")
                    
                    # 连接成功后重新订阅
                    if self._subscriptions:
                        await self._send_subscribe(self._subscriptions)
                    
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            try:
                                data = json.loads(msg.data)
                                self._handle_message(data)
                            except Exception as e:
                                log.error(f"WS Parse Error: {e}")
                        elif msg.type == aiohttp.WSMsgType.ERROR:
                            log.error(f"WS Error: {ws.exception()}")
                            break
                        elif msg.type == aiohttp.WSMsgType.CLOSED:
                             log.warning("WS Closed")
                             break
                            
            except Exception as e:
                log.error(f"WS Connection Loop Error: {e}")
                
            if self.running:
                log.warning("🔄 WS Reconnecting in 5s...")
                await asyncio.sleep(5) 

    async def _send_subscribe(self, streams: List[str]):
        """发送订阅指令"""
        if not self.ws:
            return
        
        payload = {
            "method": "SUBSCRIBE",
            "params": streams,
            "id": 1
        }
        try:
            await self.ws.send_json(payload)
            log.info(f"📡 Subscribed to: {streams}")
        except Exception as e:
            log.error(f"Subscribe failed: {e}")

    def _handle_message(self, data: Dict):
        """处理推送消息"""
        # 忽略订阅响应
        if "result" in data and "id" in data:
            return

        # 处理 K-line 事件 (e: kline)
        if data.get("e") == "kline":
            for callback in self.callbacks:
                try:
                    callback(data)
                except Exception as e:
                    log.error(f"Callback error: {e}")
            return
        
        # 可扩充处理其他类型消息...

    async def subscribe_kline(self, symbol: str, interval: str):
        """
        订阅 K 线数据
        Topic: <symbol>@kline_<interval>
        """
        stream = f"{symbol.lower()}@kline_{interval}"
        async with self._lock:
            if stream not in self._subscriptions:
                self._subscriptions.append(stream)
                if self.ws:
                    await self._send_subscribe([stream])
            
    def add_callback(self, callback: Callable[[Dict], None]):
        """注册回调函数"""
        self.callbacks.append(callback)

    async def stop(self):
        """停止客户端"""
        self.running = False
        if self.ws:
            await self.ws.close()
        if self.session:
            await self.session.close()

# 单例模式
ws_client = BinanceWebSocketClient()
