"""Trusted adapter for the mature single-stock research pipeline."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def run(context: dict[str, Any]) -> dict[str, Any]:
    inputs = context.get("inputs") if isinstance(context.get("inputs"), dict) else {}
    symbol = str(inputs.get("symbol") or inputs.get("stockCode") or inputs.get("stock_code") or "").strip()
    if not symbol:
        return {
            "status": "failed",
            "contract": "ResearchReport",
            "reasonCode": "REQUIRED_INPUT_MISSING",
            "message": "单股研究需要 symbol。",
            "missingInputs": ["symbol"],
            "dataCoverage": context.get("dataCoverage") or {},
            "warnings": [],
        }
    from src.services.analysis_service import AnalysisService

    parameters = context.get("parameters") if isinstance(context.get("parameters"), dict) else {}
    service = AnalysisService()
    result = service.analyze_stock(
        stock_code=symbol,
        report_type=str(parameters.get("reportType") or "detailed"),
        force_refresh=bool(parameters.get("forceRefresh", False)),
        query_id=str(context.get("runId") or "") or None,
        send_notification=False,
        analysis_phase=str(parameters.get("analysisPhase") or "auto"),
        query_source="strategy_kernel",
    )
    if result is None:
        return {
            "status": "failed",
            "contract": "ResearchReport",
            "reasonCode": "RESEARCH_PIPELINE_FAILED",
            "message": service.last_error or "单股研究链路未返回报告。",
            "missingInputs": [],
            "dataCoverage": context.get("dataCoverage") or {},
            "warnings": [],
        }
    return {
        "status": "success",
        "contract": "ResearchReport",
        "strategyId": context.get("strategyId"),
        "strategyVersion": context.get("strategyVersion"),
        "asOf": context.get("asOf") or datetime.now(timezone.utc).isoformat(),
        "result": result,
        "dataCoverage": context.get("dataCoverage") or {},
        "warnings": context.get("warnings") or [],
        "evidenceRefs": [],
    }
