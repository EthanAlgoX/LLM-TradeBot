# TradeBot Generic Paper Runtime Migration Readiness Loop

你现在继续开发 `/Users/hyx/Documents/workspace/tradebot`。先检查 Git 工作区并完整保留全部用户未提交修改，禁止破坏性 Git 命令，不要提交 Git。

## 目标

在通用 Semantic Configuration、Execution、Historical Evaluation、Backtest、Walk-Forward 和 Human Approval 全链通过后，建立“Approved Generic Strategy → Paper Runtime Binding”的迁移就绪层。该层只生成可审计、可回退、未激活的 Binding Candidate 和 Preflight 报告，不替换或重写现有 Current Crypto DecisionPipeline。

## 边界与交付

复用现有 Approved Paper Plan、Paper Runtime Binding Registry、Activation、Preflight、Lease、Heartbeat、Fencing、Close-only、Drain 和 Runtime Safety。不得创建第二套 Runtime 控制，不得热替换活跃 Pipeline，不得接入 Exchange Write。客户端只能提交 Approved Plan 引用和幂等键；Binding、Implementation、Account、Symbols、Cycles、Interval、Risk、Execution Mode 和 Secret 全部由服务端解析。

至少交付：严格 Migration Candidate/Preflight 合同、服务端唯一 Generic Binding 解析、Configuration/Graph/Evidence/Approval/Adapter fingerprint 连续性检查、当前活跃 Runtime 冲突阻断、重启恢复、回退引用、Bearer 注入拒绝、Web `MIGRATION_READY/NOT_READY/STALE/APPROVED_NOT_APPLIED` 状态。任何激活仍必须通过现有独立 Runtime Controls，默认不启动。

运行 check、全部 TypeScript tests、Web build、diff-check 和 dev:paper；浏览器不可用时如实记录。更新 Roadmap、Handoff，归档本 Prompt 并生成下一阶段 Prompt。
