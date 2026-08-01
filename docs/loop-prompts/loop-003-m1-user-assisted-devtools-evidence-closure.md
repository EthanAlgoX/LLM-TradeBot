# LOOP-003 — M1 用户辅助 DevTools 证据收尾

```text
Loop ID：LOOP-003
里程碑：M1 历史对话 V1
状态：PARTIAL
前置 Loop：LOOP-002（PARTIAL）
执行环境：Chrome 浏览器中的 ChatGPT + 用户辅助操作真实 Chrome DevTools
浏览器要求：必需
推荐执行端：Chrome ChatGPT
用户辅助交接：必需，但仅限读取非敏感 key 名及 method/path/status
禁止替代：内置 Browser、纯 Codex CLI、静态 HTML、旧截图或仅用服务端日志冒充 Chrome 证据
原因：M1 仅剩 Storage key 名和 Copilot POST Network 条目两个 Chrome 观测缺口
本地地址：http://127.0.0.1:5174/ 与 http://127.0.0.1:8787
```

你现在继续处理：

```text
/Users/hyx/Documents/workspace/LLM-TradeBot
```

本轮不是功能开发 Loop，而是 M1 的两项定点证据收尾。真实功能、Operator 自动认证、GET Network、Draft Version 3、Console、安全边界与 `328/328` 已通过。不要重做 M1 实现，不要提前进入 M2。

## 1. 唯一目标

只关闭以下两个缺口：

1. 在真实 Chrome 中确认 localStorage、sessionStorage、Cookie 的 **key/name**；
2. 在真实 Chrome Network 中确认正常 UI 操作触发的 Copilot `POST /api/orchestration/copilot/messages` 为成功 `2xx`。

当前 Chrome 扩展控制层不能可靠展开 Storage 子树，也可能看不到由扩展直接驱动的 POST。因此本轮必须采用用户辅助 DevTools 交接：Agent 给出精确步骤，用户在 Chrome 中手工点击和读取，只反馈非敏感字段，Agent 据此完成验收。

## 2. 开始前保护项

完整保护：

- 当前全部未提交 M0/M1 修改；
- `data/local-paper-workspace.backup-20260801T183000`；
- 当前 `data/local-paper-workspace`；
- Operator Token、Conversation 内容和 Draft payload。

禁止：

- `git reset`、`git checkout --`、`git clean`；
- commit、push、PR；
- 删除、覆盖或提交 data workspace/backup；
- 读取、复制、截图、粘贴或持久化任何 token/value；
- 将认证信息放入 localStorage、sessionStorage、Cookie、URL、文档或日志；
- 为了制造 Network 条目而匿名写入、绕过认证或直接调用服务端接口；
- 重复实现 Conversation、Tool Activity、Draft Authority、分页或 Operator resolver；
- 提前进入 M2。

## 3. 开始前检查

1. 完整阅读：
   - 本文件；
   - `docs/loop-prompts/loop-002-m1-chrome-auth-devtools-final-acceptance.md`；
   - `docs/product-optimization-plan-and-progress.md`；
   - `docs/product-roadmap-and-progress.md`；
   - `docs/project-status-and-handoff.md`；
   - `docs/local-paper-workspace.md`。
2. 运行 `git status --short` 和 `git diff --check`，保护既有修改。
3. 确认 5174/8787 属于当前项目的单一 `npm run dev:paper` 链路；若未运行，使用该命令启动。
4. 不输出 Operator Token；只确认 DEV injection 与 Exchange Write disabled。
5. 在真实 Chrome 打开 `http://127.0.0.1:5174/`，确认页面已自动认证，不是 `Connecting` 或 `Operator identity required`。

若无法使用真实 Chrome 或用户无法进行两次最小手工交接，应停止并报告执行环境限制，不得用内置 Browser 再做一遍。

## 4. Storage key/name 验收

请用户手工打开 Chrome DevTools -> Application，完成以下操作。Agent 不索取截图，不索取任何 value。

### 4.1 localStorage

1. 展开 `Storage -> Local Storage`；
2. 选择 `http://127.0.0.1:5174`；
3. 只读取并反馈 Key 列中的名称；
4. 不打开、不复制、不反馈 Value 列。

允许的产品 key 只有：

```text
tradebot.locale
tradebot.orchestration.conversation-id.v1
tradebot.release-session.v1（仅在受控发布引用存在时）
```

### 4.2 sessionStorage

1. 展开 `Storage -> Session Storage`；
2. 选择 `http://127.0.0.1:5174`；
3. 只反馈 key 名；
4. 预期不存在 Operator Token、Conversation payload、Draft payload、Tool Result、Prompt、Secret 或 Runtime 状态。

### 4.3 Cookies

1. 展开 `Storage -> Cookies`；
2. 检查当前页面 origin；如面板同时列出 API origin，也一并检查；
3. 只反馈 Cookie Name，不反馈 Value、Domain 之外的敏感内容或完整表格；
4. 确认不存在 Operator Token。

如果 Application 树仍无法由 Agent 控制，必须让用户手工展开并以文字反馈 key/name；这属于有效的：

```text
AGENT_CHROME_VERIFIED_WITH_USER_DEVTOOLS_HANDOFF
```

如果发现未知 key：

- 只记录 key 名；
- 通过代码检索判断归属，不读取 value；
- 若可能包含认证或完整业务 payload，M1 不得关闭；
- 若属于 Chrome/扩展而非页面 origin，明确区分后再判断。

## 5. Copilot POST Network 验收

本项必须由用户通过页面正常 UI 手工触发，不能让扩展直接调用页面函数或 API。

1. 用户打开 Chrome DevTools -> Network；
2. 确认左上角录制按钮为红色；
3. 选择 `Fetch/XHR`，清空现有记录；
4. 过滤 `copilot/messages`；如果过滤器不匹配，改用 `method:POST`；
5. 保持 DevTools 打开，由用户在页面 Composer 中输入一条无敏感内容的 Draft 修改指令并手工点击发送；
6. 等待页面成功生成下一个不可变 Draft Version；
7. 用户只反馈以下三项：
   - Request Method：预期 `POST`；
   - Pathname：预期 `/api/orchestration/copilot/messages`；
   - Status：预期 `2xx`；
8. 不打开或复制 Request Headers、Authorization、Payload、Response、Cookie 或 token；
9. 确认该操作仍显示 `runtimeApplied=false`。

如果没有出现条目，按顺序排查一次：

1. 确认 Network 正在录制且目标是同一个 5174 标签页；
2. 清空过滤条件后重新选择 Fetch/XHR；
3. 保持 DevTools 打开，刷新页面后再清空记录；
4. 由用户再次通过可见 Composer 和发送按钮手工触发，不使用扩展脚本直接调用；
5. 检查是否出现 `OPTIONS` 后紧跟 `POST`，验收只记录 POST 的 method/path/status。

不得用服务端日志、终端 curl、旧 Network 记录或页面成功提示替代本项。若经过一次上述排查仍无法观测，记录为 Chrome/扩展观测阻塞，M1 保持 `IN_PROGRESS`，不要修改产品代码来迎合工具限制。

## 6. 最小安全复核

两项取证结束后确认：

- Chrome Console 无 warning/error；
- `runtimeApplied=false`；
- Paper Only；
- Exchange writes OFF / `exchangeWriteAllowed=false`；
- Storage 与 Network 检查没有触发交易动作；
- 唯一动作链仍为 `Decision -> Portfolio -> Risk -> Execution`。

## 7. 自动化与 Git 验证

如果本轮没有修改代码，只需确认当前工作树仍对应 LOOP-002 的 `328/328 PASS` 结果，并运行：

```bash
git diff --check
```

如果发现并修改了真实代码问题，则必须补测试并完整运行：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

不得把 Chrome profile、DevTools export、截图、日志、data workspace/backup 或 Secret 加入 Git。

## 8. M1 关闭条件

只有以下全部成立才关闭 M1：

1. localStorage key 名已读取并符合 allowlist；
2. sessionStorage key 名已读取，未发现 Operator Token 或业务 payload；
3. Cookie name 已读取，未发现 Operator Token；
4. 正常 UI 手工操作产生可见 `POST /api/orchestration/copilot/messages` `2xx` 条目；
5. 未读取、复制或暴露任何 token/value；
6. Console 与 Runtime/Exchange 安全边界保持通过；
7. `git diff --check` 通过，若有代码改动则完整自动化通过。

## 9. 全部通过后的文档动作

全部通过后：

1. 将本文件状态改为 `COMPLETE`；
2. 保持 `LOOP-001`、`LOOP-002` 为 `PARTIAL` 历史记录；
3. 将 `docs/product-optimization-plan-and-progress.md` 的 M1 改为 `COMPLETE`；
4. 更新 `docs/product-roadmap-and-progress.md`、`docs/project-status-and-handoff.md` 和必要的 `docs/local-paper-workspace.md`；
5. 创建下一唯一编号 Prompt：

   ```text
   docs/loop-prompts/loop-004-m2-data-center-v1.md
   ```

6. 将 `docs/next-loop-prompt.md` 更新为只指向 LOOP-004；
7. LOOP-004 顶部必须继续标明编号、执行环境、是否需要浏览器、推荐执行端与原因。

如果任一项未通过：

- M1 保持 `IN_PROGRESS`；
- 本文件改为 `PARTIAL`；
- 不生成 LOOP-004；
- 最终报告明确是产品缺陷还是 Chrome 观测限制；
- 后续如需再次执行，必须使用新的唯一 Loop 编号，不能复用 LOOP-003 文件名。

## 10. 最终交付格式

最终报告必须包含：

```text
Loop ID：LOOP-003
验收模式：AGENT_CHROME_VERIFIED_WITH_USER_DEVTOOLS_HANDOFF
浏览器要求：必需，已使用真实 Chrome
localStorage keys：仅列 key 名
sessionStorage keys：仅列 key 名
Cookie names：仅列 name；若为空写 NONE
Copilot POST：仅列 method + pathname + status
敏感值暴露：NO
Console：PASS/FAIL
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
自动化：沿用 328/328（无代码改动）或列出本轮真实结果
M1：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-004（仅在 M1 COMPLETE 后生成）
Git：未 commit、未 push、未创建 PR
```

现在执行 `LOOP-003`。本轮需要浏览器，并且需要用户完成两次最小 DevTools 手工交接；不要再依赖扩展独自读取受限面板。

## 11. 实际执行结果（2026-08-01）

真实 Chrome 已由已安装的 ChatGPT Chrome 插件接管，页面保持自动认证、Paper Only、`exchangeWriteAllowed=false` 和 `runtimeApplied=false`。插件仅暴露页面、Console 与页面资产能力；未提供 Chrome DevTools Application/Storage 或 Network 请求记录面板能力。

本轮未完成规定的两次最小 DevTools 手工交接。为避免读取任何 Storage value、token、Cookie、请求载荷或响应，也不以页面求值、服务端日志或扩展直接调用替代 Chrome DevTools 证据，本轮无法确认：

- localStorage、sessionStorage、Cookie 的 key/name；
- 正常 UI 操作产生的 `POST /api/orchestration/copilot/messages` 的 method/pathname/status。

结论：这是 Chrome 可观测性与交接流程限制，不是已确认的产品缺陷。M1 保持 `IN_PROGRESS`；下一次执行使用唯一编号 `LOOP-004`，M2 顺延为 `LOOP-005`。未提交、推送或创建 PR。
