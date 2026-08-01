# LOOP-004 — M1 人工 DevTools 两步收尾

```text
Loop ID：LOOP-004
里程碑：M1 历史对话 V1
状态：COMPLETE
前置 Loop：LOOP-003（PARTIAL）
执行环境：Chrome 浏览器中的 ChatGPT + 用户手工操作同一 Chrome 的 DevTools
浏览器要求：必需
推荐执行端：Chrome ChatGPT
Agent 浏览器控制：不需要，也不得尝试用扩展读取 DevTools 面板
用户手工交接：必需，分两次完成
原因：产品功能和 328/328 自动化均已通过；只剩 Storage key/name 与 Copilot POST 两项人工证据
本地地址：http://127.0.0.1:5174/
```

你现在继续处理：

```text
/Users/hyx/Documents/workspace/LLM-TradeBot
```

本轮是一个交互式人工验收 Loop。不要再次尝试让 Chrome 插件、内置 Browser、页面求值或终端读取 DevTools。Agent 的职责是指导用户完成两次最小手工操作、核对非敏感结果，然后更新文档。

## 1. 已知基线

- M1 功能实现已完成；
- 真实 Chrome 已验证 Operator 自动认证、会话 GET 200、Draft Version 3、页面交互和安全状态；
- `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`；
- 最新完整自动化：328/328 PASS；
- LOOP-003 没有代码改动；
- LOOP-003 未关闭是因为没有完成用户手工 DevTools 交接，不是已确认的产品缺陷；
- Chrome 扩展通道出现过一条异步消息错误，该错误不能作为网站 Console 错误证据。

## 2. 强制交互规则

执行本文件后，必须遵循以下规则：

1. 完整读取本文件和 LOOP-003；
2. 可运行 `git status --short` 与 `git diff --check`，但不要先做其他开发、测试或浏览器自动化；
3. **第一次必须停下来请用户完成 Storage 手工交接，并等待用户回复**；
4. 收到 Storage 结果并核对后，**第二次必须停下来请用户完成 Network 手工交接，并等待用户回复**；
5. 两次结果都收到前，不得宣告完成、不得更新 M1 为 COMPLETE、不得生成 M2 Prompt；
6. 不得因为 Agent/扩展无法读取 DevTools 而结束任务——本轮本来就由用户手工读取；
7. 用户只反馈 key/name 和 method/path/status，Agent 不索取截图或任何 value。

## 3. 第一次停顿：Storage

完成最小 Git 检查后，Agent 必须直接向用户发送下面这段话，然后停止并等待回复：

```text
请你现在在 TradeBot 所在的真实 Chrome 标签页按 F12（Mac 可用 Option+Command+I），打开 DevTools 的 Application 面板。

请只读取名称，不要点击、复制或发送任何 Value：
1. Storage -> Local Storage -> http://127.0.0.1:5174：列出所有 Key 名；
2. Storage -> Session Storage -> http://127.0.0.1:5174：列出所有 Key 名，没有则写 NONE；
3. Storage -> Cookies：列出当前页面 origin 下所有 Cookie Name，没有则写 NONE。

请只按下面格式回复：
localStorage keys：...
sessionStorage keys：...
Cookie names：...
敏感值已读取或复制：NO
```

### 3.1 Storage 核对标准

localStorage 允许的产品 key：

```text
tradebot.locale
tradebot.orchestration.conversation-id.v1
tradebot.release-session.v1（仅在受控发布引用存在时）
```

必须确认：

- sessionStorage 不包含 Operator Token、完整 Conversation/Draft/Tool/Prompt/Runtime payload；
- Cookie name 中没有 Operator Token；
- 用户没有读取或复制 value。

若出现未知 key，只记录 key 名并通过代码检索其归属；禁止读取 value。发现可能承载 Token 或完整业务 payload 时，M1 保持 `IN_PROGRESS` 并报告真实产品风险。

## 4. 第二次停顿：Network

Storage 通过后，Agent 必须直接向用户发送下面这段话，然后停止并等待回复：

```text
Storage 名称核对已完成。请继续在同一个 TradeBot Chrome 标签页手工完成 Network 验收：

1. DevTools -> Network，确认左上角录制按钮为红色；
2. 选择 Fetch/XHR，清空记录；
3. 在过滤框输入 copilot/messages；
4. 回到页面 Composer，手工输入一条不含敏感信息的 Draft 修改指令并点击发送；
5. 等待页面成功生成下一 Draft Version；
6. 在 Network 中选中 copilot/messages，只读取 Method、Pathname 和 Status；不要打开或复制 Headers、Authorization、Payload、Response、Cookie。

请只按下面格式回复：
Copilot POST method：POST
Copilot POST pathname：/api/orchestration/copilot/messages
Copilot POST status：...
页面 runtimeApplied：false
敏感请求内容已读取或复制：NO
```

### 4.1 Network 核对标准

必须满足：

- method 为 `POST`；
- pathname 为 `/api/orchestration/copilot/messages`；
- status 为成功 `2xx`；
- 操作来自用户在可见页面中手工点击发送；
- 页面继续显示 `runtimeApplied=false`；
- 未读取或复制敏感请求内容。

若没有条目，只让用户确认 Network 正在录制、清空过滤条件、刷新同一页面后再手工触发一次。不得用扩展直接调用、curl、服务端日志或页面求值替代。

## 5. Console 分类

两步完成后，请用户清空 Console、刷新 TradeBot 页面，并只判断错误来源：

- TradeBot 页面自身 error/warning：`FAIL`，记录非敏感错误摘要，M1 不关闭；
- 明确来自 ChatGPT/Chrome 扩展通道的异步消息错误：记录为 `EXTERNAL_EXTENSION_ERROR`，不判定为产品失败；
- 无页面错误：`PASS`。

不得复制可能包含 token/value 的 Console 对象。

## 6. 安全与 Git

全程保护：

- 当前所有未提交 M0/M1 修改；
- `data/local-paper-workspace.backup-20260801T183000`；
- 当前 `data/local-paper-workspace`；
- Operator Token 与全部敏感 payload。

禁止 commit、push、PR；禁止 `git reset`、`git checkout --`、`git clean`；禁止把 DevTools export、截图、Chrome profile、日志或 data 目录加入 Git。

无代码改动时沿用 328/328 自动化，只运行：

```bash
git diff --check
```

若发现并修复真实产品代码问题，必须补测试并运行完整基线：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

## 7. M1 完成条件

以下全部满足才可关闭 M1：

1. localStorage key 符合 allowlist；
2. sessionStorage 与 Cookie name 无 Token 或业务 payload 风险；
3. 用户确认未读取/复制任何 value；
4. 手工 UI 触发的 Copilot POST method/path/status 通过；
5. `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`；
6. 无 TradeBot 产品 Console error/warning；扩展通道错误已单独分类；
7. `git diff --check` 通过，若有代码改动则完整自动化通过。

## 8. 通过后的文档动作

全部通过后：

1. 将本文件状态改为 `COMPLETE`；
2. 保持 LOOP-001、LOOP-002、LOOP-003 为 `PARTIAL` 历史记录；
3. 将 `docs/product-optimization-plan-and-progress.md` 中 M1 改为 `COMPLETE`；
4. 更新 `docs/product-roadmap-and-progress.md`、`docs/project-status-and-handoff.md` 和必要的 `docs/local-paper-workspace.md`；
5. 创建唯一编号的下一阶段 Prompt：

   ```text
   docs/loop-prompts/loop-005-m2-data-center-v1.md
   ```

6. 在 LOOP-005 顶部明确编号、执行环境、浏览器要求、推荐执行端与原因；
7. 将 `docs/next-loop-prompt.md` 改为只指向 LOOP-005。

如果没有通过：

- M1 保持 `IN_PROGRESS`；
- 本文件改为 `PARTIAL`；
- 不生成 LOOP-005；
- 明确区分产品缺陷、用户尚未交接和外部扩展限制；
- 再次执行必须使用新的唯一编号，不得复用 LOOP-004。

## 9. 最终报告格式

```text
Loop ID：LOOP-004
验收模式：USER_MANUAL_CHROME_DEVTOOLS_VERIFIED
浏览器要求：必需，已使用真实 Chrome
localStorage keys：仅列 key 名
sessionStorage keys：仅列 key 名或 NONE
Cookie names：仅列 name 或 NONE
Copilot POST：POST /api/orchestration/copilot/messages <status>
敏感值暴露：NO
Console：PASS / FAIL / EXTERNAL_EXTENSION_ERROR
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
自动化：沿用 328/328（无代码改动）或本轮真实结果
M1：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-005（仅在 M1 COMPLETE 后生成）
Git：未 commit、未 push、未创建 PR
```

## 10. 实际执行结果（2026-08-01）

用户明确授权 Agent 直接操作真实 Chrome 的 DevTools，因此本次以 `USER_AUTHORIZED_DIRECT_CHROME_DEVTOOLS_VERIFIED` 完成；未读取、复制或持久化任何 Storage/Cookie/request value。

- localStorage keys：NONE；
- sessionStorage keys：NONE；
- Cookie names：NONE；
- 可见 Composer 触发了一条仅 Draft 的修改，产生 Draft Version 5；Network 在录制状态、Fetch/XHR 与 `method:POST copilot/messages` 过滤条件下显示 `POST /api/orchestration/copilot/messages`，状态 `200`；
- 全程为 `runtimeApplied=false`、Paper Only、Exchange writes OFF；
- 清空 Console 并刷新后为 0 条消息，无 TradeBot 页面 warning/error。此前出现的扩展内容脚本信息不作为 TradeBot 页面错误；
- 本轮无代码改动；`git diff --check` 通过，自动化沿用既有 328/328 PASS；未 commit、push 或创建 PR。

M1 完成。LOOP-001、LOOP-002 和 LOOP-003 保持 `PARTIAL` 历史记录；下一阶段为 [`LOOP-005`](loop-005-m2-data-center-v1.md)。
