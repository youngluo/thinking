---
createdAt: '2026-08-09 20:49'
order: 8
draft: true
---

# Extensions 如何扩展 Agent

Agent Runtime 提供稳定的循环和事件，但不同产品需要的工具、命令、安全策略和交互方式并不相同。Pi 用 TypeScript Extension 承载这些差异，再通过 `ExtensionAPI` 接入 coding-agent 生命周期。

本文以 Pi `v0.84.1` 为基准，说明扩展如何被发现、如何注册能力，以及事件和 Hook 如何介入一次任务。

## Extensions 解决什么

Extension 是一个由 Pi 加载的 TypeScript 模块，既可以观察 Agent 运行，也可以注册新能力或拦截特定阶段：

| 能力 | 典型用途 |
| --- | --- |
| 注册工具 | 让模型调用项目专用工具或外部服务 |
| 订阅事件 | 记录运行状态、更新产品界面或触发外部动作 |
| 注册命令 | 增加 `/name` 形式的用户操作 |
| 用户交互 | 使用 `ctx.ui` 请求确认、输入、选择或通知 |
| 持久化扩展状态 | 通过 Session entry 保存可跨重启恢复的数据 |
| 注册 Provider | 接入本地模型、代理服务或动态模型目录 |

## 扩展如何发现与加载

扩展通常放在全局 `~/.pi/agent/extensions/` 或项目 `.pi/extensions/` 目录中。Pi 启动时自动发现这些模块，开发期间可以通过 `/reload` 重新加载；`pi -e ./path.ts` 适合临时测试。

项目级扩展只有在当前项目被信任后才会加载。`project_trust` 发生在项目资源加载之前，并且只有用户级扩展和命令行显式传入的扩展能够参与这个判断。这样可以避免尚未信任的仓库先执行自己的扩展代码。

## ExtensionAPI 如何注册能力

扩展通过默认导出的工厂函数拿到 `ExtensionAPI`，再注册事件、工具、命令、快捷键、参数和 Provider：

```ts fold title="example-extension.ts"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async (_event, ctx) => {
    ctx.ui.notify("Agent run finished", "info");
  });

  pi.registerCommand("hello", {
    description: "Show a notification",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Hello from extension", "info");
    },
  });
}
```

工厂可以同步或异步返回。Pi 会等待异步初始化完成，再触发 `session_start` 和 `resources_discover`，因此动态模型目录等一次性启动工作可以放在工厂里。进程、Socket、文件监听器和定时器等长期资源应延迟到 `session_start` 或实际使用时创建，并在幂等的 `session_shutdown` 处理器中关闭。

`registerTool()` 把 `AgentTool` 加入产品工具集合，模型可以像调用内置工具一样调用它。工具参数、执行函数和执行模式仍由工具定义，运行时负责统一校验、调度与结果回注。

`registerCommand()` 面向用户输入，不会暴露给模型。命令可以读取上下文、修改设置、触发 Session 操作或调用 `ctx.ui`，适合承载必须由用户显式发起的动作。

工具扩展模型的行动空间，命令扩展用户对 Agent 的控制空间。两者共用同一个扩展入口，但拥有不同的调用者和安全边界。

## 事件与 Hook 如何介入

`pi.on()` 既能订阅观察型事件，也能在支持返回值的边界上拦截或修改行为。一个任务的主要生命周期可以概括为：

```d2 fold
direction: down

startup: "Pi 启动"
trust: project_trust
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
shutdown: session_shutdown

startup -> trust -> session -> discover -> input -> before -> agent -> turn -> end -> settled
settled -> input: "继续接收任务"
settled -> shutdown: "切换会话或退出"
```

扩展可以在 `input` 阶段改写或接管用户输入，在 `before_agent_start` 阶段补充系统提示词或上下文，在 `context` 阶段调整模型消息，在 `tool_call` 阶段阻止工具，也可以在 `tool_result` 阶段修改结果。Provider 请求前后的事件则用于调整请求头、检查请求体或观察响应状态。

`agent_end` 表示当前 Agent run 的事件已经结束，`agent_settled` 则表示重试、压缩和 follow-up 也已经处理完毕。Session 切换还有 `session_before_switch`、`session_shutdown` 和新的 `session_start`；扩展可以在这些边界清理资源、同步状态或拒绝切换。

## Session 与 UI 的边界

扩展可以通过 `pi.appendEntry()` 保存不进入模型上下文的自定义状态，也可以追加 `custom_message` 向模型注入上下文。两者都写入 Session Tree，但用途不同：前者用于恢复扩展状态，后者会影响模型后续决策。

`ctx.ui` 提供确认、输入、选择、通知和自定义组件等交互能力。扩展需要先检查 `ctx.hasUI`，不能假设 print、JSON 或 RPC 模式都存在 TUI。自定义渲染只改变内容如何展示，不应成为恢复业务状态的唯一来源。

## 安全与运行时边界

Extensions 不是受限插件。它们与 Pi 进程拥有相同的系统权限，可以读取文件、执行命令和访问网络，因此只应安装可信来源的代码。项目信任机制阻止未授权的项目扩展自动加载，但不会沙箱化已经获准执行的扩展。

- Agent Loop 决定模型、工具和消息的基本顺序，扩展只在宿主开放的事件边界介入；
- 扩展注册的工具会产生真实副作用，其输入校验和授权策略仍由扩展与产品负责；
- 长期资源必须跟随 Session 生命周期关闭，不能只依赖进程退出；
- 需要更强隔离时，应在容器、受限进程或远程服务层实现，而不是把 `ExtensionAPI` 当作安全沙箱。

Extensions 让核心运行时保持稳定，同时允许产品组合自己的工具、安全策略和交互流程。

## 小结

Extensions 通过 `ExtensionAPI` 注册工具、命令和 Provider，通过生命周期事件观察或修改运行，并通过 Session entry 保存扩展状态。它具有完整进程权限，项目信任、资源清理和 UI 可用性必须由扩展显式处理。
