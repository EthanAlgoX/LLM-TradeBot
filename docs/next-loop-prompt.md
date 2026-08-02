# Next Loop Prompt Index

```text
当前 Loop：LOOP-024
里程碑：M5 Shadow 与晋升建议
状态：READY（M4 已完成；M5 仅构建 Shadow/建议闭环）
前置 Loop：LOOP-023（COMPLETE）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；只接受 Agent Chrome 验证，禁止用户手工验收、截图或 DevTools 交接
推荐执行端：具备代码修改、自动化与真实 Chrome 控制能力的执行窗口
原因：LOOP-023 已验证 deployment-scoped 真实 Paper cycle、双实例隔离、close-only、刷新/重启恢复和双尺寸 Chrome。下一步只允许建立不写账户/执行的 Shadow decision/evidence 与 Promotion Recommendation；不得实现 Live、自动晋升、Champion 替换或交易所写入。
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-024-m5-shadow-promotion-recommendations-v1.md`](loop-prompts/loop-024-m5-shadow-promotion-recommendations-v1.md)

本文件只作为当前 Loop 索引，不承载完整任务。
