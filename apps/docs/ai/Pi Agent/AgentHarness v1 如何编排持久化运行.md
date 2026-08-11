---
createdAt: '2026-08-09 22:15'
order: 10
draft: true
---

# AgentHarness v1 如何编排持久化运行

Agent Loop 能够推进一次任务，但它本身不负责跨进程保存运行过程，也不负责处理多个操作同时写入同一个 Session。AgentHarness v1 试图在 Agent Loop 之上增加一层编排，统一管理 Session、运行配置、资源解析、操作锁和恢复入口。

本文讨论 `packages/agent/docs/harness.md` 所描述的 v1 设计。它是理解 v2 的历史起点，不能把设计文档中的待办项、接口草案或未完成实现当作当前已经具备的能力。

## 为什么需要 AgentHarness

当 Agent 从一次性调用变成长期运行的产品，会遇到低层 Agent Loop 不负责的问题：

- Session 需要持久化，且同一个 Session 可能被多个外部线程或任务使用；
- 运行过程需要恢复，不能只依赖进程内的 `Agent.state`；
- 操作需要排队、加锁和拒绝冲突，避免两个写入者同时修改同一份历史；
- Compaction、分支导航和普通 prompt 都需要共享生命周期和错误处理方式。

Harness 的职责不是重新实现模型调用，而是把一次运行放进一个有边界、可恢复的操作中。

## AgentHarness 如何管理一次运行

v1 可以看作包在 Agent Loop 外面的运行协调器：

```d2 fold
direction: down

request: "外部 prompt"
harness: AgentHarness {
  class: group
  snapshot: Snapshot
  config: Config
  phase: AgentHarnessPhase
}
session: Session {
  class: group
  tree: "Session entries"
  orchestration: "Harness entries"
}
loop: "Agent Loop"
result: "运行结果与事件"

request -> harness: 接受或拒绝
harness -> session: 读取快照
harness -> loop: 创建配置并运行
loop -> session: 追加结果
loop -> result
harness -> result: 发布生命周期事件
```

运行开始前，Harness 读取 Session 和当前配置，生成本次操作使用的 Snapshot。运行过程中，Agent Loop 负责模型和工具，Harness 负责阶段切换、写入和对外事件。这样同一份 Session 的持久化历史和一次运行的临时状态不会混在一起。

## Ref 如何指向 Session 分支

v1 的 Ref 是一个命名的、可移动的叶子指针。一个 Session 可以包含多个 Ref，每个 Ref 指向 Session Tree 中的一个 leaf，并拥有自己的排队和运行上下文：

| 对象 | 含义 |
| --- | --- |
| Session | 持久化的完整 entry 日志 |
| Ref | 指向某个 leaf 的命名位置 |
| Operation | 在某个 Ref 上执行的一次运行或其它操作 |
| 默认 Ref | 交互式使用通常看到的 `main` |

两个 Ref 可以从同一个 leaf 分别继续，形成不同分支。它们可以并行推进，但写入仍由同一个 Harness 串行协调。这个设计使 Slack 线程、邮件线程等外部身份有机会映射到不同 Ref，而不必拆成完全独立的 Session。

## Session entry 与 Harness entry

v1 把两类不同性质的记录放在同一个持久化日志中：

| 记录 | 是否属于 Session Tree | 是否进入模型上下文 | 用途 |
| --- | --- | --- | --- |
| Session entry | 是 | 通常是 | 消息、Compaction、分支和其它对话事实 |
| Harness entry | 否 | 否 | 操作开始、工具开始等编排事实，用于恢复运行 |

Session entry 有 `parentId`，参与对话树和 leaf 移动；Harness entry 没有父子关系，也不应该成为模型消息或当前 leaf。把编排记录与对话记录放在同一文件，可以让恢复时按顺序看到运行发生过什么，同时不污染模型上下文。

## 锁、队列与异常恢复

v1 的核心并发原则是 Single writer, parallel refs：同一时间只有一个 Harness 写入一个 Session，但这个 Harness 内可以让多个 Ref 分别推进操作。

每个 Ref 还需要自己的状态和队列：

- 当前 Ref 正在执行 turn 时，新的操作不能绕过它直接写 Session；
- 同一 Ref 上的消息需要排队，按设计的 Steering 或 Follow-up 规则进入后续 turn；
- 其它 Ref 可以继续执行，但所有写入仍经过同一个写入协调点；
- 进程异常后，Harness 通过 Harness entry 判断上一次操作停在哪个阶段，再决定恢复、失败或标记损坏。

v1 设计还区分低层错误值和高层操作错误。底层可以通过 `Result<T, E>` 返回可判断的失败，高层对外则以 throw 或 reject 结束一次无法继续的操作，避免把存储错误伪装成正常的空结果。

## v1 设计与当前实现的边界

阅读 v1 文档时需要保留三个判断：

1. `harness.md` 描述的是 v1 设计，后续 `harness-v2.md` 已明确将其取代，冲突处以 v2 为准；
2. 设计文档中的阶段、恢复规则和接口并不自动等于仓库中已经完成的实现，必须以对应 commit 的源码和测试为准；
3. v1 记录了「一次运行正在做什么」，但没有完整解决崩溃发生在任意副作用边界时如何做到无部分结果，这正是 v2 引入 Durable Runs、操作日志和更细步骤边界的原因。

v1 的价值主要在于把问题空间拆出来：Session 保存什么、Harness 需要额外记录什么、Ref 如何隔离并发，以及事件和 Hook 在编排层如何区分。它不是最终的持久化运行时规范。

## 小结

AgentHarness v1 在 Agent Loop 之上增加了 Session、Ref、操作阶段和单写入协调。Session entry 保存对话树，Harness entry 保存恢复所需的编排事实，Ref 则把多个运行位置映射到同一份 Session。v1 解决了编排问题的基本形状，但没有提供 v2 所要求的完整 Durable Runs 保证。
