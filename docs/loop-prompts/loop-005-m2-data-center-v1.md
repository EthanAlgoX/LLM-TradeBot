# LOOP-005 — M2 数据中心 V1

```text
Loop ID：LOOP-005
里程碑：M2 数据中心 V1
状态：PARTIAL
前置 Loop：LOOP-004（COMPLETE）
执行环境：本地仓库 + Chrome 中的 TradeBot
浏览器要求：实现后必需
推荐执行端：Chrome ChatGPT
原因：需要在真实页面验证数据资产、数据绑定、能力校验与只读安全边界
本地地址：http://127.0.0.1:5174/
```

## 目标

实现 M2 数据中心 V1 的最小可用闭环：为既有 Binance Public 和 CSV Historical
能力提供服务端登记的数据资产、来源能力与健康状态、数据集快照/Schema/Quality/
Lineage 的只读视图；在编排 Agent 中让 Strategy Draft 显式引用服务端登记的数据
版本，并在能力不匹配时 fail closed。

## 开始前

1. 阅读 `docs/product-optimization-plan-and-progress.md` 的 M2 条目、
   `docs/product-roadmap-and-progress.md`、`docs/project-status-and-handoff.md` 和
   `docs/local-paper-workspace.md`。
2. 运行 `git status --short` 与 `git diff --check`，保护已有未提交修改和
   `data/local-paper-workspace*`。
3. 先检索已有 Capability Manifest、Dataset、CSV evidence、Binance Public、Draft
   validation 与 Data Binding 实现；复用既有契约和持久化边界，禁止重新发明平行模型。
4. 开始实现后将 M2 标记为 `IN_PROGRESS`；不得在合同、服务端事实源、持久化、自动化
   与 Chrome 验收全部通过前标记为 `COMPLETE`。

## 实施顺序

1. 先完成服务端资产目录、版本化 Dataset 引用及只读查询合同；
2. 再完成 Draft Data Binding、Validation 与 Evidence lineage；
3. 最后接入数据中心页面、Market Radar 和受控跳转动作；
4. 每层先补 fail-closed 自动化，再进入下一层，避免页面先行制造不可验证的 Mock 闭环。

## 必须交付

1. 一级“数据中心”入口，包含 Data Assets 列表和详情。
2. 每个资产展示来源能力、更新时间、健康状态、Dataset Snapshot、Schema Preview、
   Quality 与 Lineage；不得把 fixture 标成真实 Binance 数据。
3. 编排 Agent 可以选择服务端登记的数据版本并将其写入不可变 Draft 引用。
4. Validation 对缺失资产、非法 ID、跨 actor 引用与能力不匹配 fail closed；回测
   Evidence 能追溯 Dataset fingerprint。
5. Market Radar 首版仅展示当前已有且可证实的 Regime、Mover、Volume、Funding/OI
   维度；无真实来源或 capability 时明确 unavailable，不能伪造数据。
6. “送入编排”“创建实验”只能创建受控 Draft/实验意图，不得 Runtime Apply、启动
   Paper Run 或增加任何交易所写入。

## 安全边界

- 保持 Paper Only、`exchangeWriteAllowed=false`、`runtimeApplied=false`；
- 不读取、写入或持久化 Operator Token、Cookie、URL secret 或原始敏感 payload；
- 不改写当前 Decision → Portfolio → Risk → Execution 链路；
- 不删除、覆盖或提交 `data/local-paper-workspace` 或其 backup；
- 禁止 commit、push、PR、`git reset`、`git checkout --` 与 `git clean`。

## 验证与关闭

实现代码后必须运行：

```bash
npm run check
npm run test:ts
npm run build:web
git diff --check
```

在真实 Chrome 中验证数据中心的列表/详情、数据绑定、能力不匹配拒绝、Dataset
fingerprint lineage、窄屏与安全状态。完成后更新规划、路线图、交接文档与
`docs/next-loop-prompt.md`，再创建新的唯一编号 Loop；未通过则保留 M2
`IN_PROGRESS` 并记录真实阻塞，不提前进入 M3。

Chrome 验收至少覆盖：

- 中文 1440×900 与英文 820×760，无横向溢出或关键内容遮挡；
- Binance Public 与 CSV Historical 的真实/历史/不可用标签准确；
- 从数据中心送入编排后，Draft 显示稳定的 Dataset version/fingerprint；
- 缺失资产、陈旧版本或能力不匹配在可见 UI 和服务端均被拒绝；
- “送入编排”“创建实验”后仍为 `runtimeApplied=false`，没有启动 Paper Run；
- Console 无 TradeBot 页面错误，Network 无意外 401/5xx。

## Loop 编号与状态规则

- 本轮固定为 `LOOP-005`，不得覆盖或复用 LOOP-001～LOOP-004；
- 若 M2 全部通过：将 LOOP-005 标记为 `COMPLETE`，M2 标记为 `COMPLETE`，并创建
  唯一编号 `LOOP-006` 作为 M3 实验场 V1；
- 若 M2 未全部通过：将 LOOP-005 标记为 `PARTIAL`，M2 保持 `IN_PROGRESS`；后续
  收尾也必须创建新的唯一编号 `LOOP-006`，此时 M3 顺延到 LOOP-007；
- 每个新 Prompt 顶部都必须明确“浏览器要求：必需 / 不需要 / 实现后必需”。

## 最终报告格式

```text
Loop ID：LOOP-005
里程碑：M2 数据中心 V1
浏览器要求：实现后必需；实际是否完成 Chrome 验收
服务端资产目录：PASS / FAIL
Dataset version/fingerprint binding：PASS / FAIL
Validation fail-closed：PASS / FAIL
Evidence lineage：PASS / FAIL
Market Radar 真实性：PASS / FAIL
Chrome：PASS / PARTIAL / BLOCKED
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
自动化：check；test:ts x/x；build:web；diff-check
M2：COMPLETE / IN_PROGRESS
下一 Loop：LOOP-006（注明属于 M2 收尾或 M3）
Git：未 commit、未 push、未创建 PR
```

## 实际执行结果（2026-08-01）

```text
Loop ID：LOOP-005
里程碑：M2 数据中心 V1
浏览器要求：实现后必需；Chrome 验收未完成（控制通道超时后不可用）
服务端资产目录：PASS
Dataset version/fingerprint binding：PASS
Validation fail-closed：PASS
Evidence lineage：PASS
Market Radar 真实性：PASS
Chrome：PARTIAL
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
自动化：check PASS；test:ts 328/328 PASS；build:web PASS；diff-check PASS
M2：IN_PROGRESS
下一 Loop：LOOP-006（M2 收尾）
Git：未 commit、未 push、未创建 PR
```

实现与自动化范围已通过；未关闭 M2 的唯一原因是真实 Chrome 控制通道超时，未完成
桌面/窄屏、可见绑定与拒绝路径、Console 和 Network 验收。后续不得把该外部控制限制
误记为产品功能失败，也不得在没有真实 Chrome 证据时提前进入 M3。
