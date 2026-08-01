# Next Loop Prompt Index

```text
当前 Loop：LOOP-008
里程碑：M2 数据中心 V1 收尾
状态：READY
前置 Loop：LOOP-007（PARTIAL）
执行环境：本地仓库 + 真实 Chrome；用户手工交接优先
浏览器要求：必需
推荐执行端：Chrome ChatGPT
原因：实现和自动化已经完成；LOOP-006、LOOP-007 连续受 Chrome 控制通道阻塞，本轮必须在控制失败时转为同一 Chrome 的用户手工验收，不能继续原样重试
Git 要求：任何代码或文档修改均须 commit 并 push；最终报告包含 commit hash、分支和 push 结果
```

请执行唯一编号的完整 Prompt：

[`loop-prompts/loop-008-m2-data-center-chrome-closeout-v2.md`](loop-prompts/loop-008-m2-data-center-chrome-closeout-v2.md)

本文件只作为当前 Loop 索引，不承载完整任务。
