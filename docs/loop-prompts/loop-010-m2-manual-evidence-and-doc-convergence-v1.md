# LOOP-010 — M2 用户手工证据关闭与规划文档收敛

```text
Loop ID：LOOP-010
里程碑：M2 数据中心 V1 最终收尾
状态：READY
前置 Loop：LOOP-009（PARTIAL）
执行环境：本地仓库 + 用户手工操作真实 Chrome
浏览器要求：必需，但只允许用户手工操作；Agent 禁止调用任何浏览器控制工具
推荐执行端：可访问本地仓库的新执行窗口，用户同时使用真实 Chrome
```

## 目标

用用户手工提供的真实 Chrome 可见证据关闭 M2，并在验收通过后收敛当前规划文档中的过期快照。LOOP-006～009 已反复证明 Agent Chrome 控制通道不可靠，因此本轮禁止再次尝试 Browser、Chrome、Playwright、Computer Use 或其他浏览器自动化；这不是备用路径，而是强制执行方式。

## 开始前必须遵守

1. 读取并遵守：
   - `docs/product-optimization-plan-and-progress.md`
   - `docs/product-roadmap-and-progress.md`
   - `docs/project-status-and-handoff.md`
   - `docs/next-loop-prompt.md`
   - 本 Prompt
2. 只读检查 Git 状态和 `http://127.0.0.1:5174/#data-center` 是否可达。端口由既有正确进程占用时，不终止或替换该进程。
3. 第一阶段不得修改代码或文档，不得创建提交，不得创建下一 Loop。
4. 不得调用或尝试连接任何浏览器控制工具。浏览器要求为“用户真实 Chrome 手工验收”，不是“Agent 控制 Chrome”。

## 阶段 A：首条回复只能请求用户手工验收

完成只读服务检查后，向用户发送下面两部分内容，然后等待用户回复。等待期间不得把 LOOP-010 标记为 `PARTIAL` 或结束里程碑。

### 用户操作步骤

1. 在真实 Chrome 打开 `http://127.0.0.1:5174/#data-center`，窗口设为 1440×900，切换中文；检查横向滚动、遮挡和控件可操作性。
2. 确认 Binance Public 显示 public capability、没有实时 Snapshot、状态为 `unavailable`；确认 CSV Historical 显示 Snapshot、Schema、Quality、Lineage、Dataset version 和 fingerprint。
3. 通过可见 UI 创建或选择当前 actor 的 Market/Agent Configuration Draft，绑定 CSV Historical；记录页面是否显示 Draft version 和 Dataset fingerprint。刷新后返回同一 Draft，确认绑定仍存在且 version/fingerprint 未漂移。
4. 点击“送入编排”，确认只产生 Draft/意图，没有启动 Paper Run；页面保持 `runtimeApplied=false`、Paper Only、Exchange writes OFF。
5. 将窗口改为 820×760，切换 English；检查横向滚动、遮挡和控件可操作性。
6. 打开 Chrome DevTools，清空 Console 后刷新，确认没有 TradeBot 页面 error；Network 只检查 method/path/status，确认无意外 401/5xx。不得读取、复制或回复 Token、Authorization、Cookie value、payload、response body。

### 用户回复模板

```text
LOOP-010 Chrome 手工验收
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

## 阶段 B：收到用户回复后继续同一个 Loop

### 全部 PASS

1. 将验收模式记录为 `USER_MANUAL_CHROME_VERIFIED`，把 LOOP-010 与 M2 标记为 `COMPLETE`。
2. 复核已有自动化覆盖的跨 actor、缺失资产、错误 fingerprint、capability mismatch fail-closed；无需让用户在 UI 构造攻击输入。
3. 收敛规划文档，但不得改写历史事实：
   - 更新路线图顶部日期和最新真实验证基线（Web build 以本轮实测 modules/time 为准）；
   - 删除或改写“当前浏览器列表为空”等已过期当前态描述；
   - 明确旧路线图 M0～M11 为“历史架构阶段”，当前产品执行里程碑以优化规划 M0～M7 为准；
   - 替换已经完成的旧“接下来三个 Loop”和旧 M2 实施指令；
   - 保留 LOOP-006～009 为历史 `PARTIAL` 记录，不把“未取得证据”写成产品失败。
4. 创建唯一编号 `LOOP-011`，进入 M3 实验场 V1；浏览器要求在 Prompt 中明确标注为“实现后必需”。
5. 更新 `docs/next-loop-prompt.md` 指向 LOOP-011。

### 任一项 FAIL

1. 先判断是“真实产品缺陷”还是“用户尚未完成/无法观察”。不得把缺少证据写成产品错误。
2. 对真实产品缺陷做最小修复，补充相应自动化；保持 M2 `IN_PROGRESS`。
3. 请用户只复验失败项，并在同一个 LOOP-010 中等待结果；不得提前创建内容相同的下一 Loop。
4. 只有用户明确无法继续，或缺陷无法在本轮安全修复时，才将 LOOP-010 标记为 `PARTIAL`，并创建唯一编号 LOOP-011 继续 M2；不得进入 M3。

## 自动化与安全边界

- 最终修改完成后必须运行：`npm run check`、`npm run test:ts`、`npm run build:web`、`git diff --check`。
- 唯一动作链保持 `Decision -> Portfolio -> Risk -> Execution`。
- Dataset Binding、“送入编排”和页面切换不得启动 Paper Run、修改 Runtime 或产生交易所写入。
- 保持 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。
- 禁止 `reset`、`checkout`、`clean` 等破坏性 Git 操作。
- 不修改、暂存或提交 `data/local-paper-workspace*`、数据库、Token、Secret、环境凭据或本地运行产物。

## Git 快照要求

- 代码或文档发生任何修改后，最终报告前必须创建范围明确的 commit，并 push 当前分支到 `origin`；即使结果为 `PARTIAL` 也不例外。
- 提交前检查 staged diff，确保只有本轮代码、测试和文档。
- push 必须验证远端 branch ref 等于本地 HEAD；报告 commit hash、branch 和 push 结果。
- 若 push 因认证失败，保留本地 commit并报告精确阻塞，认证恢复后优先完成 push。
- 不创建 PR，除非用户明确要求。

## 最终报告格式

```text
Loop ID：LOOP-010
验收模式：USER_MANUAL_CHROME_VERIFIED / PARTIAL
浏览器要求：必需；用户已使用真实 Chrome / 未完成
中文 1440×900：PASS / FAIL
英文 820×760：PASS / FAIL
资产真实性标签：PASS / FAIL
CSV 正向 UI 绑定与刷新恢复：PASS / FAIL
负向 fail-closed：PASS / FAIL
Console / Network：PASS / FAIL
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
文档收敛：PASS / NOT RUN
自动化：check；test:ts x/x；build:web；diff-check
M2：COMPLETE / IN_PROGRESS
下一 Loop：唯一编号及所属里程碑
Git：commit <hash>；branch <name>；push PASS / FAIL；未创建 PR
```
