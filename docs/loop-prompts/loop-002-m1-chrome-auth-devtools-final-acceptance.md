# LOOP-002 — M1 Chrome 身份、DevTools 与最终验收

```text
Loop ID：LOOP-002
里程碑：M1 历史对话 V1
状态：PARTIAL
前置 Loop：LOOP-001（PARTIAL）
执行环境：Chrome 浏览器中的 ChatGPT，并具备本地项目与终端访问能力
浏览器要求：必需
推荐执行端：Chrome ChatGPT
禁止替代：内置 Browser 插件、纯 Codex CLI、静态 HTML 或旧截图
原因：只剩 Chrome Operator 自动认证、Network、Application/Storage、URL 安全交接、details 与键盘焦点验收
本地地址：http://127.0.0.1:5174/ 与 http://127.0.0.1:8787
```

你现在继续开发：

```text
/Users/hyx/Documents/workspace/LLM-TradeBot
```

本轮必须使用真正的 Chrome ChatGPT 完成 M1 最终验收。不要再次使用 in-app Browser 代替 Chrome；不要重复已经完成的 Tool Activity、Conversation、Draft Authority、分页、actor isolation 或身份 resolver 实现。

## 1. LOOP-001 已完成部分

LOOP-001 已部分完成：

- bounded sanitized Tool Activity contract/projection 已实现；
- Browser Response 和 Conversation History 均使用安全 Tool Activity；
- raw arguments/output 不进入 Browser projection；
- Tool Activity 使用默认折叠 `<details>`；
- 旧响应缺少 Tool Activity projection 时不再抛异常，显示“历史投影不可用”；
- 重复 Proposal 渲染已修复；
- details/focus 样式已增加；
- 内置 Browser 页面检查无新增 Console 错误；
- `npm run check`、`npm run build:web`、`git diff --check` 通过。

但 LOOP-001 没有运行完整 `npm run test:ts` 的最终结果，也没有满足 Chrome 专属验收。

## 2. 持续保护项

完整保护：

- 当前全部未提交 M0/M1 修改；
- `data/local-paper-workspace.backup-20260801T183000` 可恢复备份；
- 当前干净 `data/local-paper-workspace` 运行数据。

不得删除、覆盖、提交或把两个 data 目录加入 Git。

禁止：

- `git reset`、`git checkout --`、`git clean`；
- commit、push、PR；
- 提取、复制、显示或持久化 Operator Token；
- 通过匿名写入、硬编码 token 或 localStorage token 绕过认证；
- 提前进入 M2。

## 3. 开始前必须完成

1. 完整阅读：
   - `docs/loop-prompts/loop-001-m1-chrome-observability-accessibility-closure.md`
   - `docs/product-optimization-plan-and-progress.md`
   - `docs/product-roadmap-and-progress.md`
   - `docs/project-status-and-handoff.md`
   - `docs/local-paper-workspace.md`
   - `PRODUCT.md`
   - 本文件
2. 检查 `git status --short`、相关 diff 和 `git diff --check`。
3. 先运行完整自动化基线：

   ```bash
   npm run check
   npm run test:ts
   npm run build:web
   git diff --check
   ```

4. 记录真实测试总数，不沿用旧的 `327/327` 猜测。
5. 如果 Tool Activity 新改动导致测试失败，修复真实问题后再进入 Chrome。

## 4. Chrome 执行端硬要求

本轮必须控制用户真实 Chrome 标签页。执行 Agent 应使用 Chrome 控制能力或 Chrome ChatGPT 当前标签页，不得切回 in-app Browser。

如果 Chrome 标签页尚未交付：

1. 请用户在 Chrome 打开一个专用标签页；
2. 打开 `http://127.0.0.1:5174/`；
3. 用户确认页面出现后，Agent 接管该 Chrome 标签页；
4. 如果需要 DevTools，Agent 可使用 Chrome 能力直接检查，或明确请用户打开 DevTools 并逐项反馈；
5. 用户辅助 DevTools 时，验收模式记录为：

   ```text
   AGENT_CHROME_VERIFIED_WITH_USER_DEVTOOLS_HANDOFF
   ```

如果当前执行环境无法控制真实 Chrome，也无法让用户交付 Chrome 标签页，应立即停止并报告“执行环境错误”；不要再用内置 Browser 做一遍相同检查。

## 5. 干净启动与 Operator 自动认证

当前本地服务可能仍运行于 5174/8787。先确认监听进程及父进程属于当前 TradeBot。

为保证 Chrome 获得正确 DEV 注入，建议停止可信旧进程后，通过单一父命令启动：

```bash
npm run dev:paper
```

确认日志：

- Web/API 地址正确；
- development Operator Token injected into loopback Vite；
- Exchange Write disabled；
- 不输出 token 值。

在 Chrome 中确认：

1. 页面从 Connecting 进入 authenticated/live；
2. Strategy Workspace 显示 Real backend connected；
3. 不出现 Operator identity required；
4. Composer 和 Generate plan 可用；
5. 不需要人工输入 token；
6. 刷新后仍自动认证；
7. DOM、URL、Console 中没有 token。

如果 Chrome 仍停在 Connecting：

- 检查 Chrome 页面是否来自本轮 Vite 进程；
- 检查 5174 是否被旧 tokenless `dev:web` 占用；
- 检查 API/Vite 是否由同一个 `dev:paper` 父进程启动；
- 检查 Network 中 session 请求及状态；
- 不提取 token，不使用内置 Browser 代替。

## 6. 新旧 Tool Activity 验收

### 6.1 旧历史兼容

打开缺少 Tool Activity projection 的旧 Turn，确认：

- 页面不抛异常；
- 明确显示“工具活动：历史投影不可用 / Tool activity: history projection unavailable”；
- 该提示不会虚构 succeeded/pending 事实；
- 其他 Draft、Diff、Validation、Gate 仍可读。

### 6.2 新 Turn

创建一条新会话或在当前会话发送一个允许的 Draft 指令，确认新 Turn：

- Tool Activity summary 显示受控调用数量；
- 默认折叠；
- 展开后显示 toolName、call/result lifecycle、opaque ID、humanVersion、截断 fingerprint 和时间；
- call/result 关联正确；
- 没有 arguments/output、Prompt、Secret、token、代码、SQL、URL、路径或账户字段；
- 刷新后 Tool Activity 仍存在且一致；
- Web/API 重启后仍能恢复；
- Proposal 每个 Turn 只显示一次。

## 7. Chrome details 与键盘焦点验收

分别在中文 `1440×900` 和 English `820×760` 执行：

1. Tool Activity 默认关闭；
2. 鼠标可展开/关闭；
3. Tab 可聚焦 Tool Activity summary；
4. Enter 和 Space 可展开/关闭；
5. focus ring 清晰且不被裁剪；
6. Diff/Capability/Validation details 同样可操作；
7. 从 History -> New Conversation -> Composer -> Send -> Turn details 的 Tab 顺序合理；
8. 切换会话后焦点不进入隐藏区域；
9. Escape/Cmd+K 不造成 focus trap；
10. `820×760` 展开 details 后无横向溢出；
11. Console 无 warning/error。

如果发现 focus 或布局缺陷，只做最小 CSS/DOM 修复，并补可自动化测试后复验。

## 8. Chrome Network 验收

优先让 Agent 直接读取 Chrome Network。若能力不提供面板，用户可打开 DevTools -> Network，Agent 给出操作步骤，用户只反馈 method、pathname、status。

严禁复制：

- Authorization header；
- Operator Token；
- Cookie；
- 敏感 request/response body。

至少验证：

- `GET /api/orchestration/session`：200；
- `GET /api/orchestration/conversations`：200；
- `GET /api/orchestration/conversations/:id/turns`：200；
- Copilot message POST：成功 2xx；
- 刷新和切换无持续 401；
- 没有无限重试或重复请求风暴；
- actor/role 不由 query/body 注入；
- History GET 不触发 Runtime mutation。

## 9. Chrome Application/Storage 验收

使用 Chrome DevTools -> Application，或 Chrome 支持的页面求值，只读取 key 名和非敏感结构。

允许的已知 localStorage key：

```text
tradebot.locale
tradebot.orchestration.conversation-id.v1
tradebot.release-session.v1（只有受控发布引用存在时）
```

确认：

- localStorage 无 Operator Token；
- sessionStorage 无 Operator Token；
- Cookie 无 Operator Token；
- 无完整 Conversation Command/Response；
- 无 Draft payload、Tool Result、Prompt、Secret 或 Runtime 状态；
- release-session 若存在，只包含严格 opaque refs。

最终报告只列 key 和结论，不粘贴 value。

## 10. Chrome localhost 手动 URL 交接

在已有至少两条会话和多个新旧 Turn 后：

1. 保持当前 Chrome 标签页；
2. 记录非敏感会话/Draft 标识；
3. 停止 `dev:paper` 父进程并确认子进程停止；
4. 使用同一干净 workspace 重启；
5. 终端确认 5174/8787 恢复；
6. 请用户手动刷新同一 Chrome 标签页；
7. 用户确认页面恢复后，Agent 重新接管；
8. 验收模式记录为：

   ```text
   AGENT_CHROME_VERIFIED_WITH_MANUAL_URL_HANDOFF
   ```

9. 确认新 DEV token 自动认证，无需输入；
10. 确认历史、已选会话、Turn、最新 Draft Reference 和 Tool Activity 恢复；
11. 继续创建下一 Draft Version；
12. 确认无旧 token 401 循环、重复/丢失 Turn 或串会话。

用户只负责 Chrome 安全策略要求的 URL 刷新；产品状态和行为仍由 Agent 验收。

## 11. Runtime 安全边界

全程确认：

- `runtimeApplied=false`；
- Paper Only；
- `exchangeWriteAllowed=false`；
- History、details、语言、会话切换、刷新和重启不触发交易动作；
- 唯一动作链保持 `Decision -> Portfolio -> Risk -> Execution`；
- Copilot、History、LLM 和 Reflection 不能直接下单或绕过 Risk。

## 12. 最终回归

如果 Chrome 验收期间有任何代码修改，先补测试。最后无论是否修改，都运行：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

记录真实测试总数，并确认 Git 未加入：

- data workspace/backup；
- token/Secret；
- Chrome profile 或 DevTools export；
- screenshot/cache；
- build output；
- 日志。

## 13. M1 完成条件

只有以下全部通过，M1 才能改为 `COMPLETE`：

1. Chrome Operator 自动认证；
2. 旧 Tool Activity projection 兼容提示；
3. 新 Tool Activity 默认折叠、展开和刷新/重启恢复；
4. Proposal 单次渲染；
5. 中文桌面与英文窄屏键盘/focus/details；
6. Chrome Network；
7. Chrome Storage/Cookie；
8. Chrome 手动 URL 交接；
9. Console 无错误；
10. 全量自动化通过；
11. Runtime/Exchange 安全边界未退化。

## 14. 关闭 M1 并创建 LOOP-003

全部通过后：

1. 更新 `docs/product-optimization-plan-and-progress.md`，M1 改为 `COMPLETE`；
2. 更新 `docs/product-roadmap-and-progress.md`；
3. 更新 `docs/project-status-and-handoff.md`；
4. 按真实结果更新 `docs/local-paper-workspace.md`；
5. 将本文件状态改为 `COMPLETE`；
6. 保持 `LOOP-001` 为 `PARTIAL` 历史记录，不覆盖；
7. 创建下一唯一编号 Prompt：

   ```text
   docs/loop-prompts/loop-003-m2-data-center-v1.md
   ```

8. 把 `docs/next-loop-prompt.md` 更新为仅指向 `LOOP-003` 的索引。

`LOOP-003` 顶部继续明确执行环境、浏览器要求、推荐执行端和原因。

如果任一项未通过：

- M1 保持 `IN_PROGRESS`；
- 本文件改为 `IN_PROGRESS`；
- 不生成 `LOOP-003`；
- `docs/next-loop-prompt.md` 继续指向 `LOOP-002`。

## 15. 最终交付报告

必须包含：

1. Loop ID：`LOOP-002`；
2. Chrome 执行方式和用户交接范围；
3. 初始完整自动化与最终自动化真实测试数；
4. Operator 自动认证结果；
5. 新旧 Tool Activity、Proposal、details/focus 结果；
6. Network 结果；
7. Storage/Cookie 结果；
8. URL 交接与重启恢复结果；
9. Console 和 Runtime/Exchange 结果；
10. M1 是否 `COMPLETE`，是否生成 `LOOP-003`。

现在执行 `LOOP-002`。如果当前环境不是 Chrome ChatGPT，应立即停止并切换执行端；不要再用内置 Browser 重复不完整验收。

## 16. 实际执行结果（2026-08-01）

`LOOP-002` 已使用真实 Chrome DevTools 执行，结果为 `PARTIAL`：

- `GET /api/orchestration/session`、`GET /api/orchestration/conversations` 和 `GET /api/orchestration/conversations/:id/turns` 均为 `200`，无 `401` 循环；
- 受控 Copilot 操作成功创建 Draft Version 3，且 `runtimeApplied=false`；
- Chrome Console 无 warning/error，Paper Only 与 Exchange writes OFF 保持成立；
- 最终自动化为 `328/328 PASS`；
- Chrome 扩展控制链路未能在 Network 面板读取本次 POST 条目；
- Application 面板可打开，但控制链路不能展开 Storage 子树读取 key 名；
- 未读取、复制或暴露任何 token/value；
- 未 commit、push 或创建 PR。

因此 M1 保持 `IN_PROGRESS`。按“每次执行使用唯一编号”的规则，后续不复用本文件；定点收尾任务转入 `LOOP-003`，M2 顺延为 `LOOP-004`。
