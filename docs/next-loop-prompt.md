# Next Loop Prompt Index

```text
当前 Loop：LOOP-011
里程碑：M2 数据中心 V1 最终收尾
状态：READY
前置 Loop：LOOP-010（PARTIAL，P0 卡死修复已完成）
执行环境：本地仓库 + Agent 直接控制真实 Chrome
浏览器要求：必需；只接受 Agent Chrome 验证，禁止用户手工验收
推荐执行端：具备真实 Chrome 控制能力的执行窗口
原因：数据中心无限 render/load 已修复并通过性能冒烟；本轮必须由 Agent 直接完成修复后的完整 CSV UI 绑定、刷新恢复、响应式及 Console/Network 验收，通过后关闭 M2 并进入 LOOP-012 / M3
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-011-m2-post-hotfix-agent-chrome-closeout-v1.md`](loop-prompts/loop-011-m2-post-hotfix-agent-chrome-closeout-v1.md)

本文件只作为当前 Loop 索引，不承载完整任务。
