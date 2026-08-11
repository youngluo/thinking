---
createdAt: '2026-08-09 20:49'
order: 8
draft: true
---

# Extensions 如何扩展 Agent

Agent Runtime 提供稳定的循环和事件，但不同开发者需要的工具、命令、权限和交互方式并不相同。Pi 用 TypeScript Extension 把这些产品差异放到运行时之外，再通过 `ExtensionAPI` 接入生命周期。

本文以 Pi commit `936aff00918de1187f085f123c2812d8f2d67745` 为基准，结合 `packages/coding-agent/docs/extensions.md`，说明扩展如何被发现、如何注册能力，以及事件和 Hook 如何改变一次任务的运行过程。

## 扩展层解决什么

Extension 是一个由 Pi 加载的 TypeScript 模块，既可以观察 Agent 运行，也可以注册新能力或拦截特定阶段：

| 能力 | 典型用途 |
| --- | --- |
| 注册工具 | 让模型调用项目专用工具或外部服务 |
| 订阅事件 | 记录运行状态、更新产品界面或触发外部动作 |
| 注册命令 | 增加 `/name` 形式的用户操作 |
| 用户交互 | 使用 `ctx.ui` 请求确认、输入、选择或通知 |
| 持久化扩展状态 | 通过 Session entry 保存可跨重启恢复的数据 |

扩展通常放在全局 `~/.pi/agent/extensions/` 或项目 `.pi/extensions/` 目录中。Pi 启动时发现这些模块，开发期间可以通过 `/reload` 重新加载；临时测试也可以显式传入扩展路径。

## ExtensionAPI 如何接入生命周期

扩展通过默认导出的工厂函数拿到 `ExtensionAPI`。同一个入口同时提供事件订阅、能力注册和用户界面访问：

```ts fold title="example-extension.ts"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const onAgentEnd = async () => {
    pi.notify("Agent run finished", "info");
  };

  pi.on("agent_end", onAgentEnd);
  pi.registerCommand("hello", {
    description: "Show a notification",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Hello from extension", "info");
    },
  });
}
```

扩展工厂可以在加载时完成注册，也可以异步初始化外部资源。注册本身不会复制 Agent Loop，而是把回调挂到宿主维护的事件和能力表中。

## 如何注册工具和命令

`registerTool()` 把一个 `AgentTool` 放入产品层的工具集合，模型可以像调用内置工具一样调用它。工具的参数 schema、执行函数和执行模式仍由工具定义，运行时负责统一校验、调度和结果回注。

`registerCommand()` 面向用户输入，不直接作为模型工具。命令可以读取上下文、修改设置、触发 Session 操作或调用 `ctx.ui`，适合承载模型不应该自行决定的显式操作。

这两个入口体现了扩展层的两种方向：工具扩展模型的行动空间，命令扩展用户对 Agent 的控制空间。

## 如何监听事件和介入交互

Pi 的事件和 Hook 需要区分：事件用于观察已经发生或正在发生的过程，Hook 则允许扩展在边界上拦截或修改行为。一个任务的主要生命周期可以概括为：

```d2 fold
direction: down

startup: "pi starts"
session: session_start
discover: resources_discover
input: input
before: before_agent_start
agent: agent_start
turn: "turn loop" {
  class: group
  context: context
  request: before_provider_request
  toolCall: tool_call
  toolResult: tool_result
  turnEnd: turn_end
  request -> toolCall: "模型请求工具时"
  toolCall -> toolResult
  toolResult -> turnEnd
  request -> turnEnd: "无工具调用时"
  turnEnd -> context: "继续下一轮"
}
end: agent_end
settled: agent_settled

startup -> session -> discover -> input -> before -> agent -> turn -> end -> settled
```

扩展可以在 `input` 阶段改写或接管用户输入，在 `before_agent_start` 阶段补充系统提示词或上下文，在 `context` 阶段调整模型消息，也可以在 `tool_call` 阶段阻止工具或在 `tool_result` 阶段修改结果。Provider 请求前后的事件则适合审计请求头、请求体和响应状态。

Session 切换也有对应生命周期。`/new` 和 `/resume` 会触发旧会话关闭与新会话启动，`/fork` 和 `/clone` 会在创建新 Session 前后触发可取消的切换事件。扩展可以利用这些边界清理资源、同步状态或拒绝不满足条件的切换。

## 扩展与运行时的边界

扩展拥有很强的组合能力，但它仍然运行在产品宿主提供的边界内：

- Agent Loop 决定模型、工具和消息的基本执行顺序，扩展通过事件和 Hook 接入，而不是复制一套循环；
- 工具扩展可以产生真实副作用，因此扩展代码本身也需要被信任和审查；
- `ctx.ui` 只在有界面宿主时可用，扩展不应假设所有运行模式都存在 TUI；
- 需要跨重启保存的数据可以通过 `pi.appendEntry()` 写入 Session，但具体 entry 如何展示和是否进入模型上下文需要明确约定。

这套边界让核心保持极简，同时允许产品按自己的安全策略、交互方式和工作流增加能力。`coding-agent` 这一产品层会进一步组合运行时、工具、会话和交互流程。

## 小结

Extensions 是 Pi 的产品适配层。它通过 `ExtensionAPI` 注册工具和命令，通过事件观察生命周期，通过 Hook 在关键边界上拦截或修改行为，并可以为扩展状态增加持久化。Agent Runtime 保持循环一致，产品差异则由扩展组合出来。
