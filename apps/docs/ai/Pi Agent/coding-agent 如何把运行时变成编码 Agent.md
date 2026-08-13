---
createdAt: '2026-08-09 20:49'
order: 9
draft: true
---

# coding-agent 如何把运行时变成编码 Agent

`pi-agent-core` 只知道模型、消息、工具和运行事件，并不知道项目目录、终端命令、认证配置或用户如何选择 Session。`pi-coding-agent` 把这些产品能力组合起来，才形成一个可以直接使用的编码 Agent。

本文以 Pi `v0.84.1` 为基准，说明产品层如何连接运行时和编码场景。具体工具执行、Session Tree 和 TUI 渲染分别由对应专题负责，这里只看它们如何组合成产品。

## 从运行时到产品层

编码 Agent 产品需要在通用循环之外补充一组环境能力：

| 产品能力 | 作用 |
| --- | --- |
| 工作目录 | 确定文件工具和命令执行的边界 |
| 编码工具 | 提供读取、搜索、编辑、写入和命令执行能力 |
| 模型与认证 | 让用户选择模型，并为 Provider 提供凭证 |
| Session 管理 | 创建、恢复、分支和保存任务历史 |
| 资源加载 | 读取上下文文件、Skills、Prompt Templates 和 Extensions |
| 交互入口 | 接收用户输入，呈现事件，处理命令和确认 |

在稳定版实现中，这些职责主要由四个对象汇合：

| 对象 | 主要职责 |
| --- | --- |
| `AgentSession` | 管理一次会话中的 Agent、消息、模型、压缩和事件 |
| `AgentSessionRuntime` | 在 new、resume、fork、clone 和 import 时替换整个会话运行环境 |
| `ModelRuntime` | 组合模型目录、Provider 认证与可用性状态 |
| `ResourceLoader` | 发现 Extensions、Skills、Prompt Templates、Themes 和上下文文件 |

这些能力在产品层汇合，再以 `Agent` 所需的模型、工具、上下文和事件订阅方式接入运行时：

```d2 fold
direction: down

product: pi-coding-agent {
  class: group
  sessionRuntime: AgentSessionRuntime
  agentSession: AgentSession
  modelRuntime: ModelRuntime
  resources: ResourceLoader
  tools: 编码工具
  sessionManager: SessionManager
}
runtime: pi-agent-core {
  class: group
  agent: Agent
  loop: "Agent Loop"
}
model: pi-ai
surface: "CLI / TUI / RPC / SDK"

product.sessionRuntime -> product.agentSession: 创建或替换
product.modelRuntime -> product.agentSession: 模型与认证
product.resources -> product.agentSession: 资源与扩展
product.tools -> product.agentSession: 注入工具
product.sessionManager -> product.agentSession: 恢复消息和状态
product.agentSession -> runtime.agent
runtime.agent -> runtime.loop
runtime.loop -> model: 请求模型
runtime.loop -> product.tools: 调度执行
product.agentSession -> surface: 发布产品事件
```

产品层负责组合，Agent Runtime 负责推进。两者的边界清楚后，同一个 Runtime 才能被 CLI、RPC 或其它宿主复用。

## AgentSession 如何编排编码任务

`createAgentSession()` 先让 `SessionManager` 打开或创建 JSONL 文件，再由 `ResourceLoader`、`ModelRuntime` 和工具配置构建 `AgentSession`。一次编码任务的高层流程是：

1. 根据工作目录和启动参数选择 Session；
2. 从当前 leaf 恢复消息、模型和 thinking level；
3. 加载上下文文件、Skills、Prompt Templates 和 Extensions；
4. 创建 `AgentSession`，向内部 `Agent` 注入模型、工具和产品级 Hook；
5. 通过 `prompt()` 推进任务，并把产品事件交给当前运行模式。

`AgentSession` 还处理 Compaction、模型切换、Steering 和 Follow-up 等产品语义。Session Manager 负责持久化树，`Agent` 负责当前运行，两者由 `AgentSession` 连接。

new、resume、fork、clone 和 import 可能改变工作目录与项目资源，不能只替换一份消息数组。`AgentSessionRuntime` 会为新目标重建 cwd 相关服务并替换当前 `AgentSession`。订阅绑定在具体 Session 上，所以替换后需要重新订阅；Extensions 也需要重新绑定到新的 Session。

## 核心工具如何接入

编码 Agent 的工具集合通常围绕工作目录组织：

- `read`、`grep`、`find` 和 `ls` 负责观察项目；
- `edit` 和 `write` 负责产生代码变更；
- `bash` 负责运行命令、检查和测试；
- 输出截断、路径解析和错误转换控制结果进入上下文的大小与形状。

默认启用 `read`、`bash`、`edit` 和 `write`，其它内置工具可以按需开启。产品层创建工具并交给 Agent Runtime，Runtime 只负责统一描述、校验、调度和回注。工具的权限、超时、沙箱和确认策略由 coding-agent、Extensions 或部署环境提供。

工具不是编码 Agent 的全部。真正的产品体验还需要把工具调用转换成可读的状态，例如显示正在读取哪个文件、命令是否完成、编辑是否成功，以及错误是否需要用户介入。

## ModelRuntime 如何连接模型与认证

`coding-agent` 需要把「用户想用哪个模型」转换成 Agent Runtime 可以使用的 `Model`，并在请求模型时提供认证信息。典型职责包括：

| 组件 | 职责 |
| --- | --- |
| `ModelRuntime` | 汇总内置和自定义 Provider，处理模型选择与可用性 |
| Credential Store | 保存 API Key、OAuth 凭证或其它认证信息 |
| Settings | 合并全局、项目和命令行配置 |
| `pi-ai` | 将选中的模型和认证路由给具体 Provider |

认证优先级依次是运行时覆盖、已保存凭证、环境变量和自定义 Provider 的回退解析。`ModelRuntime` 负责维护认证和模型目录的一致状态，Agent Loop 只接收已经解析好的模型和 `streamFn`，不读取配置文件，也不决定凭证来源。

## ResourceLoader 如何组装项目上下文

`DefaultResourceLoader` 根据工作目录发现全局与项目级资源，包括 AGENTS.md、Skills、Prompt Templates、Themes 和 Extensions。项目级动态配置必须先通过项目信任判断，避免尚未授权的仓库加载设置或执行扩展代码。

资源加载与 Session 恢复是两个维度。Session 回答「之前发生了什么」，ResourceLoader 回答「当前工作目录有哪些规则和能力」。切换到不同 cwd 的 Session 时，两者都要重新计算，不能沿用旧项目的扩展和上下文文件。

## CLI 与 TUI 的交互边界

CLI 和 TUI 都是产品宿主，但职责不同：

- CLI 负责解析启动参数、模式选择、Session 选项和显式命令；
- TUI 负责输入编辑、消息展示、工具状态、确认和滚动；
- Agent Runtime 通过事件向它们报告消息增量、工具执行和运行结束；
- 用户干预通过 `prompt()`、Steering、Follow-up 或产品命令重新进入运行时。

Pi 提供 interactive、print/JSON、RPC 和 SDK 四种接入方式。同一套 `AgentSession` 语义由不同宿主消费：交互式模式实时渲染，print/JSON 面向一次性和机器可读输出，RPC 通过子进程协议集成，SDK 则在进程内嵌入。

这也解释了为什么 `pi-coding-agent` 不是一个「加了终端 UI 的 Agent 类」。它还负责资源发现、认证、Session、工具和运行模式，是把通用 Runtime 组织成编码产品的 Harness。

## 小结

`pi-coding-agent` 用 `AgentSession` 汇合编码工具、Session、模型和资源，再由 `AgentSessionRuntime` 管理会话环境的替换。通用 Runtime 负责循环和工具调度，产品层负责项目环境、持久化与交互，因此同一套能力既能直接运行，也能通过 SDK 或 RPC 接入新产品。
