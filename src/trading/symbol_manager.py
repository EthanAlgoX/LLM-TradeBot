import os
import time
import asyncio

from typing import List, Dict, Any, TYPE_CHECKING
from datetime import datetime

from src.api.binance_client import BinanceClient
from src.config import Config
from src.agents.agent_config import AgentConfig

from src.utils.logger import log
from src.server.state import global_state

if TYPE_CHECKING:
    from src.agents.agent_provider import AgentProvider

class SymbolManager:
    def __init__(
        self,
        config: Config,
        agent_config: AgentConfig,
        client: BinanceClient,
        agent_provider: "AgentProvider",
        test_mode: bool = False
    ):
        self.agent_provider = agent_provider
        self.test_mode = test_mode
        self.client = client
        self._symbols = []
        self.agent_config = agent_config

        # Symbol selector cadence (AUTO1/AUTO3)
        self.selector_interval_sec = 10 * 60
        self.selector_last_run = 0.0
        self.selector_startup_done = False

        # 多币种支持: 优先级顺序
        # 1. 环境变量 TRADING_SYMBOLS (来自 .env，Dashboard 设置会更新这个)
        # 2. config.yaml 中的 trading.symbols (list)
        # 3. config.yaml 中的 trading.symbol (str/csv, 向后兼容)
        env_symbols = os.environ.get('TRADING_SYMBOLS', '').strip()

        if env_symbols:
            # Dashboard 设置的币种 (逗号分隔)
            self._symbols = [s.strip() for s in env_symbols.split(',') if s.strip()]
        else:
            # 从 config.yaml 读取
            symbols_config = config.get('trading.symbols', None)

            if symbols_config and isinstance(symbols_config, list):
                self._symbols = symbols_config
            else:
                # 向后兼容: 使用旧版 trading.symbol 配置 (支持 CSV 字符串 "BTCUSDT,ETHUSDT")
                symbol_str = config.get('trading.symbol', 'AI500_TOP5')  # ✅ 默认 AI500 Top 5
                if ',' in symbol_str:
                    self._symbols = [s.strip() for s in symbol_str.split(',') if s.strip()]
                else:
                    self._symbols = [symbol_str]

        self.use_auto3 = 'AUTO3' in self._symbols

        # Normalize legacy AUTO2 -> AUTO1
        if 'AUTO2' in self._symbols:
            self._symbols = ['AUTO1' if s == 'AUTO2' else s for s in self._symbols]

        if self.use_auto3:
            self._symbols = [s for s in self._symbols if s not in ('AUTO3', 'AUTO1')]
            # If AUTO3 was the only symbol, add temporary placeholder (will be replaced at startup)
            if not self._symbols:
                self._symbols = ['FETUSDT']  # Temporary, replaced by AUTO3 selection in main()
            log.info("🔝 AUTO3 mode enabled - Startup backtest will run")

        self.use_auto1 = (not self.use_auto3) and ('AUTO1' in self._symbols)
        if self.use_auto1:
            self._symbols = [s for s in self._symbols if s != 'AUTO1']
            if not self._symbols:
                self._symbols = ['BTCUSDT']  # Temporary placeholder before selector runs
            log.info("🎯 AUTO1 mode enabled - Symbol selector will run at startup")

        use_ai500 = 'AI500_TOP5' in self._symbols and not self.use_auto3
        if use_ai500:
            self._symbols.remove('AI500_TOP5')

            # Merge and deduplicate
            ai_top5 = self._resolve_ai500_symbols()
            self._symbols = list(set(self._symbols + ai_top5))

            # Sort to keep stable order
            self._symbols.sort()

        # 🔧 Primary symbol must be in the symbols list
        configured_primary = config.get('trading.primary_symbol', 'BTCUSDT')
        if configured_primary in self._symbols:
            self._primary_symbol = configured_primary
        else:
            # Use first symbol if configured primary not in list
            self._primary_symbol = self._symbols[0]
            log.info(f"Primary symbol {configured_primary} not in symbols list, using {self._primary_symbol}")

        self.current_symbol = self._primary_symbol  # 当前处理的交易对
        global_state.symbols = self._symbols  # 🆕 Sync symbols to global state for API

    @property
    def symbols(self):
        return self._symbols

    @symbols.setter
    def symbols(self, value):
        self._symbols = value

    @property
    def current_symbol(self):
        return self._current_symbol

    @current_symbol.setter
    def current_symbol(self, value):
        self._current_symbol = value
        global_state.current_symbol = value

    @property
    def primary_symbol(self):
        return self._primary_symbol

    @primary_symbol.setter
    def primary_symbol(self, value):
        self._primary_symbol = value

    def reload_symbols(self, config) -> bool:
        env_symbols = os.environ.get('TRADING_SYMBOLS', '').strip()

        old_symbols = self._symbols.copy()

        if env_symbols:
            self._symbols = [s.strip() for s in env_symbols.split(',') if s.strip()]
        else:
            symbols_config = config.get('trading.symbols', None)
            if symbols_config and isinstance(symbols_config, list):
                self._symbols = symbols_config
            else:
                symbol_str = config.get('trading.symbol', 'AI500_TOP5')
                if ',' in symbol_str:
                    self._symbols = [s.strip() for s in symbol_str.split(',') if s.strip()]
                else:
                    self._symbols = [symbol_str]

        # Normalize legacy AUTO2 -> AUTO1
        if 'AUTO2' in self._symbols:
            self._symbols = ['AUTO1' if s == 'AUTO2' else s for s in self._symbols]

        # 🔝 AUTO3 Dynamic Resolution (takes priority)
        self.use_auto3 = 'AUTO3' in self._symbols
        if self.use_auto3:
            self._symbols = [s for s in self._symbols if s not in ('AUTO3', 'AUTO1')]
            if not self._symbols:
                self._symbols = ['FETUSDT']
            log.info("🔝 AUTO3 mode enabled - Startup backtest will run")

        # AUTO1 Dynamic Selection
        self.use_auto1 = (not self.use_auto3) and ('AUTO1' in self._symbols)
        if self.use_auto1:
            self._symbols = [s for s in self._symbols if s != 'AUTO1']
            if not self._symbols:
                self._symbols = ['BTCUSDT']
            log.info("🎯 AUTO1 mode enabled - Symbol selector will run at startup")

        # 🤖 AI500 Dynamic Resolution
        if 'AI500_TOP5' in self._symbols:
            self._symbols.remove('AI500_TOP5')
            ai_top5 = self._resolve_ai500_symbols()
            self._symbols = list(set(self._symbols + ai_top5))
            self._symbols.sort()

        if set(self._symbols) != set(old_symbols):
            log.info(f"🔄 Trading symbols reloaded: {', '.join(self._symbols)}")
            global_state.add_log(f"[🔄 CONFIG] Symbols reloaded: {', '.join(self._symbols)}")
            # Update global state
            global_state.symbols = self._symbols
            # Initialize PredictAgent for any new symbols
            self._update_predict_agents()
            return True
        
        return False

    def update_ai500(self):
        new_top5 = self._resolve_ai500_symbols()

        # Update symbols list
        old_symbols = set(self._symbols)
        # Remove old AI coins and add new ones
        # Keep non-AI coins unchanged
        major_coins = {'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'}
        non_ai_symbols = [s for s in self._symbols if s in major_coins]

        # Merge with new AI top5
        self._symbols = list(set(non_ai_symbols + new_top5))
        self._symbols.sort()

        # Update global state
        global_state.symbols = self._symbols

        # Log changes
        added = set(self._symbols) - old_symbols
        removed = old_symbols - set(self._symbols)
        if added or removed:
            log.info(f"📊 AI500 Updated - Added: {added}, Removed: {removed}")
            log.info(f"📋 Current symbols: {', '.join(self._symbols)}")
            for symbol in added:
                self.predict_add_callback(symbol, horizon='30m')
        else:
            log.info("✅ AI500 Updated - No changes in Top5")

    def run_symbol_selector(
        self,
        reason: str = "scheduled",
        check_for_startup_done: bool = False
    ) -> None:
        if not self.agent_config.symbol_selector_agent:
            return
        
        if check_for_startup_done and self.selector_startup_done:
            return
        
        now_ts = time.time()
        active_symbols = self.get_active_position_symbols()
        has_positions = bool(active_symbols)
        
        # Run symbol selector on schedule (every 10 minutes, skip if holding positions)
        # Note: symbol_manager.run_symbol_selector also has internal position check for safety
        if ((now_ts - self.selector_last_run) < self.selector_interval_sec
            or global_state.execution_mode != "Running"
            or has_positions):
            return
        
        if reason != "startup" and self.selector_last_run > 0 and (now_ts - self.selector_last_run) < self.selector_interval_sec:
            return

        if active_symbols:
            locked = [s for s in self._symbols if s in active_symbols]
            if not locked:
                locked = sorted(set(active_symbols))
            log.info(f"🔒 SymbolSelectorAgent skipped (active positions: {', '.join(locked)})")
            global_state.add_log(f"[🔒 SELECTOR] Skipped: active positions ({', '.join(locked)})")
            self.selector_last_run = now_ts
            if reason == "startup":
                self.selector_startup_done = True
            return

        selector_started = now_ts
        try:
            log.info(f"🎰 SymbolSelectorAgent ({reason}) running before analysis...")
            global_state.add_log(f"[🎰 SELECTOR] Symbol selection started ({reason})")
            
            selector = self.agent_provider.symbol_selector_agent
            selector_params = self._resolve_symbol_selector_params(selector)
            self._apply_symbol_selector_runtime_params(selector, selector_params)

            account_equity = self.client.get_account_equity_estimate()
            if hasattr(selector, 'account_equity') and account_equity:
                selector.account_equity = account_equity
            if self.use_auto3:
                top_symbols = asyncio.run(
                    selector.select_top3(force_refresh=False, account_equity=account_equity))
            else:
                top_symbols = asyncio.run(
                    selector.select_auto1_recent_momentum(
                        account_equity=account_equity,
                        window_minutes=int(selector_params.get("auto1_window_minutes", selector.AUTO1_WINDOW_MINUTES)),
                        interval=str(selector_params.get("auto1_interval", selector.AUTO1_INTERVAL)),
                        threshold_pct=float(selector_params.get("auto1_threshold_pct", selector.AUTO1_THRESHOLD_PCT)),
                        volume_ratio_threshold=float(
                            selector_params.get("auto1_volume_ratio_threshold", selector.AUTO1_VOLUME_RATIO_THRESHOLD)
                        ),
                        min_adx=float(selector_params.get("auto1_min_adx", selector.AUTO1_MIN_ADX)),
                        candidate_top_n=int(
                            selector_params.get("auto1_candidate_top_n", selector.AUTO1_CANDIDATE_TOP_N)
                        ),
                        min_directional_score=float(
                            selector_params.get("auto1_min_directional_score", selector.AUTO1_MIN_DIRECTIONAL_SCORE)
                        ),
                        min_alignment_score=float(
                            selector_params.get("auto1_min_alignment_score", selector.AUTO1_MIN_ALIGNMENT_SCORE)
                        ),
                        relax_factor=float(selector_params.get("auto1_relax_factor", selector.AUTO1_RELAX_FACTOR))
                    )
                ) or []

            if top_symbols:
                self._symbols = top_symbols
                self.current_symbol = top_symbols[0]
                global_state.symbols = top_symbols
                selector_payload = {
                    "mode": "AUTO3" if self.use_auto3 else "AUTO1",
                    "symbols": list(top_symbols),
                    "symbol": self._current_symbol,
                    "direction": None,
                    "change_pct": None,
                    "volume_ratio": None,
                    "score": None,
                    "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                }

                if not self.use_auto3:
                    auto1 = getattr(selector, "last_auto1", {}) or {}
                    metrics = auto1.get("results", {}).get(self.current_symbol, {})
                    change_pct = metrics.get("change_pct")
                    if isinstance(change_pct, (int, float)):
                        if change_pct > 0:
                            selector_payload["direction"] = "UP"
                        elif change_pct < 0:
                            selector_payload["direction"] = "DOWN"
                        else:
                            selector_payload["direction"] = "FLAT"
                        selector_payload["change_pct"] = change_pct
                    volume_ratio = metrics.get("volume_ratio")
                    if isinstance(volume_ratio, (int, float)):
                        selector_payload["volume_ratio"] = volume_ratio
                    score = metrics.get("score")
                    if isinstance(score, (int, float)):
                        selector_payload["score"] = score
                    adx = metrics.get("adx")
                    if isinstance(adx, (int, float)):
                        selector_payload["adx"] = adx
                    alignment_score = metrics.get("alignment_score")
                    if isinstance(alignment_score, (int, float)):
                        selector_payload["alignment_score"] = alignment_score
                    impulse_ratio = metrics.get("impulse_ratio")
                    if isinstance(impulse_ratio, (int, float)):
                        selector_payload["impulse_ratio"] = impulse_ratio
                    freshness_score = metrics.get("freshness_score")
                    if isinstance(freshness_score, (int, float)):
                        selector_payload["freshness_score"] = freshness_score
                    directional_edge = metrics.get("directional_range_position")
                    if isinstance(directional_edge, (int, float)):
                        selector_payload["directional_edge"] = directional_edge

                    all_metrics = auto1.get("results", {})
                    if isinstance(all_metrics, dict) and all_metrics:
                        def _safe_float(value: Any, default: float = 0.0) -> float:
                            try:
                                return float(value)
                            except (TypeError, ValueError):
                                return float(default)

                        ranked = []
                        for sym, item in all_metrics.items():
                            if not isinstance(item, dict):
                                continue
                            item_change = _safe_float(item.get("change_pct", 0) or 0)
                            item_score = _safe_float(item.get("score", 0) or 0)
                            if item_change > 0:
                                item_dir = "UP"
                            elif item_change < 0:
                                item_dir = "DOWN"
                            else:
                                item_dir = "FLAT"
                            ranked.append({
                                "symbol": sym,
                                "direction": item_dir,
                                "change_pct": item_change,
                                "score": item_score,
                                "volume_ratio": _safe_float(item.get("volume_ratio", 0) or 0),
                                "alignment_score": _safe_float(item.get("alignment_score", 0) or 0),
                                "impulse_ratio": _safe_float(item.get("impulse_ratio", 0) or 0),
                                "freshness_score": _safe_float(item.get("freshness_score", 0) or 0),
                                "directional_edge": _safe_float(item.get("directional_range_position", 0) or 0),
                            })
                        ranked.sort(key=lambda x: x.get("score", 0), reverse=True)
                        selector_payload["ranked_candidates"] = ranked[:5]
                    selector_payload["window_minutes"] = auto1.get("window_minutes")
                    selector_payload["threshold_pct"] = auto1.get("threshold_pct")
                global_state.symbol_selector = selector_payload
                self._update_primary()

                self._update_predict_agents()

                if self.use_auto3:
                    self.agent_provider.symbol_selector_agent.start_auto_refresh()
                log.info(f"✅ SymbolSelectorAgent ready: {', '.join(top_symbols)}")
                global_state.add_log(f"[🎰 SELECTOR] Selected: {', '.join(top_symbols)}")
                global_state.add_agent_message(
                    "symbol_selector",
                    f"Mode: {selector_payload.get('mode', 'AUTO')} | Symbols: {', '.join(top_symbols)}",
                    level="info"
                )
            else:
                log.warning("⚠️ SymbolSelectorAgent returned empty selection")
                global_state.add_log("[🎰 SELECTOR] Empty selection (fallback to configured symbols)")
        except Exception as e:
            log.error(f"❌ SymbolSelectorAgent failed: {e}")
            global_state.add_log(f"[🎰 SELECTOR] Failed: {e}")
        finally:
            self.selector_last_run = selector_started
            if reason == "startup":
                self.selector_startup_done = True

    def _get_agent_setting_params(self, agent_key: str) -> Dict[str, Any]:
        """Load agent params from shared runtime state; fallback to config/agent_settings.json."""
        settings = getattr(global_state, "agent_settings", None) or {}
        agents = settings.get("agents", {}) if isinstance(settings, dict) else {}
        if isinstance(agents, dict):
            node = agents.get(agent_key, {})
            if isinstance(node, dict):
                params = node.get("params", {})
                if isinstance(params, dict):
                    return dict(params)

        settings_path = os.path.join(os.path.dirname(__file__), "config", "agent_settings.json")
        try:
            with open(settings_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                global_state.agent_settings = data
                node = (data.get("agents", {}) or {}).get(agent_key, {})
                if isinstance(node, dict):
                    params = node.get("params", {})
                    if isinstance(params, dict):
                        return dict(params)
        except Exception:
            pass
        return {}

    def _resolve_symbol_selector_params(self, selector: Any) -> Dict[str, Any]:
        """Resolve symbol-selector params from runtime settings with safe defaults."""
        params = self._get_agent_setting_params("symbol_selector")

        def _num(name: str, default: float) -> float:
            try:
                return float(params.get(name, default))
            except (TypeError, ValueError):
                return float(default)

        def _int(name: str, default: int, lower: int = 1) -> int:
            try:
                return max(lower, int(params.get(name, default)))
            except (TypeError, ValueError):
                return max(lower, int(default))

        interval = str(params.get("auto1_interval", getattr(selector, "AUTO1_INTERVAL", "1m")) or "1m")
        return {
            "refresh_interval_hours": _int("refresh_interval_hours", int(getattr(selector, "refresh_interval", 6))),
            "lookback_hours": _int("lookback_hours", int(getattr(selector, "lookback_hours", 24))),
            "auto1_window_minutes": _int("auto1_window_minutes", int(getattr(selector, "AUTO1_WINDOW_MINUTES", 30))),
            "auto1_threshold_pct": _num("auto1_threshold_pct", float(getattr(selector, "AUTO1_THRESHOLD_PCT", 0.8))),
            "auto1_interval": interval,
            "auto1_volume_ratio_threshold": _num(
                "auto1_volume_ratio_threshold",
                float(getattr(selector, "AUTO1_VOLUME_RATIO_THRESHOLD", 1.2))
            ),
            "auto1_min_adx": _num("auto1_min_adx", float(getattr(selector, "AUTO1_MIN_ADX", 20))),
            "auto1_candidate_top_n": _int(
                "auto1_candidate_top_n",
                int(getattr(selector, "AUTO1_CANDIDATE_TOP_N", 15)),
                lower=3
            ),
            "auto1_min_directional_score": _num(
                "auto1_min_directional_score",
                float(getattr(selector, "AUTO1_MIN_DIRECTIONAL_SCORE", 2.0))
            ),
            "auto1_min_alignment_score": _num(
                "auto1_min_alignment_score",
                float(getattr(selector, "AUTO1_MIN_ALIGNMENT_SCORE", 0.0))
            ),
            "auto1_relax_factor": _num(
                "auto1_relax_factor",
                float(getattr(selector, "AUTO1_RELAX_FACTOR", 0.75))
            ),
            "min_quote_volume": _num("min_quote_volume", float(getattr(selector, "min_quote_volume", 5_000_000))),
            "min_price": _num("min_price", float(getattr(selector, "min_price", 0.05))),
            "min_quote_volume_per_usdt": _num(
                "min_quote_volume_per_usdt",
                float(getattr(selector, "min_quote_volume_per_usdt", 3000))
            )
        }

    def _apply_symbol_selector_runtime_params(self, selector: Any, selector_params: Dict[str, Any]) -> None:
        """Apply selector params immediately so dashboard tuning takes effect in-cycle."""
        selector.refresh_interval = int(selector_params.get("refresh_interval_hours", selector.refresh_interval))
        selector.lookback_hours = int(selector_params.get("lookback_hours", selector.lookback_hours))
        selector.min_quote_volume = float(selector_params.get("min_quote_volume", selector.min_quote_volume))
        selector.min_price = float(selector_params.get("min_price", selector.min_price))
        selector.min_quote_volume_per_usdt = float(
            selector_params.get("min_quote_volume_per_usdt", selector.min_quote_volume_per_usdt)
        )

    def get_active_position_symbols(self) -> List[str]:
        """Return symbols with active positions (test + live)."""
        if self.test_mode:
            active = []
            for symbol, pos in (global_state.virtual_positions or {}).items():
                try:
                    qty = float(pos.get('quantity', 0) or 0)
                except (TypeError, ValueError):
                    qty = 0
                if abs(qty) > 0:
                    active.append(symbol)
            return active

        try:
            account = self.client.get_futures_account()
            positions = account.get('positions', []) or []
            active = []
            for pos in positions:
                amt = pos.get('positionAmt')
                if amt is None:
                    amt = pos.get('position_amt', 0)
                try:
                    if abs(float(amt)) > 0:
                        symbol = pos.get('symbol')
                        if symbol:
                            active.append(symbol)
                except (TypeError, ValueError):
                    continue
            return active
        except Exception as e:
            log.warning(f"Failed to fetch active positions: {e}")
            return []

    def _resolve_ai500_symbols(self):
        """Dynamic resolution of AI500_TOP5 tag"""
        # AI Candidates List (30+ Major AI/Data/Compute Coins)
        AI_CANDIDATES = [
            "FETUSDT", "RENDERUSDT", "TAOUSDT", "NEARUSDT", "GRTUSDT", 
            "WLDUSDT", "ARKMUSDT", "LPTUSDT", "THETAUSDT", "ROSEUSDT",
            # Removed merged/renamed: AGIX, OCEAN, RNDR (now FET/RENDER)
            "PHBUSDT", "CTXCUSDT", "NMRUSDT", "RLCUSDT", "GLMUSDT",
            "IQUSDT", "MDTUSDT", "AIUSDT", "NFPUSDT", "XAIUSDT",
            "JASMYUSDT", "ICPUSDT", "FILUSDT", "VETUSDT", "LINKUSDT",
            "ACTUSDT", "GOATUSDT", "TURBOUSDT", "PNUTUSDT" 
        ]

        try:
            print("🤖 AI500 Dynamic Selection: Fetching 24h Volume Data...")
            # Use temporary client to fetch tickers
            temp_client = BinanceClient()
            tickers = temp_client.get_all_tickers()

            # Filter and Sort
            ai_stats = []
            for t in tickers:
                if t['symbol'] in AI_CANDIDATES:
                    try:
                        quote_vol = float(t['quoteVolume'])
                        ai_stats.append((t['symbol'], quote_vol))
                    except (KeyError, ValueError, TypeError) as e:
                        log.debug(f"Skipped {t.get('symbol', 'unknown')}: {e}")

            # Sort by Volume desc
            ai_stats.sort(key=lambda x: x[1], reverse=True)

            # Take Top 5
            top_5 = [x[0] for x in ai_stats[:5]]

            print(f"✅ AI500 Top 5 Selected (by Vol): {', '.join(top_5)}")
            return top_5
        except Exception as e:
            log.error(f"Failed to resolve AI500 symbols: {e}")
            # Fallback to defaults (Top 5)
            return ["FETUSDT", "RENDERUSDT", "TAOUSDT", "NEARUSDT", "GRTUSDT"]

    def _update_predict_agents(self, horizon='30m'):
        for symbol in self._symbols:
            self.agent_provider.predict_agents_provider.add_agent_for_symbol(symbol, horizon=horizon)

    def _update_primary(self):
        if self._primary_symbol not in self._symbols:
            self._primary_symbol = self._current_symbol
            log.info(f"🔄 Primary symbol updated to {self._primary_symbol} (selector)")
