from typing import List

from src.config import Config
from src.api.binance_client import BinanceClient

from .agent_config import AgentConfig
from .quant_analyst_agent import QuantAnalystAgent
from .regime_detector_agent import RegimeDetector
from .multi_period_agent import MultiPeriodParserAgent
from .symbol_selector_agent import SymbolSelectorAgent
from .trigger_detector_agent import TriggerDetector
from .data_sync import DataSyncAgent
from .decision_core import DecisionCoreAgent
from .predict import PredictAgentsProvider
from .risk_audit import RiskAuditAgent
from .reflection import ReflectionAgentLLM, ReflectionAgentNoLLM
from .trend import TrendAgentLLM, TrendAgentNoLLM
from .setup import SetupAgentLLM, SetupAgentNoLLM
from .trigger import TriggerAgentLLM, TriggerAgentNoLLM

class AgentProvider:
    def __init__(
        self,
        config: Config,
        agent_config: AgentConfig,
        client: BinanceClient
    ):
        self.config = config
        self.agent_config = agent_config
        self.client = client

        self.risk_audit_agent = RiskAuditAgent(
            max_leverage=10.0,
            max_position_pct=0.3,
            min_stop_loss_pct=0.005,
            max_stop_loss_pct=0.05
        )
        self.trigger_detector_agent = TriggerDetector()
        self.quant_analyst_agent = QuantAnalystAgent()     
        self.multi_period_agent = MultiPeriodParserAgent()
        self.decision_core_agent = DecisionCoreAgent()
        self.symbol_selector_agent = SymbolSelectorAgent()
          
        print("  ✅ TriggerDetector ready")
        print("  ✅ QuantAnalystAgent ready")
        print("  ✅ RiskAuditAgent ready")
        print("  ✅ MultiPeriodParserAgent ready")
        print("  ✅ DecisionCoreAgent ready")
        print("  ✅ SymbolSelectorAgent ready")

    def initialize(
        self,
        symbols: List[str]
    ):        
        self._set_predict_agents_provider(symbols)
        self._set_agents()

    def reload(
        self,
        client: BinanceClient,
        symbols: List[str]
    ):
        self.client = client
        self._set_agents()

        if self.agent_config.predict_agent:
            self.predict_agents_provider.reload(symbols)
        else:
            self.predict_agents_provider = None

    def _set_agents(self):
        self.data_sync_agent = DataSyncAgent(self.client)

        self._set_reflection_agent()
        self._set_trend_agent()
        self._set_setup_agent()
        self._set_trigger_agent()
        self._set_regime_detector_agent()

    def _set_predict_agents_provider(
        self,
        symbols: List[str]
    ):
        # 🆕 Optional Agent: PredictAgent (per symbol)
        if self.agent_config.predict_agent:
            print("[DEBUG] Creating PredictAgents...")
            self.predict_agents_provider = PredictAgentsProvider(self.client, self.agent_config, symbols)
            print(f"  ✅ PredictAgent ready ({len(symbols)} symbols)")
        else:
            print("  ⏭️ PredictAgent disabled")
            self.predict_agents_provider = None

    def _set_reflection_agent(self):
        # Optional Agent: ReflectionAgent
        if self.agent_config.reflection_agent_llm or self.agent_config.reflection_agent_local:
            if self.agent_config.reflection_agent_llm:
                if not hasattr(self, 'reflection_agent') or not isinstance(self.reflection_agent, ReflectionAgentLLM):
                    self.reflection_agent = ReflectionAgentLLM(self.config)
            else:
                if not hasattr(self, 'reflection_agent') or not isinstance(self.reflection_agent, ReflectionAgentNoLLM):
                    self.reflection_agent = ReflectionAgentNoLLM()
        else:
            print("  ⏭️ ReflectionAgent disabled")
            self.reflection_agent = None

    def _set_trend_agent(self):
        # 🆕 Optional Agent: TrendAgent
        if self.agent_config.trend_agent_llm or self.agent_config.trend_agent_local:       
            if self.agent_config.trend_agent_llm:
                if not hasattr(self, 'trend_agent') or not isinstance(self.trend_agent, TrendAgentLLM):
                    self.trend_agent = TrendAgentLLM(self.config)
            else:
                if not hasattr(self, 'trend_agent') or not isinstance(self.trend_agent, TrendAgentNoLLM):
                    self.trend_agent = TrendAgentNoLLM()
        else:
            print("  ⏭️ TrendAgent disabled")
            self.trend_agent = None

    def _set_setup_agent(self):
        # 🆕 Optional Agent: SetupAgent
        if self.agent_config.setup_agent_llm or self.agent_config.setup_agent_local:       
            if self.agent_config.setup_agent_llm:
                if not hasattr(self, 'setup_agent') or not isinstance(self.setup_agent, SetupAgentLLM):
                    self.setup_agent = SetupAgentLLM(self.config)
            else:
                if not hasattr(self, 'setup_agent') or not isinstance(self.setup_agent, SetupAgentNoLLM):
                    self.setup_agent = SetupAgentNoLLM()
        else:
            print("  ⏭️ SetupAgent disabled")
            self.setup_agent = None
    
    def _set_trigger_agent(self):
        # 🆕 Optional Agent: TriggerAgent
        if self.agent_config.trigger_agent_llm or self.agent_config.trigger_agent_local:       
            if self.agent_config.trigger_agent_llm:
                if not hasattr(self, 'trigger_agent') or not isinstance(self.trigger_agent, TriggerAgentLLM):
                    self.trigger_agent = TriggerAgentLLM(self.config)
            else:
                if not hasattr(self, 'trigger_agent') or not isinstance(self.trigger_agent, TriggerAgentNoLLM):
                    self.trigger_agent = TriggerAgentNoLLM()
        else:
            print("  ⏭️ TriggerAgent disabled")
            self.trigger_agent = None

    def _set_regime_detector_agent(self):
        # 🆕 Optional Agent: RegimeDetector
        if self.agent_config.regime_detector_agent:
            if not hasattr(self, 'regime_detector_agent'):
                self.regime_detector_agent = RegimeDetector()
        else:
            print("  ⏭️ RegimeDetectorAgent disabled")
            self.regime_detector_agent = None