# Next Loop Prompt Index

```text
当前 Loop：LOOP-025
里程碑：M6 Live / Canary 授权门槛准备
状态：READY（M5 已完成；本 Loop 不能实现或启用 Live）
前置 Loop：LOOP-024（M5 COMPLETE）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；只接受 Agent Chrome 验证，禁止用户手工验收、截图或 DevTools 交接
推荐执行端：具备代码修改、自动化与真实 Chrome 控制能力的执行窗口
原因：LOOP-024 已验证只读 Shadow 对明确 M4 persisted source 的独立事实、同 scope 对比、terminal recommendation、A/B 切换、刷新/重启恢复与双尺寸 Chrome。M6 在安全评审和用户的显式授权之前只能梳理授权前提、能力缺口和验收证据；不得实现 Live、Canary、Execution Port、账户/Secret 接入、自动晋升、Champion 替换或交易所写入。
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-025-m6-live-canary-authorization-gate-v1.md`](loop-prompts/loop-025-m6-live-canary-authorization-gate-v1.md)

本文件只作为当前 Loop 索引，不承载完整任务。
