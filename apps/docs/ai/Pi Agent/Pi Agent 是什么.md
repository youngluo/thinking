---
createdAt: '2026-08-09 13:45'
order: 1
draft: true
---

# Pi Agent 是什么

Pi Agent 是一个以编码任务为主要场景，由模型、Agent Runtime、工具、会话和产品界面组成的可扩展 AI Agent 工具。它接收自然语言任务，调用模型提出行动，再由运行时调度工具读取文件、执行命令和修改代码；会话保存过程，界面呈现结果。

模型负责理解和决策，Harness 负责组织上下文、工具、状态和执行边界，让每一步决策在可持续、可观察、可干预的流程中继续推进。Pi Agent 不是模型、系统提示词或一次工具调用的包装。

本系列把 Pi 作为可运行、可阅读的 Harness 样本，结合源码追踪这些机制如何协作，并将经验迁移到自己的 Agent 产品或基于 Pi 构建的新产品。

## 为什么适合作为 Harness 样本

Pi 适合用来学习 Harness Engineering，不只是因为它能完成编码任务，更因为它把关键边界放在了容易阅读和替换的位置：

- **核心极简**。模型调用、工具调度、会话状态和事件流集中在少数核心边界内，可以沿着一次任务的调用链理解 Agent 如何运行；
- **源码清晰**。编码产品、Agent Runtime、统一 LLM API 和终端 UI 各自承担不同职责，架构图可以对应到代码中的包和模块；
- **能力可扩展**。模型提供商、工具、Skills、Extensions 和界面都可以替换或组合，核心运行时不必承载所有产品需求；
- **经验可迁移**。读懂 Pi 的实现后，可以把相同的 Harness 思路用于自己的 Agent 产品，而不只是学会使用一个现成工具。

这使 Pi 同时具备产品价值和研究价值。它可以直接作为编码 Agent 使用，也可以作为理解 Harness、验证设计取舍和构建新产品的具体样本。

## 权限与容器化

Pi 不在核心中内置文件、进程、网络或凭证的权限系统。默认情况下，Pi 继承启动它的用户和进程权限，工具调用因此拥有真实的本地副作用。

这不是把安全问题交给模型判断，而是把安全边界放回运行环境。产品可以在工具执行前增加确认和策略拦截，也可以把整个 Pi 进程放进容器或沙箱；具体选择取决于部署环境、任务类型和需要保护的资源。

这种设计体现了 Pi 的一个重要取舍：核心只提供可组合的 Agent Loop 和工具边界，不替所有使用场景规定唯一的权限模型。研究 Agent 时可以保持循环简单，投入生产时则需要由产品或基础设施补上隔离策略。

## 核心包

Pi 的核心能力分布在几个相互配合的包中：

| 包 | 职责 |
| --- | --- |
| `pi-ai` | 统一多模型通信，处理 Provider 适配、消息转换和流式事件 |
| `pi-agent-core` | Agent Runtime，负责 Agent Loop、工具调用和运行状态 |
| `pi-tui` | 终端 UI，把运行事件呈现为交互界面 |
| `pi-coding-agent` | 面向用户的编码 Agent 产品，组合模型、工具、会话和交互流程 |

可以从三个视角理解这些包：`pi-ai` 负责模型通信，`pi-agent-core` 负责持续推进任务，`pi-coding-agent` 和 `pi-tui` 负责把运行时放进具体产品与界面。本文用「Pi」指项目整体，具体职责以包名为准。

## 架构总览

这张图只展示产品、运行时、模型通信和界面与宿主四层的职责和依赖关系，不展开 Agent Loop、Context Builder、Tool Runtime 或 Compaction 的内部实现。

```d2 fold
direction: down

project: "Pi Agent 项目" {
  class: group

  product: "产品层 pi-coding-agent" {
    class: subgroup
    cli: "CLI / SDK"
    tools: 编码工具
    resources: "Extensions / Skills"
  }

  runtime: "运行时 pi-agent-core" {
    class: subgroup
    session: "AgentSession / Session"
    loop: "Agent Loop"
    state: 状态和事件
  }

  model: "模型通信 pi-ai" {
    class: subgroup
    providers: "Provider 适配"
    protocol: "消息和 EventStream"
  }

  surface: "界面与宿主 pi-tui" {
    class: subgroup
    tui: TUI
    integration: "其它集成"
  }
}

project.product -> project.runtime: 创建任务并提供能力
project.runtime -> project.model: 请求模型
project.model -> project.runtime: 返回统一事件
project.runtime -> project.product: 调度工具和返回结果
project.runtime -> project.surface: 呈现运行事件
```

这几个层次各自承担不同职责：产品层把 Agent 放进具体场景，运行时持续推进任务，模型层连接不同提供商，界面与宿主消费运行事件。模型只能提出下一步行动，工具负责产生文件和进程副作用，运行时负责校验、调度和回注结果。

## 四种运行模式

同一套 Agent 能力可以通过不同入口接入产品：

| 模式 | 适用场景 | 主要特点 |
| --- | --- | --- |
| 交互式 | 直接在终端中使用 | TUI 接收输入并实时呈现运行过程 |
| Print 或 JSON | 脚本、CI 和批处理 | 一次性执行任务，输出文本或结构化事件 |
| RPC | 由其它进程集成 | 通过标准输入输出交换请求和事件 |
| SDK | 嵌入自己的应用 | 在代码中创建 Session、Agent 和产品服务 |

这些模式共享模型、工具和 Agent Runtime，不共享具体的界面实现。模式的区别在于谁负责接收输入、消费事件和管理生命周期。

## 可扩展性

Pi 不把所有工作流都固化在核心产品中，而是通过不同扩展层补充能力：

| 扩展方式 | 适合承载的内容 |
| --- | --- |
| Extensions | 订阅生命周期事件，注册工具、命令、快捷键和自定义 UI |
| Skills | 为模型提供可复用的任务知识和操作约定 |
| Prompt Templates | 把常用提示词封装为可重复调用的输入模板 |
| Pi Packages | 将 Extensions、Skills、Prompt Templates 和主题打包分发 |

这种设计让权限确认、子 Agent、计划模式、外部集成等能力可以按产品需要组合，而不是全部进入核心 Agent Loop。核心保持轻量，开发者则获得改造和构建新产品的空间。

## 如何基于 Pi 构建 Agent

下面以 Pi commit `936aff00918de1187f085f123c2812d8f2d67745` 为基准，展示最小接入骨架。`pi-ai` 提供模型，`Agent` 负责状态、循环和事件，工具、持久化、权限和界面由产品补充。

```ts fold title="agent.ts"
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

const models = createModels();
models.setProvider(anthropicProvider());

const model = models.getModel("anthropic", process.env.PI_MODEL ?? "claude-sonnet-4-6");
if (!model) throw new Error("model not found");

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a coding assistant.",
    model,
    tools: [],
  },
  streamFn: models.streamSimple.bind(models),
});

agent.subscribe((event) => {
  if (event.type === "message_update") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await agent.prompt("Review src/utils and suggest the next change.");
```

这段代码具备可运行 Agent 的最小闭环，但还不是完整的编码产品。继续构建时，可以在外层加入工具和权限策略，用事件订阅者实现 CLI、TUI 或 Web 界面，再接入 Session、任务队列和恢复机制。

## 与 Claude Code 的差异

Pi Agent 和 Claude Code 都能在终端中读取代码、修改文件和执行命令，但复杂度的放置位置不同。下面比较的是两条设计路线，不是固定的功能清单，具体能力会随版本变化。

| 维度 | Pi Agent | Claude Code |
| --- | --- | --- |
| 产品定位 | 可研究、可组合的 Agent Harness 和编码 Agent | 面向开发者的完整编码产品 |
| 模型关系 | 通过统一接口接入多个模型提供商 | 主要围绕 Anthropic 模型与生态组织 |
| 扩展方式 | 更强调源码、Extensions、Skills 和自定义集成 | 更强调现成工作流、权限配置、MCP 和产品能力 |
| 权限边界 | 运行时保持简单，隔离通常交给容器或沙箱 | 产品层内置权限确认与配置能力 |
| 使用体验 | 需要理解模型、工具和运行环境的组合 | 开箱即用程度更高，产品层封装更完整 |

Pi 把更多复杂度留给使用者，换来模型、源码和扩展上的自由；Claude Code 把更多复杂度封装在产品层，换来更高的开箱即用程度。选择取决于目标是研究和改造 Agent，还是直接投入日常开发。

## 系列文章地图

后续文章按「可观察行为 → Agent Loop → 工具 → 状态 → 支撑层 → 产品与编排」逐步深入：

| 顺序 | 主题 | 要回答的问题 |
| --- | --- | --- |
| 2 | 一次 prompt 如何启动一次运行 | 一次调用会产生哪些事件，什么时候结束 |
| 3 | Agent 类如何驱动最小 Agent Loop | Agent 如何组织状态、上下文和循环 |
| 4 | 工具调用如何变成本地执行 | 模型的工具调用如何经过校验、调度和结果回注 |
| 5 | Session 是什么 | JSONL 如何保存消息树、叶子和分支 |
| 6 | Compaction 与 Branch Summarization | 长任务和分支切换如何恢复上下文 |
| 7 | pi-ai 如何统一不同模型 | Models、Provider 和流式 API 如何协作 |
| 8 | Extensions 如何扩展 Agent | 工具、命令、事件和界面如何接入生命周期 |
| 9 | coding-agent 如何把运行时变成编码 Agent | 产品层如何组合运行时、工具和交互 |
| 10 | AgentHarness v1 如何编排持久化运行 | Ref、锁和 Harness entry 解决什么问题 |
| 11 | AgentHarness v2 如何用 Lanes 实现崩溃恢复 | Durable Runs、Lanes 和操作日志如何工作 |
| 12 | TUI 如何呈现 Agent 运行过程 | 界面如何消费事件并保持交互响应 |
