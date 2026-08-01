# Next Loop Prompt Index

```text
当前 Loop：LOOP-010
里程碑：M2 数据中心 V1 最终收尾
状态：IN_PROGRESS
前置 Loop：LOOP-009（PARTIAL）
执行环境：本地仓库 + Agent 直接控制真实 Chrome
浏览器要求：必需；只接受 Agent Chrome 验证，禁止用户手工验收
推荐执行端：具备真实 Chrome 控制能力的执行窗口
原因：用户已明确禁止人工校验；实现和自动化已完成，本轮必须由 Agent 直接完成 UI、响应式、绑定恢复及 Console/Network 验收，通过后关闭 M2 并收敛过期规划快照
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-010-m2-agent-chrome-evidence-and-doc-convergence-v2.md`](loop-prompts/loop-010-m2-agent-chrome-evidence-and-doc-convergence-v2.md)

本文件只作为当前 Loop 索引，不承载完整任务。
