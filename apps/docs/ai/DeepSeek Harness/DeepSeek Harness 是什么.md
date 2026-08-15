---
title: DeepSeek Harness 是什么
createdAt: '2026-08-15 15:04'
draft: true
order: 1
---

DeepSeek Harness 是一套用于构建和运行 AI Agent 的开源基础设施。模型给出判断和行动意图，Harness 为它接入工具、会话、执行环境和交互界面，让一次模型调用可以持续推进为完整任务。

官方用一个等式概括两者的关系：

> Agent = Model + Harness

模型负责理解、推理与生成决策，Harness 负责提供能力、执行动作、保存过程并维持运行边界。模型能力相同的情况下，Harness 的设计会直接影响 Agent 能做什么、如何继续运行，以及能否恢复或追溯运行过程。

## 能力总览

DeepSeek Harness 将 Agent 运行所需的职责拆成一组可以独立组合的能力：

| 能力 | 主要职责 |
| --- | --- |
| 模型与循环 | 通过 LLM Adapter 统一模型调用，由 Agent Loop 在模型请求、工具执行和下一步决策之间持续推进 |
| 工具与知识 | 提供文件、Shell、搜索等工具，并通过 Skills 按需补充领域说明和操作规则 |
| 会话与轨迹 | 记录系统提示词、模型内容和工具结果，支持 Trajectory（运行轨迹）、恢复、分叉、检索与回放 |
| 执行与安全 | 通过权限、审批、沙箱和文件系统守卫约束每次工具调用 |
| 任务组织 | 使用计划、目标、子 Agent 和工作流拆分并推进复杂任务 |
| 后台调度与存储 | 管理后台任务和调度，持久化会话与插件状态 |
| 交互与接入 | 通过 Web、Headless 和 SDK 驱动同一套 Agent Runtime |

这些能力共同构成 Agent 的运行环境。具体能力由插件提供，当前进程和 Agent 使用哪些插件则由配置决定，因此模型、工具和存储可以在清晰边界内替换。

## 设计思路

DeepSeek Harness 的能力面建立在四条设计思路上。下表说明每条思路的实现机制及其实际价值：

| 设计思路 | 实现机制 | 实际价值 |
| --- | --- | --- |
| 一切皆插件 | Cordis 组织模型、工具、会话、沙箱、存储、循环、调度和 UI，Profile 与 Agent Preset 选择具体组合，用户补丁配置变化时重新组合插件树 | 能力可以按需加载、替换和扩展，配置调整可以在运行中生效 |
| 运行有迹可循 | 关键内容写入仅追加的 Session Event Log，Trajectory 视图追溯内容来源 | 运行过程可以审计，并能从同一事件流恢复、分叉、检索和回放 |
| 执行边界统一 | 普通工具和 PTC 子调用都进入统一工具管线，再经过权限、审批与沙箱 | 更换工具集合不会改变安全语义，策略也不必散落在各个工具中 |
| 同一内核支持多种形态 | 四种 Agent 模式共享运行内核，Web、Headless 和 SDK 复用相同会话与事件语义 | Agent 能力组合与外部接入方式彼此独立，可以面向不同场景复用 |

「一切皆插件」解决能力如何组合，「运行有迹可循」解决过程如何还原。统一工具管线进一步约束插件产生的真实动作，而共享运行内核让这些设计在不同模式和入口下保持一致。

## 架构总览

从宏观职责看，DeepSeek Harness 由接入层、配置组合和 Cordis 插件树组成。Agent Runtime 与能力插件属于插件树，Cordis 负责插件的加载、依赖、作用域和卸载。

配置组合包含两个层级：Profile 面向整个进程，负责组装接入层和插件树，决定以 Web 或 Headless 等形态启动；Agent Preset 面向单个 Agent，决定它使用哪些模型、工具和其它能力。下图将接入层、Profile 和 Agent Preset 作为插件树外部的三个节点，插件树内部只保留 Agent Runtime 和能力插件：

```d2 fold
direction: down
title: |md
  # DeepSeek Harness
| {near: top-center}

entry: "接入层" {
  class: subgroup
  direction: right
  web: "Web"
  headless: "Headless"
  sdk: "SDK"
}
profile: "Profile\n进程级配置"
preset: "Agent Preset\nAgent 级能力配置"

plugins: "Cordis 插件树" {
  class: subgroup
  direction: right

  runtime: "Agent Runtime" {
    class: group
    direction: down
    loop: "Agent Loop"
    llm: "LLM Adapter"
    tools: "Tool Registry"
    session: "Session Event Log"

    loop -> llm: "请求模型"
    loop -> tools: "调用工具"
    loop -> session: "追加事件"
  }

  capabilities: "能力插件" {
    class: group
    direction: down
    skills: "Skills"
    planning: "计划与目标"
    subagent: "子 Agent"
    workflow: "工作流"
    sandbox: "沙箱与执行环境"
    jobs: "后台任务与调度"
    storage: "存储"
  }

  runtime -> capabilities: "调用"
}

entry -> plugins.runtime: "驱动 Agent Runtime"
profile -> entry: "组装接入层"
profile -> plugins: "组装插件树"
preset -> plugins.runtime: "选择能力"
```

Profile 在进程启动时组装接入层和 Cordis 插件树，接入层负责驱动 Agent Runtime，Agent Preset 为单个 Agent 选择模型、工具和其它能力。Loop 再连接模型、工具和会话，Skills、工作流、沙箱与存储等能力通过插件接入。Cordis 只维护插件生命周期和依赖，不实现具体的 Agent 业务。

## 运行形态

DeepSeek Harness 的运行形态包含能力组合和接入方式两个维度：Agent Preset 决定 Agent 具备哪些能力，接入方式决定外部如何驱动 Agent Runtime。

DeepSeek Harness 提供四种 Agent 模式。它们共享上述架构，只调整 Agent Preset 中的能力组合：

| 模式 | 定位 | 能力概览 |
| --- | --- | --- |
| 标准模式 | 通用编码与复杂任务 | 功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子 Agent 和工作流 |
| PTC 模式 | 用程序组织密集的工具调用 | 具备标准模式的全部能力，并通过 Code Mode SDK 提供工具接口，让模型用一个 TypeScript 程序组合多步操作 |
| 极简模式 | 用少量原语完成任务 | 仅提供持久 Bash 与 `str_replace_editor` 两种工具 |
| 创造模式 | 探索和创作新的 Agent 组合 | 具备标准模式的全部能力，并提供运行时检查、内存 Cordis 插件实验和 Agent Preset 创作指引 |

四种模式都可以复用以下接入方式，不与某个入口绑定：

| 接入方式 | 主要用途 |
| --- | --- |
| Web | 提供会话、Trajectory、审批和运行状态等交互界面 |
| Headless | 在一次性任务、脚本和自动化流程中运行 Agent |
| SDK | 由其它程序创建会话、发送输入并消费 Agent 事件 |

## 小结

DeepSeek Harness 以 Cordis 组织插件，通过 Agent Preset 组合模型、工具和其它能力，并用 Session Event Log 记录运行过程。「一切皆插件，运行有迹可循」构成了它的设计主线，也让同一内核能够支持不同模式和接入方式。项目目前仍处于 Developer Preview，本文以 2026 年 8 月 15 日的官网、官方文档和源码为基线。
