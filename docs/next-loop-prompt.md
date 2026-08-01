# Next Loop Prompt Index

```text
当前 Loop：LOOP-010
里程碑：M2 数据中心 V1 最终收尾
状态：READY
前置 Loop：LOOP-009（PARTIAL）
执行环境：本地仓库 + 用户手工操作真实 Chrome
浏览器要求：必需，但 Agent 禁止调用浏览器控制工具
推荐执行端：可访问本地仓库的新执行窗口，用户同时使用真实 Chrome
原因：实现和自动化已经完成；LOOP-006～009 连续受 Agent Chrome 控制通道阻塞，本轮完全移除自动控制路径，只接受用户手工 Chrome 反馈；通过后关闭 M2 并收敛过期规划快照
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-010-m2-manual-evidence-and-doc-convergence-v1.md`](loop-prompts/loop-010-m2-manual-evidence-and-doc-convergence-v1.md)

本文件只作为当前 Loop 索引，不承载完整任务。
