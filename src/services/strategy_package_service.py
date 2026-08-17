"""Safe intake boundary for externally generated strategy packages.

This service performs static validation and stores an immutable archive.  It
never imports user code in the API process; execution is delegated to the
restricted strategy-kernel worker.  A separate StrategyVersion holds market,
data and run configuration for the reusable kernel.
"""

from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

from src.services.strategy_definition_service import StrategyDefinitionError, StrategyDefinitionService
from src.storage import SimulationStrategyVersionRecord


PURPOSE_CONTRACTS = {
    "research_report": "ResearchReport",
    "candidate_screening": "CandidateList",
    "trading_decision": "DecisionProposal",
}
ALLOWED_MARKETS = {"cn", "hk", "us"}
ALLOWED_KINDS = {"kline", "news", "fundamentals", "other"}
ALLOWED_IMPORTS = {
    "collections",
    "datetime",
    "decimal",
    "functools",
    "itertools",
    "json",
    "math",
    "re",
    "statistics",
    "typing",
}
DANGEROUS_NAMES = {
    "__import__",
    "breakpoint",
    "compile",
    "eval",
    "exec",
    "globals",
    "getattr",
    "input",
    "locals",
    "open",
    "object",
    "setattr",
    "delattr",
    "dir",
    "type",
    "vars",
}
REQUIRED_FILES = {
    "strategy.yaml",
    "strategy.py",
    "STRATEGY.md",
    "README.md",
    "schemas/input.json",
    "schemas/output.json",
    "requirements.lock",
}


class StrategyPackageService:
    MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
    MAX_EXPANDED_BYTES = 50 * 1024 * 1024
    MAX_FILES = 120

    def __init__(self, definition_service: StrategyDefinitionService | None = None):
        self.definition = definition_service or StrategyDefinitionService()

    def intake(self, filename: str, content: bytes) -> dict[str, Any]:
        if not filename.lower().endswith(".zip"):
            raise StrategyDefinitionError("STRATEGY_PACKAGE_TYPE_INVALID", "策略包必须是 .zip 文件。")
        if not content or len(content) > self.MAX_ARCHIVE_BYTES:
            raise StrategyDefinitionError("STRATEGY_PACKAGE_SIZE_INVALID", "策略包不能为空且不能超过 10 MB。")

        files = self._read_archive(content)
        missing = sorted(REQUIRED_FILES - set(files))
        if missing:
            raise StrategyDefinitionError(
                "STRATEGY_PACKAGE_FILES_MISSING",
                f"策略包缺少必需文件：{', '.join(missing)}。",
            )
        manifest = self._manifest(files["strategy.yaml"])
        input_schema = self._json_schema(files["schemas/input.json"], "输入")
        output_schema = self._json_schema(files["schemas/output.json"], "输出")
        self._validate_schema_safety(input_schema, "输入")
        self._validate_schema_safety(output_schema, "输出")
        self._validate_python_source(files["strategy.py"])
        self._validate_requirements_lock(files["requirements.lock"])
        documentation = self._decode(files["STRATEGY.md"], "STRATEGY.md")
        package = self._validate_manifest(manifest, documentation)
        self._validate_output_schema(output_schema)
        data_config, dependency_warnings = self._resolve_dependencies(package)
        digest = hashlib.sha256(content).hexdigest()
        self._store_archive(digest, content)

        created = self.definition.create_strategy({
            "name": package["name"],
            "description": package["summary"],
        })
        draft_id = created["draft"]["id"]
        with self.definition.db.session_scope() as session:
            draft = session.get(SimulationStrategyVersionRecord, draft_id)
            if not draft:
                raise StrategyDefinitionError("STRATEGY_VERSION_NOT_FOUND", "策略草稿不存在。", 404)
            kernel = {
                "kind": "uploaded_package",
                "fileName": filename,
                "sha256": digest,
                "declaredVersion": package["declaredVersion"],
                "runtime": package["runtime"],
                "entrypoint": package["entrypoint"],
                "executionStatus": "ready",
                "outputContract": package["outputContract"],
                "configurable": package["configurable"],
                "parameters": package["parameters"],
                "dataRequirements": package["dataRequirements"],
                "inputSchema": input_schema,
                "outputSchema": output_schema,
                "documentation": documentation,
                "dependencyWarnings": dependency_warnings,
            }
            defaults = {
                item["name"]: item.get("default")
                for item in package["parameters"]
                if item.get("name") and "default" in item
            }
            markets = package["configurable"]["markets"]
            timeframes = package["configurable"]["timeframes"]
            intervals = package["configurable"]["runIntervals"]
            market = markets[0]
            draft.config_json = json.dumps({"productRole": "kernel", "strategyPackage": kernel}, ensure_ascii=False, sort_keys=True)
            draft.strategy_purpose = package["purpose"]
            draft.objective = package["summary"]
            draft.market_scope_json = json.dumps(self._default_scope(package["purpose"]), ensure_ascii=False)
            draft.time_horizon = timeframes[0] if timeframes else None
            draft.data_permission_snapshot_json = json.dumps(data_config, ensure_ascii=False, sort_keys=True)
            draft.screening_policy_json = json.dumps({"strategy": "package_defined", "market": market, "maxCandidates": 3}, ensure_ascii=False)
            draft.decision_policy_json = json.dumps({"packageParameters": defaults, "runInterval": intervals[0] if intervals else None}, ensure_ascii=False, sort_keys=True)
            draft.risk_policy_json = json.dumps({}, ensure_ascii=False)
            draft.agent_workflow_version_id = None
            session.flush()
        detail = self.definition.get_version(draft_id)
        return {
            "strategy": created["strategy"],
            "draft": detail,
            "kernel": {
                "strategyId": created["strategy"]["id"],
                "versionId": detail["id"],
                "name": created["strategy"]["name"],
                "purpose": detail["strategyPurpose"],
                "outputContract": detail["outputContract"],
            },
            "package": detail.get("strategyPackage"),
            "warnings": dependency_warnings,
        }

    def _read_archive(self, content: bytes) -> dict[str, bytes]:
        try:
            archive = zipfile.ZipFile(BytesIO(content))
        except zipfile.BadZipFile as exc:
            raise StrategyDefinitionError("STRATEGY_PACKAGE_ZIP_INVALID", "策略包不是有效的 ZIP 文件。") from exc
        infos = [item for item in archive.infolist() if not item.is_dir()]
        if len(infos) > self.MAX_FILES or sum(item.file_size for item in infos) > self.MAX_EXPANDED_BYTES:
            raise StrategyDefinitionError("STRATEGY_PACKAGE_EXPANSION_INVALID", "策略包展开后文件过多或超过 50 MB。")
        for item in infos:
            path = PurePosixPath(item.filename)
            if path.is_absolute() or ".." in path.parts or (item.external_attr >> 16) & 0o170000 == 0o120000:
                raise StrategyDefinitionError("STRATEGY_PACKAGE_PATH_INVALID", "策略包包含不安全路径或符号链接。")
        names = [PurePosixPath(item.filename) for item in infos]
        prefix = names[0].parts[0] if names and len(names[0].parts) > 1 and all(path.parts[0] == names[0].parts[0] for path in names) else None
        result: dict[str, bytes] = {}
        for item, path in zip(infos, names):
            normalized = PurePosixPath(*path.parts[1:]).as_posix() if prefix else path.as_posix()
            if normalized in result:
                raise StrategyDefinitionError("STRATEGY_PACKAGE_FILE_DUPLICATE", f"策略包包含重复文件：{normalized}。")
            result[normalized] = archive.read(item)
        return result

    def _manifest(self, content: bytes) -> dict[str, Any]:
        try:
            value = yaml.safe_load(self._decode(content, "strategy.yaml"))
        except yaml.YAMLError as exc:
            raise StrategyDefinitionError("STRATEGY_PACKAGE_MANIFEST_INVALID", "strategy.yaml 无法解析。") from exc
        if not isinstance(value, dict):
            raise StrategyDefinitionError("STRATEGY_PACKAGE_MANIFEST_INVALID", "strategy.yaml 根节点必须是对象。")
        return value

    def _validate_manifest(self, manifest: dict[str, Any], documentation: str) -> dict[str, Any]:
        package_id = self._required_text(manifest.get("strategyId"), "strategyId", 80)
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", package_id):
            raise StrategyDefinitionError("STRATEGY_PACKAGE_ID_INVALID", "strategyId 只能使用小写字母、数字和单个连字符分隔。")
        name = self._required_text(manifest.get("name"), "name", 120)
        purpose = self._required_text(manifest.get("purpose"), "purpose", 32)
        if purpose not in PURPOSE_CONTRACTS:
            raise StrategyDefinitionError("STRATEGY_PACKAGE_PURPOSE_INVALID", "purpose 必须是 research_report、candidate_screening 或 trading_decision。")
        outputs = manifest.get("outputs") if isinstance(manifest.get("outputs"), dict) else {}
        inputs = manifest.get("inputs") if isinstance(manifest.get("inputs"), dict) else {}
        documentation_config = manifest.get("documentation") if isinstance(manifest.get("documentation"), dict) else {}
        if inputs.get("schema") != "schemas/input.json":
            raise StrategyDefinitionError("STRATEGY_PACKAGE_INPUT_INVALID", "inputs.schema 必须指向 schemas/input.json。")
        if outputs.get("schema") != "schemas/output.json":
            raise StrategyDefinitionError("STRATEGY_PACKAGE_OUTPUT_INVALID", "outputs.schema 必须指向 schemas/output.json。")
        if documentation_config.get("file") != "STRATEGY.md":
            raise StrategyDefinitionError("STRATEGY_PACKAGE_DOCUMENTATION_INVALID", "documentation.file 必须指向 STRATEGY.md。")
        contract = outputs.get("contract")
        if contract != PURPOSE_CONTRACTS[purpose]:
            raise StrategyDefinitionError("STRATEGY_PACKAGE_OUTPUT_INVALID", f"{purpose} 必须输出 {PURPOSE_CONTRACTS[purpose]}。")
        runtime = self._required_text(manifest.get("runtime"), "runtime", 32)
        entrypoint = self._required_text(manifest.get("entrypoint"), "entrypoint", 160)
        if runtime != "python" or entrypoint != "strategy:run":
            raise StrategyDefinitionError("STRATEGY_PACKAGE_RUNTIME_INVALID", "当前包协议只接受 runtime: python 和 entrypoint: strategy:run。")
        declared_markets = self._string_list(manifest.get("markets"), "markets", lowercase=True)
        if not declared_markets or any(item not in ALLOWED_MARKETS for item in declared_markets):
            raise StrategyDefinitionError("STRATEGY_PACKAGE_MARKETS_INVALID", "markets 只能声明 cn、hk、us，且至少包含一个市场。")
        configurable = manifest.get("configurable") if isinstance(manifest.get("configurable"), dict) else {}
        markets = self._string_list(configurable.get("markets") or declared_markets, "configurable.markets", lowercase=True)
        if any(item not in declared_markets for item in markets):
            raise StrategyDefinitionError("STRATEGY_PACKAGE_MARKETS_INVALID", "configurable.markets 不能超出策略声明的 markets。")
        timeframes = self._string_list(configurable.get("timeframes") or ["1d"], "configurable.timeframes")
        intervals = self._string_list(configurable.get("runIntervals") or timeframes, "configurable.runIntervals")
        requirements = manifest.get("dataRequirements") or []
        parameters = manifest.get("parameters") or []
        if not isinstance(requirements, list) or not requirements or not all(isinstance(item, dict) for item in requirements):
            raise StrategyDefinitionError("STRATEGY_PACKAGE_DEPENDENCIES_INVALID", "dataRequirements 必须是非空对象数组，并只声明策略真实依赖的数据。")
        if not isinstance(parameters, list) or not all(isinstance(item, dict) for item in parameters):
            raise StrategyDefinitionError("STRATEGY_PACKAGE_PARAMETERS_INVALID", "parameters 必须是对象数组。")
        normalized_requirements: list[dict[str, Any]] = []
        seen_requirement_ids: set[str] = set()
        for item in requirements:
            identifier = self._required_text(item.get("id"), "dataRequirements.id", 80)
            if identifier in seen_requirement_ids:
                raise StrategyDefinitionError("STRATEGY_PACKAGE_DEPENDENCIES_INVALID", f"数据依赖 id 重复：{identifier}。")
            seen_requirement_ids.add(identifier)
            data_type = self._required_text(item.get("type"), "dataRequirements.type", 120)
            kind = self._required_text(item.get("kind"), "dataRequirements.kind", 32).lower()
            if kind not in ALLOWED_KINDS:
                raise StrategyDefinitionError("STRATEGY_PACKAGE_DEPENDENCIES_INVALID", f"未知数据类型：{kind}。")
            source_ids = self._string_list(item.get("sourceIds"), "dataRequirements.sourceIds")
            markets_for_requirement = self._string_list(item.get("markets"), "dataRequirements.markets", lowercase=True)
            if any(market not in declared_markets for market in markets_for_requirement):
                raise StrategyDefinitionError("STRATEGY_PACKAGE_DEPENDENCIES_INVALID", f"数据依赖 {identifier} 声明了策略不支持的市场。")
            if not isinstance(item.get("required"), bool):
                raise StrategyDefinitionError("STRATEGY_PACKAGE_DEPENDENCIES_INVALID", f"数据依赖 {identifier} 必须明确 required: true/false。")
            usage = self._required_text(item.get("usage"), "dataRequirements.usage", 500)
            frequency = self._required_text(item.get("frequency"), "dataRequirements.frequency", 80)
            lookback = item.get("lookback")
            if not isinstance(lookback, (int, str)) or isinstance(lookback, bool) or not str(lookback).strip():
                raise StrategyDefinitionError("STRATEGY_PACKAGE_DEPENDENCIES_INVALID", f"数据依赖 {identifier} 必须明确 lookback。")
            on_missing = self._required_text(item.get("onMissing"), "dataRequirements.onMissing", 20).lower()
            expected_missing = "fail" if item["required"] else "degrade"
            if on_missing != expected_missing:
                raise StrategyDefinitionError("STRATEGY_PACKAGE_DEPENDENCIES_INVALID", f"数据依赖 {identifier} 的 onMissing 必须为 {expected_missing}。")
            if identifier not in documentation or any(source_id not in documentation for source_id in source_ids):
                raise StrategyDefinitionError("STRATEGY_PACKAGE_DOCUMENTATION_DEPENDENCIES_MISMATCH", f"STRATEGY.md 必须列出数据依赖 {identifier} 及其全部 sourceId。")
            normalized_requirements.append({
                "id": identifier,
                "type": data_type,
                "kind": kind,
                "sourceIds": source_ids,
                "markets": markets_for_requirement,
                "frequency": frequency,
                "lookback": lookback,
                "required": item["required"],
                "usage": usage,
                "onMissing": on_missing,
            })
        for item in parameters:
            self._required_text(item.get("name"), "parameters.name", 80)
            if item.get("type") not in {"string", "integer", "number", "boolean"}:
                raise StrategyDefinitionError("STRATEGY_PACKAGE_PARAMETERS_INVALID", "参数 type 必须是 string、integer、number 或 boolean。")
        summary = self._summary(documentation)
        return {
            "name": name,
            "summary": summary,
            "purpose": purpose,
            "outputContract": contract,
            "declaredVersion": self._required_text(manifest.get("version"), "version", 40),
            "runtime": runtime,
            "entrypoint": entrypoint,
            "configurable": {"markets": markets, "timeframes": timeframes, "runIntervals": intervals},
            "parameters": parameters,
            "dataRequirements": normalized_requirements,
        }

    def _resolve_dependencies(self, package: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
        catalog = {item["sourceId"]: item for item in self.definition.list_data_sources()}
        config: dict[str, Any] = {"schemaVersion": 3, "other": {"enabled": False, "sourceIds": []}}
        warnings: list[str] = []
        market = package["configurable"]["markets"][0]
        for requirement in package["dataRequirements"]:
            kind = str(requirement.get("kind") or "").strip()
            if kind not in ALLOWED_KINDS:
                raise StrategyDefinitionError("STRATEGY_PACKAGE_DEPENDENCIES_INVALID", f"未知数据类型：{kind or '空'}。")
            source_ids = self._string_list(requirement.get("sourceIds"), "dataRequirements.sourceIds")
            matches = [catalog[source_id] for source_id in source_ids if source_id in catalog and catalog[source_id].get("selectable")]
            compatible = [item for item in matches if not item.get("markets") or market in item["markets"]]
            if not compatible:
                message = f"{requirement.get('id') or kind} 没有支持 {market.upper()} 的已配置数据源。"
                if requirement.get("required", True):
                    raise StrategyDefinitionError("STRATEGY_PACKAGE_REQUIRED_DATA_UNAVAILABLE", message)
                warnings.append(message)
                continue
            if kind == "other":
                config["other"] = {"enabled": True, "sourceIds": [item["sourceId"] for item in compatible]}
            elif kind not in config:
                config[kind] = {"enabled": True, "connection": compatible[0]["connectionKey"]}
                if kind == "kline":
                    config[kind]["timeframe"] = package["configurable"]["timeframes"][0]
        return config, warnings

    def _store_archive(self, digest: str, content: bytes) -> Path:
        default_dir = Path(__file__).resolve().parents[2] / "data" / "strategy_packages"
        target_dir = Path(os.getenv("STRATEGY_PACKAGE_DIR", str(default_dir))).resolve()
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{digest}.zip"
        if target.exists():
            return target
        with tempfile.NamedTemporaryFile(dir=target_dir, prefix=".upload-", delete=False) as handle:
            handle.write(content)
            temporary = Path(handle.name)
        temporary.replace(target)
        return target

    @staticmethod
    def _default_scope(purpose: str) -> dict[str, Any]:
        if purpose == "research_report":
            return {"universeMode": "runtime_symbol", "symbols": []}
        return {"universeMode": "screening", "symbols": []}

    @staticmethod
    def _decode(content: bytes, label: str) -> str:
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise StrategyDefinitionError("STRATEGY_PACKAGE_ENCODING_INVALID", f"{label} 必须使用 UTF-8 编码。") from exc

    @staticmethod
    def _json_schema(content: bytes, label: str) -> dict[str, Any]:
        try:
            value = json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise StrategyDefinitionError("STRATEGY_PACKAGE_SCHEMA_INVALID", f"{label} Schema 不是有效 JSON。") from exc
        if not isinstance(value, dict) or value.get("type") != "object":
            raise StrategyDefinitionError("STRATEGY_PACKAGE_SCHEMA_INVALID", f"{label} Schema 根节点必须是 type: object。")
        return value

    @staticmethod
    def _validate_output_schema(schema: dict[str, Any]) -> None:
        required = set(schema.get("required") or []) if isinstance(schema.get("required"), list) else set()
        common = {"status", "contract", "dataCoverage", "warnings"}
        missing = sorted(common - required)
        if missing:
            raise StrategyDefinitionError(
                "STRATEGY_PACKAGE_SCHEMA_INVALID",
                f"输出 Schema 必须把 {', '.join(missing)} 声明为 required。",
            )

    @staticmethod
    def _validate_schema_safety(schema: dict[str, Any], label: str) -> None:
        """Keep validation deterministic and self-contained.

        Remote or file references would turn a user-provided schema into an
        undeclared I/O channel when jsonschema resolves it at runtime.
        """
        pending: list[Any] = [schema]
        while pending:
            value = pending.pop()
            if isinstance(value, dict):
                if "$ref" in value:
                    raise StrategyDefinitionError(
                        "STRATEGY_PACKAGE_SCHEMA_INVALID",
                        f"{label} Schema 当前不能使用 $ref；请把定义完整写入同一文件。",
                    )
                pending.extend(value.values())
            elif isinstance(value, list):
                pending.extend(value)

    def _validate_python_source(self, content: bytes) -> None:
        source = self._decode(content, "strategy.py")
        try:
            tree = ast.parse(source, filename="strategy.py")
        except SyntaxError as exc:
            raise StrategyDefinitionError("STRATEGY_PACKAGE_PYTHON_INVALID", f"strategy.py 语法错误：{exc.msg}。") from exc
        top_level_allowed = (ast.Expr, ast.Import, ast.ImportFrom, ast.FunctionDef, ast.Assign, ast.AnnAssign)
        for node in tree.body:
            if not isinstance(node, top_level_allowed):
                raise StrategyDefinitionError("STRATEGY_PACKAGE_PYTHON_UNSAFE", "strategy.py 顶层只能声明导入、常量和函数，不得在导入时执行策略。")
            if isinstance(node, ast.Expr) and not isinstance(node.value, ast.Constant):
                raise StrategyDefinitionError("STRATEGY_PACKAGE_PYTHON_UNSAFE", "strategy.py 顶层表达式只能是模块说明文本。")
            if isinstance(node, (ast.Assign, ast.AnnAssign)) and any(isinstance(child, ast.Call) for child in ast.walk(node)):
                raise StrategyDefinitionError("STRATEGY_PACKAGE_PYTHON_UNSAFE", "strategy.py 顶层常量不能调用函数。")
            if isinstance(node, ast.FunctionDef):
                if node.decorator_list:
                    raise StrategyDefinitionError("STRATEGY_PACKAGE_PYTHON_UNSAFE", "strategy.py 函数不能使用装饰器。")
                defaults = [*node.args.defaults, *[item for item in node.args.kw_defaults if item is not None]]
                if any(not isinstance(item, ast.Constant) for item in defaults):
                    raise StrategyDefinitionError("STRATEGY_PACKAGE_PYTHON_UNSAFE", "strategy.py 函数默认值只能是常量。")
        run_functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "run"]
        if len(run_functions) != 1:
            raise StrategyDefinitionError("STRATEGY_PACKAGE_ENTRYPOINT_INVALID", "strategy.py 必须且只能声明一个 run(context) 函数。")
        run_args = run_functions[0].args
        if len(run_args.posonlyargs) + len(run_args.args) != 1 or run_args.vararg or run_args.kwarg or run_args.kwonlyargs:
            raise StrategyDefinitionError("STRATEGY_PACKAGE_ENTRYPOINT_INVALID", "run 入口必须使用唯一参数 run(context)。")
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                modules = [alias.name.split(".")[0] for alias in node.names] if isinstance(node, ast.Import) else [str(node.module or "").split(".")[0]]
                if any(module not in ALLOWED_IMPORTS for module in modules):
                    raise StrategyDefinitionError("STRATEGY_PACKAGE_IMPORT_UNSUPPORTED", "上传策略只能使用指南允许的 Python 标准库；行情、新闻和模型能力必须由 context 注入。")
            if isinstance(node, ast.Name) and node.id in DANGEROUS_NAMES:
                raise StrategyDefinitionError("STRATEGY_PACKAGE_PYTHON_UNSAFE", f"strategy.py 不允许使用 {node.id}。")
            if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
                raise StrategyDefinitionError("STRATEGY_PACKAGE_PYTHON_UNSAFE", "strategy.py 不允许访问双下划线运行时属性。")

    def _validate_requirements_lock(self, content: bytes) -> None:
        lines = [line.strip() for line in self._decode(content, "requirements.lock").splitlines()]
        dependencies = [line for line in lines if line and not line.startswith("#")]
        if dependencies:
            raise StrategyDefinitionError(
                "STRATEGY_PACKAGE_DEPENDENCIES_UNSUPPORTED",
                "当前受限执行器只允许 Python 标准库；requirements.lock 必须为空或只包含注释。",
            )

    @staticmethod
    def _required_text(value: Any, field: str, maximum: int) -> str:
        text = str(value or "").strip()
        if not text or len(text) > maximum:
            raise StrategyDefinitionError("STRATEGY_PACKAGE_MANIFEST_INVALID", f"{field} 缺失或长度无效。")
        return text

    @staticmethod
    def _string_list(value: Any, field: str, lowercase: bool = False) -> list[str]:
        if not isinstance(value, list) or not value or not all(isinstance(item, str) and item.strip() for item in value):
            raise StrategyDefinitionError("STRATEGY_PACKAGE_MANIFEST_INVALID", f"{field} 必须是非空字符串数组。")
        return [item.strip().lower() if lowercase else item.strip() for item in value]

    @staticmethod
    def _summary(documentation: str) -> str:
        paragraphs = [line.strip() for line in documentation.splitlines() if line.strip() and not line.lstrip().startswith("#")]
        return (paragraphs[0] if paragraphs else "上传的策略包尚未提供摘要。")[:4000]
