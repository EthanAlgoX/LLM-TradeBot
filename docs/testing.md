# 测试说明

后端 CI 依赖通过 `.github/requirements-ci.txt` 安装。完整套件使用：

```bash
.venv/bin/python -m pytest -qq --disable-warnings
```

Intelligence fail-open 回归可重复执行：

```bash
for iteration in {1..30}; do .venv/bin/python -m pytest -q tests/test_intelligence_service.py::IntelligenceServiceTestCase::test_fetch_enabled_sources_is_fail_open || exit 1; done
```

前端测试、静态检查和构建在 `apps/dsa-web` 运行：`npm test -- --run`、`npm run lint`、`npm run build`。策略定义 HTTP 冒烟使用：

```bash
.venv/bin/python scripts/smoke_strategy_definition.py http://127.0.0.1:8000
```

该脚本只创建带 `smoke-` 前缀的策略定义数据，不执行 Agent、行情访问或交易。
## 策略定义验收

完整验收命令、结果目录和通过条件见 [strategy-definition-acceptance.md](strategy-definition-acceptance.md)。该命令不会把失败重试为成功；完整 Python 套件以 JUnit XML 与实际退出码为权威。

策略定义验收的正式入口为 `.venv/bin/python scripts/verify_strategy_definition_acceptance.py --full`。需要定位单一门禁时可传 `--stage e2e-auth|e2e|frontend|python|docker`；产物位于 `.artifacts/strategy-definition-acceptance/`。

`docker` 阶段不是仅构建镜像：它会启动隔离 Compose 服务，等待 `/api/health`，然后在容器内运行策略定义 HTTP smoke。该闭环只覆盖定义和发布，不执行 Agent、Evidence、Risk 或交易 Runtime。

验收脚本会把缺失的本地前置工具（例如 `docker` CLI）记录为退出码 `127`、日志和 `summary.json` 中的失败项，而不是在没有产物的情况下抛出异常。Docker Desktop 可能将 CLI 安装在应用资源目录而不加入 shell `PATH`；此时可在当前命令临时加入该目录后执行 `--full`。Docker 阶段使用独立 Compose 模型、项目名和 named volumes，绝不复用开发服务、固定容器名或开发数据卷。
