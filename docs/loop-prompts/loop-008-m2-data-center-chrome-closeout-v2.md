# LOOP-008 — M2 数据中心 V1 Chrome 用户协同收尾

```text
Loop ID：LOOP-008
里程碑：M2 数据中心 V1 收尾
状态：PARTIAL
前置 Loop：LOOP-007（PARTIAL）
执行环境：本地仓库 + 真实 Chrome；用户手工交接优先
浏览器要求：必需
```

## 实际执行结果（2026-08-01）

- 验收模式：`PARTIAL`。
- 真实 Chrome 控制通道不可用，未完成中文 1440×900、英文 820×760、资产真实性标签、CSV 正向 UI 绑定与刷新恢复、Console/Network 验收。
- 未获得用户逐项手工 Chrome 反馈，因此不能把计划中的用户交接步骤记为已验证。
- Runtime 安全边界保持：`runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。
- 沿用本轮执行窗口报告的自动化结果：`npm run check`、`npm run test:ts`（328/328）、`npm run build:web`、`git diff --check` 均通过。
- `npm run dev:paper` 启动时发现 8787 已被既有进程占用；未终止或修改该进程，未修改 `data/local-paper-workspace*`。
- 本轮执行窗口没有 commit、push 或创建 PR，不符合新增 Git 快照规则；文档收尾及下一 Loop 由当前交接补齐。
- M2 保持 `IN_PROGRESS`；下一步执行 LOOP-009，不进入 M3。

## 目标

完成 M2 尚未通过的真实 Chrome 验收。LOOP-006、LOOP-007 已连续因 Chrome 控制通道不可用而无法验收，因此本轮不再把自动控制作为唯一完成路径：Agent 可直接控制 Chrome 时直接执行；控制失败时，必须在同一 Loop 内切换为用户手工操作、Agent 逐项记录非敏感证据。只有所有项目均通过后，才可将 M2 标记为 `COMPLETE` 并进入 M3。

## 已验证事实

- Data Assets API 仅读取服务端登记的 Binance Public 与 CSV Historical。Binance 无登记实时 Snapshot 时明确显示 `unavailable`；CSV 显示历史 Snapshot、Schema、Quality、Lineage 与 Dataset version/fingerprint。
- 仅当前 actor 的 Market/Agent Configuration Draft 可追加不可变 Dataset Binding 版本。跨 actor、缺失资产、错误 fingerprint 与 capability 不匹配均 fail closed。
- `runtimeApplied=false`、Paper Only 与 `exchangeWriteAllowed=false` 始终保持。
- 自动化已通过：`npm run check`、`npm run test:ts`（328/328）、`npm run build:web`、`git diff --check`。
- LOOP-007 已启动 `npm run dev:paper`，但 Chrome 控制通道在访问 `http://127.0.0.1:5174/#data-center` 时超时；没有据此声称任何页面验收通过，也未修改产品代码或 `data/local-paper-workspace*`。

## 必须完成

1. 启动 `npm run dev:paper`，使用真实 Chrome 打开 `http://127.0.0.1:5174/#data-center`；不可使用其他浏览器替代。
2. 在中文 1440×900、英文 820×760 下验证无横向溢出或关键内容遮挡。
3. 验证 Binance Public 的 public capability、未登记实时 Snapshot 与 unavailable 标签；验证 CSV 的历史 Snapshot、Schema、Quality、Lineage、Dataset version/fingerprint。
4. 经真实可见页面创建或选取当前 actor 的 Market/Agent Configuration Draft，完成一次 CSV Dataset 正向绑定；刷新后重新进入同一 Draft，确认 version/fingerprint 稳定。
5. 受控 API 仅可用于跨 actor、缺失资产、错误 fingerprint 与 capability 不匹配的负向 fail-closed 验证，不能代替正向 UI 绑定。
6. 验证“送入编排”只创建 Draft/意图，未启动 Paper Run，且 `runtimeApplied=false`、Exchange writes OFF。
7. Chrome Console 无 TradeBot 页面 error，Network 无意外 401/5xx；不得读取或输出任何 Token、Authorization、Cookie value、payload 或响应正文。
8. 运行 `npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check`。

## 用户手工 Chrome 交接流程

若 Agent 首次连接或导航真实 Chrome 即超时、不可用或丢失控制，不要反复重试同一控制链路，也不要结束本 Loop。立即指导用户在同一个 Chrome 中逐项完成以下操作，并根据用户明确反馈或截图记录 `USER_MANUAL_CHROME_VERIFIED` 证据：

1. 将窗口设为 1440×900，切换中文，打开数据中心并确认无横向滚动、遮挡或不可操作控件。
2. 在页面中确认 Binance Public 的 public capability、无已登记实时 Snapshot、`unavailable`；确认 CSV Historical 的 Snapshot、Schema、Quality、Lineage、version/fingerprint。
3. 通过可见 UI 创建或选取当前 actor 的 Market/Agent Configuration Draft，绑定 CSV Dataset；记录非敏感的 Draft version 与 Dataset fingerprint 显示是否存在和是否一致，不复制 Token 或请求正文。
4. 刷新页面并重新进入同一 Draft，确认绑定仍存在且 version/fingerprint 未漂移。
5. 执行“送入编排”，确认只产生 Draft/意图，未启动 Paper Run；页面仍显示 `runtimeApplied=false`、Paper Only、Exchange writes OFF。
6. 将窗口设为 820×760，切换 English，确认无横向滚动、关键内容遮挡或不可操作控件。
7. 打开 DevTools Console，清空并刷新，确认无 TradeBot 页面 error；在 Network 中只记录相关请求的 method/path/status，确认没有意外 401/5xx，不读取 Header value、payload 或 response body。
8. 负向 fail-closed 可由 Agent 使用受控 API/自动化测试执行；只记录场景、状态码和非敏感错误码，不要求用户在 UI 构造攻击输入。

用户手工完成上述可见步骤并明确反馈结果，与 Agent 直接控制 Chrome 的验收效力相同；不得因为扩展控制不可用而把已完成的用户手工证据判为失败。

## 执行约束

- 仅在发现真实产品缺陷时做最小修复；修复后重新运行四项完整自动化验证。
- Chrome/扩展控制通道不可用时，必须优先执行上述用户手工交接；不能只报告控制失败并再次生成内容相同的重试 Loop。
- 只有用户也无法完成真实 Chrome 手工操作，或手工验收发现真实产品问题且本轮无法修复时，才可保持 `PARTIAL`。
- 禁止 `reset`、`checkout`、`clean` 等破坏性 Git 操作；不修改或提交 `data/local-paper-workspace*`、运行时数据库、Token、Secret 或其他本地敏感数据。

## Git 快照要求

- 本轮对代码或文档产生任何修改后，必须在最终汇报前创建一次范围明确的 Git commit，并推送当前分支到 `origin`；不得把修改留在未提交状态。
- 即使本轮仍为 `PARTIAL`，只要更新了执行记录、里程碑状态或下一 Loop Prompt，也必须提交并推送这些文档修改。
- 提交前运行完整四项验证，并检查 staged diff，确保只包含项目代码、测试和文档，不包含本地运行数据或敏感值。
- commit message 必须包含当前 Loop 或里程碑语义；最终报告提供 commit hash、分支及 push 结果。
- 不创建 PR，除非用户后续明确要求。

## 关闭规则

- 全部通过：LOOP-008 `COMPLETE`、M2 `COMPLETE`，创建 LOOP-009（M3 实验场 V1），提交并推送本轮全部修改。
- 任何 Chrome 验收仍未通过：LOOP-008 `PARTIAL`、M2 `IN_PROGRESS`，创建下一个唯一编号 M2 收尾 Prompt，并提交、推送；不得进入 M3。

## 最终报告格式

```text
Loop ID：LOOP-008
验收模式：AGENT_CHROME_VERIFIED / USER_MANUAL_CHROME_VERIFIED / AGENT_AND_USER_CHROME_VERIFIED / PARTIAL
浏览器要求：必需；已使用真实 Chrome / 未完成
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
