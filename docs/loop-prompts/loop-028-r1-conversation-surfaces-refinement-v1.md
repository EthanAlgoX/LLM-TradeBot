# LOOP-028 — R1 模拟与编排对话面细化

```text
Loop ID：LOOP-028
浏览器要求：必需，由 Agent 直接操作真实 Chrome，禁止用户手工代验
交付边界：PROTOTYPE_ONLY / PAGE_MEMORY_ONLY
状态：COMPLETE / AWAITING_USER_PRODUCT_REVIEW
```

## 目标

1. 从 Git 历史恢复模拟交易中的子 Agent 多轮语义对话；每条输出显示轮次、生成时间、上游回复和下游 Agent。
2. 将编排工作台从“左对话、右固定流程”改为“完整对话为主”；每次助手回复内嵌当次动态 Agent 拓扑和“应用此方案”。
3. 应用方案后展示预上线检查、回测和模拟槽位门槛，但不执行真实后端动作。

## 已完成

- 模拟页支持 SLOT 01 / SLOT 02 对话切换，沿用原 Runtime Artifact lineage 的表达方式；
- 港股、美股财报、加密趋势返回不同 Agent 数量、分支与汇聚；
- 自然语言修改后在聊天线程追加新的推荐，不再维护固定右栏 Workflow；
- 应用方案只创建页面内存 Prototype，三个后续门槛保持 Pending；
- `runtimeApplied=false`、Paper Only、`exchangeWriteAllowed=false`。

## 验收

- Chrome 中文 1440×900：模拟对话、动态 Crypto 推荐、应用门槛 PASS；
- Chrome 820×760：`scrollWidth=clientWidth=820`、US Earnings Dialogue 切换 PASS；
- Console error：0；
- `npm run check`、受影响测试、`npm run build:web`、`git diff --check`：PASS。

## 后续门禁

继续等待用户产品评审。未经确认不得接入真实 LLM 推荐、Strategy App 持久化、Preflight/Backtest 执行、Runtime Apply、Live 或交易所写入。
