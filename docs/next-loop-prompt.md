# Next Loop Prompt Index

```text
当前 Loop：LOOP-015
里程碑：M2 数据中心 V1 — CSV Binding 继续对话错误收尾
状态：READY
前置 Loop：LOOP-014（PARTIAL，绑定成功与刷新恢复已通过；继续对话出现 INTERNAL_ORCHESTRATION_ERROR）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome
浏览器要求：必需；只接受 Agent Chrome 验证，禁止用户手工验收或 DevTools 交接
推荐执行端：具备代码修改、自动化与真实 Chrome 控制能力的执行窗口
原因：先定位并以最小行为修复绑定后的 Composer INTERNAL_ORCHESTRATION_ERROR；随后由 Agent Chrome 重验继续对话、双尺寸、Console 与可用的 Network。
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-015-m2-csv-binding-composer-error-closeout-v1.md`](loop-prompts/loop-015-m2-csv-binding-composer-error-closeout-v1.md)

本文件只作为当前 Loop 索引，不承载完整任务。
