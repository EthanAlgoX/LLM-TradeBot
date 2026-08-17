# StrategyVersion 历史验证

“回测中心”使用独立的 StrategyVersion 历史验证资源，不复用旧的单股分析记录 `BacktestService`，也不连接券商或真实账户。主页面路由为 `/backtests`，旧 `/validation` 与 `/research` 仅作为兼容入口保留。

## 产品链路

1. 在策略中心复制或编辑草稿。
2. Agent 链路检查通过后，可从编辑器直接进入“回测中心”，URL 保留 `strategyId` 与 `versionId`；该步骤不强制。
3. 正式回放只能使用 StrategyVersion 自身的股票池，页面不提供覆盖入口：`marketScope` 中的固定代码可以直接回放；策略内自动选股则必须有对应区间的历史时点股票池。
4. “指定股票诊断”是页面中的独立实验入口。它允许临时填写代码回答局部研究问题，但不会写回 StrategyVersion、不会更新版本验证状态，也不能作为正式发布关联记录。
5. 服务先检查所解析股票池的本地 `stock_daily` 覆盖，缺失时通过项目现有 `DataFetcherManager` 获取真实历史日线并落库；覆盖合格后才冻结当前 StrategyVersion 完整定义和 OHLCV 输入。
6. 正式回放完成后可返回策略中心正式发布；没有运行历史回测也允许发布，但发布状态不代表已经验证有效。
7. 已发布历史版本仍可创建新的验证实验；运行中心会读取同一正式验证状态，但研究运行仍不等于交易。

## API

- `POST /api/v1/simulation/definition/validation-experiments`：创建实验并冻结输入。
- `POST /api/v1/simulation/definition/validation-experiments/{id}/execute`：同步执行确定性回放。
- `GET /api/v1/simulation/definition/validation-experiments?strategyVersionId={id}`：查询版本实验历史。
- `GET /api/v1/simulation/definition/validation-experiments/{id}`：查询单次实验。
- `GET /api/v1/simulation/definition/validation-comparison-candidates?strategyId={id}`：查询同一策略下可参与版本对比的可信正式回放。
- `POST /api/v1/simulation/definition/validation-comparisons`：按需比较两个不同 StrategyVersion 的正式回放，不另建或改写实验记录。
- `GET /api/v1/simulation/definition/strategy-versions/{id}/validation-status`：查询当前定义是否已有匹配且可信的完成实验。

正式发布请求可以选择携带 `validationExperimentId`。传入时，实验必须属于当前版本、用途为 `validation`、状态为 `completed`，冻结定义与当前定义的语义指纹一致，区间覆盖完整且冻结行情哈希校验通过；`diagnostic` 实验会被明确拒绝。省略时仍会执行 Agent 图校验、警告确认、revision 并发控制和不可变发布。

版本状态中的 `completed` 表示可信的观察性 OHLCV 回放已经完成；`validated` 只保留给未来具备明确通过门槛的完整验证结论。当前引擎不会把“执行成功”自动升级为“策略已验证有效”。旧版实验缺少冻结输入哈希时仍可查看，但标记为 `legacy_unverified`，不能作为当前定义的可信完成状态或发布关联实验；前端只展示其请求区间、实际冻结区间和引擎等审计信息，不再展示旧收益、回撤、胜率、成交或持仓。

## 版本对比

版本对比是已有正式回放的只读比较，不会重新执行策略，也不会生成第二套结果。两个实验必须属于同一策略的不同 StrategyVersion，且都必须是 `validation` 用途、状态已完成、请求区间覆盖完整并通过冻结行情哈希校验。指定股票诊断不能参与比较。

为避免把不同实验误当成公平对照，后端要求开始/结束日期、初始资金、佣金、最低佣金、滑点、成交规则、调仓频率、市场、持仓上限、候选池上限、回放引擎、方法和实际回放区间一致。通过后才返回两边的真实指标和“目标减基准”差值；系统不根据单个指标自动宣称某个版本有效。

如果两个版本消费了完全相同的冻结行情行，结果标记为“完全相同的冻结行情快照”。如果策略版本本身改变了股票池或数据，仍可在相同实验口径下比较完整版本表现，但会标记为“对齐区间的独立冻结快照”，不能用于逐标的归因。

## 回放方法

- 正式实验使用 `experimentPurpose=validation + universeMode=strategy`，且 `symbols` 必须为空；后端从 StrategyVersion `marketScope.symbols` 等字段解析固定股票池。策略配置页可在现有 `marketScope` 中选择“策略内自动选股”或“策略内固定股票池”。
- 诊断实验使用 `experimentPurpose=diagnostic + universeMode=override`，此时 `symbols` 必填。旧客户端在未传用途但传了 `symbols` 时按诊断实验兼容，不能借此获得正式验证状态。
- 策略中心执行“检查策略”时，固定股票池必须启用 K 线数据连接，且每个代码都必须已存在于 K 线输入；缺失时返回明确错误并阻止发布。进入研究运行时，固定股票池在任何策略 Agent 之前完成过滤，不再调用全市场选股器，也不会获取或分析范围外股票。
- 对策略内全市场自动选股，后端当前不会从整个本地缓存或当前上市列表反推历史股票池。若没有所选区间的时点股票池和成分变更，返回 `VALIDATION_POINT_IN_TIME_UNIVERSE_UNAVAILABLE` 且不创建实验，避免生存者偏差。
- 每个标的至少需要 21 根开始日前回看日线；请求区间内的有效 OHLCV 不少于工作日数的 85%（为法定休市日保留余量），且实际首尾行情距离请求边界均不得超过 7 天。任一标的不满足时不创建实验，也不输出绩效。
- 数据准备可以通过现有真实行情提供器补齐缺失日线；执行阶段只读取实验创建时冻结的日线，不再访问网络或当前行情。
- 信号在回放日收盘后计算，只能在下一回放日开盘成交，避免未来数据泄漏。
- 当前为只做多、全量调仓、等权分配，并执行 StrategyVersion 的 `riskPolicy.max_position_pct` 和 `screeningPolicy.maxCandidates` 上限；A 股按 100 股整数手处理，港股和美股按 1 股处理。
- 每笔成交计入配置的佣金率、最低佣金和滑点。A 股还按成交日期计算卖出印花税与过户费；这些是确定性费用假设，不代表任一券商的实际费率。
- 结果包含累计/年化收益、最大回撤、年化波动、夏普比率、胜率、交易次数、换手、资金曲线、最终持仓和逐笔回放成交。
- 行情快照保存消费行数、标的数、请求/实际日期范围、数据源、复权口径、源记录时间与 SHA-256，原始冻结日线保存在实验子表中。执行前重新计算哈希；不一致时实验失败并停止。

## 能力边界

当前引擎是策略规则的观察性 OHLCV 代理回放，只能复现价格、成交量、波动和流动性条件。它不会执行 StrategyVersion 的 Agent 图、LLM 决策、历史新闻、历史基本面、记忆策略或非 OHLCV 筛选条件；结果通过 `strategyCoverage` 明确列出已执行与省略部分，不会静默假设这些条件成立。因此当前指标不能证明完整多 Agent 策略有效。

这些成交是历史回放记录，不是订单、券商成交或模拟账户账本。系统尚未接入真实交易、订单、持仓收益运行时或风险执行引擎。
