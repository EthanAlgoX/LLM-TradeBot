# LOOP-011 — M2 修复后 Agent Chrome 最终验收

```text
Loop ID：LOOP-011
里程碑：M2 数据中心 V1 最终收尾
状态：PARTIAL
前置 Loop：LOOP-010（PARTIAL，P0 卡死修复已完成）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome
浏览器要求：必需；只接受 Agent Chrome 验证，禁止用户手工验收
验收模式：AGENT_CHROME_VERIFIED
```

## 实际执行结果（2026-08-02）

- Agent 已使用真实 Chrome；性能护栏、中文 1440×900、英文 820×760、资产真实性标签均通过。
- 修复了 1440px 顶栏 25px 横向溢出，提交并推送为 `cfe074724a5837872011b5c7eeab865c4a0fc562`。
- 负向 fail-closed 与自动化通过：check、329/329 tests、35-module Web build、diff-check。
- CSV 正向 UI 绑定与刷新恢复未验证：真实产品缺少 `tradebot:orchestration-data-intent` 的 UI 消费者；“送入编排”目前只导航，不能执行或展示 Dataset Binding。
- Console 未见 TradeBot 页面错误；Chrome 控制能力未提供 Network 读取接口，Network 保持未验证。
- M2 保持 `IN_PROGRESS`，文档未收敛，下一步执行 LOOP-012 补齐绑定闭环后再做 Agent Chrome 验收。

## 目标

在 P0 数据中心无限渲染修复后，由 Agent 直接使用真实 Chrome 完成 M2 尚缺的完整可见验收：资产真实性、CSV 正向 UI 绑定、刷新恢复、Runtime 隔离、桌面/窄屏响应式及 Console/Network。全部通过后关闭 M2、收敛规划文档并生成唯一编号 LOOP-012（M3 实验场 V1）。

## 强制边界

- Agent 已获授权直接操作本地 TradeBot 页面中的非敏感 UI。
- 禁止要求用户点击、调整窗口、打开 DevTools、截图或口头确认。
- 禁止用内置浏览器、独立 Playwright、API、服务端日志或自动化测试替代本 Loop 的真实 Chrome UI 证据。
- 自动化只可支持负向 fail-closed 和代码回归结论，不能替代正向 UI 工作流。
- 不得读取、复制或输出 Token、Authorization、Cookie/Storage value、请求载荷或响应正文。
- 全程保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

## 已验证基线

- P0 修复提交：`7f2017180cc1b15b660e5a66d0ec80b729c8497b`。
- 数据中心挂载已按 host identity 去重，离开页面会取消在途请求。
- 自动化：check PASS、test:ts 329/329 PASS、build:web PASS（35 modules）、diff-check PASS。
- 独立性能冒烟：数据中心可 snapshot/eval；Renderer 约 0.2% CPU/212MB RSS；Data Assets 请求不再持续增长；1440×900、820×760 无横向溢出；Console error=0。
- 以上性能冒烟不是本轮完整验收证据，必须重新使用真实 Chrome 完成以下步骤。

## 开始前

1. 完整阅读：
   - `docs/product-optimization-plan-and-progress.md`
   - `docs/product-roadmap-and-progress.md`
   - `docs/project-status-and-handoff.md`
   - `docs/next-loop-prompt.md`
   - 本 Prompt
2. 检查 `git status --short --branch`，保留用户既有修改；禁止 reset、checkout、clean。
3. 检查 `http://127.0.0.1:5174/#data-center` 和 API 是否可达。不可达时才启动单一 `npm run dev:paper`；正确进程已占用 5174/8787 时不得终止或替换。
4. 使用会话提供的正式 Chrome 控制能力连接真实 Google Chrome。失败时按该能力官方排障流程处理，不得切换到人工或其他浏览器。

## 必须完成的 Agent Chrome 验收

### 1. 中文 1440×900 与性能护栏

- 打开 `http://127.0.0.1:5174/#data-center`，设置 viewport 为 1440×900并切换中文。
- 确认页面可在合理时间内读取 DOM、截图和交互，不再出现持续超时。
- 确认 `scrollWidth === clientWidth`，无横向滚动、关键内容无遮挡、关键控件可操作。
- 观察 Data Assets 请求：初始挂载/必要重载后必须稳定，不得持续增长或形成请求风暴。

### 2. 资产真实性

- Binance Public 显示 public capability。
- 未登记实时 Snapshot 时显示 `unavailable`，不得展示伪造 Regime、Mover、Volume、Funding/OI。
- CSV Historical 显示 Snapshot、Schema、Quality、Lineage、Dataset version 和 fingerprint。
- 页面明确显示 `runtimeApplied=false`。

### 3. CSV 正向 UI 绑定

- 只能通过真实可见 UI 创建或选择当前 actor 的 Market/Agent Configuration Draft。
- 从数据中心经“送入编排”进入受控编排意图。
- 通过 UI 将 CSV Historical 绑定至该 Draft。
- 确认页面显示新的不可变 Draft version、Dataset version 和 fingerprint。
- 不得用 POST API 或服务端日志替代这一正向 UI 路径。

### 4. 刷新恢复与指纹稳定

- 记录非敏感的 Draft version 是否可见、fingerprint 是否存在；不得复制完整敏感请求内容。
- 刷新页面，返回同一 Draft。
- 确认 CSV binding 仍存在，Dataset version/fingerprint 与刷新前一致，没有重复创建版本。

### 5. Runtime 安全

- 确认“送入编排”和 Dataset Binding 只产生 Draft/意图。
- 确认没有启动 Paper Run，没有 Runtime Apply，没有交易所写入。
- 页面保持 `runtimeApplied=false`、Paper Only、Exchange writes OFF。

### 6. 英文 820×760

- 切换 English，设置 viewport 为 820×760。
- 确认 `scrollWidth === clientWidth`，无横向滚动、关键内容无遮挡、关键控件可操作。
- 确认资产、绑定与 Runtime safety 状态仍可读。

### 7. Console 与 Network

- 清空 Chrome Console 后刷新，确认没有 TradeBot 页面 error。
- 在真实 Chrome Network 中确认相关请求无意外 401/5xx。
- 确认 Data Assets 请求数量稳定，不因 DOM 变更重复增长。
- 最终报告只记录非敏感 `method path status` 和错误摘要；禁止读取或输出 headers value、payload、response body、Token、Cookie 或 Storage value。

### 8. 负向 fail-closed

- 复核现有自动化对跨 actor、缺失资产、错误 fingerprint、capability mismatch 的覆盖。
- 若覆盖仍存在且通过，可记录 PASS；不要求在 UI 构造攻击输入。

## 失败处理

1. Chrome 控制中断时按官方流程重连或重新认领标签页，保留已经取得的非敏感证据；不要盲目重复相同失败动作。
2. 如果最终无法控制真实 Chrome：LOOP-011 保持 `IN_PROGRESS`，M2 不关闭；禁止人工验收、禁止进入 M3、禁止把 `NOT VERIFIED` 写成产品 FAIL。
3. 如果发现真实产品缺陷：在本 Loop 做最小修复并补测试，由 Agent 重新执行受影响的 Chrome 步骤；不得要求用户复验。

## 全部通过后的关闭动作

1. 将 LOOP-011 和 M2 标为 `COMPLETE`，验收模式记录为 `AGENT_CHROME_VERIFIED`。
2. 收敛规划文档中的过期快照：
   - 更新顶部日期和本轮真实测试/build 基线；
   - 删除或改写“浏览器列表为空”“DOM 仍超时”等过期当前态；
   - 明确旧路线图 M0～M11 为历史架构阶段，当前产品里程碑以优化规划 M0～M7 为准；
   - 替换旧“接下来三个 Loop”和旧 M2 实施指令；
   - 保留 LOOP-006～010 的历史 `PARTIAL` 事实。
3. 创建唯一编号 LOOP-012（M3 实验场 V1），明确“浏览器要求：实现后必需；只接受 Agent 浏览器验证”。
4. 更新 `docs/next-loop-prompt.md` 指向 LOOP-012。

## 自动化与 Git

- 最终运行：`npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check`。
- 代码或文档有任何修改时，最终报告前必须创建范围明确的 commit 并 push 当前分支到 `origin`；即使仍为 `IN_PROGRESS` 也不例外。
- 提交前检查 staged diff，不包含 `data/local-paper-workspace*`、数据库、Token、Secret、环境凭据或浏览器产物。
- push 后验证远端 branch ref 等于本地 HEAD。
- 不创建 PR，除非用户明确要求。

## 最终报告格式

```text
Loop ID：LOOP-011
验收模式：AGENT_CHROME_VERIFIED / IN_PROGRESS
浏览器要求：必需；Agent 已使用真实 Chrome / Chrome 控制未完成
性能护栏：PASS / NOT VERIFIED
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
