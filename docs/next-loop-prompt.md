# Next Loop Prompt Index

```text
当前 Loop：LOOP-026
阶段：R0 Strategy App 产品预览框架
状态：READY（PROTOTYPE_ONLY / PRODUCT_REVIEW_FIRST）
前置基线：LOOP-024（M5 COMPLETE）
暂停任务：LOOP-025（保留但不执行；未授权 M6）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；只接受 Agent 直接控制真实 Chrome，禁止用户手工验收、截图或 DevTools 交接
推荐执行端：具备代码修改、自动化与真实 Chrome 控制能力的执行窗口
原因：用户已确认新的产品方向，但要求先快速交付可点击页面框架，确认信息架构和主流程后再逐项完善。当前先展示 Strategy Advisor、Strategy App、Agent Center、Data Center、Experiment handoff、未来 Live unavailable 和最多三个 Paper Simulation Slot；不得实现真实推荐、后端物化、Runtime 动作、Live、Canary 或交易所写入。
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-026-r0-strategy-app-product-preview-shell-v1.md`](loop-prompts/loop-026-r0-strategy-app-product-preview-shell-v1.md)

本文件只作为当前 Loop 索引，不承载完整任务。
