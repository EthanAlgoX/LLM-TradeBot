# LOOP-016 — M2 CSV Binding UI 合同收尾

状态：READY。修复 LOOP-015 真实 Chrome 中 CSV Historical 可见 Binding 返回 `REQUEST_CONTRACT_INVALID` 的前端/HTTP 合同断点；先用正式服务链路定位具体受控字段，再进行最小修复和行为测试。随后仅由 Agent 真实 Chrome 重验 CSV Draft 创建、Binding、刷新恢复、允许 Composer 修改、中英文双尺寸、负向、Console 与 Runtime safety。禁止用户人工操作、DevTools 或直接写入 workspace 数据；任何改动必须 commit 并 push。M2 只有所有 Chrome 项通过后方可关闭。
