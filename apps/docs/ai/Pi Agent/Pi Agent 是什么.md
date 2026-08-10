---
createdAt: '2026-08-09 13:45'
order: 1
draft: true
---

# Pi Agent 是什么

Pi Agent 是一个以编码任务为主要场景，由模型、Agent Runtime、工具、会话和产品界面组成的可扩展 AI Agent 工具。它接收自然语言任务，调用模型提出行动，再由运行时调度工具读取文件、执行命令和修改代码；会话保存过程，界面呈现结果。

模型负责理解和决策，Harness 负责组织上下文、工具、状态和执行边界，让每一步决策在可持续、可观察、可干预的流程中继续推进。Pi Agent 不是模型、系统提示词或一次工具调用的包装。

本系列把 Pi 作为可运行、可阅读的 Harness 样本，结合源码追踪这些机制如何协作，并将经验迁移到自己的 Agent 产品或基于 Pi 构建的新产品。

## 为什么受到关注

Pi 适合作为本系列的源码样本，因为它保留了清晰的 Agent 最小闭环，也为扩展和改造留下了边界：

- **核心极简**。模型调用、工具调度、会话状态和事件流集中在少数核心边界内，读者可以沿着一次任务的调用链理解 Agent 如何运行；
- **源码清晰**。编码产品、Agent Runtime、统一 LLM API 和终端 UI 各自承担不同职责，架构图可以直接对应到代码中的包和模块；
- **能力可扩展**。模型提供商、工具、Skills、Extensions 和界面都可以替换或组合，核心运行时不必承载所有产品需求；
- **经验可迁移**。读懂 Pi 的实现后，开发者可以把相同的 Harness 思路用于自己的 Agent 产品，而不只是学会使用一个现成工具。

读者既可以把它作为编码 Agent 使用，也可以把它作为理解 Harness、验证设计取舍和构建新产品的样本。

## Pi 的减法哲学

Pi 的极简体现在把不属于核心 Agent Loop 的决定留给产品层和运行环境：

| Pi 不替你做的决定 | 这样做的原因 | 开发者如何补上 |
| --- | --- | --- |
| 绑定某一家模型提供商 | 保持模型通信层可替换，避免运行时和厂商 API 耦合 | 通过 `pi-ai` 配置 Provider，也可以接入自己的模型适配层 |
| 规定唯一的产品界面 | Agent Runtime 可以被 CLI、TUI、Web 或其它宿主复用 | 订阅运行事件，按产品场景实现自己的界面 |
| 把完整持久化和编排塞进低层 Agent | 最小 Agent 可以用于一次性任务，也可以被更复杂的 Harness 包装 | 根据任务需要接入 Session、AgentHarness 或自己的状态存储 |
| 替产品决定权限和沙箱策略 | 文件、进程、网络和凭证的边界取决于部署环境 | 在产品层、容器或沙箱中补充权限确认和隔离策略 |

这些「不做」让 Pi 保持轻量，也把组合、权限和部署责任交给使用者。想直接完成日常开发，可以选择产品化程度更高的工具；想研究或改造 Agent，Pi 的开放边界更有价值。

## 多重定位

同一个 Pi Agent 同时承担四种角色：

| 定位 | 关注对象 | 解决的问题 |
| --- | --- | --- |
| AI Coding Agent | 用户可以直接使用的编码产品 | 如何让模型完成真实的软件开发任务 |
| Agent Harness | 上下文、循环、工具、状态和执行边界 | 如何让模型的决策持续转化为可控行动 |
| LLM 通信层 | 多模型适配和统一事件 | 如何屏蔽不同模型 API 的差异 |
| 可扩展 Agent Toolkit | SDK、Extensions、Skills 和多种界面 | 如何把同一套 Agent 能力接入不同产品 |

## 产品与核心组件

Pi 的核心包及其职责如下：

- `pi-coding-agent` 是面向用户的编码 Agent 产品，负责组合模型、工具、会话和交互流程；
- `pi-agent-core` 是 Agent Runtime，负责 Agent Loop、工具调用和运行状态；
- `pi-ai` 负责统一多模型通信，处理 Provider 适配、消息转换和事件输出；
- `pi-tui` 负责终端 UI，把运行事件呈现为交互界面。

本文用「Pi」指项目整体，具体职责以包名为准。

## 架构总览

这张图只展示产品、运行时、模型通信和界面与宿主四层的职责和依赖关系，不展开 Agent Loop、Context Builder、Tool Runtime 或 Compaction 的内部实现。

```d2 fold
direction: down

project: Pi Agent 项目 {
  class: group

  product: 产品层 pi-coding-agent {
    class: subgroup
    cli: CLI / SDK
    tools: 编码工具
    resources: Extensions / Skills
  }

  runtime: 运行时 pi-agent-core {
    class: subgroup
    session: AgentSession / Session
    loop: Agent Loop
    state: 状态和事件
  }

  model: 模型通信 pi-ai {
    class: subgroup
    providers: Provider 适配
    protocol: 消息和 EventStream
  }

  surface: 界面与宿主 pi-tui {
    class: subgroup
    tui: TUI
    integration: 其它集成
  }
}

project.product -> project.runtime: 创建任务并提供能力
project.runtime -> project.model: 请求模型
project.model -> project.runtime: 返回统一事件
project.runtime -> project.product: 调度工具和返回结果
project.runtime -> project.surface: 呈现运行事件
```

这几个层次各自承担不同职责：

- 产品层把 Agent 放进编码场景，提供工具、资源加载和用户入口；
- 运行时持续推进任务，管理模型调用、工具调用、状态和事件；
- 模型层连接不同提供商，把请求和响应转换成运行时能够处理的形式；
- 界面与宿主消费运行事件，为终端或其它产品提供交互入口。

这里先记住两条边界：模型只能提出下一步行动，工具负责产生文件和进程副作用，运行时负责校验、调度和回注结果；界面主要消费运行事件并传递用户输入，不直接拥有 Agent Loop。

一次任务由产品层接收请求，运行时调用模型并调度工具，结果回流后继续推进，Session 保存过程，界面呈现事件。

## 如何基于 Pi 构建自己的 Agent

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

这段代码具备可运行 Agent 的最小闭环，但还不是完整的编码产品。可以沿着这些接入点扩展：

- 把 `AgentTool` 放进 `initialState.tools`，让模型获得受控的本地能力；
- 把事件订阅者替换成 CLI、TUI、Web 或其它产品界面；
- 在 Agent 外层接入 Session、权限确认、任务队列和恢复机制；
- 需要跨进程持久化和崩溃恢复时，再引入 AgentHarness 或实现自己的编排层。

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
