# Next Loop Prompt Index

```text
当前 Loop：LOOP-020
里程碑：M3 实验场 V1
状态：IN_PROGRESS
前置 Loop：LOOP-019（IN_PROGRESS）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome
浏览器要求：必需；只接受 Agent Chrome 验证，禁止用户手工验收或 DevTools 交接
推荐执行端：具备代码修改、自动化与真实 Chrome 控制能力的执行窗口
原因：继续 M3 实验场 V1。LOOP-019 已修复生命周期与合同基础，但新增自动化和真实 Chrome 创建/Evidence 全链仍未闭环；不得直接 Runtime Apply，也不得进入 M4。
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-020-m3-experiment-lab-closeout.md`](loop-prompts/loop-020-m3-experiment-lab-closeout.md)

本文件只作为当前 Loop 索引，不承载完整任务。
