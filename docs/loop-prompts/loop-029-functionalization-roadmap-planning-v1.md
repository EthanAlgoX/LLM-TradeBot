# LOOP-029 — 四页产品功能化路线规划

```text
Loop ID：LOOP-029
类型：DOCUMENTATION_ONLY
浏览器要求：不需要
状态：COMPLETE / READY_FOR_F1
Git：本轮文档修改必须 commit 并 push
```

## 目标

在不实现具体模块的前提下，把已经确认的四页预览拆成有依赖顺序、可验收、可逐轮交付的真实功能路线。

## 已确认产品方向

1. 模拟交易：最多三个真实 Paper 实例，展示收益、回撤、决策和按 Artifact lineage 形成的子 Agent 对话。
2. 编排工作台：对话理解需求，LLM 返回结构化动态 DAG；前端渲染，后端校验，Apply 只创建 Strategy Draft。
3. Agent 中心：Input、Analysis、Decision、Reflection 四类；可配置数据/上游、模型、用户 Prompt、Schema、测试和版本。
4. 连接配置：管理数据与模型能力，Secret 只在后端。

## 执行顺序

```text
F1 Agent Center V1
-> F2 Connections V1
-> F3 Workbench V2
-> F4 Preflight / Backtest / Walk-Forward
-> F5 Simulation V2 / M4 integration / max 3
-> F6 Hardening
```

## 不变量

- LLM 不能返回或执行 HTML/代码，只返回严格结构化结果；
- LLM 只能引用已发布 Agent Version；
- 平台安全 Prompt、工具权限、Schema、Portfolio/Risk/Execution 不可由用户或 LLM 修改；
- Prompt/Data/Model/Graph 变化创建新版本并使旧 Evidence stale；
- 不执行 LOOP-025，不创建 Live、Canary 或交易所写入；
- 每个实现 Loop 修改后必须 commit、push，并使用新的唯一编号文档。

## 下一入口

[`LOOP-030 — F1 Agent Center Versioned Configuration V1`](loop-030-f1-agent-center-versioned-configuration-v1.md)
