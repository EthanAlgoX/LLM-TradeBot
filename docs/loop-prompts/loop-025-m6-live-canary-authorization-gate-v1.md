# LOOP-025 — M6 Live / Canary 授权门槛准备 V1

Loop ID：LOOP-025
里程碑：M6 受控 Live 与 Canary 的授权门槛准备
状态：READY（NON_OPERATIONAL / NOT_AUTHORIZED）
前置 Loop：LOOP-024（M5 COMPLETE）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome（仅当产生只读 UI 证据时）
验收模式：LIVE_AUTHORIZATION_READINESS_ONLY
Git 要求：任何代码或文档修改都必须 commit 并 push；不创建 PR

## 已完成基线

LOOP-024 已关闭 M5。M5 只从明确的 M4 deployment/run/cycle 持久事实和 Artifact lineage 读取 Shadow context，在独立 append-only Shadow 表中持久化同 scope Champion/Challenger 的描述性比较与 terminal read-only recommendation。M4 仍是唯一 Paper Runtime；M5 不写 M4 account、position、order、fill、cycle journal、risk/safety 或 existing Artifact。

真实 Chrome 已验证两个 M4 实例的 M5 Shadow records、快速切换、刷新、Web/API 重启、中英文 1440×900/820×760；Network 和 Console clear 是 `TOOL_UNAVAILABLE`，可读取 Console warning/error 为空。

## 本 Loop 的唯一目标与授权边界

为将来的 M6 形成可审计的 **授权前置清单**，而不是实现或启用 Live / Canary。目标是让产品负责人能够明确决定是否授予下一阶段的受限工程授权。

- 本 Loop 不得实现、注册或调用 Live Execution Port、交易所写 adapter、真实账户、Secret Vault、Canary scheduler、下单、资金划拨、策略替换、持仓迁移、自动批准或 Runtime Apply。
- 本 Loop 不得新增任何可导致 M4/M5 runtime、Paper account、position、order、fill、cycle journal、risk/safety、Artifact、数据库或本地 workspace 发生交易语义改变的入口。
- 保持 `runtimeApplied=false`、`exchangeWriteAllowed=false`、Paper Only。不得将当前 read-only local live view 误称为 Live trading capability。
- 不得创建、读取、复制或显示任何真实交易所 Secret、账户值、Cookie、Token 或个人数据。不得更改或提交 `data/local-paper-workspace*`、SQLite、日志、截图或浏览器缓存。
- 没有用户在此 Loop 中的明确授权时，结论必须是 `NOT_AUTHORIZED`；不得把 M5 recommendation、测试通过或任何推断当作 Live 授权。

## 交付要求

1. 基于 M4/M5 的现有 contracts、runtime boundary、Policy 和 persisted evidence，形成一份版本化、可审阅的 M6 Authorization Readiness Artifact（文档或严格只读 contract），至少包含：
   - 必需的产品授权人、风险授权人、运行负责人和紧急联系人角色；
   - 明确的授权范围（市场、账户隔离、策略版本、最大预算、Canary 上限、有效期）与否决条件；
   - Live Preflight、capability/Secret ownership、least privilege、lease/heartbeat/fencing、reconciliation、Close-only、Safe Stop、incident、audit、rollback 和持仓交接的可验证前置条件；
   - M5 recommendation 仅作为输入证据，不能转换为 Approval；
   - 每一项的已有证据、缺口、owner、验证方式和 fail-closed 行为。
2. 若增加任何 API 或 UI，它只能读取并显示该 readiness artifact；不得接收账户、secret、policy 数值、策略候选、runner、代码、SQL、URL、path、执行命令或 Runtime control。必须 actor-scoped、严格 schema、append-only、cursor-bound、幂等且可恢复。
3. 明确区分 `NOT_AUTHORIZED`、`EVIDENCE_GAP`、`READY_FOR_HUMAN_REVIEW` 与任何未来授权后的状态；没有完整人工授权记录不得出现 `AUTHORIZED`。
4. 将 M4/M5 边界写成可测试的负向断言：Shadow terminal recommendation、readiness artifact 和页面切换均不能 Start/Stop/Archive/Apply runtime、替换 Champion、写账户或触达交易所。

## 自动化与 Chrome 验收

新增行为级测试并保持全量通过，至少覆盖：

- readiness scope 及其 actor/cursor/idempotency/recovery 隔离（若本 Loop 新增持久化）；
- 任何客户端 executable、account、secret、policy、candidate、runner、SQL/URL/path 或 runtime-control 注入均拒绝；
- 无授权、过期授权、范围不匹配、缺失 evidence、M4/M5 fingerprint 漂移均为 explicit `NOT_AUTHORIZED` 或 fail-closed；
- 不存在 Execution Port、交易所写、Paper/M4/M5 账户或 runtime 写入；
- M0-M5，特别是 M4 双实例、close-only 与 M5 Shadow terminal/read-only recommendation 不回归。

执行并记录 `npm run check`、`npm run test:ts`、`npm run build:web` 和 `git diff --check`。

仅在确有只读 UI 变更时，Agent 直接控制真实 Chrome，在中文 1440×900 与英文 820×760 验证状态、scope、evidence gap 和无运行控制；快速切换、刷新和 Web/API 重启后确认不串台且无交易动作。检查 Console；若 Network 或 Console clear 能力不可用，记录 `TOOL_UNAVAILABLE`，不得改为人工验收。

## 关闭规则

仅当交付物始终为非操作性、所有授权均保持 `NOT_AUTHORIZED`、无账户/交易/runtime 写入、自动化及必要 Agent Chrome 验收通过时，才可标记 LOOP-025 `COMPLETE`。这不授权开始 Live 或 Canary；只有用户随后明确授予范围受限的工程权限，才能创建一个新的独立 Prompt 实现 M6 的任何执行能力。

最终更新产品计划、路线图、交接和 `next-loop-prompt.md`；确认不会提交本地运行产物；commit 并 push 当前分支，不创建 PR。
