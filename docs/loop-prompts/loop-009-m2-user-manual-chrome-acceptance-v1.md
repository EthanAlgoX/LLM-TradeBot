# LOOP-009 — M2 数据中心 V1 用户手工 Chrome 验收

```text
Loop ID：LOOP-009
里程碑：M2 数据中心 V1 收尾
状态：PARTIAL
前置 Loop：LOOP-008（PARTIAL）
执行环境：本地仓库 + 用户真实 Chrome
浏览器要求：必需
推荐执行端：Chrome ChatGPT
验收主路径：USER_MANUAL_CHROME_VERIFIED
```

## 实际执行结果（2026-08-01）

- 服务检查通过，`http://127.0.0.1:5174/#data-center` 可达。
- 执行窗口仍尝试了 Agent Chrome 控制；页面能够打开，但控制会话在设置 1440×900 和读取页面结构时超时，重连后的新受控标签页再次超时，最终 Chrome 不可用。
- 中文/英文响应式、资产标签、CSV UI 绑定与刷新恢复、送入编排、Console 和 Network 均为“未取得证据”，不代表发现产品缺陷。
- 未读取或暴露敏感值，未修改代码、文档或 `data/local-paper-workspace*`。
- LOOP-009 为 `PARTIAL`，M2 保持 `IN_PROGRESS`；下一步执行 LOOP-010，浏览器证据必须完全由用户手工 Chrome 反馈提供，Agent 禁止再次调用浏览器控制。

## 目标

关闭 M2 唯一剩余的真实 Chrome 验收。LOOP-006～008 已证明 Agent 的 Chrome 控制通道不稳定，因此本轮不再把自动控制当作前置条件，也不因控制通道不可用直接结束。Agent 必须先向用户发送下面的可复制验收表，等待用户在真实 Chrome 中逐项操作并回复；收到反馈后，仍在同一 Loop 内记录证据、处理问题并决定 M2 状态。

## 已验证事实

- M2 服务端资产目录、Dataset version/fingerprint binding、Validation fail-closed、Evidence lineage 与 Market Radar 真实性已由代码和自动化验证。
- 最新完整自动化基线：`npm run check` PASS、`npm run test:ts` 328/328 PASS、`npm run build:web` PASS、`git diff --check` PASS。
- LOOP-008 未完成 Chrome 可见验收；不得继承或猜测 PASS。
- Runtime 安全边界必须保持：`runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

## 阶段 A：必须先向用户交接并等待

1. 只做只读服务检查。若 `http://127.0.0.1:5174/#data-center` 不可达，再启动单一 `npm run dev:paper`；端口已由既有正确进程占用时，不终止、不替换该进程。
2. 不要求 Agent 再次连接或控制 Chrome。直接把“用户回复模板”原样发给用户，请用户在真实 Chrome 中完成操作。
3. 发出模板后必须等待用户回复；不得把“正在等待用户”记为 `PARTIAL`，不得创建 LOOP-010，也不得进入 M3。
4. 不要求用户提供 Token、Authorization、Cookie value、payload、response body 或任何敏感值；截图如含敏感内容，必须先让用户遮盖。

### 用户操作步骤

1. 在真实 Chrome 打开 `http://127.0.0.1:5174/#data-center`，窗口设为 1440×900，切换中文，确认没有横向滚动、关键内容遮挡或不可操作控件。
2. 在数据中心确认：Binance Public 显示 public capability；没有伪造实时 Snapshot；状态为 `unavailable`。CSV Historical 显示 Snapshot、Schema、Quality、Lineage、Dataset version 与 fingerprint。
3. 通过可见 UI 创建或选择当前 actor 的 Market/Agent Configuration Draft，绑定 CSV Historical；刷新页面后回到同一 Draft，确认绑定仍存在，version/fingerprint 与刷新前一致。
4. 点击“送入编排”，确认只创建 Draft/意图，没有启动 Paper Run；页面仍显示 `runtimeApplied=false`、Paper Only、Exchange writes OFF。
5. 将窗口改为 820×760，切换 English，确认没有横向滚动、关键内容遮挡或不可操作控件。
6. 打开 DevTools：清空 Console 后刷新，确认没有 TradeBot 页面 error；Network 只检查相关请求的 method/path/status，确认无意外 401/5xx。不要打开、复制或回复 Header value、payload、response body。

### 用户回复模板

```text
LOOP-009 Chrome 手工验收
中文 1440×900：PASS / FAIL（问题：）
Binance Public 真实性标签：PASS / FAIL（问题：）
CSV 资产详情：PASS / FAIL（问题：）
CSV UI 绑定：PASS / FAIL（Draft version：可见/不可见；fingerprint：稳定/不稳定；问题：）
刷新恢复：PASS / FAIL（问题：）
送入编排与 Runtime safety：PASS / FAIL（runtimeApplied=false；Paper Only；Exchange writes OFF；问题：）
英文 820×760：PASS / FAIL（问题：）
Console：PASS / FAIL（仅错误摘要：）
Network：PASS / FAIL（仅 method/path/status：）
敏感值暴露：NO
```

## 阶段 B：收到用户反馈后完成同一 Loop

1. 将用户明确反馈视为 `USER_MANUAL_CHROME_VERIFIED` 证据；不以 Agent 无法读取 Chrome 面板为由否定用户手工结果。
2. 对代码已覆盖的负向 fail-closed 场景，复核既有自动化即可；不要求用户在 UI 制造跨 actor、错误 fingerprint 或 capability mismatch。
3. 如果所有项目 PASS：将 LOOP-009 和 M2 标为 `COMPLETE`，更新三份规划/交接文档，创建唯一编号 LOOP-010（M3 实验场 V1），并更新 `docs/next-loop-prompt.md`。
4. 如果发现真实产品缺陷：在本轮做最小修复，完成自动化后请用户只复验失败项；不得在复验前结束本轮或另开内容相同的 Loop。
5. 只有用户明确无法继续手工验收，或真实缺陷在本轮无法安全修复时，才可保持 `PARTIAL`；此时创建唯一编号 LOOP-010 继续 M2，不得进入 M3。

## 自动化与安全约束

- 文档或代码修改完成后运行：`npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check`。
- 页面切换、Dataset Binding 与“送入编排”不得触发 Runtime Apply、Paper Run 或交易所写入。
- 禁止 `reset`、`checkout`、`clean` 等破坏性 Git 操作。
- 不修改、暂存或提交 `data/local-paper-workspace*`、数据库、Token、Secret、环境凭据或其他运行时本地数据。

## Git 快照要求

- 对代码或文档产生任何修改后，最终报告前必须创建范围明确的 commit，并将当前分支 push 到 `origin`；即使结果为 `PARTIAL` 也不例外。
- 提交前检查 staged diff，只包含本轮项目代码、测试和文档。
- 如果 push 因认证失败，保留本地 commit，报告精确错误并要求用户恢复 GitHub 认证；认证恢复后必须优先完成 push，不能把 `push FAIL` 当作本轮正常完成状态。
- 不创建 PR，除非用户另行明确要求。

## 最终报告格式

```text
Loop ID：LOOP-009
验收模式：USER_MANUAL_CHROME_VERIFIED / PARTIAL
浏览器要求：必需；用户已使用真实 Chrome / 未完成
中文 1440×900：PASS / FAIL
英文 820×760：PASS / FAIL
资产真实性标签：PASS / FAIL
CSV 正向 UI 绑定与刷新恢复：PASS / FAIL
负向 fail-closed：PASS / FAIL
Console / Network：PASS / FAIL
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
自动化：check；test:ts x/x；build:web；diff-check
M2：COMPLETE / IN_PROGRESS
下一 Loop：唯一编号及所属里程碑
Git：commit <hash>；branch <name>；push PASS / FAIL；未创建 PR
```
