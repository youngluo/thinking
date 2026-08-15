---
title: DeepSeek Harness 的插件化内核
createdAt: '2026-08-15 15:04'
draft: true
order: 2
---

DeepSeek Harness 将模型、工具、会话和 Agent Loop 都实现为插件。支撑这些插件的 Cordis 并不是 Agent 框架，而是一个小型插件内核，只负责加载、依赖和卸载。

这条边界很重要。Cordis 不知道什么是模型请求，也不处理工具调用。它提供可逆的组合机制，具体业务能力由运行在 Context 中的插件提供。

## Cordis 只负责组合

Cordis 通过共享的 Context 连接插件。插件可以在 Context 上注册服务、监听事件、声明依赖，并登记需要在卸载时清理的副作用。

| 机制 | 职责 |
| --- | --- |
| Context | 表示当前插件所在的作用域，承载服务、事件和生命周期 |
| Service | 向其它插件公开一组稳定能力 |
| Event | 在插件之间传递状态变化和运行信号 |
| Effect | 登记监听器、资源等副作用，并在作用域销毁时自动清理 |
| 依赖注入 | 等待所需服务可用后再启用插件逻辑 |

插件不需要持有全局单例，也不必自行追踪所有清理函数。例如，一个依赖工具注册表的插件可以等 `tools` 服务出现后再注册工具；当它所在的 Context 被卸载时，对应注册也随 Effect 一起撤销。

这种可逆性让配置可以替换一组插件，而不会把上一组监听器和服务残留在进程中。热重载、测试隔离和按作用域挂载都建立在同一套生命周期机制上。

## 配置如何生成插件树

DeepSeek Harness 启动时不会硬编码一张固定插件表。Profile 先选择若干 Bundle，再按顺序叠加 Patch，最终生成 Cordis 插件树。

下面的图展示了配置从启动入口进入运行时的过程。Profile 决定进程级组合，后续 Patch 可以按配置行的 ID 替换参数或插入新插件。

```d2 fold
direction: down

profile: "Profile 进程组合" {
  class: group
  base: "基础 Bundle"
  surface: "Web / Headless Bundle"
  profile_patch: "Profile Patch"
  home_patch: "用户目录 Patch"
  cli_patch: "--patch Overlay"
}

runtime: "Cordis 插件树" {
  class: group
  kernel: "Context 与生命周期"
  core: "模型、工具、会话、Agent Loop"
  providers: "存储、沙箱、检索等 Provider"
  entry: "Web、Headless、SDK 接入"
}

profile.base -> profile.surface -> profile.profile_patch -> profile.home_patch -> profile.cli_patch
profile.cli_patch -> runtime.kernel
runtime.kernel -> runtime.core -> runtime.providers -> runtime.entry
```

Profile 还可以引入外部插件。这里的「外部」只表示插件不是默认 Bundle 随附的能力，可以由用户或第三方提供；启动时它仍会挂入同一 Cordis 插件树，接受统一的依赖、作用域和卸载管理。

几类配置对象分工如下。

| 配置对象 | 作用范围 | 主要职责 |
| --- | --- | --- |
| Profile | 整个进程 | 选择启动入口和基础 Bundle，引入外部插件，并提供 Profile Patch |
| Bundle | 一组插件配置 | 分发可复用的 Cordis 配置行与挂载代码 |
| Patch | 已生成的插件树 | 按 ID 替换配置，或插入额外配置行 |
| Agent Preset | 单个 Agent | 组合该 Agent 使用的模型、工具和其它插件能力 |

官方提供 `web` 与 `headless` 等 Profile。前者挂载交互界面，后者面向一次性任务和自动化。它们决定的是进程如何启动，不决定每个 Agent 使用标准模式还是极简模式。

## 核心能力如何挂入插件树

插件树中的核心包各自维护清晰边界，再通过服务和事件协作。

| 核心能力 | 主要职责 | 对外连接 |
| --- | --- | --- |
| Session | 追加会话事件，维护可恢复的运行记录 | 持久化、查询、Trajectory |
| System Prompt | 按 Step 汇总提示词片段和工具 Schema | Skills、工具、上下文注入 |
| Tools | 注册工具，规范调用和结果 | 权限、沙箱、审批、Code Mode |
| Agent | 管理 Agent、Preset 和作用域 | Session、模型、工具 |
| Agent Loop | 推进 Turn 与 Step | LLM、Tools、Session 事件 |
| LLM | 定义模型请求接口和消息格式 | DeepSeek 等模型 Adapter |

Agent Loop 只消费这些接口。例如模型由 LLM Adapter 提供，工具由 Tool Registry 提供，会话由 Session 服务记录。替换模型或存储 Provider 时，循环本身不需要知道具体实现。

## Capability Seam 如何隔离替换点

仅靠服务接口还不足以保证可替换性。DeepSeek Harness 使用 Capability Seam 把一个能力拆成三个角色。

| 角色 | 职责 | 示例 |
| --- | --- | --- |
| Service Definition | 定义稳定接口和共享类型 | 文件系统、子进程、会话持久化接口 |
| Service Provider | 提供具体实现 | 本地文件系统、沙箱文件系统、JSONL、SQLite |
| Consumer | 只依赖接口，不感知实现来源 | 工具插件、Agent Loop、Web UI |

Definition 不携带具体实现，Provider 可以并存或被配置替换，Consumer 只面向能力接口。这使一组相关能力可以整体移动到不同的执行环境。例如文件系统、子进程、PTY 和语言服务可以共享同一个执行世界；子 Agent 也可以由进程内实现或外部 Agent Provider 接管。

Capability Seam 并不意味着所有 Provider 都能无条件互换。接口只固定能力边界，配置仍需保证依赖完整、作用域正确，并让同一执行世界中的文件和进程保持一致。

## Profile 与 Agent Preset 有什么区别

Profile 和 Agent Preset 都可以描述插件或服务的组合，但它们本身不是插件，作用域也不同。

| 对比项 | Profile | Agent Preset |
| --- | --- | --- |
| 作用对象 | 进程 | 单个 Agent |
| 选择内容 | 启动入口、基础 Bundle、外部插件和全局 Provider | 模型、工具、提示词和 Agent 能力 |
| 典型示例 | Web、Headless | 标准、PTC、极简、创造 |
| 生命周期 | 随进程启动和停止 | 随 Agent 作用域创建和销毁 |

Preset 会以常驻作用域挂入进程，不同会话再沿作用域父链解析对应能力。一个 Agent 产生历史记录后不能随意切换 Preset，因为系统提示词和工具 Schema 已经成为会话语义的一部分。允许中途替换会破坏「模型可见内容可以从日志重建」这一前提。

因此，Profile 回答的是「这个进程以什么形态运行」，Agent Preset 回答的是「这个 Agent 具备哪些能力」。第五篇会继续拆解四种内置 Preset 的组合方式。

## 小结

DeepSeek Harness 的插件化不是简单的模块拆包。Cordis 提供可逆生命周期，Profile 通过 Bundle、Patch 和外部插件配置构建进程级插件树，Capability Seam 固定可替换边界，Agent Preset 再为单个 Agent 选择能力。模型、工具和存储由此可以独立演进，同时仍受同一作用域和事件系统约束。

下一篇[《DeepSeek Harness 如何驱动并记录一次 Agent 运行》](<./DeepSeek Harness 如何驱动并记录一次 Agent 运行.md>)将沿这些服务之间的事件流，拆解一次 Turn 如何推进并写入 Session Log。

## 参考资料

- [DeepSeek Harness Architecture Reference](https://deepseek-harness.github.io/deepseek-harness/reference/)；
- [Capability Seams](https://deepseek-harness.github.io/deepseek-harness/reference/capability-seams)；
- [Agent Presets](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/preset/agent-presets)；
- [Cordis GitHub 仓库](https://github.com/cordiverse/cordis)；
- [Cordis 论文](https://github.com/cordiverse/paper)。
