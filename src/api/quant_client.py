"""
外部量化输出 API 接入层
支持: Netflow (机构/个人), OI (Binance/ByBit), Price Change
"""
import os
import aiohttp
import asyncio
from typing import Dict, Optional
from src.utils.logger import log

class QuantClient:
    """外部量化 API 客户端"""
    
    BASE_URL = "https://nofxos.ai/api"
    @property
    def auth_token(self) -> str:
        """从环境变量动态获取最新的认证令牌"""
        token = os.getenv('QUANT_AUTH_TOKEN', '')
        if not token:
            log.warning("QUANT_AUTH_TOKEN not set in environment, quant API calls may fail")
        return token
    
    def __init__(self, timeout: int = 10):
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self.session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        """获取或创建 aiohttp session，正确处理 event loop 变化"""
        try:
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            current_loop = None
        
        # 检查是否需要重新创建 session
        need_new_session = False
        
        if self.session is None:
            need_new_session = True
        elif self.session.closed:
            need_new_session = True
        elif hasattr(self.session, '_loop') and self.session._loop is not current_loop:
            # Event loop 改变，需要关闭旧 session 并创建新的
            try:
                await self.session.close()
            except Exception:
                pass  # 忽略关闭错误
            need_new_session = True
                
        if need_new_session:
            self.session = aiohttp.ClientSession(timeout=self.timeout)
        
        return self.session

    async def fetch_coin_data(self, symbol: str = "BTCUSDT") -> Dict:
        """
        获取指定币种的量化深度数据
        """
        url = f"{self.BASE_URL}/ai500/{symbol}?include=netflow,oi,price&auth={self.auth_token}"
        
        try:
            session = await self._get_session()
            async with session.get(url) as response:
                if response.status == 200:
                    result = await response.json()
                    if result.get("success"):
                        return result.get("data", {})
                if response.status == 401:
                    log.error(f"Quant API 鉴权失败(401): 请检查 QUANT_AUTH_TOKEN 环境变量是否正确设置")
                else:
                    log.error(f"Quant API 请求失败: {response.status}")
                return {}
        except Exception as e:
            log.error(f"Quant API 异常: {e}")
            return {}

    async def fetch_ai500_list(self) -> Dict:
        """
        获取 AI500 优质币池列表
        """
        url = f"{self.BASE_URL}/ai500/list?auth={self.auth_token}"
        
        try:
            session = await self._get_session()
            async with session.get(url) as response:
                if response.status == 200:
                    result = await response.json()
                    if result.get("success"):
                        return result.get("data", [])
                log.error(f"AI500 List 请求失败: {response.status}")
                return []
        except Exception as e:
            log.error(f"AI500 API 异常: {e}")
            return []

    async def fetch_oi_ranking(self, ranking_type: str = 'top', limit: int = 20, duration: str = '1h') -> Dict:
        """
        获取 OI 排行榜
        
        Args:
            ranking_type: 'top' (涨幅榜) 或 'low' (跌幅榜)
            limit: 返回数量
            duration: 时间周期 (1h, 4h, 24h)
        """
        endpoint = "top-ranking" if ranking_type == 'top' else "low-ranking"
        url = f"{self.BASE_URL}/oi/{endpoint}?limit={limit}&duration={duration}&auth={self.auth_token}"
        
        try:
            session = await self._get_session()
            async with session.get(url) as response:
                if response.status == 200:
                    result = await response.json()
                    if result.get("success"):
                        return result.get("data", [])
                log.error(f"OI Ranking 请求失败: {response.status}")
                return []
        except Exception as e:
            log.error(f"OI Ranking API 异常: {e}")
            return []

    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()

# 全局单例
quant_client = QuantClient()
