---
title: DeepSeek Harness 是什么
createdAt: '2026-08-16 22:50'
order: 1
---

DeepSeek Harness 是一套用于构建和运行 AI Agent 的开源基础设施。模型给出判断和行动意图，Harness 为它接入工具、会话、执行环境和交互界面，让一次模型调用可以持续推进为完整任务。

官方用一个等式概括两者的关系：

> Agent = Model + Harness

模型负责理解、推理与生成决策，Harness 负责提供能力、执行动作、保存过程并维持运行边界。在模型能力相同的情况下，好的 Harness 设计可以让 Agent 获得更完整的执行能力、更稳定地推进任务，并保留可恢复、可追溯的运行过程。

## 能力总览

DeepSeek Harness 将 Agent 运行涉及的能力拆分为多个可独立组合的部分：

| 能力           | 主要职责                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------- |
| 模型与循环     | 通过 LLM Adapter 统一模型调用，由 Agent Loop 在模型请求、工具执行和下一步决策之间持续推进 |
| 工具与知识     | 提供文件、Shell、搜索等工具，并通过 Skills 按需补充领域说明和操作规则                     |
| 会话与轨迹     | 记录系统提示词、模型内容和工具结果，支持 Trajectory（运行轨迹）、恢复、分叉、检索与回放   |
| 执行与安全     | 通过权限、审批、沙箱和文件系统守卫约束每次工具调用                                        |
| 任务组织       | 使用计划、目标、子 Agent 和工作流拆分并推进复杂任务                                       |
| 后台调度与存储 | 管理后台任务和调度，持久化会话与插件状态                                                  |
| 交互与接入     | 通过 Web、Headless 和 SDK 驱动同一套 Agent Runtime                                        |

这些能力共同构成 Agent 的运行环境。具体能力由插件提供，当前进程和 Agent 使用哪些插件由配置决定，因此模型、工具和存储都可以在清晰边界内替换。

## 运行形态

DeepSeek Harness 的运行形态有两个维度：能力组合和接入方式。Agent Preset 决定 Agent 具备哪些能力，接入方式决定外部如何驱动 Agent Runtime。

DeepSeek Harness 提供四种 Agent 模式，共用同一套运行内核，区别在于 Agent Preset 的能力组合：

| 模式     | 定位                      | 能力概览                                                                                            |
| -------- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| 标准模式 | 通用编码与复杂任务        | 功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子 Agent 和工作流    |
| PTC 模式 | 用程序组织密集的工具调用  | 具备标准模式的全部能力，并通过 Code Mode SDK 提供工具接口，让模型用一个 TypeScript 程序组合多步操作 |
| 极简模式 | 用少量原语完成任务        | 仅提供持久 Bash 与 `str_replace_editor` 两种工具                                                    |
| 创造模式 | 探索和创作新的 Agent 组合 | 具备标准模式的全部能力，并提供运行时检查、内存中的 Cordis 插件实验和 Agent Preset 创作指引          |

四种模式均可通过以下接入方式使用，模式选择与接入入口相互独立：

| 接入方式 | 主要用途                                       |
| -------- | ---------------------------------------------- |
| Web      | 提供会话、Trajectory、审批和运行状态等交互界面 |
| Headless | 在一次性任务、脚本和自动化流程中运行 Agent     |
| SDK      | 由其它程序创建会话、发送输入并消费 Agent 事件  |

## 设计思路

DeepSeek Harness 的整体设计围绕四条思路展开。下表分别说明它们的实现机制和实际价值：

| 设计思路             | 实现机制                                                                                                                                        | 实际价值                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 一切皆插件           | Cordis 负责组织模型、工具、会话、沙箱、存储、循环、调度和 UI 等插件能力；Profile 与 Agent Preset 负责组合预置插件，插件树支持通过补丁配置热更新 | 插件能力可按需加载、替换和扩展                           |
| 运行有迹可循         | 关键内容增量写入 Session Event Log，Trajectory 视图据此追溯内容来源                                                                             | 运行过程可以审计，并能从同一事件流恢复、分叉、检索和回放 |
| 执行边界统一         | 普通工具调用和 PTC 代码发起的子调用都会经过同一条工具执行管线，并统一接受权限检查、审批控制和沙箱隔离                                           | 更换工具集合不会改变安全语义，策略也不必散落在各个工具中 |
| 同一内核支持多种形态 | 不同模式和入口复用同一套运行内核，以及相同的会话和事件语义                                                                                      | Agent 能力组合与接入方式相互独立，可以按场景复用         |

这四条思路分别回答了能力如何组合、过程如何还原、动作如何约束，以及同一套内核如何适配不同运行场景。

## 架构总览

从宏观职责看，DeepSeek Harness 由接入层、配置组合和 Cordis 插件树组成。Profile 面向整个进程，负责组装接入层和插件树；Agent Preset 面向单个 Agent，选择模型、工具和其它能力。

接入层负责驱动 Agent Runtime，Agent Loop 负责连接模型、工具和会话，Skills、工作流、沙箱与存储等能力以插件形式接入。Cordis 负责插件的加载、依赖、作用域和卸载，不实现具体的 Agent 业务。整体架构如下：

```d2 fold
direction: down
title: |md
  # DeepSeek Harness
| {near: top-center}

entry: "接入层" {
  direction: right
  web: "Web"
  headless: "Headless"
  sdk: "SDK"
}
profile: "Profile\n进程级配置"
preset: "Agent Preset\nAgent 级能力配置"

plugins: "Cordis 插件树" {
  direction: right

  runtime: "Agent Runtime 相关插件" {
    grid-rows: 2
    grid-columns: 3
    vertical-gap: 80
    pad-left: "" {
      style.opacity: 0
    }
    loop: "Agent Loop"
    pad-right: "" {
      style.opacity: 0
    }
    llm: "LLM Adapter"
    tools: "Tool Registry"
    session: "Session Event Log"

    loop -> llm: "请求模型"
    loop -> tools: "调用工具"
    loop -> session: "追加事件"
  }

  capabilities: "能力插件" {
    direction: down
    skills: "Skills"
    planning: "计划与目标"
    subagent: "子 Agent"
    workflow: "工作流"
    sandbox: "沙箱与执行环境"
    jobs: "后台任务与调度"
    storage: "存储"
  }

  runtime -> capabilities: "接入能力"
}

entry -> plugins.runtime: "驱动 Agent Runtime"
profile -> entry: "组装接入层"
profile -> plugins: "组装插件树"
preset -> plugins: "选择与配置插件"
```

## 小结

DeepSeek Harness 以 Cordis 组织插件，通过 Agent Preset 组合模型、工具和其它能力，并用 Session Event Log 记录运行过程。「一切皆插件，运行有迹可循」构成了它的设计主线，使同一内核能够支持不同模式和接入方式。当前项目仍处于 Developer Preview 阶段，接口和内置能力会随项目演进而变化。
