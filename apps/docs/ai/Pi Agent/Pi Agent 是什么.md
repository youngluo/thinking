---
createdAt: '2026-08-09 13:45'
order: 1
draft: true
---

# Pi Agent 是什么

Pi Agent 是一套面向编码任务的 Agent Harness，既提供可直接使用的编码 Agent，也将模型通信、Agent Runtime、编码产品和终端界面拆分为独立模块，开发者可以按需替换和组合这些模块，构建自己的 Agent 产品。

模型负责理解任务、生成响应和提出工具调用，Harness 负责组装上下文、驱动循环、执行工具和维护状态，将一次次模型调用组织成持续、可观察、可干预的任务执行过程。

本系列以 Pi `v0.84.1` 为基准，将 Pi 作为一个可运行、可阅读的 Harness 样本，结合源码追踪各模块如何协作，理解 Harness Engineering 的具体实现，并将这些机制用于自己的 Agent 产品或基于 Pi 构建的新产品。

## 为什么值得学习

Pi 的优势在于，它既能完成真实的编码任务，又对 Agent 的核心范围做了明确取舍。这里的「核心极简」主要指核心运行时只承担模型、消息、工具和运行状态等稳定职责，并不意味着减少模型完成任务所需的上下文。编码工具、会话管理、界面和其它产品能力则放在核心之外，按产品需要接入。这样既能沿着一次任务的调用链理解 Agent 如何运行，也能看清产品如何在这个核心之上补充能力：

- **核心极简**：稳定机制集中在有限的核心职责中，不把具体产品功能全部写进运行时，便于理解 Agent 的基本运行方式；
- **源码清晰**：核心运行机制与产品能力各有边界，阅读源码时可以先沿着任务主流程理解模型、工具和状态如何协作，再展开外围实现；
- **能力可扩展**：模型、工具、扩展和界面可以按需替换或组合，新增产品能力时不必反复修改核心运行机制；
- **经验可迁移**：Pi 展示了如何用稳定的运行核心承载不同产品能力，这种拆分方式也可以用于设计自己的 Agent 产品。

## 核心架构

下文用「Pi」指项目整体，涉及具体模块时使用包名。Pi 由几个职责明确的包组成：

| 包                | 职责                                                      |
| ----------------- | --------------------------------------------------------- |
| `pi-ai`           | 统一多模型通信，处理 Provider 适配、消息转换和流式事件    |
| `pi-agent-core`   | Agent Runtime，负责 Agent Loop、工具调用和运行状态        |
| `pi-coding-agent` | 面向用户的编码 Agent 产品，组合模型、工具、会话和交互流程 |
| `pi-tui`          | 终端 UI，把运行事件呈现为交互界面                         |
| `pi-telemetry`    | 提供与厂商无关的遥测契约、事件结构和参考适配器            |

这些包的协作关系如下图所示：

```d2 fold
vars: {
  d2-config: {
    layout-engine: elk
  }
}

direction: down

project: "Pi Agent 项目" {
  class: group

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

  surface: "界面与宿主" {
    class: subgroup
    tui: pi-tui
    integration: "Web / IDE / 其它宿主"
  }

  telemetry: "观测层 pi-telemetry"
}

project.product -> project.runtime: 创建任务并提供能力
project.runtime -> project.model: 请求模型
project.model -> project.runtime: 返回统一事件
project.runtime -> project.product: 发出事件并调度工具
project.runtime -> project.surface: 呈现运行事件
project.product -> project.telemetry: 记录产品运行
project.runtime -> project.telemetry: 记录模型与工具过程
```

图中最重要的边界位于模型与工具之间。模型生成文本和结构化工具调用，真正的文件读写、命令执行和网络访问发生在工具中。Runtime 负责校验、调度和回注结果，产品层提供会话、工具和资源，界面只消费运行事件。

## 设计哲学

Pi 把稳定机制留在核心，把产品差异交给外层。Provider 处理模型差异，Runtime 维护循环和工具边界，`pi-coding-agent` 组装会话与资源，界面根据事件呈现过程。开发者可以替换其中一层，而不用重写整套 Agent。

权限设计最能体现这一取舍。Pi 不在核心中内置文件、进程、网络或凭证权限系统，默认继承启动它的用户和进程权限。产品可以在工具执行前增加确认和策略拦截，也可以通过容器或沙箱隔离整个进程。具体安全边界由产品和部署环境决定。

功能扩展同样放在核心之外：

| 扩展方式         | 适合承载的内容                                         |
| ---------------- | ------------------------------------------------------ |
| Extensions       | 订阅生命周期事件，注册工具、命令、快捷键和自定义 UI    |
| Skills           | 为模型提供可复用的任务知识和操作约定                   |
| Prompt Templates | 把常用提示词封装为可重复调用的输入模板                 |
| Pi Packages      | 将 Extensions、Skills、Prompt Templates 和主题打包分发 |

权限确认、子 Agent、计划模式和外部集成都可以按产品需要组合。这种「小核心、强扩展、显式边界」的设计让 Pi 保持易读，也为二次开发留下了空间。

## 产品形态与接入方式

同一套 Agent 能力可以通过不同入口接入产品：

| 模式          | 适用场景          | 主要特点                             |
| ------------- | ----------------- | ------------------------------------ |
| 交互式        | 直接在终端中使用  | TUI 接收输入并实时呈现运行过程       |
| Print 或 JSON | 脚本、CI 和批处理 | 一次性执行任务，输出文本或结构化事件 |
| SDK           | 嵌入自己的应用    | 在进程内创建并控制 AgentSession      |
| RPC           | 由其它进程集成    | 通过标准输入输出交换命令和事件       |

这些入口共享模型、工具和 Agent Runtime，区别在于由谁接收输入、消费事件和管理生命周期。界面只是其中一个可替换的宿主，不决定 Agent 如何执行任务。

## 最小 Agent 骨架

下面展示最小接入方式。`pi-ai` 提供模型，`Agent` 管理状态、循环和事件，其它产品能力从外层接入。

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

这段代码完成了模型选择、Agent state、事件订阅和一次 `prompt()` 调用，但 `tools` 仍为空。加入 `AgentTool` 后，模型才有可调用的本地能力；继续接入 Session、权限策略和界面，才会形成完整的编码产品。

## 与 Claude Code 的取舍

Pi Agent 和 Claude Code 都能在终端中读取代码、修改文件和执行命令，但两者把复杂度放在了不同位置。下面比较的是产品路线，具体功能会随版本变化。

| 维度     | Pi Agent                                    | Claude Code                              |
| -------- | ------------------------------------------- | ---------------------------------------- |
| 产品定位 | 可研究、可组合的 Agent Harness 与编码 Agent | 面向开发者的完整编码产品                 |
| 模型关系 | 通过统一接口接入多个模型提供商              | 主要围绕 Anthropic 模型与生态组织        |
| 扩展方式 | 强调源码、Extensions、Skills 和自定义集成   | 强调现成工作流、权限配置、MCP 和产品能力 |
| 权限边界 | 核心不内置权限系统，隔离由产品或环境补充    | 产品层内置权限确认与配置能力             |
| 使用门槛 | 需要理解模型、工具和运行环境如何组合        | 产品层封装更完整，可以直接进入日常开发   |

Pi 更适合需要阅读源码、替换模型或重组 Harness 的开发者；Claude Code 更适合希望使用成熟工作流直接投入日常开发的用户。这里没有统一的优劣，关键在于需要的是可改造的基础设施，还是封装完整的编码产品。

## 系列文章地图

后续文章按「可观察行为 → Agent Loop → 工具 → 状态 → 支撑层 → 产品与编排」逐步深入：

| 顺序 | 主题                                              | 要回答的问题                                             |
| ---- | ------------------------------------------------- | -------------------------------------------------------- |
| 2    | 一次 prompt 调用发生了什么                        | 一次调用会产生哪些事件，什么时候结束                     |
| 3    | Agent 如何驱动 Agent Loop                         | Agent 如何组织状态、上下文和循环                         |
| 4    | 工具调用如何变成本地执行                          | 模型的工具调用如何经过校验、调度和结果回注               |
| 5    | Session 是什么                                    | JSONL 如何保存消息树、叶子和分支                         |
| 6    | Compaction 与 Branch Summarization 如何维持长任务 | 长任务和分支切换如何恢复上下文                           |
| 7    | pi-ai 如何统一不同模型                            | Models、Provider 和流式 API 如何协作                     |
| 8    | Extensions 如何扩展 Agent                         | 工具、命令、事件和界面如何接入生命周期                   |
| 9    | coding-agent 如何把运行时变成编码 Agent           | 产品层如何组合运行时、工具和交互                         |
| 10   | SDK 与 RPC 如何接入应用                           | 如何通过进程内 API 或进程间协议嵌入 Pi                   |
| 11   | AgentHarness v1 如何编排持久化运行                | Ref、锁和 Harness entry 如何形成早期设计                 |
| 12   | AgentHarness v2 如何用 Lanes 实现崩溃恢复         | Durable Runs、Lanes 和操作日志如何定义目标架构与恢复边界 |
| 13   | TUI 如何呈现 Agent 运行过程                       | 界面如何消费事件并保持交互响应                           |
