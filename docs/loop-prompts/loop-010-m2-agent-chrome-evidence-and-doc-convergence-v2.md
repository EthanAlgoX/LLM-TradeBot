# LOOP-010 — M2 Agent Chrome 验收与规划文档收敛 V2

```text
Loop ID：LOOP-010
里程碑：M2 数据中心 V1 最终收尾
状态：PARTIAL
前置 Loop：LOOP-009（PARTIAL）
执行环境：本地仓库 + Agent 直接控制真实 Chrome
浏览器要求：必需；只接受 Agent Chrome 验证，禁止用户手工验收
验收模式：AGENT_CHROME_VERIFIED
```

## 实际执行结果（2026-08-02）

- 完成 P0 根因修复：数据中心不再因 MutationObserver 监听自身 `innerHTML` 更新而形成无限 render/load。
- 新增 host identity 有界挂载、离页请求取消及生命周期回归测试；自动化为 329/329 PASS，Web build 为 35 modules。
- 独立浏览器性能冒烟通过：Renderer 由约 89% CPU/3.6GB RSS 降至约 0.2% CPU/212MB RSS；1440×900、820×760 无横向溢出，两个资产可见，Console error=0，Data Assets 请求稳定。
- 该性能冒烟不替代本 Prompt 要求的完整 Agent Chrome CSV 正向绑定、刷新恢复和 Network 证据，因此 M2 保持 `IN_PROGRESS`。
- 修复已提交并推送：`7f2017180cc1b15b660e5a66d0ec80b729c8497b`，`main` 与 `origin/main` 同步。
- 用户要求创建下一唯一编号执行 Prompt；后续进入 LOOP-011（仍为 M2，不进入 M3）。

## 用户最新授权与强制要求

- Agent 可以直接操作真实 Chrome，完成本地 TradeBot 页面中的非敏感验收操作。
- 禁止要求用户手工点击、调整窗口、打开 DevTools、提供截图或填写 PASS/FAIL。
- 禁止将用户口头反馈、截图交接、其他浏览器、服务端日志、直接 API 调用或自动化测试冒充真实 Chrome UI 证据。
- 不得读取、复制或输出 Token、Authorization、Cookie value、Storage value、请求载荷或响应正文。

## 目标

由 Agent 直接控制真实 Chrome，完成 M2 唯一剩余的 UI、响应式、绑定恢复及 Console/Network 验收。全部通过后关闭 M2、收敛规划文档中的过期快照，并生成唯一编号 LOOP-011（M3 实验场 V1）。

## 当前事实

- M2 服务端资产目录、Dataset version/fingerprint binding、Validation fail-closed、Evidence lineage 和 Market Radar 真实性已经由代码与自动化验证。
- `http://127.0.0.1:5174/#data-center` 最近一次检查可达。
- 已定位并修复数据中心 `MutationObserver -> render -> innerHTML mutation` 自循环；修复前独立 Chrome Renderer 约 89% CPU/3.6GB RSS，修复后约 0.2% CPU/212MB RSS，页面 snapshot/eval 恢复。
- 独立浏览器性能冒烟已确认 1440×900 与 820×760 无横向溢出、两个资产可见、Console 无 error，Data Assets 请求不再持续增长；该冒烟只证明卡死缺陷已修复，不替代本 Loop 要求的完整 Agent Chrome 绑定/恢复与 Network 验收。
- 最新自动化基线：`npm run check` PASS、`npm run test:ts` 329/329 PASS、`npm run build:web` PASS（35 modules）、`git diff --check` PASS。
- Git 工作区最近一次报告为干净，`main` 与 `origin/main` 同步。
- Runtime 安全边界保持：`runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

## 开始前

1. 完整读取：
   - `docs/product-optimization-plan-and-progress.md`
   - `docs/product-roadmap-and-progress.md`
   - `docs/project-status-and-handoff.md`
   - `docs/next-loop-prompt.md`
   - 本 Prompt
2. 只读检查 Git 状态、当前分支和本地服务。页面不可达时才启动单一 `npm run dev:paper`；8787 或 5174 已由正确服务占用时，不终止、不替换该进程。
3. 使用会话提供的正式 Chrome 控制能力连接真实 Google Chrome。连接或导航失败时先按该能力的官方排障流程处理；不得改用用户手工、内置浏览器、独立 Playwright、AppleScript 或其他替代证据。

## 必须由 Agent 在真实 Chrome 完成

### 1. 中文桌面验收

- 打开 `http://127.0.0.1:5174/#data-center`。
- 设置 viewport 为 1440×900并切换中文。
- 通过可见页面和只读布局尺寸检查确认：无横向滚动、关键内容无遮挡、关键控件可操作。

### 2. 资产真实性

- Binance Public 显示 public capability。
- 没有登记实时 Snapshot 时不得显示伪造市场数据，并明确显示 `unavailable`。
- CSV Historical 显示真实 Snapshot、Schema、Quality、Lineage、Dataset version 和 fingerprint。

### 3. CSV 正向 UI 绑定与恢复

- 只能通过真实可见 UI 创建或选择当前 actor 的 Market/Agent Configuration Draft。
- 通过 UI 将 CSV Historical 绑定到该 Draft；确认页面显示 Draft version 与 Dataset fingerprint。
- 刷新页面并返回同一 Draft，确认绑定仍存在，version/fingerprint 未漂移。
- 不得以直接 API、服务端日志或测试替代正向 UI 绑定。

### 4. 送入编排与 Runtime 安全

- 通过可见 UI 执行“送入编排”。
- 确认只创建 Draft/意图，没有启动 Paper Run。
- 确认 `runtimeApplied=false`、Paper Only、Exchange writes OFF。

### 5. 英文窄屏验收

- 设置 viewport 为 820×760并切换 English。
- 确认无横向滚动、关键内容无遮挡、关键控件可操作。

### 6. Chrome Console 与 Network

- 清空 Console 后刷新，确认没有 TradeBot 页面 error。
- 在真实 Chrome Network 记录中确认相关请求无意外 401/5xx。
- 最终报告只允许出现非敏感 `method path status` 和错误摘要，不得读取或输出 Header value、payload、response body、Token、Cookie 或 Storage value。

### 7. 负向 fail-closed

- 跨 actor、缺失资产、错误 fingerprint 和 capability mismatch 可复核现有自动化，不要求在 UI 构造攻击输入。
- 负向自动化不能替代第 3 项正向 UI 绑定。

## 超时与失败处理

1. Chrome 控制中断时，保留已取得且可复核的证据，按官方流程重连或重新认领目标标签页；不要重复盲目调用同一失败动作。
2. 如果当前执行环境最终无法控制真实 Chrome：LOOP-010 保持 `IN_PROGRESS`，M2 不关闭；禁止转人工、禁止生成 M3 Prompt、禁止把未观察项写成产品 FAIL。
3. 如果发现真实产品缺陷：在本 Loop 做最小修复、补充自动化，并由 Agent 重新执行受影响的 Chrome 项；不得要求用户复验。
4. 只有全部 Chrome 项取得 Agent 可复核证据后，才能继续关闭流程。

## 全部通过后的文档收敛

1. 将验收模式记录为 `AGENT_CHROME_VERIFIED`，把 LOOP-010 和 M2 标为 `COMPLETE`。
2. 更新路线图顶部日期与本轮真实验证基线，Web build modules/time 使用本轮实测结果。
3. 删除或改写“当前浏览器列表为空”等已过期当前态描述。
4. 明确旧路线图 M0～M11 是历史架构阶段；当前产品执行里程碑以优化规划 M0～M7 为准。
5. 替换已经完成的旧“接下来三个 Loop”和旧 M2 实施指令；保留 LOOP-006～009 为历史 `PARTIAL` 事实。
6. 创建唯一编号 LOOP-011（M3 实验场 V1），并在新 Prompt 中明确标注“浏览器要求：实现后必需；只接受 Agent 浏览器验证”。
7. 更新 `docs/next-loop-prompt.md` 指向 LOOP-011。

## 自动化与安全边界

- 最终修改完成后运行：`npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check`。
- 唯一动作链保持 `Decision -> Portfolio -> Risk -> Execution`。
- Dataset Binding、“送入编排”和页面切换不得启动 Paper Run、修改 Runtime 或产生交易所写入。
- 保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。
- 禁止 `reset`、`checkout`、`clean` 等破坏性 Git 操作。
- 不修改、暂存或提交 `data/local-paper-workspace*`、数据库、Token、Secret、环境凭据或本地运行产物。

## Git 快照要求

- 代码或文档发生任何修改后，最终报告前必须创建范围明确的 commit，并 push 当前分支到 `origin`；即使 M2 仍为 `IN_PROGRESS` 也不例外。
- 提交前检查 staged diff，确保只有本轮代码、测试和文档。
- push 后验证远端 branch ref 等于本地 HEAD；报告 commit hash、branch 和 push 结果。
- 若 push 因认证失败，保留本地 commit 并报告精确阻塞；认证恢复后优先完成 push。
- 不创建 PR，除非用户明确要求。

## 最终报告格式

```text
Loop ID：LOOP-010
验收模式：AGENT_CHROME_VERIFIED / IN_PROGRESS
浏览器要求：必需；Agent 已使用真实 Chrome / Chrome 控制未完成
中文 1440×900：PASS / NOT VERIFIED
英文 820×760：PASS / NOT VERIFIED
资产真实性标签：PASS / NOT VERIFIED
CSV 正向 UI 绑定与刷新恢复：PASS / NOT VERIFIED
负向 fail-closed：PASS / FAIL
Console / Network：PASS / NOT VERIFIED
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false / NOT VERIFIED
文档收敛：PASS / NOT RUN
自动化：check；test:ts x/x；build:web；diff-check
M2：COMPLETE / IN_PROGRESS
下一 Loop：唯一编号及所属里程碑 / 未生成
Git：commit <hash>；branch <name>；push PASS / FAIL；未创建 PR
```
