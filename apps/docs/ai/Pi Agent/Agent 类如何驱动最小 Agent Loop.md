---
createdAt: '2026-08-09 20:49'
order: 3
draft: true
---

# Agent 类如何驱动最小 Agent Loop

本文进入 `packages/agent/src/agent.ts`，观察 `Agent` 类如何把自身状态、上下文转换、模型调用和事件处理接到一起。

这里的「最小」指 Agent 类只负责推进一次运行，不负责持久化 Session，也不负责实现具体的终端或 Web 界面。Context Builder 的核心职责会在这一层建立，但暂时只讨论它在循环中的位置，不展开具体字段设计。

## Agent 保存哪些运行状态

`Agent` 同时保存两类状态。一类是下一次模型调用需要的上下文，另一类是运行期间供产品观察的临时状态：

| 状态 | 作用 |
| --- | --- |
| `systemPrompt` | 为模型设定系统级指令 |
| `model` | 指定当前模型和模型参数 |
| `thinkingLevel` | 指定推理级别 |
| `tools` | 提供本轮可以调用的工具 |
| `messages` | 保存当前 Agent 的消息上下文 |
| `isStreaming` | 标记当前是否处于运行状态 |
| `streamingMessage` | 保存正在生成的局部 assistant 消息 |
| `pendingToolCalls` | 记录尚未完成的工具调用 |
| `errorMessage` | 暴露最近一次运行错误 |

前五项决定模型下一步能看到什么，后四项帮助界面呈现当前运行状态。它们属于内存中的 Agent state，不等同于可以跨进程恢复的 Session；后者由更高层的产品或持久化编排负责。

## 上下文包含哪些输入

Agent Loop 每一轮至少需要四类输入：系统提示词、消息列表、可用工具和当前模型。`Agent` 不直接把整个实例交给低层循环，而是从当前状态创建一个上下文快照，再交给 `agentLoop`。

```d2 fold
direction: right

state: "Agent state" {
  class: group
  prompt: systemPrompt
  messages: messages
  tools: tools
  model: model
}

snapshot: createContextSnapshot()
loop: "Agent Loop" {
  class: group
  context: AgentContext
  config: AgentLoopConfig
}
events: "运行事件"
stateUpdate: processEvents()

state -> snapshot: "复制当前上下文"
snapshot -> loop: "创建本轮输入"
loop -> events: "模型和工具事件"
events -> stateUpdate: "更新 Agent state"
stateUpdate -> state: "写回运行状态"
```

快照的意义在于把「当前 Agent 状态」和「本轮循环使用的输入」分开。低层循环推进当前 turn 时，产品仍然可以通过事件观察状态变化；但下一轮使用哪些消息和工具，仍由 Agent 在边界处重新准备。

## transformContext 与 convertToLlm

Agent 内部的消息不一定能直接交给模型。Pi 用两个连续的转换点处理这个问题：

```d2 fold
direction: right

agentMessages: "AgentMessage[]"
transform: "transformContext" {
  class: subgroup
}
prepared: "AgentMessage[]"
convert: "convertToLlm" {
  class: subgroup
}
llmMessages: "Message[]"
stream: "streamFn"

agentMessages -> transform
transform -> prepared
prepared -> convert
convert -> llmMessages
llmMessages -> stream
```

- `transformContext` 在消息仍属于 Agent 内部格式时处理上下文，可以裁剪旧消息、注入外部信息或准备压缩边界；它是异步的，并接收当前运行的 `AbortSignal`；
- `convertToLlm` 把处理后的 `AgentMessage[]` 转换为模型能够理解的 `Message[]`，也可以过滤 UI 消息或把自定义消息映射为标准消息；
- `streamFn` 最后把标准消息交给 `pi-ai`，返回模型响应事件。

这两个函数的顺序不能互换。先由 `transformContext` 决定本轮要保留和补充哪些 Agent 消息，再由 `convertToLlm` 决定哪些消息能够进入模型协议。这样，Agent 的内部消息模型可以比 LLM 协议更丰富。

## 一轮循环如何展开

`Agent` 类把状态转换成 `AgentContext` 和 `AgentLoopConfig` 后，交给低层 `agentLoop`。一轮循环可以压缩成以下步骤：

1. 从 Agent state 创建本轮上下文快照；
2. 运行 `transformContext` 和 `convertToLlm`，得到模型输入；
3. 通过 `streamFn` 请求模型，并把响应转换为事件；
4. 如果 assistant 消息包含工具调用，执行工具并收集 tool result；
5. 把本轮结果写回 Agent state，再判断是否开始下一轮。

没有工具调用时，模型消息可以直接结束当前 turn。有工具调用时，工具结果会成为下一轮上下文的一部分。Agent 类并不重新实现模型协议或工具细节，而是负责把状态和回调组装成低层循环需要的配置。

## 下一轮如何准备

当前 turn 结束后，Agent 可以在开始下一轮前更新运行状态。`prepareNextTurn` 提供不依赖上下文的前置回调，`prepareNextTurnWithContext` 则可以读取本轮的 assistant 消息、工具结果和上下文，再决定下一轮需要的状态更新。

这两个入口适合处理模型调用之间的准备工作，例如切换 thinking level、补充工具或更新外部状态。它们发生在下一次模型请求之前，不负责替代 `transformContext` 对消息列表的转换。

## Hooks 如何介入

Hooks 位于 Agent Loop 的几个明确边界上，不负责替换整个循环：

| Hook | 介入时机 | 可以影响什么 |
| --- | --- | --- |
| `beforeToolCall` | 工具参数校验完成、真正执行前 | 阻止工具或附加终止信号 |
| `afterToolCall` | 工具执行完成、最终工具事件发出前 | 修改结果或附加终止信号 |
| `shouldStopAfterTurn` | 当前 turn 完成后、检查队列前 | 决定是否继续下一轮 |
| `prepareNextTurn` | 下一轮开始前 | 更新下一轮使用的状态或上下文 |

这些 Hook 的共同点是只介入一个边界，不接管 Agent 的生命周期。比如 `beforeToolCall` 可以实现权限确认，`shouldStopAfterTurn` 可以在达到上下文预算时暂停，具体的工具执行和循环推进仍由运行时完成。

## Steering 与 Follow-up 的消息队列

Agent 还维护两条用于用户干预的消息队列：

- Steering 在当前 turn 的工具调用完成后被取出，作为下一轮模型调用的输入，用于改变正在执行的任务方向；
- Follow-up 只有在没有待执行工具和 Steering 消息时才会被取出，用于在当前任务完成后追加工作。

两类消息都会重新进入 Agent Loop，而不是直接修改已经产生的 assistant 消息。它们由 `createLoopConfig()` 以 `getSteeringMessages` 和 `getFollowUpMessages` 的形式交给低层循环，Agent 类负责队列策略，`agentLoop` 负责在正确的边界读取队列。

## 最小 Agent Loop 的边界

从 `Agent` 类的职责可以划出四条边界：

- 模型通信由 `streamFn` 提供，通常由 `pi-ai` 负责 Provider 适配和流式响应；
- 工具执行由 Agent Loop 调度，但文件、进程或网络副作用发生在运行时之外；
- 运行状态保存在 Agent state，跨进程的 Session、日志和恢复机制不属于这个最小类；
- 界面通过 `subscribe()` 消费事件，Agent 不依赖具体的 TUI、CLI 或 Web 实现。

这使 `Agent` 可以被不同产品复用。产品只需要准备模型、工具和事件处理方式，就能在同一个循环之上组合出不同的 Agent；需要持久化、权限或更复杂队列时，再由外层 Harness 补上。

## 停止、取消与失败

最小循环需要区分三种控制：

- `shouldStopAfterTurn` 是正常停止，它发生在当前 turn 和工具执行都完成后，不会取消正在运行的模型请求或工具；
- `abort()` 通过当前运行的 `AbortSignal` 发出取消信号，具体的模型 Provider 和工具是否及时终止取决于它们是否配合处理信号；
- 如果 Agent 已经在运行，再次调用 `prompt()` 会报错。产品应使用 `steer()` 或 `followUp()` 排队新消息，或者等待当前运行结束。

工具抛出的错误会被运行时转换为带错误标记的工具结果，再交给模型处理；这让失败仍然处于同一条事件和上下文链路中。至于错误如何展示、是否重试和是否保存，需要由产品层决定。

## 小结

`Agent` 类是一个有状态的循环适配器：它从自身状态创建上下文快照，经过两次消息转换后调用模型，再把模型和工具事件写回状态。Hooks、前置回调、Steering 和 Follow-up 队列都在清晰的边界上介入，而模型、工具、Session 和界面分别由其它层负责。
