---
title: DeepSeek Harness 如何用 Preset 组合 Agent
createdAt: '2026-08-15 15:04'
draft: true
order: 5
---

DeepSeek Harness 的标准、PTC、极简和创造模式共享同一个插件内核与 Agent Loop。它们之间的差异来自 Agent Preset，也就是为单个 Agent 选择的一组模型、工具、提示词和插件能力。

Preset 把底层可替换能力收束成可直接使用的 Agent 形态。理解这一层后，四种模式不再是分散的功能清单，而是面向不同任务组织出的四套能力组合。

## Agent Preset 组合什么

每个 Preset 通过 `agent.cordis.yml` 描述自己的 Cordis 配置。运行时将 Preset 挂到常驻作用域，使用该 Preset 的 Agent 再从父作用域解析模型、工具和其它服务。

Preset 主要组合四类内容。

| 组合内容 | 决定什么 | 示例 |
| --- | --- | --- |
| 模型能力 | 使用哪个 LLM Adapter 和模型配置 | DeepSeek 模型、其它兼容 Provider |
| 工具能力 | 本 Step 向模型公开哪些工具 Schema | 文件、Shell、搜索、Code Mode |
| 任务能力 | Agent 如何保存状态和组织复杂工作 | Skills、计划、目标、子 Agent、工作流 |
| 提示词能力 | 如何向模型说明工具、策略与当前环境 | 工具说明、技能内容、运行时提示 |

同一个 Preset 可以服务多个 Agent，但每个 Agent 和会话仍有独立状态。Preset 提供共享能力，不共享会话历史、计划内容或目标进度。

Agent 一旦产生历史记录就不能随意切换 Preset。不同 Preset 的系统提示词和工具 Schema 可能不同，中途切换会让后续模型输入无法从原始会话一致重建。因此，Preset 选择在 Agent 为空时完成，并在其生命周期内保持稳定。

## Profile 与 Preset 分别组合哪一层

第二篇已经分析过两者的结构差异。放到实际运行中，可以进一步概括为两步。

1. Profile 先启动进程，决定使用 Web 还是 Headless 入口，以及全局 Provider 和基础 Bundle；
2. Agent Preset 再进入这个进程，为具体 Agent 选择模型、工具和任务能力。

因此，Web 进程中可以存在采用不同 Preset 的 Agent；标准模式也可以由 Headless 或 SDK 驱动。入口形态与 Agent 能力组合相互独立。

## 四种内置模式如何取舍

官网给出的四种模式覆盖了从通用执行到能力创作的不同需求。

| 模式 | 核心工具与能力 | 组织复杂任务的方式 | 适合场景 |
| --- | --- | --- | --- |
| 标准模式 | 文件、Shell、搜索、Skills、计划、目标、子 Agent、工作流 | 由模型逐步调用工具并维护任务状态 | 通用编码、仓库分析和长任务 |
| PTC 模式 | 标准能力与 Code Mode SDK | 编写 TypeScript 程序批量组合工具子调用 | 调用密集、步骤可程序化的任务 |
| 极简模式 | 持久 Bash、`str_replace_editor` | 用少量通用原语自行组织操作 | 验证基础 Agent 行为和减少工具面 |
| 创造模式 | 标准能力、运行时检查、内存插件实验、Preset 指引 | 检查现有能力并试作新的插件组合 | 探索、调试和创作自定义 Preset |

模式差异主要发生在“向模型提供什么”。它们仍共享 Session Log、Agent Loop 和工具安全管线。PTC 的子调用不会绕过 Guard，极简模式也不会因为工具少而获得更高权限。

### 标准模式

标准模式提供最完整的通用能力。模型可以读取和修改文件、执行 Shell、搜索信息，并用计划与目标保存任务进度。遇到适合拆分的工作时，它还可以委派子 Agent，或用工作流表达可重复的多步编排。

这套组合适合作为默认 Agent，但能力越多，系统提示词和工具 Schema 占用的上下文也越多。Preset 的价值之一就是让使用者不必为所有任务都加载完整工具面。

### PTC 模式

PTC 模式在标准能力上增加 Code Mode SDK。模型不必逐轮发出大量独立工具调用，而是可以生成一段 TypeScript 程序，用变量、循环和条件组合子调用。

程序只负责分发和编排，具体工具仍由 Harness 执行。每次子调用都返回结构化结果并经过同一安全管线，因此 PTC 改变的是调用密度与控制方式，不是底层能力边界。

### 极简模式

极简模式只保留持久 Bash 和 `str_replace_editor`。Shell 提供通用执行能力，编辑器工具负责精确修改文本。模型需要用少量原语完成原本由专用工具承担的工作。

这种模式适合观察模型在低抽象工具集上的行为，也能减少工具 Schema 和提示词负担。代价是搜索、计划、委派等高级能力不再由专门插件直接提供。

### 创造模式

创造模式面向 Harness 本身的扩展。它在标准能力之外提供运行时检查、内存 Cordis 插件实验和 Preset 创作指引，让 Agent 能查看当前插件结构，试验新的服务或工具，再整理为可复用配置。

内存实验不会自动变成受信任的正式能力。用户创建的 Preset 可以引用模型、文件和 Shell 等高权限插件，其信任等级与它所组合的插件相同。正式启用前仍需检查配置来源、权限范围和依赖关系。

## 任务能力如何分工

标准、PTC 和创造模式会组合多种任务能力，但它们并不都属于 Agent Loop。

| 能力 | 保存或提供什么 | 与 Loop 的关系 |
| --- | --- | --- |
| Skills | 按需加载的领域说明和操作规则 | 作为可选上下文进入系统提示词 |
| 计划 | 当前任务的步骤、状态和进度 | 由工具维护，帮助模型组织当前工作 |
| 目标 | 从 Session Log 折叠出的版本化目标状态 | 支持跨 Turn 持续推进 |
| 子 Agent | 委派、恢复和收集其它 Agent 的结果 | 通过 Provider 执行，不属于 Loop 核心 |
| 工作流 | 模型编写的多步编排脚本 | 由工作流 Provider 执行并调用子 Agent |
| 后台任务 | Bash、PTY、子 Agent 等长期工作的句柄 | 由 Jobs 能力查询、读取和停止 |
| 调度 | 决定后台工作何时运行和如何续接 | 由相应 Provider 实现 |

Skills 更像按需注入的说明，不是会话事件本身。计划和目标保存任务状态，子 Agent 与工作流负责扩大执行规模，Jobs 则为长时间运行的进程和委派提供统一控制面。

这些能力通过 Capability Seam 接入，Agent Loop 只在明确的事件边界消费它们。例如工作流可以启动多个子 Agent，但主 Loop 不需要内置具体的 worker-thread、进程内 Agent 或外部 Agent 实现。

## Provider 如何替换运行环境

Preset 选择“需要哪些能力”，Provider 决定“这些能力由谁实现”。同一套 Agent 组合可以在不同环境中替换底层实现。

- LLM Adapter 可以连接不同模型，同时保持统一请求与流式事件；
- Session 和 Storage 可以使用 JSONL、SQLite 等持久化 Provider；
- 文件系统、子进程和 PTY 可以迁移到本地或沙箱执行世界；
- 子 Agent 可以由进程内实例、ACP 或其它外部 Agent Provider 执行；
- 接入层可以选择 Web UI，也可以由 Headless 或 SDK 消费同一运行状态。

替换能力仍需遵守依赖边界。文件系统与子进程等相关 Provider 应保持同一个执行世界，存储 Provider 也要实现对应的会话或状态接口。Preset 负责声明组合，不会自动修复彼此不兼容的实现。

## 插件组合带来哪些风险

插件化提高了可替换性，也把更多正确性责任交给配置。

- 能力重复或依赖缺失可能让插件树无法形成预期作用域；
- 系统提示词、工具 Schema 和 Provider 组合会共同影响 Agent 行为，排查问题不能只看模型；
- 用户 Preset 可以获得与 Shell 相同的高权限，不能把配置文件视为普通提示词；
- Developer Preview 阶段的接口、包结构和内置 Preset 仍可能发生不兼容变化。

因此，自定义 Preset 更适合从现有组合复制后小步修改，并同时检查 Trajectory、工具审批和会话日志。创造模式提供了实验入口，但正式组合仍需要明确的权限审查和版本约束。

## 小结

Agent Preset 位于 Cordis 插件能力与具体 Agent 之间。它选择模型、工具、提示词和任务能力，Profile 则负责进程入口与全局 Provider。标准、PTC、极简和创造模式共享运行内核，只用不同组合平衡能力覆盖、调用方式、上下文成本和扩展自由度。

至此，五篇文章形成了一条完整链路：Cordis 组织插件，Profile 启动进程，Preset 组合 Agent，Agent Loop 推进 Turn 与 Step，Session Log 记录模型可见历史，工具管线约束实际执行。

## 参考资料

- [DeepSeek Harness 官网](https://deepseek.com/harness/)
- [Agent Presets](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/preset/agent-presets)
- [Skills](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/skills)
- [Workflow](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/workflow)
- [Subagent](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/subagent)
- [DeepSeek Harness Architecture Reference](https://deepseek-harness.github.io/deepseek-harness/reference/)
