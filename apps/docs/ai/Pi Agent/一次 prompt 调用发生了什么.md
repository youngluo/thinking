---
createdAt: '2026-08-09 20:49'
order: 2
draft: true
---

# 一次 prompt 调用发生了什么

调用 `agent.prompt()` 后，Pi 并不只是向模型发送一次请求。模型可能要求执行工具，工具结果会触发新的模型调用，运行期间排队的用户消息也可能继续推动任务。

本文以 Pi `v0.84.1` 为基准，从事件流观察一次运行如何开始、推进和结束。Session 持久化和 AgentHarness 不在本文范围内。

## prompt 如何启动一次运行

`prompt()` 是 `Agent` 的运行入口。它先把文本或图片输入转换为用户消息，再创建一个新的 Agent run。运行开始后，`Agent` 会标记运行状态，并按执行进度持续发出事件。

事件分为三个层次：

| 层次 | 含义 | 典型边界 |
| --- | --- | --- |
| Agent run | 一次入口调用驱动的完整运行，可以包含多个 turn | `agent_start` 到 `agent_end` |
| Turn | 一次模型响应及其关联的工具执行 | `turn_start` 到 `turn_end` |
| Message | 一条用户消息、assistant 消息或工具结果 | `message_start` 到 `message_end` |

一次 `prompt()` 调用至少包含一个 turn，但不一定只调用一次模型。只要工具结果或消息队列仍要求继续，新的 turn 就会在同一个 Agent run 中启动。Agent 正在运行时不能再次调用 `prompt()`，新的用户输入需要通过 Steering 或 Follow-up 队列进入当前运行。

## 一次调用的事件序列

下面的流程图展示一次 `prompt()` 调用的主要事件。首个 turn 会先发出用户消息事件，后续 turn 直接基于已有上下文请求模型。

```d2 fold
direction: right

prompt: agent.prompt()
start: agent_start
firstTurn: "turn_start\n首次 turn"
laterTurn: "turn_start\n后续 turn"
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
continueDecision: "是否继续？" {
  class: decision
}
end: agent_end

prompt -> start -> firstTurn -> userStart -> userEnd
userEnd -> assistantStart -> assistantUpdate -> assistantEnd -> decision
decision -> turnEnd: 否
decision -> toolStart: 是
toolStart -> toolUpdate -> toolEnd -> toolResult -> turnEnd
turnEnd -> continueDecision
continueDecision -> laterTurn: 工具或队列仍有工作
laterTurn -> assistantStart
continueDecision -> end: 没有后续工作
```

图中的后续 turn 不是再次调用 `prompt()`。运行时会把上一轮的 assistant 消息和 `toolResult` 消息加入上下文，再发起下一次模型调用。工具批次也可以通过 `terminate` 结果停止自动续跑，因此产生工具调用并不意味着一定还有下一轮。

## 模型输出与工具事件

模型响应通过消息事件进入事件流。流式输出开始时，运行时发出 `message_start`；生成过程中持续发出 `message_update`；响应完成后，再用 `message_end` 给出最终 assistant 消息。

`message_update` 携带底层 `AssistantMessageEvent`。它既可能是文本增量，也可能是 thinking 或工具调用的开始、增量和结束事件。界面可以只渲染 `text_delta`，也可以同时呈现推理和工具调用状态。

工具事件表达的是模型之外的本地执行过程：

| 事件 | 作用 |
| --- | --- |
| `tool_execution_start` | 工具开始执行，包含工具调用标识、名称和参数 |
| `tool_execution_update` | 工具主动报告执行进度，可选 |
| `tool_execution_end` | 工具执行结束，携带结果或错误 |

工具执行结束后，运行时把结果封装成 `toolResult` 消息，并为它发出 `message_start` 和 `message_end`。模型只负责提出结构化调用，真正的本地执行发生在运行时之外的工具实现中；下一轮模型调用看到的是回注后的 `toolResult` 消息。

一个最小的订阅者可以直接消费文本增量：

```ts fold title="observe-agent.ts"
const unsubscribe = agent.subscribe((event) => {
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

try {
  await agent.prompt("Read src/utils and suggest the next change.");
} finally {
  unsubscribe();
}
```

`Agent.subscribe()` 会按注册顺序等待异步监听器。产品可以在 `message_end` 时先保存消息，再让运行时进入工具预检。低层 `agentLoop()` 返回的事件流只保留事件顺序，不会等待消费方完成异步处理。

## Event 与 Hook 的区别

Event 和 Hook 都出现在 Agent 运行过程中，但承担的职责不同：

| 机制 | 作用 | 是否改变运行 |
| --- | --- | --- |
| Event | 描述某个阶段已经开始、更新或结束 | 默认只观察 |
| Hook | 在工具和 turn 边界参与运行决策 | 可以阻止执行、修改结果或停止循环 |

`agent.subscribe()` 接收 `message_update`、`tool_execution_end` 等事件。`beforeToolCall`、`afterToolCall` 和 `shouldStopAfterTurn` 则由 Agent Loop 在固定边界主动调用，分别用于执行前拦截、执行后调整结果，以及在当前 turn 完成后停止循环。

Event 说明「发生了什么」，Hook 决定「接下来是否照常执行」。两套机制分开后，界面可以专注于消费事件，运行策略则集中在明确的 Hook 边界中。

## 一次调用如何结束

`turn_end` 只表示当前模型响应及其工具执行已经完成。随后，运行时按顺序判断是否继续：

- `shouldStopAfterTurn` 要求停止时，直接结束本次运行；
- 工具结果仍需交给模型时，开始下一轮；
- Steering 队列中有消息时，将消息注入下一轮；
- 没有工具和 Steering 消息后，再检查 Follow-up 队列；
- 所有来源都没有后续工作时，发出 `agent_end`。

`continue()` 是另一个运行入口。它不会创建新的用户消息，而是从现有上下文启动一个新的 Agent run，适合错误重试或恢复中断的流程。上下文最后一条消息通常必须是用户消息或 `toolResult`；如果最后一条是 assistant 消息，只有已经排队的 Steering 或 Follow-up 消息可以继续运行。

`agent_end` 是 `Agent` 低层运行的最后一个事件，但不是异步调用立即返回的信号。`Agent` 会先等待所有 `agent_end` 监听器完成，再让 `prompt()`、`continue()` 和 `waitForIdle()` 结束，此时 `isStreaming` 才恢复为 `false`。

`coding-agent` 在此之上增加了 `agent_settled`。`AgentSession` 会在 `agent_end` 后继续处理自动重试、Compaction，以及结束事件监听器新加入的队列消息；这些工作全部完成后，才发出 `agent_settled`。因此，`turn_end` 表示一轮完成，`agent_end` 表示一次低层运行完成，`agent_settled` 才表示产品层的连续处理已经结束。

## 小结

`prompt()` 启动的是一个 Agent run，而不是固定的一次模型请求。run 由一个或多个 turn 组成，消息事件描述模型输出，工具事件描述本地执行，工具结果和排队消息决定是否继续下一轮。Event 暴露运行过程，Hook 控制关键边界，`agent_end` 与 `agent_settled` 则分别标记运行时和产品层的结束时机。
