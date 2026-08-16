---
createdAt: '2026-08-09 13:45'
order: 1
---

# Pi Agent 是什么

Pi 是一套面向编码任务的 Agent Harness。它将模型、上下文、工具和 Agent Loop 组织起来，让 Agent 能够持续执行任务。Pi 提供可直接使用的编码 Agent，并将模型通信、Agent Runtime、编码产品和终端 UI 拆分为可组合的独立模块。

本系列以 Pi v0.84.2 为基准，将它作为一个可运行、可阅读的 Harness 样本，沿着一次任务的执行链路分析各模块如何协作，理解 Harness Engineering 的具体实现，并说明这些机制如何用于构建自己的 Agent 产品。

## 为什么值得学习

Pi 的核心只保留编码 Agent 运行所需的最小闭环。默认启用 `read`、`write`、`edit` 和 `bash` 四个基础工具，`grep`、`find` 和 `ls` 等其它内置工具可以按需启用，默认工具集合也可以通过 `defaultTools` 配置。其它能力则通过 Extensions、Skills、Prompt Templates 和产品层按需接入。核心足够小，可以直接完成真实编码任务，也便于阅读、替换和重组。

这套设计的价值主要体现在几个方面：

- **闭环完整**：模型响应、工具调用、结果回注和下一轮调用，串起持续执行的任务链路；
- **任务可持续**：Session 管理消息历史，支持继续、分支和上下文压缩，适合长时间编码任务；
- **模型可替换**：`pi-ai` 统一模型接口与事件格式，Runtime 无需逐一适配 Provider；
- **过程可观察**：模型输出和工具执行过程以事件流向外暴露，便于追踪任务如何推进和定位异常；
- **边界清楚**：模型通信、Agent Runtime 和编码产品分层组织，每层都有明确的替换或扩展位置；
- **接入灵活**：同一套 Agent 能力既能独立运行，也能通过 SDK 或 RPC 嵌入其它应用。

## 核心架构

下面只介绍 Agent 主链路涉及的几个核心包及其职责，远程会话等其它集成包暂不展开：

| 包                | 职责                                                 |
| ----------------- | ---------------------------------------------------- |
| `pi-ai`           | 统一模型通信，处理 Provider 适配、消息转换和流式事件 |
| `pi-agent-core`   | Agent Runtime，负责 Agent Loop、工具调用、状态和事件 |
| `pi-coding-agent` | 编码 Agent 产品，组装模型、工具、Session 和交互      |
| `pi-tui`          | 终端 UI，负责输入、布局和输出                        |
| `pi-telemetry`    | 定义厂商无关的观测契约、事件 Schema 和参考适配器     |

一次任务会沿着下面的链路推进：

```d2 fold
vars: {
  d2-config: {
    layout-engine: elk
  }
}

direction: down

title: |md
  # Pi Agent
| {near: top-center}

product: "产品层 pi-coding-agent" {
  class: subgroup
  cli: "CLI / SDK / RPC"
  session: AgentSession
  tools: 编码工具
  resources: "Extensions / Skills"
}

runtime: "运行时 pi-agent-core" {
  class: subgroup
  agent: Agent
  loop: "Agent Loop"
  state: 状态和事件
}

model: "模型通信 pi-ai" {
  class: subgroup
  providers: "Provider 适配"
  protocol: "消息和 EventStream"
}

surface: "终端 UI" {
  class: subgroup
  tui: pi-tui
}

telemetry: "观测层" {
  class: subgroup
  package: pi-telemetry
}

product -> runtime: 创建任务并注入模型、工具和 Session 能力
runtime -> model: 调用模型
model -> runtime: 返回流式事件
runtime -> product: 发出运行事件和工具结果
product -> surface: 驱动终端交互
surface -> product: 提交用户输入
model -> telemetry: 传递遥测上下文
runtime -> telemetry: 使用 Agent/Harness Schema
```

一次任务通常从产品层接收用户输入开始：Runtime 将上下文和工具定义交给 `pi-ai`，模型返回文本或结构化工具调用；Runtime 校验并执行工具，把结果写回上下文，再继续下一轮模型调用，直到模型给出最终响应或任务被中止。产品层消费运行事件并更新界面，`pi-tui` 负责终端布局、输入和输出；SDK、RPC 等其它接入方式则由产品层对接外部宿主。

## 设计哲学

Pi 的核心取舍是把 Agent 的通用运行机制与具体产品能力分开。`pi-ai` 处理模型接入，Runtime 处理 Agent Loop、工具边界、状态和事件，`pi-coding-agent` 负责把 Session、工具和资源组装成编码产品，界面负责消费事件并呈现交互。新增能力通常由产品层或扩展层承载，核心运行时保持最小闭环。

Pi 默认不提供内置权限系统，进程会继承启动者的权限。需要确认、路径保护或更强隔离时，可以由产品或扩展提供策略，也可以使用容器或沙箱。扩展和 Pi Packages 会以当前进程权限运行，安装第三方内容前应先审查源码。

核心之外的扩展机制主要承担以下职责：

| 扩展方式         | 适合承载的内容                                         |
| ---------------- | ------------------------------------------------------ |
| Extensions       | 订阅生命周期事件，注册工具、命令、快捷键和自定义 UI    |
| Skills           | 为模型提供可复用的任务知识和操作约定                   |
| Prompt Templates | 把常用提示词封装为可重复调用的输入模板                 |
| Pi Packages      | 将 Extensions、Skills、Prompt Templates 和主题打包分发 |

权限确认、子 Agent、计划模式等工作流能力可以按产品需要组合，MCP 接入和其它外部集成也可以由扩展承载。这种「小核心、强扩展、显式边界」的设计，让 Pi 既适合直接使用，也适合作为二次开发的基础。

## Agent 的使用与接入方式

Pi 提供多种使用和接入方式，同一套模型、工具和 Agent Runtime 可以复用于不同场景。最直接的方式是在终端运行 `pi`，再用自然语言提出编码任务；脚本场景可以使用 Print / JSON，应用集成则可以使用 SDK 或 RPC。

| 方式         | 适用场景          | 主要特点                                    |
| ------------ | ----------------- | ------------------------------------------- |
| 交互式       | 直接在终端中使用  | TUI 接收用户输入并实时呈现 Agent 的运行过程 |
| Print / JSON | 脚本、CI 和批处理 | 一次性执行任务，输出文本或结构化事件        |
| SDK          | 嵌入自己的应用    | 在当前进程中创建并控制 AgentSession         |
| RPC          | 由其它进程集成    | 通过标准输入输出与其它进程交换命令和事件    |

这些方式共享模型、工具和 Agent Runtime，差异主要在于如何接收输入、消费事件和管理生命周期。终端 UI 只是其中一种宿主，脚本、SDK 和 RPC 同样可以复用这套 Agent 能力。

## 最小 Agent 骨架

下面绕过编码产品，直接用 `pi-agent-core` 和 `pi-ai` 组装一个最小 Agent。它只展示模型选择、状态初始化和事件输出，便于看清 Runtime 的基本边界。

```ts fold title="agent.ts"
import { Agent } from '@earendil-works/pi-agent-core'
import { createModels } from '@earendil-works/pi-ai'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'

const models = createModels()
models.setProvider(anthropicProvider())

const model = models.getModel('anthropic', process.env.PI_MODEL ?? 'claude-sonnet-4-6')
if (!model) throw new Error('model not found')

const agent = new Agent({
  initialState: {
    systemPrompt: 'You are a coding assistant.',
    model,
    tools: [],
  },
  streamFn: models.streamSimple.bind(models),
})

agent.subscribe((event) => {
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
    process.stdout.write(event.assistantMessageEvent.delta)
  }
})

await agent.prompt('Review src/utils and suggest the next change.')
```

这段示例只保留了模型选择、状态初始化、事件订阅和一次 `prompt()` 调用。由于 `tools` 为空，Agent 只能生成文本，不能执行本地操作；它也没有接入 Session 和界面，因此只是一个最小运行时示例。加入 `AgentTool` 后，模型才能调用具体工具；再接入 Session、权限策略和界面，才会形成面向用户的编码产品。

## Pi 与 Claude Code 的差异

Pi 和 Claude Code 都面向终端编码。Pi 是可组合的 Agent Harness，强调模块化与自由组合；Claude Code 是一体化编码产品，强调完整工作流与一致体验。下面是两者的设计差异：

| 维度     | Pi                                                                                | Claude Code                                                   |
| -------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 产品定位 | 可直接使用的编码 Agent，同时提供可复用的 Harness                                  | 一体化编码 Agent 产品                                         |
| 模型接入 | `pi-ai` 统一 Provider 的模型接口与事件格式，Runtime 无需分别适配                  | 模型由产品统一管理，默认使用 Anthropic 模型，也支持自定义配置 |
| 工具组织 | 编码工具由产品层提供，Runtime 不绑定具体工具                                      | 常用编码工具内置于产品，并与权限、交互统一提供                |
| MCP 接入 | 核心不内置 MCP，通过 Extensions 或自定义集成接入                                  | 产品内置 MCP 支持，直接连接外部工具和数据源                   |
| 权限控制 | 核心不内置权限系统，默认继承启动进程的权限                                        | 提供权限模式、允许或拒绝规则和工具调用确认                    |
| 扩展方式 | Extensions 接入工具、命令、快捷键和 UI，Skills 与 Prompt Templates 补充知识和提示 | 通过配置、Skills、Plugins 和 MCP 扩展产品能力                 |

## 小结

Pi 用一套小而完整的 Harness 支撑真实编码任务，通过模块化和扩展机制让使用者可以自由组合产品能力。对希望理解或构建 Agent 产品的开发者来说，Pi 既是可直接使用的编码工具，也是一个清晰的 Harness 学习样本。
