# LOOP-020 — M3 实验场 V1 行为修复、自动化与 Chrome 收尾

```text
Loop ID：LOOP-020
里程碑：M3 实验场 V1
状态：COMPLETE
前置 Loop：LOOP-019（IN_PROGRESS）
基线提交：56f018e8c593017a9369ee20e9155b1bb744c129
执行环境：本地仓库 + 修复后由 Agent 直接控制真实 Google Chrome
浏览器要求：必需；只允许 Agent 操作真实 Chrome，禁止用户手工验收或 DevTools 交接
验收模式：M3_BEHAVIOR_TESTS_AND_AGENT_CHROME_CLOSEOUT
```

关闭结果：353/353 自动化通过；Agent Chrome 已完成受控/Open Class 创建、真实 Backtest、109-fold Walk-Forward、Replay、唯一 Candidate、中英文双尺寸及 Web/API 重启恢复。Network 为 `TOOL_UNAVAILABLE`，TradeBot Console error 为 0，Runtime 始终未应用。

## 本轮目标

LOOP-019 已修复 Experiment Workspace 的自触发渲染循环，并补充严格 Evidence/Replay/Candidate 投影、版本化 cursor 和部分生命周期逻辑；但自动化仍为 M2 基线 `336/336`，真实 Chrome 仅验证了目录和安全状态，尚未走通创建结果链。

本轮必须完成三件事：

1. 用行为测试暴露并修复 Experiment contracts、Repository、comparability、Evidence、Replay、Candidate 和 UI 的真实缺陷；
2. 由 Agent 直接操作真实 Chrome 完成创建 → Backtest → Walk-Forward → Replay → Candidate → 刷新/重启恢复；
3. 满足全部 M3 关闭条件后更新规划并创建唯一编号 LOOP-021 进入 M4；未满足则 LOOP-021 继续 M3。

不得把本轮缩减为浏览器重试，也不得因为静态页面可读而关闭 M3。继续遵守 [`loop-019-m3-experiment-lab-continuation.md`](loop-019-m3-experiment-lab-continuation.md) 和 [`loop-018-m3-experiment-lab-v1.md`](loop-018-m3-experiment-lab-v1.md) 的产品、安全与数据权威要求。

## 强制安全边界

- 全程 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。
- Experiment 不得提供或调用 Approval、Deploy、Paper Plan、Paper Run、Runtime Apply、Order、position mutation 或 exchange-write。
- 不得改写 `StrategyEvidenceApprovalService` 的生产晋升语义。
- 继续复用 Graph Backtest/Walk-Forward runner、durable job repository/service 和 Graph Evidence Artifact；禁止第二套回测引擎。
- 不得用 Mock、随机结果、客户端赢家、CLI 子进程、临时 JSON、localStorage 或内存 Map 充当服务端事实源。
- 不得直接调用 API、Console 或数据库来替代 Chrome UI 验收，也不得修改/清空 `data/local-paper-workspace*` 造数据。
- 禁止要求用户点击、截图、打开 DevTools 或口头报告结果。
- 保留用户既有修改；禁止 `reset`、`checkout`、`clean` 或回退无关内容。

## 第一阶段：先写行为测试，再按失败事实修复

新增独立 Experiment 测试文件，使用真实 SQLite、严格 contracts 和可控的 Graph Evidence fixtures/fakes；不要把所有断言塞进一个巨型测试。测试名称必须表达领域行为。

最低新增覆盖：

1. contracts：严格 request/response，未知字段、1/6 participants、重复 ID、非法日期、非法 fingerprint、错误 Evidence shape 均拒绝；
2. Repository：actor isolation、同 key 同 request 幂等、同 key 不同 request 冲突、`limit + 1` 分页、稳定 tie-break、cursor version/kind/actor 绑定、损坏 definition/event/cursor fail closed；
3. append-only：definition 和 event 禁止 UPDATE/DELETE；event sequence 不能修改 immutable definition、actor、participant snapshot、lock 或 definition fingerprint；
4. create retry：已存在 Experiment 在后续已有 Evidence/Candidate 时，同 idempotency request 返回当前权威状态，不能退回初始 `draft`；
5. participants：2 和 5 正向；跨 actor、非 Strategy、runtimeApplied、不可 materialize、stale/unsupported 不能被目录伪报为 eligible；
6. immutable snapshot：源 Strategy/Agent/Prompt 后续产生新版本，旧 Experiment 的 refs、input 和 fingerprint 不变；
7. comparability：STRATEGY/MODEL/AGENT_GRAPH 各自只允许声明维度变化；多维漂移为 OPEN_CLASS；Market/Dataset/metric capability 不兼容为 INCOMPATIBLE；
8. Backtest/Walk-Forward：每 participant 稳定幂等 job、成功/部分失败、重复动作不增加重复事件/job、篡改 artifact/manifest/result 拒绝；
9. Replay：重新读取 durable job Evidence 并验证锁定 request 和 artifact，而非只哈希存储投影；重启后结果 fingerprint 稳定，损坏或漂移 fail closed；
10. Candidate：按 objective 排序、应用所有 constraints、唯一第一名正向、平局负向、Open Class/partial/stale/不 eligible 负向；
11. HTTP：认证、跨 actor、方法、路由、query/body、畸形 percent ID、非法 cursor、错误脱敏与状态码；
12. Web：mount/unmount 有界、表单状态不被重绘重置、创建结果可见、stale action 不串实验、无 Mock/部署动作。

最终 `npm run test:ts` 总数必须高于 336；仅改变计数或写无行为价值的 smoke test 不算完成。

## 第二阶段：修复已知服务端行为缺陷

### 1. Candidate 排名

当前实现使用 `ranked.length !== 1`，导致两个或更多合格 participant 时永远无法选出胜者。修正为：

- 至少存在一个满足 Evidence eligibility 和全部 constraints 的 participant；
- 按 `maximize_total_return` 的真实 Backtest total return 排序；
- 第一名必须相对第二名唯一；平局 fail closed；
- 参与排名的其他合格 participant 不应因为数量大于 1 而导致失败；
- Candidate 锁定 winner participant、Experiment definition fingerprint、winner Backtest/WF evidence fingerprints 和 constraint results；
- 重复 Candidate 请求幂等，不产生重复事件。

### 2. Constraints

- `maxDrawdownPctLte`、`minimumTradeCount`、`walkForwardPositive` 必须取自已验证 Evidence。
- `runtimeFailureCountEqZero` 不得使用常量 `true`。从明确、可审计的 participant job/failure evidence 得出实际失败数；若当前系统不能可靠提供该事实，结果应为 `unavailable/fail closed`，不得伪造 PASS。
- 即使 request constraints 为空，也要明确显示“未配置约束”，不能把缺失事实误写成 PASS。
- 删除无效/未使用的 constraint helper 和 `any` 绕过，保持单一判定路径。

### 3. Replay

当前 Replay 只对 Experiment 中保存的 manifest fingerprints 再哈希，不足以称为 verified。必须：

- 通过锁定的 `backtestJobId/walkForwardJobId` 从 durable job repository/service 读取当前权威 job；
- 校验 job kind、request、Dataset、range、Plan、Profile/Candidate Set 与 participant snapshot 一致；
- 对 job 中的 Graph Evidence Artifact 再执行 schema、manifest、result 和 lineage fingerprint 验证；
- 计算 definition/evidence/result fingerprint 并与原记录比对；
- job 缺失、失败、request 漂移、artifact 损坏或 fingerprint 不一致时稳定 fail closed；
- 重复 Replay 幂等，不重复提交 jobs，也不重复追加等价 event；
- 不读取 latest Draft 替换锁定输入。

如现有 `DurableGraphEvidenceJobService` 不暴露安全只读 `get()`，增加最小只读端口或显式依赖；不要通过 `as any` 访问 private repository。

### 4. Comparability 和 snapshot

- 不得只看 `graphFingerprint` 和 `marketPackId`。
- 根据 requested mode 比较 Dataset、range、timezone/calendar、Market/universe、execution、risk、model、Prompt、Graph 等实际可得锁定维度。
- 当前没有真实 Model variant 或 Agent Graph variant 能力时，服务端 catalog 应声明 unsupported，创建对应 mode 应为 INCOMPATIBLE/稳定拒绝；禁止把它伪装成 CONTROLLED。
- source refs 必须有明确语义字段，禁止依赖 `sourceRefs[0]` 的数组位置猜 Historical Plan。
- Dataset lock 至少保存 registry 已有的 marketPackRef、dataSourceRef、timezone、tradingCalendarRef；资金/费用/滑点若 runner 当前真实不可配置，明确记录 registered/default/unavailable，不能伪造数值。
- immutable event 只能改变允许的 lifecycle/Evidence/Replay/Candidate 投影，不能悄悄改 definition。

### 5. Repository/API

- Experiment event 增加严格 event kind、sequence/idempotency 或等价完整性机制，确保重启回放有确定顺序和合法状态转换。
- 对 event 表增加 UPDATE/DELETE 禁止触发器；必要时增加外键/actor ownership 约束。
- cursor 使用严格 Schema，校验 timestamp、ID、version、kind，并绑定 actor 或 actor fingerprint；不同 actor/kind cursor 不能混用。
- Service 提供公开、类型安全的 `get/list`；HTTP 不得使用 `(service as any).repo`。
- 已知资源未知方法返回 405，未知资源 404；错误只返回稳定 code，不回显内部 message。

## 第三阶段：修复 UI 创建结果链和工作台完整性

### 已知 UI 风险

当前点击动作先设置 busy 并 `render(root)`，然后才从新 DOM 读取 Dataset、Walk-Forward Plan 和 comparison mode；这会把用户选择恢复为默认值。必须在重绘前捕获受控表单状态，或把所有字段纳入稳定 state。

同时处理：

- `selected`、Dataset、range、plan、mode、objective、constraints 都纳入 actor/host-scoped state；卸载或 actor 变化时正确清理；
- 创建请求使用稳定的单次提交 idempotency key；网络重试复用同 key，用户明确新建才生成新 key；
- 所有响应先通过严格 response schema/type，再进入 UI；移除生产路径的 `Experiment = any` 和 participant/evidence `any`；
- action fetch 也使用 AbortController + epoch；路由/实验切换后旧 action 不能改写全局 `experiment`；
- 创建成功后必须定向展示返回的 Experiment，不能被并发 list/latest 响应覆盖；
- inline 显示稳定 domain error，不用 `alert()`，也不只写 `console.warn()`；
- Backtest、Walk-Forward、Replay、Candidate 按 lifecycle 正确启禁，防止明显非法请求；
- 增加 Experiment list/选择/刷新恢复；不能永远静默选择 `list.data[0]`；
- 显示真实 Dataset/time lock、changed/locked dimensions、Scorecard/equity、WF folds、Diff、constraints、lineage、Replay 和 Candidate；
- Open Class 无因果 winner、Candidate 禁用；Incompatible 禁止 Evidence；
- 中文/英文和 820px 窄屏完整可读，键盘 focus 可见。

页面空闲和路由往返继续保持有界 mount/render/fetch；不得重新引入 MutationObserver 自触发循环。

## 第四阶段：自动化命令

所有行为测试和修复完成后运行：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

要求：

- `test:ts` 总数必须高于 336，且新增测试覆盖本 Prompt 的关键正负路径；
- M1 历史会话、M2 Dataset Binding/Composer/恢复不得回归；
- Web production build 不泄漏 Operator token；
- Runtime 唯一动作链保持 Decision → Portfolio → Risk → Execution。

## 第五阶段：Agent Chrome 全链验收（必需）

仅在自动化与页面性能护栏通过后执行。使用单一、当前代码的 `npm run dev:paper`；端口占用时先只读确认本项目进程，只处理本项目陈旧进程。

Agent 必须直接控制真实 Google Chrome。禁止要求用户操作，也不得用 API、curl、日志、数据库、Playwright 或内置浏览器替代以下 UI 证据。

### A. 中文 1440×900：创建

1. 打开 `http://127.0.0.1:5174/#experiment`，确认页面稳定、可读，空闲无卡顿/持续重绘。
2. 确认无 Atlas、8.7%/4.6% Mock、Approval、Deploy 或 Paper 发布动作。
3. 若少于两个 eligible Strategy Version，只能由 Agent 通过可见编排 UI 创建兼容历史 Draft。
4. 选择两个 compatible participants，并显式改变至少一个非默认可选项；点击创建后确认页面展示的 lock 与所选值一致，证明表单未被 busy render 重置。
5. 确认 Experiment 出现在列表且被定向选中；Fairness Lock、participant refs、Dataset version/fingerprint、snapshot 和安全状态可见。

### B. Backtest → Walk-Forward → Replay → Candidate

1. 通过可见 UI 运行 Backtest，等待每个 participant 得到真实状态；查看 equity、total return、max drawdown、trade/fill/risk reject/cycle count。
2. 运行 Walk-Forward；查看 folds、validation、promotion eligibility、unavailable metrics 和 Evidence lineage。
3. 查看 changed/locked dimensions、配置 Diff 和每个约束的 actual/expected/PASS/FAIL。
4. 执行 Replay；确认 `verified`、definition/evidence/result fingerprints 稳定，job 数/refs 没有重复。
5. 若唯一第一名满足条件，创建 Candidate；确认 winner 来自多个合格 participant 的真实排序，而不是要求只剩一个 participant。
6. Candidate 仅为 `candidate_for_validation`，无 Approval、Deploy、Paper Run、Runtime Apply。
7. 刷新 Web，再重启本项目 Web/API；恢复同一 selected Experiment、lock、Evidence、Replay、Candidate 和 fingerprints。

### C. 负向与隔离

- 少于 2 个 participant 时创建禁用或明确拒绝。
- 通过可见能力验证 Open Class：显示漂移维度，无因果 winner，Candidate 禁用。
- unsupported comparison mode 显示明确 unavailable/incompatible，不能伪报 controlled。
- 新建或切换第二 Experiment，快速往返并触发刷新；结果、错误、busy 和 stale response 不串台。
- 重复点击/重试动作不创建重复 jobs/events/Candidate。

### D. English 820×760、Console、Network

- English、820×760：列表、创建器、Fairness Lock、阶段、equity/Scorecard、Diff、constraints、lineage、Replay、Candidate 和错误可读；无横向滚动、无遮挡。
- 清空 Console 后执行主流程、刷新和重启；TradeBot 页面 error 为 0。扩展自身异步消息错误单独标注。
- 若 Agent Chrome 提供 Network，只报告非敏感 `method path status`，确认 Experiment GET/POST 无意外 401/5xx。
- 若 Network 不可用，记录 `TOOL_UNAVAILABLE`；禁止人工或其他工具替代。其余全部通过时，该单项不阻止 M3 关闭。

### E. Runtime safety

全程确认：

```text
runtimeApplied=false
Paper Only
exchangeWriteAllowed=false
```

并确认没有新增 Approval、Paper Plan、Paper Run、Order、position 或 exchange-write 事实。

## M3 关闭规则与下一 Loop

只有以下全部通过，才能将 M3 标为 `COMPLETE`：

- 严格 contracts 和不可变 snapshot；
- Repository/API/actor isolation 与重启恢复；
- 真实 comparability、Evidence、Scorecard、Replay、constraints 和 Candidate；
- 新增行为测试，总数高于 336；
- Agent Chrome 中文 1440×900、英文 820×760、正向、负向、刷新/重启、Console；
- Runtime safety。

Network `TOOL_UNAVAILABLE` 可按前述规则豁免。任何其他核心项为 PARTIAL/NOT VERIFIED 时不得关闭 M3。

完成时：

1. 将 LOOP-018、LOOP-019、LOOP-020 和 M3 标为 `COMPLETE`；更新真实测试数与 Chrome 证据。
2. 更新 `docs/product-optimization-plan-and-progress.md`、`docs/product-roadmap-and-progress.md`、`docs/project-status-and-handoff.md`。
3. 创建唯一文件 `docs/loop-prompts/loop-021-m4-multi-paper-runtime-center-v1.md`。
4. 更新 `docs/next-loop-prompt.md` 指向 LOOP-021，并明确 M4 的浏览器要求。

未完成时：

1. LOOP-020/M3 保持 `IN_PROGRESS`，逐项记录代码、自动化和 Chrome 缺口。
2. 创建唯一编号 LOOP-021 继续 M3，不得覆盖既有 Prompt 或进入 M4。
3. 更新 `docs/next-loop-prompt.md` 指向新的续办文件。

## Git 要求

- 任何代码或文档修改都必须创建范围明确的 commit 并 push 当前分支到 `origin`，即使 M3 未关闭。
- 提交前检查 staged diff，禁止提交 `data/local-paper-workspace*`、SQLite、Token、Secret、环境凭据、Evidence 临时文件或浏览器产物。
- push 后验证远端 branch ref 与本地 HEAD 一致。
- 不创建 PR，除非用户明确要求。

## 最终报告格式

```text
Loop ID：LOOP-020
验收模式：M3_BEHAVIOR_TESTS_AND_AGENT_CHROME_CLOSEOUT / IN_PROGRESS
浏览器要求：必需；Agent 已使用真实 Chrome / Chrome 控制未完成
新增 Experiment 行为测试：PASS / FAIL（test:ts x/x）
Experiment 严格合同与不可变快照：PASS / PARTIAL / FAIL
Repository/API/actor isolation：PASS / PARTIAL / FAIL
Comparability/Fairness Lock：PASS / PARTIAL / FAIL
Backtest Evidence：PASS / NOT VERIFIED
Walk-Forward Evidence：PASS / NOT VERIFIED
真实 Scorecard/equity/Diff/lineage：PASS / NOT VERIFIED
Replay durable artifact 验证：PASS / NOT VERIFIED
Objective/Constraints 与 Candidate winner：PASS / NOT VERIFIED
UI 创建结果与表单权威：PASS / NOT VERIFIED
中文 1440×900：PASS / NOT VERIFIED
英文 820×760：PASS / NOT VERIFIED
负向/Open Class/实验隔离：PASS / NOT VERIFIED
Console：PASS / NOT VERIFIED
Network：PASS / TOOL_UNAVAILABLE / NOT VERIFIED（PASS 时仅 method/path/status）
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false / NOT VERIFIED
自动化：check PASS/FAIL；test:ts x/x；build:web PASS/FAIL；diff-check PASS/FAIL
M3：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-021（M4 / M3，唯一文件名）
Git：commit <hash>；branch <name>；push PASS / FAIL；未创建 PR
```
