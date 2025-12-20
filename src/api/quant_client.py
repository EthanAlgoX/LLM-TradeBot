"""
外部量化输出 API 接入层
支持: Netflow (机构/个人), OI (Binance/ByBit), Price Change
"""
import aiohttp
import asyncio
from typing import Dict, Optional
from src.utils.logger import log

class QuantClient:
    """外部量化 API 客户端"""
    
    BASE_URL = "http://nofxaios.com:30006/api/coin"
    AUTH_TOKEN = "cm_568c67eae410d912c54c"
    
    def __init__(self, timeout: int = 10):
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self.session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(timeout=self.timeout)
        return self.session

    async def fetch_coin_data(self, symbol: str = "BTCUSDT") -> Dict:
        """
        获取指定币种的量化深度数据
        """
        clean_symbol = symbol.replace("USDT", "USDT") # 兼容性处理
        url = f"{self.BASE_URL}/{clean_symbol}?include=netflow,oi,price&auth={self.AUTH_TOKEN}"
        
        try:
            session = await self._get_session()
            async with session.get(url) as response:
                if response.status == 200:
                    result = await response.json()
                    if result.get("success"):
                        return result.get("data", {})
                log.error(f"Quant API 请求失败: {response.status}")
                return {}
        except Exception as e:
            log.error(f"Quant API 异常: {e}")
            return {}

    async def fetch_ai500_list(self) -> Dict:
        """
        获取 AI500 优质币池列表
        """
        url = f"http://nofxaios.com:30006/api/ai500/list?auth={self.AUTH_TOKEN}"
        
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
        url = f"http://nofxaios.com:30006/api/oi/{endpoint}?limit={limit}&duration={duration}&auth={self.AUTH_TOKEN}"
        
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
