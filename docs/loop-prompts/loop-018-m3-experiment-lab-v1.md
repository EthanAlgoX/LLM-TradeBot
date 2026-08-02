# LOOP-018 — M3 实验场 V1

```text
Loop ID：LOOP-018
里程碑：M3 实验场 V1
状态：READY
前置 Loop：LOOP-017（COMPLETE，M2 数据中心 V1 已关闭）
执行环境：本地仓库 + 实现后由 Agent 直接控制真实 Google Chrome
浏览器要求：实现后必需；禁止用户手工验收或 DevTools 交接
验收模式：EXPERIMENT_LAB_AND_AGENT_CHROME_VERIFIED
```

## 目标

将既有 Agent Lab 收敛为可重放的实验场：只允许从服务端权威 Conversation/Draft Version 创建实验，锁定 Dataset、时间区间、资金、费用、Risk 与 Model/Prompt 变量，比较 2～5 个参与版本，并展示净值、回撤、核心 Scorecard 与配置 Diff。实验结果只能进入 Backtest → Walk-Forward → Candidate 证据链，不得直接 Apply Runtime。

## 强制边界

- Server authority、actor/conversation/Draft/version/fingerprint isolation、append-only、strict cursor 与 fail-closed 不得放宽。
- 不得从客户端声明或缓存猜测 Dataset、Graph、Risk、Runtime 或实验参与者；所有引用必须由服务端校验。
- 不得 Apply Runtime、启动 Paper Run、下单或增加交易所写能力；全程 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。
- 使用 `npm run dev:paper` 及真实 Chrome 完成中文 1440×900、英文 820×760、创建/重放/比较/负向/刷新/Console 验收；Network 无能力时仅记录 `TOOL_UNAVAILABLE`。
- 所有代码或文档修改必须 commit 并 push；不创建 PR，除非用户明确要求。

## 最低交付

1. 严格服务端 Experiment 合同与持久化 read model，包含 participant Draft References、Dataset reference、固定条件、fingerprint 与证据状态。
2. UI 从可见服务端历史选择 2～5 个兼容版本，显示不可编辑的锁定条件、配置 Diff、净值/回撤/Scorecard 和明确的不充分/拒绝状态。
3. 自动化覆盖 actor isolation、参与者/数据漂移、分页、重放确定性、损坏记录、未认证与 Runtime 隔离；运行 `npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check`。
4. Agent Chrome 以可见 UI 完成正向与负向流程；不得要求用户点击、截图、DevTools 或口头验收。
