
from typing import Dict, Any

from src.agents.runtime_events import emit_global_runtime_event, emit_cycle_pipeline_end

from src.trading import CycleContext

from .runner_decorators import log_run

from .oracle_stage_runner import OracleStageRunner
from .agent_analysis_stage_runner import AgentAnalysisStageRunner
from .four_layer_filter_stage_runner import FourLayerFilterStageRunner
from .post_filter_stage_runner import PostFilterStageRunner
from .decision_pipeline_stage_runner import DecisionPipelineStageRunner
from .action_pipeline_stage_runner import ActionPipelineStageRunner

class CyclePipelineRunner:
    def __init__(
        self,
        oracle_stage_runner: OracleStageRunner,
        agent_analysis_stage_runner: AgentAnalysisStageRunner,
        four_layer_filter_stage_runner: FourLayerFilterStageRunner,
        post_filter_stage_runner: PostFilterStageRunner,
        decision_pipeline_stage_runner: DecisionPipelineStageRunner,
        action_pipeline_stage_runner: ActionPipelineStageRunner
    ):
        self.oracle_stage_runner = oracle_stage_runner
        self.agent_analysis_stage_runner = agent_analysis_stage_runner
        self.four_layer_filter_stage_runner = four_layer_filter_stage_runner
        self.post_filter_stage_runner = post_filter_stage_runner
        self.decision_pipeline_stage_runner = decision_pipeline_stage_runner
        self.action_pipeline_stage_runner = action_pipeline_stage_runner
    
    @log_run
    async def run(self, context: CycleContext, headless_mode: bool) -> Dict[str, Any]:
        """Run the full trading pipeline using a prepared cycle context."""
        emit_global_runtime_event(
            context,
            stream="lifecycle",
            agent="cycle_pipeline",
            phase="start",
            data={"symbol": context.symbol, "cycle": context.cycle_num}
        )
        try:
            if not headless_mode:
                print("\n[Step 1/4] 🕵️ The Oracle (Data Agent) - Fetching data...")
            oracle_result = await self.oracle_stage_runner.run(context)
            if oracle_result.early_result is not None:
                early = oracle_result.early_result
                emit_cycle_pipeline_end(context=context, result=early)
                return early

            context.market_snapshot = oracle_result.payload['market_snapshot']
            context.processed_dfs = oracle_result.payload['processed_dfs']
            context.current_price = oracle_result.payload['current_price']
            context.current_position_info = oracle_result.payload['current_position_info']

            if not headless_mode:
                print("[Step 2/4] 👥 Multi-Agent Analysis (Parallel)...")
            context.quant_analysis, context.predict_result, context.reflection_result, context.reflection_text = await self.agent_analysis_stage_runner.run(context)

            if not headless_mode:
                print("[Step 2.75/5] 🎯 Four-Layer Strategy Filter - 多层验证中...")
            context.regime_result, context.four_layer_result, context.trend_1h = self.four_layer_filter_stage_runner.run(context)

            await self.post_filter_stage_runner.run(context, headless_mode)

            decision_result = await self.decision_pipeline_stage_runner.run(context, headless_mode)
            if decision_result.early_result is not None:
                early = decision_result.early_result
                emit_cycle_pipeline_end(context, result=early)
                return early
            context.vote_result = decision_result.payload['vote_result']

            result = await self.action_pipeline_stage_runner.run(context, headless_mode)
            emit_cycle_pipeline_end(context=context, result=result)
            return result
        except Exception as e:
            emit_global_runtime_event(
                context,
                stream="error",
                agent="cycle_pipeline",
                phase="error",
                data={"error": str(e)}
            )
            raise
