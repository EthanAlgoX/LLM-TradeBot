# LOOP-026 — Strategy App 产品预览框架 V1

Loop ID：LOOP-026  
阶段：R0 Strategy App 产品预览框架  
状态：READY（PROTOTYPE_ONLY / PRODUCT_REVIEW_FIRST）  
前置基线：LOOP-024（M5 COMPLETE）  
暂停任务：LOOP-025（M6 授权门槛，保留文件但本轮不执行）  
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome  
浏览器要求：**实现后必需**；只接受 Agent 直接操作真实 Chrome，禁止用户手工验收、截图或 DevTools 交接  
验收模式：PRODUCT_SHELL_AND_AGENT_CHROME_VERIFIED  
Git 要求：任何代码或文档修改都必须 commit 并 push；不创建 PR

## 本轮背景

当前 M0～M5 已形成历史会话、数据中心、实验场、多 Paper Runtime 和只读 Shadow/Promotion Recommendation。产品方向现调整为：

> 用户通过自然语言描述投资目标，系统从数据中心、Agent 中心和受约束 Strategy Blueprint 中推荐 Strategy App Proposal；用户确认后才创建 Strategy App Version，再进入实验、Paper 和 Shadow。

对话系统是 **Strategy Advisor（策略助手）**，不是让普通用户拖拽或自然语言直连节点的 Agent 编排器。后台 Pipeline Graph、Draft、Validation 和 Runtime 边界继续保留，但第一版产品预览只展示只读结构。

本轮优先验证产品框架是否符合需求，不追求每个功能完整。参考 `../reference/nofx` 的 Market/Data、Strategy Studio、Competition 和 Dashboard 产品分工，但不得复制其页面；继续使用 TradeBot 当前设计语言和既有组件模式。

## 本轮唯一目标

在现有 Web 中快速交付一个可点击、可理解、明确标注为原型的 Strategy App 产品框架，使产品负责人可以验证：

1. 页面命名和信息架构是否正确；
2. “描述需求 → 查看推荐 → 创建应用 → 查看详情 → 去实验场 → 查看模拟槽位”的流程是否合理；
3. 数据中心、Agent 中心、策略助手、Strategy App、实验场和交易中心的边界是否清楚；
4. 一个未来 Live Champion 与最多三个 Paper Challenger 的产品关系是否直观。

本轮不是后端能力建设，也不是视觉细节终稿。不得为了“看起来完整”虚构真实服务能力。

## 不可突破的范围与安全边界

- 不实现或启用 Live、Canary、真实账户、交易所写 Adapter、Secret、Champion 替换、持仓迁移或 Runtime Apply。
- 不新增 Paper Start/Stop/Archive、订单、持仓、账户、cycle、risk/safety、Artifact 或 Shadow 写入入口。
- 不修改现有 M4/M5 scheduler、deployment、account、close-only、Shadow 或 Recommendation 语义。
- 保持 `runtimeApplied=false`、`exchangeWriteAllowed=false`、Paper Only；未来 Live 区域必须显示 `LIVE UNAVAILABLE / NOT AUTHORIZED / Exchange writes OFF`。
- 不实现真实 LLM 推荐、任意 Graph 生成、Agent 代码生成、Strategy Blueprint 匹配、Strategy App 后端物化、API、SQLite 或持久化。
- 不用 localStorage、sessionStorage、Cookie 或运行数据库伪造产品闭环；原型交互状态只保留在当前页面内存，刷新后允许恢复为初始 Sample 状态并明确说明。
- 不创建轮询、常驻 timer、后台 worker 或额外启动程序；预览页面不得增加开发服务启动负担。
- 不读取、修改或提交 `data/local-paper-workspace*`、SQLite、Token、日志、截图、浏览器缓存或其他本地运行产物。
- 所有非真实服务内容必须显式显示 `PROTOTYPE`、`SAMPLE`、`NOT CONNECTED` 或 `UNAVAILABLE`；不得混入现有真实 Data/Paper/Shadow 事实列表并伪装成服务端数据。

## 实施原则

1. 先检查现有 `apps/web` 的导航、样式、响应式、国际化和页面挂载方式，复用当前设计系统，不重写应用外壳。
2. 尽量将新增原型状态收敛到少量、可移除的 Web 模块；不要把大量 Sample HTML 继续堆入 `main.ts`。
3. 保留既有 URL/View 和 M0～M5 页面可达性；如调整导航文案或分组，旧 hash 必须有稳定映射，不破坏深链接。
4. 第一轮只做足够表达产品方向的页面和主路径；次级按钮允许显式 disabled/NOT CONNECTED，不做伪实现。
5. Workflow Graph 只读展示，不提供拖拽、连线或任意节点编辑。
6. Risk、Execution、Close-only 等系统组件显示为锁定能力，不显示为可编辑 Prompt Agent。

## 必须交付的产品框架

### 1. 产品导航与策略分组

至少使以下逻辑页面可达，并保持当前 TradeBot 视觉语言：

- 总览；
- 策略助手；
- 我的策略应用；
- Agent 中心；
- 数据中心；
- 实验场；
- 交易中心。

可将“策略助手 / 我的应用 / Agent 中心 / 数据中心”归入同一策略分组，但窄屏导航必须仍然清楚可达。不要在本轮重做 Connections、Activity 或既有系统页面。

### 2. 总览框架

展示明确标注的 Sample 摘要：

- Market Radar 摘要；
- 最近 Strategy App；
- 正在实验的应用；
- Simulation Capacity（例如 `2 / 3 Running`）；
- 数据源和 Agent 健康摘要；
- 最近决策/晋升建议入口。

不得将 Sample 市场数值冒充实时行情。已有真实来源维度应继续使用原有真实性标签。

### 3. 策略助手（Strategy Advisor）

保留当前历史会话产品能力的入口或布局语义，但将新产品主任务表达为“描述目标并获得 Strategy App 推荐”。至少提供三个 Sample 场景：

- 港股低风险趋势与财报；
- 美股财报事件；
- 加密趋势。

页面需要演示：

- 用户需求；
- 结构化 Strategy Intent 摘要；
- 必要澄清项；
- 1～3 张 Strategy App Proposal 卡；
- 推荐理由、数据、Agent、风险、频率、假设、缺口和 Evidence 状态；
- `查看详情`、`调整需求`、`创建策略应用`。

对话只是 Sample 交互，不调用真实 LLM，不创建真实 Draft/Runtime。点击“创建策略应用”只在当前内存创建一个 `PROTOTYPE` 应用并进入详情。

### 4. 我的策略应用

提供清楚的列表/卡片框架，允许筛选或识别：

- Draft；
- Needs Configuration；
- Validated；
- Experimenting；
- Paper Eligible；
- Paper Running；
- Shadow Observed；
- Archived。

应用和历史版本概念上不限数量；只有 active Paper Simulation 受三个槽位限制。Sample 应用必须与真实服务端 Strategy/Paper 事实视觉上明确分隔。

### 5. Strategy App 详情

至少提供以下只读 Tab/Section：

- 概览；
- Agent 组成；
- 数据；
- 策略逻辑；
- 风险与运行配置；
- Evidence；
- 版本。

只读策略逻辑需要表达：

```text
Input -> Analysis -> Decision -> Portfolio -> Risk -> Execution
                                              -> Result -> Reflection
```

其中 Risk/Execution 显示为系统锁定。详情页提供“去实验场”入口，但不得启动真实实验任务；只导航到现有实验场并带可见的 `PROTOTYPE / NOT CONNECTED` handoff context。

### 6. Agent 中心

提供统一页面和分类：

- 输入 Agent；
- 分析 Agent；
- 决策与反思 Agent。

Sample 卡片展示：名称、用途、类型、支持市场、输入/输出、版本、状态和应用引用数。支持分类切换、基本搜索/筛选和只读详情。第一轮不实现 Agent 创建、Prompt 保存、模型配置、发布或后端版本管理；对应操作必须 disabled 或标记 `NOT CONNECTED`。

明确区分 Data Source/Dataset 与 Input Agent：数据资产是原料，Input Agent 是清洗、聚合、结构化或特征加工能力。

### 7. 数据中心与 Market Radar 框架

保留现有 M2 真实数据中心，不回退 CSV Binding、Schema、Quality 和 Lineage。可在其上补充清楚的信息架构或预览入口：

- Market Radar；
- Sources；
- Datasets；
- Data Products；
- Quality；
- Lineage。

Market Radar Sample 与真实 Data Asset 必须显式区分；不能将 NOFX/Vergex 信号写成 TradeBot 已接入的真实来源。

### 8. 实验场联动

保留 M3 现有真实实验场。只增加 Strategy App 作为未来比较对象的可见产品语义或 handoff 卡，不修改 Backtest/Walk-Forward/Candidate 后端，不生成 Sample Evidence 冒充真实 Artifact。

### 9. 交易中心与三个 Simulation Slot

保留 M4/M5 真实 Paper/Shadow 页面和安全边界，同时在产品框架中明确表达：

- 未来每个账户 Scope 最多一个 Live Champion；当前为 `NOT AUTHORIZED`；
- 每个 Workspace 最多三个同时 active 的 Paper Challenger；
- Strategy App 和历史版本数量不限；
- 停止/归档实例不占 Simulation Slot；
- 第四个启动请求在产品层必须被禁止，并提示先停止或归档一个实例；本轮不调用真实 Start/Stop。

三个槽位应清楚展示：

- Strategy App 名称与版本；
- Running/Available 状态；
- 收益与回撤 Sample（明确标注）；
- 今日 Token / 上限；
- 预计成本；
- 下一周期；
- Runtime/数据健康；
- Promotion 状态。

对比图和选择器在产品预览中最多显示三个 Challenger，不再表达最多五条。Shadow 是按需/有界证据，不额外占 Simulation Slot。

## 主路径交互验收

以下路径必须在浏览器中真实可点击完成，且不调用任何交易或持久化副作用：

```text
进入策略助手
-> 选择 Sample 需求
-> 查看 Strategy Intent 和推荐卡
-> 打开推荐详情
-> 点击创建 Strategy App
-> 进入 Prototype 应用详情
-> 返回“我的策略应用”并看到当前内存中的应用
-> 点击去实验场并看到明确 handoff
-> 打开交易中心并看到 Live unavailable + 最多三个 Simulation Slot
```

同时验证：

- Agent 中心三类 Tab、搜索/筛选和详情；
- 数据中心现有真实资产仍可达；
- Strategy App 七个 Tab；
- 页面快速切换无串台、无重复 listener、无自触发重绘；
- 刷新后 Sample 状态恢复初始值，且不会伪称已持久化；
- 现有 M3、M4、M5 真实页面入口没有被原型遮挡或替换。

## 性能与实现护栏

- 不新增全局轮询或短间隔刷新；原型页面应按进入页面惰性挂载并正确清理事件。
- 不为三个槽位启动三个进程、worker、timer 或模型调用；它们只是本轮产品预览。
- 列表和长内容有界；不能通过一次性渲染大量历史、JSON 或净值点制造 DOM 膨胀。
- 820px 宽度不得出现横向页面滚动；卡片、Tab、状态和操作不得互相遮挡。
- 使用语义化按钮、Tab、label 和可见键盘焦点；不可点击内容不要伪装成主按钮。

## 自动化验证

至少执行并记录：

```text
npm run check
npm run test:ts
npm run build:web
git diff --check
```

为新增纯函数、状态转换或容量规则补少量高价值测试，至少覆盖：

- 最多三个 active simulation slot；
- 第四个启动意图在产品状态层被拒绝且没有 Runtime 调用；
- Sample/Prototype 与真实状态标签不会混淆；
- Strategy App 创建只修改页面内存状态；
- 切换应用/Agent/Tab 时陈旧异步响应不能覆盖当前视图（若有异步读取）。

不得为了提高测试数扩展无关后端实现。

## Agent Chrome 验收

浏览器验收为本轮必需项。执行 Agent 必须先读取并使用 `chrome:control-chrome` skill，由 Agent 直接操作真实 Google Chrome；禁止要求用户点击、截图、读取 DevTools 或报告 PASS/FAIL，也禁止改用人工验收。

至少验证：

1. 中文 1440×900：完整主路径、所有核心页面和三个 Simulation Slot；
2. 英文 820×760：无横向滚动、无遮挡、导航和七个详情 Tab 可用；
3. 快速 A/B 页面和应用切换不串台；
4. 刷新后原型重置说明正确；
5. 现有 Data Center、Experiment、Paper/Shadow 入口仍可达；
6. Console 无 TradeBot 页面 error；若 Console clear 或 Network 读取能力不可用，记录 `TOOL_UNAVAILABLE`，不得改为人工补验；
7. 全程确认 `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`，没有新增交易请求。

## 文档与 Git

- 将本轮产品方向和明确的 Prototype/Real 边界更新到产品计划、路线图和交接文档；历史事实保留，不改写 LOOP-025。
- 完成后把 `docs/next-loop-prompt.md` 更新为 `AWAITING_USER_PRODUCT_REVIEW`。在用户确认预览前，不得自行创建或实现详细后端 Loop，也不得恢复 M6。
- 不提交本地运行数据、SQLite、Token、日志、截图、浏览器缓存或构建产物。
- 所有代码和文档修改通过验证后 commit 并 push 当前分支；不创建 PR。

## 关闭规则

仅当页面框架、核心点击流程、三槽位表达、Prototype/Real 标签、自动化和双尺寸 Agent Chrome 均通过，且没有新增后端/Runtime/交易副作用时，才可将 LOOP-026 标记为 `COMPLETE`。

本轮完成只表示“产品框架可供评审”，不表示 Agent Center、Strategy Advisor、Strategy App、Blueprint、Token Budget、Live 或 Promotion 详细功能已经完成。用户评审后再决定唯一编号的下一 Loop。

## 最终报告模板

```text
Loop ID：LOOP-026
验收模式：PRODUCT_SHELL_AND_AGENT_CHROME_VERIFIED / IN_PROGRESS
浏览器要求：必需；Agent 是否已使用真实 Chrome
产品导航：PASS / FAIL
策略助手推荐主路径：PASS / FAIL
我的策略应用与详情：PASS / FAIL
Agent 中心：PASS / FAIL
数据中心真实性边界：PASS / FAIL
实验场 handoff：PASS / FAIL
Live unavailable + 3 Simulation Slots：PASS / FAIL
Prototype / Sample 标签：PASS / FAIL
中文 1440×900：PASS / FAIL
英文 820×760：PASS / FAIL
Console：PASS / FAIL / TOOL_UNAVAILABLE
Network：PASS / FAIL / TOOL_UNAVAILABLE
Runtime safety：runtimeApplied=false；Paper Only；exchangeWriteAllowed=false
自动化：check；test:ts；build:web；diff-check
产品框架：READY_FOR_USER_REVIEW / IN_PROGRESS
下一步：AWAITING_USER_PRODUCT_REVIEW（不得擅自进入 M6）
Git：commit hash；branch；push 结果；未创建 PR
```
