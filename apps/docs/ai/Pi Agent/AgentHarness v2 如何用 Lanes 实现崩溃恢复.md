---
createdAt: '2026-08-09 22:15'
order: 11
draft: true
---

# AgentHarness v2 如何用 Lanes 实现崩溃恢复

v1 解决了持久化编排的基本问题，但仍难以覆盖「进程恰好在副作用边界崩溃」的情况。AgentHarness v2 将一次运行拆成可以记录、恢复和重放的 Durable Run，并用 Lane 表示并发工作在 Session Tree 中的位置。

本文以 `packages/agent/docs/harness-v2.md` 为主要阅读入口。v2 已取代 v1，文中会明确区分设计目标、已落地的公共契约和仍属于 `Implementation todo` 的部分，避免把设计文档当成完整实现。

## v2 解决了什么问题

v2 要保证的不是「进程重启后重新调用一次 prompt」，而是每个可能被崩溃打断的操作都能被判断和恢复：

- **Durable Runs**。接受一个 prompt 后，运行本身成为持久化操作，重启后可以从记录继续；
- **Durable Responses**。assistant 响应在分类、重试、压缩或失败处理前先完整写入，避免只保存半段流；
- **No partial outcomes**。崩溃后的可见状态要么操作尚未发生，要么恢复能够完成它，不留下无法判断的中间结果；
- **Single writer**。一个 Session 同时只有一个 Harness 写入，多个 Lane 的操作可以并行交错；
- **可观测和可测试**。每个副作用都经过显式边界，测试可以在边界前暂停并模拟关闭与重启。

这些目标把「运行逻辑」变成「可恢复的操作过程」，也是 v2 与普通 Agent Loop 的根本区别。

## Durable Runs 如何记录运行过程

v2 把接受和执行分开。外部请求先被接受并写入操作记录，之后才开始模型、工具或摘要生成：

```d2 fold
direction: right

prompt: "接受 prompt"
accepted: operation_started
step: step_started
attempt: attempt_started
effect: "Provider / Tool effect"
commit: "durable result"
finish: operation_finished
recover: 崩溃后恢复

prompt -> accepted -> step -> attempt -> effect -> commit -> finish
accepted -> recover: 进程在任意边界退出
recover -> step: "从最后一个 durable boundary 继续"
```

每次模型请求或延迟获取都有稳定的 `stepId` 和编号的 attempt。响应必须先以完整结果写入，再决定是完成、重试、压缩、暂停、失败还是中止。流式过程可以是进程内的临时状态，但不能把半个 assistant 响应当作已经持久化的最终事实。

如果副作用已经发生但结果没有记录，恢复逻辑必须依据已持久化的准备记录决定重试、补写合成结果或明确失败，而不能盲目重复可能产生副作用的动作。

## Session 的四个组成部分

v2 将一个 Session 拆成四个相互关联但职责不同的持久化部分：

| 部分 | 作用 | 是否属于对话树 |
| --- | --- | --- |
| Tree | 保存消息、Compaction、分支摘要和扩展 entry，`parentId` 连接对话历史 | 是 |
| Lanes | 保存命名的 leaf 和这个位置上的工作 | 否，Lane 指向 Tree |
| Lane records | 保存操作、步骤、尝试、队列和配置变更 | 否 |
| Global facts | 保存 Session 名称、标签和应用级事实，最新写入生效 | 否 |

四部分共享单调递增的序列号。Tree 负责「对话走到哪里」，Lane records 负责「工作做到哪里」，Global facts 负责「Session 当前有哪些共享事实」。它们不能被压缩成一条只含消息的日志，否则恢复时无法区分对话历史和未完成操作。

## Lanes 如何替代 Ref

Lane 是一个命名的树位置加上在该位置上串行化的工作。每个 Session 至少有 `main` Lane，应用也可以用 Slack thread、邮件 thread 等外部身份创建其它 Lane。

一个 Lane 具有四类状态：

- 当前 leaf，新的 Tree entry 从这里继续并移动它；
- 操作日志，同一 Lane 最多有一个未完成 operation；
- Steering、Follow-up 和 next-run 消息队列；
- 一份完整的 Lane configuration，包括模型、thinking level 和启用的工具。

不同 Lane 可以并行运行，但仍由同一个 Harness 作为 single writer 写入共享 Session。两个 Lane 从同一 leaf 继续时，下一次追加自然形成两个子分支，不需要互相修改对方的历史。某个 Lane 崩溃后恢复为 suspended，不应该阻塞其它 Lane。

## Operation、Step 与 Attempt

v2 把三类工作统一为 Operation：

| Operation | 作用 |
| --- | --- |
| Run | 接受一个 prompt，并包含工具调用、Steering、Follow-up 和自动压缩，直到没有待处理工作 |
| Compaction | 用摘要 entry 替换旧上下文的模型投影 |
| Navigation | 移动 Lane 的 leaf，可选择为被放弃分支生成摘要 |

Operation 下面还有两个层次：

- Step 是一次稳定的逻辑工作单元，例如一次 assistant generation、Compaction 或 Branch Summary；
- Attempt 是一个 Step 的具体 Provider 尝试，带有编号、重试策略和同一份配置快照。

`operation_started`、`step_started`、`attempt_started` 和 `operation_finished` 等记录让恢复逻辑知道当前操作已经越过哪些边界。一个 operation 只有一个终态记录，完成、失败和中止都必须可区分，Compaction 或 Navigation 还可能明确记录为 declined。

## 工具调用的三个阶段

v2 将工具调用拆为 clearance、effect 和 finalization 三个阶段，使 `tool_started` 可以成为「允许执行」与「产生副作用」之间的持久化边界：

```d2 fold
direction: right

call: AgentToolCall
prepare: "prepareToolCall\n查找、校验、before_tool"
start: "tool_started\n持久化有效参数"
execute: "executeToolCall\n产生副作用"
finalize: "finalizeToolCall\nafter_tool patch"
result: "tool result\n写入并通知"

call -> prepare -> start -> execute -> finalize -> result
```

- `prepareToolCall` 负责工具查找、参数准备、schema 校验、`before_tool` 和中止检查，不启动副作用；
- `executeToolCall` 执行已准备好的工具，失败也转换为结果，不把异常留在恢复边界之外；
- `finalizeToolCall` 执行 `after_tool` 的字段级 patch，确定最终的 `content`、`details`、`isError` 和 `terminate`。

批处理驱动器先按 assistant 响应中的源顺序完成准备和 `tool_started` 写入。并行模式可以同时执行多个已准备工具，但结果最终仍按源顺序写入；串行模式则让每个工具完整经过三阶段后再处理下一个。这样恢复时不需要重新执行已经完成的 clearance，也能知道哪些副作用已经开始。

## 结构性 Hooks 与兼容边界

v2 的 Hook 不只是工具拦截，还包括会改变持久化结构的决策：

| Hook | 作用 |
| --- | --- |
| `before_tool` / `after_tool` | 阻止、调整参数或修改工具结果 |
| `before_compaction` | 拒绝压缩、提供摘要，或让 Provider 生成摘要 |
| `before_navigation` | 拒绝导航、提供分支摘要，或让 Provider 生成摘要 |

事件负责观察，Hook 负责改变执行。Hook 如果直接提供结构性结果，Harness 会先把完整结果写入 `step_started`，恢复时就不会再次调用同一个决策 Hook。

v2 仍然承诺兼容低层 `agentLoop`、`agentLoopContinue`、`runAgentLoop` 和 `AgentEventSink` 的公共接口。兼容的含义是旧循环可以继续运行，不代表旧循环自动拥有 Durable Runs；持久化能力只存在于新的 Harness 组合层。

## Fork、Subagent 与 Telemetry

Fork 用于复制一个一致的已提交 Session 快照，可以复制一条分支或整棵 Tree，但不会复制源 Session 的 Lane records 和未完成操作。新 Session 通过 `parentSessionId` 保留父子关系，适合隔离实验、导出或构建 Subagent。Harness 本身不规定 Subagent 工具，父子调度属于应用层策略。

Telemetry 也保持独立边界。Harness 通过显式的 `TelemetryContext` 传递调用上下文，不依赖全局当前 span 或 `AsyncLocalStorage`；核心提供契约和内存参考实现，是否接入具体导出器由应用决定。

## v1 与 v2 的设计差异

| 维度 | v1 | v2 |
| --- | --- | --- |
| 并发位置 | Ref 指向 Session leaf | Lane 同时携带 leaf、队列和操作日志 |
| 持久化重点 | 记录对话和部分编排事实 | 每个操作、步骤、尝试和副作用都有 durable boundary |
| 崩溃处理 | 根据日志判断并恢复，边界不完整 | 以 No partial outcomes 为目标，恢复未完成 operation |
| 工具执行 | Agent Loop 负责整体工具调用 | prepare、execute、finalize 三阶段可单独恢复 |
| 设计状态 | v1 文档已被取代 | v2 仍需结合 commit、源码和测试判断实现状态 |

v2 的关键不是增加更多名词，而是把「发生过什么」和「接下来必须做什么」都变成可持久化事实。这样，进程重启不再只是重新加载消息，而是重新驱动一个有明确记录的操作。

## 小结

AgentHarness v2 用四元 Session 保存对话树、Lane 位置、Lane 操作日志和全局事实，用 Operation、Step、Attempt 记录可恢复的工作单元，再把工具拆成可持久化的三阶段。Lanes 允许并行工作，single writer 保证写入一致，Durable Runs 则把崩溃恢复从约定变成操作边界。
