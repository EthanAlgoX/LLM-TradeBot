# LOOP-006 — M2 数据中心 V1 收尾

```text
Loop ID：LOOP-006
里程碑：M2 数据中心 V1 收尾
状态：PARTIAL
前置 Loop：LOOP-005（PARTIAL）
执行环境：本地仓库 + Chrome 中的 TradeBot
浏览器要求：必需
```

## 目标

完成 LOOP-005 未通过的真实 Chrome 验收；仅在所有验收通过后将 M2 标记 COMPLETE。

## 已实现事实

- `GET /api/orchestration/data-center/assets` 只读投影服务端注册的 Binance Public 与 CSV Historical；Binance 没有已登记实时 Snapshot 时为 unavailable，CSV 仅在注册 Dataset 存在时显示历史 Snapshot。
- `POST /api/orchestration/data-center/bindings` 仅能将当前 actor 拥有的 Market/Agent Configuration Draft 追加为新不可变版本；绑定包含 asset/dataset/version/fingerprint/capability/mode，缺失、漂移、跨 actor 和能力不匹配 fail closed。
- 所有响应保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

## 必须完成

1. 启动 `npm run dev:paper`，在真实 Chrome 打开 `http://127.0.0.1:5174/#data-center`。
2. 验证中文 1440×900、英文 820×760：无横向溢出或关键内容遮挡。
3. 验证 Binance Public 显示 public capability / 未登记实时 Snapshot / unavailable；CSV 显示历史 Snapshot、Schema、Quality、Lineage 与版本 fingerprint。
4. 创建或选取当前 actor 的 Market/Agent Configuration Draft，必须通过真实可见页面完成一次 CSV Dataset 正向绑定；验证 Draft 显示稳定 version/fingerprint。受控 API 仅用于验证跨 actor、缺失资产、错误 fingerprint 和 capability 不匹配等负向攻击路径，不得替代正向 UI 操作。
5. 验证送入编排后仅创建 Draft/意图，未启动 Paper Run，`runtimeApplied=false`，Exchange writes OFF。
6. 检查 Chrome Console 无 TradeBot 页面 error，Network 无意外 401/5xx。
7. 运行 `npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check`。

## 执行约束

- 本轮以验收为主，不重复实现已经通过自动化的数据中心功能；
- 若发现真实产品缺陷，可进行最小修复并重新运行四项完整验证；
- 若仅为 Chrome/扩展控制通道不可用，不修改产品代码，不伪造浏览器结论；可改用用户
  手工操作同一 Chrome，并只反馈可见状态、HTTP method/path/status 和非敏感错误摘要；
- 不读取或输出 Operator Token、Authorization、Cookie value、请求 payload 或响应正文；
- 页面正向绑定完成后，刷新并重新进入同一 Draft，确认 Dataset version/fingerprint 稳定，
  不能只确认发送动作成功。

## 关闭规则

- 全部通过：LOOP-006 COMPLETE、M2 COMPLETE，并创建 LOOP-007（M3 实验场 V1）。
- 任何 Chrome 验收仍未通过：LOOP-006 PARTIAL、M2 IN_PROGRESS，并创建下一个唯一编号收尾 Prompt；不得进入 M3。
- 禁止 commit、push、PR、reset、checkout、clean；不修改 data/local-paper-workspace*。

## 最终报告格式

```text
Loop ID：LOOP-006
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

Chrome 控制通道返回 `Browser is not available: chrome`，因此未替代为其他浏览器，亦未进行产品代码修改或伪造浏览器验收。服务已通过 `npm run dev:paper` 启动；`npm run check`、`npm run test:ts`（328/328）、`npm run build:web` 与 `git diff --check` 均通过。

按关闭规则，本 Loop 为 `PARTIAL`，M2 保持 `IN_PROGRESS`；后续收尾转入唯一编号 `LOOP-007`，不得进入 M3。
