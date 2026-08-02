# Next Loop Prompt Index

```text
当前 Loop：LOOP-021
里程碑：M4 多模拟运行中心
状态：READY
前置 Loop：LOOP-020（COMPLETE，M3 已关闭）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；只接受 Agent Chrome 验证，禁止用户手工验收、截图或 DevTools 交接
推荐执行端：具备代码修改、自动化与真实 Chrome 控制能力的执行窗口
原因：M3 已完成真实 Experiment/Evidence/Replay/Candidate 闭环；下一步实现多个独立 Paper Deployment 的并行模拟、Overview/Detail 与重启恢复。M4 不实现 Live、自动晋升或交易所写入。
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-021-m4-multi-paper-runtime-center-v1.md`](loop-prompts/loop-021-m4-multi-paper-runtime-center-v1.md)

本文件只作为当前 Loop 索引，不承载完整任务。
