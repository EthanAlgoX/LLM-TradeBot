# LOOP-001 — M1 Chrome 可观测性、工具详情与可访问性收尾

```text
Loop ID：LOOP-001
里程碑：M1 历史对话 V1
状态：PARTIAL
前置 Loop：未编号的 M1 Chrome 最终验收 Loop
执行环境：Chrome 浏览器中的 ChatGPT，并具备本地项目与终端访问能力
浏览器要求：必需
推荐执行端：Chrome ChatGPT
不推荐执行端：纯 Codex CLI
原因：需要真实 Chrome Network、Application/Storage、键盘焦点、details 交互和 URL 安全交接
本地地址：http://127.0.0.1:5174/ 与 http://127.0.0.1:8787
```

你现在继续开发：

```text
/Users/hyx/Documents/workspace/LLM-TradeBot
```

本轮只关闭 M1 最后剩余的 Chrome 验收与两个已确认的 UI 缺口。不要重复已经通过的 Conversation、Draft Authority、SQL Pagination、Actor Isolation、身份桥、响应式或重启恢复实现，不要提前进入 M2。

## 执行结果（2026-08-01）

- 已实现 bounded sanitized Tool Activity projection、服务端历史恢复和默认折叠 UI；
- 已修复每个 Turn 重复渲染 Proposal；
- 已增加 details/focus 样式与 Tool Activity 合同测试；
- 已修复旧响应缺少 Tool Activity projection 时的兼容性错误，页面明确显示“历史投影不可用”；
- `npm run check`、`npm run build:web`、`git diff --check` 通过；
- 使用内置 Browser 完成页面检查且无新增 Console 错误；
- 未使用本 Loop 要求的 Chrome ChatGPT，因此 Operator 自动注入、Chrome Network/Application、URL 手动交接、Tool Activity 新 Turn 展开和完整焦点验收仍未完成；
- M1 保持 `IN_PROGRESS`；后续唯一编号 Prompt 为 `LOOP-002`。

## 1. 已完成且不得回退

当前可信基线：

- 第一会话创建和 v2 不可变 Draft 通过；
- 第二会话创建及双会话隔离切换通过；
- 中文 `1440×900` 和 English `820×760` 响应式通过；
- 页面刷新通过；
- Web/API 重启后自动认证、已选会话、2 Turn 和 v2 恢复通过；
- Console 无 warning/error；
- `runtimeApplied=false`、Paper Only、Exchange Write disabled；
- DEV Operator 身份桥与 production sentinel leak check 通过；
- `npm run check` 通过；
- `npm run test:ts` 为 `327/327 PASS`；
- `npm run build:web` 通过；
- `git diff --check` 通过。

原损坏 workspace 已可恢复地保留在：

```text
data/local-paper-workspace.backup-20260801T183000
```

不得删除、覆盖、提交或把它加入 Git。当前干净的 `data/local-paper-workspace` 也属于本地运行数据，不加入 Git。

## 2. 本轮剩余范围

必须完成：

1. Chrome Network 验收；
2. Chrome Application/Storage 验收；
3. Chrome 专属 localhost 手动 URL 安全交接；
4. Tool Calls/Results 折叠详情实现与验收；
5. 修复重复 Proposal 渲染；
6. 完整键盘焦点可视与 details 交互验收；
7. 全量自动化回归；
8. M1 文档关闭并生成唯一编号的 `LOOP-002`。

## 3. 开始前检查

1. 完整阅读：
   - `docs/product-optimization-plan-and-progress.md`
   - `docs/product-roadmap-and-progress.md`
   - `docs/project-status-and-handoff.md`
   - `docs/local-paper-workspace.md`
   - `PRODUCT.md`
   - 本文件
2. 检查 `git status --short`、相关 diff 和 `git diff --check`。
3. 完整保护当前所有未提交修改。
4. 禁止 `git reset`、`git checkout --`、`git clean` 或破坏性操作。
5. 未经明确要求不要 commit、push 或创建 PR。
6. 不记录、展示或持久化 Operator Token。

## 4. 先确认两个 UI 缺口

检查 `apps/web/src/strategy-workspace-api.ts` 和现有 contracts/read model：

1. `renderOperation()` 当前是否重复调用两次 `renderProposal(response)`；
2. 当前折叠技术详情是否只有 Diff、Capability 和 Validation，而没有 Tool Call/Result；
3. Conversation History read model 是否未携带任何可安全展示的 Tool Activity；
4. 刷新后页面是否因此无法重建 Tool Activity。

如果代码事实与上述一致，直接按第 5 节修复并补测试。不要把“未实现”误写成“仅未手工点击”。

## 5. Tool Activity 安全折叠详情

### 5.1 产品语义

页面应提供默认折叠的 Tool Activity 详情，方便用户理解每轮编排调用了哪些受注册工具以及结果状态。

不得把任意、无界、可能敏感的 arguments/output 原样倾倒到浏览器。将原先笼统的 “Raw Tool Calls” 验收语义收敛为：

```text
Bounded, sanitized Tool Call / Result trace
```

至少展示：

- toolName；
- Tool Call lifecycle；
- Tool Result lifecycle；
- call/result 的稳定 opaque ID（可截断显示）；
- humanVersion；
- fingerprint（截断显示）；
- createdAt；
- call 与 result 的关联关系；
- 没有结果时明确显示 requested/pending/unavailable。

禁止展示：

- Authorization 或 Operator Token；
- Secret、API Key、Cookie；
- 完整 Prompt 或隐藏推理；
- 任意代码、SQL、URL、路径、账户字段；
- 无界 arguments/output JSON；
- Runtime Apply 或交易执行能力的虚假声明。

如果确实需要展示参数，只允许服务端合同明确 allowlist 的非敏感引用或标量，并继续 HTML escape；默认仍折叠。

### 5.2 服务端历史恢复

Tool Activity 必须来自已持久化 Conversation Replay 的严格 read model，不能只使用发送当下的临时客户端 Response，否则刷新和重启后会消失。

可以扩展 `ConversationTurnSchema.response` 增加严格、版本化、有界的安全 Tool Activity projection。要求：

- 数量有明确上限；
- 字段 strict；
- call/result 必须按 `toolCallId` 关联；
- 未匹配 result 不猜测成功；
- 损坏或不兼容 replay 继续 fail closed；
- actor isolation、cursor、append-only 不退化；
- Conversation History 仍不是 Draft/Runtime 第二事实源。

### 5.3 Web 交互

- 每个 Turn 的 Tool Activity 使用 `<details>`；
- 默认关闭；
- `<summary>` 中展示工具数量和整体状态摘要；
- 展开后结构清楚，中英文均可读；
- `Enter` 与 `Space` 可以操作；
- focus ring 清晰；
- `820×760` 不产生横向溢出；
- 所有服务端文本和 ID 均 escape。

同时删除重复的 Proposal 渲染，确保每个 Turn 只显示一份 Proposal。

## 6. 自动化测试

至少补充：

1. Tool Activity projection contract 严格拒绝未知字段和超界数组；
2. call/result 关联正确；
3. missing/rejected/unavailable 状态不被展示为 succeeded；
4. Conversation History 刷新/Repository 重建后 Tool Activity 一致；
5. actor 隔离不泄漏 Tool Activity；
6. 敏感或非 allowlist 字段不会进入 Browser projection；
7. Web renderer escape 服务端字段；
8. Tool Activity 默认折叠；
9. Proposal 每 Turn 只渲染一次；
10. 现有 Draft Authority、分页、身份桥和 Runtime safety 回归继续通过。

不要引入大型前端框架只为这项测试；优先抽取小型 pure presenter/read model。

## 7. Chrome 启动与已有会话

本地服务据报告仍运行在 5174/8787。先确认进程属于当前 TradeBot，并验证健康；如果不可达或进程不可信，使用：

```bash
npm run dev:paper
```

确认：

- Web/API 可达；
- Operator 自动认证；
- development token 仅内存注入；
- Exchange Write disabled；
- 不输出 token 值。

使用 Chrome ChatGPT 打开 `http://127.0.0.1:5174/`。如果宿主阻止自动导航，请用户在当前 Chrome 标签页手动打开 URL，然后 Agent 重新接管。

## 8. Chrome Network 验收

优先使用 Chrome 的 Network/调试能力。若 ChatGPT 无法直接读取 Network 面板，要求用户打开 Chrome DevTools -> Network，并按 Agent 指示操作；验收模式记录为：

```text
AGENT_BROWSER_VERIFIED_WITH_USER_DEVTOOLS_HANDOFF
```

用户只读取状态，不复制 Authorization header、token、Cookie 或敏感 body。

验证一次完整会话读取和一次 Draft 修改：

- `/api/orchestration/session`：200；
- `/api/orchestration/conversations`：200；
- `/api/orchestration/conversations/:id/turns`：200；
- Copilot message POST：成功 2xx；
- 没有持续 401；
- 没有无限重试或重复请求风暴；
- actor/role 不由 query/body 注入；
- 历史 GET 不触发 Runtime mutation。

如果 Chrome 调试能力支持页面内 fetch 观察器，也只能记录 `method + pathname + status`，不得记录 headers/body/token。

## 9. Chrome Application/Storage 验收

使用 Chrome DevTools -> Application，或受控页面求值，只读取 storage key 名和非敏感引用结构。

允许出现的已知 localStorage key：

```text
tradebot.locale
tradebot.orchestration.conversation-id.v1
tradebot.release-session.v1（仅存在受控发布引用时）
```

确认：

- Operator Token 不在 localStorage；
- Operator Token 不在 sessionStorage；
- Operator Token 不在 Cookie；
- 不存在完整 Conversation Command/Response；
- 不存在 Draft payload、Tool Result、Prompt、Secret 或 Runtime 状态；
- `tradebot.release-session.v1` 若存在，只包含严格 opaque server refs，不包含 token 或 payload。

不要在交付报告中粘贴任何 storage value；只报告 key 和结构检查结论。

## 10. Chrome URL 手动安全交接

使用至少两个会话和多个 Turn 的当前状态：

1. 保持当前 Chrome 标签页；
2. 记录非敏感 conversation/Draft 可见标识；
3. 停止本轮 `npm run dev:paper` 父进程；
4. 确认 Web/API 子进程停止；
5. 使用同一干净 `data/local-paper-workspace` 重启；
6. 终端确认 5174/8787 恢复后，不反复自动 goto；
7. 明确请用户手动刷新同一 Chrome 标签页；
8. 用户确认页面恢复后，Agent 重新接管；
9. 验证自动认证、历史、已选会话、Turn、最新 Draft Reference 和继续修改；
10. 确认无旧 token 401 循环、重复 Turn、丢失 Turn 或串会话。

验收模式记录为：

```text
AGENT_BROWSER_VERIFIED_WITH_MANUAL_URL_HANDOFF
```

## 11. Raw/Technical Details 与焦点验收

在中文 `1440×900` 和 English `820×760` 各检查一次：

1. Tool Activity 默认折叠；
2. 鼠标点击 summary 可展开/关闭；
3. Tab 能移动到 summary；
4. Enter/Space 能展开/关闭；
5. focus ring 清晰，不被容器裁剪；
6. 展开后内容不横向溢出；
7. Proposal 每 Turn 只有一份；
8. Diff/Capability/Validation 技术详情仍可展开；
9. 从历史列表 -> New Conversation -> Composer -> Send -> Turn details 的 Tab 顺序合理；
10. 切换会话后焦点不丢到不可见区域；
11. Escape/Cmd+K 等既有交互不产生 focus trap；
12. Console 无 warning/error。

若 `<summary>` 缺少可见焦点样式，做最小 CSS 修复并在窄屏复验。

## 12. 完整回归

运行：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

记录真实测试总数。检查工作区没有新增：

- token/Secret；
- data workspace 或 backup；
- Chrome/Browser 临时文件；
- Network 导出；
- screenshot/cache；
- build output；
- 日志。

## 13. M1 完成条件

只有以下全部通过才能将 M1 标记为 `COMPLETE`：

1. 已完成的会话、响应式、刷新和重启能力未回退；
2. Network 验收通过；
3. Storage/Cookie 验收通过；
4. Chrome 手动 URL 安全交接通过；
5. bounded sanitized Tool Activity 默认折叠并可恢复；
6. 重复 Proposal 已修复；
7. 完整键盘焦点与 details 交互通过；
8. Console 无错误；
9. 全量自动化通过；
10. Runtime/Exchange 安全边界未退化。

## 14. 文档关闭与下一编号 Loop

M1 全部通过后：

1. 更新 `docs/product-optimization-plan-and-progress.md`，将 M1 标记为 `COMPLETE`；
2. 更新 `docs/product-roadmap-and-progress.md`；
3. 更新 `docs/project-status-and-handoff.md`；
4. 按真实结果更新 `docs/local-paper-workspace.md`；
5. 将本文件状态改为 `COMPLETE`；
6. 创建唯一编号文件：

   ```text
   docs/loop-prompts/loop-002-m2-data-center-v1.md
   ```

7. 将 `docs/next-loop-prompt.md` 更新为仅指向 `LOOP-002` 的轻量索引。

`LOOP-002` 顶部必须继续标注：

```text
Loop ID
里程碑
状态
前置 Loop
执行环境
浏览器要求
推荐执行端
原因
```

如果任一 M1 验收未通过：

- M1 保持 `IN_PROGRESS`；
- 本文件状态保持 `READY` 或改为 `IN_PROGRESS`；
- 不生成 `LOOP-002`；
- `docs/next-loop-prompt.md` 继续指向 `LOOP-001`。

## 15. 最终交付报告

必须包含：

1. Loop ID 与执行环境；
2. Chrome 验收模式及用户手动交接范围；
3. Tool Activity 与重复 Proposal 修复；
4. Network 结果；
5. Storage/Cookie 结果；
6. URL 手动交接和重启恢复结果；
7. 键盘焦点、details、桌面/窄屏和 Console 结果；
8. 自动化命令和真实测试总数；
9. Runtime/Exchange 无副作用证据；
10. 文档状态、M1 是否 `COMPLETE`、是否生成 `LOOP-002`。

现在执行 `LOOP-001`。不要把缺失的 Tool Activity 当成单纯验收项；先完成安全、有界、可恢复的实现，再用 Chrome 完成最后验收。
