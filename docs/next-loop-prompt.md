# Next Loop Prompt Index

```text
当前 Loop：LOOP-017
里程碑：M2 数据中心 V1 — CSV Binding Authority 恢复收尾
状态：READY
前置 Loop：LOOP-016（IN_PROGRESS，Binding 合同已修复；真实 Chrome 仍出现恢复后的非 CSV Draft 上下文切换）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome
浏览器要求：必需；只接受 Agent Chrome 验证，禁止用户手工验收或 DevTools 交接
推荐执行端：具备代码修改、自动化与真实 Chrome 控制能力的执行窗口
原因：保持共享 Binding Schema 和有界稳定 key，不得回退。以真实 Chrome 精确定位 Binding 成功后的 history/replay/currentDraft Authority 切换，完成刷新、重启、Composer、双尺寸与安全闭环。
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-017-m2-csv-binding-authority-recovery-closeout-v1.md`](loop-prompts/loop-017-m2-csv-binding-authority-recovery-closeout-v1.md)

本文件只作为当前 Loop 索引，不承载完整任务。
