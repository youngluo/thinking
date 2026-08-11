---
createdAt: '2026-08-09 22:15'
order: 6
draft: true
---

# Compaction 与 Branch Summarization 如何维持长任务

Session 可以保存完整历史，但模型每次请求能接收的上下文仍然有大小限制。Pi 用两种摘要机制处理这个矛盾：Compaction 压缩当前分支中过旧的消息，Branch Summarization 则在切换分支时保存被放弃路径中的关键信息。

本文以 Pi commit `936aff00918de1187f085f123c2812d8f2d67745` 为基准，结合 `packages/coding-agent/docs/compaction.md`，说明这两种机制如何在 Session Tree 上工作。

## 为什么需要压缩上下文

长任务会不断积累用户消息、assistant 消息、工具调用和工具结果。即使这些内容已经写入 JSONL，下一次模型调用也不能无限制地重放全部历史：上下文窗口需要同时容纳已有消息和本轮模型响应。

Compaction 的目标不是删除历史，而是为当前分支生成一个更短的上下文表示：旧消息仍保留在 Session 文件中，模型看到的 active context 则由摘要和最近消息组成。这样，持久化历史和模型输入可以使用不同的粒度。

## 自动压缩与手动触发

Pi 提供自动和手动两种触发方式：

- 自动压缩在下一轮模型调用可能超出上下文预算时触发，运行时会为模型响应预留空间；
- 用户可以通过 `/compact` 手动触发，也可以附加说明来指定摘要重点。

两种方式最终都要完成同一件事：选择需要保留的近期消息，调用模型生成摘要，把摘要作为新的 Session entry 保存下来。手动触发适合用户主动整理任务，自动触发则负责保证长任务能够继续运行。

自动压缩可以抽象为这个判断：

```text
contextTokens > contextWindow - reserveTokens
```

其中 `reserveTokens` 是为本轮模型响应预留的空间。它不是固定的全局常量，而是会随运行时配置和当前模型上下文窗口变化。

## 如何寻找裁剪边界

压缩不能简单地从文件头截断，否则容易丢掉仍然影响当前任务的上下文。Pi 会从最新消息向前累计 token 估算，直到达到「保留近期消息」的预算，再把更早的一段作为摘要范围。

```d2 fold
direction: right

history: 当前分支历史 {
  class: group
  old: 较早消息
  cut: 压缩边界
  recent: 保留的近期消息
}
prepare: "统计 token 并准备摘要"
summary: "LLM 生成 Compaction summary"
entry: "写入 compaction entry"
context: "摘要 + 近期消息"

history -> prepare
prepare -> summary: "边界之前的消息"
summary -> entry
entry -> context
history.recent -> context
```

边界会记录在压缩 entry 中，旧格式通常通过 `firstKeptEntryId` 指向保留消息的起点；较新的实现也可以把保留的尾部上下文直接写入摘要 checkpoint。具体字段属于 Session 格式，核心关系不变：摘要负责代表边界之前的历史，边界之后的消息保持原样。

## 摘要如何替代历史消息

生成摘要后，Session 并不会改写或删除原来的 JSONL 行，而是追加一条 `compaction` entry。一次压缩可以拆成五个步骤：

1. 从最新消息向前查找裁剪点，直到近期消息达到保留预算；
2. 提取上一个保留边界到裁剪点之间的消息；
3. 调用模型生成结构化摘要，必要时把已有摘要作为迭代上下文；
4. 追加 `CompactionEntry`，记录摘要和 `firstKeptEntryId` 等恢复信息；
5. 重新构建当前上下文，只组合摘要和保留边界之后的消息。

摘要通常按 `Goal`、`Progress`、`Key Decisions`、`Next Steps` 组织。结构化分区让下一轮模型更容易区分任务目标、已经完成的工作、关键取舍和待办事项，但它仍然是对原始消息的有损表示。

这个过程有三个重要结果：

1. 模型输入变短，后续 turn 可以继续使用工具和输出结果；
2. 完整历史仍可通过 Session Tree 追溯，必要时可以回到压缩前的路径；
3. 摘要成为上下文恢复的检查点，而不是对历史文件的一次破坏性重写。

Compaction 是有损的。摘要可能遗漏原始消息中的具体参数、代码片段或失败细节，因此产品需要根据任务类型选择保留范围，不能把摘要当作完整历史的替代品。

## Branch Summarization 如何处理被放弃分支

Compaction 处理的是同一条分支变长的问题，Branch Summarization 处理的是用户从一个分支切换到另一个分支的问题。用户通过 `/tree` 离开旧 leaf 时，Pi 可以把旧 leaf 与新 leaf 之间的差异总结出来，并将摘要附着到新的导航位置。

```d2 fold
direction: down

ancestor: 共同祖先
oldBranch: 被放弃分支 {
  class: subgroup
  oldMessages: 旧分支消息
}
target: 目标分支 {
  class: subgroup
  targetMessages: 新分支消息
}
find: 找到共同祖先
summarize: 总结旧分支的关键工作
attach: 写入 branch_summary

ancestor -> oldBranch
ancestor -> target
oldBranch -> find
target -> find
find -> summarize
summarize -> attach
attach -> targetMessages
```

它与 Compaction 的区别可以这样记：Compaction 是「同一条路走得太长，压缩旧历史」，Branch Summarization 是「换了一条路，把上一条路的结果带过来」。两者都生成摘要，但触发原因、摘要范围和它们在 Session Tree 中的位置不同。

Branch Summarization 会追加 `BranchSummaryEntry`。除了摘要文本，它还可以记录 `fromId`、模型用量 `usage` 和结构化的 `details`，其中 `readFiles` 与 `modifiedFiles` 用于保留旧分支涉及的文件事实。文件记录可以沿分支累计，避免切换分支后只剩一段无法定位的自然语言总结。

## 压缩后的恢复与限制

压缩和分支摘要只能减少模型需要读取的内容，不能消除所有长任务风险：

- 摘要质量取决于用于生成摘要的模型和提示词，关键事实可能被遗漏；
- 摘要本身也会占用上下文，需要为后续任务预留空间；
- 工具结果过大、代码细节密集或任务跨越多个分支时，单个摘要可能不足以恢复完整工作状态；
- 扩展可以自定义摘要策略，但仍应保存足够的事实，让下一轮模型能够继续行动。

因此，长任务的可靠性不是只靠提高上下文窗口，而是由 Session 的完整历史、摘要检查点和产品层的任务状态共同支撑。

## 小结

Compaction 通过 `compaction` entry 压缩当前分支的旧消息，Branch Summarization 通过 `branch_summary` entry 保存被放弃分支的关键信息。两者都不删除 JSONL 历史，只改变当前模型恢复上下文的方式；前者解决上下文长度，后者解决分支切换。
