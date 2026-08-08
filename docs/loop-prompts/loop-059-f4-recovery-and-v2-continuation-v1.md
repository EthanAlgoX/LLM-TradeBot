# LOOP-059 — F4 刷新恢复与 immutable v2 收尾

结果（2026-08-08）：`IN_PROGRESS`。根因是 `hydrateRealWorkbench()` 在 history 成功后以 `Promise.all` 等待所有 F4 GET；单条 in-flight runner 阻塞时不会写入 `realWorkbenchTurns`，reload render 为 0 卡。已改为 history 先渲染、F4 按 `draftId + versionId + fingerprint` 独立合并；Agent Chrome reload/restart 恢复卡片、partial Evidence 与 lineage，且不残留 running。新鲜 v1 Walk-Forward 原页仍未取得 terminal projection，故未创建 v2；下一入口仅为 LOOP-060 F4 continuation。

Loop ID：`LOOP-059`

里程碑：F4 Preflight / Backtest / Walk-Forward Evidence

验收模式：`DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY`

浏览器要求：**必需**。只能由 Agent 直接操作真实 Chrome；禁止用户人工验收、人工 DevTools 交接或以用户口述结果代替。

基线：`main` / `70ff69c`，`npm run test:ts` 自然 TAP `385/385 PASS`。

---

## 1. 当前事实

LOOP-058 已关闭同步 Evidence runner 执行期间旧 Gate 仍可点击的问题：

- F4 action 开始后，页面立即显示按 `configurationVersionId + action` 隔离的临时 `running` 状态；
- 旧 action 按钮立即移除，不能重复提交；
- POST 返回后，只允许 exact immutable version 的服务器 projection 替换临时状态；
- Agent Chrome 已观察 Backtest 和 Walk-Forward 在原页完成 `running → 后续 gate`；
- 临时 running 只是请求进行中的 UI 状态，不是 Evidence authority；
- `check`、自然结束 `test:ts` 385/385、`build:web`、`diff-check` 均已通过。

F4 仍为 `IN_PROGRESS`。当前唯一已确认的阻塞是：

> 完成 Evidence 链后 reload，当前 actor 页面没有恢复出对应 F4 卡片，因此无法继续验证同一 Draft 的 immutable v2、v1 stale/read-only、v2 独立 Evidence，以及受控 Web/API restart recovery。

本轮必须先定位“服务端已有 Draft/Evidence，但 reload 后页面为什么没有恢复 F4 卡片”的确定性根因，再完成 F4 全链收尾。不得把 reload 后重新创建 Draft、重新执行 Evidence 或切换到其他会话当作恢复成功。

---

## 2. 强制安全边界

本轮只允许修改：

- Workbench 同 actor Conversation/Draft/F4 projection 的 reload/restart hydration；
- immutable version identity 的合并、选择和渲染；
- F4 action 临时 running 状态在 reload/restart 后的正确清理；
- 与上述行为直接相关的合同、测试、Web UI 和文档。

本轮禁止：

- 调用 Human Approval；
- 创建 Approved Paper Plan；
- 申请或启动 Simulation Slot；
- Runtime Apply、Deployment、Run 或真实 Paper cycle；
- 创建或修改 Account、Position、Order、Fill；
- 交易所写入、Live、Canary、Champion 自动替换或持仓迁移；
- 恢复 LOOP-025 / M6；
- 新建第二套 Draft、Evidence、Conversation、Catalog 或 F4 authority；
- 使用 localStorage/sessionStorage 保存 Draft、Evidence 或 F4 Gate 作为恢复事实源；
- reload 后自动重建 Draft、重跑 Preflight/Backtest/Walk-Forward 来伪造恢复；
- 用定时轮询、固定 sleep、无限重试或强制页面 reload 掩盖 hydration 缺陷；
- 读取、打印、复制或暴露 Bearer、Cookie、Secret、Token 值；
- 修改或提交 `data/local-paper-workspace*`。

必须始终保持：

```text
runtimeApplied=false
Paper Only
exchangeWriteAllowed=false
```

F4 未 `COMPLETE` 前不得进入 F5。

---

## 3. 执行前检查

1. 阅读：
   - `docs/product-optimization-plan-and-progress.md`
   - `docs/product-roadmap-and-progress.md`
   - `docs/project-status-and-handoff.md`
   - `docs/next-loop-prompt.md`
   - LOOP-054～LOOP-058 的 Prompt 和 handoff。
2. 执行 `git status --short --branch`，保留用户既有修改，不回退、不覆盖无关文件。
3. 确认 `main` 基线包含 `70ff69c`，并确认本地与 `origin/main` 的关系。
4. 只启动一个可识别的当前 HEAD `npm run dev:paper` 链路；不得误用构建前旧进程。
5. 检查 5174/8787 监听者。如果端口由不属于本轮的进程占用，只做只读识别；不要误杀无关进程。
6. 不清空、不删除、不替换本地 workspace 数据。若既有脏数据阻塞，只能使用产品正常生命周期创建新鲜 actor-scoped fixture。

---

## 4. 必须取得的恢复链证据

在改代码前，先对一次“F4 完成后 reload 卡片消失”进行有界、非敏感生命周期跟踪。至少判定以下每一层是 PASS 还是第一个失败点：

1. reload 前后是否仍是同一个服务端 actor 身份；只记录“same/different”，禁止记录 Cookie/Token 值。
2. Conversation history 请求是否成功，是否恢复同一 conversation identity。
3. 权威 Turns 是否包含 Apply 后的 exact Draft reference。
4. Draft reference 是否仍包含相同：
   - `draftId`
   - `versionId`
   - `fingerprint`
   - parent version/fingerprint（如适用）。
5. history hydration 是否把该 Draft Version 放入当前 Workbench state。
6. F4 projection GET 是否对该 exact version 发出，并返回预期 gate/jobs/evidence。
7. projection 是否按 `draftId + versionId + fingerprint` 合并到正确 Turn，而不是按数组下标、latest 或当前选中项猜测。
8. render 输入是否包含该 Draft 和 F4 projection。
9. render 输出是否包含对应 F4 卡片。
10. 是否有后续 history、catalog、selection、language 或 route render 把卡片移除。
11. reload 时遗留的临时 running 状态是否被安全清除，并由服务端 projection 决定最终状态。

可以加入短期 DEV-only、无敏感值的 lifecycle trace，但必须满足：

- 只记录事件名、epoch、opaque identity 是否相等、数量和状态摘要；
- 不记录 prompt 正文、Token、Cookie、Secret 或完整用户输入；
- 根因确认后删除，或确保 production build 中完全禁用；
- 不把 trace 本身当成修复。

根因结论必须具体到函数、状态键和事件顺序。以下表述不能单独作为根因：

- “可能是 race”；
- “可能是 Chrome cache”；
- “重新请求一下就好了”；
- “reload 丢了前端状态”；
- “服务端应该没问题”。

---

## 5. 修复原则

修复必须满足：

1. 服务端 append-only Conversation、immutable Draft Version 和 F4 projection 仍是唯一事实源。
2. reload/restart 只读取并投影已有事实，不重新创建或重新执行事实。
3. Draft/F4 合并必须使用 immutable version identity，禁止数组下标、模糊 latest 或只按 draftId 合并。
4. history hydration 可以补充 Turns，但不能删除已经恢复的有效 Draft Version/F4 projection。
5. action 的临时 running 状态只属于当前页面请求；reload 后不得把它恢复为权威 running，也不得覆盖服务端 terminal projection。
6. 陈旧 epoch、旧 conversation、旧 version 或迟到响应不能覆盖当前 exact-version authority。
7. 单个 legacy/损坏 Draft 的 hydration 失败必须隔离、显式显示且 fail closed，不能阻塞其他健康 Draft。
8. F4 action 后的原页即时更新能力必须保留，不得为了 reload recovery 回退到“刷新才更新”。
9. 不修改 F1/F2/F3 authority，不改变 M4/M5 Runtime 或 Shadow 行为。

如果现有全局 state/epoch/DOM 代码无法可靠表达上述规则，可以只提取小型 hydration coordinator 或纯 reducer；禁止引入新前端框架或重写整个页面。

---

## 6. 自动化测试要求

除修复所需的聚焦单元测试外，至少增加或补齐以下集成级行为：

1. 同 actor reload：Conversation → Turns → Draft references → exact-version F4 projection → render model 完整恢复。
2. action 完成后 reload：临时 running 不残留，terminal server projection 可见。
3. history 与 F4 projection 任意先后返回，最终状态一致。
4. 迟到旧 history、旧 conversation 或旧 version 响应不能移除当前 F4 卡片。
5. 一个 legacy/error Draft 不阻塞另一个健康 Draft 的 F4 hydration。
6. 同 Draft immutable v1→v2：
   - v1 保持不可变且 Evidence 可读；
   - v1 因新版本变为 stale/read-only，不恢复 authorization；
   - v2 带精确 parent version/fingerprint；
   - v2 不继承 v1 的 binding、jobs、Evidence ready 或临时 running；
   - v2 可独立完成新的 Preflight/Backtest/Walk-Forward。
7. actor 隔离、非法 ID、跨 scope cursor、错误 method 与损坏 payload 继续 fail closed。
8. Web/API restart 后 SQLite 中的 Conversation、Draft Version、F4 binding/job/evidence 能按同 actor 恢复。
9. 不产生 Approval、Runtime、Simulation 或交易事实。

不得只测试 helper；至少有一条测试覆盖“服务端恢复结果 → Workbench state → F4 render 输出”。

---

## 7. 自动化门禁

修复后必须全部执行，并取得真实最终结果：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

要求：

- `test:ts` 必须自然结束；
- 必须记录最终 TAP 汇总和 exit 0；
- 不得只报告“所有子测试看起来通过”；
- 若有异步句柄导致不退出，必须定位并关闭本轮拥有的资源；
- 不得使用强制 kill 把未自然结束写成 PASS。

---

## 8. Agent 真实 Chrome 验收

只能由 Agent 操作真实 Chrome。不能让用户手动点击、手动检查 DevTools 或回复 PASS/FAIL；不能以内置浏览器、API、服务端日志或自动化测试替代要求中的可见 UI 证据。

### 8.1 新鲜 v1 原页 Evidence 链

通过正常产品生命周期创建并 Apply 一个新鲜 Workbench v1：

1. F4 卡片显示 exact Configuration v1/fingerprint。
2. 点击 Preflight，原页立即进入正确状态。
3. 点击 Backtest，立即显示 scoped running，旧按钮消失。
4. 不 reload，等待原页显示 Backtest terminal projection 和 Walk-Forward gate。
5. 点击 Walk-Forward，立即显示 scoped running，旧按钮消失。
6. 不 reload，等待原页显示：

```text
EVIDENCE READY
APPROVAL REQUIRED
```

7. lineage 中可见注册 Pipeline/Graph、Dataset、Profile/Plan、binding/job/evidence 和 version/fingerprint 摘要。
8. 不点击 Approval。

任何一步必须 reload 才能推进，则本项 FAIL。

### 8.2 reload recovery

在 v1 Evidence ready 后：

1. 直接 reload。
2. 恢复同一 actor、conversation、Draft v1 和 F4 卡片。
3. v1 terminal Evidence/lineage 与 reload 前一致。
4. 不重新创建 Draft，不重新运行任何 F4 action。
5. 页面不得残留临时 running，也不得回退到 pending/locked/loading。

### 8.3 同 Draft immutable v2

通过 Workbench 正常修改路径提出有效变更，例如“最大仓位调整为 5%”，然后 Apply：

1. 必须创建同一 Configuration Draft 的 immutable v2，而不是另一个 draft v1。
2. v2 显示精确 `parentVersionId + parentFingerprint`。
3. v1 内容、fingerprint、jobs 和 Evidence 保持不变且可读。
4. v1 显示 stale/read-only，不允许以旧 Evidence 授权 v2。
5. v2 不继承 v1 的 binding、jobs、Evidence ready 或 running。
6. v2 从自己的 Preflight 开始，并在原页独立完成 Backtest、Walk-Forward。
7. v2 最终显示 `EVIDENCE READY / APPROVAL REQUIRED`，仍不调用 Approval。

### 8.4 Web/API restart recovery

在 v1/v2 均存在后：

1. 由 Agent 受控停止本轮拥有的 `dev:paper` 进程。
2. 使用当前 HEAD 干净启动唯一 `npm run dev:paper`。
3. Chrome 保持同一受控 loopback actor 身份。
4. 恢复同一 conversation 和 Draft v1/v2。
5. v1 stale/read-only Evidence、v2 terminal Evidence、parent lineage 均保持正确。
6. 不串到其他 actor、conversation 或 Draft。
7. 不出现自动重跑 F4 action、Approval、Runtime 或交易副作用。

### 8.5 中英文、响应式和可访问性

由 Agent 在真实 Chrome 验证：

- 中文 1440×900：F4 卡片、running、lineage、v1/v2 历史无遮挡，无横向滚动；
- 英文 820×760：`scrollWidth === clientWidth === 820`，无横向滚动或按钮溢出；
- 键盘焦点清晰可见；
- running、locked、stale、ready、approval required 的文字不能只依赖颜色区分。

### 8.6 Console / Network

- 若 Chrome 控制能力支持，清空 Console 后 reload 并完成关键流程；TradeBot 页面 warning/error 必须为 0。
- Chrome 扩展自身 channel-close 错误必须与产品错误明确隔离，不得误写成产品 PASS 或 FAIL。
- 若 Network 能力可用，只报告 `method/path/status`，确认无意外 401/5xx；禁止输出 header、Cookie、Bearer、body 或敏感值。
- 工具确实不可用时写 `TOOL_UNAVAILABLE`，不得以 API、日志或人工替代。

---

## 9. F4 完成判定

只有以下全部 PASS 才能将 F4 标记为 `COMPLETE`：

- 确定并修复 reload 后 F4 卡片消失的根因；
- 新鲜 v1 原页完成 Preflight → Backtest → Walk-Forward；
- Backtest/Walk-Forward 均显示即时 scoped running，并在原页进入后续 gate；
- v1 reload 后完整恢复，不重跑 action；
- 同 Draft immutable v2 parent/reference 正确；
- v1 stale/read-only Evidence 保留；
- v2 不继承 v1 Evidence，并独立到达 Evidence ready；
- Web/API restart 后 v1/v2、lineage 和 Evidence 恢复；
- 中文 1440×900 与英文 820×760 通过；
- Console 无 TradeBot 页面错误；
- 全量自动化门禁通过并自然结束；
- 没有 Approval、Runtime、Simulation 或交易副作用。

若全部通过：

- 更新规划、路线图和交接文档，将 F4 标为 `COMPLETE`；
- 创建唯一编号 `LOOP-060`，进入 F5 Simulation V2；
- LOOP-060 必须继续明确浏览器要求，并固定最多三个 active Paper Deployment；
- 不得进入 M6 Live。

若任一项失败：

- F4 保持 `IN_PROGRESS`；
- 如实记录第一个失败点和真实证据；
- 创建唯一编号 `LOOP-060`，但只能继续 F4，不得进入 F5；
- 不得用 reload、人工验收或自动重跑把失败写成通过。

---

## 10. 文档与 Git 交付

必须更新：

- `docs/product-optimization-plan-and-progress.md`
- `docs/product-roadmap-and-progress.md`
- `docs/project-status-and-handoff.md`
- `docs/next-loop-prompt.md`
- 本 Loop Prompt 的结果/状态，或新建唯一编号 LOOP-060 Prompt。

同时清理当前路线图顶部仍残留的旧测试基线和旧 LOOP 编号，使权威摘要与实际最新状态一致；不要改写历史审计记录。

所有本轮代码、测试和文档修改必须：

1. `git diff --check` 通过；
2. 确认未包含 `data/local-paper-workspace*`、Secret、Token、Cookie 或运行数据；
3. 有意图明确地 commit 到 `main`；
4. push 到 `origin/main`；
5. 最终确认本地 HEAD 与 `origin/main` 一致。

即使 F4 未完成，只要产生修改，也必须 commit 并 push。不要创建 PR。

---

## 11. 最终回复模板

```text
Loop ID：LOOP-059
验收模式：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
浏览器要求：Agent 已使用真实 Chrome / FAIL（说明）

Reload recovery 根因：
Recovery 修复：PASS / FAIL
同 actor Conversation/Draft 恢复：PASS / FAIL
F4 exact-version projection 恢复：PASS / FAIL
临时 running 清理：PASS / FAIL

v1 原页 Evidence 链：PASS / FAIL
v1 reload recovery：PASS / FAIL
同 Draft immutable v2：PASS / FAIL
v1 stale/read-only：PASS / FAIL
v2 独立 Evidence：PASS / FAIL
Web/API restart recovery：PASS / FAIL

中文 1440×900：PASS / FAIL
英文 820×760：PASS / FAIL
Console：PASS / FAIL / TOOL_UNAVAILABLE
Network：PASS / FAIL / TOOL_UNAVAILABLE

Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
Approval/Runtime/Simulation/交易副作用：NONE
自动化：check；test:ts 最终 TAP；build:web；diff-check

F4：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-060（F5 / F4 continuation）
Git：commit；branch main；push PASS；PR 未创建
```
