# Next Loop Prompt Index

```text
当前 Loop：LOOP-022
里程碑：M4 多模拟运行中心
状态：READY（M4 continuation）
前置 Loop：LOOP-021（IN_PROGRESS）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；只接受 Agent Chrome 验证，禁止用户手工验收、截图或 DevTools 交接
推荐执行端：具备代码修改、自动化与真实 Chrome 控制能力的执行窗口
原因：LOOP-021 已完成严格 Deployment 基础合同、append-only SQLite 聚合、actor isolation、状态机、指纹阻断、并发调度原语和 HTTP 动作边界，但尚未接入真实 deployment-scoped cycle、持久 Detail 投影或交易页多实例 UI。M4 不实现 Live、自动晋升或交易所写入。
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-022-m4-multi-paper-runtime-center-v1-continuation.md`](loop-prompts/loop-022-m4-multi-paper-runtime-center-v1-continuation.md)

本文件只作为当前 Loop 索引，不承载完整任务。
