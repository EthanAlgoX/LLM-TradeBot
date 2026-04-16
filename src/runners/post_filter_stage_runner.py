from src.agents.runtime_events import emit_global_runtime_event
from src.agents.agent_provider import AgentProvider

from src.utils.logger import log
from src.server.state import global_state

from src.trading import CycleContext

from .runner_decorators import log_run

from .semantic_analysis_runner import SemanticAnalysisRunner

class PostFilterStageRunner:
    def __init__(
        self,
        agent_provider: AgentProvider,
        semantic_analysis_runner: SemanticAnalysisRunner
    ):
        self.agent_provider = agent_provider  
        self.semantic_analysis_runner = semantic_analysis_runner

    @log_run
    async def run(
        self,
        context: CycleContext,
        headless_mode: bool
    ) -> None:
        """Run semantic agents + multi-period parser after four-layer filtering."""
        emit_global_runtime_event(
            context,
            stream="lifecycle",
            agent="post_filter_stage",
            phase="start",
        )
        try:
            await self.semantic_analysis_runner.run(context, headless_mode)

            try:
                multi_period_result = self.agent_provider.multi_period_agent.analyze(
                    quant_analysis=context.quant_analysis,
                    four_layer_result=context.four_layer_result,
                    semantic_analyses=getattr(global_state, 'semantic_analyses', {}) or {}
                )
                global_state.multi_period_result = multi_period_result
                summary = multi_period_result.get('summary')
                if summary:
                    global_state.add_agent_message("multi_period_agent", summary, level="info")
            except Exception as e:
                log.error(f"❌ Multi-Period Parser Agent failed: {e}")
                global_state.multi_period_result = {}

            emit_global_runtime_event(
                context,
                stream="lifecycle",
                agent="post_filter_stage",
                phase="end",
            )
        except Exception as e:
            emit_global_runtime_event(
                context,
                stream="error",
                agent="post_filter_stage",
                phase="error",
                data={"error": str(e)}
            )
            raise

