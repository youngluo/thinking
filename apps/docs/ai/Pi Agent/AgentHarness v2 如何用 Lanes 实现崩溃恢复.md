---
createdAt: '2026-08-09 22:15'
order: 12
draft: true
---

# AgentHarness v2 如何用 Lanes 实现崩溃恢复

v1 描述了持久化编排的基本问题，但没有完整覆盖「进程恰好在副作用边界崩溃」的情况。AgentHarness v2 的目标是把一次运行拆成可记录、恢复和重放的 Durable Run，并用 Lane 表示并发工作在 Session Tree 中的位置。

本文以 Pi `v0.84.1` 的 Durable AgentHarness 设计与源码为基准。v2 已取代 v1，但稳定版仍处于分阶段实现中：Session 与存储基础、公共类型和 `AgentHarness` scaffold 已存在，主要运行与恢复能力尚未完整落地。下文先解释目标设计，再单独说明实现状态。

## v2 解决什么

v2 希望每个可能被崩溃打断的操作都能被判断和恢复，不能只在进程重启后重新调用一次 prompt：

- **Durable Runs**。接受一个 prompt 后，运行本身成为持久化操作，重启后可以从记录继续；
- **Durable Responses**。assistant 响应在分类、重试、压缩或失败处理前先完整写入，避免只保存半段流；
- **No partial outcomes**。崩溃后的可见状态要么操作尚未发生，要么恢复能够完成它，不留下无法判断的中间结果；
- **Single writer**。一个 Session 同时只有一个 Harness 写入，多个 Lane 的操作可以并行交错；
- **可观测和可测试**。每个副作用都经过显式边界，测试可以在边界前暂停并模拟关闭与重启。

这些是 v2 的设计目标，不代表 `v0.84.1` 已经完整实现。它们把「运行逻辑」改写为「可恢复的操作过程」，也是 v2 与普通 Agent Loop 的根本区别。

## Durable Runs 如何记录运行过程

v2 把接受和执行分开。外部请求先被接受并写入操作记录，之后才开始模型、工具或摘要生成：

```d2 fold
direction: right

prompt: "接受 prompt"
accepted: operation_started
step: "逻辑 Step"
attempt: "step_attempt\n第 n 次尝试"
effect: "Provider / Tool effect"
commit: "durable result"
finish: operation_finished
recover: 崩溃后恢复

prompt -> accepted -> step -> attempt -> effect -> commit -> finish
accepted -> recover: 进程在任意边界退出
recover -> attempt: "从最后一个 durable boundary 继续"
```

每个可重试的模型步骤都通过 `step_attempt` 记录步骤类型、attempt 编号和预分配的结果 entry。一次 attempt 可以发起多个 Provider 请求，但响应必须先以完整结果写入，再决定是完成、重试、压缩、暂停、失败还是中止。流式过程可以是进程内的临时状态，但不能把半个 assistant 响应当作已经持久化的最终事实。

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

模型生成与摘要生成还会继续拆成两个层次：

- Step 是一次稳定的逻辑工作单元，例如一次 assistant generation、Compaction 或 Branch Summary；
- Attempt 是一个 Step 的具体 Provider 尝试，带有编号、重试策略和同一份配置快照。

`operation_started`、`step_attempt`、`tool_started` 和 `operation_finished` 等记录让恢复逻辑知道当前操作已经越过哪些边界。一个 operation 只有一个终态记录，完成、失败和中止都必须可区分，Compaction 或 Navigation 还可能明确记录为 declined。

已开始产生副作用的工具调用也是一个持久化 Step，但不使用 `step_attempt`。`tool_started` 打开这个 Step，对应的 tool-result entry 将它闭合，恢复逻辑据此判断是否需要重放或补写中断结果。

## 工具执行的持久化边界

目标设计将工具调用拆为 clearance、effect 和 finalization 三个阶段，使 `tool_started` 成为「允许执行」与「产生副作用」之间的持久化边界：

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

批处理驱动器按 assistant 响应中的源顺序完成准备和 `tool_started` 写入。并行模式可以同时执行多个已准备工具，但结果仍按源顺序写入；串行模式则让每个工具完整经过三阶段后再处理下一个。

恢复时会检查 `tool_started.replay` 和当前工具声明。两者都为 `safe` 才能重新执行未完成工具；否则写入合成的 interrupted 结果。`v0.84.1` 的低层 Agent Loop 已有 prepare、execute、finalize 边界，但 Harness 内带持久化记录和恢复语义的三阶段驱动仍列在后续实现任务中。

## Hooks 与恢复语义

v2 的 Hook 不只是工具拦截，还包括会改变持久化结构的决策：

| Hook | 作用 |
| --- | --- |
| `before_tool` / `after_tool` | 阻止、调整参数或修改工具结果 |
| `before_compaction` | 拒绝压缩、提供摘要，或让 Provider 生成摘要 |
| `before_navigation` | 拒绝导航、提供分支摘要，或让 Provider 生成摘要 |

事件负责观察，Hook 负责改变执行。Hook 结果只有写入对应 record 或 entry 后才变得持久；崩溃发生在提交前时，Hook 可能再次运行。包含网络请求、文件写入等外部副作用的 Hook 必须自行保证幂等，例如使用 operation ID 作为去重键。

`before_run` 的结果写入 `operation_started`，`before_tool` 的有效参数写入 `tool_started`，`after_tool` 的最终结果写入 tool-result entry。恢复时只重跑尚未有持久化结果的工作，不能把 Hook 调用本身视为 exactly-once。

## 扩展能力与兼容边界

v2 仍保留低层 Agent Loop 作为兼容路径，但旧循环不会自动获得 Durable Runs。旧的 coding-agent v3 JSONL Session 只要求能够打开并以 idle 状态恢复；coding-agent 本身迁移到新 Harness 不在 v2 的兼容承诺中。

Fork 用于复制一个一致的已提交 Session 快照，可以复制一条分支或整棵 Tree，但不会复制源 Session 的 Lane records 和未完成操作。新 Session 通过 `parentSessionId` 保留父子关系，适合隔离实验、导出或构建 Subagent。Harness 本身不规定 Subagent 工具，父子调度属于应用层策略。

Telemetry 也保持独立边界。Harness 通过显式的 `TelemetryContext` 传递调用上下文，不依赖全局当前 span 或 `AsyncLocalStorage`；核心提供契约和内存参考实现，是否接入具体导出器由应用决定。

## 稳定版落地状态

`v0.84.1` 已导出 Harness 的公共类型、Result 与 tagged errors、Session Tree、记录模型、内存存储、部分 JSONL/SQLite 基础和 `AgentHarness` scaffold。源码中的运行方法仍清楚地区分可用与未完成部分：

| 能力 | `v0.84.1` 状态 |
| --- | --- |
| Session、entry、record 与存储基础 | 已有实现与测试基础 |
| Harness 配置读取和少量 scaffold-safe 状态 | 可用 |
| `prompt()`、`resume()`、Lane 管理与 watch | 仍抛出 `HarnessNotImplemented` |
| Hooks、Durable Run、工具恢复与完整自动驱动 | 仍在实现计划中 |

因此，这篇文章用于理解当前稳定版已经公开的目标架构和实现边界，不应把设计文档中的完整流程当作可直接用于生产的能力。开发新产品时，应逐项以稳定标签下的源码和测试确认可用范围。

## v1 与 v2 的设计差异

| 维度 | v1 | v2 |
| --- | --- | --- |
| 并发位置 | Ref 指向 Session leaf | Lane 同时携带 leaf、队列和操作日志 |
| 持久化重点 | 记录对话和部分编排事实 | 每个操作、步骤、尝试和副作用都有 durable boundary |
| 崩溃处理 | 根据日志判断并恢复，边界不完整 | 以 No partial outcomes 为目标，恢复未完成 operation |
| 工具执行 | Agent Loop 负责整体工具调用 | prepare、execute、finalize 三阶段可单独恢复 |
| 设计状态 | 已被取代的历史方案 | 当前目标设计，稳定版仍在分阶段实现 |

v2 把「发生过什么」和「接下来必须做什么」都变成可持久化事实。进程重启后，Harness 不只重新加载消息，还要重新驱动一个有明确记录的操作。

## 小结

AgentHarness v2 用四元 Session、Lane、Operation 和持久化意图描述 Durable Runs，并为工具副作用定义明确恢复策略。`v0.84.1` 已具备公共契约和部分基础设施，但主要运行与恢复流程尚未完整实现。理解设计与核对实现状态同样重要。
