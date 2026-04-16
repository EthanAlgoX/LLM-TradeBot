from typing import Dict, Optional, Any, Tuple

from src.utils.data_saver import DataSaver

from src.agents.runtime_events import emit_global_runtime_event

from src.trading import CycleContext
from src.agents.predict import PredictResult  # ✅ PredictResult Import
from src.agents.reflection import ReflectionResult
from src.utils.logger import log
from src.server.state import global_state

from .runner_decorators import log_run

from .parallel_analysis_runner import ParallelAnalysisRunner

class AgentAnalysisStageRunner:
    def __init__(
        self,
        parallel_analysis_runner: ParallelAnalysisRunner,
        saver: DataSaver
    ):
        self.saver = saver
        self.parallel_analysis_runner = parallel_analysis_runner

    @log_run
    async def run(
        self,
        context: CycleContext
    ) -> Tuple[Dict[str, Any], PredictResult, ReflectionResult, Optional[str]]:
        """Run Step 2 parallel analysts and persist analysis context."""
        emit_global_runtime_event(
            context,
            stream="lifecycle",
            agent="analysis_stage",
            phase="start"
        )
        try:
            global_state.add_log(f"[📊 SYSTEM] Parallel analysis started for {context.symbol}")

            quant_analysis, predict_result, reflection_result, reflection_text = await self.parallel_analysis_runner.run(context)

            try:
                df_15m = context.processed_dfs['15m']
                if 'macd_diff' in df_15m.columns:
                    macd_val = float(df_15m['macd_diff'].iloc[-1])
                    if 'trend' not in quant_analysis:
                        quant_analysis['trend'] = {}
                    if 'details' not in quant_analysis['trend']:
                        quant_analysis['trend']['details'] = {}
                    quant_analysis['trend']['details']['15m_macd_diff'] = macd_val
            except Exception as e:
                log.warning(f"Failed to inject MACD data: {e}")

            self.saver.save_context(quant_analysis, context.symbol, 'analytics', context.snapshot_id, cycle_id=context.cycle_id)

            trend_score = quant_analysis.get('trend', {}).get('total_trend_score', 0)
            osc_score = quant_analysis.get('oscillator', {}).get('total_osc_score', 0)
            sent_score = quant_analysis.get('sentiment', {}).get('total_sentiment_score', 0)
            global_state.add_log(f"[👨‍🔬 STRATEGIST] Trend={trend_score:+.0f} | Osc={osc_score:+.0f} | Sent={sent_score:+.0f}")

            emit_global_runtime_event(
                context,
                stream="lifecycle",
                agent="analysis_stage",
                phase="end"
            )
            return quant_analysis, predict_result, reflection_result, reflection_text
        except Exception as e:
            emit_global_runtime_event(
                context,
                stream="error",
                agent="analysis_stage",
                phase="error",
                data={"error": str(e)}
            )
            raise
