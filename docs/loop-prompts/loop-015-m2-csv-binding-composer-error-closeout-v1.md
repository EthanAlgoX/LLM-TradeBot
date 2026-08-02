# LOOP-015 — M2 CSV Binding 后 Composer 错误收尾

状态：READY。先以正式服务路径定位绑定后的 `INTERNAL_ORCHESTRATION_ERROR`，保持 Draft Authority、append-only、actor isolation、source exact-set 与 fail-closed。做最小修复并补行为测试；随后仅由 Agent 真实 Chrome 重验绑定、刷新、会话切换、继续对话、中英文双尺寸、Console 和可读取的 Network。不得要求用户人工操作。任一 Chrome 项未通过则 M2 保持 `IN_PROGRESS`。任何改动均须 commit 并 push。
