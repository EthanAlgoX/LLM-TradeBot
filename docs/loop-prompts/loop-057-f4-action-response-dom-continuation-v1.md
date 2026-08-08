# LOOP-057 — F4 Action Authority 到可见 DOM 的确定性收尾

```text
Loop ID：LOOP-057
里程碑：F4 预上线检查与历史验证
验收模式：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
浏览器要求：必需；只能由 Agent 操作真实 Chrome，禁止人工或用户协助验收
当前基线：main / 7ed10e8；自动化 384/384 PASS
目标：证明并修复 Backtest/Walk-Forward authority 已持久化但当前页面仍显示旧 gate 的根因
Git：本轮所有修改必须 commit 并 push 到 main；不创建 PR
```

## 1. 已知事实

LOOP-056 已确认：

- Preflight 可以在当前页面即时更新；
- Backtest 与 Walk-Forward 的服务端结果可以成功持久化；
- reload 后可读到更新后的服务端 projection；
- 客户端已增加同一 immutable version 的最多三次有界 reconciliation；
- 自动化 384/384 通过；
- 但真实 Chrome 中 Backtest、Walk-Forward 仍不能稳定地在原页推进。

“history hydration 与 action 共用 epoch”只是已发现的一项风险，尚未被真实 Chrome 证明为完整根因。继续增加读取次数、延时或 reload 不构成修复。本轮必须用可复现的生命周期证据回答：**服务端最新 authority 在哪一个具体步骤没有成为当前可见 DOM，或者被哪一个具体的旧操作覆盖。**

## 2. 强制范围与安全边界

本轮只允许：

- F4 Preflight；
- Historical Backtest Evidence；
- Walk-Forward Evidence；
- Workbench 的只读 projection、恢复和 UI 修复。

严禁：

- Human Approval 或任何 Approval API；
- Approved Paper Plan；
- F5 Simulation Slot、模拟启动或模拟运行；
- Runtime Apply、Deployment、Live、Canary；
- account、position、order、fill 或 exchange write；
- 恢复 LOOP-025/M6；
- 直接修改 SQLite、伪造 Evidence 或硬编码 gate；
- 修改或提交 `data/local-paper-workspace*`；
- 人工浏览器验收、用户协助点击或人工 DevTools 交接。

全程必须保持：

```text
runtimeApplied=false
Paper Only
exchangeWriteAllowed=false
```

F4 未完成前不得进入 F5。

## 3. 执行前检查

1. 阅读 F4 规划、路线图、交接文档及 LOOP-054～LOOP-056。
2. 检查 `git status --short`、当前分支、HEAD 与 `origin/main`。
3. 保留用户已有修改，不回退、不覆盖无关工作。
4. 检查 5174/8787 的现有监听与进程归属，确认测试服务运行当前 HEAD。只能停止本轮明确启动的进程。
5. 记录当前自动化基线 384/384，不得降低既有覆盖。

## 4. 必须先取得的根因证据

为一次 action 建立不含敏感值的 DEV-only 生命周期 trace。可使用短 operation sequence、action、immutable `versionId`、projection digest、binding revision、gate/nextAction 和 render sequence；禁止记录 token、cookie、secret、完整 prompt 或数据内容。

必须追踪同一次点击的完整顺序：

```text
button bound
→ handler invoked
→ POST started/completed
→ POST projection received
→ exact-version merge completed
→ render requested/completed
→ visible DOM digest
→ reconciliation GET started/completed
→ authority merge completed
→ final render requested/completed
→ new button rebound
→ visible DOM digest
→ any later hydration/merge/render
```

逐项回答并保留可复现证据：

1. Backtest/Walk-Forward handler 是否恰好触发一次；
2. `data-f4-draft` 与 `data-f4-action` 在点击前是否属于正确 immutable version/action；
3. POST 和每次 GET 返回的 gate、binding revision、`nextAction` 是否不同；
4. merge 后 `state.realWorkbenchTurns` 中是否存在目标 version，以及是否出现重复 version entry；
5. `renderWorkbenchF4Evidence()` 收到的是旧 projection 还是新 projection；
6. render 生成的 HTML 是否已包含目标 gate 和后续按钮；
7. render 后真实 DOM 是否包含同样内容；
8. 如果 state/HTML 正确而 DOM 错误，是哪个后续 render 覆盖；
9. 如果 state 已被覆盖，是哪个 hydration/action response、哪个 version、哪个 sequence 写入；
10. 页面 locale、view、history hydration、Apply hydration、身份 hydration 或其他异步入口是否在 action 期间触发；
11. 旧 history 是否携带较旧 projection，却在 action 完成后重新替换整个 `realWorkbenchTurns`；
12. action render 后绑定的新按钮是否因旧闭包、重复 listener 或 DOM replacement 失效；
13. 三次 reconciliation 是否在服务端 runner 的真实状态机中有意义，还是只是重复读取同一已终态 authority；
14. 是否存在多个本地 Web/API 进程、旧 build 或 HMR 状态造成代码与页面不一致。

根因报告必须指向具体函数、状态写入点和事件顺序。不得只写“race condition”“Chrome 缓存”“可能是 epoch”或“偶发”。

## 5. 修复原则

根据已证明的根因做最小修复，并满足：

- 服务端 exact immutable version projection 继续是唯一 authority；
- history hydration 与 F4 action 必须有明确的所有权和排序规则；
- 不同 version 可以并发读取，但任何旧操作都不能覆盖同 version 的较新 authority；
- 不得依靠数组下标、当前卡片位置或“最后一条 Turn”定位 Draft；
- 若需要 operation token，应按 exact version/action 管理，不应用一个脆弱的全局 epoch 取消所有工作；
- 若 projection 有 binding revision/version，合并必须单调；如果没有 revision，应使用受控 operation ordering，不凭客户端时间猜测服务端新旧；
- history hydration 可以补充 Turn，但不能用旧 F4 projection 回滚刚完成的 action；
- action 成功后必须在当前页面明确显示 running/succeeded/failed/timeout，错误不得静默；
- reconciliation 必须有界、可取消并仅绑定一个 immutable version；不要继续盲目增加次数或等待时间；
- 每次 authority 变化只进行必要 render；不得形成 fetch/render 循环；
- render 后的新按钮只绑定一次，重复点击继续由既有幂等机制保护；
- 不使用 `location.reload()`、路由跳转、整页定时刷新、本地硬编码成功状态或第二份 shadow authority；
- 不改变 F3、F5、M4/M5/M6 或交易安全链。

如果当前 `main.ts` 中全局 state、全局 epoch 和 DOM handler 难以可靠测试，可以只提取一个小型的 F4 action coordinator/state reducer。不要引入新的前端框架或重写整个页面。

提交前删除临时诊断输出；确有长期价值的 DEV trace 必须默认关闭、无敏感信息且有测试。

## 6. 自动化测试要求

现有纯 helper 测试只证明 reconciliation 返回值，不足以证明可见 DOM。必须新增至少一个覆盖 `action → merge → render output` 的集成级测试，并覆盖：

1. Backtest 完成后同一页面模型立即从 Backtest gate 推进到 Walk-Forward；
2. Walk-Forward 完成后立即显示 `EVIDENCE READY / APPROVAL REQUIRED`；
3. POST 后旧 history 到达，不能回滚目标 version；
4. history 先到、POST 后到；POST 先到、GET 后到；GET 先到、旧 history 后到等交错顺序；
5. 同 Draft v1/v2 的 action/projection 不交叉；
6. 其他 Draft 的 hydration 不影响当前 action；
7. 目标 version 在 history 中顺序变化或存在 legacy Turn 时仍精确更新；
8. render 后新 action 控件存在且只绑定一次；
9. terminal、running、failed、timeout 均有确定的可见状态；
10. 无界轮询和 render/fetch 自循环不可能发生；
11. reload/restart 从服务端恢复同一最终 projection；
12. legacy `PROVENANCE_UNAVAILABLE` 继续只读隔离；
13. Approval、Runtime、Simulation、account/order/fill 均无副作用。

测试应验证公开状态/HTML/行为，不要只断言私有函数被调用。如果需要 DOM 环境，使用项目现有测试能力或提取纯 render coordinator；不要为此引入重量级依赖。

## 7. 自动化门禁

必须依次执行：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

要求：

- `test:ts` 必须自然退出；
- 必须记录最终 TAP 汇总，不得只报告中途子测试数量；
- 新测试数量应高于 384，除非能说明测试合并而非覆盖减少；
- 不得跳过既有测试。

## 8. Agent 真实 Chrome 验收

浏览器验收为必需项，只能由 Agent 操作真实 Chrome。禁止人工或用户协助；API、服务日志和单元测试不能替代 UI 证据。

以当前 HEAD 受控重启 `npm run dev:paper`，确认页面加载的是本轮代码。通过正常产品生命周期创建一条新鲜 Workbench 策略，不直接写数据库。

### 8.1 原页连续动作——禁止 reload

在同一页面、同一 v1 Draft 卡片中：

1. 点击 Preflight，原页显示 passed，并出现 Backtest；
2. 点击 Backtest，原页在有界时间内显示 succeeded，并出现 Walk-Forward；
3. 点击 Walk-Forward，原页在有界时间内显示 succeeded；
4. 显示 `EVIDENCE READY / APPROVAL REQUIRED`；
5. 三步之间不得 reload、切换页面、切换语言或重新打开 Workbench；
6. 不得点击 Approval。

同时确认：

- 每个 action 只提交一次；
- 当前卡片 version/fingerprint 未变化；
- gate、binding revision、job/evidence lineage 与当前 v1 一致；
- 没有 `F4_RECONCILIATION_TIMEOUT` 或静默错误。

任一步必须 reload 才可见，则本项 FAIL，F4 不得完成。

### 8.2 同 Draft immutable v2

1. 使用正常对话修改已验证策略，例如将最大仓位改为 5%；
2. Apply 后必须追加同一 Configuration Draft 的 immutable v2；
3. v2 的 parent version/fingerprint 精确指向 v1，v1 保持不变；
4. v1 Evidence 保持可读但 stale/read-only，不恢复 authorization；
5. v2 不继承 v1 binding、jobs、artifacts 或 ready；
6. 在 v2 原页连续完成 Preflight → Backtest → Walk-Forward；
7. v2 到达 Evidence ready，v1/v2 projection 不交叉。

### 8.3 恢复、尺寸和控制台

1. reload 后 v1/v2、stale、parent lineage、Evidence 与终态一致；
2. 受控 Web/API restart 后，同 actor 恢复相同事实；
3. 中文 1440×900：无横向滚动、无遮挡、状态与按钮清晰；
4. 英文 820×760：`scrollWidth === clientWidth`、无遮挡、键盘焦点可见；
5. Console 清空并刷新后，TradeBot 页面 warning/error 为 0；扩展自身 channel-close 单独记录；
6. Network 能力可用时只报告 method/path/status；不可用时如实记录 `TOOL_UNAVAILABLE`，不得伪造；
7. 页面持续显示 Paper Only、`runtimeApplied=false`、`exchangeWriteAllowed=false`。

## 9. F4 完成判定

只有以下全部 PASS 才能将 F4 标记为 `COMPLETE`：

- 已证明具体根因并有回归测试；
- v1 和 v2 的 Backtest/Walk-Forward 都能在原页即时推进；
- v1 stale/read-only 与 v2 不继承/独立 Evidence 通过；
- reload 与 Web/API restart recovery 通过；
- 中英文双尺寸和 Console 通过；
- 所有自动化门禁通过；
- 无 Approval、Runtime、Simulation 或交易副作用。

若全部通过：

- 更新规划、路线图和交接文档，将 F4 标为 `COMPLETE`；
- 创建唯一编号 `LOOP-058`，进入 F5 Simulation V2；
- 更新 `docs/next-loop-prompt.md`。

若任何一项失败：

- F4 保持 `IN_PROGRESS`；
- 记录准确根因、复现路径和最小剩余缺口；
- 创建唯一编号 `LOOP-058`，但只能继续 F4，不得进入 F5。

## 10. Git 与文档要求

1. 更新：
   - `docs/product-optimization-plan-and-progress.md`
   - `docs/product-roadmap-and-progress.md`
   - `docs/project-status-and-handoff.md`
   - `docs/next-loop-prompt.md`
2. 创建唯一编号的 LOOP-058 Prompt，不覆盖旧 Prompt。
3. 检查提交范围，不包含 `data/local-paper-workspace*` 或无关文件。
4. `git diff --check` 通过后提交到 `main`。
5. push 到 `origin/main` 并核对本地 HEAD 与远端一致。
6. 不创建 PR。

即使 F4 未完成，只要产生代码、测试或交接修改，也必须 commit 并 push。

## 11. 最终回复模板

```text
Loop ID：LOOP-057
验收模式：DIAGNOSE_FIX_AND_AGENT_CHROME_VERIFY
浏览器要求：Agent 已使用真实 Chrome / FAIL（原因）

确定的 DOM/authority 根因：
生命周期证据：PASS / FAIL（摘要）
Backtest 原页即时推进：PASS / FAIL
Walk-Forward 原页即时推进：PASS / FAIL
EVIDENCE READY / APPROVAL REQUIRED：PASS / FAIL
同 Draft immutable v2：PASS / FAIL
v1 stale/read-only lineage：PASS / FAIL
v2 不继承 v1 Evidence：PASS / FAIL
v2 原页独立 Evidence 链：PASS / FAIL
reload recovery：PASS / FAIL
Web/API restart recovery：PASS / FAIL
中文 1440×900：PASS / FAIL
英文 820×760：PASS / FAIL
Console：PASS / FAIL / TOOL_UNAVAILABLE
Network：PASS / FAIL / TOOL_UNAVAILABLE
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
Approval/Runtime/Simulation/交易副作用：NONE / FAIL（说明）
自动化：check；test:ts 最终 TAP；build:web；diff-check
F4：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-058（F5 / F4 continuation）
Git：commit；branch main；push PASS/FAIL；PR 未创建
```
