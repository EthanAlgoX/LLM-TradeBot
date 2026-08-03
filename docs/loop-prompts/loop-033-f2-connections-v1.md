# LOOP-033 — F2 连接配置 V1

```text
Loop ID：LOOP-033
里程碑：F2 Connections V1
执行模式：IMPLEMENT_AND_AGENT_CHROME_VERIFY
安全边界：Paper Only / runtimeApplied=false / exchangeWriteAllowed=false / no Runtime Apply
Git：任何修改必须 commit 并 push；不创建 PR
```

阅读产品、三份进度/交接、LOOP-032 与现有 Data Source Capability、Model Adapter、Bearer actor、SQLite、Web Connections 和测试。保留用户修改，禁止 reset/checkout/clean。

将连接配置从 Preview 收敛为 actor-scoped Connection Definition/immutable Version，复用已有 Data Source、Dataset、Model Adapter Registry 与 Secret 边界；仅展示健康、能力、版本、影响范围和后端 secret reference 状态。客户端不得读取、发送、存储或显示 Secret/Token，不能上传 URL、代码、SQL、路径、Runner 或 Runtime 参数。未知连接、跨 actor、能力漂移、Secret 注入、PUT/PATCH/DELETE、未知字段均 fail closed；SQLite 重启恢复不改变 Agent/Strategy/Runtime/Account/Order/Fill/Shadow。

完成后用真实 Chrome 验证中文 1440×900、英文 820×760、刷新与 Web/API 重启恢复、Console 与 Runtime safety。运行 check、test:ts（自然结束）、build:web、diff-check；更新文档并 commit/push main，不创建 PR。
