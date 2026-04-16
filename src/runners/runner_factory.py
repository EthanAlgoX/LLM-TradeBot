from src.agents.agent_config import AgentConfig
from src.config import Config
from src.trading import TradingParameters

from src.strategy.llm_engine import StrategyEngine
from src.api.binance_client import BinanceClient
from src.utils.data_saver import DataSaver
from src.agents.agent_provider import AgentProvider

from .action_pipeline_stage_runner import ActionPipelineStageRunner
from .agent_analysis_stage_runner import AgentAnalysisStageRunner
from .cycle_pipeline_runner import CyclePipelineRunner
from .decision_pipeline_stage_runner import DecisionPipelineStageRunner
from .decision_stage_runner import DecisionStageRunner
from .execution_stage_runner import ExecutionStageRunner
from .oracle_stage_runner import OracleStageRunner
from .parallel_analysis_runner import ParallelAnalysisRunner
from .post_filter_stage_runner import PostFilterStageRunner
from .risk_audit_stage_runner import RiskAuditStageRunner
from .semantic_analysis_runner import SemanticAnalysisRunner
from .four_layer_filter_stage_runner import FourLayerFilterStageRunner
from .four_layer_state_container import FourLayerStateContainer

class RunnerFactory:
    def __init__(
        self,
        config: Config,
        agent_config: AgentConfig,
        client: BinanceClient,
        agent_provider: AgentProvider,
        strategy_engine: StrategyEngine,
        saver: DataSaver,
        trading_parameters: TradingParameters
    ):
        self.config = config
        self.agent_config = agent_config
        self.saver = saver
        self.strategy_engine = strategy_engine
        self.agent_provider = agent_provider
        self.client = client
        self.trading_parameters = trading_parameters
        self._four_layer_state_container = FourLayerStateContainer()    # needs to be persistent

    @property
    def action_pipeline_stage_runner(self) -> ActionPipelineStageRunner:
        return ActionPipelineStageRunner(self.risk_audit_stage_runner, self.execution_stage_runner, self.saver)
    
    @property
    def agent_analysis_stage_runner(self) -> AgentAnalysisStageRunner:
        return AgentAnalysisStageRunner(self.parallel_analysis_runner, self.saver)
    
    @property
    def cycle_pipeline_runner(self) -> CyclePipelineRunner:
        return CyclePipelineRunner(
            self.oracle_stage_runner,
            self.agent_analysis_stage_runner,
            self.four_layer_filter_stage_runner,
            self.post_filter_stage_runner,
            self.decision_pipeline_stage_runner,
            self.action_pipeline_stage_runner
        )
    
    @property
    def decision_pipeline_stage_runner(self) -> DecisionPipelineStageRunner:
        return DecisionPipelineStageRunner(
            self.decision_stage_runner,
            self.saver,
            self.trading_parameters.test_mode
        )
    
    @property
    def decision_stage_runner(self) -> DecisionStageRunner:
        return DecisionStageRunner(
            self.config,
            self.agent_config,
            self.strategy_engine,
            self.trading_parameters.max_position_size
        )
    
    @property
    def execution_stage_runner(self) -> ExecutionStageRunner:
        return ExecutionStageRunner(
            self.saver, 
            self.trading_parameters.test_mode
        )
    
    @property
    def four_layer_filter_stage_runner(self) -> FourLayerFilterStageRunner:
        return FourLayerFilterStageRunner(
            self.config,
            self.agent_config,
            self.agent_provider,
            self._four_layer_state_container
        )
    
    @property
    def oracle_stage_runner(self) -> OracleStageRunner:
        return OracleStageRunner(
            self.config,
            self.agent_config,
            self.client,
            self.agent_provider,
            self.saver,
            self.trading_parameters.kline_limit,
            self.trading_parameters.test_mode
        )
        
    @property
    def parallel_analysis_runner(self) -> ParallelAnalysisRunner:
        return ParallelAnalysisRunner(
            self.config,
            self.agent_config,
            self.agent_provider,
            self.saver
        )

    @property
    def post_filter_stage_runner(self) -> PostFilterStageRunner:
        return PostFilterStageRunner(
            self.agent_provider,
            self.semantic_analysis_runner
        )

    @property
    def risk_audit_stage_runner(self) -> RiskAuditStageRunner:
        return RiskAuditStageRunner(
            self.config,
            self.agent_config,
            self.client,
            self.agent_provider,
            self.trading_parameters.leverage,
            self.trading_parameters.stop_loss_pct,
            self.trading_parameters.take_profit_pct,
            self.trading_parameters.test_mode
        )

    @property
    def semantic_analysis_runner(self) -> SemanticAnalysisRunner:
        return SemanticAnalysisRunner(
            self.config,
            self.agent_config,
            self.agent_provider
        )
