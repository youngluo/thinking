---
createdAt: '2026-08-09 20:49'
order: 3
draft: true
---

# Agent 如何驱动 Agent Loop

上一篇从事件流观察了一次 `prompt()` 调用，本篇继续进入 `packages/agent/src/agent.ts`，看 `Agent` 如何把运行状态转换为 Agent Loop 的输入，再把模型和工具事件写回自身状态。

本文只讨论进程内的一次运行。Session 持久化、自动压缩和产品界面由更高层负责。

## Agent 保存的运行状态

`Agent` 是低层 Agent Loop 的有状态封装。它保存模型调用需要的上下文，也维护供产品观察的临时运行状态：

| 状态 | 作用 |
| --- | --- |
| `systemPrompt` | 为模型提供系统级指令 |
| `model` | 指定当前模型及其能力元数据 |
| `thinkingLevel` | 指定当前推理级别 |
| `tools` | 保存当前可用的工具 |
| `messages` | 保存 Agent 的消息上下文 |
| `isStreaming` | 标记是否存在正在进行的 run |
| `streamingMessage` | 保存正在生成的 assistant 消息 |
| `pendingToolCalls` | 记录尚未结束的工具调用 |
| `errorMessage` | 暴露最近一次运行错误 |

前五项决定模型能够接收什么，后四项描述运行时正在发生什么。它们都保存在内存中，不等同于可以跨进程恢复的 Session。

状态更新主要来自两个方向。产品可以在空闲时设置模型、工具和消息，运行期间产生的事件则由 `processEvents()` 归并回 `Agent.state`。例如，`message_end` 会把完整消息加入上下文，工具开始和结束事件会更新 `pendingToolCalls`。

## 上下文快照与循环配置

调用 `prompt()` 或 `continue()` 时，`Agent` 不会把整个实例交给低层循环，而是准备两组输入：

- `AgentContext` 包含 `systemPrompt`、`messages` 和 `tools`；
- `AgentLoopConfig` 包含模型、推理级别、消息转换函数、工具执行策略和 Hooks。

```d2 fold
direction: right

state: "Agent state" {
  class: group
  prompt: systemPrompt
  messages: messages
  tools: tools
  model: model
  thinking: thinkingLevel
}

snapshot: createContextSnapshot()
config: createLoopConfig()
loop: "Agent Loop" {
  class: group
  context: AgentContext
  options: AgentLoopConfig
}
events: "模型与工具事件"
reduce: processEvents()

state -> snapshot: "复制提示词、消息和工具"
state -> config: "读取模型、策略和回调"
snapshot -> loop: "提供运行上下文"
config -> loop: "提供循环配置"
loop -> events
events -> reduce: "更新消息和临时状态"
reduce -> state
```

`createContextSnapshot()` 会浅拷贝消息和工具数组，为本次 run 提供独立的起点。Agent Loop 随后在自己的 `currentContext` 中追加 assistant 消息和工具结果，不会在每个 turn 都重新读取 `Agent.state`。

`createLoopConfig()` 则把模型、Hooks 和队列读取函数接入循环。需要在 turn 之间刷新模型、工具或上下文时，应通过 `prepareNextTurn` 系列回调显式返回新的快照，而不是依赖外部状态恰好发生变化。

## 消息如何转换为模型输入

Agent 内部可以保存自定义消息，但模型只能接收 `pi-ai` 定义的标准消息。每次调用模型前，消息会依次经过两个转换点：

```d2 fold
direction: right

agentMessages: "AgentMessage[]"
transform: transformContext
prepared: "AgentMessage[]"
convert: convertToLlm
llmMessages: "Message[]"
stream: streamFn

agentMessages -> transform: "裁剪或补充上下文"
transform -> prepared
prepared -> convert: "过滤并转换消息类型"
convert -> llmMessages
llmMessages -> stream: "请求模型"
```

- `transformContext` 在 Agent 消息格式上工作，可以裁剪历史消息、注入外部信息或准备压缩后的上下文；
- `convertToLlm` 将处理后的 `AgentMessage[]` 转换为模型能够理解的 `Message[]`，并过滤只供产品使用的消息；
- `streamFn` 接收最终的模型上下文，通常由 `pi-ai` 提供具体实现。

两次转换只影响当前模型请求，不会直接改写 `Agent.state.messages`。先准备本轮需要的 Agent 消息，再收敛到 LLM 协议，使产品可以保留比模型协议更丰富的内部消息。

## Agent Loop 如何推进

准备好上下文和配置后，`Agent` 调用低层的 `runAgentLoop()` 或 `runAgentLoopContinue()`。循环按以下顺序推进：

1. 发出 `agent_start` 和首个 `turn_start`；
2. `prompt()` 将传入的新消息加入上下文，`continue()` 则沿用现有上下文；
3. 转换当前消息，通过 `streamFn` 请求模型；
4. 将流式响应转换为 assistant 消息事件；
5. 执行 assistant 消息中的工具调用，并回注 `toolResult` 消息；
6. 发出 `turn_end`，运行 turn 结束后的回调；
7. 根据工具结果、Steering 和 Follow-up 判断是否开始下一轮；
8. 没有后续工作时发出 `agent_end`。

`Agent` 的 `processEvents()` 会在事件到达时先更新自身状态，再按注册顺序等待订阅者。这个处理屏障保证 assistant 消息已经进入 `Agent.state.messages` 后，循环才开始工具预检。低层 `agentLoop()` 返回的事件流只保留事件顺序，不会等待外部消费者完成异步处理。

## Hooks 如何介入循环

Hooks 只介入固定的执行边界，不接管整个 Agent Loop：

| Hook | 调用时机 | 可以影响什么 |
| --- | --- | --- |
| `beforeToolCall` | 工具参数校验完成、真正执行前 | 阻止调用或返回终止提示 |
| `afterToolCall` | 工具执行完成、最终结果事件发出前 | 修改工具结果或终止提示 |
| `prepareNextTurn` | `turn_end` 之后、判断是否继续前 | 更新上下文、模型或 thinking level |
| `shouldStopAfterTurn` | `prepareNextTurn` 之后、读取消息队列前 | 正常结束当前 run |

`prepareNextTurnWithContext` 是 `Agent` 提供的增强入口。它可以读取本轮 assistant 消息、工具结果和当前上下文；如果同时设置了 `prepareNextTurn`，会优先调用带上下文的版本。

这些回调的先后关系决定了它们的用途。`beforeToolCall` 适合做权限确认，`afterToolCall` 适合规范化结果，`prepareNextTurnWithContext` 适合在两次模型请求之间刷新运行配置，`shouldStopAfterTurn` 则用于在一个完整 turn 之后正常停止。

## Steering 与 Follow-up 如何排队

Agent 正在运行时不能再次调用 `prompt()`。产品需要根据新消息的意图，将其放入 Steering 或 Follow-up 队列：

- Steering 在当前 turn 的工具执行完成后读取，用于改变接下来的任务方向；
- Follow-up 只在工具调用和 Steering 都处理完后读取，用于在当前工作结束后追加任务。

两条队列默认每次取出一条消息，也可以设置为一次取出全部。取出的消息会作为新的用户消息进入上下文，再由下一轮模型调用处理；它们不会修改已经生成的 assistant 消息。

`createLoopConfig()` 将两条队列包装为 `getSteeringMessages` 和 `getFollowUpMessages`。`Agent` 负责入队和取出策略，Agent Loop 负责在正确的执行边界检查它们。

## 停止取消与失败

结束运行有三条不同路径：

- `shouldStopAfterTurn` 在当前 turn 和工具执行全部完成后正常停止，不会取消正在运行的模型请求或工具；
- `abort()` 通过当前 run 的 `AbortSignal` 发出取消信号，Provider 和工具需要主动响应这个信号；
- 模型流或循环抛出异常时，`Agent` 会生成一条带错误信息的 assistant 消息，并补齐 `message_end`、`turn_end` 和 `agent_end` 事件。

单个工具抛出的异常不会直接中断整个 run。Agent Loop 会把异常转换为带 `isError` 标记的 `toolResult`，让模型在下一轮决定重试、改用其它工具或结束任务。

如果 run 尚未结束，再次调用 `prompt()` 或 `continue()` 会报错。调用方可以等待 `waitForIdle()`，也可以通过 Steering 和 Follow-up 把新消息交给当前循环。

## Agent 的职责边界

`Agent` 负责维护进程内状态、创建运行快照、启动 Agent Loop，并把事件归并回状态。与它相邻的职责由其它模块承担：

- 模型通信由 `streamFn` 提供，通常交给 `pi-ai` 处理 Provider 差异和流式响应；
- Agent Loop 负责调度工具，实际的文件、进程和网络副作用发生在工具实现中；
- Session、日志、Compaction 和崩溃恢复属于产品层或持久化 Harness；
- TUI、CLI 和 Web 界面通过事件观察运行，不进入 `Agent` 核心。

这组边界使 `Agent` 保持为可嵌入的运行时组件。产品只需提供模型、工具、消息转换和事件处理，就能复用同一套循环；需要持久化或更复杂的生命周期时，再在外层增加相应能力。
