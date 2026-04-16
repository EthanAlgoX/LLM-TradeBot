import time
import threading

from src.agents.agent_provider import AgentProvider

from .symbol_manager import SymbolManager

from src.utils.logger import log

class Ai500Updater:
    def __init__(
        self,
        symbol_manager: SymbolManager,
        agent_provider: AgentProvider
    ):
        self.symbol_manager = symbol_manager
        self.agent_provider = agent_provider

        self.use_ai500 = 'AI500_TOP5' in symbol_manager.symbols and not self.symbol_manager.use_auto3
        self.ai500_last_update = None
        self.ai500_update_interval = 6 * 3600  # 6 hours in seconds
        
        if self.use_ai500:
            self.ai500_last_update = time.time()
            
            # Start background thread for periodic updates
            self._start_ai500_updater()

    def _start_ai500_updater(self):
        """启动 AI500 定时更新后台线程"""
        def updater_loop():
            while True:
                try:
                    # Sleep for 6 hours
                    time.sleep(self.ai500_update_interval)
                    
                    if self.use_ai500:
                        log.info("🔄 AI500 Top5 - Starting scheduled update (every 6h)")
                        old_symbols = set(self.symbol_manager.symbols)
                        self.symbol_manager.update_ai500()  # This will fetch new AI500 top5 and update symbols list
                        self.ai500_last_update = time.time()
                        
                        # Log changes
                        added = set(self.symbol_manager.symbols) - old_symbols
                        removed = old_symbols - set(self.symbol_manager.symbols)
                        if added or removed:
                            log.info(f"📊 AI500 Updated - Added: {added}, Removed: {removed}")
                            log.info(f"📋 Current symbols: {', '.join(self.symbol_manager.symbols)}")
                            for symbol in added:
                                if symbol not in self.predict_agents:
                                    from src.agents.predict import PredictAgent
                                    self.agent_provider.predict_agents_provider.predict_agents[symbol] = PredictAgent(symbol=symbol)
                                    log.info(f"🆕 Initialized PredictAgent for {symbol}")
                        else:
                            log.info("✅ AI500 Updated - No changes in Top5")
                            
                except Exception as e:
                    log.error(f"AI500 updater error: {e}")
        
        # Start daemon thread
        updater_thread = threading.Thread(target=updater_loop, daemon=True, name="AI500-Updater")
        updater_thread.start()
        log.info(f"🚀 AI500 Auto-updater started (interval: 6 hours)")