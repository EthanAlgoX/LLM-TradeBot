# 策略定义验收

策略定义与版本发布的验收不覆盖 Run、Evidence、Risk 或模拟账本。它包含策略图的连接规则、字段映射、草稿并发控制、发布不可变性、版本差异和本地冲突分叉。

## 可重复门禁

在已经按 `.github/requirements-ci.txt` 建好 Python 测试环境后运行：

```bash
.venv/bin/python scripts/verify_strategy_definition_acceptance.py --full
```

脚本为 fail-open Intelligence 测试建立 30 个独立 pytest 进程，接着执行该测试文件、两次完整 pytest、Web 测试、lint、build 和 flake8 gate。认证 Smoke 在同一隔离服务中重复 10 次，并额外执行 3 次完整冷启动；三条策略浏览器场景则在独立 SQLite 上连续运行两次。每一步均写入 `.artifacts/strategy-definition-acceptance/<UTC timestamp>/`，并由 `summary.json` 依据进程退出码和 JUnit XML 判定；任何失败都会返回非零。

可按阶段诊断：`--stage e2e-auth`、`--stage e2e`、`--stage frontend`、`--stage python` 或 `--stage docker`。`--full` 会运行全部阶段；Docker 阶段会实际 build、Compose 启动、容器内健康检查和 HTTP lifecycle smoke。正式浏览器验收使用隔离 `DATABASE_PATH`、Chromium 和 `retries=0`，不能连接开发数据库或生产凭证。每次运行均生成 `summary.json` 与 `latest.json`，JUnit 与子进程退出码共同决定状态。

当前闭环只覆盖策略定义、草稿、版本发布、版本差异与本地冲突分叉；不覆盖 Run、Evidence、Risk 或模拟账本 Runtime。

## 当前本机完整验收证据

正式完整验收已于 `20260813T160814Z` 完成，摘要为 `status: passed`：fail-open 为 30/30，Intelligence 文件为 25/25，两次完整离线 pytest 均为 6262 个 JUnit tests、0 failure、0 error；前端专项为 7 个文件、65 个断言，完整前端为 1161 passed、2 个既有 skipped；认证 Smoke 为同服务 10/10 与冷启动 3/3；隔离 Chromium 的三条核心场景连续两轮均为 3 passed、`retries=0`；Docker 镜像构建、独立 Compose、容器健康检查与容器内策略定义 smoke 均为退出码 0。

本次核心 E2E 的一次失败揭示了测试编排竞态：连续点击模板库时，第四次点击可能发生在前一个 React 状态提交前，导致新增节点被旧闭包覆盖。`strategy-editor-flow.spec.ts` 现在在每次真实“添加模板”后等待生产画布节点数增长，再发起下一次用户点击；该修正后重新获得两轮零失败。它不改变策略编辑器业务规则，也没有引入重试或固定等待。

Docker Desktop 自带 CLI 位于应用资源目录但不在本机默认 `PATH`；验收时以临时 PATH 使用该 CLI，不修改全局环境。验收脚本的 Compose 模型已改为完全独立：不复用开发 Compose 的固定容器名、宿主 8000 端口或开发 volumes。`.github/workflows/strategy-definition-acceptance.yml` 已提供 `workflow_dispatch` 门禁并上传产物；本地仅完成 YAML 语法检查，尚未触发或宣称 GitHub Hosted Actions 已通过。

## 前端可访问定位

策略编辑器提供 `agent-node-*`、`agent-input-handle-*`、`agent-output-handle-*`、`agent-connection-*`、`connection-config-panel`、`field-mapping-editor`、`field-mapping-row-*`、`strategy-configuration-panel`、`save-status` 和 `revision-conflict-dialog`。浏览器测试应优先使用 role、label 和这些稳定标识，而非 CSS 类名。
