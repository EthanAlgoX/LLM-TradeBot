# LOOP-007 — M2 数据中心 V1 Chrome 收尾

```text
Loop ID：LOOP-007
里程碑：M2 数据中心 V1 收尾
状态：PARTIAL
前置 Loop：LOOP-006（PARTIAL）
执行环境：本地仓库 + Chrome 中的 TradeBot
浏览器要求：必需
```

## 目标

完成 M2 尚未通过的真实 Chrome 验收。只有所有项目均通过后，才可将 M2 标记为 `COMPLETE` 并进入 M3。

## 已验证事实

- Data Assets API 仅读取服务端登记的 Binance Public 与 CSV Historical。Binance 无登记实时 Snapshot 时明确显示 `unavailable`；CSV 显示历史 Snapshot、Schema、Quality、Lineage 与 Dataset version/fingerprint。
- 仅当前 actor 的 Market/Agent Configuration Draft 可追加不可变 Dataset Binding 版本。跨 actor、缺失资产、错误 fingerprint 与 capability 不匹配均 fail closed。
- `runtimeApplied=false`、Paper Only 与 `exchangeWriteAllowed=false` 始终保持。
- 自动化已通过：`npm run check`、`npm run test:ts`（328/328）、`npm run build:web`、`git diff --check`。

## 必须完成

1. 使用真实 Chrome 启动并打开 `http://127.0.0.1:5174/#data-center`；不可使用其他浏览器替代。
2. 在中文 1440×900、英文 820×760 下验证无横向溢出或关键内容遮挡。
3. 验证 Binance Public 的 public capability、未登记实时 Snapshot 与 unavailable 标签；验证 CSV 的历史 Snapshot、Schema、Quality、Lineage、Dataset version/fingerprint。
4. 经真实可见页面创建或选取当前 actor 的 Market/Agent Configuration Draft，完成一次 CSV Dataset 正向绑定；刷新后重新进入同一 Draft，确认 version/fingerprint 稳定。
5. 受控 API 仅可用于跨 actor、缺失资产、错误 fingerprint 与 capability 不匹配的负向 fail-closed 验证，不能代替正向 UI 绑定。
6. 验证“送入编排”只创建 Draft/意图，未启动 Paper Run，且 `runtimeApplied=false`、Exchange writes OFF。
7. Chrome Console 无 TradeBot 页面 error，Network 无意外 401/5xx；不得读取或输出任何 Token、Authorization、Cookie value、payload 或响应正文。
8. 运行 `npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check`。

## 执行约束

- 仅在发现真实产品缺陷时做最小修复；修复后重新运行四项完整自动化验证。
- 如果仍仅为 Chrome/扩展控制通道不可用，不修改产品代码，也不伪造浏览器结论；可由用户手工操作同一 Chrome，并只记录可见状态、HTTP method/path/status 和非敏感错误摘要。
- 禁止 commit、push、PR、reset、checkout、clean；不修改 `data/local-paper-workspace*`。

## 关闭规则

- 全部通过：LOOP-007 `COMPLETE`、M2 `COMPLETE`，创建 LOOP-008（M3 实验场 V1）。
- 任何 Chrome 验收仍未通过：LOOP-007 `PARTIAL`、M2 `IN_PROGRESS`，创建下一个唯一编号 M2 收尾 Prompt；不得进入 M3。

## 最终报告格式

```text
Loop ID：LOOP-007
验收模式：AGENT_CHROME_VERIFIED / USER_MANUAL_CHROME_VERIFIED / PARTIAL
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
Git：未 commit、未 push、未创建 PR
```

## 本次执行记录（2026-08-01）

真实 Chrome 已启动，但页面导航控制持续超时，因此未完成中文/英文响应式、资产真实性标签、CSV 正向 UI 绑定与刷新恢复、负向 fail-closed、Console/Network 验收。没有伪造浏览器结论，也没有修改产品代码或 `data/local-paper-workspace*`。

自动化保持 `npm run check`、`npm run test:ts`（328/328）、`npm run build:web`、`git diff --check` 全部通过；Runtime 安全边界保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

按关闭规则，本 Loop 为 `PARTIAL`，M2 保持 `IN_PROGRESS`；后续转入唯一编号 `LOOP-008`，并采用真实 Chrome 用户手工交接优先的收尾方式，不进入 M3。
