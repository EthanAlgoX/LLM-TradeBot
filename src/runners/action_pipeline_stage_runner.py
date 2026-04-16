from typing import Dict, Optional, Any

from src.utils.logger import log
from src.server.state import global_state

from src.trading import CycleContext
from src.runners.result_builder import ResultBuilder

from src.utils.data_saver import DataSaver

from .runner_decorators import log_run

from .risk_audit_stage_runner import RiskAuditStageRunner
from .execution_stage_runner import ExecutionStageRunner

class ActionPipelineStageRunner:
    def __init__(
        self,
        risk_audit_stage_runner: RiskAuditStageRunner,
        execution_stage_runner: ExecutionStageRunner,
        saver: DataSaver
    ):
        self.risk_audit_stage_runner = risk_audit_stage_runner
        self.execution_stage_runner = execution_stage_runner
        self.result_builder = ResultBuilder(saver)
    
    @log_run
    async def run(
        self,
        context: CycleContext,
        headless_mode: bool
    ) -> Dict[str, Any]:
        if not headless_mode:
            print(f"[Step 4/5] 👮 The Guardian (Risk Audit) - Final review...")

        """Run risk-audit -> analyze-only gate -> execution as one stage."""
        context.order_params, audit_result, context.account_balance, context.current_position = await self.risk_audit_stage_runner.run(context)

        blocked_result = self._finalize_risk_audit_decision(
            context,
            audit_result=audit_result,
        )
        if blocked_result is not None:
            return blocked_result

        analyze_only_result = self._build_analyze_only_suggestion(context)
        if analyze_only_result is not None:
            return analyze_only_result

        return await self.execution_stage_runner.run(context, headless_mode)

    
    def _finalize_risk_audit_decision(
        self,
        context: CycleContext,
        *,
        audit_result: Any
    ) -> Optional[Dict[str, Any]]:
        """Persist audit outcome, apply corrections, update state, and return blocked result if needed."""
        decision_dict = self.result_builder.build_decision_snapshot(
            symbol=context.symbol,
            vote_result=context.vote_result,
            quant_analysis=context.quant_analysis,
            predict_result=context.predict_result,
            risk_level=audit_result.risk_level.value,
            guardian_passed=audit_result.passed,
            guardian_reason=audit_result.blocked_reason
        )

        self.saver.save_risk_audit(
            audit_result={
                'passed': audit_result.passed,
                'risk_level': audit_result.risk_level.value,
                'blocked_reason': audit_result.blocked_reason,
                'corrections': audit_result.corrections,
                'warnings': audit_result.warnings,
                'order_params': context.order_params,
                'cycle_id': context.cycle_id
            },
            symbol=context.symbol,
            snapshot_id=context.snapshot_id,
            cycle_id=context.cycle_id
        )

        print(f"  ✅ 审计结果: {'✅ 通过' if audit_result.passed else '❌ 拦截'}")
        print(f"  ✅ 风险等级: {audit_result.risk_level.value}")

        if audit_result.corrections:
            print("  ⚠️  自动修正:")
            for key, value in audit_result.corrections.items():
                print(f"     {key}: {context.order_params[key]} -> {value}")
                context.order_params[key] = value

        if audit_result.warnings:
            print("  ⚠️  警告信息:")
            for warning in audit_result.warnings:
                print(f"     {warning}")

        decision_dict['order_params'] = context.order_params
        global_state.update_decision(decision_dict)

        if not audit_result.passed:
            print(f"\n❌ 决策被风控拦截: {audit_result.blocked_reason}")
            return {
                'status': 'blocked',
                'action': context.vote_result.action,
                'details': {
                    'reason': audit_result.blocked_reason,
                    'risk_level': audit_result.risk_level.value
                },
                'current_price': context.current_price
            }

        return None

    def _build_analyze_only_suggestion(
        self,
        context: CycleContext
    ) -> Optional[Dict[str, Any]]:
        """Return suggested result for open actions in analyze_only mode."""
        if not (context.analyze_only and context.vote_result.action in ('open_long', 'open_short')):
            return None

        log.info(f"🔍 [Analyze Only] Strategy suggests {context.vote_result.action.upper()} for {context.symbol}, skipping execution for selector")
        return {
            'status': 'suggested',
            'action': context.vote_result.action,
            'confidence': context.vote_result.confidence,
            'order_params': context.order_params,
            'vote_result': context.vote_result,
            'current_price': context.current_price
        }
