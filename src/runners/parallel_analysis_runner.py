import asyncio

from typing import Dict, Optional, Tuple
from dataclasses import asdict

from src.config import Config
from src.agents.agent_config import AgentConfig
from src.agents.agent_provider import AgentProvider

from src.utils.data_saver import DataSaver
from src.agents.reflection import ReflectionResult

from src.trading import CycleContext
from src.agents.predict import PredictResult

from src.server.state import global_state

from src.utils.task_util import run_task_with_timeout
from src.utils.agents_util import get_agent_timeout

from .runner_decorators import log_run

class ParallelAnalysisRunner:
    def __init__(
        self,
        config: Config,
        agent_config: AgentConfig,
        agent_provider: AgentProvider,
        saver: DataSaver
    ):
        self.config = config
        self.agent_config = agent_config
        self.saver = saver
        self.agent_provider = agent_provider

    @log_run
    async def run(
        self,
        context: CycleContext
    ) -> Tuple[Dict, Optional[PredictResult], Optional[ReflectionResult], Optional[str]]:
        """
        Run quant/predict/reflection in parallel with timeouts and safe fallbacks.
        """
        async def quant_task():
            res = await self.agent_provider.quant_analyst_agent.analyze_all_timeframes(context.market_snapshot)
            trend_score = res.get('trend', {}).get('total_trend_score', 0)
            osc_score = res.get('oscillator', {}).get('total_osc_score', 0)
            sent_score = res.get('sentiment', {}).get('total_sentiment_score', 0)
            quant_msg = f"Analysis Complete. Trend={trend_score:+.0f} | Osc={osc_score:+.0f} | Sent={sent_score:+.0f}"
            global_state.add_agent_message("quant_analyst", quant_msg, level="success")
            return res

        async def predict_task() -> Optional[PredictResult]:
            prediction = await self.agent_provider.predict_agents_provider.predict(context.symbol, context.processed_dfs)
            if prediction:
                self.saver.save_prediction(asdict(prediction), context.symbol, context.snapshot_id, cycle_id=context.cycle_id)
            return prediction

        async def reflection_task() -> Optional[ReflectionResult]:
            total_trades = len(global_state.trade_history)
            if self.agent_provider.reflection_agent and self.agent_provider.reflection_agent.should_reflect(total_trades):
                global_state.add_agent_message("reflection_agent", "🔍 Reflecting on recent trade performance...", level="info")
                trades_to_analyze = global_state.trade_history[-10:]
                res = await self.agent_provider.reflection_agent.generate_reflection(trades_to_analyze)
                if res:
                    reflection_text = res.to_prompt_text()
                    global_state.last_reflection = res.raw_response
                    global_state.last_reflection_text = reflection_text
                    global_state.reflection_count = self.agent_provider.reflection_agent.reflection_count
                    global_state.add_agent_message(
                        "reflection_agent",
                        f"Reflected on {len(trades_to_analyze)} trades. Insight: {res.insight}",
                        level="info"
                    )
                return res
            return None

        quant_timeout = get_agent_timeout(self.config, self.agent_config, 'quant_analyst', 25.0)
        predict_timeout = get_agent_timeout(self.config, self.agent_config, 'predict_agent', 30.0)
        reflection_timeout = get_agent_timeout(self.config, self.agent_config, 'reflection_agent', 45.0)

        analysis_results = await asyncio.gather(
            run_task_with_timeout(
                context,
                agent_name="quant_analyst",
                timeout_seconds=quant_timeout,
                task_factory=quant_task,
                fallback={}
            ),
            run_task_with_timeout(
                context,
                agent_name="predict_agent",
                timeout_seconds=predict_timeout,
                task_factory=predict_task,
                fallback=None
            ),
            run_task_with_timeout(
                context,
                agent_name="reflection_agent",
                timeout_seconds=reflection_timeout,
                task_factory=reflection_task,
                fallback=None
            )
        )

        quant_analysis = analysis_results[0] if isinstance(analysis_results[0], dict) else {}
        predict_result = analysis_results[1]
        reflection_result = analysis_results[2]
        reflection_text = reflection_result.to_prompt_text() if reflection_result else global_state.last_reflection_text
        return quant_analysis, predict_result, reflection_result, reflection_text
