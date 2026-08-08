# LOOP-060 — F4 原页 terminal 与 immutable v2 收尾

Loop ID：`LOOP-060`

里程碑：F4 Preflight / Backtest / Walk-Forward Evidence

验收模式：`DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY`

浏览器要求：**必需**。只能由 Agent 直接操作真实 Chrome；禁止用户人工验收、人工 DevTools 交接或以用户口述结果代替。

## 当前事实与唯一目标

LOOP-059 已修复 reload 的确定性根因：`hydrateRealWorkbench()` 的 history 成功后曾用 `Promise.all` 等待所有 F4 GET，一条未完成 runner 使 `realWorkbenchTurns` 不写入，render 为 0 卡。现 history 立即投影，F4 仅以 immutable `draftId + versionId + fingerprint` 独立合并。真实 Chrome reload 与 Agent 受控 Web/API restart 已恢复同 actor 的 cards、目标 v1 Backtest partial Evidence、lineage 和无 running。

本轮只先确定并修复：为什么新鲜 v1 的 Walk-Forward 在原页显示 scoped `running` 后未获得 terminal projection。不得以 reload、restart、重跑或换 Draft 作为原页 terminal 成功。原页完成 v1 后，才可经正常 Workbench 修改“最大仓位调整为 5%”并 Apply 同 Draft immutable v2，完成 v1 stale/read-only、v2 独立 Evidence、reload/restart 与双尺寸复验。

## 强制边界

- 仅可修改 F4 action/runner completion、exact-version projection/hydration、其合同、测试、Web UI 与文档。
- 禁止 Human Approval、Approved Paper Plan、Simulation Slot、Runtime Apply、Deployment、Run、Account/Position/Order/Fill、exchange write、Live/Canary/Champion、LOOP-025/M6，或修改/提交 `data/local-paper-workspace*`。
- 禁止 localStorage/sessionStorage authority、自动 reload/重跑、定时轮询、fixed sleep、无限重试或新建第二 authority。
- 始终保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`；F4 未 COMPLETE 前不得进入 F5。

## 必须证据

先在当前 HEAD 唯一受控 `npm run dev:paper` 与真实 Chrome 中，针对同一次 Walk-Forward 点击记录无敏感 lifecycle：exact version identity、handler/POST 是否一次、POST terminal/exception、server projection、merge、render 和可见 DOM。根因必须指向具体函数/状态/事件顺序。随后需在同一原页完整验证 v1 `Preflight → Backtest → Walk-Forward → EVIDENCE READY / APPROVAL REQUIRED`，每步即时 scoped running 且不 reload。

仅在 v1 terminal 后：正常修改并 Apply v2；验证 exact parent version/fingerprint、v1 stale/read-only Evidence 不变、v2 不继承 binding/jobs/evidence/running，并在原页独立完成 Evidence。然后 reload 与受控 Web/API restart，确认同 actor v1/v2、parent lineage、stale/terminal Evidence 恢复。中文 1440×900 与英文 820×760 无横向滚动且 focus visible；Console TradeBot warning/error 为 0（扩展错误单列）；Network 不可用时写 `TOOL_UNAVAILABLE`。

## 自动化、文档与 Git

补齐服务端 completion → Workbench exact-version state → render 的集成回归，并覆盖乱序、legacy isolation、v1/v2 identity、actor/invalid/method/payload/restart fail-closed 与无 Approval/Runtime/Simulation/交易副作用。执行并记录 `npm run check`、自然结束 `npm run test:ts`、`npm run build:web`、`git diff --check`。更新规划、路线图、handoff、next-loop 与本 Prompt；无论 F4 是否完成都 commit 到 `main`、push `origin/main`、确认 HEAD 一致，不创建 PR。若失败，创建唯一 LOOP-061 但仍只可继续 F4；若全部通过，LOOP-061 才可进入 F5，并明确最多三个 active Paper Deployment。
