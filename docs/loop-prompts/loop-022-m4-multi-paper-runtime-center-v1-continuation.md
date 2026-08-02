# LOOP-022 — M4 多模拟运行中心 V1（续）

```text
Loop ID：LOOP-022
前置 Loop：LOOP-021（IN_PROGRESS）
状态：PARTIAL（已执行，M4 保持 IN_PROGRESS）
```

执行结果：已完成 Deployment 的 run/cycle/trade/artifact 持久 Projection、模拟/真实无副作用切换、Simulation Overview、创建入口与五个惰性 Detail Tab；359/359 自动化和 Agent Chrome 双语言/双尺寸基础验收通过。调度器尚未接入真实 Paper 动作链，两实例交易事实隔离、close-only 与重启恢复转入唯一 [`LOOP-023`](loop-023-m4-deployment-scoped-paper-cycle-closeout-v1.md)。

继续完成 M4，且不得将其标记为 COMPLETE，直到以下缺口全部关闭：

- 将 deployment-scoped 有界调度器接入现有唯一 `Decision -> Portfolio -> Risk -> Execution` Paper cycle；每个 Deployment 使用隔离的 SQLite account、order、trace、artifact 和安全 scope。
- 对 immutable Deployment event 投影补齐持久的 run/cycle/trade/artifact 查询、actor/kind-bound cursor、lease/fencing、heartbeat、失败退避、close-only 受控平仓和进程重启恢复。
- 在交易 Agent 页实现“模拟 / 真实”无副作用分段选择器、Simulation Overview、多曲线可复现投影与五 Tab Detail；请求必须 AbortController + epoch 隔离并按 Tab 惰性分页。
- 用真实 Google Chrome 按 LOOP-021 的中文 1440×900、英文 820×760 全路径验收；不得要求用户手工操作。若 Chrome 不可用，M4 保持 IN_PROGRESS。
- 扩展自动化覆盖 API、调度、隔离、恢复、UI、负向与 Console/Network，并持续满足测试总数 >353。

已完成的基础：严格 deployment 合同、SQLite append-only definition/event、actor 隔离、独立虚拟 account ID、显式状态机、source 指纹 fail-closed、10 实例服务端上限、无重叠并发调度原语、严格 HTTP 动作边界及 358 项全量 TypeScript 测试。
