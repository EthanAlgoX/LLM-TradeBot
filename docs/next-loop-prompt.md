# Next Loop Prompt Index

```text
当前 Loop：LOOP-013
里程碑：M2 数据中心 V1 — CSV-Compatible Draft 创建与最终收尾
状态：READY
前置 Loop：LOOP-012（PARTIAL，Binding UI 已完成，但没有可由 UI 创建的 CSV-backed Draft）
执行环境：本地仓库 + 实现后由 Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；只接受 Agent Chrome 验证，禁止用户手工验收
推荐执行端：具备代码修改、自动化与真实 Chrome 控制能力的执行窗口
原因：CSV intent、Binding UI 与恢复代码已存在，但当前注册 Graph/Copilot 路径无法稳定产生 CSV-compatible Market/Agent Draft；本轮先补齐真实注册能力和可见创建入口，再完成绑定、恢复与 Chrome 验收
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-013-m2-csv-compatible-draft-and-agent-chrome-closeout-v1.md`](loop-prompts/loop-013-m2-csv-compatible-draft-and-agent-chrome-closeout-v1.md)

本文件只作为当前 Loop 索引，不承载完整任务。
