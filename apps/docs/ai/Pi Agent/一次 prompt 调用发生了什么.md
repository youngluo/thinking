---
createdAt: '2026-08-09 20:49'
order: 2
draft: true
---

# 一次 prompt 调用发生了什么

本文从一个动作开始：调用 `agent.prompt()`。重点不是模型返回了什么文本，而是一次 Agent 运行如何被拆成可观察的事件，以及工具和用户干预如何改变后续流程。

下面的说明以 Pi commit `936aff00918de1187f085f123c2812d8f2d67745` 为基准。暂时不讨论 Session 持久化、Context Builder 和 AgentHarness，只观察运行时如何推进一次任务。

## prompt 如何启动一次运行

`prompt()` 是 Agent 的运行入口，但它不等于一次直接的模型调用。调用发生后，Agent 会把输入转换为用户消息，启动一次运行，并在运行过程中发出事件。一次运行至少包含一个 turn；如果模型请求工具，运行时会把工具结果放回上下文，再开始下一轮。

可以先用三个层次理解这些事件：

| 层次 | 含义 | 典型边界 |
| --- | --- | --- |
| Agent run | 一次从开始到结束的完整运行 | `agent_start` 到 `agent_end` |
| Turn | 一次模型响应及其关联的工具执行 | `turn_start` 到 `turn_end` |
| Message | 用户、模型或工具结果产生的一条消息 | `message_start` 到 `message_end` |

因此，「调用一次 `prompt`」描述的是一个运行边界，而不是一个请求响应对。模型是否调用工具、工具是否产生结果、队列中是否有新的用户输入，都会影响这次运行包含多少个 turn。

## 一次调用的事件序列

下面的流程图只保留运行时能观察到的主链路。没有工具调用时，当前 turn 结束后运行直接结束；有工具调用时，工具结果会先进入上下文，运行时再开始下一轮模型调用。

```d2 fold
direction: right

prompt: agent.prompt()
start: agent_start
turnStart: turn_start
userStart: "message_start\n用户消息"
userEnd: message_end
assistantStart: "message_start\n模型消息"
assistantUpdate: "message_update\n流式更新"
assistantEnd: message_end
decision: "是否产生工具调用？" {
  class: decision
}
toolStart: tool_execution_start
toolUpdate: tool_execution_update
toolEnd: tool_execution_end
toolResult: "message_start / message_end\n工具结果"
turnEnd: turn_end
nextTurn: "下一轮 turn"
end: agent_end

prompt -> start -> turnStart -> userStart -> userEnd
userEnd -> assistantStart -> assistantUpdate -> assistantEnd -> decision
decision -> turnEnd: 否
decision -> toolStart: 是
toolStart -> toolUpdate -> toolEnd -> toolResult -> turnEnd
turnEnd -> nextTurn: 需要继续
nextTurn -> turnStart
turnEnd -> end: 没有后续工作
```

这里的「下一轮」不是递归调用 `prompt()`。它仍属于同一次 Agent run，只是运行时把上一轮的 assistant 消息和 tool result 消息交给下一次模型调用。

## 模型输出与工具事件

模型响应以消息事件的形式进入事件流。流式输出时，运行时先发出 `message_start`，随后多次发出 `message_update`，最后以 `message_end` 标记完整的 assistant 消息。文本界面通常只处理其中的 `text_delta`，把每个增量追加到当前输出。

工具事件表达的是模型之外的本地执行过程：

| 事件 | 作用 |
| --- | --- |
| `tool_execution_start` | 工具开始执行，包含工具调用标识、名称和参数 |
| `tool_execution_update` | 工具主动报告执行进度，可选 |
| `tool_execution_end` | 工具执行结束，携带结果或错误 |

工具执行结束后，运行时还会产生一条 `toolResult` 消息。它不是模型的又一次输出，而是下一轮模型调用的输入。这样就形成了清晰的边界：模型提出工具调用，运行时执行工具，工具结果再交给模型判断下一步。

一个最小的事件订阅者可以只记录事件类型：

```ts fold title="observe-agent.ts"
const unsubscribe = agent.subscribe((event) => {
  console.log(event.type);
});

await agent.prompt("Read src/utils and suggest the next change.");
unsubscribe();
```

如果要构建界面，可以在同一个订阅者中分别处理消息增量、工具开始和工具结束。事件订阅者消费的是运行过程，不需要拥有 Agent Loop 本身。

## Event 与 Hook 的区别

Event 和 Hook 都出现在 Agent 运行过程中，但承担的职责不同：

| 机制 | 作用 | 是否改变运行 |
| --- | --- | --- |
| Event | 告知界面或外部系统某个阶段已经开始、更新或结束 | 默认只观察 |
| Hook | 在工具、上下文或轮次边界上提供拦截和修改机会 | 可以阻止、替换或追加行为 |

`agent.subscribe()` 收到的是事件流，例如 `message_update` 和 `tool_execution_end`。`beforeToolCall`、`afterToolCall` 和 `shouldStopAfterTurn` 则属于运行时 Hook，它们由 Agent Loop 主动调用，并可以影响后续执行。

把两者分开，界面就不需要通过修改事件来控制 Agent，运行时也能明确哪些扩展点允许改变行为。事件由 `Agent` 类和底层 Agent Loop 发出，Hook 则由循环在对应边界主动调用。

## 一次调用如何结束

`turn_end` 只表示当前 turn 已经完成，不代表整个 `prompt()` 调用结束。运行时还会检查是否存在待处理的工具或其它队列消息，必要时继续开始新的 turn。

当没有后续工作时，运行时发出 `agent_end`，它是这次 Agent run 的最终事件。`prompt()` 会在这次运行完成后返回；如果订阅者对 `agent_end` 注册了异步处理，运行也会等待这些处理完成。

这一区分对产品界面很重要。`turn_end` 适合更新当前步骤的状态，`agent_end` 才适合解除加载状态、保存本轮结果或通知上层任务已经结束。

## 小结

一次 `prompt()` 调用至少包含一个 turn。每个 turn 由用户消息、模型消息和可选的工具执行组成，工具结果会作为下一轮模型调用的输入。运行时通过事件把这些阶段暴露给界面，同时保留对队列、执行边界和结束时机的控制。
