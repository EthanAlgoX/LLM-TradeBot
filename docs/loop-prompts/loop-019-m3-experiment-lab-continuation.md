# LOOP-019 — M3 实验场 V1 续办

```text
Loop ID：LOOP-019
里程碑：M3 实验场 V1
状态：IN_PROGRESS
前置 Loop：LOOP-018（IN_PROGRESS）
执行环境：本地仓库 + Agent 直接控制真实 Google Chrome
浏览器要求：必需；禁止用户手工验收或 DevTools 交接
```

继续并完成 [`loop-018-m3-experiment-lab-v1.md`](loop-018-m3-experiment-lab-v1.md) 的全部要求。LOOP-018 已新增 Experiment contracts、append-only SQLite 聚合、受限 API 与工作台初版；`check`、336/336 TypeScript tests 和 Web build 已通过。真实 Chrome 已成功导航到实验场，但页面 DOM 通道超时重置，尚未完成创建、Evidence、重放、Open Class、双尺寸、Console 与 Runtime safety 验收。

必须先重新建立真实 Chrome 控制，再通过可见 UI 完成 LOOP-018 第六阶段；补足必要自动化覆盖（2/5 participant、锁定快照、可比性、artifact 篡改、replay、actor isolation 和 Candidate-only），再决定 M3 是否可关闭。不得进入 M4。
