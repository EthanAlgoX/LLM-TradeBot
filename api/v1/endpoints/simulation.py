# -*- coding: utf-8 -*-
"""Isolated persistence APIs for the strategy-lab simulation workspace."""

from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, Security, UploadFile
from fastapi.security import APIKeyCookie

from api.v1.schemas.common import ErrorResponse
from api.v1.schemas.simulation import (
    SimulationRunCreateRequest,
    SimulationRunItem,
    SimulationRunExecuteResponse,
    SimulationRunDetailResponse,
    SimulationRunListResponse,
    SimulationStrategyCreateRequest,
    SimulationStrategyItem,
    SimulationStrategyListResponse,
    SimulationStrategyUpdateRequest,
    SimulationStrategyVersionCreateRequest,
    SimulationStrategyVersionItem,
    SimulationTemplateListResponse,
    SimulationAccountCreateRequest,
    SimulationAccountItem,
    SimulationAccountListResponse, SimulationPaperOrderListResponse,
    SimulationPaperExecutionRequest, SimulationPaperExecutionResponse,
    StrategyCreateRequest, StrategyDraftSaveRequest, StrategyPublishRequest,
    StrategyCreateDraftRequest, StrategyForkLocalRequest, StrategyDefinitionResponse,
    PublishedStrategyRunCandidate, PublishedStrategyRunCreateRequest,
    PublishedStrategyRunItem, PublishedStrategyRunListResponse,
    AutomaticStrategyRunCreateRequest, AutomaticStrategyRunBatchItem,
    AutomaticStrategyRunBatchListResponse,
    ContinuousStrategyRunStartRequest, ContinuousStrategyRunControlItem,
    ContinuousStrategyRunControlListResponse,
    StrategyValidationExperimentCreateRequest, StrategyValidationExperimentItem,
    StrategyValidationExperimentListResponse, StrategyValidationVersionStatusItem,
    StrategyValidationComparisonRequest, StrategyValidationComparisonResponse,
    StrategyDataSourceCreateRequest,
    StrategyKernelExecuteRequest,
    AgentTemplateCreateRequest, AgentTemplateUpdateRequest,
    AgentWorkflowCreateRequest, AgentWorkflowDraftSaveRequest,
    AgentWorkflowPublishRequest, AgentWorkflowCreateDraftRequest,
)
from src.auth import COOKIE_NAME
from src.services.simulation_strategy_service import SimulationStrategyNotFoundError, SimulationStrategyService
from src.services.simulation_paper_execution_service import SimulationPaperExecutionError, SimulationPaperExecutionService
from src.services.strategy_definition_service import StrategyDefinitionError, StrategyDefinitionService
from src.services.strategy_continuous_run_service import StrategyContinuousRunError, StrategyContinuousRunService
from src.services.strategy_validation_service import StrategyValidationError, StrategyValidationService
from src.services.strategy_package_service import StrategyPackageService
from src.services.strategy_kernel_executor_service import StrategyKernelExecutorService
from src.services.agent_center_service import AgentCenterService

simulation_session_cookie = APIKeyCookie(name=COOKIE_NAME, auto_error=False, scheme_name="AdminSessionCookie")
router = APIRouter(dependencies=[Security(simulation_session_cookie)])

AUTH_RESPONSE = {401: {"model": ErrorResponse, "description": "未登录或管理员会话无效（ADMIN_AUTH_ENABLED=true 时）"}}


def _bad_request(exc: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail={"error": "validation_error", "message": str(exc)})


def _definition_error(exc: StrategyDefinitionError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message, "details": exc.details})


def _strategy_validation_error(exc: StrategyValidationError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message})


# Versioned definition endpoints.  The existing preview endpoints below stay
# compatible; these routes are the only mutable strategy-definition boundary.
@router.post("/definition/strategies", response_model=StrategyDefinitionResponse)
def definition_create_strategy(request: StrategyCreateRequest) -> dict:
    try: return StrategyDefinitionService().create_strategy(request.model_dump())
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.get("/definition/strategies", response_model=list[StrategyDefinitionResponse])
def definition_list_strategies(include_archived: bool = False) -> list[dict]:
    service = StrategyDefinitionService()
    service.ensure_daily_product_strategies()
    return service.list_strategies(include_archived)

@router.get("/definition/agent-templates", response_model=list[StrategyDefinitionResponse])
def definition_list_agent_templates(agent_type: str | None = None, q: str | None = None) -> list[dict]:
    return AgentCenterService().list_templates(agent_type, q)

@router.get("/definition/agent-templates/{template_id}", response_model=StrategyDefinitionResponse)
def definition_get_agent_template(template_id: int, version: int | None = None) -> dict:
    try: return AgentCenterService().get_template(template_id, version)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.post("/definition/agent-templates", response_model=StrategyDefinitionResponse)
def definition_create_agent_template(request: AgentTemplateCreateRequest) -> dict:
    try: return AgentCenterService().create_template(request.model_dump())
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.put("/definition/agent-templates/{template_id}", response_model=StrategyDefinitionResponse)
def definition_update_agent_template(template_id: int, request: AgentTemplateUpdateRequest) -> dict:
    try: return AgentCenterService().update_template(template_id, request.model_dump(exclude_none=True))
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.delete("/definition/agent-templates/{template_id}", response_model=StrategyDefinitionResponse)
def definition_archive_agent_template(template_id: int) -> dict:
    try: return AgentCenterService().archive_template(template_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.get("/definition/agent-workflows", response_model=list[StrategyDefinitionResponse])
def definition_list_agent_workflows(include_archived: bool = False) -> list[dict]:
    return AgentCenterService().list_workflows(include_archived)


@router.post("/definition/agent-workflows", response_model=StrategyDefinitionResponse)
def definition_create_agent_workflow(request: AgentWorkflowCreateRequest) -> dict:
    try: return AgentCenterService().create_workflow(request.model_dump())
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.get("/definition/agent-workflows/published-versions", response_model=list[StrategyDefinitionResponse])
def definition_list_published_agent_workflow_versions(current_only: bool = True) -> list[dict]:
    return AgentCenterService().list_published_workflow_versions(current_only)


@router.get("/definition/agent-workflows/{workflow_id}", response_model=StrategyDefinitionResponse)
def definition_get_agent_workflow(workflow_id: int) -> dict:
    try: return AgentCenterService().get_workflow(workflow_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.post("/definition/agent-workflows/{workflow_id}/drafts", response_model=StrategyDefinitionResponse)
def definition_create_agent_workflow_draft(workflow_id: int, request: AgentWorkflowCreateDraftRequest) -> dict:
    try: return AgentCenterService().create_workflow_draft(workflow_id, request.basedOnVersionId)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.delete("/definition/agent-workflows/{workflow_id}", response_model=StrategyDefinitionResponse)
def definition_archive_agent_workflow(workflow_id: int) -> dict:
    try: return AgentCenterService().archive_workflow(workflow_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.get("/definition/agent-workflow-versions/{version_id}", response_model=StrategyDefinitionResponse)
def definition_get_agent_workflow_version(version_id: int) -> dict:
    try: return AgentCenterService().get_workflow_version(version_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.put("/definition/agent-workflow-versions/{version_id}/draft", response_model=StrategyDefinitionResponse)
def definition_save_agent_workflow_draft(version_id: int, request: AgentWorkflowDraftSaveRequest) -> dict:
    try: return AgentCenterService().save_workflow_draft(version_id, request.model_dump())
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.post("/definition/agent-workflow-versions/{version_id}/validate", response_model=StrategyDefinitionResponse)
def definition_validate_agent_workflow(version_id: int) -> dict:
    try: return AgentCenterService().validate_workflow(version_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.post("/definition/agent-workflow-versions/{version_id}/publish", response_model=StrategyDefinitionResponse)
def definition_publish_agent_workflow(version_id: int, request: AgentWorkflowPublishRequest) -> dict:
    try: return AgentCenterService().publish_workflow(version_id, request.model_dump())
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.get("/definition/data-sources", response_model=list[StrategyDefinitionResponse])
def definition_list_data_sources() -> list[dict]:
    return StrategyDefinitionService().list_data_sources()


@router.post("/definition/strategy-packages/intake", response_model=StrategyDefinitionResponse)
async def definition_intake_strategy_package(file: UploadFile = File(...)) -> dict:
    try:
        content = await file.read(StrategyPackageService.MAX_ARCHIVE_BYTES + 1)
        return StrategyPackageService().intake(file.filename or "strategy-package.zip", content)
    except StrategyDefinitionError as exc:
        raise _definition_error(exc)
    finally:
        await file.close()


@router.post("/definition/data-sources", response_model=StrategyDefinitionResponse)
def definition_create_data_source(request: StrategyDataSourceCreateRequest) -> dict:
    try: return StrategyDefinitionService().create_data_source(request.model_dump())
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.delete("/definition/data-sources/{source_id}", response_model=StrategyDefinitionResponse)
def definition_archive_data_source(source_id: int) -> dict:
    try: return StrategyDefinitionService().archive_data_source(source_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.get("/definition/strategies/{strategy_id}", response_model=StrategyDefinitionResponse)
def definition_get_strategy(strategy_id: int) -> dict:
    try: return StrategyDefinitionService().get_strategy(strategy_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.post("/definition/strategies/{strategy_id}/archive", response_model=StrategyDefinitionResponse)
def definition_archive(strategy_id: int) -> dict:
    try: return StrategyDefinitionService().archive_strategy(strategy_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.get("/definition/strategies/{strategy_id}/deletion-impact", response_model=StrategyDefinitionResponse)
def definition_strategy_deletion_impact(strategy_id: int) -> dict:
    try: return StrategyDefinitionService().get_deletion_impact(strategy_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.delete("/definition/strategies/{strategy_id}", response_model=StrategyDefinitionResponse)
def definition_delete_strategy(strategy_id: int, confirmed: bool = False) -> dict:
    try: return StrategyDefinitionService().delete_strategy(strategy_id, confirmed=confirmed)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.get("/definition/strategies/{strategy_id}/versions", response_model=list[StrategyDefinitionResponse])
def definition_list_versions(strategy_id: int) -> list[dict]:
    try: return StrategyDefinitionService().list_versions(strategy_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.post("/definition/strategies/{strategy_id}/drafts", response_model=StrategyDefinitionResponse)
def definition_create_draft(strategy_id: int, request: StrategyCreateDraftRequest) -> dict:
    try: return StrategyDefinitionService().create_draft(strategy_id, request.basedOnVersionId)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.get("/definition/strategies/{strategy_id}/audit-events", response_model=list[StrategyDefinitionResponse])
def definition_audit(strategy_id: int) -> list[dict]:
    try: return StrategyDefinitionService().list_audit(strategy_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.get("/definition/strategy-versions/{version_id}", response_model=StrategyDefinitionResponse)
def definition_get_version(version_id: int) -> dict:
    try: return StrategyDefinitionService().get_version(version_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.post("/definition/strategy-versions/{version_id}/execute-kernel", response_model=StrategyDefinitionResponse)
def definition_execute_kernel(version_id: int, request: StrategyKernelExecuteRequest) -> dict:
    """Directly invoke a validated Python kernel with explicit JSON inputs."""
    try:
        return StrategyKernelExecutorService().execute(version_id, request.model_dump())
    except StrategyDefinitionError as exc:
        raise _definition_error(exc)


@router.put("/definition/strategy-versions/{version_id}/draft", response_model=StrategyDefinitionResponse)
def definition_save_draft(version_id: int, request: StrategyDraftSaveRequest) -> dict:
    try: return StrategyDefinitionService().save_draft(version_id, request.model_dump())
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.post("/definition/strategy-versions/{version_id}/validate", response_model=StrategyDefinitionResponse)
def definition_validate(version_id: int) -> dict:
    try: return StrategyDefinitionService().validate(version_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.post("/definition/strategy-versions/{version_id}/publish", response_model=StrategyDefinitionResponse)
def definition_publish(version_id: int, request: StrategyPublishRequest) -> dict:
    try: return StrategyDefinitionService().publish(version_id, request.model_dump())
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.get("/definition/strategy-versions/{version_id}/diff", response_model=StrategyDefinitionResponse)
def definition_diff(version_id: int, against: int = Query(..., ge=1)) -> dict:
    try: return StrategyDefinitionService().diff(version_id, against)
    except StrategyDefinitionError as exc: raise _definition_error(exc)

@router.post("/definition/strategy-versions/{version_id}/diff-preview", response_model=StrategyDefinitionResponse)
def definition_diff_preview(version_id: int, payload: dict) -> dict:
    try: return StrategyDefinitionService().diff_preview(version_id, payload)
    except StrategyDefinitionError as exc: raise _definition_error(exc)

@router.post("/definition/strategy-versions/{version_id}/fork-local", response_model=StrategyDefinitionResponse)
def definition_fork_local(version_id: int, payload: StrategyForkLocalRequest) -> dict:
    try: return StrategyDefinitionService().fork_local(version_id, payload.model_dump())
    except StrategyDefinitionError as exc: raise _definition_error(exc)


# StrategyVersion historical validation is deliberately separate from the
# legacy /backtest API, which evaluates stored single-stock analysis records.
@router.post("/definition/validation-experiments", response_model=StrategyValidationExperimentItem)
def definition_create_validation_experiment(request: StrategyValidationExperimentCreateRequest) -> dict:
    try:
        return StrategyValidationService().create_experiment(request.model_dump(mode="json"))
    except StrategyValidationError as exc:
        raise _strategy_validation_error(exc)


@router.get("/definition/validation-experiments", response_model=StrategyValidationExperimentListResponse)
def definition_list_validation_experiments(
    strategy_version_id: int = Query(..., alias="strategyVersionId", ge=1),
    limit: int = Query(30, ge=1, le=100),
) -> dict:
    try:
        return {"items": StrategyValidationService().list_experiments(strategy_version_id, limit)}
    except StrategyValidationError as exc:
        raise _strategy_validation_error(exc)


@router.get("/definition/validation-comparison-candidates", response_model=StrategyValidationExperimentListResponse)
def definition_list_validation_comparison_candidates(
    strategy_id: int = Query(..., alias="strategyId", ge=1),
    limit: int = Query(100, ge=1, le=100),
) -> dict:
    try:
        return {"items": StrategyValidationService().list_comparison_candidates(strategy_id, limit)}
    except StrategyValidationError as exc:
        raise _strategy_validation_error(exc)


@router.post("/definition/validation-comparisons", response_model=StrategyValidationComparisonResponse)
def definition_compare_validation_experiments(request: StrategyValidationComparisonRequest) -> dict:
    try:
        return StrategyValidationService().compare_experiments(request.model_dump())
    except StrategyValidationError as exc:
        raise _strategy_validation_error(exc)


@router.get("/definition/validation-experiments/{experiment_id}", response_model=StrategyValidationExperimentItem)
def definition_get_validation_experiment(experiment_id: int) -> dict:
    try:
        return StrategyValidationService().get_experiment(experiment_id)
    except StrategyValidationError as exc:
        raise _strategy_validation_error(exc)


@router.post("/definition/validation-experiments/{experiment_id}/execute", response_model=StrategyValidationExperimentItem)
def definition_execute_validation_experiment(experiment_id: int) -> dict:
    try:
        return StrategyValidationService().execute_experiment(experiment_id)
    except StrategyValidationError as exc:
        raise _strategy_validation_error(exc)


@router.get("/definition/strategy-versions/{version_id}/validation-status", response_model=StrategyValidationVersionStatusItem)
def definition_get_validation_status(version_id: int) -> dict:
    try:
        return StrategyValidationService().version_status(version_id)
    except StrategyValidationError as exc:
        raise _strategy_validation_error(exc)


# User-facing runtime boundary. These routes intentionally accept only immutable
# PUBLISHED versions; the legacy preview-run endpoints below remain compatible
# for older simulation callers.
@router.get("/definition/runnable-versions", response_model=list[PublishedStrategyRunCandidate])
def definition_list_runnable_versions() -> list[dict]:
    return StrategyDefinitionService().list_runnable_versions()


@router.post("/definition/runs", response_model=PublishedStrategyRunItem)
def definition_create_published_run(request: PublishedStrategyRunCreateRequest) -> dict:
    try: return StrategyDefinitionService().create_published_run(request.model_dump())
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.get("/definition/runs", response_model=PublishedStrategyRunListResponse)
def definition_list_published_runs(limit: int = Query(50, ge=1, le=100)) -> dict:
    return {"items": StrategyDefinitionService().list_published_runs(limit)}


@router.get("/definition/runs/{run_id}", response_model=PublishedStrategyRunItem)
def definition_get_published_run(run_id: int) -> dict:
    try: return StrategyDefinitionService().get_published_run(run_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.post("/definition/runs/{run_id}/execute", response_model=PublishedStrategyRunItem)
def definition_execute_published_run(run_id: int) -> dict:
    try: return StrategyDefinitionService().execute_published_run(run_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.post("/definition/automatic-runs", response_model=AutomaticStrategyRunBatchItem)
def definition_create_automatic_run(request: AutomaticStrategyRunCreateRequest) -> dict:
    try: return StrategyDefinitionService().create_automatic_run_batch(request.model_dump())
    except StrategyDefinitionError as exc: raise _definition_error(exc)


@router.get("/definition/automatic-runs", response_model=AutomaticStrategyRunBatchListResponse)
def definition_list_automatic_runs(limit: int = Query(30, ge=1, le=100)) -> dict:
    return {"items": StrategyDefinitionService().list_automatic_run_batches(limit)}


@router.get("/definition/automatic-runs/{batch_id}", response_model=AutomaticStrategyRunBatchItem)
def definition_get_automatic_run(batch_id: int) -> dict:
    try: return StrategyDefinitionService().get_automatic_run_batch(batch_id)
    except StrategyDefinitionError as exc: raise _definition_error(exc)


def _continuous_run_error(exc: StrategyContinuousRunError) -> HTTPException:
    return HTTPException(status_code=409, detail={"code": "CONTINUOUS_RUN_INVALID", "message": str(exc)})


@router.post("/definition/continuous-runs", response_model=ContinuousStrategyRunControlItem)
def definition_start_continuous_run(request: ContinuousStrategyRunStartRequest) -> dict:
    try:
        return StrategyContinuousRunService().start(request.strategyVersionId, request.intervalSeconds)
    except StrategyContinuousRunError as exc:
        raise _continuous_run_error(exc)


@router.get("/definition/continuous-runs", response_model=ContinuousStrategyRunControlListResponse)
def definition_list_continuous_runs(limit: int = Query(50, ge=1, le=100)) -> dict:
    return {"items": StrategyContinuousRunService().list_controls(limit)}


@router.post("/definition/continuous-runs/{control_id}/pause", response_model=ContinuousStrategyRunControlItem)
def definition_pause_continuous_run(control_id: int) -> dict:
    try:
        return StrategyContinuousRunService().pause(control_id)
    except StrategyContinuousRunError as exc:
        raise _continuous_run_error(exc)


@router.post("/definition/continuous-runs/{control_id}/terminate", response_model=ContinuousStrategyRunControlItem)
def definition_terminate_continuous_run(control_id: int) -> dict:
    try:
        return StrategyContinuousRunService().terminate(control_id)
    except StrategyContinuousRunError as exc:
        raise _continuous_run_error(exc)


@router.post("/strategies", response_model=SimulationStrategyItem, responses={**AUTH_RESPONSE, 400: {"model": ErrorResponse}})
def create_strategy(request: SimulationStrategyCreateRequest) -> SimulationStrategyItem:
    try:
        return SimulationStrategyItem(**SimulationStrategyService().create_strategy(request.model_dump()))
    except ValueError as exc:
        raise _bad_request(exc)


@router.get("/templates", response_model=SimulationTemplateListResponse, responses=AUTH_RESPONSE)
def list_templates() -> SimulationTemplateListResponse:
    return SimulationTemplateListResponse(items=SimulationStrategyService().list_templates())


@router.post("/accounts", response_model=SimulationAccountItem, responses={**AUTH_RESPONSE, 400: {"model": ErrorResponse}})
def create_paper_account(request: SimulationAccountCreateRequest) -> SimulationAccountItem:
    try:
        return SimulationAccountItem(**SimulationPaperExecutionService().create_account(**request.model_dump()))
    except SimulationPaperExecutionError as exc:
        raise _bad_request(exc)

@router.get("/accounts", response_model=SimulationAccountListResponse, responses=AUTH_RESPONSE)
def list_paper_accounts() -> SimulationAccountListResponse:
    return SimulationAccountListResponse(items=SimulationPaperExecutionService().list_accounts())

@router.get("/accounts/{account_id}/orders", response_model=SimulationPaperOrderListResponse, responses=AUTH_RESPONSE)
def list_paper_orders(account_id: int) -> SimulationPaperOrderListResponse:
    return SimulationPaperOrderListResponse(items=SimulationPaperExecutionService().list_orders(account_id))

@router.post("/paper-executions", response_model=SimulationPaperExecutionResponse, responses={**AUTH_RESPONSE, 400: {"model": ErrorResponse}})
def prepare_paper_execution(request: SimulationPaperExecutionRequest) -> SimulationPaperExecutionResponse:
    try:
        return SimulationPaperExecutionResponse(**SimulationPaperExecutionService().prepare_execution(request.account_id, request.run_id))
    except SimulationPaperExecutionError as exc:
        raise _bad_request(exc)


@router.get("/strategies", response_model=SimulationStrategyListResponse, responses=AUTH_RESPONSE)
def list_strategies() -> SimulationStrategyListResponse:
    return SimulationStrategyListResponse(items=SimulationStrategyService().list_strategies())


@router.get("/strategies/{strategy_id}", response_model=SimulationStrategyItem, responses={**AUTH_RESPONSE, 404: {"model": ErrorResponse}})
def get_strategy(strategy_id: int) -> SimulationStrategyItem:
    try:
        return SimulationStrategyItem(**SimulationStrategyService().get_strategy(strategy_id))
    except SimulationStrategyNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": str(exc)})


@router.patch("/strategies/{strategy_id}", response_model=SimulationStrategyItem, responses={**AUTH_RESPONSE, 400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}})
def update_strategy(strategy_id: int, request: SimulationStrategyUpdateRequest) -> SimulationStrategyItem:
    try:
        return SimulationStrategyItem(**SimulationStrategyService().update_strategy(strategy_id, request.model_dump(exclude_unset=True)))
    except SimulationStrategyNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": str(exc)})
    except ValueError as exc:
        raise _bad_request(exc)


@router.get("/strategies/{strategy_id}/versions", response_model=list[SimulationStrategyVersionItem], responses={**AUTH_RESPONSE, 404: {"model": ErrorResponse}})
def list_strategy_versions(strategy_id: int) -> list[SimulationStrategyVersionItem]:
    try:
        return [SimulationStrategyVersionItem(**row) for row in SimulationStrategyService().list_versions(strategy_id)]
    except SimulationStrategyNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": str(exc)})


@router.get("/strategies/{strategy_id}/versions/{version_id}", response_model=SimulationStrategyVersionItem, responses={**AUTH_RESPONSE, 404: {"model": ErrorResponse}})
def get_strategy_version(strategy_id: int, version_id: int) -> SimulationStrategyVersionItem:
    try:
        return SimulationStrategyVersionItem(**SimulationStrategyService().get_version(strategy_id, version_id))
    except SimulationStrategyNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": str(exc)})


@router.post("/strategies/{strategy_id}/versions", response_model=SimulationStrategyVersionItem, responses={**AUTH_RESPONSE, 400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}})
def create_strategy_version(strategy_id: int, request: SimulationStrategyVersionCreateRequest) -> SimulationStrategyVersionItem:
    try:
        return SimulationStrategyVersionItem(**SimulationStrategyService().create_version(strategy_id, request.model_dump()))
    except SimulationStrategyNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": str(exc)})
    except ValueError as exc:
        raise _bad_request(exc)


@router.post("/runs", response_model=SimulationRunItem, responses={**AUTH_RESPONSE, 400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}})
def create_run(request: SimulationRunCreateRequest) -> SimulationRunItem:
    try:
        return SimulationRunItem(**SimulationStrategyService().create_run(request.model_dump()))
    except SimulationStrategyNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": str(exc)})
    except ValueError as exc:
        raise _bad_request(exc)


@router.get("/runs", response_model=SimulationRunListResponse, responses=AUTH_RESPONSE)
def list_runs(strategy_version_id: Optional[int] = Query(None, ge=1), limit: int = Query(20, ge=1, le=100)) -> SimulationRunListResponse:
    return SimulationRunListResponse(items=SimulationStrategyService().list_runs(strategy_version_id, limit))


@router.get("/runs/{run_id}", response_model=SimulationRunDetailResponse, responses={**AUTH_RESPONSE, 404: {"model": ErrorResponse}})
def get_run(run_id: int) -> SimulationRunDetailResponse:
    try:
        return SimulationRunDetailResponse(item=SimulationRunItem(**SimulationStrategyService().get_run(run_id)))
    except SimulationStrategyNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": str(exc)})


@router.post("/runs/{run_id}/execute", response_model=SimulationRunExecuteResponse, responses={**AUTH_RESPONSE, 400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}})
def execute_run(run_id: int) -> SimulationRunExecuteResponse:
    try:
        return SimulationRunExecuteResponse(item=SimulationRunItem(**SimulationStrategyService().execute_run(run_id)))
    except SimulationStrategyNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": str(exc)})
    except ValueError as exc:
        raise _bad_request(exc)
