import asyncio
from typing import Dict, Any

from src.agents.agent_config import AgentConfig
from src.agents.agent_provider import AgentProvider
from src.config import Config

from src.agents.runtime_events import emit_global_runtime_event
from src.utils.task_util import run_task_with_timeout
from src.utils.agents_util import get_agent_timeout

from src.trading import CycleContext
from src.utils.logger import log
from src.server.state import global_state

from .runner_decorators import log_run

class SemanticAnalysisRunner:
    def __init__(
        self,
        config: Config,
        agent_config: AgentConfig,
        agent_provider: AgentProvider,
    ):
        self.config = config
        self.agent_config = agent_config
        self.agent_provider = agent_provider
      
    @log_run
    async def run(
        self,
        context: CycleContext,
        headless_mode: bool
    ) -> Dict[str, Any]:
        """
        Run optional trend/setup/trigger semantic agents and summarize their outputs.
        """
        use_trend_llm = self.agent_config.trend_agent_llm
        use_trend_local = self.agent_config.trend_agent_local
        use_setup_llm = self.agent_config.setup_agent_llm
        use_setup_local = self.agent_config.setup_agent_local
        use_trigger_llm = self.agent_config.trigger_agent_llm
        use_trigger_local = self.agent_config.trigger_agent_local
        use_trend = use_trend_llm or use_trend_local
        use_setup = use_setup_llm or use_setup_local
        use_trigger = use_trigger_llm or use_trigger_local

        if use_trend and use_trend_llm and use_trend_local:
            log.info("⚠️ Both TrendAgentLLM and TrendAgent enabled; using LLM version only")
        if use_setup and use_setup_llm and use_setup_local:
            log.info("⚠️ Both SetupAgentLLM and SetupAgent enabled; using LLM version only")
        if use_trigger and use_trigger_llm and use_trigger_local:
            log.info("⚠️ Both TriggerAgentLLM and TriggerAgent enabled; using LLM version only")

        if not (use_trend or use_setup or use_trigger):
            global_state.semantic_analyses = {}
            return {}

        if not headless_mode:
            print("[Step 2.5/5] 🤖 Multi-Agent Semantic Analysis...")
            
        emit_global_runtime_event(
            context,
            stream="lifecycle",
            agent="semantic_agents",
            phase="start"
        )

        try:
            trend_data = {
                'symbol': context.symbol,
                'close_1h': context.four_layer_result.get('close_1h', context.current_price),
                'ema20_1h': context.four_layer_result.get('ema20_1h', context.current_price),
                'ema60_1h': context.four_layer_result.get('ema60_1h', context.current_price),
                'oi_change': context.four_layer_result.get('oi_change', 0),
                'adx': context.four_layer_result.get('adx', 20),
                'regime': context.four_layer_result.get('regime', 'unknown')
            }

            setup_data = {
                'symbol': context.symbol,
                'close_15m': context.processed_dfs['15m']['close'].iloc[-1] if len(context.processed_dfs['15m']) > 0 else context.current_price,
                'kdj_j': context.four_layer_result.get('kdj_j', 50),
                'kdj_k': context.processed_dfs['15m']['kdj_k'].iloc[-1] if 'kdj_k' in context.processed_dfs['15m'].columns else 50,
                'bb_upper': context.processed_dfs['15m']['bb_upper'].iloc[-1] if 'bb_upper' in context.processed_dfs['15m'].columns else context.current_price * 1.02,
                'bb_middle': context.processed_dfs['15m']['bb_middle'].iloc[-1] if 'bb_middle' in context.processed_dfs['15m'].columns else context.current_price,
                'bb_lower': context.processed_dfs['15m']['bb_lower'].iloc[-1] if 'bb_lower' in context.processed_dfs['15m'].columns else context.current_price * 0.98,
                'trend_direction': context.trend_1h,
                'macd_diff': context.processed_dfs['15m']['macd_diff'].iloc[-1] if 'macd_diff' in context.processed_dfs['15m'].columns else 0
            }

            trigger_data = {
                'symbol': context.symbol,
                'pattern': context.four_layer_result.get('trigger_pattern'),
                'rvol': context.four_layer_result.get('trigger_rvol', 1.0),
                'trend_direction': context.four_layer_result.get('final_action', 'neutral')
            }

            tasks = {}
            loop = asyncio.get_running_loop()
            if use_trend:
                tasks['trend'] = loop.run_in_executor(None, self.agent_provider.trend_agent.analyze, trend_data)

            if use_setup:
                tasks['setup'] = loop.run_in_executor(None, self.agent_provider.setup_agent.analyze, setup_data)

            if use_trigger:
                tasks['trigger'] = loop.run_in_executor(None, self.agent_provider.trigger_agent.analyze, trigger_data)

            analyses: Dict[str, Any] = {}
            if tasks:
                semantic_timeout = get_agent_timeout(self.config, self.agent_config, 'semantic_agent', 35.0)
                wrapped_tasks = {
                    key: run_task_with_timeout(
                        context,
                        agent_name=f"{key}_agent",
                        timeout_seconds=semantic_timeout,
                        task_factory=(lambda fut=fut: fut),
                        fallback=None
                    )
                    for key, fut in tasks.items()
                }
                results = await asyncio.gather(*wrapped_tasks.values())
                analyses = {
                    key: val
                    for key, val in zip(wrapped_tasks.keys(), results)
                    if val is not None
                }

            global_state.semantic_analyses = analyses
            if analyses:
                trend_mark = '✓' if analyses.get('trend') else '○'
                setup_mark = '✓' if analyses.get('setup') else '○'
                trigger_mark = '✓' if analyses.get('trigger') else '○'
                global_state.add_log(f"[⚖️ CRITIC] 4-Layer Analysis: Trend={trend_mark} | Setup={setup_mark} | Trigger={trigger_mark}")

                trend_result = analyses.get('trend')
                if isinstance(trend_result, dict):
                    meta = trend_result.get('metadata', {}) or {}
                    summary = (
                        f"Stance: {trend_result.get('stance', 'UNKNOWN')} | "
                        f"Strength: {meta.get('strength', 'N/A')} | "
                        f"ADX: {meta.get('adx', 'N/A')} | "
                        f"OI Fuel: {meta.get('oi_fuel', 'N/A')}"
                    )
                    global_state.add_agent_message("trend_agent", summary, level="info")

                setup_result = analyses.get('setup')
                if isinstance(setup_result, dict):
                    meta = setup_result.get('metadata', {}) or {}
                    summary = (
                        f"Stance: {setup_result.get('stance', 'UNKNOWN')} | "
                        f"Zone: {meta.get('zone', 'N/A')} | "
                        f"KDJ: {meta.get('kdj_j', 'N/A')} | "
                        f"MACD: {meta.get('macd_signal', 'N/A')}"
                    )
                    global_state.add_agent_message("setup_agent", summary, level="info")

                trigger_result = analyses.get('trigger')
                if isinstance(trigger_result, dict):
                    meta = trigger_result.get('metadata', {}) or {}
                    summary = (
                        f"Stance: {trigger_result.get('stance', 'UNKNOWN')} | "
                        f"Pattern: {meta.get('pattern', 'NONE')} | "
                        f"RVOL: {meta.get('rvol', 'N/A')}x"
                    )
                    global_state.add_agent_message("trigger_agent", summary, level="info")

            emit_global_runtime_event(
                context,
                stream="lifecycle",
                agent="semantic_agents",
                phase="end",
                data={"count": len(analyses)}
            )
            return analyses

        except Exception as e:
            log.error(f"❌ Multi-Agent analysis failed: {e}")
            fallback = {
                'trend': f"Trend analysis unavailable: {e}",
                'setup': f"Setup analysis unavailable: {e}",
                'trigger': f"Trigger analysis unavailable: {e}"
            }
            global_state.semantic_analyses = fallback
            emit_global_runtime_event(
                context,
                stream="error",
                agent="semantic_agents",
                phase="error",
                data={"error": str(e)}
            )
            return fallback