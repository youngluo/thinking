---
createdAt: '2026-08-09 20:49'
order: 5
draft: true
---

# Session 是什么

Agent state 只描述当前进程里的运行状态，Session 则把任务过程保存下来，让 Agent 能够在下一次启动时继续工作。本文以 Pi commit `936aff00918de1187f085f123c2812d8f2d67745` 为基准，结合 `packages/coding-agent/docs/session-format.md`，说明 Session 如何用 JSONL 保存消息树，以及 `id` 和 `parentId` 如何支持分支。

本文只讨论 Session 的持久化结构，不展开上下文过长时的压缩和切换分支时的摘要生成。

## JSONL 文件保存什么

Session 文件是 JSONL 文件，每一行都是一个独立的 JSON 对象。文件通常先写入会话头信息，之后追加消息、模型变更、压缩或扩展相关的 entry。读取时可以逐行解析，不需要把整份文件当作一个大型 JSON 数组重新写入。

```json fold title="session.jsonl"
{"type":"session","id":"session-001","timestamp":"2026-08-09T10:00:00.000Z","cwd":"/workspace/app"}
{"type":"message","id":"a1b2c3d4","parentId":null,"timestamp":"2026-08-09T10:00:01.000Z","message":{"role":"user","content":"检查 src/utils"}}
{"type":"message","id":"b2c3d4e5","parentId":"a1b2c3d4","timestamp":"2026-08-09T10:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"我先读取相关文件。"}]}}
{"type":"message","id":"c3d4e5f6","parentId":"b2c3d4e5","timestamp":"2026-08-09T10:00:03.000Z","message":{"role":"toolResult","toolName":"read_file","content":[{"type":"text","text":"..."}],"isError":false}}
```

会话头描述文件属于哪个工作目录和会话，entry 则记录过程中的一个事实。`message` entry 保存 Agent 消息，`id` 和 `parentId` 保存它在会话树中的位置。其它 entry 可以参与树结构，也可以只为界面或扩展保存状态，是否进入模型上下文由上下文构建逻辑决定。

## id 与 parentId 如何形成树

每个树 entry 都有唯一的 `id`，并通过 `parentId` 指向它的父 entry。第一条 entry 的 `parentId` 为空，后续 entry 追加到当前叶子后面。这样，平面文件中的多行记录就形成了一棵可以回溯的树：

```d2 fold
direction: right

root: "用户请求" {
  id: a1b2c3d4
  class: subgroup
}
assistant: "Assistant 回复" {
  id: b2c3d4e5
  class: subgroup
}
tool: "工具结果" {
  id: c3d4e5f6
  class: subgroup
}
next: "下一条消息" {
  id: d4e5f6g7
  class: subgroup
}

root -> assistant: "parentId = a1b2c3d4"
assistant -> tool: "parentId = b2c3d4e5"
tool -> next: "parentId = c3d4e5f6"
```

`parentId` 表达的是对话上下文的 ancestry，而不是文件中的上一行。正常情况下两者顺序一致，但一旦产生分支，文件仍然是追加的，新的 entry 可以指向较早的父节点。

## 叶子节点与分支

叶子节点是当前会话继续写入的位置。用户从历史节点切换到另一处后，下一条消息会以那个节点作为 `parentId`，于是同一份 Session 中出现多个子分支：

```d2 fold
direction: down

common: 共同历史
old: 原分支
oldLeaf: 原分支叶子
new: 新分支
newLeaf: 当前叶子

common -> old -> oldLeaf
common -> new -> newLeaf
```

分支不会覆盖旧消息，也不需要为每条替代路径创建新的文件。旧分支仍然保留，当前 leaf 只决定下一次恢复时沿哪条路径构建上下文。`/tree` 这类导航功能本质上是在同一棵树中移动当前 leaf。

## 如何从叶子恢复上下文

恢复 Session 时，运行时不会把 JSONL 中所有消息都交给模型，而是从当前 leaf 沿 `parentId` 向根节点回溯，再反转为从前到后的 active path：

1. 找到当前 leaf；
2. 沿 `parentId` 逐级回溯到根节点；
3. 反转路径，得到当前分支上的 entry 序列；
4. 将其中能进入模型上下文的 entry 转换为 `AgentMessage[]`；
5. 把系统提示词、消息和工具交给 Agent Loop。

`packages/coding-agent/src/core/session-manager.ts` 负责 Session entry 和树的管理，`buildContextEntries()` 一类逻辑负责从当前 leaf 选择路径。消息 entry 可以直接转换为模型消息，扩展 entry 或界面状态则需要按各自规则处理。上下文压缩会改变第 3 步之后的选择方式，但不会改变树的基本关系。

## 持久化与恢复的边界

Session 的价值是保存可重建的任务上下文，但它不等于完整的运行时快照：

- JSONL 可以保存用户消息、assistant 消息、工具结果和分支关系，但不等于正在运行的进程；
- 恢复 Session 可以让 Agent 重新获得历史上下文，但不会自动恢复已经退出的 Shell、网络请求或内存对象；
- Session Tree 解决「从哪条历史继续」，Agent Loop 解决「下一轮怎么运行」，AgentHarness 才进一步处理持久化编排和异常恢复。

把这三种状态分开，才能判断一次崩溃后哪些内容可以重放，哪些动作必须重新确认。Compaction 会在这棵树上增加摘要边界，进一步减少恢复时需要加载的历史消息。

## 小结

Session 是一个以 JSONL 保存的、通过 `id` 和 `parentId` 连接起来的消息树。当前 leaf 决定恢复哪条分支，Session Manager 从 leaf 回溯出 active path，再将可用 entry 转换为 Agent 上下文。它保存的是任务历史，不是正在运行的进程；更复杂的崩溃恢复需要额外的 Harness 编排。
