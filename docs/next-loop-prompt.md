# Next Loop Prompt Index

```text
当前 Loop：LOOP-012
里程碑：M2 数据中心 V1 — CSV Binding UI 闭环与最终收尾
状态：READY
前置 Loop：LOOP-011（PARTIAL，真实 Chrome 发现编排侧缺少 Dataset Binding UI 消费路径）
执行环境：本地仓库 + 实现后由 Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；只接受 Agent Chrome 验证，禁止用户手工验收
推荐执行端：具备代码修改、自动化与真实 Chrome 控制能力的执行窗口
原因：服务端 Binding 合同已存在，但“送入编排”目前只导航；本轮需补齐可见确认、不可变 Draft Version、Conversation Draft Authority 与刷新恢复闭环，再关闭 M2
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-012-m2-csv-binding-ui-and-agent-chrome-closeout-v1.md`](loop-prompts/loop-012-m2-csv-binding-ui-and-agent-chrome-closeout-v1.md)

本文件只作为当前 Loop 索引，不承载完整任务。
