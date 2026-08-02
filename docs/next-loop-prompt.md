# Next Loop Prompt Index

```text
当前 Loop：LOOP-023
里程碑：M4 多模拟运行中心
状态：READY（M4 real Paper cycle closeout）
前置 Loop：LOOP-022（IN_PROGRESS）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；只接受 Agent Chrome 验证，禁止用户手工验收、截图或 DevTools 交接
推荐执行端：具备代码修改、自动化与真实 Chrome 控制能力的执行窗口
原因：LOOP-022 已完成 Deployment 持久 Projection、模拟/真实无副作用切换、Simulation Overview、创建入口与五个 Detail Tab，但调度器尚未接入真实 Decision -> Portfolio -> Risk -> Execution cycle，无法证明两个实例的交易事实隔离、close-only 和重启恢复。M4 不实现 Live、自动晋升或交易所写入。
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-023-m4-deployment-scoped-paper-cycle-closeout-v1.md`](loop-prompts/loop-023-m4-deployment-scoped-paper-cycle-closeout-v1.md)

本文件只作为当前 Loop 索引，不承载完整任务。
