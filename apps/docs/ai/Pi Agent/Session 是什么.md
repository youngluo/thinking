---
createdAt: '2026-08-09 20:49'
order: 5
draft: true
---

# Session 是什么

Agent state 只描述当前进程里的运行状态，Session 则把任务过程保存下来，让 Agent 能够在下一次启动时继续工作。本文以 Pi `v0.84.1` 为基准，说明 `pi-coding-agent` 如何用 JSONL 保存消息树，以及 `id` 和 `parentId` 如何支持分支。

本文只讨论 Session 的持久化结构，不展开上下文过长时的压缩和切换分支时的摘要生成。

## JSONL 文件保存什么

Session 文件采用 JSONL，每一行都是一个独立的 JSON 对象。第一行是 `SessionHeader`，之后追加消息、模型变更、压缩和扩展相关的 entry。读取时可以逐行解析，写入新状态时也不必重写整个文件。

```json fold title="session.jsonl"
{"type":"session","version":3,"id":"session-001","timestamp":"2026-08-09T10:00:00.000Z","cwd":"/workspace/app"}
{"type":"message","id":"a1b2c3d4","parentId":null,"timestamp":"2026-08-09T10:00:01.000Z","message":{"role":"user","content":"检查 src/utils"}}
{"type":"message","id":"b2c3d4e5","parentId":"a1b2c3d4","timestamp":"2026-08-09T10:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"我先读取相关文件。"}]}}
{"type":"message","id":"c3d4e5f6","parentId":"b2c3d4e5","timestamp":"2026-08-09T10:00:03.000Z","message":{"role":"toolResult","toolCallId":"call-001","toolName":"read_file","content":[{"type":"text","text":"..."}],"isError":false}}
```

`SessionHeader` 记录格式版本、会话 ID 和工作目录，不属于消息树。当前格式版本是 v3；旧的线性 v1 和树形 v2 Session 会在加载时迁移。后续 entry 记录过程中的一个事实，`id` 和 `parentId` 表示它在树中的位置。

entry 是否进入模型上下文取决于类型。`message`、`compaction`、`branch_summary` 和 `custom_message` 可以转换为上下文消息，`custom` 只保存扩展状态，不会发送给模型。持久化结构因此比模型最终看到的消息集合更丰富。

## id 与 parentId 如何形成树

每个树 entry 都有唯一的 `id`，并通过 `parentId` 指向它的父 entry。第一条 entry 的 `parentId` 为空，后续 entry 追加到当前叶子后面。这样，平面文件中的多行记录就形成了一棵可以回溯的树：

```d2 fold
direction: right

root: "用户请求" {
  label: "用户请求\na1b2c3d4"
}
assistant: "Assistant 回复" {
  label: "Assistant 回复\nb2c3d4e5"
}
tool: "工具结果" {
  label: "工具结果\nc3d4e5f6"
}
next: "下一条消息" {
  label: "下一条消息\nd4e5f6g7"
}

root -> assistant: "parentId = a1b2c3d4"
assistant -> tool: "parentId = b2c3d4e5"
tool -> next: "parentId = c3d4e5f6"
```

`parentId` 表达对话的祖先关系，而不是「文件中的上一行」。线性对话中两者通常一致；产生分支后，文件仍然只追加新行，新 entry 却可以指向较早的父节点。

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

分支不会覆盖旧消息，也不需要为每条替代路径创建新文件。旧分支继续保留，当前 leaf 决定下一次从哪条路径恢复上下文。`/tree` 导航本质上是在同一棵树中移动 leaf。

## 如何从叶子恢复上下文

恢复 Session 时，运行时不会把 JSONL 中所有消息都交给模型，而是从当前 leaf 沿 `parentId` 向根节点回溯，再反转为从前到后的 active path：

1. `buildContextEntries()` 从当前 leaf 沿 `parentId` 回溯到根节点；
2. 反转路径，得到当前分支上的 entry 序列；
3. 根据最近的 Compaction checkpoint 选择需要恢复的范围；
4. `buildSessionContext()` 将有效 entry 转换为消息，并恢复当前模型与 thinking level；
5. 产品层把恢复结果交给 Agent Runtime。

Compaction 会改变第 3 步选择哪些历史，但不会改变树的祖先关系。旧格式通过 `firstKeptEntryId` 找到保留消息的起点；新版 Harness 生成的 checkpoint 可以携带 `retainedTail`，无需继续回溯更早的 entry。具体压缩过程在下一篇单独展开。

## 持久化与恢复的边界

Session 的价值是保存可重建的任务上下文，但它不等于完整的运行时快照：

- JSONL 可以保存消息、模型选择、工具结果和分支关系，但不等于正在运行的进程；
- 恢复 Session 可以重建对话上下文，但不会自动恢复已经退出的 Shell、网络请求或内存对象；
- Session Tree 解决「从哪条历史继续」，Agent Loop 解决「下一轮怎么运行」，AgentHarness 进一步保存运行编排和恢复信息。

这里还要区分两个同名概念。`pi-coding-agent` 的 Session 指本文介绍的 JSONL 对话树；AgentHarness 的 Session 在此基础上增加 Lane、操作日志和全局事实，用于持久化运行。前者保存「发生过什么」，后者还要回答「中断后从哪一步恢复」。

## 小结

Session 用 JSONL 保存追加式历史，通过 `id` 和 `parentId` 将 entry 组织成树。当前 leaf 决定恢复哪条分支，Session Manager 再把有效路径转换为 Agent 上下文。它保存任务历史，不保存正在运行的进程；崩溃恢复还需要 AgentHarness 的持久化编排。
